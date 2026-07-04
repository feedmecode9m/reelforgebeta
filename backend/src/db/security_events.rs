use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SecurityEventRow {
    pub id: String,
    pub source: String,
    pub event_type: String,
    pub category: Option<String>,
    pub severity: Option<String>,
    pub title: Option<String>,
    pub message: Option<String>,
    pub series_id: Option<String>,
    pub payload: serde_json::Value,
    pub event_timestamp: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestSecurityEventInput {
    pub id: Option<String>,
    pub source: String,
    pub event_type: String,
    pub category: Option<String>,
    pub severity: Option<String>,
    pub title: Option<String>,
    pub message: Option<String>,
    pub series_id: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub event_timestamp: Option<DateTime<Utc>>,
}

pub async fn ingest_event(
    pool: &PgPool,
    input: &IngestSecurityEventInput,
) -> Result<SecurityEventRow, sqlx::Error> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("sec-{}", uuid::Uuid::new_v4()));
    let payload = input.payload.clone().unwrap_or_else(|| serde_json::json!({}));

    sqlx::query_as(
        r#"
        INSERT INTO security_events (
            id, source, event_type, category, severity, title, message, series_id, payload, event_timestamp
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, now()))
        ON CONFLICT (id) DO UPDATE SET
            source = EXCLUDED.source,
            event_type = EXCLUDED.event_type,
            category = EXCLUDED.category,
            severity = EXCLUDED.severity,
            title = EXCLUDED.title,
            message = EXCLUDED.message,
            series_id = EXCLUDED.series_id,
            payload = EXCLUDED.payload,
            event_timestamp = EXCLUDED.event_timestamp
        RETURNING
            id, source, event_type, category, severity, title, message, series_id, payload, event_timestamp, created_at
        "#,
    )
    .bind(&id)
    .bind(&input.source)
    .bind(&input.event_type)
    .bind(&input.category)
    .bind(&input.severity)
    .bind(&input.title)
    .bind(&input.message)
    .bind(&input.series_id)
    .bind(&payload)
    .bind(input.event_timestamp)
    .fetch_one(pool)
    .await
}

pub async fn list_events(
    pool: &PgPool,
    limit: i64,
    source: Option<&str>,
) -> Result<Vec<SecurityEventRow>, sqlx::Error> {
    if let Some(src) = source {
        sqlx::query_as(
            r#"
            SELECT
                id, source, event_type, category, severity, title, message, series_id, payload, event_timestamp, created_at
            FROM security_events
            WHERE source = $1
            ORDER BY event_timestamp DESC, created_at DESC
            LIMIT $2
            "#,
        )
        .bind(src)
        .bind(limit.max(1).min(500))
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as(
            r#"
            SELECT
                id, source, event_type, category, severity, title, message, series_id, payload, event_timestamp, created_at
            FROM security_events
            ORDER BY event_timestamp DESC, created_at DESC
            LIMIT $1
            "#,
        )
        .bind(limit.max(1).min(500))
        .fetch_all(pool)
        .await
    }
}

pub async fn count_events(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM security_events")
        .fetch_one(pool)
        .await
}
