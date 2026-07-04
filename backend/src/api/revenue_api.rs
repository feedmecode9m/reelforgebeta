use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;

use crate::db;
use crate::db::revenue::{IngestForecastInput, IngestRevenueProfileInput, RevenueForecastRow};

const DEFAULT_SERIES_ID: &str = "series-neon-vengeance";
const DEFAULT_FORECAST_HORIZONS: [i32; 3] = [30, 90, 365];
const DEFAULT_FORECAST_GROWTH_RATE: f64 = 0.08;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueDashboardQuery {
    pub series_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueForecastQuery {
    pub series_id: Option<String>,
    pub refresh: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevenueCreatorQuery {
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RevenueKpi {
    id: String,
    label: String,
    cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RevenueDashboardResponse {
    series_id: String,
    currency: String,
    profile_id: String,
    kpis: serde_json::Value,
    forecasts: Vec<RevenueForecastDto>,
    creator_count: i64,
    team_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RevenueForecastDto {
    id: String,
    horizon_days: i32,
    net_cents: i64,
    gross_cents: i64,
    growth_rate: f64,
    label: String,
}

fn revenue_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(json!({
        "error": "Revenue API disabled",
        "hint": "Set REELFORGE_REVENUE_API=true to enable"
    }))
}

fn check_revenue_enabled() -> Result<(), HttpResponse> {
    if db::revenue_api_enabled() {
        Ok(())
    } else {
        Err(revenue_disabled())
    }
}

fn to_forecast_label(horizon_days: i32) -> String {
    match horizon_days {
        30 => "30 day".to_string(),
        90 => "90 day".to_string(),
        365 => "365 day".to_string(),
        n => format!("{n} day"),
    }
}

fn to_forecast_dto(row: RevenueForecastRow) -> RevenueForecastDto {
    RevenueForecastDto {
        id: row.id,
        horizon_days: row.horizon_days,
        net_cents: row.net_cents,
        gross_cents: row.gross_cents,
        growth_rate: row.growth_rate,
        label: to_forecast_label(row.horizon_days),
    }
}

async fn resolve_series_profile(
    pool: &PgPool,
    series_id: &str,
) -> Result<crate::db::revenue::RevenueProfileRow, HttpResponse> {
    if series_id.trim().is_empty() {
        return Err(HttpResponse::BadRequest().json(json!({
            "error": "seriesId is required"
        })));
    }
    let payload = IngestRevenueProfileInput {
        id: None,
        profile_type: "series".to_string(),
        profile_ref_id: series_id.to_string(),
        currency: Some("USD".to_string()),
        config: Some(json!({})),
    };
    match db::revenue::upsert_profile(pool, &payload).await {
        Ok(Ok(profile)) => Ok(profile),
        Ok(Err(msg)) => Err(HttpResponse::BadRequest().json(json!({ "error": msg }))),
        Err(e) => Err(HttpResponse::InternalServerError().json(json!({ "error": e.to_string() }))),
    }
}

async fn ensure_forecasts(
    pool: &PgPool,
    profile_id: &str,
    base_net_cents: i64,
    force_refresh: bool,
) -> Result<Vec<RevenueForecastRow>, HttpResponse> {
    let existing = db::revenue::list_latest_forecasts_for_profile(pool, profile_id, 12)
        .await
        .map_err(|e| HttpResponse::InternalServerError().json(json!({ "error": e.to_string() })))?;

    if !existing.is_empty() && !force_refresh {
        println!(
            "[REVENUE_FORECAST] {}",
            json!({
                "phase": "query_existing",
                "profileId": profile_id,
                "count": existing.len()
            })
        );
        return Ok(existing);
    }

    let monthly_net = base_net_cents.max(1);
    let daily_net = monthly_net as f64 / 30.0;
    let daily_gross = (monthly_net as f64 * 1.15) / 30.0;

    let mut created = Vec::with_capacity(DEFAULT_FORECAST_HORIZONS.len());
    for horizon in DEFAULT_FORECAST_HORIZONS {
        let growth_multiplier = (1.0 + DEFAULT_FORECAST_GROWTH_RATE).powf(horizon as f64 / 30.0);
        let net_cents = (daily_net * horizon as f64 * growth_multiplier).round() as i64;
        let gross_cents = (daily_gross * horizon as f64 * growth_multiplier).round() as i64;
        let row = db::revenue::insert_forecast(
            pool,
            &IngestForecastInput {
                profile_id: profile_id.to_string(),
                horizon_days: horizon,
                gross_cents,
                net_cents,
                growth_rate: DEFAULT_FORECAST_GROWTH_RATE,
                snapshot: json!({
                    "baseMonthlyNetCents": monthly_net,
                    "growthMultiplier": growth_multiplier
                }),
            },
        )
        .await
        .map_err(|e| HttpResponse::InternalServerError().json(json!({ "error": e.to_string() })))?;
        created.push(row);
    }

    println!(
        "[REVENUE_FORECAST] {}",
        json!({
            "phase": "generated",
            "profileId": profile_id,
            "count": created.len(),
            "baseMonthlyNetCents": monthly_net
        })
    );

    Ok(created)
}

pub async fn post_revenue_profile(
    pool: web::Data<PgPool>,
    body: web::Json<IngestRevenueProfileInput>,
) -> HttpResponse {
    if let Err(resp) = check_revenue_enabled() {
        return resp;
    }

    match db::revenue::upsert_profile(pool.get_ref(), &body).await {
        Ok(Ok(profile)) => {
            println!(
                "[REVENUE_API] {}",
                json!({
                    "action": "profile_upsert",
                    "profileId": profile.id,
                    "profileType": profile.profile_type,
                    "profileRefId": profile.profile_ref_id
                })
            );
            HttpResponse::Ok().json(json!({
                "ok": true,
                "profile": profile
            }))
        }
        Ok(Err(msg)) => HttpResponse::BadRequest().json(json!({ "error": msg })),
        Err(e) => HttpResponse::InternalServerError().json(json!({ "error": e.to_string() })),
    }
}

pub async fn get_revenue_dashboard(
    pool: web::Data<PgPool>,
    query: web::Query<RevenueDashboardQuery>,
) -> HttpResponse {
    if let Err(resp) = check_revenue_enabled() {
        return resp;
    }

    let series_id = query
        .series_id
        .as_deref()
        .unwrap_or(DEFAULT_SERIES_ID)
        .to_string();
    let profile = match resolve_series_profile(pool.get_ref(), &series_id).await {
        Ok(profile) => profile,
        Err(resp) => return resp,
    };

    let totals = match db::revenue::get_profile_revenue_totals(pool.get_ref(), &profile.id).await {
        Ok(v) => v,
        Err(e) => return HttpResponse::InternalServerError().json(json!({ "error": e.to_string() })),
    };

    let creator_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT creator_id)::BIGINT FROM creator_revenue WHERE profile_id = $1",
    )
    .bind(&profile.id)
    .fetch_one(pool.get_ref())
    .await
    .unwrap_or(0);

    let team_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(DISTINCT team_id)::BIGINT FROM team_revenue WHERE profile_id = $1")
            .bind(&profile.id)
            .fetch_one(pool.get_ref())
            .await
            .unwrap_or(0);

    let mrr = totals.net_cents.max(0);
    let arr = mrr * 12;
    let forecasts = match ensure_forecasts(pool.get_ref(), &profile.id, mrr, false).await {
        Ok(rows) => rows.into_iter().map(to_forecast_dto).collect::<Vec<_>>(),
        Err(resp) => return resp,
    };

    println!(
        "[REVENUE_SYNC] {}",
        json!({
            "action": "dashboard_sync",
            "seriesId": series_id,
            "profileId": profile.id,
            "mrrCents": mrr,
            "arrCents": arr,
            "creatorCount": creator_count,
            "teamCount": team_count
        })
    );
    println!(
        "[REVENUE_API] {}",
        json!({
            "action": "dashboard_query",
            "seriesId": series_id,
            "profileId": profile.id
        })
    );

    let response = RevenueDashboardResponse {
        series_id,
        currency: profile.currency,
        profile_id: profile.id,
        kpis: json!({
            "mrr": RevenueKpi { id: "mrr".to_string(), label: "MRR".to_string(), cents: mrr },
            "arr": RevenueKpi { id: "arr".to_string(), label: "ARR".to_string(), cents: arr },
            "seriesRevenue": RevenueKpi {
                id: "series-revenue".to_string(),
                label: "Series Revenue".to_string(),
                cents: totals.gross_cents
            },
            "revenuePerCreator": RevenueKpi {
                id: "revenue-per-creator".to_string(),
                label: "Revenue Per Creator".to_string(),
                cents: if creator_count > 0 { mrr / creator_count } else { 0 }
            },
            "revenuePerTeam": RevenueKpi {
                id: "revenue-per-team".to_string(),
                label: "Revenue Per Team".to_string(),
                cents: if team_count > 0 { mrr / team_count } else { 0 }
            }
        }),
        forecasts,
        creator_count,
        team_count,
    };
    HttpResponse::Ok().json(response)
}

pub async fn get_revenue_forecast(
    pool: web::Data<PgPool>,
    query: web::Query<RevenueForecastQuery>,
) -> HttpResponse {
    if let Err(resp) = check_revenue_enabled() {
        return resp;
    }

    let series_id = query
        .series_id
        .as_deref()
        .unwrap_or(DEFAULT_SERIES_ID)
        .to_string();
    let profile = match resolve_series_profile(pool.get_ref(), &series_id).await {
        Ok(profile) => profile,
        Err(resp) => return resp,
    };

    let totals = match db::revenue::get_profile_revenue_totals(pool.get_ref(), &profile.id).await {
        Ok(v) => v,
        Err(e) => return HttpResponse::InternalServerError().json(json!({ "error": e.to_string() })),
    };

    let rows = match ensure_forecasts(
        pool.get_ref(),
        &profile.id,
        totals.net_cents,
        query.refresh.unwrap_or(false),
    )
    .await
    {
        Ok(rows) => rows,
        Err(resp) => return resp,
    };

    println!(
        "[REVENUE_API] {}",
        json!({
            "action": "forecast_query",
            "seriesId": series_id,
            "profileId": profile.id,
            "count": rows.len()
        })
    );

    HttpResponse::Ok().json(json!({
        "seriesId": series_id,
        "profileId": profile.id,
        "currency": profile.currency,
        "forecasts": rows.into_iter().map(to_forecast_dto).collect::<Vec<_>>()
    }))
}

pub async fn get_creator_revenue(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
    query: web::Query<RevenueCreatorQuery>,
) -> HttpResponse {
    if let Err(resp) = check_revenue_enabled() {
        return resp;
    }

    let creator_id = path.into_inner();
    if creator_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(json!({ "error": "creator id is required" }));
    }
    let limit = query.limit.unwrap_or(100).clamp(1, 500);

    let rows = match db::revenue::get_creator_revenue_rows(pool.get_ref(), &creator_id, limit).await {
        Ok(v) => v,
        Err(e) => return HttpResponse::InternalServerError().json(json!({ "error": e.to_string() })),
    };
    let totals = match db::revenue::get_creator_revenue_totals(pool.get_ref(), &creator_id).await {
        Ok(v) => v,
        Err(e) => return HttpResponse::InternalServerError().json(json!({ "error": e.to_string() })),
    };

    println!(
        "[REVENUE_API] {}",
        json!({
            "action": "creator_query",
            "creatorId": creator_id,
            "rows": rows.len(),
            "limit": limit
        })
    );

    HttpResponse::Ok().json(json!({
        "creatorId": creator_id,
        "totals": totals,
        "items": rows,
        "count": rows.len()
    }))
}
