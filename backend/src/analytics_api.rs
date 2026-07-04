use actix_web::{web, HttpResponse};
use sqlx::PgPool;

use crate::db;
use crate::db::analytics::IngestAnalyticsInput;

fn analytics_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Analytics API disabled",
        "hint": "Set REELFORGE_ANALYTICS_API=true to enable"
    }))
}

fn check_analytics_enabled() -> Result<(), HttpResponse> {
    if db::analytics_api_enabled() {
        Ok(())
    } else {
        Err(analytics_disabled())
    }
}

pub async fn analytics_status(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_analytics_enabled() {
        return resp;
    }
    match db::analytics::count_events(pool.get_ref()).await {
        Ok(count) => HttpResponse::Ok().json(serde_json::json!({
            "enabled": true,
            "count": count
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn ingest_analytics(
    pool: web::Data<PgPool>,
    body: web::Json<serde_json::Value>,
) -> HttpResponse {
    if let Err(resp) = check_analytics_enabled() {
        return resp;
    }

    let value = body.into_inner();
    let result = if let Some(events) = value.get("events").and_then(|v| v.as_array()) {
        let parsed: Vec<IngestAnalyticsInput> = match events
            .iter()
            .map(|e| serde_json::from_value(e.clone()))
            .collect::<Result<Vec<_>, _>>()
        {
            Ok(items) => items,
            Err(e) => {
                return HttpResponse::BadRequest().json(serde_json::json!({
                    "error": e.to_string()
                }));
            }
        };
        db::analytics::ingest_events(pool.get_ref(), &parsed)
            .await
            .map(|rows| (rows.len(), rows))
    } else {
        match serde_json::from_value::<IngestAnalyticsInput>(value) {
            Ok(input) => {
                if input.event_type.trim().is_empty() {
                    return HttpResponse::BadRequest().json(serde_json::json!({
                        "error": "eventType is required"
                    }));
                }
                match db::analytics::ingest_event(pool.get_ref(), &input).await {
                    Ok(row) => Ok((1, vec![row])),
                    Err(e) => Err(e),
                }
            }
            Err(e) => {
                return HttpResponse::BadRequest().json(serde_json::json!({
                    "error": e.to_string()
                }));
            }
        }
    };

    match result {
        Ok((count, rows)) => HttpResponse::Created().json(serde_json::json!({
            "ingested": count,
            "events": rows
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn analytics_dashboard(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_analytics_enabled() {
        return resp;
    }
    match db::analytics::get_dashboard(pool.get_ref()).await {
        Ok(dashboard) => HttpResponse::Ok().json(dashboard),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn analytics_series(pool: web::Data<PgPool>, path: web::Path<String>) -> HttpResponse {
    if let Err(resp) = check_analytics_enabled() {
        return resp;
    }
    let series_id = path.into_inner();
    if series_id.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Series id is required"
        }));
    }
    match db::analytics::get_series_analytics(pool.get_ref(), &series_id).await {
        Ok(dashboard) => HttpResponse::Ok().json(dashboard),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
