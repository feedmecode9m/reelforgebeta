use actix_web::{web, HttpResponse};
use sqlx::PgPool;

use crate::db;
use crate::db::security_events::IngestSecurityEventInput;

fn security_events_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Security events API disabled",
        "hint": "Set REELFORGE_SECURITY_EVENTS_API=true to enable"
    }))
}

fn check_security_events_enabled() -> Result<(), HttpResponse> {
    if db::security_events_api_enabled() {
        Ok(())
    } else {
        Err(security_events_disabled())
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityEventsQuery {
    pub source: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    100
}

pub async fn post_security_event(
    pool: web::Data<PgPool>,
    body: web::Json<IngestSecurityEventInput>,
) -> HttpResponse {
    if let Err(resp) = check_security_events_enabled() {
        return resp;
    }

    let input = body.into_inner();
    if input.source.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "source is required"
        }));
    }
    if input.event_type.trim().is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "eventType is required"
        }));
    }

    match db::security_events::ingest_event(pool.get_ref(), &input).await {
        Ok(event) => {
            println!(
                "[SECURITY_EVENT_INGEST] {}",
                serde_json::json!({
                    "id": event.id,
                    "source": event.source,
                    "eventType": event.event_type,
                    "category": event.category,
                    "severity": event.severity
                })
            );
            HttpResponse::Created().json(serde_json::json!({
                "ok": true,
                "event": event
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_security_events(
    pool: web::Data<PgPool>,
    query: web::Query<SecurityEventsQuery>,
) -> HttpResponse {
    if let Err(resp) = check_security_events_enabled() {
        return resp;
    }
    let source = query
        .source
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let limit = query.limit.max(1).min(500);

    match db::security_events::list_events(pool.get_ref(), limit, source).await {
        Ok(events) => {
            println!(
                "[SECURITY_EVENT_QUERY] {}",
                serde_json::json!({
                    "source": source,
                    "limit": limit,
                    "count": events.len()
                })
            );
            HttpResponse::Ok().json(serde_json::json!({
                "events": events,
                "count": events.len()
            }))
        }
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn security_events_status(pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_security_events_enabled() {
        return resp;
    }
    match db::security_events::count_events(pool.get_ref()).await {
        Ok(count) => HttpResponse::Ok().json(serde_json::json!({
            "enabled": true,
            "count": count
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
