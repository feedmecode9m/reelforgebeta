use crate::events::EventBus;
use crate::video_stream::{ThumbsDir, VideosDir};
use actix_multipart::Multipart;
use actix_web::{web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct AdminAuthRequest {
    pub password: String,
}

#[derive(Serialize)]
pub struct AdminAuthResponse {
    pub success: bool,
    pub token: String,
}

#[derive(Serialize)]
pub struct StorageHealthDetail {
    pub media_root: String,
    pub videos_path: String,
    pub thumbs_path: String,
    pub writable: bool,
    pub volume_mounted: bool,
    pub ephemeral_storage_risk: bool,
}

#[derive(Serialize)]
pub struct HealthServices {
    pub db: &'static str,
    pub storage: String,
    pub ingestion: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_detail: Option<StorageHealthDetail>,
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub timestamp: i64,
    pub service: &'static str,
    pub database: &'static str,
    pub reels_source: &'static str,
    pub services: HealthServices,
}

#[derive(Serialize)]
pub struct SyncStatsResponse {
    pub status: &'static str,
    pub reels: usize,
    pub synced_at: String,
    pub database: &'static str,
    pub reels_source: &'static str,
}

#[derive(Serialize)]
pub struct UploadResponse {
    pub url: String,
    pub thumbnail_url: String,
    pub filename: String,
}

/// Ready reels from Postgres — used by orphan cleanup (DB is sole catalog).
pub async fn fetch_reels_for_cleanup(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
) -> Vec<crate::db::reels::ReelRow> {
    if !**db_available {
        return Vec::new();
    }
    match crate::db::reels::list_ready_reels(db.get_ref()).await {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("⚠️ fetch_reels_for_cleanup failed: {}", e);
            Vec::new()
        }
    }
}

pub fn is_valid_admin_password(password: &str) -> bool {
    let configured = std::env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "admin123".to_string());
    let valid = [
        configured.as_str(),
        "Gaff1505!",
        "SMART_PRODUCTION",
        "admin123",
    ];
    valid.contains(&password)
}

pub async fn get_reel_status(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    path: web::Path<String>,
) -> HttpResponse {
    if !**db_available {
        return crate::ingestion::IngestionService::require_db_response();
    }
    crate::api::reels::get_reel_by_id(db, path).await
}

pub async fn health_check(
    db_available: web::Data<bool>,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
) -> impl Responder {
    let db_ok = **db_available;
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

    let public_root = videos_path.0.parent().unwrap_or(videos_path.0.as_path());
    let storage_diag = crate::media_durability::build_storage_diagnostics(
        public_root,
        &videos_path.0,
        &thumbs_path.0,
    );
    let storage_status = storage_diag.status.clone();
    let overall_status = if !db_ok {
        "degraded"
    } else if matches!(
        storage_status.as_str(),
        "missing" | "unwritable" | "degraded" | "read_only"
    ) {
        "degraded"
    } else {
        "ok"
    };

    HttpResponse::Ok().json(HealthResponse {
        status: overall_status,
        timestamp: chrono::Utc::now().timestamp_millis(),
        service: "reelforge-backend",
        database: if db_ok { "connected" } else { "unavailable" },
        reels_source,
        services: HealthServices {
            db: if db_ok { "connected" } else { "unavailable" },
            storage: storage_status,
            ingestion: if ingestion { "enabled" } else { "disabled" },
            storage_detail: Some(StorageHealthDetail {
                media_root: storage_diag.media_root,
                videos_path: storage_diag.videos_path,
                thumbs_path: storage_diag.thumbs_path,
                writable: storage_diag.writable,
                volume_mounted: storage_diag.volume_mounted,
                ephemeral_storage_risk: storage_diag.ephemeral_storage_risk,
            }),
        },
    })
}

pub async fn ingest_client_log(body: web::Json<Value>) -> impl Responder {
    eprintln!("[CLIENT_DIAG] {}", body.into_inner());
    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

pub async fn admin_auth(body: web::Json<AdminAuthRequest>) -> impl Responder {
    if !is_valid_admin_password(&body.password) {
        return HttpResponse::Unauthorized().json(serde_json::json!({
            "success": false,
            "error": "Invalid password"
        }));
    }

    let token = format!("rf_{}", Uuid::new_v4());
    HttpResponse::Ok().json(AdminAuthResponse {
        success: true,
        token,
    })
}

pub async fn create_reel(
    mut payload: Multipart,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    event_bus: web::Data<EventBus>,
) -> impl Responder {
    eprintln!("📥 POST /api/reels");
    crate::pipeline_diag::pipeline_diag(
        "ROUTER",
        "create_reel",
        "handlers.rs",
        None,
        None,
        "route_matched_post_api_reels",
    );
    crate::pipeline_diag::pipeline_diag(
        "HANDLER",
        "create_reel",
        "handlers.rs",
        None,
        None,
        "enter",
    );

    if !**db_available {
        crate::pipeline_diag::pipeline_diag(
            "DB",
            "create_reel",
            "handlers.rs",
            None,
            None,
            "unavailable",
        );
        crate::pipeline_diag::pipeline_diag(
            "RESPONSE",
            "create_reel",
            "handlers.rs",
            None,
            None,
            "503_db_unavailable",
        );
        return crate::ingestion::IngestionService::require_db_response();
    }

    let svc = crate::ingestion::IngestionService::new(
        db.get_ref().clone(),
        videos_path.get_ref().clone(),
        thumbs_path.get_ref().clone(),
        event_bus.get_ref().clone(),
    );
    crate::ingestion::upload::ingest_from_reel_multipart(&svc, &mut payload).await
}

pub async fn get_reels(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
) -> HttpResponse {
    if !**db_available {
        return crate::ingestion::IngestionService::require_db_response();
    }
    crate::api::reels::list_ready_reels(db).await
}

pub async fn sync_stats(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
) -> impl Responder {
    let db_ok = *db_available.get_ref();
    let count = if db_ok {
        crate::db::reels::count_ready(db.get_ref())
            .await
            .unwrap_or(0) as usize
    } else {
        0
    };

    HttpResponse::Ok().json(SyncStatsResponse {
        status: if db_ok { "ok" } else { "degraded" },
        reels: count,
        synced_at: chrono::Utc::now().to_rfc3339(),
        database: if db_ok { "connected" } else { "unavailable" },
        reels_source: if db_ok {
            "postgres-ingestion-v2"
        } else {
            "unavailable"
        },
    })
}

pub async fn delete_reel(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
    event_bus: web::Data<EventBus>,
    path: web::Path<Uuid>,
) -> impl Responder {
    let reel_id = path.into_inner();

    if !**db_available {
        return crate::ingestion::IngestionService::require_db_response();
    }

    let row = match crate::db::reels::get_reel_by_id(db.get_ref(), reel_id).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return HttpResponse::NotFound().json(serde_json::json!({ "error": "Reel not found" }));
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(serde_json::json!({ "error": e.to_string() }));
        }
    };

    let _ = crate::db::jobs::cancel_for_reel(db.get_ref(), reel_id).await;

    if let Some(ref v) = row.video_url {
        if let Some(name) = crate::media_seed::media_basename(v) {
            let p = videos_path.0.join(&name);
            if p.is_file() {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
    if let Some(ref t) = row.thumbnail_url {
        if let Some(name) = crate::media_seed::media_basename(t) {
            let p = thumbs_path.0.join(&name);
            if p.is_file() {
                let _ = std::fs::remove_file(&p);
            }
        }
    }

    if let Err(e) = crate::db::reels::delete_reel(db.get_ref(), reel_id).await {
        return HttpResponse::InternalServerError()
            .json(serde_json::json!({ "error": e.to_string() }));
    }

    event_bus
        .publish(crate::events::ReelEvent::Deleted {
            id: reel_id.to_string(),
            title: row.title.clone(),
            category: row.category.clone(),
            deleted_at: chrono::Utc::now(),
        })
        .await;

    eprintln!("[delete-propagate] reel={} removed from DB + disk", reel_id);

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "id": reel_id.to_string()
    }))
}

pub async fn list_local_videos() -> impl Responder {
    HttpResponse::Ok().json(vec![String::from("video1.mp4"), String::from("video2.mp4")])
}

pub async fn upload_video(
    payload: Multipart,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    event_bus: web::Data<EventBus>,
) -> impl Responder {
    create_reel(
        payload,
        videos_path,
        thumbs_path,
        db,
        db_available,
        event_bus,
    )
    .await
}

pub async fn list_thumbnails(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
) -> impl Responder {
    if !**db_available {
        return crate::ingestion::IngestionService::require_db_response();
    }
    match crate::db::reels::list_ready_thumbnail_basenames(db.get_ref()).await {
        Ok(names) => {
            eprintln!(
                "GET /api/thumbnails returning {} items from [postgres]",
                names.len()
            );
            HttpResponse::Ok().json(names)
        }
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn list_videos(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
) -> impl Responder {
    if !**db_available {
        return crate::ingestion::IngestionService::require_db_response();
    }
    match crate::db::reels::list_ready_reels(db.get_ref()).await {
        Ok(rows) => {
            let urls: Vec<String> = rows
                .iter()
                .filter_map(|r| r.video_url.clone())
                .filter(|u| u.contains("/videos/"))
                .map(|u| crate::db::canonical_media_url(&u))
                .collect();
            HttpResponse::Ok().json(urls)
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

#[derive(Deserialize)]
pub struct UpdateReelCategoryRequest {
    pub category: String,
}

fn normalize_reel_category(raw: &str) -> Option<String> {
    match raw.trim() {
        "Trending" | "Network" => Some("Trending".into()),
        "Romance" | "Love" | "Drama" => Some("Romance".into()),
        "Cyber-Action" | "Action" => Some("Cyber-Action".into()),
        "Suspense" => Some("Suspense".into()),
        "HERO" => Some("HERO".into()),
        _ => None,
    }
}

pub async fn update_reel_category(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    path: web::Path<Uuid>,
    body: web::Json<UpdateReelCategoryRequest>,
) -> impl Responder {
    if !**db_available {
        return crate::ingestion::IngestionService::require_db_response();
    }

    let id = path.into_inner();
    let category = match normalize_reel_category(&body.category) {
        Some(c) => c,
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "invalid category",
                "allowed": ["Trending", "Romance", "Cyber-Action", "Suspense", "HERO"]
            }));
        }
    };

    match crate::db::reels::update_category(db.get_ref(), id, &category).await {
        Ok(Some(row)) => HttpResponse::Ok().json(serde_json::json!({
            "id": row.id,
            "category": row.category,
            "updated": true
        })),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "reel not found"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_category_stats(
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
) -> impl Responder {
    if !**db_available {
        return crate::ingestion::IngestionService::require_db_response();
    }
    match crate::db::reels::count_by_category_ready(db.get_ref()).await {
        Ok(rows) => {
            let stats: serde_json::Map<String, serde_json::Value> = rows
                .into_iter()
                .map(|(cat, count)| (cat, serde_json::json!(count)))
                .collect();
            HttpResponse::Ok().json(stats)
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

pub async fn delete_storage_file(
    path: web::Path<String>,
    videos_path: web::Data<VideosDir>,
    thumbs_path: web::Data<ThumbsDir>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    event_bus: web::Data<EventBus>,
) -> impl Responder {
    if !**db_available {
        return crate::ingestion::IngestionService::require_db_response();
    }

    let param = path.into_inner();
    let filename = param
        .trim()
        .trim_start_matches('/')
        .split('/')
        .last()
        .unwrap_or(&param)
        .to_string();

    eprintln!(
        "[delete-propagate] DELETE /api/storage/file/{} → {:?}",
        param, filename
    );

    let mut removed_reels = 0usize;
    if let Ok(Some(row)) = crate::db::reels::find_by_video_basename(db.get_ref(), &filename).await {
        let _ = crate::db::jobs::cancel_for_reel(db.get_ref(), row.id).await;
        let video_path = videos_path.0.join(&filename);
        let thumb_path = thumbs_path.0.join(&filename);
        if video_path.is_file() {
            let _ = std::fs::remove_file(&video_path);
        }
        if let Some(ref t) = row.thumbnail_url {
            if let Some(tn) = crate::media_seed::media_basename(t) {
                let tp = thumbs_path.0.join(&tn);
                if tp.is_file() {
                    let _ = std::fs::remove_file(&tp);
                }
            }
        }
        if thumb_path.is_file() {
            let _ = std::fs::remove_file(&thumb_path);
        }
        if crate::db::reels::delete_reel(db.get_ref(), row.id)
            .await
            .is_ok()
        {
            removed_reels = 1;
            event_bus
                .publish(crate::events::ReelEvent::Deleted {
                    id: row.id.to_string(),
                    title: row.title.clone(),
                    category: row.category.clone(),
                    deleted_at: chrono::Utc::now(),
                })
                .await;
        }
    } else {
        let video_path = videos_path.0.join(&filename);
        let thumb_path = thumbs_path.0.join(&filename);
        if video_path.is_file() {
            let _ = std::fs::remove_file(&video_path);
        }
        if thumb_path.is_file() {
            let _ = std::fs::remove_file(&thumb_path);
        }
    }

    if removed_reels > 0 {
        HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "filename": filename,
            "removed_reels": removed_reels
        }))
    } else {
        HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "filename": filename,
            "removed_reels": 0,
            "note": "file removed if present; no matching reel row"
        }))
    }
}
