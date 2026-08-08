//! VIEWER-1: consumer profile, playback history, watchlist APIs.
//! Authenticated viewer/admin sessions only. No platform content mutation.

use actix_web::{web, HttpRequest, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres, Row};
use uuid::Uuid;

use crate::auth::{resolve_principal, AdminSessionStore, AuthPrincipal};

const COMPLETE_RATIO: f64 = 0.9;
const MAX_DISPLAY_NAME: usize = 64;
const MAX_AVATAR: usize = 8;
const DEFAULT_HISTORY_LIMIT: i64 = 40;
const MAX_HISTORY_LIMIT: i64 = 100;

fn json_error(status: actix_web::http::StatusCode, code: &str, message: &str) -> HttpResponse {
    HttpResponse::build(status).json(serde_json::json!({
        "success": false,
        "error": code,
        "message": message
    }))
}

async fn require_user_principal(
    req: &HttpRequest,
    db: &web::Data<Pool<Postgres>>,
    db_available: &web::Data<bool>,
    admin_sessions: &web::Data<AdminSessionStore>,
) -> Result<(AuthPrincipal, Uuid), HttpResponse> {
    let db_ok = *db_available.get_ref();
    if !db_ok {
        return Err(json_error(
            actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
            "db_unavailable",
            "Service unavailable",
        ));
    }

    let principal = resolve_principal(
        req,
        admin_sessions.get_ref(),
        Some(db.get_ref()),
        db_ok,
    )
    .await;

    let Some(p) = principal else {
        return Err(json_error(
            actix_web::http::StatusCode::UNAUTHORIZED,
            "unauthorized",
            "Sign in required",
        ));
    };

    let Some(user_id) = p.user_id else {
        return Err(json_error(
            actix_web::http::StatusCode::UNAUTHORIZED,
            "user_session_required",
            "Sign in with your account to use personalization",
        ));
    };

    Ok((p, user_id))
}

/* ──────────────────────────── Profile ──────────────────────────── */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileResponse {
    id: Uuid,
    email: String,
    role: String,
    display_name: Option<String>,
    avatar_placeholder: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    settings: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfileBody {
    pub display_name: Option<String>,
    pub avatar_placeholder: Option<String>,
    pub settings: Option<serde_json::Value>,
}

fn sanitize_display_name(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let s: String = trimmed.chars().take(MAX_DISPLAY_NAME).collect();
    Some(s)
}

fn sanitize_avatar(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let upper: String = trimmed
        .chars()
        .filter(|c| c.is_alphanumeric())
        .take(MAX_AVATAR)
        .collect::<String>()
        .to_uppercase();
    if upper.is_empty() {
        None
    } else {
        Some(upper)
    }
}

fn default_avatar_from_email(email: &str) -> String {
    email
        .chars()
        .next()
        .map(|c| c.to_uppercase().to_string())
        .unwrap_or_else(|| "V".to_string())
}

/// GET /api/account/profile
pub async fn get_profile(
    req: HttpRequest,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> impl Responder {
    let (_, user_id) = match require_user_principal(&req, &db, &db_available, &admin_sessions).await
    {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    match load_profile(db.get_ref(), user_id).await {
        Ok(Some(p)) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "profile": p
        })),
        Ok(None) => json_error(
            actix_web::http::StatusCode::NOT_FOUND,
            "not_found",
            "Profile not found",
        ),
        Err(err) => {
            eprintln!("[VIEWER-1] get_profile: {err}");
            json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "profile_failed",
                "Could not load profile",
            )
        }
    }
}

/// PUT /api/account/profile
pub async fn put_profile(
    req: HttpRequest,
    body: web::Json<UpdateProfileBody>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> impl Responder {
    let (_, user_id) = match require_user_principal(&req, &db, &db_available, &admin_sessions).await
    {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let existing = match load_profile(db.get_ref(), user_id).await {
        Ok(Some(p)) => p,
        Ok(None) => {
            return json_error(
                actix_web::http::StatusCode::NOT_FOUND,
                "not_found",
                "Profile not found",
            )
        }
        Err(err) => {
            eprintln!("[VIEWER-1] put_profile load: {err}");
            return json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "profile_failed",
                "Could not update profile",
            );
        }
    };

    let display_name = if let Some(ref raw) = body.display_name {
        sanitize_display_name(raw)
    } else {
        existing.display_name.clone()
    };

    let avatar_placeholder = if let Some(ref raw) = body.avatar_placeholder {
        sanitize_avatar(raw).or_else(|| Some(default_avatar_from_email(&existing.email)))
    } else {
        existing.avatar_placeholder.clone()
    };

    let settings = body
        .settings
        .clone()
        .filter(|v| v.is_object())
        .unwrap_or(existing.settings.clone());

    let updated = sqlx::query(
        r#"
        UPDATE users
        SET display_name = $2,
            avatar_placeholder = $3,
            settings = $4,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .bind(&display_name)
    .bind(&avatar_placeholder)
    .bind(&settings)
    .execute(db.get_ref())
    .await;

    if let Err(err) = updated {
        eprintln!("[VIEWER-1] put_profile update: {err}");
        return json_error(
            actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
            "profile_failed",
            "Could not update profile",
        );
    }

    match load_profile(db.get_ref(), user_id).await {
        Ok(Some(p)) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "profile": p
        })),
        Ok(None) => json_error(
            actix_web::http::StatusCode::NOT_FOUND,
            "not_found",
            "Profile not found",
        ),
        Err(err) => {
            eprintln!("[VIEWER-1] put_profile reload: {err}");
            json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "profile_failed",
                "Could not load profile",
            )
        }
    }
}

async fn load_profile(
    pool: &Pool<Postgres>,
    user_id: Uuid,
) -> Result<Option<ProfileResponse>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT id, email, role, display_name, avatar_placeholder, created_at, settings
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| {
        let email: String = r.get("email");
        let avatar: Option<String> = r.get("avatar_placeholder");
        ProfileResponse {
            id: r.get("id"),
            email: email.clone(),
            role: r.get("role"),
            display_name: r.get("display_name"),
            avatar_placeholder: avatar.or_else(|| Some(default_avatar_from_email(&email))),
            created_at: r.get("created_at"),
            settings: r
                .try_get::<serde_json::Value, _>("settings")
                .unwrap_or_else(|_| serde_json::json!({})),
        }
    }))
}

/* ──────────────────────────── History ──────────────────────────── */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    #[serde(default)]
    pub include_completed: bool,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    DEFAULT_HISTORY_LIMIT
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertHistoryBody {
    pub reel_id: String,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub completed: Option<bool>,
}

/// GET /api/viewer/history
pub async fn get_history(
    req: HttpRequest,
    query: web::Query<HistoryQuery>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> impl Responder {
    let (_, user_id) = match require_user_principal(&req, &db, &db_available, &admin_sessions).await
    {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let limit = query.limit.clamp(1, MAX_HISTORY_LIMIT);
    let include_completed = query.include_completed;

    let rows = sqlx::query(
        r#"
        SELECT
            h.reel_id,
            h.position_seconds,
            h.duration_seconds,
            h.completed,
            h.last_watched_at,
            r.title AS reel_title,
            r.thumbnail_url,
            r.category
        FROM viewer_playback_history h
        LEFT JOIN reels r ON r.id = h.reel_id
        WHERE h.user_id = $1
          AND ($2::boolean OR h.completed = false)
        ORDER BY h.last_watched_at DESC
        LIMIT $3
        "#,
    )
    .bind(user_id)
    .bind(include_completed)
    .bind(limit)
    .fetch_all(db.get_ref())
    .await;

    match rows {
        Ok(list) => {
            let items: Vec<serde_json::Value> = list
                .into_iter()
                .map(|r| {
                    let reel_id: Uuid = r.get("reel_id");
                    let title: String = r.try_get("reel_title").unwrap_or_default();
                    let display = if title.trim().is_empty() {
                        "Untitled".to_string()
                    } else {
                        title
                    };
                    serde_json::json!({
                        "reelId": reel_id,
                        "title": display,
                        "positionSeconds": r.get::<f64, _>("position_seconds"),
                        "durationSeconds": r.try_get::<Option<f64>, _>("duration_seconds").ok().flatten(),
                        "completed": r.get::<bool, _>("completed"),
                        "lastWatchedAt": r.get::<chrono::DateTime<chrono::Utc>, _>("last_watched_at"),
                        "thumbnailUrl": r.try_get::<Option<String>, _>("thumbnail_url").ok().flatten(),
                        "category": r.try_get::<Option<String>, _>("category").ok().flatten(),
                    })
                })
                .collect();
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "items": items
            }))
        }
        Err(err) => {
            eprintln!("[VIEWER-1] get_history: {err}");
            json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "history_failed",
                "Could not load history",
            )
        }
    }
}

/// POST /api/viewer/history
pub async fn post_history(
    req: HttpRequest,
    body: web::Json<UpsertHistoryBody>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> impl Responder {
    let (_, user_id) = match require_user_principal(&req, &db, &db_available, &admin_sessions).await
    {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let reel_id = match Uuid::parse_str(body.reel_id.trim()) {
        Ok(id) => id,
        Err(_) => {
            return json_error(
                actix_web::http::StatusCode::BAD_REQUEST,
                "invalid_reel_id",
                "Invalid reel id",
            )
        }
    };

    let position = body.position_seconds.unwrap_or(0.0).max(0.0);
    let duration = body.duration_seconds.filter(|d| *d > 0.0);
    let completed = body.completed.unwrap_or_else(|| {
        if let Some(d) = duration {
            d > 0.0 && position / d >= COMPLETE_RATIO
        } else {
            false
        }
    });

    // If completed, store at end unless rewatching from start soon.
    let store_position = if completed {
        duration.unwrap_or(position)
    } else {
        position
    };

    let result = sqlx::query(
        r#"
        INSERT INTO viewer_playback_history (
            user_id, reel_id, position_seconds, duration_seconds, completed,
            last_watched_at, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
        ON CONFLICT (user_id, reel_id) DO UPDATE SET
            position_seconds = EXCLUDED.position_seconds,
            duration_seconds = COALESCE(EXCLUDED.duration_seconds, viewer_playback_history.duration_seconds),
            completed = EXCLUDED.completed,
            last_watched_at = NOW(),
            updated_at = NOW()
        RETURNING position_seconds, duration_seconds, completed, last_watched_at
        "#,
    )
    .bind(user_id)
    .bind(reel_id)
    .bind(store_position)
    .bind(duration)
    .bind(completed)
    .fetch_one(db.get_ref())
    .await;

    match result {
        Ok(row) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "item": {
                "reelId": reel_id,
                "positionSeconds": row.get::<f64, _>("position_seconds"),
                "durationSeconds": row.try_get::<Option<f64>, _>("duration_seconds").ok().flatten(),
                "completed": row.get::<bool, _>("completed"),
                "lastWatchedAt": row.get::<chrono::DateTime<chrono::Utc>, _>("last_watched_at"),
            }
        })),
        Err(err) => {
            let msg = err.to_string().to_ascii_lowercase();
            if msg.contains("foreign key") || msg.contains("violates") {
                return json_error(
                    actix_web::http::StatusCode::BAD_REQUEST,
                    "invalid_reel",
                    "Title not found",
                );
            }
            eprintln!("[VIEWER-1] post_history: {err}");
            json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "history_failed",
                "Could not save history",
            )
        }
    }
}

/* ──────────────────────────── Watchlist ──────────────────────────── */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchlistBody {
    pub reel_id: String,
}

/// GET /api/viewer/watchlist
pub async fn get_watchlist(
    req: HttpRequest,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> impl Responder {
    let (_, user_id) = match require_user_principal(&req, &db, &db_available, &admin_sessions).await
    {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let rows = sqlx::query(
        r#"
        SELECT
            w.reel_id,
            w.created_at,
            r.title AS reel_title,
            r.thumbnail_url,
            r.category
        FROM viewer_watchlist w
        LEFT JOIN reels r ON r.id = w.reel_id
        WHERE w.user_id = $1
        ORDER BY w.created_at DESC
        LIMIT 100
        "#,
    )
    .bind(user_id)
    .fetch_all(db.get_ref())
    .await;

    match rows {
        Ok(list) => {
            let items: Vec<serde_json::Value> = list
                .into_iter()
                .map(|r| {
                    let reel_id: Uuid = r.get("reel_id");
                    let title: String = r.try_get("reel_title").unwrap_or_default();
                    let display = if title.trim().is_empty() {
                        "Untitled".to_string()
                    } else {
                        title
                    };
                    serde_json::json!({
                        "reelId": reel_id,
                        "title": display,
                        "addedAt": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                        "thumbnailUrl": r.try_get::<Option<String>, _>("thumbnail_url").ok().flatten(),
                        "category": r.try_get::<Option<String>, _>("category").ok().flatten(),
                    })
                })
                .collect();
            HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "items": items
            }))
        }
        Err(err) => {
            eprintln!("[VIEWER-1] get_watchlist: {err}");
            json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "watchlist_failed",
                "Could not load My List",
            )
        }
    }
}

/// POST /api/viewer/watchlist
pub async fn post_watchlist(
    req: HttpRequest,
    body: web::Json<WatchlistBody>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> impl Responder {
    let (_, user_id) = match require_user_principal(&req, &db, &db_available, &admin_sessions).await
    {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let reel_id = match Uuid::parse_str(body.reel_id.trim()) {
        Ok(id) => id,
        Err(_) => {
            return json_error(
                actix_web::http::StatusCode::BAD_REQUEST,
                "invalid_reel_id",
                "Invalid reel id",
            )
        }
    };

    let result = sqlx::query(
        r#"
        INSERT INTO viewer_watchlist (user_id, reel_id, created_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id, reel_id) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(reel_id)
    .execute(db.get_ref())
    .await;

    match result {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "reelId": reel_id
        })),
        Err(err) => {
            let msg = err.to_string().to_ascii_lowercase();
            if msg.contains("foreign key") || msg.contains("violates") {
                return json_error(
                    actix_web::http::StatusCode::BAD_REQUEST,
                    "invalid_reel",
                    "Title not found",
                );
            }
            eprintln!("[VIEWER-1] post_watchlist: {err}");
            json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "watchlist_failed",
                "Could not update My List",
            )
        }
    }
}

/// DELETE /api/viewer/watchlist/{id}
pub async fn delete_watchlist(
    req: HttpRequest,
    path: web::Path<String>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> impl Responder {
    let (_, user_id) = match require_user_principal(&req, &db, &db_available, &admin_sessions).await
    {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let reel_id = match Uuid::parse_str(path.as_str().trim()) {
        Ok(id) => id,
        Err(_) => {
            return json_error(
                actix_web::http::StatusCode::BAD_REQUEST,
                "invalid_reel_id",
                "Invalid reel id",
            )
        }
    };

    match sqlx::query(
        r#"
        DELETE FROM viewer_watchlist
        WHERE user_id = $1 AND reel_id = $2
        "#,
    )
    .bind(user_id)
    .bind(reel_id)
    .execute(db.get_ref())
    .await
    {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "reelId": reel_id
        })),
        Err(err) => {
            eprintln!("[VIEWER-1] delete_watchlist: {err}");
            json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "watchlist_failed",
                "Could not update My List",
            )
        }
    }
}

/* ──────────────────────────── Unit helpers / tests ──────────────────────────── */

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_display_name_trims_and_limits() {
        assert_eq!(sanitize_display_name("  Zak  "), Some("Zak".into()));
        assert_eq!(sanitize_display_name("   "), None);
        let long = "a".repeat(100);
        assert_eq!(
            sanitize_display_name(&long).map(|s| s.len()),
            Some(MAX_DISPLAY_NAME)
        );
    }

    #[test]
    fn sanitize_avatar_alnum_upper() {
        assert_eq!(sanitize_avatar("zk"), Some("ZK".into()));
        assert_eq!(sanitize_avatar(" z@1 "), Some("Z1".into()));
        assert_eq!(sanitize_avatar("!!!"), None);
    }

    #[test]
    fn complete_ratio_threshold() {
        assert!((10.0 / 11.0) >= COMPLETE_RATIO);
        assert!((8.0 / 10.0) < COMPLETE_RATIO);
    }
}
