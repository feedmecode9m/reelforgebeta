use std::collections::HashMap;
use std::future::{ready, Ready};
use std::rc::Rc;
use std::time::{SystemTime, UNIX_EPOCH};

use actix_web::body::{BoxBody, MessageBody};
use actix_web::dev::{forward_ready, Service, ServiceRequest, ServiceResponse, Transform};
use actix_web::http::Method;
use actix_web::{http::header, web, HttpRequest, HttpResponse};
use futures_util::future::LocalBoxFuture;
use tokio::sync::RwLock;

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

/// Mutating routes that remain public (viewer telemetry / dev sinks).
fn is_public_mutating_route(method: &Method, path: &str) -> bool {
    if !matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) {
        return true;
    }

    matches!(
        path,
        "/api/watch/event"
            | "/api/analytics"
            | "/api/security/events"
            | "/api/dev/client-log"
    )
}

pub fn mutating_route_requires_admin(method: &Method, path: &str) -> bool {
    if is_public_mutating_route(method, path) {
        return false;
    }
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    )
}

pub struct AdminAuth;

impl<S, B> Transform<S, ServiceRequest> for AdminAuth
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error>
        + 'static,
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
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = actix_web::Error>
        + 'static,
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
            if mutating_route_requires_admin(req.method(), req.path()) {
                let sessions = req
                    .app_data::<web::Data<AdminSessionStore>>()
                    .cloned()
                    .ok_or_else(|| {
                        actix_web::error::ErrorInternalServerError("admin session store missing")
                    })?;

                if let Err(resp) = require_admin(req.request(), sessions.get_ref()).await {
                    return Ok(req.into_response(resp).map_into_boxed_body());
                }
            }

            service.call(req).await.map(|res| res.map_into_boxed_body())
        })
    }
}

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
    }

    #[test]
    fn reels_mutations_require_admin_auth() {
        assert!(mutating_route_requires_admin(
            &Method::POST,
            "/api/reels"
        ));
        assert!(mutating_route_requires_admin(
            &Method::POST,
            "/api/uploads/sign"
        ));
        assert!(mutating_route_requires_admin(
            &Method::POST,
            "/api/reels/finalize"
        ));
        assert!(mutating_route_requires_admin(
            &Method::DELETE,
            "/api/reels/00000000-0000-4000-8000-000000000001"
        ));
        assert!(mutating_route_requires_admin(
            &Method::PATCH,
            "/api/reels/00000000-0000-4000-8000-000000000001/category"
        ));
    }
}
