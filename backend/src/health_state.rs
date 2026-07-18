//! Cached health snapshot for fast `/health` responses (DEV-HEALTH-2B).

use crate::handlers::{HealthResponse, HealthServices, StorageHealthDetail};
use crate::media_durability::StorageDiagnostics;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HealthRefreshPhase {
    Warming,
    Ready,
}

#[derive(Clone)]
pub struct HealthSnapshot {
    phase: HealthRefreshPhase,
    db_available: bool,
    storage_status: String,
    storage_detail: StorageHealthDetail,
}

pub type SharedHealthState = Arc<RwLock<HealthSnapshot>>;

impl HealthSnapshot {
    pub fn warming(
        public_root: &Path,
        videos_path: &Path,
        thumbs_path: &Path,
        db_available: bool,
    ) -> Self {
        let probe = crate::media_durability::build_storage_probe_diagnostics(
            public_root,
            videos_path,
            thumbs_path,
        );
        Self::from_diagnostics(&probe, db_available, HealthRefreshPhase::Warming)
    }

    pub fn ready(diagnostics: &StorageDiagnostics, db_available: bool) -> Self {
        Self::from_diagnostics(diagnostics, db_available, HealthRefreshPhase::Ready)
    }

    fn from_diagnostics(
        diagnostics: &StorageDiagnostics,
        db_available: bool,
        phase: HealthRefreshPhase,
    ) -> Self {
        let storage_status = if phase == HealthRefreshPhase::Warming {
            "degraded".to_string()
        } else {
            diagnostics.status.clone()
        };

        Self {
            phase,
            db_available,
            storage_status,
            storage_detail: StorageHealthDetail {
                media_root: diagnostics.media_root.clone(),
                videos_path: diagnostics.videos_path.clone(),
                thumbs_path: diagnostics.thumbs_path.clone(),
                writable: diagnostics.writable,
                volume_mounted: diagnostics.volume_mounted,
                ephemeral_storage_risk: diagnostics.ephemeral_storage_risk,
            },
        }
    }

    pub fn to_response(&self) -> HealthResponse {
        let db_ok = self.db_available;
        let ingestion = crate::db::ingestion_v2_enabled();
        let reels_source = if db_ok {
            if ingestion {
                "postgres-ingestion-v2"
            } else {
                "postgres"
            }
        } else {
            "unavailable"
        };

        let overall_status = if self.phase == HealthRefreshPhase::Warming {
            "degraded"
        } else if !db_ok {
            "degraded"
        } else if matches!(
            self.storage_status.as_str(),
            "missing" | "unwritable" | "degraded" | "read_only"
        ) {
            "degraded"
        } else {
            "ok"
        };

        HealthResponse {
            status: overall_status,
            timestamp: chrono::Utc::now().timestamp_millis(),
            service: "reelforge-backend",
            database: if db_ok { "connected" } else { "unavailable" },
            reels_source,
            services: HealthServices {
                db: if db_ok { "connected" } else { "unavailable" },
                storage: self.storage_status.clone(),
                ingestion: if ingestion { "enabled" } else { "disabled" },
                storage_detail: Some(self.storage_detail.clone()),
            },
        }
    }
}

pub fn new_shared_health_state(snapshot: HealthSnapshot) -> SharedHealthState {
    Arc::new(RwLock::new(snapshot))
}

pub struct HealthRefreshContext {
    pub pool: sqlx::PgPool,
    pub db_available: bool,
    pub public_path: PathBuf,
    pub videos_path: PathBuf,
    pub thumbs_path: PathBuf,
    pub event_bus: crate::events::EventBus,
    pub health_state: SharedHealthState,
}

pub async fn run_post_bind_startup(ctx: HealthRefreshContext) {
    let HealthRefreshContext {
        pool,
        db_available,
        public_path,
        videos_path,
        thumbs_path,
        event_bus,
        health_state,
    } = ctx;

    let split_brain_report = if db_available {
        match crate::media_durability::split_brain_from_db(
            &pool,
            &public_path,
            &videos_path,
            &thumbs_path,
        )
        .await
        {
            Ok(report) => Some(report),
            Err(e) => {
                eprintln!("⚠️ Split-brain check skipped: {}", e);
                None
            }
        }
    } else {
        None
    };

    let startup_storage = crate::media_durability::verify_startup_storage(
        &public_path,
        &videos_path,
        &thumbs_path,
        split_brain_report,
    );
    crate::media_durability::log_startup_diagnostics(&startup_storage);

    crate::video_stream::log_media_directory("public/videos", &videos_path);
    crate::video_stream::log_media_directory("public/thumbs", &thumbs_path);
    crate::video_stream::verify_media_directories(&videos_path, &thumbs_path);
    crate::media_seed::log_asset_inventory(&videos_path, &thumbs_path);

    if db_available && crate::db::ingestion_v2_enabled() && crate::db::startup_reconcile_enabled() {
        let reconcile_bus = std::sync::Arc::new(event_bus.clone());
        match crate::ingestion::reconcile::reconcile_videos(
            &pool,
            &videos_path,
            &thumbs_path,
            crate::ingestion::reconcile::ReconcileOptions::startup(),
            Some(reconcile_bus),
        )
        .await
        {
            Ok(report) => {
                println!(
                    "[reconcile] scanned={} imported={} skipped_cataloged={} skipped_invalid={} quarantined={} skipped_duplicate={} jobs_enqueued={} marked_ready={}",
                    report.scanned,
                    report.imported,
                    report.skipped_cataloged,
                    report.skipped_invalid,
                    report.quarantined,
                    report.skipped_duplicate_content,
                    report.jobs_enqueued,
                    report.marked_ready,
                );
                if !report.errors.is_empty() {
                    eprintln!("[reconcile] errors: {:?}", report.errors);
                }
            }
            Err(e) => eprintln!("[reconcile] failed: {}", e),
        }

        let (confirmed, rejected) =
            crate::db::reels::backfill_validated_ready_reels(&pool, &videos_path).await;
        if confirmed > 0 || rejected > 0 {
            println!(
                "[validation-backfill] confirmed={} rejected={}",
                confirmed, rejected
            );
        }
    }

    {
        let mut guard = health_state.write().await;
        *guard = HealthSnapshot::ready(&startup_storage.diagnostics, db_available);
    }
    println!("✅ Health diagnostics cache ready");
}
