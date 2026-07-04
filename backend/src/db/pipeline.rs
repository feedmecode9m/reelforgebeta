use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

pub const PIPELINE_STAGES: &[&str] = &[
    "IDEA",
    "SCRIPT",
    "STORYBOARD",
    "PRODUCTION",
    "EDITING",
    "REVIEW",
    "READY",
    "PUBLISHED",
];

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRow {
    pub id: String,
    pub episode_id: String,
    pub stage: String,
    pub assigned_user_id: Option<String>,
    pub approved_by: Option<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePipelineInput {
    pub stage: Option<String>,
    pub assigned_user_id: Option<String>,
    pub approved_by: Option<String>,
}

pub fn stage_index(stage: &str) -> Option<usize> {
    PIPELINE_STAGES.iter().position(|value| *value == stage)
}

pub fn validate_stage(stage: &str) -> Result<(), String> {
    if PIPELINE_STAGES.contains(&stage) {
        Ok(())
    } else {
        Err(format!("Invalid pipeline stage: {stage}"))
    }
}

pub async fn count_pipeline_rows(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM episode_pipeline")
        .fetch_one(pool)
        .await
}

pub async fn list_pipeline(pool: &PgPool, episode_ids: Option<&[String]>) -> Result<Vec<PipelineRow>, sqlx::Error> {
    if let Some(episode_ids) = episode_ids {
        if episode_ids.is_empty() {
            return Ok(vec![]);
        }
        sqlx::query_as(
            r#"
            SELECT id, episode_id, stage, assigned_user_id, approved_by, updated_at
            FROM episode_pipeline
            WHERE episode_id = ANY($1)
            ORDER BY updated_at DESC
            "#,
        )
        .bind(episode_ids)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as(
            r#"
            SELECT id, episode_id, stage, assigned_user_id, approved_by, updated_at
            FROM episode_pipeline
            ORDER BY updated_at DESC
            "#,
        )
        .fetch_all(pool)
        .await
    }
}

pub async fn get_pipeline_for_episode(
    pool: &PgPool,
    episode_id: &str,
) -> Result<Option<PipelineRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, episode_id, stage, assigned_user_id, approved_by, updated_at
        FROM episode_pipeline
        WHERE episode_id = $1
        "#,
    )
    .bind(episode_id)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_pipeline(
    pool: &PgPool,
    episode_id: &str,
    input: &UpdatePipelineInput,
) -> Result<PipelineRow, sqlx::Error> {
    let existing = get_pipeline_for_episode(pool, episode_id).await?;

    let id = existing
        .as_ref()
        .map(|row| row.id.clone())
        .unwrap_or_else(|| format!("pip-{}", uuid::Uuid::new_v4()));

    let current_stage = existing
        .as_ref()
        .map(|row| row.stage.clone())
        .unwrap_or_else(|| "IDEA".to_string());

    let stage = input
        .stage
        .clone()
        .unwrap_or(current_stage.clone());

    if let Err(message) = validate_stage(&stage) {
        return Err(sqlx::Error::Protocol(message));
    }

    if stage == "PUBLISHED" {
        let approved = input
            .approved_by
            .clone()
            .or_else(|| existing.as_ref().and_then(|row| row.approved_by.clone()));
        if current_stage != "READY" && stage != current_stage {
            return Err(sqlx::Error::Protocol(
                "Publishing gate: episode must be in READY stage before PUBLISHED".to_string(),
            ));
        }
        if approved.is_none() {
            return Err(sqlx::Error::Protocol(
                "Publishing gate: review approval required before PUBLISHED".to_string(),
            ));
        }
    }

    if stage == "READY" {
        let approved = input
            .approved_by
            .clone()
            .or_else(|| existing.as_ref().and_then(|row| row.approved_by.clone()));
        if current_stage == "REVIEW" && approved.is_none() {
            return Err(sqlx::Error::Protocol(
                "Review approval required before moving to READY".to_string(),
            ));
        }
    }

    let assigned_user_id = input
        .assigned_user_id
        .clone()
        .or_else(|| existing.as_ref().and_then(|row| row.assigned_user_id.clone()));

    let approved_by = input
        .approved_by
        .clone()
        .or_else(|| existing.as_ref().and_then(|row| row.approved_by.clone()));

    sqlx::query_as(
        r#"
        INSERT INTO episode_pipeline (id, episode_id, stage, assigned_user_id, approved_by, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (episode_id) DO UPDATE SET
            stage = EXCLUDED.stage,
            assigned_user_id = EXCLUDED.assigned_user_id,
            approved_by = EXCLUDED.approved_by,
            updated_at = now()
        RETURNING id, episode_id, stage, assigned_user_id, approved_by, updated_at
        "#,
    )
    .bind(&id)
    .bind(episode_id)
    .bind(&stage)
    .bind(&assigned_user_id)
    .bind(&approved_by)
    .fetch_one(pool)
    .await
}
