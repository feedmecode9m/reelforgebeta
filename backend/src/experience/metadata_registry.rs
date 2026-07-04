//! Metadata registry — definitions and scoped values.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use super::contract::{validate_metadata_key, RveValidationError};

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct MetadataDefinitionRow {
    pub id: Uuid,
    pub field_key: String,
    pub label: String,
    pub description: Option<String>,
    pub data_type: String,
    pub validation: Value,
    pub scope_levels: Vec<String>,
    pub status: String,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MetadataValueRow {
    pub definition_id: Uuid,
    pub field_key: String,
    pub value_jsonb: Value,
}

pub async fn create_definition(
    pool: &PgPool,
    field_key: &str,
    label: &str,
    data_type: &str,
) -> Result<Result<MetadataDefinitionRow, RveValidationError>, sqlx::Error> {
    if let Err(e) = validate_metadata_key(field_key) {
        return Ok(Err(e));
    }
    let row = sqlx::query_as::<_, MetadataDefinitionRow>(
        r#"
        INSERT INTO metadata_definitions (field_key, label, data_type)
        VALUES ($1, $2, $3)
        RETURNING *
        "#,
    )
    .bind(field_key)
    .bind(label)
    .bind(data_type)
    .fetch_one(pool)
    .await?;
    Ok(Ok(row))
}

pub async fn upsert_value(
    pool: &PgPool,
    definition_id: Uuid,
    scope_type: &str,
    scope_id: Uuid,
    value: Value,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO metadata_values (definition_id, scope_type, scope_id, value_jsonb)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (definition_id, scope_type, scope_id)
        DO UPDATE SET value_jsonb = EXCLUDED.value_jsonb, updated_at = now()
        "#,
    )
    .bind(definition_id)
    .bind(scope_type)
    .bind(scope_id)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

/// Load metadata for a scope chain (episode → season → series → project), caller merges order.
pub async fn list_values_for_scope(
    pool: &PgPool,
    scope_type: &str,
    scope_id: Uuid,
) -> Result<Vec<MetadataValueRow>, sqlx::Error> {
    sqlx::query_as::<_, MetadataValueRow>(
        r#"
        SELECT v.definition_id, d.field_key, v.value_jsonb
        FROM metadata_values v
        JOIN metadata_definitions d ON d.id = v.definition_id
        WHERE v.scope_type = $1 AND v.scope_id = $2 AND d.status = 'ACTIVE'
        "#,
    )
    .bind(scope_type)
    .bind(scope_id)
    .fetch_all(pool)
    .await
}
