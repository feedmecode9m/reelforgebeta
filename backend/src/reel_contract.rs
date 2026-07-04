use serde::Serialize;
use uuid::Uuid;

use crate::db::{self, reels::ReelRow};
use crate::events::{EventBus, ReelEvent};

/// Canonical v1 reel shape — REST list, status poll, and WebSocket CREATED.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReelV1 {
    pub id: String,
    pub name: String,
    pub file_name: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_path: Option<String>,
    pub category: String,
    pub status: String,
    pub validated: bool,
    pub created_at: String,
}

/// GET /api/reels/{id} — ReelV1 plus ingestion poll fields.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReelStatusResponse {
    #[serde(flatten)]
    pub reel: ReelV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub poll_url: String,
}

/// POST /api/reels — unified create response (legacy upload helpers).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedReelResponse {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub url: String,
    pub video_path: String,
    pub thumbnail_path: Option<String>,
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
}

/// Legacy single-file upload response.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub url: String,
    pub size: u64,
}

pub fn contract_v1_enabled() -> bool {
    std::env::var("REELFORGE_CONTRACT_V1")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn ws_full_payload_enabled() -> bool {
    std::env::var("REELFORGE_WS_FULL_PAYLOAD")
        .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
        .unwrap_or(true)
}

pub fn media_type_from_url(url: &str) -> &'static str {
    if url.contains("/videos/") {
        "video"
    } else {
        "image"
    }
}

pub fn display_name_from_filename(filename: &str) -> String {
    let stem = filename
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(filename);
    let name = stem.replace('_', " ");
    if name.is_empty() {
        filename.to_string()
    } else {
        name
    }
}

pub fn row_to_reel_v1(row: &ReelRow) -> ReelV1 {
    let video_url = row.video_url.clone().unwrap_or_default();
    let thumb_rel = row.thumbnail_url.clone().filter(|s| !s.trim().is_empty());
    let thumb_abs = thumb_rel.as_ref().map(|p| db::canonical_media_url(p));

    ReelV1 {
        id: row.id.to_string(),
        name: if row.title.trim().is_empty() {
            "Untitled".to_string()
        } else {
            row.title.clone()
        },
        file_name: row.file_name.clone(),
        media_type: media_type_from_url(&video_url).to_string(),
        url: db::canonical_media_url(&video_url),
        thumbnail_url: thumb_abs,
        thumbnail_path: thumb_rel,
        category: row.category.clone(),
        status: row.status.clone(),
        validated: row.validated,
        created_at: row.created_at.to_rfc3339(),
    }
}

pub fn row_to_status_response(row: &ReelRow) -> ReelStatusResponse {
    ReelStatusResponse {
        reel: row_to_reel_v1(row),
        error_message: row.error_message.clone(),
        poll_url: format!("/api/reels/{}", row.id),
    }
}

/// Publish WebSocket CREATED when a reel reaches ready status.
pub async fn publish_reel_ready(pool: &sqlx::PgPool, reel_id: Uuid, event_bus: &EventBus) {
    let Ok(Some(row)) = crate::db::reels::get_reel_by_id(pool, reel_id).await else {
        return;
    };
    if row.status != "ready" || !row.validated {
        return;
    }
    let reel = row_to_reel_v1(&row);
    event_bus.publish(ReelEvent::Created(reel)).await;
}

pub fn reel_created_ws_json(reel: &ReelV1) -> String {
    let mut value = serde_json::to_value(reel).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(obj) = value.as_object_mut() {
        obj.insert("eventType".to_string(), serde_json::json!("CREATED"));
    }
    value.to_string()
}

pub fn reel_created_ws_json_legacy(reel: &ReelV1) -> String {
    serde_json::json!({
        "type": "CREATED",
        "id": reel.id,
        "title": reel.name,
        "category": reel.category,
        "created_at": reel.created_at,
    })
    .to_string()
}

pub fn upload_image(filename: &str, url: &str, size: u64) -> UploadResponse {
    UploadResponse {
        id: Uuid::new_v4().to_string(),
        name: display_name_from_filename(filename),
        media_type: "image".to_string(),
        url: url.to_string(),
        size,
    }
}

pub fn upload_video(filename: &str, url: &str, size: u64) -> UploadResponse {
    UploadResponse {
        id: Uuid::new_v4().to_string(),
        name: display_name_from_filename(filename),
        media_type: "video".to_string(),
        url: url.to_string(),
        size,
    }
}
