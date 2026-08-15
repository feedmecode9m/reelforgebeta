//! PHASE-THUMBNAIL-REPAIR-1 — regenerate missing / tiny video posters.
//!
//! Does not touch viewer identity, feed builder, Hero, or upload handlers.
//! Writes JPEG files into the served `public/thumbs` tree (repo root).
//!
//! Run from repo root:
//!   DATABASE_URL=... cargo run --bin repair_thumbnails --manifest-path backend/Cargo.toml

use std::fs;
use std::path::{Path, PathBuf};

use backend::db::reels::{self, ReelRow};
use backend::ingestion::ffmpeg;
use backend::thumbnail_integrity::{
    classify_poster_bytes, jpeg_dimensions, PosterClass, MIN_POSTER_BYTES,
};
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize, Clone)]
struct RepairRow {
    id: String,
    title: String,
    thumbnail_url: String,
    bucket: String,
    bytes: u64,
    dimensions: Option<(u32, u32)>,
    video_source: Option<String>,
    action: String,
    error: Option<String>,
}

#[derive(Serialize)]
struct RepairReport {
    phase: &'static str,
    thumbs_dir: String,
    videos_dir: String,
    min_poster_bytes: u64,
    valid: Vec<RepairRow>,
    missing: Vec<RepairRow>,
    invalid_tiny: Vec<RepairRow>,
    needs_regeneration: Vec<RepairRow>,
    regenerated: Vec<RepairRow>,
    unrepairable: Vec<RepairRow>,
    verdict: String,
}

fn repo_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.join("public/thumbs").is_dir() && cwd.join("frontend").is_dir() {
        return cwd;
    }
    if cwd.join("../public/thumbs").is_dir() {
        return cwd.join("..").canonicalize().unwrap_or(cwd);
    }
    cwd
}

fn is_video_reel(row: &ReelRow) -> bool {
    let mime = row.mime_type.as_deref().unwrap_or("").to_lowercase();
    if mime.starts_with("video/") {
        return true;
    }
    let url = row.video_url.as_deref().unwrap_or("");
    url.contains("/videos/") || url.to_lowercase().ends_with(".mp4")
}

fn thumb_basename(row: &ReelRow) -> String {
    format!("{}.jpg", row.id)
}

fn find_video(row: &ReelRow, video_dirs: &[PathBuf]) -> Option<PathBuf> {
    let mut names = vec![format!("{}.mp4", row.id), row.file_name.clone()];
    if let Some(url) = &row.video_url {
        if let Some(bn) = url.rsplit('/').next() {
            let bn = bn.split('?').next().unwrap_or(bn);
            if !bn.is_empty() {
                names.push(bn.to_string());
            }
        }
    }
    for dir in video_dirs {
        for name in &names {
            if name.is_empty() {
                continue;
            }
            let p = dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn find_existing_thumb(row: &ReelRow, thumb_dirs: &[PathBuf]) -> Option<PathBuf> {
    let names = [thumb_basename(row), row.file_name.replace(".mp4", ".jpg")];
    for dir in thumb_dirs {
        for name in &names {
            let p = dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn classify_file(path: &Path) -> (PosterClass, u64, Option<(u32, u32)>) {
    if !path.is_file() {
        return (PosterClass::Missing, 0, None);
    }
    let bytes = fs::read(path).unwrap_or_default();
    let class = classify_poster_bytes(&bytes);
    (class, bytes.len() as u64, jpeg_dimensions(&bytes))
}

fn row_out(
    row: &ReelRow,
    bucket: &str,
    bytes: u64,
    dims: Option<(u32, u32)>,
    video: Option<&Path>,
    action: &str,
    error: Option<String>,
) -> RepairRow {
    RepairRow {
        id: row.id.to_string(),
        title: row.title.clone(),
        thumbnail_url: row.thumbnail_url.clone().unwrap_or_default(),
        bucket: bucket.to_string(),
        bytes,
        dimensions: dims,
        video_source: video.map(|p| p.display().to_string()),
        action: action.to_string(),
        error,
    }
}

async fn ensure_thumbnail_url(pool: &sqlx::PgPool, id: Uuid, rel: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE reels
        SET thumbnail_url = $2, updated_at = now()
        WHERE id = $1
          AND (thumbnail_url IS NULL OR btrim(thumbnail_url) = '')
        "#,
    )
    .bind(id)
    .bind(rel)
    .execute(pool)
    .await?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::from_filename("backend/.env");
    let _ = dotenvy::dotenv();
    let db_url = std::env::var("DATABASE_URL").unwrap_or_default();
    if db_url.trim().is_empty() {
        eprintln!("DATABASE_URL is required");
        std::process::exit(2);
    }

    let root = repo_root();
    let thumbs_dir = root.join("public/thumbs");
    let videos_dir = root.join("public/videos");
    let alt_thumbs = root.join("backend/public/thumbs");
    let alt_videos = root.join("backend/public/videos");
    fs::create_dir_all(&thumbs_dir)?;

    let pool = sqlx::PgPool::connect(&db_url).await?;
    let all = reels::list_all_reels_for_playback_inventory(&pool).await?;
    let videos: Vec<ReelRow> = all.into_iter().filter(is_video_reel).collect();

    let video_dirs = vec![videos_dir.clone(), alt_videos];
    let thumb_search = vec![thumbs_dir.clone(), alt_thumbs];

    let mut valid = Vec::new();
    let mut missing = Vec::new();
    let mut invalid_tiny = Vec::new();
    let mut needs_regeneration = Vec::new();
    let mut regenerated = Vec::new();
    let mut unrepairable = Vec::new();

    for row in &videos {
        let dest = thumbs_dir.join(thumb_basename(row));
        let (class, bytes, dims) = classify_file(&dest);
        let video = find_video(row, &video_dirs);
        let rel = format!("/thumbs/{}", thumb_basename(row));

        if class == PosterClass::Valid {
            let _ = ensure_thumbnail_url(&pool, row.id, &rel).await;
            valid.push(row_out(
                row,
                "valid",
                bytes,
                dims,
                video.as_deref(),
                "keep",
                None,
            ));
            continue;
        }

        let bucket = class.as_str();
        let pre = row_out(
            row,
            bucket,
            bytes,
            dims,
            video.as_deref(),
            "queued",
            None,
        );
        match class {
            PosterClass::Missing => missing.push(pre),
            PosterClass::TinyPlaceholder | PosterClass::TooSmall => invalid_tiny.push(pre),
            _ => needs_regeneration.push(pre),
        }

        let mut repaired = false;
        let mut err: Option<String> = None;

        if let Some(ref vp) = video {
            match ffmpeg::extract_thumbnail_at_1s(vp, &dest).await {
                Ok(()) => {
                    let (after, nbytes, ndims) = classify_file(&dest);
                    if after == PosterClass::Valid {
                        let _ = ensure_thumbnail_url(&pool, row.id, &rel).await;
                        regenerated.push(row_out(
                            row,
                            "valid",
                            nbytes,
                            ndims,
                            Some(vp),
                            "regenerated",
                            None,
                        ));
                        repaired = true;
                    } else {
                        err = Some(format!("extract_still_{}", after.as_str()));
                    }
                }
                Err(e) => err = Some(e),
            }
        }

        if !repaired {
            if let Some(src) = find_existing_thumb(row, &thumb_search) {
                if src != dest {
                    if let Ok(bytes) = fs::read(&src) {
                        let copied_class = classify_poster_bytes(&bytes);
                        let _ = fs::write(&dest, &bytes);
                        if copied_class == PosterClass::Valid {
                            let _ = ensure_thumbnail_url(&pool, row.id, &rel).await;
                            regenerated.push(row_out(
                                row,
                                "valid",
                                bytes.len() as u64,
                                jpeg_dimensions(&bytes),
                                video.as_deref(),
                                "copied_from_alt_tree",
                                None,
                            ));
                            repaired = true;
                        } else if dest.is_file() {
                            err = Some(format!(
                                "copied_still_{} ({})",
                                copied_class.as_str(),
                                err.unwrap_or_default()
                            ));
                        }
                    }
                }
            }
        }

        if !repaired {
            let (after, nbytes, ndims) = classify_file(&dest);
            let action = if dest.is_file() {
                "unrepairable_source"
            } else {
                "missing_source"
            };
            unrepairable.push(row_out(
                row,
                after.as_str(),
                nbytes,
                ndims,
                video.as_deref(),
                action,
                err,
            ));
        }
    }

    // Recompute valid after regeneration (files now on disk).
    let mut valid_ids: std::collections::HashSet<String> =
        valid.iter().map(|r| r.id.clone()).collect();
    for r in &regenerated {
        valid_ids.insert(r.id.clone());
    }
    valid.extend(regenerated.iter().cloned().filter(|r| r.bucket == "valid"));
    // regenerated already holds the new valids; keep `valid` as original + regenerated
    // Dedupe valid list
    valid.sort_by(|a, b| a.id.cmp(&b.id));
    valid.dedup_by(|a, b| a.id == b.id);

    let viewer_blocking_missing = unrepairable.iter().any(|r| r.action == "missing_source");
    let verdict = if viewer_blocking_missing {
        "FAIL"
    } else {
        "PASS"
    };

    let report = RepairReport {
        phase: "PHASE-THUMBNAIL-REPAIR-1",
        thumbs_dir: thumbs_dir.display().to_string(),
        videos_dir: videos_dir.display().to_string(),
        min_poster_bytes: MIN_POSTER_BYTES,
        valid,
        missing,
        invalid_tiny,
        needs_regeneration,
        regenerated,
        unrepairable,
        verdict: verdict.to_string(),
    };

    let out = root.join("frontend/artifacts/PHASE-THUMBNAIL-REPAIR-1-REPORT.json");
    if let Some(parent) = out.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&out, serde_json::to_string_pretty(&report)?)?;
    eprintln!("wrote {}", out.display());
    eprintln!(
        "valid={} missing={} tiny={} regen={} unrepairable={} verdict={}",
        report.valid.len(),
        report.missing.len(),
        report.invalid_tiny.len(),
        report.regenerated.len(),
        report.unrepairable.len(),
        report.verdict
    );

    if report.verdict != "PASS" {
        std::process::exit(1);
    }
    Ok(())
}
