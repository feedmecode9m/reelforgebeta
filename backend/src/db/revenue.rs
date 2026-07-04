use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RevenueProfileRow {
    pub id: String,
    pub profile_type: String,
    pub profile_ref_id: String,
    pub currency: String,
    pub config: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RevenueForecastRow {
    pub id: String,
    pub profile_id: String,
    pub horizon_days: i32,
    pub gross_cents: i64,
    pub net_cents: i64,
    pub growth_rate: f64,
    pub snapshot: Value,
    pub forecasted_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CreatorRevenueRow {
    pub id: String,
    pub creator_id: String,
    pub profile_id: Option<String>,
    pub period_start: Option<NaiveDate>,
    pub period_end: Option<NaiveDate>,
    pub gross_cents: i64,
    pub net_cents: i64,
    pub platform_fee_cents: i64,
    pub metadata: Value,
    pub recorded_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestRevenueProfileInput {
    pub id: Option<String>,
    pub profile_type: String,
    pub profile_ref_id: String,
    pub currency: Option<String>,
    pub config: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct IngestForecastInput {
    pub profile_id: String,
    pub horizon_days: i32,
    pub gross_cents: i64,
    pub net_cents: i64,
    pub growth_rate: f64,
    pub snapshot: Value,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RevenueTotalsRow {
    pub gross_cents: i64,
    pub net_cents: i64,
    pub platform_fee_cents: i64,
}

fn now_millis() -> i64 {
    Utc::now().timestamp_millis()
}

fn normalize_profile_type(profile_type: &str) -> Option<String> {
    let normalized = profile_type.trim().to_lowercase();
    match normalized.as_str() {
        "series" | "creator" | "team" | "platform" => Some(normalized),
        _ => None,
    }
}

pub async fn upsert_profile(
    pool: &PgPool,
    input: &IngestRevenueProfileInput,
) -> Result<Result<RevenueProfileRow, &'static str>, sqlx::Error> {
    let profile_type = match normalize_profile_type(&input.profile_type) {
        Some(v) => v,
        None => return Ok(Err("Invalid profileType")),
    };

    let profile_ref_id = input.profile_ref_id.trim();
    if profile_ref_id.is_empty() {
        return Ok(Err("profileRefId is required"));
    }

    let id = input
        .id
        .clone()
        .unwrap_or_else(|| format!("revprof-{}-{}", profile_type, now_millis()));
    let currency = input
        .currency
        .as_deref()
        .unwrap_or("USD")
        .trim()
        .to_uppercase();
    let config = input.config.clone().unwrap_or_else(|| json!({}));

    let row = sqlx::query_as::<_, RevenueProfileRow>(
        r#"
        INSERT INTO revenue_profiles (
            id, profile_type, profile_ref_id, currency, config
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (profile_type, profile_ref_id)
        DO UPDATE SET
            currency = EXCLUDED.currency,
            config = EXCLUDED.config,
            updated_at = now()
        RETURNING id, profile_type, profile_ref_id, currency, config, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(profile_type)
    .bind(profile_ref_id)
    .bind(currency)
    .bind(config)
    .fetch_one(pool)
    .await?;

    Ok(Ok(row))
}

pub async fn get_profile_by_ref(
    pool: &PgPool,
    profile_type: &str,
    profile_ref_id: &str,
) -> Result<Option<RevenueProfileRow>, sqlx::Error> {
    let normalized = normalize_profile_type(profile_type).unwrap_or_else(|| profile_type.to_string());
    sqlx::query_as::<_, RevenueProfileRow>(
        r#"
        SELECT id, profile_type, profile_ref_id, currency, config, created_at, updated_at
        FROM revenue_profiles
        WHERE profile_type = $1 AND profile_ref_id = $2
        LIMIT 1
        "#,
    )
    .bind(normalized)
    .bind(profile_ref_id)
    .fetch_optional(pool)
    .await
}

pub async fn insert_forecast(
    pool: &PgPool,
    input: &IngestForecastInput,
) -> Result<RevenueForecastRow, sqlx::Error> {
    let id = format!(
        "revforecast-{}-{}-{}",
        input.profile_id,
        input.horizon_days,
        now_millis()
    );
    sqlx::query_as::<_, RevenueForecastRow>(
        r#"
        INSERT INTO revenue_forecasts (
            id, profile_id, horizon_days, gross_cents, net_cents, growth_rate, snapshot
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, profile_id, horizon_days, gross_cents, net_cents, growth_rate, snapshot, forecasted_at, created_at
        "#,
    )
    .bind(id)
    .bind(&input.profile_id)
    .bind(input.horizon_days)
    .bind(input.gross_cents)
    .bind(input.net_cents)
    .bind(input.growth_rate)
    .bind(input.snapshot.clone())
    .fetch_one(pool)
    .await
}

pub async fn list_latest_forecasts_for_profile(
    pool: &PgPool,
    profile_id: &str,
    limit: i64,
) -> Result<Vec<RevenueForecastRow>, sqlx::Error> {
    let bounded_limit = limit.clamp(1, 500);
    sqlx::query_as::<_, RevenueForecastRow>(
        r#"
        SELECT DISTINCT ON (horizon_days)
            id, profile_id, horizon_days, gross_cents, net_cents, growth_rate, snapshot, forecasted_at, created_at
        FROM revenue_forecasts
        WHERE profile_id = $1
        ORDER BY horizon_days, forecasted_at DESC
        LIMIT $2
        "#,
    )
    .bind(profile_id)
    .bind(bounded_limit)
    .fetch_all(pool)
    .await
}

pub async fn get_creator_revenue_rows(
    pool: &PgPool,
    creator_id: &str,
    limit: i64,
) -> Result<Vec<CreatorRevenueRow>, sqlx::Error> {
    let bounded_limit = limit.clamp(1, 500);
    sqlx::query_as::<_, CreatorRevenueRow>(
        r#"
        SELECT
            id, creator_id, profile_id, period_start, period_end,
            gross_cents, net_cents, platform_fee_cents, metadata, recorded_at, created_at
        FROM creator_revenue
        WHERE creator_id = $1
        ORDER BY recorded_at DESC
        LIMIT $2
        "#,
    )
    .bind(creator_id)
    .bind(bounded_limit)
    .fetch_all(pool)
    .await
}

pub async fn get_creator_revenue_totals(
    pool: &PgPool,
    creator_id: &str,
) -> Result<RevenueTotalsRow, sqlx::Error> {
    sqlx::query_as::<_, RevenueTotalsRow>(
        r#"
        SELECT
            COALESCE(SUM(gross_cents), 0)::BIGINT AS gross_cents,
            COALESCE(SUM(net_cents), 0)::BIGINT AS net_cents,
            COALESCE(SUM(platform_fee_cents), 0)::BIGINT AS platform_fee_cents
        FROM creator_revenue
        WHERE creator_id = $1
        "#,
    )
    .bind(creator_id)
    .fetch_one(pool)
    .await
}

pub async fn get_profile_revenue_totals(
    pool: &PgPool,
    profile_id: &str,
) -> Result<RevenueTotalsRow, sqlx::Error> {
    let creator_totals = sqlx::query_as::<_, RevenueTotalsRow>(
        r#"
        SELECT
            COALESCE(SUM(gross_cents), 0)::BIGINT AS gross_cents,
            COALESCE(SUM(net_cents), 0)::BIGINT AS net_cents,
            COALESCE(SUM(platform_fee_cents), 0)::BIGINT AS platform_fee_cents
        FROM creator_revenue
        WHERE profile_id = $1
        "#,
    )
    .bind(profile_id)
    .fetch_one(pool)
    .await?;

    let team_totals = sqlx::query_as::<_, RevenueTotalsRow>(
        r#"
        SELECT
            COALESCE(SUM(gross_cents), 0)::BIGINT AS gross_cents,
            COALESCE(SUM(net_cents), 0)::BIGINT AS net_cents,
            COALESCE(SUM(platform_fee_cents), 0)::BIGINT AS platform_fee_cents
        FROM team_revenue
        WHERE profile_id = $1
        "#,
    )
    .bind(profile_id)
    .fetch_one(pool)
    .await?;

    Ok(RevenueTotalsRow {
        gross_cents: creator_totals.gross_cents + team_totals.gross_cents,
        net_cents: creator_totals.net_cents + team_totals.net_cents,
        platform_fee_cents: creator_totals.platform_fee_cents + team_totals.platform_fee_cents,
    })
}
