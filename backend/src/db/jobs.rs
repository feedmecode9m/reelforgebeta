use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IngestionJob {
    pub id: Uuid,
    pub reel_id: Uuid,
    pub status: String,
    pub attempts: i32,
    pub max_attempts: i32,
    pub claimed_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn enqueue(pool: &PgPool, reel_id: Uuid) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO ingestion_jobs (id, reel_id, status) VALUES ($1, $2, 'queued')")
        .bind(id)
        .bind(reel_id)
        .execute(pool)
        .await?;
    Ok(id)
}

pub async fn claim_next(pool: &PgPool) -> Result<Option<IngestionJob>, sqlx::Error> {
    let job = sqlx::query_as::<_, IngestionJob>(
        r#"
        UPDATE ingestion_jobs
        SET status = 'claimed', claimed_at = now(), attempts = attempts + 1
        WHERE id = (
            SELECT id FROM ingestion_jobs
            WHERE status = 'queued' AND attempts < max_attempts
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING id, reel_id, status, attempts, max_attempts,
                  claimed_at, completed_at, last_error, created_at
        "#,
    )
    .fetch_optional(pool)
    .await?;
    Ok(job)
}

pub async fn complete(pool: &PgPool, job_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE ingestion_jobs
        SET status = 'completed', completed_at = now(), last_error = NULL
        WHERE id = $1
        "#,
    )
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn fail_job(
    pool: &PgPool,
    job_id: Uuid,
    error: &str,
    retry: bool,
) -> Result<(), sqlx::Error> {
    let status = if retry { "queued" } else { "failed" };
    sqlx::query(
        r#"
        UPDATE ingestion_jobs
        SET status = $2, last_error = $3, claimed_at = NULL
        WHERE id = $1
        "#,
    )
    .bind(job_id)
    .bind(status)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn cancel_for_reel(pool: &PgPool, reel_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE ingestion_jobs SET status = 'failed', last_error = 'cancelled' WHERE reel_id = $1 AND status IN ('queued', 'claimed')",
    )
    .bind(reel_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn queue_depth(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM ingestion_jobs WHERE status IN ('queued', 'claimed')",
    )
    .fetch_one(pool)
    .await
}

pub async fn has_active_job(pool: &PgPool, reel_id: Uuid) -> Result<bool, sqlx::Error> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM ingestion_jobs
            WHERE reel_id = $1 AND status IN ('queued', 'claimed')
        )
        "#,
    )
    .bind(reel_id)
    .fetch_one(pool)
    .await?;
    Ok(exists)
}
