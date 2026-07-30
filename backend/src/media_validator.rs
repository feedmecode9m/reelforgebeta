use std::io::{Read, Seek, SeekFrom};
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
    SizeMismatch { expected: i64, actual: i64 },
    TruncatedContainer(String),
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
            ValidationError::SizeMismatch { .. } => "size_mismatch",
            ValidationError::TruncatedContainer(_) => "truncated_container",
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
            ValidationError::SizeMismatch { expected, actual } => {
                format!("expected {} bytes, stored {} bytes", expected, actual)
            }
            ValidationError::TruncatedContainer(s) => s.clone(),
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
    size: Option<String>,
}

/// Hard gate: declared upload size must equal bytes on disk/object store.
pub fn verify_upload_size_integrity(expected: i64, actual: i64) -> Result<(), ValidationError> {
    if expected <= 0 {
        return Err(ValidationError::SizeMismatch { expected, actual });
    }
    if actual <= 0 {
        return Err(ValidationError::SizeMismatch { expected, actual });
    }
    if expected != actual {
        return Err(ValidationError::SizeMismatch { expected, actual });
    }
    Ok(())
}

fn atom_tag_label(tag: &[u8; 4]) -> String {
    String::from_utf8_lossy(tag).trim().to_string()
}

/// Walk ISO-BMFF top-level atoms and reject containers whose boxes extend past EOF.
pub fn verify_mp4_atom_bounds(path: &Path) -> Result<(), ValidationError> {
    let file_size = std::fs::metadata(path)
        .map_err(|e| ValidationError::IoError(format!("metadata {}: {}", path.display(), e)))?
        .len();
    if file_size < 8 {
        return Err(ValidationError::EmptyFile);
    }

    let mut file = std::fs::File::open(path)
        .map_err(|e| ValidationError::IoError(format!("open {}: {}", path.display(), e)))?;
    let mut offset: u64 = 0;

    while offset + 8 <= file_size {
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| ValidationError::IoError(format!("seek {}: {}", path.display(), e)))?;
        let mut hdr = [0u8; 8];
        file.read_exact(&mut hdr)
            .map_err(|e| ValidationError::IoError(format!("read {}: {}", path.display(), e)))?;

        let size32 = u32::from_be_bytes(hdr[0..4].try_into().unwrap()) as u64;
        let tag = [hdr[4], hdr[5], hdr[6], hdr[7]];

        let (header_size, box_size) = if size32 == 0 {
            (8u64, file_size - offset)
        } else if size32 == 1 {
            let mut ext = [0u8; 8];
            file.read_exact(&mut ext)
                .map_err(|e| ValidationError::IoError(format!("read ext {}: {}", path.display(), e)))?;
            (16u64, u64::from_be_bytes(ext))
        } else {
            (8u64, size32)
        };

        if box_size < header_size {
            return Err(ValidationError::TruncatedContainer(format!(
                "atom {} at offset {} declares size {} < header {}",
                atom_tag_label(&tag),
                offset,
                box_size,
                header_size
            )));
        }

        let end = offset.saturating_add(box_size);
        if end > file_size {
            return Err(ValidationError::TruncatedContainer(format!(
                "atom {} at offset {} extends to {} but file is {} bytes",
                atom_tag_label(&tag),
                offset,
                end,
                file_size
            )));
        }

        offset = end;
    }

    Ok(())
}

fn verify_ffprobe_size_matches(path: &Path, probe: &FfprobeOutput) -> Result<(), ValidationError> {
    let actual = std::fs::metadata(path)
        .map_err(|e| ValidationError::IoError(format!("metadata {}: {}", path.display(), e)))?
        .len() as i64;
    let Some(raw) = probe.format.as_ref().and_then(|f| f.size.as_ref()) else {
        return Ok(());
    };
    let parsed = raw
        .trim()
        .parse::<i64>()
        .map_err(|e| ValidationError::FfprobeFailed(format!("invalid format.size '{}': {}", raw, e)))?;
    if parsed > 0 && parsed != actual {
        return Err(ValidationError::TruncatedContainer(format!(
            "ffprobe format.size={} but file is {} bytes",
            parsed, actual
        )));
    }
    Ok(())
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
    if is_quicktime_atom(&bytes[4..8]) {
        return true;
    }
    if bytes.len() >= 4 && &bytes[0..4] == b"\x1a\x45\xdf\xa3" {
        return true;
    }
    false
}

fn is_quicktime_atom(tag: &[u8]) -> bool {
    matches!(
        tag,
        b"moov" | b"mdat" | b"wide" | b"free" | b"skip" | b"pnot" | b"PICT"
    )
}

pub fn mime_for_video_path(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())?;
    match ext.as_str() {
        "mp4" | "m4v" => Some("video/mp4"),
        "mov" => Some("video/quicktime"),
        "mkv" => Some("video/x-matroska"),
        "webm" => Some("video/webm"),
        // Legacy ingest temp names used `.ingest.partial` (no video ext) — recover from
        // the preceding stem segment when possible (e.g. `uuid.ingest.mp4` already ok).
        "partial" => {
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if stem.ends_with(".mp4") || stem.ends_with(".m4v") {
                Some("video/mp4")
            } else if stem.ends_with(".mov") {
                Some("video/quicktime")
            } else if stem.ends_with(".mkv") {
                Some("video/x-matroska")
            } else if stem.ends_with(".webm") {
                Some("video/webm")
            } else {
                // Unknown temp — assume MP4/MOV container (header + ffprobe still gate).
                Some("video/mp4")
            }
        }
        _ => None,
    }
}

pub fn allowed_video_mime(mime: &str) -> bool {
    ALLOWED_VIDEO_MIMES.contains(&mime)
}

fn validate_mime_for_path(path: &Path) -> Result<&'static str, ValidationError> {
    let mime = mime_for_video_path(path).ok_or_else(|| {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("(none)");
        ValidationError::MimeMismatch(format!(
            "unsupported extension '{}' for video file: {}",
            ext,
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
            "format=duration,size",
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
    let mime = validate_mime_for_path(path)?;

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

    if mime == "video/mp4" || mime == "video/quicktime" {
        verify_mp4_atom_bounds(path)?;
    }

    let probe = run_ffprobe(path)?;
    verify_ffprobe_size_matches(path, &probe)?;
    meta_from_ffprobe(probe)
}

/// Full validation with an optional declared upload size gate.
pub fn validate_video_path_with_expected_size(
    path: &Path,
    expected_size: Option<i64>,
) -> Result<VideoMeta, ValidationError> {
    if let Some(expected) = expected_size {
        let actual = std::fs::metadata(path)
            .map_err(|e| ValidationError::IoError(format!("metadata {}: {}", path.display(), e)))?
            .len() as i64;
        verify_upload_size_integrity(expected, actual)?;
    }
    validate_video_path(path)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn atom_box(tag: &[u8; 4], payload_len: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(8 + payload_len);
        out.extend_from_slice(&((8 + payload_len) as u32).to_be_bytes());
        out.extend_from_slice(tag);
        out.extend_from_slice(&vec![0u8; payload_len]);
        out
    }

    #[test]
    fn accepts_mp4_ftyp_container_header() {
        let mut bytes = atom_box(b"ftyp", 8);
        bytes[8..12].copy_from_slice(b"isom");
        assert!(is_valid_video_container(&bytes));
    }

    #[test]
    fn accepts_quicktime_moov_container_header() {
        let bytes = atom_box(b"moov", 16);
        assert!(is_valid_video_container(&bytes));
    }

    #[test]
    fn accepts_quicktime_mdat_container_header() {
        let bytes = atom_box(b"mdat", 16);
        assert!(is_valid_video_container(&bytes));
    }

    #[test]
    fn rejects_html_disguised_payload() {
        assert!(!is_valid_video_container(b"<!doctype html><html>".as_slice()));
    }

    #[test]
    fn rejects_truncated_mp4_atom_extends_past_eof() {
        // ftyp (24 bytes) + mdat declaring 1_000_000 bytes but only 100 payload bytes written.
        let mut bytes = atom_box(b"ftyp", 16);
        bytes[8..12].copy_from_slice(b"isom");
        let payload = 100usize;
        let declared = 1_000_000u32; // atom claims 1MB total box size
        let mut mdat = Vec::with_capacity(8 + payload);
        mdat.extend_from_slice(&declared.to_be_bytes());
        mdat.extend_from_slice(b"mdat");
        mdat.extend_from_slice(&vec![0u8; payload]);
        bytes.extend_from_slice(&mdat);

        let temp = std::env::temp_dir().join(format!("rf_trunc_test_{}.mp4", uuid_placeholder()));
        std::fs::write(&temp, &bytes).unwrap();
        let err = verify_mp4_atom_bounds(&temp).unwrap_err();
        let _ = std::fs::remove_file(&temp);
        assert!(matches!(err, ValidationError::TruncatedContainer(_)));
    }

    fn uuid_placeholder() -> String {
        format!(
            "{:x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    #[test]
    fn rejects_upload_size_mismatch() {
        let err = verify_upload_size_integrity(362_000_000, 5_242_880).unwrap_err();
        assert!(matches!(err, ValidationError::SizeMismatch { .. }));
        assert_eq!(err.reason_code(), "size_mismatch");
    }

    #[test]
    fn accepts_matching_upload_size() {
        assert!(verify_upload_size_integrity(5_242_880, 5_242_880).is_ok());
    }

    #[test]
    fn mime_for_mov_is_quicktime() {
        assert_eq!(mime_for_video_path(std::path::Path::new("MICROS.MOV")), Some("video/quicktime"));
        assert_eq!(mime_for_video_path(std::path::Path::new("clip.mp4")), Some("video/mp4"));
    }

    #[test]
    fn mime_for_ingest_temp_paths() {
        // Fixed worker naming: `{uuid}.ingest.mp4`
        assert_eq!(
            mime_for_video_path(std::path::Path::new("/videos/abc.ingest.mp4")),
            Some("video/mp4")
        );
        assert_eq!(
            mime_for_video_path(std::path::Path::new("/videos/abc.ingest.mov")),
            Some("video/quicktime")
        );
        // Legacy `{uuid}.ingest.partial` must not hard-fail mime lookup
        assert_eq!(
            mime_for_video_path(std::path::Path::new("/videos/abc.ingest.partial")),
            Some("video/mp4")
        );
    }
}
