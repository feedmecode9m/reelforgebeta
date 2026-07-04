use crate::db::reels::ReelRow;
use crate::media_validator;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "webm", "m4v"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif"];
const HERO_BACKGROUND_NAME: &str = "hero-background.mp4";

pub fn is_video_file(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn is_valid_video_container(bytes: &[u8]) -> bool {
    media_validator::is_valid_video_container(bytes)
}

pub fn is_html_or_text_disguise(bytes: &[u8]) -> bool {
    media_validator::is_html_or_text_disguise(bytes)
}

pub fn is_valid_image_bytes(bytes: &[u8]) -> bool {
    if bytes.len() < 12 {
        return false;
    }

    if is_html_or_text_disguise(bytes) {
        return false;
    }

    // JPEG: SOI marker FF D8 FF
    if bytes.len() >= 3 && bytes[0..3] == [0xFF, 0xD8, 0xFF] {
        return true;
    }
    // PNG
    if bytes[0..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return true;
    }
    // GIF
    if bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a") {
        return true;
    }
    // WebP: RIFF....WEBP
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return true;
    }

    false
}

pub fn validate_video_with_ffprobe(path: &Path) -> Result<(), String> {
    media_validator::validate_video_path(path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn validate_video_bytes(bytes: &[u8], filename: &str) -> Result<(), String> {
    media_validator::validate_video_bytes(bytes, filename)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn diagnose_invalid_video(path: &Path) -> Option<String> {
    media_validator::validate_video_path(path)
        .err()
        .map(|e| e.to_string())
}

pub fn is_valid_video_file(path: &Path) -> bool {
    media_validator::is_valid_video_path(path)
}

pub fn is_image_file(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Reject auto-generated fake thumbs (e.g. video.mp4.jpg).
pub fn is_fake_generated_thumb(name: &str) -> bool {
    let lower = name.to_lowercase();
    for ext in ["mp4", "mov", "webm", "m4v"] {
        if lower.ends_with(&format!(".{ext}.jpg")) || lower.ends_with(&format!(".{ext}.jpeg")) {
            return true;
        }
    }
    false
}

/// Basename from `/thumbs/foo.jpg`, `foo.jpg`, or URL paths.
pub fn media_basename(url_or_name: &str) -> Option<String> {
    let trimmed = url_or_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed
        .split('/')
        .last()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

#[derive(Debug, Clone, Default)]
pub struct ReferencedMedia {
    pub thumbs: HashSet<String>,
    pub videos: HashSet<String>,
}

/// Filenames referenced by Postgres reel rows (file_name + thumbnail_url).
pub fn collect_referenced_media(reels: &[ReelRow]) -> ReferencedMedia {
    let mut out = ReferencedMedia::default();

    for reel in reels {
        if let Some(ref thumb) = reel.thumbnail_url {
            if let Some(name) = media_basename(thumb) {
                out.thumbs.insert(name);
            }
        }

        if !reel.file_name.is_empty() {
            if reel
                .video_url
                .as_deref()
                .map(|u| u.contains("/videos/"))
                .unwrap_or(true)
                || is_video_file(&reel.file_name)
            {
                out.videos.insert(reel.file_name.clone());
            }
        } else if let Some(ref video_url) = reel.video_url {
            if let Some(name) = media_basename(video_url) {
                if video_url.contains("/thumbs/") || is_image_file(&name) {
                    out.thumbs.insert(name);
                } else if video_url.contains("/videos/") || is_video_file(&name) {
                    out.videos.insert(name);
                }
            }
        }
    }

    out
}

/// Every file in a directory (includes fake `.mp4.jpg` and invalid videos).
pub fn list_all_directory_files(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            e.file_type()
                .ok()
                .filter(|t| t.is_file())
                .map(|_| e.file_name().to_string_lossy().to_string())
        })
        .collect();

    names.sort();
    names
}

#[derive(Debug, Clone, Serialize)]
pub struct OrphanMediaReport {
    pub dry_run: bool,
    pub orphan_thumbs: Vec<String>,
    pub orphan_videos: Vec<String>,
    pub fake_thumbs: Vec<String>,
    pub referenced_thumb_count: usize,
    pub referenced_video_count: usize,
    pub deleted_thumbs: Vec<String>,
    pub deleted_videos: Vec<String>,
    pub deleted_count: usize,
    pub errors: Vec<String>,
}

pub fn scan_orphan_media(
    videos_path: &Path,
    thumbs_path: &Path,
    reels: &[ReelRow],
) -> OrphanMediaReport {
    let referenced = collect_referenced_media(reels);
    let referenced_thumb_count = referenced.thumbs.len();
    let referenced_video_count = referenced.videos.len();

    let mut fake_thumbs = Vec::new();
    let mut orphan_thumbs = Vec::new();
    let mut orphan_videos = Vec::new();

    for name in list_all_directory_files(thumbs_path) {
        if is_fake_generated_thumb(&name) {
            fake_thumbs.push(name);
            continue;
        }
        if is_image_file(&name) && !referenced.thumbs.contains(&name) {
            orphan_thumbs.push(name);
        }
    }

    for name in list_all_directory_files(videos_path) {
        if !is_video_file(&name) {
            continue;
        }
        if name.eq_ignore_ascii_case(HERO_BACKGROUND_NAME) {
            continue;
        }
        if !referenced.videos.contains(&name) {
            orphan_videos.push(name);
        }
    }

    fake_thumbs.sort();
    orphan_thumbs.sort();
    orphan_videos.sort();

    OrphanMediaReport {
        dry_run: true,
        orphan_thumbs,
        orphan_videos,
        fake_thumbs,
        referenced_thumb_count,
        referenced_video_count,
        deleted_thumbs: Vec::new(),
        deleted_videos: Vec::new(),
        deleted_count: 0,
        errors: Vec::new(),
    }
}

pub fn delete_orphan_media(
    videos_path: &Path,
    thumbs_path: &Path,
    reels: &[ReelRow],
) -> OrphanMediaReport {
    let mut report = scan_orphan_media(videos_path, thumbs_path, reels);
    report.dry_run = false;

    for name in report.fake_thumbs.iter().chain(report.orphan_thumbs.iter()) {
        let path: PathBuf = thumbs_path.join(name);
        match std::fs::remove_file(&path) {
            Ok(()) => report.deleted_thumbs.push(name.clone()),
            Err(e) => report.errors.push(format!("thumb {}: {}", name, e)),
        }
    }

    for name in &report.orphan_videos {
        let path: PathBuf = videos_path.join(name);
        match std::fs::remove_file(&path) {
            Ok(()) => report.deleted_videos.push(name.clone()),
            Err(e) => report.errors.push(format!("video {}: {}", name, e)),
        }
    }

    report.deleted_count = report.deleted_thumbs.len() + report.deleted_videos.len();
    report
}

pub fn list_media_files(dir: &Path, kind: &str) -> Vec<String> {
    let mut names = Vec::new();

    let Ok(entries) = std::fs::read_dir(dir) else {
        eprintln!("⚠️ Cannot read {} directory: {:?}", kind, dir);
        return names;
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_match = match kind {
            "videos" => is_video_file(&name),
            "thumbs" => is_image_file(&name),
            _ => false,
        };

        if is_match {
            if kind == "videos" && !is_valid_video_file(&entry.path()) {
                eprintln!("⚠️ Skipping invalid video file (bad container): {}", name);
                continue;
            }
            if kind == "thumbs" && is_fake_generated_thumb(&name) {
                eprintln!("⚠️ Skipping fake generated thumb: {}", name);
                continue;
            }
            names.push(name);
        }
    }

    names.sort();
    names
}

pub fn log_asset_inventory(videos_path: &Path, thumbs_path: &Path) {
    let videos = list_media_files(videos_path, "videos");
    let thumbs = list_media_files(thumbs_path, "thumbs");
    println!(
        "📊 Asset inventory: Found {} videos in public/videos/, {} thumbs in public/thumbs/",
        videos.len(),
        thumbs.len()
    );
}

pub fn scan_invalid_videos(videos_path: &Path) -> Vec<(String, String)> {
    let mut invalid = Vec::new();

    let Ok(entries) = std::fs::read_dir(videos_path) else {
        return invalid;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_video_file(&name) {
            continue;
        }
        if let Some(reason) = diagnose_invalid_video(&path) {
            invalid.push((name, reason));
        }
    }

    invalid
}
