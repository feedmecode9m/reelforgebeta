use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use sqlx::PgPool;
use uuid::Uuid;

use crate::db::{self, jobs, reels};
use crate::events::EventBus;
use crate::media_seed;
use crate::media_validator;
use crate::reel_contract;

use super::{mime_for_ext, video_extension};

#[derive(Debug, Clone, Copy)]
pub struct ReconcileOptions {
    pub log_prefix: &'static str,
}

impl ReconcileOptions {
    pub fn startup() -> Self {
        Self {
            log_prefix: "[reconcile]",
        }
    }

    pub fn migrate() -> Self {
        Self {
            log_prefix: "[migrate]",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileReport {
    pub scanned: usize,
    pub imported: usize,
    pub skipped_cataloged: usize,
    pub skipped_invalid: usize,
    pub quarantined: usize,
    pub skipped_duplicate_content: usize,
    pub jobs_enqueued: usize,
    pub marked_ready: usize,
    pub errors: Vec<String>,
}

impl ReconcileReport {
    /// Backward-compatible field for migrate-media responses.
    pub fn skipped_existing(&self) -> usize {
        self.skipped_cataloged + self.skipped_duplicate_content
    }
}

pub async fn reconcile_videos(
    pool: &PgPool,
    videos_path: &Path,
    thumbs_path: &Path,
    options: ReconcileOptions,
    event_bus: Option<Arc<EventBus>>,
) -> Result<ReconcileReport, String> {
    let mut report = ReconcileReport {
        scanned: 0,
        imported: 0,
        skipped_cataloged: 0,
        skipped_invalid: 0,
        quarantined: 0,
        skipped_duplicate_content: 0,
        jobs_enqueued: 0,
        marked_ready: 0,
        errors: Vec::new(),
    };

    let mut catalog = reels::list_cataloged_video_basenames(pool)
        .await
        .map_err(|e| e.to_string())?;

    let excludes: HashSet<String> = db::reconcile_exclude_filenames()
        .into_iter()
        .map(|s| s.to_lowercase())
        .collect();

    let entries =
        std::fs::read_dir(videos_path).map_err(|e| format!("Cannot read videos dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };

        report.scanned += 1;

        if excludes.contains(&name.to_lowercase()) {
            report.skipped_cataloged += 1;
            eprintln!(
                "{} skip excluded asset: {} (hero/UI background — not cataloged as reel)",
                options.log_prefix, name
            );
            continue;
        }
        if !media_seed::is_video_file(name) {
            continue;
        }
        if catalog.contains(name) {
            report.skipped_cataloged += 1;
            continue;
        }
        if let Err(err) = media_validator::validate_video_path(&path) {
            report.skipped_invalid += 1;
            if media_validator::quarantine_video(videos_path, &path, &err).is_ok() {
                report.quarantined += 1;
            }
            continue;
        }

        let size = std::fs::metadata(&path)
            .map(|m| m.len() as i64)
            .unwrap_or(0);
        let title = reel_contract::display_name_from_filename(name);

        if let Some(dup) = reels::find_semantic_duplicate(pool, size, &title)
            .await
            .map_err(|e| e.to_string())?
        {
            report.skipped_duplicate_content += 1;
            eprintln!(
                "{} skip duplicate content: {} (existing reel {} file={})",
                options.log_prefix, name, dup.id, dup.file_name
            );
            continue;
        }

        if reels::find_by_file_name(pool, name)
            .await
            .map_err(|e| e.to_string())?
            .is_some()
        {
            report.skipped_cataloged += 1;
            catalog.insert(name.to_string());
            continue;
        }

        let asset_id = Uuid::new_v4();
        let ext = video_extension(name).unwrap_or(".mp4");
        let video_url = format!("/videos/{}", name);
        let mime = mime_for_ext(ext);

        if let Err(e) = reels::insert_pending_reel(
            pool,
            asset_id,
            &title,
            "Trending",
            None,
            &video_url,
            None,
            name,
            size,
            Some(mime),
        )
        .await
        {
            report.errors.push(format!("insert {}: {}", name, e));
            continue;
        }

        catalog.insert(name.to_string());

        let thumb_matched =
            match_existing_thumb(pool, thumbs_path, name, asset_id, event_bus.as_deref()).await?;
        if thumb_matched {
            report.marked_ready += 1;
            report.imported += 1;
            eprintln!(
                "{} imported {} → {} (thumb matched)",
                options.log_prefix, name, asset_id
            );
            continue;
        }

        if jobs::has_active_job(pool, asset_id).await.unwrap_or(false) {
            report.imported += 1;
            eprintln!(
                "{} imported {} → {} (job already active)",
                options.log_prefix, name, asset_id
            );
            continue;
        }

        if let Err(e) = jobs::enqueue(pool, asset_id).await {
            report.errors.push(format!("enqueue {}: {}", name, e));
            continue;
        }

        report.jobs_enqueued += 1;
        report.imported += 1;
        eprintln!("{} imported {} → {}", options.log_prefix, name, asset_id);
    }

    Ok(report)
}

async fn match_existing_thumb(
    pool: &PgPool,
    thumbs_path: &Path,
    video_name: &str,
    asset_id: Uuid,
    event_bus: Option<&EventBus>,
) -> Result<bool, String> {
    let stem = video_name
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(video_name)
        .to_lowercase();

    let entries = std::fs::read_dir(thumbs_path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let tp = entry.path();
        let tn = tp.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let tstem = tn
            .rsplit_once('.')
            .map(|(s, _)| s.to_lowercase())
            .unwrap_or_default();
        if tstem == stem && media_seed::is_image_file(tn) {
            let thumb_stored = format!("{}.jpg", asset_id);
            let thumb_dest: PathBuf = thumbs_path.join(&thumb_stored);
            if std::fs::copy(&tp, &thumb_dest).is_ok() {
                let thumb_url = format!("/thumbs/{}", thumb_stored);
                reels::mark_ready(pool, asset_id, &thumb_url)
                    .await
                    .map_err(|e| e.to_string())?;
                if let Some(bus) = event_bus {
                    reel_contract::publish_reel_ready(pool, asset_id, bus).await;
                }
                return Ok(true);
            }
        }
    }
    Ok(false)
}
