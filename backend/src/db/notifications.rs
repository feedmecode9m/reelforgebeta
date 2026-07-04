use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

pub const NOTIFICATION_TYPES: &[&str] = &[
    "workflow_assigned",
    "episode_published",
    "asset_missing",
    "readiness_changed",
    "release_approaching",
];

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRow {
    pub id: String,
    pub user_id: String,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub notification_type: String,
    pub message: String,
    pub read: bool,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNotificationInput {
    pub id: Option<String>,
    pub user_id: String,
    #[serde(rename = "type")]
    pub notification_type: String,
    pub message: String,
    pub payload: Option<serde_json::Value>,
}

pub async fn count_notifications(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM notifications")
        .fetch_one(pool)
        .await
}

pub async fn list_notifications(
    pool: &PgPool,
    user_id: &str,
    unread_only: bool,
) -> Result<Vec<NotificationRow>, sqlx::Error> {
    if unread_only {
        sqlx::query_as(
            r#"
            SELECT id, user_id, type, message, read, payload, created_at
            FROM notifications
            WHERE user_id = $1 AND read = false
            ORDER BY created_at DESC
            LIMIT 200
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as(
            r#"
            SELECT id, user_id, type, message, read, payload, created_at
            FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 200
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
    }
}

pub async fn create_notification(
    pool: &PgPool,
    input: &CreateNotificationInput,
) -> Result<NotificationRow, sqlx::Error> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("ntf-{}", uuid::Uuid::new_v4()));
    let payload = input.payload.clone().unwrap_or_else(|| serde_json::json!({}));

    sqlx::query_as(
        r#"
        INSERT INTO notifications (id, user_id, type, message, payload)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            type = EXCLUDED.type,
            message = EXCLUDED.message,
            payload = EXCLUDED.payload
        RETURNING id, user_id, type, message, read, payload, created_at
        "#,
    )
    .bind(&id)
    .bind(&input.user_id)
    .bind(&input.notification_type)
    .bind(&input.message)
    .bind(&payload)
    .fetch_one(pool)
    .await
}

pub async fn mark_notification_read(pool: &PgPool, id: &str) -> Result<Option<NotificationRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        UPDATE notifications
        SET read = true
        WHERE id = $1
        RETURNING id, user_id, type, message, read, payload, created_at
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn mark_all_read(pool: &PgPool, user_id: &str) -> Result<i64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE notifications
        SET read = true
        WHERE user_id = $1 AND read = false
        "#,
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() as i64)
}

pub async fn count_unread(pool: &PgPool, user_id: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(
        r#"
        SELECT COUNT(*)
        FROM notifications
        WHERE user_id = $1 AND read = false
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
}
