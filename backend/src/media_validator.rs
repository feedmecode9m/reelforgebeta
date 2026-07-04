use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Deserialize;

const HTML_PROBE_LEN: usize = 200;

const ALLOWED_VIDEO_MIMES: &[&str] = &["video/mp4", "video/quicktime", "video/x-matroska"];

/// Metadata extracted from a validated video file.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VideoMeta {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub has_audio: bool,
}

#[derive(Debug, Clone)]
pub enum ValidationError {
    HtmlPayloadDetected(String),
    MimeMismatch(String),
    FfprobeFailed(String),
    NoVideoStream,
    EmptyCodec,
    EmptyFile,
    IoError(String),
}

impl ValidationError {
    pub fn reason_code(&self) -> &'static str {
        match self {
            ValidationError::HtmlPayloadDetected(_) => "html_payload_detected",
            ValidationError::MimeMismatch(_) => "mime_mismatch",
            ValidationError::FfprobeFailed(_) => "ffprobe_failed",
            ValidationError::NoVideoStream => "no_video_stream",
            ValidationError::EmptyCodec => "empty_codec",
            ValidationError::EmptyFile => "empty_file",
            ValidationError::IoError(_) => "io_error",
        }
    }

    pub fn detail(&self) -> String {
        match self {
            ValidationError::HtmlPayloadDetected(s) => s.clone(),
            ValidationError::MimeMismatch(s) => s.clone(),
            ValidationError::FfprobeFailed(s) => s.clone(),
            ValidationError::NoVideoStream => "no video stream in container".to_string(),
            ValidationError::EmptyCodec => "video stream missing codec_name".to_string(),
            ValidationError::EmptyFile => "file is empty".to_string(),
            ValidationError::IoError(s) => s.clone(),
        }
    }
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.reason_code(), self.detail())
    }
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Option<Vec<FfprobeStream>>,
    format: Option<FfprobeFormat>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
}

/// Scan the first ~200 bytes for HTML/error payloads masquerading as video.
pub fn detect_html_payload(bytes: &[u8]) -> Option<String> {
    let probe_len = bytes.len().min(HTML_PROBE_LEN);
    if probe_len == 0 {
        return None;
    }
    let probe = &bytes[..probe_len];
    let lower = String::from_utf8_lossy(probe).to_lowercase();

    let markers = [
        ("<html", "contains '<html'"),
        ("<!doctype", "contains '<!doctype'"),
        ("403", "contains '403'"),
        ("forbidden", "contains 'Forbidden'"),
    ];

    for (needle, label) in markers {
        if lower.contains(needle) {
            return Some(label.to_string());
        }
    }

    // Legacy binary HTML checks
    if probe.starts_with(b"<!") || probe.starts_with(b"<html") || probe.starts_with(b"<HTML") {
        return Some("HTML document header".to_string());
    }

    None
}

pub fn is_html_or_text_disguise(bytes: &[u8]) -> bool {
    detect_html_payload(bytes).is_some()
}

/// MP4/MOV/WebM container magic — fast pre-check before ffprobe.
pub fn is_valid_video_container(bytes: &[u8]) -> bool {
    if bytes.len() < 8 {
        return false;
    }
    if is_html_or_text_disguise(bytes) {
        return false;
    }
    if &bytes[4..8] == b"ftyp" {
        return true;
    }
    if bytes.len() >= 4 && &bytes[0..4] == b"\x1a\x45\xdf\xa3" {
        return true;
    }
    false
}

pub fn mime_for_video_path(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .as_deref()
    {
        Some("mp4") | Some("m4v") => Some("video/mp4"),
        Some("mov") => Some("video/quicktime"),
        Some("mkv") => Some("video/x-matroska"),
        Some("webm") => Some("video/webm"),
        _ => None,
    }
}

pub fn allowed_video_mime(mime: &str) -> bool {
    ALLOWED_VIDEO_MIMES.contains(&mime)
}

fn validate_mime_for_path(path: &Path) -> Result<&'static str, ValidationError> {
    let mime = mime_for_video_path(path).ok_or_else(|| {
        ValidationError::MimeMismatch(format!(
            "unsupported extension for video file: {}",
            path.display()
        ))
    })?;
    if !allowed_video_mime(mime) {
        return Err(ValidationError::MimeMismatch(format!(
            "MIME '{}' not in allowed list {:?}",
            mime, ALLOWED_VIDEO_MIMES
        )));
    }
    Ok(mime)
}

fn read_file_header(path: &Path, max: usize) -> Result<Vec<u8>, ValidationError> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| ValidationError::IoError(format!("open {}: {}", path.display(), e)))?;
    let mut buf = vec![0u8; max];
    let n = file
        .read(&mut buf)
        .map_err(|e| ValidationError::IoError(format!("read {}: {}", path.display(), e)))?;
    buf.truncate(n);
    if buf.is_empty() {
        return Err(ValidationError::EmptyFile);
    }
    Ok(buf)
}

fn run_ffprobe(path: &Path) -> Result<FfprobeOutput, ValidationError> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|e| ValidationError::FfprobeFailed(format!("ffprobe unavailable: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(ValidationError::FfprobeFailed(if stderr.is_empty() {
            "ffprobe exited with error".to_string()
        } else {
            stderr
        }));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout)
        .map_err(|e| ValidationError::FfprobeFailed(format!("ffprobe JSON parse error: {}", e)))
}

fn meta_from_ffprobe(probe: FfprobeOutput) -> Result<VideoMeta, ValidationError> {
    let streams = probe.streams.unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"))
        .ok_or(ValidationError::NoVideoStream)?;

    let codec = video
        .codec_name
        .clone()
        .filter(|c| !c.trim().is_empty())
        .ok_or(ValidationError::EmptyCodec)?;

    let duration = probe
        .format
        .and_then(|f| f.duration)
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);

    let has_audio = streams
        .iter()
        .any(|s| s.codec_type.as_deref() == Some("audio"));

    Ok(VideoMeta {
        codec,
        width: video.width.unwrap_or(0),
        height: video.height.unwrap_or(0),
        duration,
        has_audio,
    })
}

pub fn log_rejection(path: &Path, err: &ValidationError) {
    eprintln!(
        "rejecting file: reason={} detail=\"{}\" path={}",
        err.reason_code(),
        err.detail(),
        path.display()
    );
}

/// Move a rejected video into `public/videos/_rejected/` (never deleted).
pub fn quarantine_video(
    videos_dir: &Path,
    source: &Path,
    err: &ValidationError,
) -> Result<PathBuf, String> {
    log_rejection(source, err);

    if !source.is_file() {
        return Err(format!("quarantine source missing: {}", source.display()));
    }

    let rejected_dir = videos_dir.join("_rejected");
    std::fs::create_dir_all(&rejected_dir).map_err(|e| format!("create _rejected dir: {}", e))?;

    let basename = source
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid filename".to_string())?;

    let mut dest = rejected_dir.join(basename);
    if dest.exists() {
        let stamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        dest = rejected_dir.join(format!("{}_{}", stamp, basename));
    }

    std::fs::rename(source, &dest)
        .map_err(|e| format!("move {} -> {}: {}", source.display(), dest.display(), e))?;

    eprintln!(
        "quarantined file: from={} to={} reason={}",
        source.display(),
        dest.display(),
        err.reason_code()
    );

    Ok(dest)
}

/// Full validation of an on-disk video file.
pub fn validate_video_path(path: &Path) -> Result<VideoMeta, ValidationError> {
    validate_mime_for_path(path)?;

    let header = read_file_header(path, HTML_PROBE_LEN.max(512))?;

    if let Some(trigger) = detect_html_payload(&header) {
        return Err(ValidationError::HtmlPayloadDetected(format!(
            "HTML/error payload in header ({})",
            trigger
        )));
    }

    if !is_valid_video_container(&header) {
        return Err(ValidationError::FfprobeFailed(
            "missing MP4/MOV/WebM container header (ftyp or EBML)".to_string(),
        ));
    }

    let probe = run_ffprobe(path)?;
    meta_from_ffprobe(probe)
}

/// Validate in-memory bytes by writing a temp file and running ffprobe.
pub fn validate_video_bytes(bytes: &[u8], filename: &str) -> Result<VideoMeta, ValidationError> {
    if bytes.is_empty() {
        return Err(ValidationError::EmptyFile);
    }

    if let Some(trigger) = detect_html_payload(bytes) {
        return Err(ValidationError::HtmlPayloadDetected(format!(
            "HTML/error payload in upload ({})",
            trigger
        )));
    }

    if !is_valid_video_container(bytes) {
        return Err(ValidationError::FfprobeFailed(
            "missing MP4/MOV/WebM container header (ftyp or EBML)".to_string(),
        ));
    }

    let temp = std::env::temp_dir().join(format!("rf_validate_{}", filename));
    std::fs::write(&temp, bytes)
        .map_err(|e| ValidationError::IoError(format!("temp write failed: {}", e)))?;

    let result = validate_video_path(&temp);
    let _ = std::fs::remove_file(&temp);
    result
}

/// Returns true when the file passes full validation (ffprobe + MIME + HTML scan).
pub fn is_valid_video_file(path: &str) -> bool {
    is_valid_video_path(Path::new(path))
}

pub fn is_valid_video_path(path: &Path) -> bool {
    validate_video_path(path).is_ok()
}

/// Alias required by spec — returns metadata or structured error.
pub fn get_video_metadata(path: &str) -> Result<VideoMeta, ValidationError> {
    validate_video_path(Path::new(path))
}

/// Fast serve-time gate: HTML + container header only (no ffprobe per request).
pub fn passes_serve_time_gate(path: &Path) -> bool {
    match read_file_header(path, HTML_PROBE_LEN.max(512)) {
        Ok(header) => !is_html_or_text_disguise(&header) && is_valid_video_container(&header),
        Err(_) => false,
    }
}

/// Scan `videos_dir` for invalid loose files and quarantine them.
pub fn quarantine_invalid_loose_files(videos_dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(videos_dir) else {
        return 0;
    };

    let mut quarantined = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name.starts_with('.') {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lower_ext = ext.to_lowercase();
        if !["mp4", "mov", "m4v", "mkv", "webm"].contains(&lower_ext.as_str()) {
            continue;
        }

        match validate_video_path(&path) {
            Ok(_) => {}
            Err(err) => {
                if quarantine_video(videos_dir, &path, &err).is_ok() {
                    quarantined += 1;
                }
            }
        }
    }
    quarantined
}
