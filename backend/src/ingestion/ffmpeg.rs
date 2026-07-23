use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

const FFMPEG_TIMEOUT: Duration = Duration::from_secs(30);

/// Extract a JPEG thumbnail at t=1s. Fail-fast on invalid media.
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
    if thumb_path.exists() {
        let _ = std::fs::remove_file(thumb_path);
    }

    let output = timeout(
        FFMPEG_TIMEOUT,
        Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i"])
            .arg(video_path)
            .args(["-frames:v", "1", "-q:v", "2"])
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
        crate::pipeline_diag::pipeline_diag(
            "FFMPEG",
            "extract_thumbnail_at_1s",
            "ffmpeg.rs",
            None,
            Some(video_name),
            "failed",
        );
        return Err(format!("ffmpeg failed: {}", stderr.trim()));
    }

    if !thumb_path.is_file() {
        crate::pipeline_diag::pipeline_diag(
            "FFMPEG",
            "extract_thumbnail_at_1s",
            "ffmpeg.rs",
            None,
            Some(video_name),
            "no_output_file",
        );
        return Err("ffmpeg produced no output file".to_string());
    }

    let bytes = std::fs::read(thumb_path).map_err(|e| e.to_string())?;
    if !crate::media_seed::is_valid_image_bytes(&bytes) {
        let _ = std::fs::remove_file(thumb_path);
        crate::pipeline_diag::pipeline_diag(
            "FFMPEG",
            "extract_thumbnail_at_1s",
            "ffmpeg.rs",
            None,
            Some(video_name),
            "invalid_output_bytes",
        );
        return Err("thumbnail output is not a valid JPEG/PNG".to_string());
    }

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
    if thumb_path.exists() {
        let _ = std::fs::remove_file(thumb_path);
    }

    let output = timeout(
        FFMPEG_TIMEOUT,
        Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i"])
            .arg(video_url)
            .args(["-frames:v", "1", "-q:v", "2"])
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
        return Err(format!("ffmpeg failed: {}", stderr.trim()));
    }

    if !thumb_path.is_file() {
        return Err("ffmpeg produced no output file".to_string());
    }

    let bytes = std::fs::read(thumb_path).map_err(|e| e.to_string())?;
    if !crate::media_seed::is_valid_image_bytes(&bytes) {
        let _ = std::fs::remove_file(thumb_path);
        return Err("thumbnail output is not a valid JPEG/PNG".to_string());
    }

    Ok(())
}
