//! Hero authority boundary — server grants publication (canonical lifecycle truth).
//!
//! Frontend authority *requests* publication (client audit + integrity hash).
//! Backend authority *grants* publication (authenticate, validate, sign, append-only log).
//! Viewer *only displays* verified publication (client integrity + server receipt + state).
//!
//! POST /api/hero/authority/events
//! GET  /api/hero/authority/events?heroId=
//! GET  /api/hero/authority/events/{heroId}
//!
//! Signature versioning:
//!   srv1 — FNV-1a 64 (current)
//!   srv2 — HMAC-SHA256 (prepared; not active mint yet)

use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use sqlx::Row;
use std::env;
use uuid::Uuid;

use crate::auth::{resolve_principal, AdminSessionStore, UserRole};

const SIGNING_PREFIX: &str = "REELFORGE_HERO_AUTHORITY_V1";
const DEFAULT_DEV_SECRET: &str = "reelforge-dev-hero-authority";
/// Current mint path. srv2 (HMAC-SHA256) reserved for future migration.
pub const SIGNATURE_VERSION_SRV1: &str = "srv1";
pub const SIGNATURE_VERSION_SRV2: &str = "srv2";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityEventRequest {
    #[serde(default)]
    pub event_id: Option<String>,
    pub hero_id: String,
    pub action: String,
    pub previous_status: String,
    pub new_status: String,
    pub actor_id: String,
    pub actor_role: String,
    pub source_type: String,
    #[serde(default)]
    pub changed_fields: Vec<String>,
    pub client_integrity_hash: String,
    /// When true (or creatorTruth appears in changedFields), reject.
    #[serde(default)]
    pub creator_truth_mutation: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthorityAcceptResponse {
    accepted: bool,
    authority_event_id: String,
    server_timestamp: i64,
    server_signature: String,
    signature_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthorityRejectResponse {
    accepted: bool,
    reason: String,
}

fn text(s: &str) -> String {
    s.trim().to_string()
}

fn is_blank(s: &str) -> bool {
    s.trim().is_empty()
}

fn signing_secret() -> String {
    env::var("HERO_AUTHORITY_SIGNING_SECRET")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_DEV_SECRET.to_string())
}

/// Detect signature version prefix for migration (srv1 → srv2).
pub fn signature_version_of(sig: &str) -> &'static str {
    let s = sig.trim();
    if s.starts_with("srv2:") {
        SIGNATURE_VERSION_SRV2
    } else if s.starts_with("srv1:") {
        SIGNATURE_VERSION_SRV1
    } else {
        "unknown"
    }
}

/// FNV-1a 64-bit → `srv1:{hex16}` — matches frontend engine mirror.
pub fn mint_server_signature(
    secret: &str,
    authority_event_id: &str,
    hero_id: &str,
    action: &str,
    client_hash: &str,
) -> String {
    let material = format!(
        "{SIGNING_PREFIX}|{secret}|{authority_event_id}|{hero_id}|{action}|{client_hash}"
    );
    let mut h: u64 = 0xcbf29ce484222325;
    for b in material.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("srv1:{h:016x}")
}

/// Constant-time-ish equality for signatures (length-checked).
pub fn verify_server_signature(
    secret: &str,
    authority_event_id: &str,
    hero_id: &str,
    action: &str,
    client_hash: &str,
    claimed: &str,
) -> bool {
    let version = signature_version_of(claimed);
    // srv2 reserved: never accept as trusted mint until HMAC path ships.
    if version == SIGNATURE_VERSION_SRV2 {
        return false;
    }
    if version != SIGNATURE_VERSION_SRV1 {
        return false;
    }
    let expected = mint_server_signature(secret, authority_event_id, hero_id, action, client_hash);
    expected.as_bytes() == claimed.trim().as_bytes()
}

fn is_editorial_action(action: &str) -> bool {
    matches!(
        action,
        "created"
            | "edited"
            | "submitted_for_review"
            | "approved"
            | "published"
            | "archived"
    )
}

fn is_ai_or_discovery(source: &str, role: &str) -> bool {
    let s = source.to_lowercase();
    let r = role.to_lowercase();
    matches!(
        s.as_str(),
        "ai" | "nlp" | "intelligence" | "discovery" | "system" | "unknown" | ""
    ) || matches!(
        r.as_str(),
        "intelligence" | "system" | "ai" | "nlp" | "discovery" | "unknown" | ""
    )
}

fn is_authenticated_actor(actor_id: &str, actor_role: &str) -> bool {
    if is_blank(actor_id) {
        return false;
    }
    let role = actor_role.to_lowercase();
    matches!(
        role.as_str(),
        "admin" | "creator" | "master_hero_admin" | "studio" | "user"
    )
}

fn lifecycle_allowed(previous: &str, next: &str) -> bool {
    let p = previous.to_lowercase();
    let n = next.to_lowercase();
    match p.as_str() {
        "draft" => matches!(n.as_str(), "draft" | "review" | "approved"),
        "review" => matches!(n.as_str(), "review" | "draft" | "approved"),
        "approved" => matches!(n.as_str(), "approved" | "published" | "draft" | "archived"),
        "published" => matches!(n.as_str(), "published" | "archived" | "draft"),
        "archived" => matches!(n.as_str(), "archived" | "draft"),
        _ => false,
    }
}

fn touches_creator_truth(fields: &[String], flag: Option<bool>) -> bool {
    if flag == Some(true) {
        return true;
    }
    fields.iter().any(|f| {
        let l = f.to_lowercase();
        l.contains("creatortruth")
            || l == "creator_truth"
            || l.starts_with("creatortruth.")
            || l.starts_with("creator_truth.")
    })
}

/// Pure validation — no DB. Used by handler + unit tests.
pub fn validate_authority_event(req: &AuthorityEventRequest) -> Result<(), String> {
    let hero_id = text(&req.hero_id);
    let action = text(&req.action).to_lowercase();
    let previous = text(&req.previous_status).to_lowercase();
    let next = text(&req.new_status).to_lowercase();
    let actor_id = text(&req.actor_id);
    let actor_role = text(&req.actor_role);
    let source_type = text(&req.source_type).to_lowercase();
    let client_hash = text(&req.client_integrity_hash);

    if is_blank(&hero_id) {
        return Err("missing_hero_id".into());
    }
    if is_blank(&action) || !is_editorial_action(&action) {
        return Err("missing_audit_metadata".into());
    }
    if is_blank(&previous) || is_blank(&next) {
        return Err("missing_audit_metadata".into());
    }
    if is_blank(&client_hash) {
        return Err("missing_audit_metadata".into());
    }
    if is_blank(&source_type) {
        return Err("missing_audit_metadata".into());
    }

    if is_ai_or_discovery(&source_type, &actor_role) {
        return Err("ai_discovery_editorial_rejected".into());
    }

    if !is_authenticated_actor(&actor_id, &actor_role) {
        return Err("unauthenticated_actor".into());
    }

    if touches_creator_truth(&req.changed_fields, req.creator_truth_mutation) {
        return Err("creator_truth_mutation".into());
    }

    if action == "published" || next == "published" {
        if previous != "approved" && previous != "published" {
            return Err("publish_without_approval".into());
        }
    }

    if (action == "approved" || next == "approved")
        && previous != "review"
        && previous != "approved"
    {
        return Err("approval_without_review_state".into());
    }

    if !lifecycle_allowed(&previous, &next) {
        return Err("invalid_lifecycle_transition".into());
    }

    Ok(())
}

async fn ensure_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS hero_authority_events (
            id                  TEXT PRIMARY KEY,
            hero_id             TEXT NOT NULL,
            action              TEXT NOT NULL,
            previous_status     TEXT NOT NULL,
            new_status          TEXT NOT NULL,
            actor_id            TEXT NOT NULL,
            actor_role          TEXT NOT NULL,
            source_type         TEXT NOT NULL,
            changed_fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            client_hash         TEXT NOT NULL,
            server_signature    TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE INDEX IF NOT EXISTS idx_hero_authority_events_hero_id_created
            ON hero_authority_events (hero_id, created_at ASC)
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

fn reject(reason: &str) -> HttpResponse {
    HttpResponse::Ok().json(AuthorityRejectResponse {
        accepted: false,
        reason: reason.to_string(),
    })
}

/// Bind actor from authenticated session (Phase 8).
/// Client-supplied actorId/actorRole cannot elevate beyond principal.
async fn bind_session_actor(
    req: &HttpRequest,
    pool: &PgPool,
    admin_sessions: &AdminSessionStore,
    body_actor_id: &str,
    body_actor_role: &str,
) -> Result<(String, String), String> {
    // db may or may not be available; resolve_principal handles both paths.
    let principal = resolve_principal(req, admin_sessions, Some(pool), true)
        .await
        .ok_or_else(|| "missing_identity".to_string())?;

    if principal.role != UserRole::Admin {
        return Err("invalid_role".to_string());
    }

    // Map principal → server authority actor
    let server_actor_id = if let Some(uid) = principal.user_id {
        uid.to_string()
    } else if principal.source == "admin_session" {
        "studio_admin_session".to_string()
    } else {
        return Err("missing_identity".to_string());
    };
    let server_role = "admin".to_string();

    // Reject client-supplied elevated / mismatched actor fields.
    let client_id = text(body_actor_id);
    if !client_id.is_empty() && client_id != server_actor_id {
        // Allow email alias match for user sessions
        if principal
            .email
            .as_ref()
            .map(|e| e.eq_ignore_ascii_case(&client_id))
            != Some(true)
        {
            return Err("client_supplied_elevated_actor".to_string());
        }
    }
    let client_role = text(body_actor_role).to_lowercase();
    if !client_role.is_empty()
        && client_role != "admin"
        && client_role != "master_hero_admin"
        && client_role != server_role
    {
        return Err("invalid_role".to_string());
    }
    // Client claiming intelligence / non-admin is invalid for grants
    if matches!(
        client_role.as_str(),
        "intelligence" | "viewer" | "system" | "ai" | "unknown"
    ) {
        return Err("invalid_role".to_string());
    }

    Ok((server_actor_id, server_role))
}

/// POST /api/hero/authority/events
pub async fn post_authority_event(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    admin_sessions: web::Data<AdminSessionStore>,
    body: web::Json<AuthorityEventRequest>,
) -> HttpResponse {
    let mut request = body.into_inner();

    // Authenticate + bind actor (server is sole identity authority).
    let (server_actor_id, server_role) = match bind_session_actor(
        &req,
        pool.get_ref(),
        admin_sessions.get_ref(),
        &request.actor_id,
        &request.actor_role,
    )
    .await
    {
        Ok(v) => v,
        Err(reason) => return reject(&reason),
    };
    request.actor_id = server_actor_id.clone();
    request.actor_role = server_role.clone();

    // Hero authority permission: admin grants only.
    // (role already checked; keep explicit)
    if server_role != "admin" {
        return reject("invalid_role");
    }

    if let Err(reason) = validate_authority_event(&request) {
        return reject(&reason);
    }

    if let Err(e) = ensure_table(pool.get_ref()).await {
        eprintln!("[hero_authority] ensure_table failed: {e}");
        return HttpResponse::InternalServerError().json(json!({
            "accepted": false,
            "reason": "authority_store_unavailable"
        }));
    }

    let hero_id = text(&request.hero_id);
    let action = text(&request.action).to_lowercase();
    let previous = text(&request.previous_status).to_lowercase();
    let next = text(&request.new_status).to_lowercase();
    let actor_id = server_actor_id;
    let actor_role = server_role;
    let source_type = text(&request.source_type).to_lowercase();
    let client_hash = text(&request.client_integrity_hash);
    let changed_fields = request
        .changed_fields
        .iter()
        .map(|f| text(f))
        .filter(|f| !f.is_empty())
        .collect::<Vec<_>>();

    let authority_event_id = {
        let id = text(request.event_id.as_deref().unwrap_or(""));
        if id.is_empty() {
            format!("haevt-{}", Uuid::new_v4())
        } else {
            id
        }
    };

    match sqlx::query("SELECT 1 FROM hero_authority_events WHERE id = $1")
        .bind(&authority_event_id)
        .fetch_optional(pool.get_ref())
        .await
    {
        Ok(Some(_)) => return reject("duplicate_authority_event"),
        Ok(None) => {}
        Err(e) => {
            eprintln!("[hero_authority] dup check failed: {e}");
            return HttpResponse::InternalServerError().json(json!({
                "accepted": false,
                "reason": "authority_store_unavailable"
            }));
        }
    }

    let server_signature = mint_server_signature(
        &signing_secret(),
        &authority_event_id,
        &hero_id,
        &action,
        &client_hash,
    );
    let created_at = chrono::Utc::now();
    let server_timestamp = created_at.timestamp_millis();
    let fields_json = Value::Array(
        changed_fields
            .iter()
            .map(|s| Value::String(s.clone()))
            .collect(),
    );

    let insert = sqlx::query(
        r#"
        INSERT INTO hero_authority_events (
            id, hero_id, action, previous_status, new_status,
            actor_id, actor_role, source_type, changed_fields,
            created_at, client_hash, server_signature
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12
        )
        "#,
    )
    .bind(&authority_event_id)
    .bind(&hero_id)
    .bind(&action)
    .bind(&previous)
    .bind(&next)
    .bind(&actor_id)
    .bind(&actor_role)
    .bind(&source_type)
    .bind(&fields_json)
    .bind(created_at)
    .bind(&client_hash)
    .bind(&server_signature)
    .execute(pool.get_ref())
    .await;

    match insert {
        Ok(_) => HttpResponse::Ok().json(AuthorityAcceptResponse {
            accepted: true,
            authority_event_id,
            server_timestamp,
            server_signature,
            signature_version: SIGNATURE_VERSION_SRV1.to_string(),
        }),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("duplicate") || msg.contains("unique") {
                return reject("duplicate_authority_event");
            }
            eprintln!("[hero_authority] insert failed: {e}");
            HttpResponse::InternalServerError().json(json!({
                "accepted": false,
                "reason": "authority_store_unavailable"
            }))
        }
    }
}

fn row_to_trusted_event(row: &sqlx::postgres::PgRow, secret: &str) -> Option<Value> {
    let event_id = row.try_get::<String, _>("id").ok()?;
    let hero_id = row.try_get::<String, _>("hero_id").ok()?;
    let action = row.try_get::<String, _>("action").ok()?;
    let previous_status = row
        .try_get::<String, _>("previous_status")
        .unwrap_or_default();
    let new_status = row.try_get::<String, _>("new_status").unwrap_or_default();
    let actor_id = row.try_get::<String, _>("actor_id").unwrap_or_default();
    let actor_role = row.try_get::<String, _>("actor_role").unwrap_or_default();
    let source_type = row.try_get::<String, _>("source_type").unwrap_or_default();
    let client_hash = row.try_get::<String, _>("client_hash").unwrap_or_default();
    let server_signature = row
        .try_get::<String, _>("server_signature")
        .unwrap_or_default();
    let created_at = row
        .try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
        .ok();
    let server_timestamp = created_at
        .map(|t| t.timestamp_millis())
        .unwrap_or(0);
    let changed_fields: Value = row
        .try_get::<Value, _>("changed_fields")
        .unwrap_or_else(|_| json!([]));

    let verified = verify_server_signature(
        secret,
        &event_id,
        &hero_id,
        &action,
        &client_hash,
        &server_signature,
    );
    if !verified {
        return None;
    }

    Some(json!({
        "eventId": event_id,
        "heroId": hero_id,
        "actorId": actor_id,
        "actorRole": actor_role,
        "action": action,
        "previousStatus": previous_status,
        "newStatus": new_status,
        "changedFields": changed_fields,
        "sourceType": source_type,
        "clientHash": client_hash,
        "serverTimestamp": server_timestamp,
        "serverSignature": server_signature,
        "signatureVersion": signature_version_of(&server_signature),
        "verified": true
    }))
}

async fn load_trusted_events(pool: &PgPool, hero_id: &str) -> Result<Value, sqlx::Error> {
    ensure_table(pool).await?;
    let rows = sqlx::query(
        r#"
        SELECT id, hero_id, action, previous_status, new_status,
               actor_id, actor_role, source_type, changed_fields,
               created_at, client_hash, server_signature
        FROM hero_authority_events
        WHERE hero_id = $1
        ORDER BY created_at ASC, id ASC
        "#,
    )
    .bind(hero_id)
    .fetch_all(pool)
    .await?;

    let secret = signing_secret();
    let mut events: Vec<Value> = Vec::new();
    let mut rejected = 0u32;
    for row in &rows {
        match row_to_trusted_event(row, &secret) {
            Some(evt) => events.push(evt),
            None => rejected += 1,
        }
    }

    // Chronological ordering already enforced by SQL; validate chain edges.
    let mut order_ok = true;
    for i in 1..events.len() {
        let prev_ts = events[i - 1]
            .get("serverTimestamp")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let ts = events[i]
            .get("serverTimestamp")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        if ts < prev_ts {
            order_ok = false;
            break;
        }
    }

    let last = events.last();
    let server_authority_state = last.map(|e| {
        json!({
            "status": e.get("newStatus").and_then(|v| v.as_str()).unwrap_or("draft"),
            "authorityEventId": e.get("eventId").and_then(|v| v.as_str()).unwrap_or(""),
            "serverTimestamp": e.get("serverTimestamp").and_then(|v| v.as_i64()).unwrap_or(0),
            "verified": true,
            "signatureVersion": e.get("signatureVersion").and_then(|v| v.as_str()).unwrap_or(SIGNATURE_VERSION_SRV1)
        })
    });

    Ok(json!({
        "heroId": hero_id,
        "trusted": order_ok && rejected == 0,
        "orderValid": order_ok,
        "rejectedUnsignedCount": rejected,
        "events": events,
        "serverAuthorityState": server_authority_state,
        "signatureVersion": SIGNATURE_VERSION_SRV1
    }))
}

/// GET /api/hero/authority/events?heroId=
pub async fn list_authority_events(
    pool: web::Data<PgPool>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let hero_id = query
        .get("heroId")
        .or_else(|| query.get("hero_id"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let Some(hero_id) = hero_id else {
        return HttpResponse::BadRequest().json(json!({
            "error": "missing_hero_id"
        }));
    };

    match load_trusted_events(pool.get_ref(), &hero_id).await {
        Ok(body) => HttpResponse::Ok().json(body),
        Err(e) => {
            eprintln!("[hero_authority] list failed: {e}");
            HttpResponse::InternalServerError().json(json!({
                "error": "authority_store_unavailable"
            }))
        }
    }
}

/// GET /api/hero/authority/events/{heroId}
pub async fn get_authority_events_for_hero(
    pool: web::Data<PgPool>,
    path: web::Path<String>,
) -> HttpResponse {
    let hero_id = path.into_inner().trim().to_string();
    if hero_id.is_empty() {
        return HttpResponse::BadRequest().json(json!({
            "error": "missing_hero_id"
        }));
    }

    match load_trusted_events(pool.get_ref(), &hero_id).await {
        Ok(body) => HttpResponse::Ok().json(body),
        Err(e) => {
            eprintln!("[hero_authority] get by heroId failed: {e}");
            HttpResponse::InternalServerError().json(json!({
                "error": "authority_store_unavailable"
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_req() -> AuthorityEventRequest {
        AuthorityEventRequest {
            event_id: Some("evt-test-1".into()),
            hero_id: "hero-1".into(),
            action: "published".into(),
            previous_status: "approved".into(),
            new_status: "published".into(),
            actor_id: "admin-1".into(),
            actor_role: "admin".into(),
            source_type: "creator".into(),
            changed_fields: vec!["status".into()],
            client_integrity_hash: "fnv1a32_abcd".into(),
            creator_truth_mutation: None,
        }
    }

    #[test]
    fn accepts_approved_to_published() {
        assert!(validate_authority_event(&base_req()).is_ok());
    }

    #[test]
    fn rejects_publish_without_approval() {
        let mut r = base_req();
        r.previous_status = "draft".into();
        assert_eq!(
            validate_authority_event(&r).unwrap_err(),
            "publish_without_approval"
        );
    }

    #[test]
    fn rejects_approval_without_review() {
        let mut r = base_req();
        r.action = "approved".into();
        r.previous_status = "draft".into();
        r.new_status = "approved".into();
        assert_eq!(
            validate_authority_event(&r).unwrap_err(),
            "approval_without_review_state"
        );
    }

    #[test]
    fn accepts_review_to_approved() {
        let mut r = base_req();
        r.action = "approved".into();
        r.previous_status = "review".into();
        r.new_status = "approved".into();
        assert!(validate_authority_event(&r).is_ok());
    }

    #[test]
    fn rejects_unauthenticated() {
        let mut r = base_req();
        r.actor_id = "".into();
        assert_eq!(
            validate_authority_event(&r).unwrap_err(),
            "unauthenticated_actor"
        );
    }

    #[test]
    fn rejects_ai_source() {
        let mut r = base_req();
        r.source_type = "ai".into();
        r.actor_role = "intelligence".into();
        assert_eq!(
            validate_authority_event(&r).unwrap_err(),
            "ai_discovery_editorial_rejected"
        );
    }

    #[test]
    fn rejects_creator_truth_mutation() {
        let mut r = base_req();
        r.changed_fields = vec!["creatorTruth.title".into()];
        assert_eq!(
            validate_authority_event(&r).unwrap_err(),
            "creator_truth_mutation"
        );
    }

    #[test]
    fn signature_stable_and_verifies() {
        let a = mint_server_signature("sec", "id1", "h1", "published", "hash");
        let b = mint_server_signature("sec", "id1", "h1", "published", "hash");
        assert_eq!(a, b);
        assert!(a.starts_with("srv1:"));
        assert_eq!(signature_version_of(&a), SIGNATURE_VERSION_SRV1);
        assert!(verify_server_signature(
            "sec", "id1", "h1", "published", "hash", &a
        ));
        assert!(!verify_server_signature(
            "sec", "id1", "h1", "published", "hash", "srv1:0000000000000000"
        ));
        // srv2 not yet accepted as trusted
        assert!(!verify_server_signature(
            "sec",
            "id1",
            "h1",
            "published",
            "hash",
            "srv2:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        ));
    }
}
