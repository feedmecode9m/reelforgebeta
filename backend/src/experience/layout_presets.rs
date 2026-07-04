//! Viewer layout presets (Blueprint System).

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize, serde::Deserialize)]
pub struct LayoutPresetRow {
    pub id: Uuid,
    pub preset_key: String,
    pub name: String,
    pub description: Option<String>,
    pub definition: Value,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn get_by_key(pool: &PgPool, preset_key: &str) -> Result<Option<LayoutPresetRow>, sqlx::Error> {
    sqlx::query_as::<_, LayoutPresetRow>(
        "SELECT * FROM viewer_layout_presets WHERE preset_key = $1 AND status = 'ACTIVE'",
    )
    .bind(preset_key)
    .fetch_optional(pool)
    .await
}

pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<Option<LayoutPresetRow>, sqlx::Error> {
    sqlx::query_as::<_, LayoutPresetRow>(
        "SELECT * FROM viewer_layout_presets WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn list_active(pool: &PgPool) -> Result<Vec<LayoutPresetRow>, sqlx::Error> {
    sqlx::query_as::<_, LayoutPresetRow>(
        "SELECT * FROM viewer_layout_presets WHERE status = 'ACTIVE' ORDER BY preset_key",
    )
    .fetch_all(pool)
    .await
}
