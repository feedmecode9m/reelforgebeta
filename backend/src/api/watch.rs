use actix_web::{web, HttpRequest, HttpResponse};
use sqlx::PgPool;
use uuid::Uuid;

use crate::db;
use crate::db::watch_events::WatchEventInput;

fn watch_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(serde_json::json!({
        "error": "Watch tracking API disabled",
        "hint": "Set REELFORGE_WATCH_TRACKING=true to enable"
    }))
}

fn check_watch_enabled() -> Result<(), HttpResponse> {
    if db::watch_tracking_enabled() {
        Ok(())
    } else {
        Err(watch_disabled())
    }
}

fn viewer_id_from(req: &HttpRequest, body_viewer: Option<&str>) -> Result<String, HttpResponse> {
    if let Some(h) = req
        .headers()
        .get("X-Reelforge-Viewer-Id")
        .and_then(|v| v.to_str().ok())
    {
        let s = h.trim();
        if !s.is_empty() {
            return Ok(s.to_string());
        }
    }
    if let Some(v) = body_viewer {
        let s = v.trim();
        if !s.is_empty() {
            return Ok(s.to_string());
        }
    }
    Err(HttpResponse::BadRequest().json(serde_json::json!({
        "error": "viewer_id required",
        "hint": "Send X-Reelforge-Viewer-Id header or viewer_id in body"
    })))
}

#[derive(Debug, serde::Deserialize)]
pub struct ViewerQuery {
    pub viewer_id: Option<String>,
    #[serde(default = "default_continue_limit")]
    pub limit: i64,
}

fn default_continue_limit() -> i64 {
    20
}

#[derive(Debug, serde::Deserialize)]
pub struct WatchEventBody {
    pub event_type: String,
    pub episode_id: Option<String>,
    pub reel_id: Option<String>,
    pub session_id: String,
    pub viewer_id: Option<String>,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub ended_at: Option<chrono::DateTime<chrono::Utc>>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
}

pub async fn watch_status(_pool: web::Data<PgPool>) -> HttpResponse {
    if let Err(resp) = check_watch_enabled() {
        return resp;
    }
    HttpResponse::Ok().json(serde_json::json!({
        "enabled": true,
        "event_types": db::watch_events::EVENT_TYPES
    }))
}

pub async fn post_watch_event(
    pool: web::Data<PgPool>,
    req: HttpRequest,
    body: web::Json<WatchEventBody>,
) -> HttpResponse {
    if let Err(resp) = check_watch_enabled() {
        return resp;
    }

    let b = &*body;
    let event_type = b.event_type.trim().to_uppercase();
    if !db::watch_events::is_valid_event_type(&event_type) {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Invalid event_type",
            "allowed": db::watch_events::EVENT_TYPES
        }));
    }

    let viewer_id = match viewer_id_from(&req, b.viewer_id.as_deref()) {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let session_id = match Uuid::parse_str(b.session_id.trim()) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid session_id"
            }))
        }
    };

    let reel_id = match b.reel_id.as_deref() {
        Some(s) => match Uuid::parse_str(s.trim()) {
            Ok(u) => Some(u),
            Err(_) => {
                return HttpResponse::BadRequest().json(serde_json::json!({
                    "error": "Invalid reel_id"
                }))
            }
        },
        None => None,
    };

    let episode_id = match b.episode_id.as_deref() {
        Some(s) => match Uuid::parse_str(s.trim()) {
            Ok(u) => Some(u),
            Err(_) => {
                return HttpResponse::BadRequest().json(serde_json::json!({
                    "error": "Invalid episode_id"
                }))
            }
        },
        None => None,
    };

    let mut resolved_episode = episode_id;
    let mut resolved_reel = reel_id;

    if resolved_episode.is_none() {
        if let Some(rid) = resolved_reel {
            match db::watch_events::resolve_episode_for_reel(pool.get_ref(), rid).await {
                Ok(ep) => resolved_episode = ep,
                Err(e) => {
                    return HttpResponse::InternalServerError().json(serde_json::json!({
                        "error": e.to_string()
                    }))
                }
            }
        }
    }

    if resolved_reel.is_none() {
        if let Some(eid) = resolved_episode {
            match db::watch_events::resolve_reel_for_episode(pool.get_ref(), eid).await {
                Ok(r) => resolved_reel = r,
                Err(e) => {
                    return HttpResponse::InternalServerError().json(serde_json::json!({
                        "error": e.to_string()
                    }))
                }
            }
        }
    }

    if resolved_reel.is_none() {
        return HttpResponse::BadRequest().json(serde_json::json!({
            "error": "reel_id or episode_id required"
        }));
    }

    let input = WatchEventInput {
        event_type,
        episode_id: resolved_episode,
        reel_id: resolved_reel,
        session_id,
        viewer_id,
        started_at: b.started_at,
        ended_at: b.ended_at,
        position_seconds: b.position_seconds.unwrap_or(0.0).max(0.0),
        duration_seconds: b.duration_seconds.map(|d| d.max(0.0)),
    };

    match db::watch_events::insert_watch_event(pool.get_ref(), &input).await {
        Ok(id) => HttpResponse::Ok().json(serde_json::json!({
            "ok": true,
            "event_id": id
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_watch_progress(
    pool: web::Data<PgPool>,
    req: HttpRequest,
    path: web::Path<String>,
    query: web::Query<ViewerQuery>,
) -> HttpResponse {
    if let Err(resp) = check_watch_enabled() {
        return resp;
    }

    let episode_id = match Uuid::parse_str(path.trim()) {
        Ok(u) => u,
        Err(_) => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid episode id"
            }))
        }
    };

    let viewer_id = match query
        .viewer_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            req.headers()
                .get("X-Reelforge-Viewer-Id")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        }) {
        Some(v) => v,
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "viewer_id required",
                "hint": "Send X-Reelforge-Viewer-Id header or ?viewer_id="
            }))
        }
    };

    match db::watch_events::get_progress_by_episode(pool.get_ref(), &viewer_id, episode_id).await {
        Ok(Some(row)) => HttpResponse::Ok().json(row),
        Ok(None) => HttpResponse::NotFound().json(serde_json::json!({
            "error": "No progress for this episode"
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

pub async fn get_continue_watching(
    pool: web::Data<PgPool>,
    req: HttpRequest,
    query: web::Query<ViewerQuery>,
) -> HttpResponse {
    if let Err(resp) = check_watch_enabled() {
        return resp;
    }

    let viewer_id = match query
        .viewer_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            req.headers()
                .get("X-Reelforge-Viewer-Id")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        }) {
        Some(v) => v,
        None => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "viewer_id required"
            }))
        }
    };

    let limit = query.limit.clamp(1, 50);

    match db::watch_events::list_continue_watching(pool.get_ref(), &viewer_id, limit).await {
        Ok(items) => HttpResponse::Ok().json(serde_json::json!({
            "items": items,
            "count": items.len()
        })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}
