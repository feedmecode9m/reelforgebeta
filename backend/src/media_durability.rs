//! Production media durability guardrails (BG-5J).
//! Operational checks only — no changes to upload, ingestion, or schema.

use crate::db::reels::ReelRow;
use crate::media_seed;
use serde::Serialize;
use sqlx::{Pool, Postgres};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Aggregate storage health states exposed via `/health`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageStatus {
    Ready,
    Mounted,
    ReadOnly,
    Missing,
    Unwritable,
    Degraded,
}

impl StorageStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Mounted => "mounted",
            Self::ReadOnly => "read_only",
            Self::Missing => "missing",
            Self::Unwritable => "unwritable",
            Self::Degraded => "degraded",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DirectoryProbe {
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub readable: bool,
    pub writable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageDiagnostics {
    pub status: String,
    pub media_root: String,
    pub videos_path: String,
    pub thumbs_path: String,
    pub media_public_base: String,
    pub volume_mounted: bool,
    pub ephemeral_storage_risk: bool,
    pub writable: bool,
    pub filesystem_video_count: usize,
    pub filesystem_thumb_count: usize,
    pub directories: Vec<DirectoryProbe>,
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageInventoryReport {
    pub db_video_count: usize,
    pub db_thumb_count: usize,
    pub filesystem_video_count: usize,
    pub filesystem_thumb_count: usize,
    pub missing_videos: Vec<String>,
    pub missing_thumbs: Vec<String>,
    pub orphan_videos: Vec<String>,
    pub orphan_thumbs: Vec<String>,
    pub split_brain: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SplitBrainReport {
    pub checked_at: i64,
    pub db_video_count: usize,
    pub db_thumb_count: usize,
    pub filesystem_video_count: usize,
    pub filesystem_thumb_count: usize,
    pub db_videos_missing_files: Vec<String>,
    pub db_thumbs_missing_files: Vec<String>,
    pub orphan_videos: Vec<String>,
    pub orphan_thumbs: Vec<String>,
    pub video_mismatches: usize,
    pub thumb_mismatches: usize,
    pub split_brain_detected: bool,
    pub storage: StorageDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartupStorageReport {
    pub diagnostics: StorageDiagnostics,
    pub split_brain: Option<SplitBrainReport>,
    pub startup_safe: bool,
    pub warnings: Vec<String>,
}

pub fn media_public_base() -> String {
    std::env::var("MEDIA_PUBLIC_BASE").unwrap_or_else(|_| {
        let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
        format!("http://localhost:{}", port)
    })
}

pub fn resolve_media_paths() -> (PathBuf, PathBuf, PathBuf) {
    let public_root = PathBuf::from("./public");
    let videos = public_root.join("videos");
    let thumbs = public_root.join("thumbs");
    (public_root, videos, thumbs)
}

fn path_display(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .display()
        .to_string()
}

fn is_production_deployed() -> bool {
    let env = std::env::var("REELFORGE_ENV")
        .or_else(|_| std::env::var("RUST_ENV"))
        .unwrap_or_default();
    if matches!(env.as_str(), "production" | "prod") {
        return true;
    }
    std::env::var("RAILWAY_ENVIRONMENT").is_ok() || std::env::var("RENDER").is_ok()
}

/// True when `path` sits on a mount point other than the container root (persistent volume signal).
pub fn is_path_on_separate_mount(path: &Path) -> bool {
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };

    let Ok(mounts) = std::fs::read_to_string("/proc/mounts") else {
        return false;
    };

    let mut best_match: Option<(usize, String)> = None;
    for line in mounts.lines() {
        let Some((_, mount_point, _)) = parse_mount_line(line) else {
            continue;
        };
        if canonical.starts_with(mount_point) {
            let len = mount_point.as_os_str().len();
            if best_match.as_ref().map(|(l, _)| len > *l).unwrap_or(true) {
                best_match = Some((
                    len,
                    mount_point.to_string_lossy().into_owned(),
                ));
            }
        }
    }

    match best_match {
        Some((_, ref mount)) if mount == "/" => false,
        Some((_, ref mount)) if mount == "/app/public" || mount.starts_with("/app/public/") => {
            true
        }
        Some((_, ref mount)) if mount != "/app" => true,
        _ => false,
    }
}

fn parse_mount_line(line: &str) -> Option<(&str, &Path, &str)> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    Some((parts[0], Path::new(parts[1]), parts[2]))
}

pub fn probe_directory(label: &str, path: &Path) -> DirectoryProbe {
    let display = path_display(path);
    let exists = path.exists();
    let is_dir = exists && path.is_dir();

    if !exists {
        return DirectoryProbe {
            label: label.to_string(),
            path: display,
            exists: false,
            readable: false,
            writable: false,
            error: Some("directory missing".to_string()),
        };
    }

    if !is_dir {
        return DirectoryProbe {
            label: label.to_string(),
            path: display,
            exists: true,
            readable: false,
            writable: false,
            error: Some("path exists but is not a directory".to_string()),
        };
    }

    let readable = std::fs::read_dir(path).is_ok();
    let writable = probe_writable(path);

    DirectoryProbe {
        label: label.to_string(),
        path: display,
        exists: true,
        readable,
        writable,
        error: if !readable {
            Some("directory not readable".to_string())
        } else if !writable {
            Some("directory not writable".to_string())
        } else {
            None
        },
    }
}

fn probe_writable(dir: &Path) -> bool {
    let probe_name = format!(".storage_probe_{}", uuid::Uuid::new_v4());
    let probe_path = dir.join(&probe_name);
    match std::fs::write(&probe_path, b"probe") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe_path);
            true
        }
        Err(_) => false,
    }
}

fn aggregate_status(probes: &[DirectoryProbe], volume_mounted: bool) -> StorageStatus {
    if probes.iter().any(|p| !p.exists) {
        return StorageStatus::Missing;
    }
    if probes.iter().any(|p| p.exists && !p.readable) {
        return StorageStatus::Degraded;
    }
    let all_writable = probes.iter().all(|p| p.writable);
    if !all_writable {
        if probes.iter().any(|p| p.readable && !p.writable) {
            return StorageStatus::ReadOnly;
        }
        return StorageStatus::Unwritable;
    }
    if is_production_deployed() && !volume_mounted {
        StorageStatus::Mounted
    } else {
        StorageStatus::Ready
    }
}

pub fn build_storage_diagnostics(
    public_root: &Path,
    videos_path: &Path,
    thumbs_path: &Path,
) -> StorageDiagnostics {
    let probes = [
        probe_directory("media_root", public_root),
        probe_directory("videos", videos_path),
        probe_directory("thumbs", thumbs_path),
    ];

    let volume_mounted = is_path_on_separate_mount(public_root);
    let ephemeral_storage_risk = is_production_deployed() && !volume_mounted;
    let status = aggregate_status(&probes, volume_mounted);
    let writable = probes.iter().all(|p| p.writable);
    let fs_videos = media_seed::list_media_files(videos_path, "videos");
    let fs_thumbs = media_seed::list_media_files(thumbs_path, "thumbs");

    StorageDiagnostics {
        status: status.as_str().to_string(),
        media_root: path_display(public_root),
        videos_path: path_display(videos_path),
        thumbs_path: path_display(thumbs_path),
        media_public_base: media_public_base(),
        volume_mounted,
        ephemeral_storage_risk,
        writable,
        filesystem_video_count: fs_videos.len(),
        filesystem_thumb_count: fs_thumbs.len(),
        directories: probes.to_vec(),
    }
}

pub fn compare_db_filesystem(
    db_videos: &[String],
    db_thumbs: &[String],
    videos_path: &Path,
    thumbs_path: &Path,
    storage: StorageDiagnostics,
) -> SplitBrainReport {
    let fs_videos: HashSet<String> = media_seed::list_media_files(videos_path, "videos")
        .into_iter()
        .collect();
    let fs_thumbs: HashSet<String> = media_seed::list_media_files(thumbs_path, "thumbs")
        .into_iter()
        .collect();

    let db_video_set: HashSet<String> = db_videos.iter().cloned().collect();
    let db_thumb_set: HashSet<String> = db_thumbs.iter().cloned().collect();

    let mut db_videos_missing_files: Vec<String> = db_video_set
        .iter()
        .filter(|name| !fs_videos.contains(*name))
        .cloned()
        .collect();
    db_videos_missing_files.sort();

    let mut db_thumbs_missing_files: Vec<String> = db_thumb_set
        .iter()
        .filter(|name| !fs_thumbs.contains(*name))
        .cloned()
        .collect();
    db_thumbs_missing_files.sort();

    let mut orphan_videos: Vec<String> = fs_videos
        .iter()
        .filter(|name| !db_video_set.contains(*name))
        .cloned()
        .collect();
    orphan_videos.sort();

    let mut orphan_thumbs: Vec<String> = fs_thumbs
        .iter()
        .filter(|name| !db_thumb_set.contains(*name))
        .cloned()
        .collect();
    orphan_thumbs.sort();

    let video_mismatches = db_videos_missing_files.len() + orphan_videos.len();
    let thumb_mismatches = db_thumbs_missing_files.len() + orphan_thumbs.len();
    let split_brain_detected = video_mismatches > 0 || thumb_mismatches > 0;

    SplitBrainReport {
        checked_at: chrono::Utc::now().timestamp_millis(),
        db_video_count: db_video_set.len(),
        db_thumb_count: db_thumb_set.len(),
        filesystem_video_count: fs_videos.len(),
        filesystem_thumb_count: fs_thumbs.len(),
        db_videos_missing_files,
        db_thumbs_missing_files,
        orphan_videos,
        orphan_thumbs,
        video_mismatches,
        thumb_mismatches,
        split_brain_detected,
        storage,
    }
}

pub async fn split_brain_from_db(
    pool: &Pool<Postgres>,
    public_root: &Path,
    videos_path: &Path,
    thumbs_path: &Path,
) -> Result<SplitBrainReport, sqlx::Error> {
    let db_videos = crate::db::reels::list_ready_video_basenames(pool).await?;
    let db_thumbs = crate::db::reels::list_ready_thumbnail_basenames(pool).await?;
    let storage = build_storage_diagnostics(public_root, videos_path, thumbs_path);
    Ok(compare_db_filesystem(
        &db_videos,
        &db_thumbs,
        videos_path,
        thumbs_path,
        storage,
    ))
}

pub fn inventory_from_split_brain(report: &SplitBrainReport) -> StorageInventoryReport {
    StorageInventoryReport {
        db_video_count: report.db_video_count,
        db_thumb_count: report.db_thumb_count,
        filesystem_video_count: report.filesystem_video_count,
        filesystem_thumb_count: report.filesystem_thumb_count,
        missing_videos: report.db_videos_missing_files.clone(),
        missing_thumbs: report.db_thumbs_missing_files.clone(),
        orphan_videos: report.orphan_videos.clone(),
        orphan_thumbs: report.orphan_thumbs.clone(),
        split_brain: report.split_brain_detected,
    }
}

pub fn inventory_from_reels_and_fs(
    reels: &[ReelRow],
    videos_path: &Path,
    thumbs_path: &Path,
) -> StorageInventoryReport {
    let referenced = media_seed::collect_referenced_media(reels);
    let fs_videos: HashSet<String> = media_seed::list_media_files(videos_path, "videos")
        .into_iter()
        .collect();
    let fs_thumbs: HashSet<String> = media_seed::list_media_files(thumbs_path, "thumbs")
        .into_iter()
        .collect();

    let mut missing_videos: Vec<String> = referenced
        .videos
        .iter()
        .filter(|name| !fs_videos.contains(*name))
        .cloned()
        .collect();
    missing_videos.sort();

    let mut missing_thumbs: Vec<String> = referenced
        .thumbs
        .iter()
        .filter(|name| !fs_thumbs.contains(*name))
        .cloned()
        .collect();
    missing_thumbs.sort();

    let orphan_report = media_seed::scan_orphan_media(videos_path, thumbs_path, reels);

    let orphan_videos = orphan_report.orphan_videos.clone();
    let orphan_thumbs = orphan_report.orphan_thumbs.clone();
    let split_brain = !missing_videos.is_empty()
        || !missing_thumbs.is_empty()
        || !orphan_videos.is_empty()
        || !orphan_thumbs.is_empty();

    StorageInventoryReport {
        db_video_count: referenced.videos.len(),
        db_thumb_count: referenced.thumbs.len(),
        filesystem_video_count: fs_videos.len(),
        filesystem_thumb_count: fs_thumbs.len(),
        missing_videos,
        missing_thumbs,
        orphan_videos,
        orphan_thumbs,
        split_brain,
    }
}

pub fn verify_startup_storage(
    public_root: &Path,
    videos_path: &Path,
    thumbs_path: &Path,
    split_brain: Option<SplitBrainReport>,
) -> StartupStorageReport {
    let diagnostics = build_storage_diagnostics(public_root, videos_path, thumbs_path);
    let mut warnings = Vec::new();

    for probe in &diagnostics.directories {
        if let Some(err) = &probe.error {
            warnings.push(format!("{} ({}): {}", probe.label, probe.path, err));
        }
    }

    if diagnostics.ephemeral_storage_risk {
        warnings.push(format!(
            "Production deployment without persistent volume at {} — media will not survive redeploy",
            diagnostics.media_root
        ));
    }

    if let Some(ref sb) = split_brain {
        if sb.split_brain_detected {
            warnings.push(format!(
                "Split-brain detected: {} DB videos missing files, {} DB thumbs missing files, {} orphan videos, {} orphan thumbs",
                sb.db_videos_missing_files.len(),
                sb.db_thumbs_missing_files.len(),
                sb.orphan_videos.len(),
                sb.orphan_thumbs.len()
            ));
        }
    }

    let startup_safe = diagnostics.directories.iter().all(|p| p.exists && p.readable);

    StartupStorageReport {
        diagnostics,
        split_brain,
        startup_safe,
        warnings,
    }
}

pub fn log_startup_diagnostics(report: &StartupStorageReport) {
    let d = &report.diagnostics;
    println!("═══════════════════════════════════════════════════════════");
    println!("📦 MEDIA STORAGE STARTUP DIAGNOSTICS (BG-5J)");
    println!("═══════════════════════════════════════════════════════════");
    println!("  media_root:          {}", d.media_root);
    println!("  MEDIA_PUBLIC_BASE:   {}", d.media_public_base);
    println!("  videos_path:         {}", d.videos_path);
    println!("  thumbs_path:         {}", d.thumbs_path);
    println!("  storage_status:      {}", d.status);
    println!("  volume_mounted:      {}", d.volume_mounted);
    println!("  ephemeral_risk:      {}", d.ephemeral_storage_risk);
    println!("  writable:            {}", d.writable);
    println!(
        "  filesystem_counts:   {} videos, {} thumbs",
        d.filesystem_video_count, d.filesystem_thumb_count
    );

    for probe in &d.directories {
        let state = if probe.exists && probe.readable && probe.writable {
            "OK"
        } else if !probe.exists {
            "MISSING"
        } else if !probe.writable {
            "READ_ONLY/UNWRITABLE"
        } else {
            "DEGRADED"
        };
        println!(
            "  [{}] {} — exists={} readable={} writable={}",
            state, probe.label, probe.exists, probe.readable, probe.writable
        );
        if let Some(err) = &probe.error {
            eprintln!("    ⚠️  {}", err);
        }
    }

    if let Some(ref sb) = report.split_brain {
        println!("───────────────────────────────────────────────────────────");
        println!("  SPLIT-BRAIN CHECK:");
        println!(
            "    DB:         {} videos, {} thumbs",
            sb.db_video_count, sb.db_thumb_count
        );
        println!(
            "    Filesystem: {} videos, {} thumbs",
            sb.filesystem_video_count, sb.filesystem_thumb_count
        );
        if sb.split_brain_detected {
            eprintln!("    ❌ SPLIT-BRAIN DETECTED");
            if !sb.db_videos_missing_files.is_empty() {
                eprintln!(
                    "    DB videos missing files ({}): {:?}",
                    sb.db_videos_missing_files.len(),
                    sb.db_videos_missing_files
                );
            }
            if !sb.db_thumbs_missing_files.is_empty() {
                eprintln!(
                    "    DB thumbs missing files ({}): {:?}",
                    sb.db_thumbs_missing_files.len(),
                    sb.db_thumbs_missing_files
                );
            }
            if !sb.orphan_videos.is_empty() {
                eprintln!(
                    "    Orphan videos ({}): {:?}",
                    sb.orphan_videos.len(),
                    sb.orphan_videos
                );
            }
            if !sb.orphan_thumbs.is_empty() {
                eprintln!(
                    "    Orphan thumbs ({}): {:?}",
                    sb.orphan_thumbs.len(),
                    sb.orphan_thumbs
                );
            }
        } else {
            println!("    ✅ Catalog and filesystem are aligned");
        }
    }

    for warning in &report.warnings {
        eprintln!("⚠️  STORAGE WARNING: {}", warning);
    }

    if !report.startup_safe {
        eprintln!(
            "❌ STORAGE STARTUP CHECK FAILED — backend may serve broken catalog; investigate mount at {}",
            d.media_root
        );
    } else if d.ephemeral_storage_risk {
        eprintln!(
            "⚠️  STORAGE EPHEMERAL — attach Railway volume at /app/public for durable media"
        );
    } else {
        println!("✅ Storage startup verification complete");
    }
    println!("═══════════════════════════════════════════════════════════");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn probe_writable_directory() {
        let base = std::env::temp_dir().join(format!("rf_storage_probe_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let probe = probe_directory("test", &base);
        assert!(probe.exists);
        assert!(probe.readable);
        assert!(probe.writable);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn compare_detects_missing_and_orphans() {
        let base = std::env::temp_dir().join(format!("rf_split_brain_{}", uuid::Uuid::new_v4()));
        let videos = base.join("videos");
        let thumbs = base.join("thumbs");
        fs::create_dir_all(&videos).unwrap();
        fs::create_dir_all(&thumbs).unwrap();
        // Minimal JPEG SOI for list_media_files thumb inventory
        fs::write(thumbs.join("on-disk.jpg"), [0xFF, 0xD8, 0xFF, 0xD9]).unwrap();

        let storage = build_storage_diagnostics(&base, &videos, &thumbs);
        let report = compare_db_filesystem(
            &["in-db-only.mp4".to_string()],
            &["in-db-thumb.jpg".to_string()],
            &videos,
            &thumbs,
            storage,
        );

        assert!(report.split_brain_detected);
        assert_eq!(report.db_videos_missing_files, vec!["in-db-only.mp4"]);
        assert_eq!(report.orphan_thumbs, vec!["on-disk.jpg"]);
        assert_eq!(report.db_thumbs_missing_files, vec!["in-db-thumb.jpg"]);

        let _ = fs::remove_dir_all(&base);
    }
}
