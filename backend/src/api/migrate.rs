use actix_web::{web, HttpResponse, Responder};
use sqlx::PgPool;
use std::sync::Arc;

use crate::events::EventBus;
use crate::handlers;
use crate::ingestion::reconcile::{self, ReconcileOptions};
use crate::video_stream::{ThumbsDir, VideosDir};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateMediaReport {
    pub imported: usize,
    pub skipped_invalid: usize,
    pub skipped_existing: usize,
    pub jobs_enqueued: usize,
    pub errors: Vec<String>,
}

/// POST /api/admin/migrate-media — import on-disk videos into DB + enqueue thumb jobs.
pub async fn migrate_media(
    pool: web::Data<PgPool>,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
    event_bus: web::Data<EventBus>,
    body: web::Json<handlers::AdminAuthRequest>,
) -> impl Responder {
    if !handlers::is_valid_admin_password(&body.password) {
        return HttpResponse::Unauthorized().json(serde_json::json!({
            "error": "Invalid admin password"
        }));
    }

    match reconcile::reconcile_videos(
        pool.get_ref(),
        &videos_path.0,
        &thumbs_path.0,
        ReconcileOptions::migrate(),
        Some(Arc::new(event_bus.get_ref().clone())),
    )
    .await
    {
        Ok(report) => HttpResponse::Ok().json(MigrateMediaReport {
            imported: report.imported,
            skipped_invalid: report.skipped_invalid,
            skipped_existing: report.skipped_existing(),
            jobs_enqueued: report.jobs_enqueued,
            errors: report.errors,
        }),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e
        })),
    }
}
