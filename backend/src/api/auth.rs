//! AUTH-1 HTTP handlers: register, login, logout, me.

use actix_web::{web, HttpRequest, HttpResponse, Responder};
use serde::Deserialize;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::auth::{
    create_user_session, hash_password, load_public_user, resolve_principal, revoke_user_session,
    validate_email, validate_password, verify_password, AdminSessionStore, LoginRateLimiter,
    UserRole,
};

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    /// Optional; ignored for public registration (always viewer). Admins promote offline.
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

fn json_error(status: actix_web::http::StatusCode, code: &str, message: &str) -> HttpResponse {
    HttpResponse::build(status).json(serde_json::json!({
        "success": false,
        "error": code,
        "message": message
    }))
}

fn user_json(user: &crate::auth::PublicUser) -> serde_json::Value {
    serde_json::json!({
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "createdAt": user.created_at,
        "lastLogin": user.last_login
    })
}

/// POST /api/auth/register — always creates role=viewer.
pub async fn register(
    body: web::Json<RegisterRequest>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    limiter: web::Data<LoginRateLimiter>,
) -> impl Responder {
    if !**db_available {
        return json_error(
            actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
            "db_unavailable",
            "Authentication service unavailable",
        );
    }

    let email = match validate_email(&body.email) {
        Ok(e) => e,
        Err(_) => {
            return json_error(
                actix_web::http::StatusCode::BAD_REQUEST,
                "invalid_email",
                "Enter a valid email address",
            )
        }
    };

    if validate_password(&body.password).is_err() {
        return json_error(
            actix_web::http::StatusCode::BAD_REQUEST,
            "invalid_password",
            "Password must be at least 8 characters",
        );
    }

    // Soft rate limit registration by email.
    if !limiter.check_and_record(&format!("reg:{email}")).await {
        return json_error(
            actix_web::http::StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many attempts. Try again later.",
        );
    }

    // Role is always viewer at public registration (ignore spoofed role claims).
    let _ignored_role = body.role.as_ref();
    let role = UserRole::Viewer;

    let password_hash = match hash_password(&body.password) {
        Ok(h) => h,
        Err(_) => {
            return json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "hash_failed",
                "Could not create account",
            )
        }
    };

    let user_id = Uuid::new_v4();
    let insert = sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(role.as_str())
    .execute(db.get_ref())
    .await;

    if let Err(err) = insert {
        let msg = err.to_string().to_ascii_lowercase();
        if msg.contains("unique") || msg.contains("duplicate") {
            return json_error(
                actix_web::http::StatusCode::CONFLICT,
                "email_in_use",
                "An account with this email already exists",
            );
        }
        eprintln!("[AUTH] register insert error: {err}");
        return json_error(
            actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
            "register_failed",
            "Could not create account",
        );
    }

    let (token, expires_at) = match create_user_session(db.get_ref(), user_id).await {
        Ok(pair) => pair,
        Err(err) => {
            eprintln!("[AUTH] session create error: {err}");
            return json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "session_failed",
                "Account created but session failed",
            );
        }
    };

    let user = match load_public_user(db.get_ref(), user_id).await {
        Ok(Some(u)) => u,
        _ => crate::auth::PublicUser {
            id: user_id,
            email: email.clone(),
            role: role.as_str().to_string(),
            created_at: chrono::Utc::now(),
            last_login: None,
        },
    };

    HttpResponse::Created().json(serde_json::json!({
        "success": true,
        "token": token,
        "expiresAt": expires_at,
        "user": user_json(&user)
    }))
}

/// POST /api/auth/login
pub async fn login(
    body: web::Json<LoginRequest>,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    limiter: web::Data<LoginRateLimiter>,
) -> impl Responder {
    if !**db_available {
        return json_error(
            actix_web::http::StatusCode::SERVICE_UNAVAILABLE,
            "db_unavailable",
            "Authentication service unavailable",
        );
    }

    let email = match validate_email(&body.email) {
        Ok(e) => e,
        Err(_) => {
            return json_error(
                actix_web::http::StatusCode::UNAUTHORIZED,
                "invalid_credentials",
                "Invalid email or password",
            )
        }
    };

    if !limiter.check_and_record(&format!("login:{email}")).await {
        return json_error(
            actix_web::http::StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many attempts. Try again later.",
        );
    }

    let row = sqlx::query_as::<_, (Uuid, String, String)>(
        r#"
        SELECT id, password_hash, role FROM users WHERE lower(email) = $1 LIMIT 1
        "#,
    )
    .bind(&email)
    .fetch_optional(db.get_ref())
    .await;

    let (user_id, password_hash, role) = match row {
        Ok(Some(r)) => r,
        Ok(None) => {
            return json_error(
                actix_web::http::StatusCode::UNAUTHORIZED,
                "invalid_credentials",
                "Invalid email or password",
            )
        }
        Err(err) => {
            eprintln!("[AUTH] login query error: {err}");
            return json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "login_failed",
                "Could not sign in",
            );
        }
    };

    if !verify_password(&body.password, &password_hash) {
        return json_error(
            actix_web::http::StatusCode::UNAUTHORIZED,
            "invalid_credentials",
            "Invalid email or password",
        );
    }

    let _ = sqlx::query(
        r#"
        UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1
        "#,
    )
    .bind(user_id)
    .execute(db.get_ref())
    .await;

    let (token, expires_at) = match create_user_session(db.get_ref(), user_id).await {
        Ok(pair) => pair,
        Err(err) => {
            eprintln!("[AUTH] login session error: {err}");
            return json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "session_failed",
                "Could not create session",
            );
        }
    };

    let user = match load_public_user(db.get_ref(), user_id).await {
        Ok(Some(u)) => u,
        _ => crate::auth::PublicUser {
            id: user_id,
            email,
            role,
            created_at: chrono::Utc::now(),
            last_login: Some(chrono::Utc::now()),
        },
    };

    HttpResponse::Ok().json(serde_json::json!({
        "success": true,
        "token": token,
        "expiresAt": expires_at,
        "user": user_json(&user)
    }))
}

/// POST /api/auth/logout — revokes current bearer (user or legacy admin token bookkeeping).
pub async fn logout(
    req: HttpRequest,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> impl Responder {
    if let Some(token) = req
        .headers()
        .get(actix_web::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|raw| {
            let s = raw.trim();
            if s.len() > 7 && s[..7].eq_ignore_ascii_case("bearer ") {
                Some(s[7..].trim().to_string())
            } else {
                None
            }
        })
    {
        admin_sessions.revoke(&token).await;
        if **db_available {
            let _ = revoke_user_session(db.get_ref(), &token).await;
        }
    }

    HttpResponse::Ok().json(serde_json::json!({
        "success": true
    }))
}

/// GET /api/auth/me — restore session on refresh.
pub async fn me(
    req: HttpRequest,
    db: web::Data<Pool<Postgres>>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> impl Responder {
    let principal = resolve_principal(
        &req,
        admin_sessions.get_ref(),
        if **db_available {
            Some(db.get_ref())
        } else {
            None
        },
        **db_available,
    )
    .await;

    let Some(p) = principal else {
        return json_error(
            actix_web::http::StatusCode::UNAUTHORIZED,
            "invalid_session",
            "Not authenticated",
        );
    };

    // Legacy studio admin session (password gate) — synthetic admin principal.
    if p.source == "admin_session" {
        return HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "authenticated": true,
            "source": "admin_session",
            "user": {
                "id": null,
                "email": null,
                "role": "admin",
                "createdAt": null,
                "lastLogin": null
            }
        }));
    }

    let user_id = match p.user_id {
        Some(id) => id,
        None => {
            return json_error(
                actix_web::http::StatusCode::UNAUTHORIZED,
                "invalid_session",
                "Not authenticated",
            )
        }
    };

    match load_public_user(db.get_ref(), user_id).await {
        Ok(Some(user)) => HttpResponse::Ok().json(serde_json::json!({
            "success": true,
            "authenticated": true,
            "source": "user_session",
            "user": user_json(&user)
        })),
        Ok(None) => json_error(
            actix_web::http::StatusCode::UNAUTHORIZED,
            "invalid_session",
            "Not authenticated",
        ),
        Err(err) => {
            eprintln!("[AUTH] me load error: {err}");
            json_error(
                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
                "me_failed",
                "Could not load session",
            )
        }
    }
}
