use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEventRow {
    pub id: String,
    pub event_type: String,
    pub user_id: Option<String>,
    pub series_id: Option<String>,
    pub episode_id: Option<String>,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestAnalyticsInput {
    pub id: Option<String>,
    pub event_type: String,
    pub user_id: Option<String>,
    pub series_id: Option<String>,
    pub episode_id: Option<String>,
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestAnalyticsBatch {
    pub events: Vec<IngestAnalyticsInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MostWatchedEpisode {
    pub episode_id: String,
    pub title: String,
    pub views: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsDashboard {
    pub daily_active_viewers: i64,
    pub series_completion_rate: i32,
    pub most_watched_episodes: Vec<MostWatchedEpisode>,
    pub studio_productivity: i64,
    pub publishing_velocity: i64,
    pub generated_at: DateTime<Utc>,
    pub event_count: i64,
}

pub async fn ingest_event(pool: &PgPool, input: &IngestAnalyticsInput) -> Result<AnalyticsEventRow, sqlx::Error> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("evt-{}", uuid::Uuid::new_v4()));
    let payload = input.payload.clone().unwrap_or_else(|| serde_json::json!({}));

    sqlx::query_as(
        r#"
        INSERT INTO analytics_events (id, event_type, user_id, series_id, episode_id, payload)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
            event_type = EXCLUDED.event_type,
            user_id = EXCLUDED.user_id,
            series_id = EXCLUDED.series_id,
            episode_id = EXCLUDED.episode_id,
            payload = EXCLUDED.payload
        RETURNING id, event_type, user_id, series_id, episode_id, payload, created_at
        "#,
    )
    .bind(&id)
    .bind(&input.event_type)
    .bind(&input.user_id)
    .bind(&input.series_id)
    .bind(&input.episode_id)
    .bind(&payload)
    .fetch_one(pool)
    .await
}

pub async fn ingest_events(
    pool: &PgPool,
    events: &[IngestAnalyticsInput],
) -> Result<Vec<AnalyticsEventRow>, sqlx::Error> {
    let mut out = Vec::with_capacity(events.len());
    for event in events {
        out.push(ingest_event(pool, event).await?);
    }
    Ok(out)
}

pub async fn count_events(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(*) FROM analytics_events")
        .fetch_one(pool)
        .await
}

async fn aggregate_dashboard(pool: &PgPool, series_id: Option<&str>) -> Result<AnalyticsDashboard, sqlx::Error> {
    let dau: i64 = if let Some(series_id) = series_id {
        sqlx::query_scalar(
            r#"
            SELECT COUNT(DISTINCT user_id)
            FROM analytics_events
            WHERE user_id IS NOT NULL
              AND created_at >= date_trunc('day', now())
              AND series_id = $1
            "#,
        )
        .bind(series_id)
        .fetch_one(pool)
        .await?
    } else {
        sqlx::query_scalar(
            r#"
            SELECT COUNT(DISTINCT user_id)
            FROM analytics_events
            WHERE user_id IS NOT NULL
              AND created_at >= date_trunc('day', now())
            "#,
        )
        .fetch_one(pool)
        .await?
    };

    let theater_opens: i64 = count_events_today(pool, series_id, "theater_open").await?;
    let completions: i64 = count_events_today(pool, series_id, "episode_completion").await?;
    let completion_denominator = theater_opens.max(completions).max(1);
    let series_completion_rate = ((completions * 100) / completion_denominator).min(100) as i32;

    let studio_usage = count_events_today(pool, series_id, "studio_usage").await?;
    let repair_action = count_events_today(pool, series_id, "repair_action").await?;
    let workflow_completion = count_events_today(pool, series_id, "workflow_completion").await?;
    let studio_productivity = studio_usage + repair_action + workflow_completion;

    let publishing_velocity: i64 = if let Some(series_id) = series_id {
        sqlx::query_scalar(
            r#"
            SELECT COALESCE(SUM(COALESCE((payload->>'value')::bigint, 1)), 0)::bigint
            FROM analytics_events
            WHERE event_type = 'publish_action'
              AND created_at >= now() - interval '7 days'
              AND series_id = $1
            "#,
        )
        .bind(series_id)
        .fetch_one(pool)
        .await?
    } else {
        sqlx::query_scalar(
            r#"
            SELECT COALESCE(SUM(COALESCE((payload->>'value')::bigint, 1)), 0)::bigint
            FROM analytics_events
            WHERE event_type = 'publish_action'
              AND created_at >= now() - interval '7 days'
            "#,
        )
        .fetch_one(pool)
        .await?
    };

    let most_watched = fetch_most_watched(pool, series_id, 5).await?;

    let event_count: i64 = if let Some(series_id) = series_id {
        sqlx::query_scalar("SELECT COUNT(*) FROM analytics_events WHERE series_id = $1")
            .bind(series_id)
            .fetch_one(pool)
            .await?
    } else {
        count_events(pool).await?
    };

    Ok(AnalyticsDashboard {
        daily_active_viewers: dau,
        series_completion_rate,
        most_watched_episodes: most_watched,
        studio_productivity,
        publishing_velocity,
        generated_at: Utc::now(),
        event_count,
    })
}

async fn count_events_today(
    pool: &PgPool,
    series_id: Option<&str>,
    event_type: &str,
) -> Result<i64, sqlx::Error> {
    if let Some(series_id) = series_id {
        sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM analytics_events
            WHERE event_type = $1
              AND created_at >= date_trunc('day', now())
              AND series_id = $2
            "#,
        )
        .bind(event_type)
        .bind(series_id)
        .fetch_one(pool)
        .await
    } else {
        sqlx::query_scalar(
            r#"
            SELECT COUNT(*)
            FROM analytics_events
            WHERE event_type = $1
              AND created_at >= date_trunc('day', now())
            "#,
        )
        .bind(event_type)
        .fetch_one(pool)
        .await
    }
}

async fn fetch_most_watched(
    pool: &PgPool,
    series_id: Option<&str>,
    limit: i64,
) -> Result<Vec<MostWatchedEpisode>, sqlx::Error> {
    let rows: Vec<(Option<String>, Option<String>, Option<String>, i64)> = if let Some(series_id) = series_id {
        sqlx::query_as(
            r#"
            SELECT
                episode_id,
                payload->>'episodeTitle' AS title,
                payload->>'reelId' AS reel_id,
                COUNT(*)::bigint AS views
            FROM analytics_events
            WHERE event_type IN ('theater_open', 'episode_completion')
              AND created_at >= now() - interval '7 days'
              AND series_id = $1
              AND (episode_id IS NOT NULL OR payload->>'reelId' IS NOT NULL)
            GROUP BY episode_id, payload->>'episodeTitle', payload->>'reelId'
            ORDER BY views DESC
            LIMIT $2
            "#,
        )
        .bind(series_id)
        .bind(limit)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            r#"
            SELECT
                episode_id,
                payload->>'episodeTitle' AS title,
                payload->>'reelId' AS reel_id,
                COUNT(*)::bigint AS views
            FROM analytics_events
            WHERE event_type IN ('theater_open', 'episode_completion')
              AND created_at >= now() - interval '7 days'
              AND (episode_id IS NOT NULL OR payload->>'reelId' IS NOT NULL)
            GROUP BY episode_id, payload->>'episodeTitle', payload->>'reelId'
            ORDER BY views DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(pool)
        .await?
    };

    Ok(rows
        .into_iter()
        .map(|(episode_id, title, reel_id, views)| {
            let episode_key = episode_id
                .or(reel_id)
                .unwrap_or_else(|| "unknown".to_string());
            MostWatchedEpisode {
                episode_id: episode_key.clone(),
                title: title.unwrap_or(episode_key),
                views,
            }
        })
        .collect())
}

pub async fn get_dashboard(pool: &PgPool) -> Result<AnalyticsDashboard, sqlx::Error> {
    aggregate_dashboard(pool, None).await
}

pub async fn get_series_analytics(pool: &PgPool, series_id: &str) -> Result<AnalyticsDashboard, sqlx::Error> {
    aggregate_dashboard(pool, Some(series_id)).await
}
