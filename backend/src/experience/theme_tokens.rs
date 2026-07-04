//! Theme token sets — RVE theme section source.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct ThemeTokenSetRow {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ThemeTokenRow {
    pub token_key: String,
    pub token_value: Value,
}

pub async fn get_set_by_id(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<ThemeTokenSetRow>, sqlx::Error> {
    sqlx::query_as::<_, ThemeTokenSetRow>(
        "SELECT * FROM theme_token_sets WHERE id = $1 AND status = 'ACTIVE'",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn load_tokens_for_set(
    pool: &PgPool,
    set_id: Uuid,
) -> Result<HashMap<String, Value>, sqlx::Error> {
    let rows = sqlx::query_as::<_, ThemeTokenRow>(
        "SELECT token_key, token_value FROM theme_tokens WHERE token_set_id = $1",
    )
    .bind(set_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.token_key, r.token_value))
        .collect())
}
