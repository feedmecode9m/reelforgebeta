//! Content slot assignments — campaign metadata injector input.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct SlotAssignmentRow {
    pub id: Uuid,
    pub slot_key: String,
    pub campaign_id: Option<Uuid>,
    pub scope_type: String,
    pub scope_id: Option<Uuid>,
    pub status: String,
    pub content_ref: Value,
    pub zone_hint: Option<String>,
    pub start_at: Option<DateTime<Utc>>,
    pub end_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn list_for_scope(
    pool: &PgPool,
    scope_type: &str,
    scope_id: Uuid,
) -> Result<Vec<SlotAssignmentRow>, sqlx::Error> {
    sqlx::query_as::<_, SlotAssignmentRow>(
        r#"
        SELECT * FROM experience_slot_assignments
        WHERE scope_type = $1 AND scope_id = $2
        ORDER BY slot_key
        "#,
    )
    .bind(scope_type)
    .bind(scope_id)
    .fetch_all(pool)
    .await
}
