use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

const FFMPEG_TIMEOUT: Duration = Duration::from_secs(30);

/// Seek points for thumbnail extraction.
/// Prefer a later frame (avoids black/title cards), then earlier fallbacks
/// for sub-second / 1s test fixtures.
const SEEK_CANDIDATES: &[&str] = &["1", "2", "0.5", "3", "0"];

/// Extract one JPEG frame from `input` (path or URL) into `thumb_path`.
///
/// Railway ships a newer ffmpeg that rejects limited-range YUV for MJPEG unless
/// `-strict unofficial` and a full-range pixel format are set. Without that,
/// ingest marks every vault upload `failed` after a successful POST /api/reels —
/// which surfaces in production as "all vaults broken" while local (older ffmpeg)
/// still succeeds.
async fn extract_jpeg_frame(input: &OsStr, thumb_path: &Path) -> Result<(), String> {
    if thumb_path.exists() {
        let _ = std::fs::remove_file(thumb_path);
    }

    let mut last_err = String::from("ffmpeg produced no output file");
    let mut fallback: Option<Vec<u8>> = None;

    for ss in SEEK_CANDIDATES {
        if thumb_path.exists() {
            let _ = std::fs::remove_file(thumb_path);
        }

        let output = timeout(
            FFMPEG_TIMEOUT,
            Command::new("ffmpeg")
                .args(["-hide_banner", "-loglevel", "error", "-y", "-ss", ss, "-i"])
                .arg(input)
                .args([
                    "-frames:v",
                    "1",
                    "-q:v",
                    "2",
                    // Full-range JPEG pixel format + relax MJPEG color-range strictness
                    // (ffmpeg 7+ / Railway). Harmless on older local ffmpeg builds.
                    "-pix_fmt",
                    "yuvj420p",
                    "-strict",
                    "unofficial",
                ])
                .arg(thumb_path)
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output(),
        )
        .await
        .map_err(|_| "ffmpeg timed out after 30s".to_string())?
        .map_err(|e| format!("ffmpeg spawn failed: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            last_err = format!("ffmpeg failed: {}", stderr.trim());
            continue;
        }

        if !thumb_path.is_file() {
            last_err = "ffmpeg produced no output file".to_string();
            continue;
        }

        let bytes = std::fs::read(thumb_path).map_err(|e| e.to_string())?;
        if !crate::media_seed::is_valid_image_bytes(&bytes) {
            let _ = std::fs::remove_file(thumb_path);
            last_err = "thumbnail output is not a valid JPEG/PNG".to_string();
            continue;
        }

        if crate::thumbnail_integrity::is_usable_poster(&bytes) {
            return Ok(());
        }

        fallback = Some(bytes);
        last_err = "ffmpeg frame is below poster quality threshold".to_string();
    }

    if let Some(bytes) = fallback {
        if let Some(parent) = thumb_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(thumb_path, bytes).map_err(|e| e.to_string())?;
        return Ok(());
    }

    Err(last_err)
}

/// Extract a JPEG thumbnail at t=1s (falls back to t=0). Fail-fast on invalid media.
pub async fn extract_thumbnail_at_1s(video_path: &Path, thumb_path: &Path) -> Result<(), String> {
    let video_name = video_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("-");
    crate::pipeline_diag::pipeline_diag(
        "FFMPEG",
        "extract_thumbnail_at_1s",
        "ffmpeg.rs",
        None,
        Some(video_name),
        "start",
    );

    match extract_jpeg_frame(video_path.as_os_str(), thumb_path).await {
        Ok(()) => {
            crate::pipeline_diag::pipeline_diag(
                "FFMPEG",
                "extract_thumbnail_at_1s",
                "ffmpeg.rs",
                None,
                Some(video_name),
                "ok",
            );
            Ok(())
        }
        Err(err) => {
            crate::pipeline_diag::pipeline_diag(
                "FFMPEG",
                "extract_thumbnail_at_1s",
                "ffmpeg.rs",
                None,
                Some(video_name),
                "failed",
            );
            Err(err)
        }
    }
}

/// Extract a JPEG thumbnail at t=1s from a remote HTTP(S) video URL (R2 public object).
pub async fn extract_thumbnail_from_url(video_url: &str, thumb_path: &Path) -> Result<(), String> {
    crate::pipeline_diag::pipeline_diag(
        "FFMPEG",
        "extract_thumbnail_from_url",
        "ffmpeg.rs",
        None,
        Some(video_url),
        "start",
    );
    extract_jpeg_frame(OsStr::new(video_url), thumb_path).await
}
