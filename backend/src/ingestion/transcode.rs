//! Playback derivative encode (Phase 1).
//! Single profile: H.264 + AAC, yuv420p, faststart, ~720p / 2–4 Mbps.
//! Transcode failure must never fail the reel (catalog still uses master `video_url`).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::process::Command;
use tokio::time::timeout;

/// Encode budget for large progressive masters (e.g. 15 Mbps / 300MB+).
const TRANSCODE_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Stable profile id written to `reels.playback_profile`.
pub const PLAYBACK_PROFILE_WEB_720P_H264: &str = "web_720p_h264";

/// Stored object basename: `{reelId}.playback.mp4`
pub fn playback_file_name(reel_id: &uuid::Uuid) -> String {
    format!("{}.playback.mp4", reel_id)
}

/// Relative app path for local / proxied serve.
pub fn playback_relative_url(reel_id: &uuid::Uuid) -> String {
    format!("/videos/{}", playback_file_name(reel_id))
}

/// Feature flag — default ON. Set `PLAYBACK_TRANSCODE=0|false` to skip encode (rollback).
pub fn playback_transcode_enabled() -> bool {
    match std::env::var("PLAYBACK_TRANSCODE") {
        Ok(v) => {
            let t = v.trim();
            !(t == "0" || t.eq_ignore_ascii_case("false") || t.eq_ignore_ascii_case("off") || t.eq_ignore_ascii_case("no"))
        }
        Err(_) => true,
    }
}

#[derive(Debug, Clone)]
pub struct PlaybackDerivativeResult {
    pub playback_file_name: String,
    pub playback_relative_url: String,
    pub playback_file_size: i64,
    pub playback_profile: String,
    pub source_bytes: i64,
    pub encode_ms: u128,
    pub compression_ratio: f64,
}

#[derive(Debug)]
pub enum PlaybackDerivativeError {
    Disabled,
    MissingInput(String),
    Ffmpeg(String),
    Io(String),
}

impl std::fmt::Display for PlaybackDerivativeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlaybackDerivativeError::Disabled => write!(f, "playback_transcode_disabled"),
            PlaybackDerivativeError::MissingInput(s) => write!(f, "missing_input: {}", s),
            PlaybackDerivativeError::Ffmpeg(s) => write!(f, "ffmpeg: {}", s),
            PlaybackDerivativeError::Io(s) => write!(f, "io: {}", s),
        }
    }
}

/// Encode `input` → `output` (local paths). Caller uploads when R2 is enabled.
pub async fn encode_web_playback_derivative(
    input: &Path,
    output: &Path,
    source_bytes_hint: Option<i64>,
) -> Result<PlaybackDerivativeResult, PlaybackDerivativeError> {
    if !playback_transcode_enabled() {
        return Err(PlaybackDerivativeError::Disabled);
    }
    if !input.is_file() {
        return Err(PlaybackDerivativeError::MissingInput(input.display().to_string()));
    }

    let source_bytes = source_bytes_hint.unwrap_or_else(|| {
        std::fs::metadata(input)
            .map(|m| m.len() as i64)
            .unwrap_or(0)
    });

    if let Some(parent) = output.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if output.exists() {
        let _ = std::fs::remove_file(output);
    }

    eprintln!(
        "[PLAYBACK_TRANSCODE] start input={} source_bytes={} output={}",
        input.display(),
        source_bytes,
        output.display()
    );
    let started = Instant::now();

    // Vertical-safe scale: long edge ≤ 1280, keep aspect, even dims for H.264.
    // Cap encode bitrate near 2–4 Mbps (CRF 23 + maxrate 4M).
    let scale_filter =
        "scale=w='if(gt(iw,ih),min(1280,iw),-2)':h='if(gt(ih,iw),min(1280,ih),-2)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2";

    let output_arg = output.as_os_str().to_owned();
    let input_arg = input.as_os_str().to_owned();

    let run = timeout(
        TRANSCODE_TIMEOUT,
        Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(&input_arg)
            .args([
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-profile:v",
                "main",
                "-level",
                "4.0",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "23",
                "-maxrate",
                "4M",
                "-bufsize",
                "8M",
                "-vf",
                scale_filter,
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-ac",
                "2",
                "-movflags",
                "+faststart",
            ])
            .arg(&output_arg)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;

    let encode_ms = started.elapsed().as_millis();

    let output_result = match run {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            let msg = format!("spawn failed: {}", e);
            eprintln!(
                "[PLAYBACK_TRANSCODE] failed encode_ms={} err={}",
                encode_ms, msg
            );
            return Err(PlaybackDerivativeError::Ffmpeg(msg));
        }
        Err(_) => {
            let msg = format!("timed out after {}s", TRANSCODE_TIMEOUT.as_secs());
            eprintln!(
                "[PLAYBACK_TRANSCODE] failed encode_ms={} err={}",
                encode_ms, msg
            );
            let _ = std::fs::remove_file(output);
            return Err(PlaybackDerivativeError::Ffmpeg(msg));
        }
    };

    if !output_result.status.success() {
        let stderr = String::from_utf8_lossy(&output_result.stderr);
        let msg = stderr.trim().to_string();
        eprintln!(
            "[PLAYBACK_TRANSCODE] failed encode_ms={} ffmpeg_stderr={}",
            encode_ms,
            if msg.is_empty() { "(empty)" } else { &msg }
        );
        let _ = std::fs::remove_file(output);
        return Err(PlaybackDerivativeError::Ffmpeg(if msg.is_empty() {
            "ffmpeg exited non-zero".to_string()
        } else {
            msg
        }));
    }

    if !output.is_file() {
        eprintln!(
            "[PLAYBACK_TRANSCODE] failed encode_ms={} err=no output file",
            encode_ms
        );
        return Err(PlaybackDerivativeError::Io(
            "ffmpeg produced no output file".to_string(),
        ));
    }

    let playback_file_size = std::fs::metadata(output)
        .map(|m| m.len() as i64)
        .map_err(|e| PlaybackDerivativeError::Io(e.to_string()))?;

    if playback_file_size < 1024 {
        let _ = std::fs::remove_file(output);
        eprintln!(
            "[PLAYBACK_TRANSCODE] failed encode_ms={} err=output_too_small size={}",
            encode_ms, playback_file_size
        );
        return Err(PlaybackDerivativeError::Io(format!(
            "playback output too small ({} bytes)",
            playback_file_size
        )));
    }

    let compression_ratio = if playback_file_size > 0 && source_bytes > 0 {
        source_bytes as f64 / playback_file_size as f64
    } else {
        0.0
    };

    eprintln!(
        "[PLAYBACK_TRANSCODE] ok encode_ms={} source_bytes={} derivative_bytes={} compression_ratio={:.2}x profile={}",
        encode_ms,
        source_bytes,
        playback_file_size,
        compression_ratio,
        PLAYBACK_PROFILE_WEB_720P_H264
    );

    let file_name = output
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown.playback.mp4")
        .to_string();

    Ok(PlaybackDerivativeResult {
        playback_file_name: file_name,
        playback_relative_url: format!(
            "/videos/{}",
            output
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("playback.mp4")
        ),
        playback_file_size,
        playback_profile: PLAYBACK_PROFILE_WEB_720P_H264.to_string(),
        source_bytes,
        encode_ms,
        compression_ratio,
    })
}

/// Local destination path for a reel's derivative under the videos directory.
pub fn local_playback_path(videos_dir: &Path, reel_id: &uuid::Uuid) -> PathBuf {
    videos_dir.join(playback_file_name(reel_id))
}
