//! Shared web playback derivative pipeline (`web_720p_h264`).
//!
//! Used by ingest after thumb success and by the offline `playback-repair` CLI.
//! Never mutates `video_url` / master `url`. Failures never mark a derivative `ready`.

use std::path::{Path, PathBuf};

use sqlx::PgPool;
use uuid::Uuid;

use crate::db::reels::{self, ReelRow};
use crate::ingestion::transcode;

/// DB / contract values for `reels.playback_status`.
pub const STATUS_READY: &str = "ready";
pub const STATUS_PROCESSING: &str = "processing";
pub const STATUS_FAILED: &str = "failed";
pub const STATUS_SKIPPED: &str = "skipped";
pub const STATUS_PENDING: &str = "pending";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybackInventoryBucket {
    /// Ready master, no usable playback derivative row.
    ReadyMasterMissingPlayback,
    /// `playback_status=ready` with non-empty `playback_url`.
    ReadyPlayback,
    /// Non-ready playback_status (failed / processing / pending / skipped / other).
    IncompletePlayback,
    /// Ready reel without a video-like master reference.
    MissingOrInvalidMaster,
    /// Non-ready catalog row (not playable inventory).
    NonReadyMaster,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlaybackInventoryEntry {
    pub reel_id: Uuid,
    pub title: String,
    pub master_status: String,
    pub master_url: Option<String>,
    pub playback_status: Option<String>,
    pub playback_url: Option<String>,
    pub playback_file_name: Option<String>,
    pub bucket: PlaybackInventoryBucket,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaterializeOutcomeKind {
    SkippedAlreadyReady,
    SkippedFeatureFlag,
    Ready,
    Failed,
}

#[derive(Debug, Clone)]
pub struct MaterializeOutcome {
    pub kind: MaterializeOutcomeKind,
    pub reel_id: Uuid,
    pub message: String,
    pub playback_url: Option<String>,
    pub playback_file_name: Option<String>,
}

/// Basename convention: `{reelId}.playback.mp4` under R2 key prefix.
pub fn playback_object_basename(reel_id: Uuid) -> String {
    transcode::playback_file_name(&reel_id)
}

/// Classify a reel for inventory / repair dry-run (no I/O).
pub fn classify_reel(row: &ReelRow) -> PlaybackInventoryEntry {
    let master_url = row.video_url.clone().filter(|s| !s.trim().is_empty());
    let master_ready = row.status.eq_ignore_ascii_case("ready") && row.validated;
    let playback_status = row
        .playback_status
        .clone()
        .filter(|s| !s.trim().is_empty());
    let playback_url = row.playback_url.clone().filter(|s| !s.trim().is_empty());
    let master_ok = master_looks_playable(master_url.as_deref(), row.file_name.as_str());

    let bucket = if !master_ready {
        PlaybackInventoryBucket::NonReadyMaster
    } else if !master_ok {
        PlaybackInventoryBucket::MissingOrInvalidMaster
    } else if is_playback_contract_ready(playback_status.as_deref(), playback_url.as_deref()) {
        PlaybackInventoryBucket::ReadyPlayback
    } else if playback_status.is_some() {
        PlaybackInventoryBucket::IncompletePlayback
    } else {
        PlaybackInventoryBucket::ReadyMasterMissingPlayback
    };

    PlaybackInventoryEntry {
        reel_id: row.id,
        title: row.title.clone(),
        master_status: row.status.clone(),
        master_url,
        playback_status,
        playback_url,
        playback_file_name: row.playback_file_name.clone(),
        bucket,
    }
}

/// Theater contract gate: ready status + non-empty URL.
pub fn is_playback_contract_ready(
    playback_status: Option<&str>,
    playback_url: Option<&str>,
) -> bool {
    let st = playback_status.unwrap_or("").trim().eq_ignore_ascii_case(STATUS_READY);
    let url = playback_url.map(|u| !u.trim().is_empty()).unwrap_or(false);
    st && url
}

fn master_looks_playable(master_url: Option<&str>, file_name: &str) -> bool {
    let lower_name = file_name.to_ascii_lowercase();
    if lower_name.ends_with(".mp4")
        || lower_name.ends_with(".mov")
        || lower_name.ends_with(".m4v")
        || lower_name.ends_with(".webm")
        || lower_name.ends_with(".mkv")
    {
        return true;
    }
    let Some(url) = master_url.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    let lower = url.to_ascii_lowercase();
    lower.contains("/videos/")
        || lower.ends_with(".mp4")
        || lower.ends_with(".mov")
        || lower.ends_with(".m4v")
        || lower.ends_with(".webm")
        || lower.ends_with(".mkv")
}

/// Inventory all reels for dry-run reports.
pub async fn inventory_all_reels(pool: &PgPool) -> Result<Vec<PlaybackInventoryEntry>, String> {
    let rows = reels::list_all_reels_for_playback_inventory(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(classify_reel).collect())
}

/// Encode + persist a web derivative for one reel.
///
/// - Does not touch master `video_url`.
/// - When R2 is enabled, marks `ready` only after a successful R2 upload + absolute (or resolvable) URL.
/// - When R2 is disabled, stores relative `/videos/{id}.playback.mp4` after local encode.
/// - Idempotent: if already contract-ready, skips encode/upload.
pub async fn materialize_playback_derivative(
    pool: &PgPool,
    reel: &ReelRow,
    videos_path: &Path,
    master_local: Option<&Path>,
) -> MaterializeOutcome {
    if !transcode::playback_transcode_enabled() {
        let _ = reels::set_playback_derivative(
            pool,
            reel.id,
            None,
            STATUS_SKIPPED,
            None,
            None,
            None,
        )
        .await;
        return MaterializeOutcome {
            kind: MaterializeOutcomeKind::SkippedFeatureFlag,
            reel_id: reel.id,
            message: "PLAYBACK_TRANSCODE disabled".into(),
            playback_url: None,
            playback_file_name: None,
        };
    }

    if is_playback_contract_ready(
        reel.playback_status.as_deref(),
        reel.playback_url.as_deref(),
    ) {
        // Re-assert readiness if object already exists under the stable key (idempotent no-op).
        let name = reel
            .playback_file_name
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| playback_object_basename(reel.id));
        if derivative_object_present(&name).await {
            return MaterializeOutcome {
                kind: MaterializeOutcomeKind::SkippedAlreadyReady,
                reel_id: reel.id,
                message: "already ready; derivative object present".into(),
                playback_url: reel.playback_url.clone(),
                playback_file_name: Some(name),
            };
        }
        // Row claims ready but object missing — fall through to re-encode (same key overwrite).
        eprintln!(
            "[PLAYBACK_TRANSCODE] ready claim without object reel={} — re-materializing",
            reel.id
        );
    }

    let Some(input) = master_local.filter(|p| p.is_file()) else {
        let _ = reels::set_playback_derivative(
            pool,
            reel.id,
            None,
            STATUS_FAILED,
            None,
            None,
            None,
        )
        .await;
        return MaterializeOutcome {
            kind: MaterializeOutcomeKind::Failed,
            reel_id: reel.id,
            message: "no_local_master".into(),
            playback_url: None,
            playback_file_name: None,
        };
    };

    let file_name = playback_object_basename(reel.id);
    let _ = reels::set_playback_derivative(
        pool,
        reel.id,
        None,
        STATUS_PROCESSING,
        None,
        Some(transcode::PLAYBACK_PROFILE_WEB_720P_H264),
        Some(&file_name),
    )
    .await;

    let out_path = transcode::local_playback_path(videos_path, &reel.id);
    match transcode::encode_web_playback_derivative(input, &out_path, reel.file_size).await {
        Ok(result) => {
            let mut playback_url = result.playback_relative_url.clone();
            let r2_enabled = crate::storage::r2::R2Storage::enabled();

            if r2_enabled {
                let Some(r2) = crate::storage::r2::R2Storage::global() else {
                    let _ = std::fs::remove_file(&out_path);
                    let _ = reels::set_playback_derivative(
                        pool,
                        reel.id,
                        None,
                        STATUS_FAILED,
                        None,
                        Some(transcode::PLAYBACK_PROFILE_WEB_720P_H264),
                        Some(&result.playback_file_name),
                    )
                    .await;
                    return MaterializeOutcome {
                        kind: MaterializeOutcomeKind::Failed,
                        reel_id: reel.id,
                        message: "r2_enabled_but_global_missing".into(),
                        playback_url: None,
                        playback_file_name: Some(result.playback_file_name),
                    };
                };

                match r2
                    .put_file(&result.playback_file_name, &out_path, "video/mp4")
                    .await
                {
                    Ok(()) => {
                        let public = r2.public_url(&result.playback_file_name);
                        if public.starts_with("http://") || public.starts_with("https://") {
                            playback_url = public;
                        } else {
                            // Relative fallback only when public base unset — still better than silent empty.
                            playback_url = public;
                        }
                        eprintln!(
                            "[PLAYBACK_TRANSCODE] r2_upload ok reel={} key={} bytes={}",
                            reel.id, result.playback_file_name, result.playback_file_size
                        );
                    }
                    Err(e) => {
                        let _ = std::fs::remove_file(&out_path);
                        let _ = reels::set_playback_derivative(
                            pool,
                            reel.id,
                            None,
                            STATUS_FAILED,
                            None,
                            Some(transcode::PLAYBACK_PROFILE_WEB_720P_H264),
                            Some(&result.playback_file_name),
                        )
                        .await;
                        eprintln!(
                            "[PLAYBACK_TRANSCODE] r2_upload failed reel={} err={} (not marking ready)",
                            reel.id, e
                        );
                        return MaterializeOutcome {
                            kind: MaterializeOutcomeKind::Failed,
                            reel_id: reel.id,
                            message: format!("r2_upload_failed: {}", e),
                            playback_url: None,
                            playback_file_name: Some(result.playback_file_name),
                        };
                    }
                }
            }

            if playback_url.trim().is_empty() {
                let _ = std::fs::remove_file(&out_path);
                let _ = reels::set_playback_derivative(
                    pool,
                    reel.id,
                    None,
                    STATUS_FAILED,
                    None,
                    Some(transcode::PLAYBACK_PROFILE_WEB_720P_H264),
                    Some(&result.playback_file_name),
                )
                .await;
                return MaterializeOutcome {
                    kind: MaterializeOutcomeKind::Failed,
                    reel_id: reel.id,
                    message: "empty_playback_url".into(),
                    playback_url: None,
                    playback_file_name: Some(result.playback_file_name),
                };
            }

            match reels::set_playback_derivative(
                pool,
                reel.id,
                Some(&playback_url),
                STATUS_READY,
                Some(result.playback_file_size),
                Some(&result.playback_profile),
                Some(&result.playback_file_name),
            )
            .await
            {
                Ok(()) => {
                    crate::video_pipeline_trace::trace(
                        "playback_transcode",
                        &reel.file_name,
                        Some(result.playback_file_size),
                        &result.playback_file_name,
                        STATUS_PROCESSING,
                        STATUS_READY,
                        &format!(
                            "ratio={:.2}x encode_ms={}",
                            result.compression_ratio, result.encode_ms
                        ),
                    );
                    MaterializeOutcome {
                        kind: MaterializeOutcomeKind::Ready,
                        reel_id: reel.id,
                        message: "ready".into(),
                        playback_url: Some(playback_url),
                        playback_file_name: Some(result.playback_file_name),
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[PLAYBACK_TRANSCODE] db_update failed reel={} err={}",
                        reel.id, e
                    );
                    MaterializeOutcome {
                        kind: MaterializeOutcomeKind::Failed,
                        reel_id: reel.id,
                        message: format!("db_update_failed: {}", e),
                        playback_url: None,
                        playback_file_name: Some(result.playback_file_name),
                    }
                }
            }
        }
        Err(err) => {
            let _ = std::fs::remove_file(&out_path);
            let _ = reels::set_playback_derivative(
                pool,
                reel.id,
                None,
                STATUS_FAILED,
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
                STATUS_PROCESSING,
                STATUS_FAILED,
                &err.to_string(),
            );
            eprintln!(
                "[PLAYBACK_TRANSCODE] failed reel={} err={} (master remains playable)",
                reel.id, err
            );
            MaterializeOutcome {
                kind: MaterializeOutcomeKind::Failed,
                reel_id: reel.id,
                message: err.to_string(),
                playback_url: None,
                playback_file_name: None,
            }
        }
    }
}

async fn derivative_object_present(stored_name: &str) -> bool {
    if let Some(r2) = crate::storage::r2::R2Storage::global() {
        match r2.head_object(stored_name).await {
            Ok(h) => h.content_length > 1024,
            Err(_) => false,
        }
    } else {
        false
    }
}

/// Resolve a local master path for repair: prefer on-disk videos dir, else R2 download to temp.
///
/// Returns `(path, should_cleanup)`.
pub async fn resolve_master_local_for_repair(
    reel: &ReelRow,
    videos_path: &Path,
) -> Result<(PathBuf, bool), String> {
    let file_name = if !reel.file_name.trim().is_empty() {
        reel.file_name.clone()
    } else if let Some(url) = reel.video_url.as_ref() {
        url.rsplit('/').next().unwrap_or("").to_string()
    } else {
        return Err("missing file_name and video_url".into());
    };

    if file_name.is_empty() {
        return Err("empty master basename".into());
    }

    let local = videos_path.join(&file_name);
    if local.is_file() {
        return Ok((local, false));
    }

    let r2 = crate::storage::r2::R2Storage::global()
        .ok_or_else(|| "master not local and R2 not configured".to_string())?;

    let ext = Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| matches!(e.as_str(), "mp4" | "mov" | "m4v" | "mkv" | "webm"))
        .unwrap_or_else(|| "mp4".to_string());
    let tmp = videos_path.join(format!("{}.repair.{}", reel.id, ext));
    r2.download_to_path(&file_name, &tmp)
        .await
        .map_err(|e| format!("r2_download_master: {}", e))?;
    Ok((tmp, true))
}

/// Apply repair for reels in buckets that need work (missing / incomplete / ready-without-object).
pub async fn repair_reel(
    pool: &PgPool,
    reel: &ReelRow,
    videos_path: &Path,
) -> MaterializeOutcome {
    match resolve_master_local_for_repair(reel, videos_path).await {
        Ok((path, cleanup)) => {
            let out = materialize_playback_derivative(pool, reel, videos_path, Some(path.as_path()))
                .await;
            if cleanup {
                let _ = tokio::fs::remove_file(&path).await;
            }
            out
        }
        Err(e) => {
            let _ = reels::set_playback_derivative(
                pool,
                reel.id,
                None,
                STATUS_FAILED,
                None,
                Some(transcode::PLAYBACK_PROFILE_WEB_720P_H264),
                None,
            )
            .await;
            MaterializeOutcome {
                kind: MaterializeOutcomeKind::Failed,
                reel_id: reel.id,
                message: e,
                playback_url: None,
                playback_file_name: None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn sample_row(
        status: &str,
        validated: bool,
        video_url: Option<&str>,
        file_name: &str,
        pb_status: Option<&str>,
        pb_url: Option<&str>,
    ) -> ReelRow {
        ReelRow {
            id: Uuid::parse_str("615e0eae-47b4-468a-b6dd-a6846b464846").unwrap(),
            title: "test".into(),
            category: "x".into(),
            description: None,
            video_url: video_url.map(|s| s.to_string()),
            thumbnail_url: None,
            status: status.into(),
            error_message: None,
            file_name: file_name.into(),
            file_size: Some(100),
            mime_type: Some("video/mp4".into()),
            validated,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            playback_url: pb_url.map(|s| s.to_string()),
            playback_status: pb_status.map(|s| s.to_string()),
            playback_file_size: None,
            playback_profile: None,
            playback_file_name: None,
        }
    }

    #[test]
    fn classifies_ready_master_missing_playback() {
        let row = sample_row(
            "ready",
            true,
            Some("https://cdn.example/prod/x.mp4"),
            "x.mp4",
            None,
            None,
        );
        assert_eq!(
            classify_reel(&row).bucket,
            PlaybackInventoryBucket::ReadyMasterMissingPlayback
        );
    }

    #[test]
    fn classifies_ready_playback_contract() {
        let row = sample_row(
            "ready",
            true,
            Some("https://cdn.example/prod/x.mp4"),
            "x.mp4",
            Some("ready"),
            Some("https://cdn.example/prod/x.playback.mp4"),
        );
        assert_eq!(
            classify_reel(&row).bucket,
            PlaybackInventoryBucket::ReadyPlayback
        );
        assert!(is_playback_contract_ready(Some("ready"), Some("https://x")));
        assert!(!is_playback_contract_ready(Some("ready"), Some("")));
        assert!(!is_playback_contract_ready(Some("failed"), Some("https://x")));
    }

    #[test]
    fn classifies_incomplete_and_missing_master() {
        let incomplete = sample_row(
            "ready",
            true,
            Some("https://cdn.example/prod/x.mp4"),
            "x.mp4",
            Some("failed"),
            None,
        );
        assert_eq!(
            classify_reel(&incomplete).bucket,
            PlaybackInventoryBucket::IncompletePlayback
        );

        let bad = sample_row("ready", true, Some("https://cdn.example/thumbs/x.jpg"), "x.jpg", None, None);
        assert_eq!(
            classify_reel(&bad).bucket,
            PlaybackInventoryBucket::MissingOrInvalidMaster
        );
    }

    #[test]
    fn object_basename_matches_transcode_convention() {
        let id = Uuid::parse_str("615e0eae-47b4-468a-b6dd-a6846b464846").unwrap();
        assert_eq!(
            playback_object_basename(id),
            "615e0eae-47b4-468a-b6dd-a6846b464846.playback.mp4"
        );
    }
}
