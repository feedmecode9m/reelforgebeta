use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct WorkflowTaskRow {
    pub id: String,
    pub series_id: String,
    pub episode_id: Option<String>,
    pub task_type: String,
    pub priority: i32,
    pub status: String,
    pub assigned_to: Option<String>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowTaskDto {
    pub id: String,
    pub series_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episode_id: Option<String>,
    pub task_type: String,
    pub priority: i32,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_to: Option<String>,
    pub created_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "metadata_is_empty")]
    pub metadata: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_impact: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_minutes: Option<i32>,
}

fn metadata_is_empty(value: &serde_json::Value) -> bool {
    value.as_object().map(|o| o.is_empty()).unwrap_or(true)
}

fn row_to_dto(row: WorkflowTaskRow) -> WorkflowTaskDto {
    let title = row.metadata.get("title").and_then(|v| v.as_str()).map(str::to_string);
    let reel_id = row.metadata.get("reelId").and_then(|v| v.as_str()).map(str::to_string);
    let estimated_impact = row
        .metadata
        .get("estimatedImpact")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);
    let estimated_minutes = row
        .metadata
        .get("estimatedMinutes")
        .and_then(|v| v.as_i64())
        .map(|v| v as i32);

    WorkflowTaskDto {
        id: row.id,
        series_id: row.series_id,
        episode_id: row.episode_id,
        task_type: row.task_type,
        priority: row.priority,
        status: row.status,
        assigned_to: row.assigned_to,
        created_at: row.created_at,
        completed_at: row.completed_at,
        metadata: row.metadata,
        title,
        reel_id,
        estimated_impact,
        estimated_minutes,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkflowTaskInput {
    pub id: Option<String>,
    pub series_id: String,
    pub episode_id: Option<String>,
    pub task_type: String,
    pub priority: Option<i32>,
    pub status: Option<String>,
    pub assigned_to: Option<String>,
    pub title: Option<String>,
    pub reel_id: Option<String>,
    pub estimated_impact: Option<i32>,
    pub estimated_minutes: Option<i32>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkflowTaskInput {
    pub series_id: Option<String>,
    pub episode_id: Option<String>,
    pub task_type: Option<String>,
    pub priority: Option<i32>,
    pub status: Option<String>,
    pub assigned_to: Option<String>,
    pub title: Option<String>,
    pub reel_id: Option<String>,
    pub estimated_impact: Option<i32>,
    pub estimated_minutes: Option<i32>,
    pub metadata: Option<serde_json::Value>,
    pub completed_at: Option<DateTime<Utc>>,
}

fn build_metadata(input: &CreateWorkflowTaskInput) -> serde_json::Value {
    let mut meta = input.metadata.clone().unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = meta.as_object_mut() {
        if let Some(title) = &input.title {
            obj.insert("title".to_string(), serde_json::json!(title));
        }
        if let Some(reel_id) = &input.reel_id {
            obj.insert("reelId".to_string(), serde_json::json!(reel_id));
        }
        if let Some(impact) = input.estimated_impact {
            obj.insert("estimatedImpact".to_string(), serde_json::json!(impact));
        }
        if let Some(minutes) = input.estimated_minutes {
            obj.insert("estimatedMinutes".to_string(), serde_json::json!(minutes));
        }
    }
    meta
}

fn merge_metadata(
    existing: &serde_json::Value,
    input: &UpdateWorkflowTaskInput,
) -> serde_json::Value {
    let mut meta = input
        .metadata
        .clone()
        .unwrap_or_else(|| existing.clone());
    if let Some(obj) = meta.as_object_mut() {
        if let Some(title) = &input.title {
            obj.insert("title".to_string(), serde_json::json!(title));
        }
        if let Some(reel_id) = &input.reel_id {
            obj.insert("reelId".to_string(), serde_json::json!(reel_id));
        }
        if let Some(impact) = input.estimated_impact {
            obj.insert("estimatedImpact".to_string(), serde_json::json!(impact));
        }
        if let Some(minutes) = input.estimated_minutes {
            obj.insert("estimatedMinutes".to_string(), serde_json::json!(minutes));
        }
    }
    meta
}

pub async fn list_workflow_tasks(
    pool: &PgPool,
    series_id: Option<&str>,
) -> Result<Vec<WorkflowTaskDto>, sqlx::Error> {
    let rows: Vec<WorkflowTaskRow> = if let Some(series_id) = series_id {
        sqlx::query_as(
            r#"
            SELECT id, series_id, episode_id, task_type, priority, status, assigned_to,
                   created_at, completed_at, metadata
            FROM workflow_tasks
            WHERE series_id = $1
            ORDER BY priority ASC, created_at DESC
            "#,
        )
        .bind(series_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            r#"
            SELECT id, series_id, episode_id, task_type, priority, status, assigned_to,
                   created_at, completed_at, metadata
            FROM workflow_tasks
            ORDER BY priority ASC, created_at DESC
            "#,
        )
        .fetch_all(pool)
        .await?
    };

    Ok(rows.into_iter().map(row_to_dto).collect())
}

pub async fn get_workflow_task(pool: &PgPool, id: &str) -> Result<Option<WorkflowTaskDto>, sqlx::Error> {
    let row: Option<WorkflowTaskRow> = sqlx::query_as(
        r#"
        SELECT id, series_id, episode_id, task_type, priority, status, assigned_to,
               created_at, completed_at, metadata
        FROM workflow_tasks
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(row_to_dto))
}

pub async fn create_workflow_task(
    pool: &PgPool,
    input: &CreateWorkflowTaskInput,
) -> Result<WorkflowTaskDto, sqlx::Error> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("wf-{}", uuid::Uuid::new_v4()));
    let status = input.status.as_deref().unwrap_or("PENDING").to_string();
    let priority = input.priority.unwrap_or(4);
    let metadata = build_metadata(input);

    sqlx::query(
        r#"
        INSERT INTO workflow_tasks (
            id, series_id, episode_id, task_type, priority, status, assigned_to, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
            series_id = EXCLUDED.series_id,
            episode_id = EXCLUDED.episode_id,
            task_type = EXCLUDED.task_type,
            priority = EXCLUDED.priority,
            status = EXCLUDED.status,
            assigned_to = COALESCE(EXCLUDED.assigned_to, workflow_tasks.assigned_to),
            metadata = EXCLUDED.metadata
        "#,
    )
    .bind(&id)
    .bind(&input.series_id)
    .bind(&input.episode_id)
    .bind(&input.task_type)
    .bind(priority)
    .bind(&status)
    .bind(&input.assigned_to)
    .bind(&metadata)
    .execute(pool)
    .await?;

    get_workflow_task(pool, &id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

pub async fn update_workflow_task(
    pool: &PgPool,
    id: &str,
    input: &UpdateWorkflowTaskInput,
) -> Result<Option<WorkflowTaskDto>, sqlx::Error> {
    let existing = get_workflow_task(pool, id).await?;
    let Some(existing) = existing else {
        return Ok(None);
    };

    let series_id = input.series_id.clone().unwrap_or(existing.series_id);
    let episode_id = input.episode_id.clone().or(existing.episode_id);
    let task_type = input
        .task_type
        .clone()
        .unwrap_or(existing.task_type);
    let priority = input.priority.unwrap_or(existing.priority);
    let status = input.status.clone().unwrap_or(existing.status);
    let assigned_to = input.assigned_to.clone().or(existing.assigned_to);
    let metadata = merge_metadata(&existing.metadata, input);

    let completed_at = if status == "COMPLETE" {
        input.completed_at.or(existing.completed_at).or(Some(Utc::now()))
    } else {
        input.completed_at.or(existing.completed_at)
    };

    sqlx::query(
        r#"
        UPDATE workflow_tasks SET
            series_id = $2,
            episode_id = $3,
            task_type = $4,
            priority = $5,
            status = $6,
            assigned_to = $7,
            completed_at = $8,
            metadata = $9
        WHERE id = $1
        "#,
    )
    .bind(id)
    .bind(&series_id)
    .bind(&episode_id)
    .bind(&task_type)
    .bind(priority)
    .bind(&status)
    .bind(&assigned_to)
    .bind(completed_at)
    .bind(&metadata)
    .execute(pool)
    .await?;

    get_workflow_task(pool, id).await
}

pub async fn delete_workflow_task(pool: &PgPool, id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM workflow_tasks WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn count_workflow_tasks(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM workflow_tasks")
        .fetch_one(pool)
        .await
}
