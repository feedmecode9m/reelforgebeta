pub mod ffmpeg;
pub mod reconcile;
pub mod upload;
pub mod worker;

use std::path::PathBuf;
use std::sync::Arc;

use actix_web::HttpResponse;
use sqlx::PgPool;

use crate::db;
use crate::events::EventBus;
use crate::video_stream::{ThumbsDir, VideosDir};

pub struct IngestionConfig {
    pub videos_path: PathBuf,
    pub thumbs_path: PathBuf,
    pub media_base: String,
}

pub struct IngestionService {
    pub pool: PgPool,
    pub config: IngestionConfig,
    pub event_bus: Arc<EventBus>,
}

impl IngestionService {
    pub fn new(pool: PgPool, videos: VideosDir, thumbs: ThumbsDir, event_bus: EventBus) -> Self {
        Self {
            pool,
            config: IngestionConfig {
                videos_path: videos.0,
                thumbs_path: thumbs.0,
                media_base: db::media_public_base(),
            },
            event_bus: Arc::new(event_bus),
        }
    }

    pub fn require_db_response() -> HttpResponse {
        HttpResponse::ServiceUnavailable().json(serde_json::json!({
            "error": "Database required for media ingestion",
            "hint": "Start Postgres and set DATABASE_URL"
        }))
    }
}

pub fn video_extension(filename: &str) -> Option<&'static str> {
    let lower = filename.to_lowercase();
    if lower.ends_with(".mp4") {
        Some(".mp4")
    } else if lower.ends_with(".mov") {
        Some(".mov")
    } else {
        None
    }
}

pub fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        ".mov" => "video/quicktime",
        _ => "video/mp4",
    }
}
