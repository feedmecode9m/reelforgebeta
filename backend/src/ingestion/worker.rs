use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;

use crate::events::EventBus;

use crate::db::{jobs, reels};
use crate::ingestion::ffmpeg;
use crate::media_validator;
use crate::reel_contract;

const POLL_INTERVAL: Duration = Duration::from_secs(2);

pub async fn run_worker(
    pool: PgPool,
    videos_path: PathBuf,
    thumbs_path: PathBuf,
    event_bus: Arc<EventBus>,
) {
    eprintln!("[ingest-worker] started");
    let mut ticks: u64 = 0;
    loop {
        match process_one(&pool, &videos_path, &thumbs_path, &event_bus).await {
            Ok(true) => {}
            Ok(false) => {
                ticks += 1;
                if ticks % 15 == 0 {
                    let _ = log_queue_metrics(&pool).await;
                }
                tokio::time::sleep(POLL_INTERVAL).await;
            }
            Err(e) => {
                eprintln!("[ingest-worker] error: {}", e);
                tokio::time::sleep(POLL_INTERVAL).await;
            }
        }
    }
}

async fn process_one(
    pool: &PgPool,
    videos_path: &PathBuf,
    thumbs_path: &PathBuf,
    event_bus: &EventBus,
) -> Result<bool, String> {
    let job = match jobs::claim_next(pool).await {
        Ok(j) => j,
        Err(e) => return Err(e.to_string()),
    };

    let Some(job) = job else {
        return Ok(false);
    };

    eprintln!(
        "[ingest-worker] claimed job={} reel={} attempt={}",
        job.id, job.reel_id, job.attempts
    );

    let reel = match reels::get_reel_by_id(pool, job.reel_id).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            let _ = jobs::fail_job(pool, job.id, "reel not found", false).await;
            return Ok(true);
        }
        Err(e) => return Err(e.to_string()),
    };

    let video_url = reel.video_url.clone().unwrap_or_default();
    let file_name = reel.file_name.clone();
    let video_path = videos_path.join(&file_name);

    if let Err(err) = media_validator::validate_video_path(&video_path) {
        let reason = err.to_string();
        let _ = media_validator::quarantine_video(videos_path, &video_path, &err);
        let _ = jobs::fail_job(pool, job.id, &reason, false).await;
        let _ = reels::mark_failed(pool, reel.id, &reason).await;
        eprintln!(
            "[ingest-worker] rejected invalid video reel={} file={}: {}",
            reel.id, file_name, reason
        );
        return Ok(true);
    }

    if let Err(e) = reels::set_status_processing(pool, reel.id).await {
        return Err(e.to_string());
    }

    let thumb_name = format!("{}.jpg", reel.id);
    let thumb_path = thumbs_path.join(&thumb_name);
    let thumb_url = format!("/thumbs/{}", thumb_name);

    match ffmpeg::extract_thumbnail_at_1s(&video_path, &thumb_path).await {
        Ok(()) => {
            if let Err(e) = reels::mark_ready(pool, reel.id, &thumb_url).await {
                let _ = std::fs::remove_file(&thumb_path);
                let _ = jobs::fail_job(pool, job.id, &e.to_string(), false).await;
                return Err(e.to_string());
            }
            eprintln!(
                "[STORE_UPDATE] reel={} status=ready worker=true thumb={}",
                reel.id, thumb_url
            );
            let _ = jobs::complete(pool, job.id).await;

            eprintln!(
                "[ingest-worker] ready reel={} video={} thumb={}",
                reel.id, video_url, thumb_url
            );

            reel_contract::publish_reel_ready(pool, reel.id, event_bus).await;

            Ok(true)
        }
        Err(err) => {
            let _ = std::fs::remove_file(&thumb_path);
            let retry = job.attempts < job.max_attempts;
            let _ = jobs::fail_job(pool, job.id, &err, retry).await;
            if !retry {
                let _ = reels::mark_failed(pool, reel.id, &err).await;
                eprintln!("[ingest-worker] failed reel={}: {}", reel.id, err);
            } else {
                eprintln!(
                    "[ingest-worker] retry reel={} attempt={}: {}",
                    reel.id, job.attempts, err
                );
            }
            Ok(true)
        }
    }
}

pub async fn log_queue_metrics(pool: &PgPool) {
    if let Ok(depth) = jobs::queue_depth(pool).await {
        eprintln!("[ingest-metrics] queue_depth={}", depth);
    }
}
