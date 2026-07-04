use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

pub const EVENT_TYPES: &[&str] = &[
    "PLAY",
    "PAUSE",
    "RESUME",
    "SEEK",
    "COMPLETE",
    "NEXT_EPISODE",
    "EXIT",
];

pub fn is_valid_event_type(t: &str) -> bool {
    EVENT_TYPES.contains(&t)
}

fn completion_percent(position: f64, duration: Option<f64>) -> Option<f64> {
    let d = duration?;
    if d <= 0.0 {
        return None;
    }
    Some(((position / d) * 100.0).clamp(0.0, 100.0))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WatchEventInput {
    pub event_type: String,
    pub episode_id: Option<Uuid>,
    pub reel_id: Option<Uuid>,
    pub session_id: Uuid,
    pub viewer_id: String,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub position_seconds: f64,
    pub duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
pub struct WatchProgressRow {
    pub id: Uuid,
    pub viewer_id: String,
    pub episode_id: Option<Uuid>,
    pub reel_id: Uuid,
    pub session_id: Uuid,
    pub position_seconds: f64,
    pub duration_seconds: Option<f64>,
    pub completion_percent: f64,
    pub last_event_type: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ContinueWatchingItem {
    pub episode_id: Option<Uuid>,
    pub reel_id: Uuid,
    pub session_id: Uuid,
    pub position_seconds: f64,
    pub duration_seconds: Option<f64>,
    pub completion_percent: f64,
    pub updated_at: DateTime<Utc>,
    pub reel_title: Option<String>,
    pub episode_title: Option<String>,
}

pub async fn resolve_reel_for_episode(
    pool: &PgPool,
    episode_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    let row: Option<(Option<Uuid>,)> =
        sqlx::query_as("SELECT reel_id FROM studio_episodes WHERE id = $1")
            .bind(episode_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

pub async fn resolve_episode_for_reel(
    pool: &PgPool,
    reel_id: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM studio_episodes WHERE reel_id = $1 LIMIT 1")
            .bind(reel_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0))
}

pub async fn insert_watch_event(
    pool: &PgPool,
    input: &WatchEventInput,
) -> Result<Uuid, sqlx::Error> {
    let pct = completion_percent(input.position_seconds, input.duration_seconds);

    let id: (Uuid,) = sqlx::query_as(
        r#"
        INSERT INTO watch_events (
            event_type, episode_id, reel_id, session_id, viewer_id,
            started_at, ended_at, position_seconds, duration_seconds, completion_percent
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
        "#,
    )
    .bind(&input.event_type)
    .bind(input.episode_id)
    .bind(input.reel_id)
    .bind(input.session_id)
    .bind(&input.viewer_id)
    .bind(input.started_at)
    .bind(input.ended_at)
    .bind(input.position_seconds)
    .bind(input.duration_seconds)
    .bind(pct)
    .fetch_one(pool)
    .await?;

    if let Some(reel_id) = input.reel_id {
        upsert_watch_progress(pool, input, reel_id, pct).await?;
    }

    Ok(id.0)
}

async fn upsert_watch_progress(
    pool: &PgPool,
    input: &WatchEventInput,
    reel_id: Uuid,
    pct: Option<f64>,
) -> Result<(), sqlx::Error> {
    let completion = pct.unwrap_or(0.0);

    if let Some(episode_id) = input.episode_id {
        sqlx::query(
            r#"
            INSERT INTO watch_progress (
                viewer_id, episode_id, reel_id, session_id,
                position_seconds, duration_seconds, completion_percent,
                last_event_type, started_at, ended_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
            ON CONFLICT (viewer_id, episode_id) WHERE episode_id IS NOT NULL
            DO UPDATE SET
                reel_id = EXCLUDED.reel_id,
                session_id = EXCLUDED.session_id,
                position_seconds = EXCLUDED.position_seconds,
                duration_seconds = COALESCE(EXCLUDED.duration_seconds, watch_progress.duration_seconds),
                completion_percent = EXCLUDED.completion_percent,
                last_event_type = EXCLUDED.last_event_type,
                started_at = COALESCE(EXCLUDED.started_at, watch_progress.started_at),
                ended_at = EXCLUDED.ended_at,
                updated_at = now()
            "#,
        )
        .bind(&input.viewer_id)
        .bind(episode_id)
        .bind(reel_id)
        .bind(input.session_id)
        .bind(input.position_seconds)
        .bind(input.duration_seconds)
        .bind(completion)
        .bind(&input.event_type)
        .bind(input.started_at)
        .bind(input.ended_at)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            r#"
            INSERT INTO watch_progress (
                viewer_id, episode_id, reel_id, session_id,
                position_seconds, duration_seconds, completion_percent,
                last_event_type, started_at, ended_at, updated_at
            )
            VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, now())
            ON CONFLICT (viewer_id, reel_id) WHERE episode_id IS NULL
            DO UPDATE SET
                session_id = EXCLUDED.session_id,
                position_seconds = EXCLUDED.position_seconds,
                duration_seconds = COALESCE(EXCLUDED.duration_seconds, watch_progress.duration_seconds),
                completion_percent = EXCLUDED.completion_percent,
                last_event_type = EXCLUDED.last_event_type,
                started_at = COALESCE(EXCLUDED.started_at, watch_progress.started_at),
                ended_at = EXCLUDED.ended_at,
                updated_at = now()
            "#,
        )
        .bind(&input.viewer_id)
        .bind(reel_id)
        .bind(input.session_id)
        .bind(input.position_seconds)
        .bind(input.duration_seconds)
        .bind(completion)
        .bind(&input.event_type)
        .bind(input.started_at)
        .bind(input.ended_at)
        .execute(pool)
        .await?;
    }

    Ok(())
}

pub async fn get_progress_by_episode(
    pool: &PgPool,
    viewer_id: &str,
    episode_id: Uuid,
) -> Result<Option<WatchProgressRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT id, viewer_id, episode_id, reel_id, session_id,
               position_seconds, duration_seconds, completion_percent,
               last_event_type, started_at, ended_at, updated_at
        FROM watch_progress
        WHERE viewer_id = $1 AND episode_id = $2
        "#,
    )
    .bind(viewer_id)
    .bind(episode_id)
    .fetch_optional(pool)
    .await
}

pub async fn list_continue_watching(
    pool: &PgPool,
    viewer_id: &str,
    limit: i64,
) -> Result<Vec<ContinueWatchingItem>, sqlx::Error> {
    #[derive(sqlx::FromRow)]
    struct Row {
        episode_id: Option<Uuid>,
        reel_id: Uuid,
        session_id: Uuid,
        position_seconds: f64,
        duration_seconds: Option<f64>,
        completion_percent: f64,
        updated_at: DateTime<Utc>,
        reel_title: Option<String>,
        episode_title: Option<String>,
    }

    let rows: Vec<Row> = sqlx::query_as(
        r#"
        SELECT
            wp.episode_id,
            wp.reel_id,
            wp.session_id,
            wp.position_seconds,
            wp.duration_seconds,
            wp.completion_percent,
            wp.updated_at,
            r.title AS reel_title,
            e.title AS episode_title
        FROM watch_progress wp
        LEFT JOIN reels r ON r.id = wp.reel_id
        LEFT JOIN studio_episodes e ON e.id = wp.episode_id
        WHERE wp.viewer_id = $1
          AND wp.completion_percent < 95
          AND wp.position_seconds > 0
        ORDER BY wp.updated_at DESC
        LIMIT $2
        "#,
    )
    .bind(viewer_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| ContinueWatchingItem {
            episode_id: row.episode_id,
            reel_id: row.reel_id,
            session_id: row.session_id,
            position_seconds: row.position_seconds,
            duration_seconds: row.duration_seconds,
            completion_percent: row.completion_percent,
            updated_at: row.updated_at,
            reel_title: row.reel_title,
            episode_title: row.episode_title,
        })
        .collect())
}
