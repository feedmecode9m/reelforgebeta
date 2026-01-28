use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use sqlx::types::Json;
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Reel {
    pub id: Uuid,
    pub title: String,
    pub category: String,
    pub episode: i32,
    pub video_url: String,
    pub thumbnail_url: String,
    pub likes: i32,
    pub tags: Vec<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub is_auto_detected: Option<bool>,
    pub detection_confidence: Option<String>, 
    pub ai_tags: Option<Vec<String>>,
    pub cultural_themes: Option<Vec<String>>,
    pub video_metadata: Option<Json<serde_json::Value>>,
    pub status: Option<String>,
    pub views: i32,
    pub shares: i32,
    pub duration: Option<f64>,
    pub resolution: Option<String>,
    pub has_thumbnail: Option<bool>,
    pub upload_source: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CategoryDetection {
    pub category: String,
    pub confidence: f64,
    pub is_auto_detected: bool,
    pub matched_keywords: Vec<String>,
    pub suggested_categories: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateReelRequest {
    pub title: String,
    pub category: String,
    pub video_url: Option<String>,
    pub thumbnail_url: Option<String>,
    pub episode: Option<i32>,
    pub tags: Option<Vec<String>>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub upload_source: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReelQuery {
    pub category: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateReelRequest {
    pub action: String, 
}

#[derive(Debug, Deserialize)]
pub struct CategoryDetectionQuery {
    pub title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StatsPayload {
    pub total_reels: i64,          // Consistently i64
    pub total_likes: Option<i64>,  // Consistently i64
    pub categories: Option<Vec<Category>>,
    pub user_id: Option<String>, 
    pub points: Option<i64>,       // Consistently i64
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Category {
    pub name: String,
    pub item_count: i64,           // Changed to i64 to match SQL COUNT results
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct StudioStats {
    pub id: i32,
    pub total_uploads: i64,
    pub uploads_today: i64,
    pub total_likes: i64,
    pub storage_used: i64,
    pub auto_detected_count: i64, 
}
