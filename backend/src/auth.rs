//! Identity + RBAC foundation (AUTH-1 / AUTH-1.1).
//!
//! - Email/password users with bcrypt hashes
//! - Opaque bearer sessions restored via GET /api/auth/me
//! - Roles: viewer | admin (legacy `creator` has no content write powers)
//! - AUTH-1.1: all platform content mutations require admin
//! - Legacy AdminSessionStore still valid for Studio bridge (/admin/auth)

use std::collections::HashMap;
use std::future::{ready, Ready};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use actix_web::body::{BoxBody, MessageBody};
use actix_web::dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform};
use actix_web::http::header;
use actix_web::http::Method;
use actix_web::{web, HttpRequest, HttpResponse};
use futures_util::future::LocalBoxFuture;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres};
use tokio::sync::RwLock;
use uuid::Uuid;

/// Password hashing cost (bcrypt). 12 balances security and Railway latency.
const BCRYPT_COST: u32 = 12;

/// Default user session TTL: 7 days.
const DEFAULT_USER_SESSION_TTL_SECS: i64 = 7 * 24 * 60 * 60;

/// Max failed login attempts per email window before temporary rejection.
const LOGIN_RATE_LIMIT_MAX: u32 = 12;
const LOGIN_RATE_LIMIT_WINDOW_SECS: u64 = 15 * 60;

/* ──────────────────────────── Roles ──────────────────────────── */

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Viewer,
    Creator,
    Admin,
}

impl UserRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Viewer => "viewer",
            Self::Creator => "creator",
            Self::Admin => "admin",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "viewer" => Some(Self::Viewer),
            "creator" => Some(Self::Creator),
            "admin" => Some(Self::Admin),
            _ => None,
        }
    }

    /// Content rank. AUTH-1.1: only admin may mutate platform content.
    /// Legacy `creator` is treated as viewer-level for content mutations.
    pub fn rank(self) -> u8 {
        match self {
            Self::Viewer | Self::Creator => 0,
            Self::Admin => 2,
        }
    }

    pub fn meets(self, required: UserRole) -> bool {
        self.rank() >= required.rank()
    }

    /// True when principal may mutate platform content.
    pub fn can_mutate_content(self) -> bool {
        matches!(self, Self::Admin)
    }
}

impl Default for UserRole {
    fn default() -> Self {
        Self::Viewer
    }
}

/* ──────────────────────────── Public user DTO ──────────────────────────── */

#[derive(Debug, Clone, Serialize)]
pub struct PublicUser {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_login: Option<chrono::DateTime<chrono::Utc>>,
}

/* ──────────────────────────── Legacy admin token store ──────────────────────────── */

#[derive(Debug)]
pub struct AdminSessionStore {
    tokens: RwLock<HashMap<String, i64>>,
    ttl_seconds: i64,
}

impl AdminSessionStore {
    pub fn from_env() -> Self {
        let ttl_seconds = std::env::var("ADMIN_SESSION_TTL_SECONDS")
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(24 * 60 * 60);
        Self {
            tokens: RwLock::new(HashMap::new()),
            ttl_seconds: ttl_seconds.max(60),
        }
    }

    pub async fn register(&self, token: String) {
        let now = now_unix();
        let exp = now + self.ttl_seconds;
        let mut guard = self.tokens.write().await;
        guard.insert(token, exp);
    }

    pub async fn revoke(&self, token: &str) {
        let mut guard = self.tokens.write().await;
        guard.remove(token);
    }

    pub async fn validate(&self, token: &str) -> bool {
        if is_dev_local_session_token(token) {
            return true;
        }

        let now = now_unix();
        let guard = self.tokens.read().await;
        guard
            .get(token)
            .map(|exp| *exp > now)
            .unwrap_or(false)
    }
}

/* ──────────────────────────── Login rate limiter ──────────────────────────── */

#[derive(Debug)]
struct AttemptWindow {
    count: u32,
    window_start: Instant,
}

#[derive(Debug, Default)]
pub struct LoginRateLimiter {
    by_key: RwLock<HashMap<String, AttemptWindow>>,
    hits: AtomicU64,
}

impl LoginRateLimiter {
    pub fn new() -> Self {
        Self {
            by_key: RwLock::new(HashMap::new()),
            hits: AtomicU64::new(0),
        }
    }

    /// Returns false when the key is rate-limited.
    pub async fn check_and_record(&self, key: &str) -> bool {
        self.hits.fetch_add(1, Ordering::Relaxed);
        let mut guard = self.by_key.write().await;
        let now = Instant::now();
        let entry = guard.entry(key.to_ascii_lowercase()).or_insert(AttemptWindow {
            count: 0,
            window_start: now,
        });
        if now.duration_since(entry.window_start)
            > Duration::from_secs(LOGIN_RATE_LIMIT_WINDOW_SECS)
        {
            entry.count = 0;
            entry.window_start = now;
        }
        if entry.count >= LOGIN_RATE_LIMIT_MAX {
            return false;
        }
        entry.count = entry.count.saturating_add(1);
        true
    }
}

/* ──────────────────────────── Password helpers ──────────────────────────── */

pub fn hash_password(password: &str) -> Result<String, String> {
    bcrypt::hash(password, BCRYPT_COST).map_err(|e| format!("hash_failed:{e}"))
}

pub fn verify_password(password: &str, password_hash: &str) -> bool {
    bcrypt::verify(password, password_hash).unwrap_or(false)
}

pub fn validate_email(email: &str) -> Result<String, &'static str> {
    let trimmed = email.trim().to_ascii_lowercase();
    if trimmed.len() < 5 || trimmed.len() > 254 {
        return Err("invalid_email");
    }
    let at = trimmed.find('@').ok_or("invalid_email")?;
    if at == 0 || at == trimmed.len() - 1 {
        return Err("invalid_email");
    }
    if !trimmed[at + 1..].contains('.') {
        return Err("invalid_email");
    }
    if trimmed.chars().any(|c| c.is_whitespace()) {
        return Err("invalid_email");
    }
    Ok(trimmed)
}

pub fn validate_password(password: &str) -> Result<(), &'static str> {
    if password.len() < 8 {
        return Err("password_too_short");
    }
    if password.len() > 128 {
        return Err("password_too_long");
    }
    Ok(())
}

fn generate_session_token() -> String {
    format!("rf_u_{}", Uuid::new_v4())
}

fn user_session_ttl_seconds() -> i64 {
    std::env::var("USER_SESSION_TTL_SECONDS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(DEFAULT_USER_SESSION_TTL_SECS)
        .max(60)
}

/* ──────────────────────────── Session resolution ──────────────────────────── */

#[derive(Debug, Clone)]
pub struct AuthPrincipal {
    pub user_id: Option<Uuid>,
    pub email: Option<String>,
    pub role: UserRole,
    pub token: String,
    pub source: &'static str,
}

pub async fn resolve_principal(
    req: &HttpRequest,
    admin_sessions: &AdminSessionStore,
    pool: Option<&Pool<Postgres>>,
    db_available: bool,
) -> Option<AuthPrincipal> {
    let token = extract_bearer(req)?;

    // Legacy studio admin session tokens.
    if admin_sessions.validate(&token).await {
        return Some(AuthPrincipal {
            user_id: None,
            email: None,
            role: UserRole::Admin,
            token,
            source: "admin_session",
        });
    }

    if !db_available {
        return None;
    }
    let pool = pool?;

    let row = sqlx::query_as::<_, (Uuid, String, String, chrono::DateTime<chrono::Utc>)>(
        r#"
        SELECT u.id, u.email, u.role, s.expires_at
        FROM user_sessions s
        INNER JOIN users u ON u.id = s.user_id
        WHERE s.token = $1
        LIMIT 1
        "#,
    )
    .bind(&token)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()?;

    let (user_id, email, role_raw, expires_at) = row;
    if expires_at <= chrono::Utc::now() {
        let _ = sqlx::query("DELETE FROM user_sessions WHERE token = $1")
            .bind(&token)
            .execute(pool)
            .await;
        return None;
    }

    let role = UserRole::parse(&role_raw).unwrap_or(UserRole::Viewer);
    Some(AuthPrincipal {
        user_id: Some(user_id),
        email: Some(email),
        role,
        token,
        source: "user_session",
    })
}

pub async fn create_user_session(
    pool: &Pool<Postgres>,
    user_id: Uuid,
) -> Result<(String, chrono::DateTime<chrono::Utc>), sqlx::Error> {
    let token = generate_session_token();
    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(user_session_ttl_seconds());
    sqlx::query(
        r#"
        INSERT INTO user_sessions (token, user_id, expires_at)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(&token)
    .bind(user_id)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok((token, expires_at))
}

pub async fn revoke_user_session(pool: &Pool<Postgres>, token: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM user_sessions WHERE token = $1")
        .bind(token)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn load_public_user(
    pool: &Pool<Postgres>,
    user_id: Uuid,
) -> Result<Option<PublicUser>, sqlx::Error> {
    let row = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            chrono::DateTime<chrono::Utc>,
            Option<chrono::DateTime<chrono::Utc>>,
        ),
    >(
        r#"
        SELECT id, email, role, created_at, last_login
        FROM users WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(id, email, role, created_at, last_login)| PublicUser {
        id,
        email,
        role,
        created_at,
        last_login,
    }))
}

/* ──────────────────────────── Route policy ──────────────────────────── */

/// Mutating routes that remain public (viewer telemetry / auth / dev sinks).
fn is_public_mutating_route(method: &Method, path: &str) -> bool {
    if !matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) {
        return true;
    }

    if path.starts_with("/api/auth/") {
        return true;
    }

    matches!(
        path,
        "/api/watch/event"
            | "/api/analytics"
            | "/api/security/events"
            | "/api/dev/client-log"
            | "/api/debug/mobile-trace"
    )
}

/// VIEWER-1 personalization: any authenticated account (viewer or admin user session).
fn is_viewer_self_service_path(path: &str) -> bool {
    path.starts_with("/api/viewer/") || path.starts_with("/api/account/")
}

/// Minimum role required for a mutating `/api/*` path.
/// AUTH-1.1: platform content mutations require **admin**.
/// VIEWER-1: account personalization requires authenticated **viewer** (admin also qualifies).
/// `None` means the route is public (no auth at middleware layer).
pub fn mutating_route_required_role(method: &Method, path: &str) -> Option<UserRole> {
    if is_public_mutating_route(method, path) {
        return None;
    }
    if !matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) {
        return None;
    }

    if is_viewer_self_service_path(path) {
        return Some(UserRole::Viewer);
    }

    // Uploads, reels, vault, hero, studio, publishing — admin only.
    Some(UserRole::Admin)
}

/// Back-compat helper used by existing unit tests / callers.
pub fn mutating_route_requires_admin(method: &Method, path: &str) -> bool {
    matches!(
        mutating_route_required_role(method, path),
        Some(UserRole::Admin)
    )
}

pub async fn require_admin(
    req: &HttpRequest,
    sessions: &AdminSessionStore,
) -> Result<(), HttpResponse> {
    let token = extract_bearer(req).ok_or_else(|| {
        HttpResponse::Unauthorized().json(serde_json::json!({ "error": "missing_authorization" }))
    })?;

    if sessions.validate(&token).await {
        Ok(())
    } else {
        Err(HttpResponse::Unauthorized().json(serde_json::json!({ "error": "invalid_session" })))
    }
}

/* ──────────────────────────── Middleware ──────────────────────────── */

pub struct AdminAuth;

impl<S, B> Transform<S, ServiceRequest> for AdminAuth
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = actix_web::Error;
    type InitError = ();
    type Transform = AdminAuthMiddleware<S>;
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ready(Ok(AdminAuthMiddleware {
            service: Rc::new(service),
        }))
    }
}

pub struct AdminAuthMiddleware<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for AdminAuthMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<BoxBody>;
    type Error = actix_web::Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = self.service.clone();

        Box::pin(async move {
            let required = mutating_route_required_role(req.method(), req.path());
            if let Some(min_role) = required {
                let admin_sessions = req
                    .app_data::<web::Data<AdminSessionStore>>()
                    .cloned()
                    .ok_or_else(|| {
                        actix_web::error::ErrorInternalServerError("admin session store missing")
                    })?;
                let pool = req.app_data::<web::Data<Pool<Postgres>>>().cloned();
                let db_available: bool = req
                    .app_data::<web::Data<bool>>()
                    .map(|d| {
                        // web::Data<T> derefs to T
                        let flag: &bool = d.as_ref();
                        *flag
                    })
                    .unwrap_or(false);

                let principal = resolve_principal(
                    req.request(),
                    admin_sessions.get_ref(),
                    pool.as_ref().map(|p| p.get_ref()),
                    db_available,
                )
                .await;

                match principal {
                    None => {
                        // Preserve legacy frontend invalid_session handling for no/bad token.
                        let has_bearer = extract_bearer(req.request()).is_some();
                        let body = if has_bearer {
                            serde_json::json!({
                                "error": "invalid_session",
                                "message": "Session expired or invalid"
                            })
                        } else {
                            serde_json::json!({
                                "error": "missing_authorization",
                                "message": "Authentication required"
                            })
                        };
                        return Ok(req
                            .into_response(HttpResponse::Unauthorized().json(body))
                            .map_into_boxed_body());
                    }
                    Some(p) => {
                        let allowed = if min_role == UserRole::Admin {
                            p.role.meets(min_role) && p.role.can_mutate_content()
                        } else {
                            // VIEWER-1 / self-service: any signed-in role at or above viewer rank.
                            p.role.meets(min_role)
                        };
                        if !allowed {
                            let resp = HttpResponse::Forbidden().json(serde_json::json!({
                                "error": "forbidden",
                                "message": "Insufficient privileges for this resource",
                                "required": min_role.as_str(),
                                "role": p.role.as_str()
                            }));
                            return Ok(req.into_response(resp).map_into_boxed_body());
                        }
                    }
                }
            }

            service.call(req).await.map(|res| res.map_into_boxed_body())
        })
    }
}

/* ──────────────────────────── Utils ──────────────────────────── */

fn extract_bearer(req: &HttpRequest) -> Option<String> {
    let raw = req.headers().get(header::AUTHORIZATION)?.to_str().ok()?;
    let s = raw.trim();
    let prefix = "bearer ";
    if s.len() < prefix.len() || !s[..prefix.len()].eq_ignore_ascii_case(prefix) {
        return None;
    }
    let token = s[prefix.len()..].trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn is_dev_local_session_token(token: &str) -> bool {
    !is_production_env() && token == "dev_local_session"
}

fn is_production_env() -> bool {
    let env = std::env::var("REELFORGE_ENV")
        .or_else(|_| std::env::var("RUST_ENV"))
        .unwrap_or_default();
    if matches!(env.as_str(), "production" | "prod") {
        return true;
    }
    std::env::var("RAILWAY_ENVIRONMENT").is_ok() || std::env::var("RENDER").is_ok()
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/* ──────────────────────────── Tests ──────────────────────────── */

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::Method;

    #[test]
    fn public_mutating_routes_skip_admin_auth() {
        assert!(!mutating_route_requires_admin(
            &Method::POST,
            "/api/watch/event"
        ));
        assert!(!mutating_route_requires_admin(&Method::POST, "/api/analytics"));
        assert!(!mutating_route_requires_admin(
            &Method::POST,
            "/api/debug/mobile-trace"
        ));
        assert_eq!(
            mutating_route_required_role(&Method::POST, "/api/auth/login"),
            None
        );
        assert_eq!(
            mutating_route_required_role(&Method::POST, "/api/auth/register"),
            None
        );
    }

    #[test]
    fn content_mutations_require_admin_only() {
        assert_eq!(
            mutating_route_required_role(&Method::POST, "/api/reels"),
            Some(UserRole::Admin)
        );
        assert_eq!(
            mutating_route_required_role(&Method::POST, "/api/uploads/sign"),
            Some(UserRole::Admin)
        );
        assert_eq!(
            mutating_route_required_role(&Method::POST, "/api/reels/finalize"),
            Some(UserRole::Admin)
        );
        assert_eq!(
            mutating_route_required_role(
                &Method::DELETE,
                "/api/reels/00000000-0000-4000-8000-000000000001"
            ),
            Some(UserRole::Admin)
        );
        assert_eq!(
            mutating_route_required_role(&Method::POST, "/api/studio/upload"),
            Some(UserRole::Admin)
        );
        assert!(mutating_route_requires_admin(
            &Method::PUT,
            "/api/hero/presentation"
        ));
    }

    #[test]
    fn hero_presentation_get_public_put_admin() {
        assert!(!mutating_route_requires_admin(
            &Method::GET,
            "/api/hero/presentation"
        ));
        assert_eq!(
            mutating_route_required_role(&Method::PUT, "/api/hero/presentation"),
            Some(UserRole::Admin)
        );
    }

    #[test]
    fn only_admin_can_mutate_content() {
        assert!(!UserRole::Viewer.can_mutate_content());
        assert!(!UserRole::Creator.can_mutate_content());
        assert!(UserRole::Admin.can_mutate_content());
        assert!(!UserRole::Viewer.meets(UserRole::Admin));
        assert!(!UserRole::Creator.meets(UserRole::Admin));
        assert!(UserRole::Admin.meets(UserRole::Admin));
    }

    #[test]
    fn viewer_self_service_mutations_require_viewer_not_admin() {
        assert_eq!(
            mutating_route_required_role(&Method::PUT, "/api/account/profile"),
            Some(UserRole::Viewer)
        );
        assert_eq!(
            mutating_route_required_role(&Method::POST, "/api/viewer/history"),
            Some(UserRole::Viewer)
        );
        assert_eq!(
            mutating_route_required_role(&Method::POST, "/api/viewer/watchlist"),
            Some(UserRole::Viewer)
        );
        assert_eq!(
            mutating_route_required_role(
                &Method::DELETE,
                "/api/viewer/watchlist/00000000-0000-4000-8000-000000000001"
            ),
            Some(UserRole::Viewer)
        );
        // Content mutations still admin-only
        assert_eq!(
            mutating_route_required_role(&Method::POST, "/api/uploads/sign"),
            Some(UserRole::Admin)
        );
        assert!(mutating_route_requires_admin(
            &Method::POST,
            "/api/uploads/sign"
        ));
        assert!(!mutating_route_requires_admin(
            &Method::POST,
            "/api/viewer/history"
        ));
    }

    #[test]
    fn password_validation_and_hash_roundtrip() {
        assert!(validate_password("short").is_err());
        assert!(validate_password("longenough1").is_ok());
        let hash = hash_password("longenough1").expect("hash");
        assert!(!hash.contains("longenough1"));
        assert!(verify_password("longenough1", &hash));
        assert!(!verify_password("wrong-password", &hash));
    }

    #[test]
    fn email_validation() {
        assert!(validate_email("user@example.com").is_ok());
        assert!(validate_email("bad").is_err());
        assert!(validate_email("no-at.com").is_err());
    }
}
