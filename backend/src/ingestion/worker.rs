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
            crate::video_pipeline_trace::trace(
                "worker_pickup",
                "",
                None,
                &job.reel_id.to_string(),
                "pending",
                "failed",
                "reel not found",
            );
            return Ok(true);
        }
        Err(e) => return Err(e.to_string()),
    };

    let video_url = reel.video_url.clone().unwrap_or_default();
    let file_name = reel.file_name.clone();
    crate::video_pipeline_trace::trace(
        "worker_pickup",
        &file_name,
        reel.file_size,
        &file_name,
        &reel.status,
        "claimed",
        "",
    );
    crate::pipeline_diag::pipeline_diag(
        "INGEST",
        "process_one",
        "worker.rs",
        Some(&job.reel_id.to_string()),
        Some(&file_name),
        "job_claimed",
    );
    let video_path = videos_path.join(&file_name);
    let r2_source = !video_path.is_file() && crate::storage::r2::R2Storage::enabled();
    let remote_source = !video_path.is_file()
        && !r2_source
        && (video_url.starts_with("http://") || video_url.starts_with("https://"));

    if !remote_source && !r2_source {
        let disk_size = std::fs::metadata(&video_path)
            .map(|m| m.len() as i64)
            .unwrap_or(0);
        if let Some(expected) = reel.file_size {
            if let Err(err) =
                media_validator::verify_upload_size_integrity(expected, disk_size)
            {
                let reason = err.to_string();
                let _ = media_validator::quarantine_video(videos_path, &video_path, &err);
                let _ = jobs::fail_job(pool, job.id, &reason, false).await;
                let _ = reels::mark_failed(pool, reel.id, &reason).await;
                crate::video_pipeline_trace::trace(
                    "ffprobe",
                    &file_name,
                    Some(expected),
                    &file_name,
                    "pending",
                    "failed",
                    &reason,
                );
                eprintln!(
                    "[ingest-worker] rejected size mismatch reel={} file={}: {}",
                    reel.id, file_name, reason
                );
                return Ok(true);
            }
        }
        if let Err(err) = media_validator::validate_video_path(&video_path) {
            let reason = err.to_string();
            let _ = media_validator::quarantine_video(videos_path, &video_path, &err);
            let _ = jobs::fail_job(pool, job.id, &reason, false).await;
            let _ = reels::mark_failed(pool, reel.id, &reason).await;
            crate::pipeline_diag::pipeline_diag(
                "INGEST",
                "process_one",
                "worker.rs",
                Some(&reel.id.to_string()),
                Some(&file_name),
                "invalid_video_quarantined",
            );
            crate::video_pipeline_trace::trace(
                "ffprobe",
                &file_name,
                reel.file_size,
                &file_name,
                "pending",
                "failed",
                &reason,
            );
            eprintln!(
                "[ingest-worker] rejected invalid video reel={} file={}: {}",
                reel.id, file_name, reason
            );
            return Ok(true);
        }
        crate::video_pipeline_trace::trace(
            "ffprobe",
            &file_name,
            reel.file_size,
            &file_name,
            "pending",
            "ok",
            "",
        );
    }

    if let Err(e) = reels::set_status_processing(pool, reel.id).await {
        return Err(e.to_string());
    }
    crate::video_pipeline_trace::trace(
        "db_status",
        &file_name,
        reel.file_size,
        &file_name,
        "pending",
        "processing",
        "",
    );

    let thumb_name = format!("{}.jpg", reel.id);
    let thumb_path = thumbs_path.join(&thumb_name);
    let thumb_url = format!("/thumbs/{}", thumb_name);

    // Local master path retained for derivative encode (especially R2 temp download).
    let mut master_local_for_playback: Option<PathBuf> = None;
    let mut cleanup_master_local = false;

    let ffmpeg_result = if r2_source {
        let r2 = crate::storage::r2::R2Storage::global().expect("r2 enabled");
        // Keep a real video extension on the temp path. validate_video_path() keys MIME
        // off Path::extension — `{uuid}.ingest.partial` was rejected as mime_mismatch.
        let ingest_ext = std::path::Path::new(&file_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .filter(|e| matches!(e.as_str(), "mp4" | "mov" | "m4v" | "mkv" | "webm"))
            .unwrap_or_else(|| "mp4".to_string());
        let tmp_path = videos_path.join(format!("{}.ingest.{}", reel.id, ingest_ext));
        let download = r2.download_to_path(&file_name, &tmp_path).await;
        let result = match download {
            Ok(bytes) => {
                crate::video_pipeline_trace::trace(
                    "r2_download",
                    &file_name,
                    Some(bytes as i64),
                    &file_name,
                    "processing",
                    "downloaded",
                    "",
                );
                // R2 path previously skipped ffprobe — truncated/corrupt objects went
                // straight to ffmpeg and never reached READY with a clear reason.
                if let Some(expected) = reel.file_size {
                    if let Err(err) =
                        media_validator::verify_upload_size_integrity(expected, bytes as i64)
                    {
                        let reason = err.to_string();
                        let _ = tokio::fs::remove_file(&tmp_path).await;
                        crate::video_pipeline_trace::trace(
                            "ffprobe",
                            &file_name,
                            Some(expected),
                            &file_name,
                            "downloaded",
                            "failed",
                            &reason,
                        );
                        Err(reason)
                    } else if let Err(err) = media_validator::validate_video_path(&tmp_path) {
                        let reason = err.to_string();
                        let _ = media_validator::quarantine_video(videos_path, &tmp_path, &err);
                        let _ = tokio::fs::remove_file(&tmp_path).await;
                        crate::video_pipeline_trace::trace(
                            "ffprobe",
                            &file_name,
                            reel.file_size,
                            &file_name,
                            "downloaded",
                            "failed",
                            &reason,
                        );
                        Err(reason)
                    } else {
                        crate::video_pipeline_trace::trace(
                            "ffprobe",
                            &file_name,
                            reel.file_size,
                            &file_name,
                            "downloaded",
                            "ok",
                            "",
                        );
                        crate::video_pipeline_trace::trace(
                            "ffmpeg_thumb",
                            &file_name,
                            reel.file_size,
                            &file_name,
                            "processing",
                            "start",
                            "",
                        );
                        match ffmpeg::extract_thumbnail_at_1s(&tmp_path, &thumb_path).await {
                            Ok(()) => {
                                master_local_for_playback = Some(tmp_path.clone());
                                cleanup_master_local = true;
                                Ok(())
                            }
                            Err(e) => {
                                let _ = tokio::fs::remove_file(&tmp_path).await;
                                Err(e)
                            }
                        }
                    }
                } else if let Err(err) = media_validator::validate_video_path(&tmp_path) {
                    let reason = err.to_string();
                    let _ = media_validator::quarantine_video(videos_path, &tmp_path, &err);
                    let _ = tokio::fs::remove_file(&tmp_path).await;
                    crate::video_pipeline_trace::trace(
                        "ffprobe",
                        &file_name,
                        None,
                        &file_name,
                        "downloaded",
                        "failed",
                        &reason,
                    );
                    Err(reason)
                } else {
                    crate::video_pipeline_trace::trace(
                        "ffmpeg_thumb",
                        &file_name,
                        None,
                        &file_name,
                        "processing",
                        "start",
                        "",
                    );
                    match ffmpeg::extract_thumbnail_at_1s(&tmp_path, &thumb_path).await {
                        Ok(()) => {
                            master_local_for_playback = Some(tmp_path.clone());
                            cleanup_master_local = true;
                            Ok(())
                        }
                        Err(e) => {
                            let _ = tokio::fs::remove_file(&tmp_path).await;
                            Err(e)
                        }
                    }
                }
            }
            Err(e) => {
                crate::video_pipeline_trace::trace(
                    "r2_download",
                    &file_name,
                    reel.file_size,
                    &file_name,
                    "processing",
                    "failed",
                    &e,
                );
                Err(e)
            }
        };
        result
    } else if remote_source {
        crate::video_pipeline_trace::trace(
            "ffmpeg_thumb",
            &file_name,
            reel.file_size,
            &video_url,
            "processing",
            "start",
            "",
        );
        ffmpeg::extract_thumbnail_from_url(&video_url, &thumb_path).await
    } else {
        master_local_for_playback = Some(video_path.clone());
        crate::video_pipeline_trace::trace(
            "ffmpeg_thumb",
            &file_name,
            reel.file_size,
            &file_name,
            "processing",
            "start",
            "",
        );
        ffmpeg::extract_thumbnail_at_1s(&video_path, &thumb_path).await
    };

    match ffmpeg_result {
        Ok(()) => {
            if !r2_source && !remote_source {
                if let Some(expected) = reel.file_size {
                    let disk_size = std::fs::metadata(&video_path)
                        .map(|m| m.len() as i64)
                        .unwrap_or(0);
                    if let Err(err) =
                        media_validator::verify_upload_size_integrity(expected, disk_size)
                    {
                        let reason = err.to_string();
                        let _ = std::fs::remove_file(&thumb_path);
                        let _ = jobs::fail_job(pool, job.id, &reason, false).await;
                        let _ = reels::mark_failed(pool, reel.id, &reason).await;
                        crate::video_pipeline_trace::trace(
                            "db_status",
                            &file_name,
                            Some(expected),
                            &file_name,
                            "processing",
                            "failed",
                            &reason,
                        );
                        eprintln!(
                            "[ingest-worker] blocked ready reel={} file={}: {}",
                            reel.id, file_name, reason
                        );
                        return Ok(true);
                    }
                }
                if let Err(err) = media_validator::validate_video_path(&video_path) {
                    let reason = err.to_string();
                    let _ = std::fs::remove_file(&thumb_path);
                    let _ = jobs::fail_job(pool, job.id, &reason, false).await;
                    let _ = reels::mark_failed(pool, reel.id, &reason).await;
                    crate::video_pipeline_trace::trace(
                        "db_status",
                        &file_name,
                        reel.file_size,
                        &file_name,
                        "processing",
                        "failed",
                        &reason,
                    );
                    eprintln!(
                        "[ingest-worker] blocked ready reel={} file={}: {}",
                        reel.id, file_name, reason
                    );
                    return Ok(true);
                }
            }

            // Best-effort playback derivative — never blocks mark_ready on failure.
            let playback_input = master_local_for_playback
                .as_ref()
                .map(|p| p.as_path())
                .filter(|p| p.is_file());
            attempt_playback_derivative(pool, &reel, videos_path, playback_input).await;

            if cleanup_master_local {
                if let Some(ref p) = master_local_for_playback {
                    let _ = tokio::fs::remove_file(p).await;
                }
            }

            if let Err(e) = reels::mark_ready(pool, reel.id, &thumb_url).await {
                let _ = std::fs::remove_file(&thumb_path);
                let _ = jobs::fail_job(pool, job.id, &e.to_string(), false).await;
                crate::pipeline_diag::pipeline_diag(
                    "DB",
                    "process_one",
                    "worker.rs",
                    Some(&reel.id.to_string()),
                    Some(&file_name),
                    "mark_ready_failed",
                );
                crate::video_pipeline_trace::trace(
                    "db_status",
                    &file_name,
                    reel.file_size,
                    &file_name,
                    "processing",
                    "failed",
                    e.to_string(),
                );
                return Err(e.to_string());
            }
            crate::pipeline_diag::pipeline_diag(
                "DB",
                "process_one",
                "worker.rs",
                Some(&reel.id.to_string()),
                Some(&thumb_name),
                "mark_ready_ok",
            );
            crate::video_pipeline_trace::trace(
                "db_status",
                &file_name,
                reel.file_size,
                &file_name,
                "processing",
                "ready",
                "",
            );
            crate::video_pipeline_trace::trace(
                "ffmpeg_thumb",
                &file_name,
                reel.file_size,
                &file_name,
                "processing",
                "ok",
                "",
            );
            eprintln!(
                "[STORE_UPDATE] reel={} status=ready worker=true thumb={}",
                reel.id, thumb_url
            );
            let _ = jobs::complete(pool, job.id).await;

            eprintln!(
                "[ingest-worker] ready reel={} video={} thumb={}",
                reel.id, video_url, thumb_url
            );
            crate::pipeline_diag::pipeline_diag(
                "INGEST",
                "process_one",
                "worker.rs",
                Some(&reel.id.to_string()),
                Some(&file_name),
                "ready",
            );

            reel_contract::publish_reel_ready(pool, reel.id, event_bus).await;

            Ok(true)
        }
        Err(err) => {
            if cleanup_master_local {
                if let Some(ref p) = master_local_for_playback {
                    let _ = tokio::fs::remove_file(p).await;
                }
            }
            let _ = std::fs::remove_file(&thumb_path);
            let retry = job.attempts < job.max_attempts;
            let _ = jobs::fail_job(pool, job.id, &err, retry).await;
            crate::pipeline_diag::pipeline_diag(
                "FFMPEG",
                "process_one",
                "worker.rs",
                Some(&reel.id.to_string()),
                Some(&file_name),
                if retry { "retry" } else { "failed" },
            );
            crate::video_pipeline_trace::trace(
                "ffmpeg_thumb",
                &file_name,
                reel.file_size,
                &file_name,
                "processing",
                if retry { "retry" } else { "failed" },
                &err,
            );
            if !retry {
                let _ = reels::mark_failed(pool, reel.id, &err).await;
                crate::video_pipeline_trace::trace(
                    "db_status",
                    &file_name,
                    reel.file_size,
                    &file_name,
                    "processing",
                    "failed",
                    &err,
                );
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

/// Encode + store `{reelId}.playback.mp4`. Failures are recorded; they never fail the job.
async fn attempt_playback_derivative(
    pool: &PgPool,
    reel: &crate::db::reels::ReelRow,
    videos_path: &PathBuf,
    master_local: Option<&std::path::Path>,
) {
    use crate::ingestion::transcode;

    if !transcode::playback_transcode_enabled() {
        let _ = reels::set_playback_derivative(
            pool,
            reel.id,
            None,
            "skipped",
            None,
            None,
            None,
        )
        .await;
        eprintln!(
            "[PLAYBACK_TRANSCODE] skipped reel={} reason=feature_flag",
            reel.id
        );
        return;
    }

    let Some(input) = master_local.filter(|p| p.is_file()) else {
        let _ = reels::set_playback_derivative(
            pool,
            reel.id,
            None,
            "failed",
            None,
            None,
            None,
        )
        .await;
        eprintln!(
            "[PLAYBACK_TRANSCODE] failed reel={} reason=no_local_master",
            reel.id
        );
        return;
    };

    let _ = reels::set_playback_derivative(
        pool,
        reel.id,
        None,
        "processing",
        None,
        Some(transcode::PLAYBACK_PROFILE_WEB_720P_H264),
        Some(&transcode::playback_file_name(&reel.id)),
    )
    .await;

    let out_path = transcode::local_playback_path(videos_path, &reel.id);
    match transcode::encode_web_playback_derivative(input, &out_path, reel.file_size).await {
        Ok(result) => {
            // Prefer relative path in DB; public URL is derived by reel_contract.
            let mut playback_url = result.playback_relative_url.clone();

            if crate::storage::r2::R2Storage::enabled() {
                if let Some(r2) = crate::storage::r2::R2Storage::global() {
                    match r2
                        .put_file(&result.playback_file_name, &out_path, "video/mp4")
                        .await
                    {
                        Ok(()) => {
                            // Canonical public absolute when R2 base is set.
                            let public = r2.public_url(&result.playback_file_name);
                            if public.starts_with("http://") || public.starts_with("https://") {
                                playback_url = public;
                            }
                            eprintln!(
                                "[PLAYBACK_TRANSCODE] r2_upload ok reel={} key={} bytes={}",
                                reel.id, result.playback_file_name, result.playback_file_size
                            );
                        }
                        Err(e) => {
                            eprintln!(
                                "[PLAYBACK_TRANSCODE] r2_upload failed reel={} err={} (keeping local derivative)",
                                reel.id, e
                            );
                        }
                    }
                }
            }

            if let Err(e) = reels::set_playback_derivative(
                pool,
                reel.id,
                Some(&playback_url),
                "ready",
                Some(result.playback_file_size),
                Some(&result.playback_profile),
                Some(&result.playback_file_name),
            )
            .await
            {
                eprintln!(
                    "[PLAYBACK_TRANSCODE] db_update failed reel={} err={}",
                    reel.id, e
                );
            } else {
                crate::video_pipeline_trace::trace(
                    "playback_transcode",
                    &reel.file_name,
                    Some(result.playback_file_size),
                    &result.playback_file_name,
                    "processing",
                    "ready",
                    &format!(
                        "ratio={:.2}x encode_ms={}",
                        result.compression_ratio, result.encode_ms
                    ),
                );
            }
        }
        Err(err) => {
            let _ = std::fs::remove_file(&out_path);
            let _ = reels::set_playback_derivative(
                pool,
                reel.id,
                None,
                "failed",
                None,
                Some(transcode::PLAYBACK_PROFILE_WEB_720P_H264),
                None,
            )
            .await;
            crate::video_pipeline_trace::trace(
                "playback_transcode",
                &reel.file_name,
                reel.file_size,
                &reel.file_name,
                "processing",
                "failed",
                &err.to_string(),
            );
            eprintln!(
                "[PLAYBACK_TRANSCODE] failed reel={} err={} (master remains playable)",
                reel.id, err
            );
        }
    }
}

pub async fn log_queue_metrics(pool: &PgPool) {
    if let Ok(depth) = jobs::queue_depth(pool).await {
        eprintln!("[ingest-metrics] queue_depth={}", depth);
    }
}
