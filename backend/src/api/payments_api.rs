use std::collections::HashMap;
use std::str::FromStr;

use actix_web::{http::StatusCode, web, HttpRequest, HttpResponse};
use chrono::Utc;
use hmac::{Hmac, KeyInit, Mac};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::PgPool;
use uuid::Uuid;

use crate::auth::{resolve_principal, AdminSessionStore};
use crate::db;
use crate::db::payments::{BeginWebhookOutcome, CheckoutStatusPatch, NewCheckoutInput};
use crate::db::revenue::IngestRevenueProfileInput;

type HmacSha256 = Hmac<Sha256>;

const CHECKOUT_EVENT_TYPES: &[&str] = &[
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.expired",
];
const SUBSCRIPTION_EVENT_TYPES: &[&str] = &[
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
];
const INVOICE_EVENT_TYPES: &[&str] = &["invoice.paid", "invoice.payment_failed"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutRequestBody {
    pub episode_id: Option<String>,
    pub reel_id: Option<String>,
    pub access_mode: Option<String>,
    pub requested_price_id: Option<String>,
    pub amount_cents: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutResponse {
    checkout_url: String,
    session_id: String,
    mode: String,
}

fn payments_disabled() -> HttpResponse {
    HttpResponse::NotFound().json(json!({
        "error": "Payments API disabled",
        "hint": "Set REELFORGE_PAYMENTS_API=true to enable"
    }))
}

fn check_payments_enabled() -> Result<(), HttpResponse> {
    if db::payments_api_enabled() {
        Ok(())
    } else {
        Err(payments_disabled())
    }
}

fn payments_error(status: StatusCode, code: &str, message: &str) -> HttpResponse {
    HttpResponse::build(status).json(json!({
        "ok": false,
        "error": code,
        "message": message
    }))
}

fn require_env(name: &str) -> Result<String, HttpResponse> {
    let value = std::env::var(name).unwrap_or_default().trim().to_string();
    if value.is_empty() {
        return Err(payments_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "payments_not_configured",
            &format!("Missing required environment variable {name}"),
        ));
    }
    Ok(value)
}

fn is_production_runtime() -> bool {
    let env = std::env::var("REELFORGE_ENV")
        .or_else(|_| std::env::var("RUST_ENV"))
        .unwrap_or_default();
    if matches!(env.as_str(), "production" | "prod") {
        return true;
    }
    std::env::var("RAILWAY_ENVIRONMENT").is_ok() || std::env::var("RENDER").is_ok()
}

fn normalize_paid_mode(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "paid" | "pay" | "premium" | "locked" | "episode_lock" | "season_pass" | "vip" | "subscription"
    )
}

fn is_paid_episode(
    access_mode: &str,
    episode_number: i32,
    free_episode_count: i32,
    is_free_override: bool,
) -> bool {
    !is_free_override
        && normalize_paid_mode(access_mode)
        && episode_number > free_episode_count.max(0)
}

fn validate_requested_price(
    requested_price_id: Option<&str>,
    server_price_id: &str,
) -> Result<(), HttpResponse> {
    let requested = requested_price_id
        .map(str::trim)
        .filter(|v| !v.is_empty());
    if let Some(v) = requested {
        if v != server_price_id {
            return Err(payments_error(
                StatusCode::BAD_REQUEST,
                "invalid_price",
                "Requested price is not allowed for this episode",
            ));
        }
    }
    Ok(())
}

fn resolve_price_from_server(access_mode: &str) -> Result<(String, String), HttpResponse> {
    let mode = access_mode.trim().to_ascii_uppercase();
    let episode_price_id = std::env::var("STRIPE_PRICE_ID_EPISODE")
        .unwrap_or_default()
        .trim()
        .to_string();
    let subscription_price_id = std::env::var("STRIPE_PRICE_ID_SUBSCRIPTION")
        .or_else(|_| std::env::var("STRIPE_PRICE_ID"))
        .unwrap_or_default()
        .trim()
        .to_string();

    if mode == "EPISODE_LOCK" && !episode_price_id.is_empty() {
        return Ok(("payment".to_string(), episode_price_id));
    }
    if !subscription_price_id.is_empty() {
        return Ok(("subscription".to_string(), subscription_price_id));
    }
    if !episode_price_id.is_empty() {
        return Ok(("payment".to_string(), episode_price_id));
    }
    Err(payments_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "pricing_not_configured",
        "No Stripe price ID configured on server",
    ))
}

fn parse_uuid(raw: Option<&str>) -> Option<Uuid> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }
    Uuid::from_str(value).ok()
}

fn parse_signature_header(raw: &str) -> (Option<i64>, Vec<String>) {
    let mut timestamp = None;
    let mut signatures = Vec::new();
    for part in raw.split(',') {
        let chunk = part.trim();
        if let Some(value) = chunk.strip_prefix("t=") {
            timestamp = value.parse::<i64>().ok();
        } else if let Some(value) = chunk.strip_prefix("v1=") {
            let sig = value.trim();
            if !sig.is_empty() {
                signatures.push(sig.to_string());
            }
        }
    }
    (timestamp, signatures)
}

fn verify_webhook_signature(
    payload: &[u8],
    signature_header: &str,
    webhook_secret: &str,
) -> Result<(), HttpResponse> {
    let (timestamp, signatures) = parse_signature_header(signature_header);
    let ts = timestamp.ok_or_else(|| {
        payments_error(
            StatusCode::BAD_REQUEST,
            "invalid_signature_header",
            "Stripe-Signature missing timestamp",
        )
    })?;
    if signatures.is_empty() {
        return Err(payments_error(
            StatusCode::BAD_REQUEST,
            "invalid_signature_header",
            "Stripe-Signature missing v1 signature",
        ));
    }

    let age_secs = (Utc::now().timestamp() - ts).abs();
    if age_secs > 600 {
        return Err(payments_error(
            StatusCode::UNAUTHORIZED,
            "stale_webhook_signature",
            "Webhook signature is too old",
        ));
    }

    let signed_payload = format!("{ts}.{}", String::from_utf8_lossy(payload));
    let mut mac = HmacSha256::new_from_slice(webhook_secret.as_bytes()).map_err(|_| {
        payments_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "signature_init_failed",
            "Could not initialize webhook verifier",
        )
    })?;
    mac.update(signed_payload.as_bytes());
    let expected = mac.finalize().into_bytes();

    for provided in signatures {
        if let Ok(decoded) = hex::decode(provided) {
            if decoded.as_slice() == expected.as_slice() {
                return Ok(());
            }
        }
    }

    Err(payments_error(
        StatusCode::UNAUTHORIZED,
        "invalid_webhook_signature",
        "Stripe signature verification failed",
    ))
}

fn parse_metadata_map(payload: &Value) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Some(obj) = payload.as_object() {
        for (k, v) in obj {
            if let Some(text) = v.as_str() {
                out.insert(k.clone(), text.to_string());
            }
        }
    }
    out
}

async fn resolve_user_for_event(pool: &PgPool, object: &Value) -> Result<Option<Uuid>, HttpResponse> {
    let metadata = parse_metadata_map(object.get("metadata").unwrap_or(&Value::Null));
    let metadata_uid = parse_uuid(metadata.get("user_id").map(String::as_str));
    let customer = object.get("customer").and_then(Value::as_str).unwrap_or_default();
    if customer.is_empty() {
        return Ok(metadata_uid);
    }
    let mapped = db::payments::lookup_user_id_by_stripe_customer(pool, customer)
        .await
        .map_err(|e| {
            payments_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "customer_lookup_failed",
                &e.to_string(),
            )
        })?;
    if let (Some(from_map), Some(from_meta)) = (mapped, metadata_uid) {
        if from_map != from_meta {
            return Err(payments_error(
                StatusCode::BAD_REQUEST,
                "invalid_event_payload",
                "Customer/user metadata mismatch",
            ));
        }
    }
    if mapped.is_some() {
        return Ok(mapped);
    }
    Ok(metadata_uid)
}

fn normalize_subscription_active(status: &str) -> bool {
    matches!(status, "active" | "trialing")
}

fn should_ignore_checkout_regression(
    existing_checkout_status: &str,
    existing_payment_status: &str,
    incoming_checkout_status: &str,
    incoming_payment_paid: bool,
) -> bool {
    let already_final_paid = existing_checkout_status == "complete"
        && (existing_payment_status == "paid" || existing_payment_status == "no_payment_required");
    already_final_paid && (!incoming_payment_paid || incoming_checkout_status == "expired")
}

async fn process_checkout_event(
    pool: &PgPool,
    event_type: &str,
    object: &Value,
) -> Result<(), HttpResponse> {
    let session_id = object
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if session_id.is_empty() {
        return Err(payments_error(
            StatusCode::BAD_REQUEST,
            "invalid_event_payload",
            "Checkout event missing session id",
        ));
    }
    let existing = db::payments::find_checkout_by_session_id(pool, &session_id)
        .await
        .map_err(|e| {
            payments_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "checkout_lookup_failed",
                &e.to_string(),
            )
        })?;
    let Some(existing_row) = existing else {
        // Unknown checkout session must not grant or alter entitlement.
        return Ok(());
    };

    let customer_id = object
        .get("customer")
        .and_then(Value::as_str)
        .map(|v| v.to_string());
    let payment_status = object
        .get("payment_status")
        .and_then(Value::as_str)
        .unwrap_or("pending")
        .to_ascii_lowercase();
    let checkout_status = if event_type == "checkout.session.expired" {
        "expired"
    } else {
        "complete"
    };
    let amount_total = object.get("amount_total").and_then(Value::as_i64);
    let currency = object
        .get("currency")
        .and_then(Value::as_str)
        .map(|v| v.to_string());

    let incoming_paid = payment_status == "paid" || payment_status == "no_payment_required";
    if should_ignore_checkout_regression(
        &existing_row.checkout_status,
        &existing_row.payment_status,
        checkout_status,
        incoming_paid,
    ) {
        return Ok(());
    }

    let update = db::payments::update_checkout_state(
        pool,
        &CheckoutStatusPatch {
            stripe_session_id: session_id.clone(),
            stripe_customer_id: customer_id.clone(),
            checkout_status: Some(checkout_status.to_string()),
            payment_status: Some(payment_status.clone()),
            amount_total_cents: amount_total,
            currency: currency.clone(),
            metadata_patch: Some(json!({ "stripeEventType": event_type })),
            completed: checkout_status == "complete",
        },
    )
    .await
    .map_err(|e| {
        payments_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "checkout_update_failed",
            &e.to_string(),
        )
    })?;

    let user_id = update.as_ref().map(|row| row.user_id);

    if let (Some(uid), Some(customer)) = (user_id, customer_id.as_deref()) {
        let _ = db::payments::upsert_customer_map(pool, uid, customer).await;
    }

    if let Some(uid) = user_id {
        let active = checkout_status == "complete" && incoming_paid;
        let status = if checkout_status == "expired" {
            "expired".to_string()
        } else {
            payment_status.clone()
        };
        db::payments::set_user_paid_entitlement(pool, uid, active, Some(&status), customer_id.as_deref())
            .await
            .map_err(|e| payments_error(StatusCode::INTERNAL_SERVER_ERROR, "entitlement_update_failed", &e.to_string()))?;
    }
    Ok(())
}

async fn process_subscription_event(pool: &PgPool, object: &Value) -> Result<(), HttpResponse> {
    let status = object
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("incomplete")
        .to_ascii_lowercase();
    let active = normalize_subscription_active(&status);
    let customer_id = object
        .get("customer")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if customer_id.is_empty() {
        return Ok(());
    }
    let user_id = resolve_user_for_event(pool, object).await?;
    if let Some(uid) = user_id {
        db::payments::upsert_customer_map(pool, uid, &customer_id)
            .await
            .map_err(|e| payments_error(StatusCode::INTERNAL_SERVER_ERROR, "customer_map_failed", &e.to_string()))?;
        db::payments::set_user_paid_entitlement(pool, uid, active, Some(&status), Some(&customer_id))
            .await
            .map_err(|e| payments_error(StatusCode::INTERNAL_SERVER_ERROR, "entitlement_update_failed", &e.to_string()))?;
    }
    Ok(())
}

async fn process_invoice_event(pool: &PgPool, event_type: &str, object: &Value) -> Result<(), HttpResponse> {
    let customer_id = object
        .get("customer")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if customer_id.is_empty() {
        return Ok(());
    }
    let user_id = resolve_user_for_event(pool, object).await?;
    if let Some(uid) = user_id {
        db::payments::upsert_customer_map(pool, uid, &customer_id)
            .await
            .map_err(|e| payments_error(StatusCode::INTERNAL_SERVER_ERROR, "customer_map_failed", &e.to_string()))?;
        if event_type == "invoice.payment_failed" {
            db::payments::set_user_paid_entitlement(pool, uid, false, Some("past_due"), Some(&customer_id))
                .await
                .map_err(|e| payments_error(StatusCode::INTERNAL_SERVER_ERROR, "entitlement_update_failed", &e.to_string()))?;
        }
    }
    Ok(())
}

async fn create_stripe_checkout_session(
    secret_key: &str,
    mode: &str,
    price_id: &str,
    success_url: &str,
    cancel_url: &str,
    customer_email: Option<&str>,
    customer_id: Option<&str>,
    metadata: &HashMap<String, String>,
    client_reference_id: &str,
) -> Result<Value, String> {
    let mut form = vec![
        ("mode".to_string(), mode.to_string()),
        ("line_items[0][price]".to_string(), price_id.to_string()),
        ("line_items[0][quantity]".to_string(), "1".to_string()),
        ("success_url".to_string(), success_url.to_string()),
        ("cancel_url".to_string(), cancel_url.to_string()),
        ("client_reference_id".to_string(), client_reference_id.to_string()),
        ("managed_payments[enabled]".to_string(), "false".to_string()),
    ];
    if mode == "subscription" {
        form.push(("allow_promotion_codes".to_string(), "true".to_string()));
    }
    let mut has_customer = false;
    if let Some(cid) = customer_id {
        if !cid.trim().is_empty() {
            form.push(("customer".to_string(), cid.trim().to_string()));
            has_customer = true;
        }
    }
    if !has_customer {
        if let Some(email) = customer_email {
            if !email.trim().is_empty() {
                form.push(("customer_email".to_string(), email.trim().to_string()));
            }
        }
    }
    for (k, v) in metadata {
        form.push((format!("metadata[{k}]"), v.clone()));
    }

    let client = Client::new();
    let response = client
        .post("https://api.stripe.com/v1/checkout/sessions")
        .bearer_auth(secret_key)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("stripe_http_error:{e}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("stripe_json_error:{e}"))?;
    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(|v| v.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("Stripe checkout session creation failed");
        return Err(format!("stripe_error_status_{}:{message}", status.as_u16()));
    }
    Ok(body)
}

/// GET /api/payments/status
pub async fn payments_status(
    req: HttpRequest,
    pool: web::Data<PgPool>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> HttpResponse {
    if let Err(resp) = check_payments_enabled() {
        return resp;
    }
    if !*db_available.get_ref() {
        return payments_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "db_unavailable",
            "Database unavailable",
        );
    }
    let principal = match resolve_principal(&req, admin_sessions.get_ref(), Some(pool.get_ref()), true).await {
        Some(p) => p,
        None => {
            return payments_error(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Sign in required",
            )
        }
    };
    let user_id = match principal.user_id {
        Some(uid) => uid,
        None => {
            return payments_error(
                StatusCode::UNAUTHORIZED,
                "user_session_required",
                "Use an authenticated viewer account session",
            )
        }
    };
    let has_paid_access = db::payments::read_user_paid_entitlement(pool.get_ref(), user_id)
        .await
        .unwrap_or(false);
    HttpResponse::Ok().json(json!({
        "enabled": true,
        "provider": "stripe",
        "userId": user_id,
        "hasPaidAccess": has_paid_access,
        "checkoutPath": "/api/payments/checkout",
        "webhookPath": "/api/payments/webhook",
        "publishableKeyConfigured": std::env::var("STRIPE_PUBLISHABLE_KEY").map(|v| !v.trim().is_empty()).unwrap_or(false)
    }))
}

/// POST /api/payments/checkout
pub async fn create_checkout(
    req: HttpRequest,
    body: web::Json<CheckoutRequestBody>,
    pool: web::Data<PgPool>,
    db_available: web::Data<bool>,
    admin_sessions: web::Data<AdminSessionStore>,
) -> HttpResponse {
    if let Err(resp) = check_payments_enabled() {
        return resp;
    }
    if !*db_available.get_ref() {
        return payments_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "db_unavailable",
            "Database unavailable",
        );
    }

    let principal = match resolve_principal(&req, admin_sessions.get_ref(), Some(pool.get_ref()), true).await {
        Some(p) => p,
        None => {
            return payments_error(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "Sign in required",
            )
        }
    };
    let user_id = match principal.user_id {
        Some(uid) => uid,
        None => {
            return payments_error(
                StatusCode::UNAUTHORIZED,
                "user_session_required",
                "Use an authenticated viewer account session",
            )
        }
    };

    let requested_episode_id = body
        .episode_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            payments_error(
                StatusCode::BAD_REQUEST,
                "invalid_product",
                "episodeId is required for paid episode checkout",
            )
        });
    let requested_episode_id = match requested_episode_id {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let requested_reel_id = body
        .reel_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());

    let episode_ctx = match db::payments::resolve_checkout_episode_context(
        pool.get_ref(),
        &requested_episode_id,
        requested_reel_id,
    )
    .await
    {
        Ok(Some(v)) => v,
        Ok(None) => {
            return payments_error(
                StatusCode::BAD_REQUEST,
                "invalid_product",
                "Episode does not exist in studio catalog or is not bound to this media asset",
            )
        }
        Err(e) => {
            return payments_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "catalog_lookup_failed",
                &e.to_string(),
            )
        }
    };
    let canonical_episode_id = episode_ctx.canonical_episode_id.clone();
    if canonical_episode_id != requested_episode_id && Uuid::parse_str(&requested_episode_id).is_ok() {
        return payments_error(
            StatusCode::BAD_REQUEST,
            "invalid_product",
            "Requested episode does not match canonical catalog binding",
        );
    }
    let series_id = episode_ctx.series_id;
    let episode_number = episode_ctx.episode_number;
    let is_free_override = episode_ctx.is_free_override;
    let access_mode_raw = episode_ctx.access_mode;
    let free_episode_count = episode_ctx.free_episode_count;
    if let Some(client_mode) = body.access_mode.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        if normalize_paid_mode(client_mode) != normalize_paid_mode(&access_mode_raw) {
            return payments_error(
                StatusCode::BAD_REQUEST,
                "invalid_product",
                "Client access mode does not match server catalog state",
            );
        }
    }
    let access_mode = access_mode_raw;

    let paid_episode = is_paid_episode(
        &access_mode,
        episode_number,
        free_episode_count,
        is_free_override,
    );
    if !paid_episode {
        return payments_error(
            StatusCode::BAD_REQUEST,
            "invalid_product",
            "Selected episode is free and cannot be checked out",
        );
    }

    let (checkout_mode, server_price_id) = match resolve_price_from_server(&access_mode) {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if let Err(resp) = validate_requested_price(body.requested_price_id.as_deref(), &server_price_id) {
        return resp;
    }

    let stripe_secret = match require_env("STRIPE_SECRET_KEY") {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if is_production_runtime() && stripe_secret.starts_with("sk_test_") {
        return payments_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "payments_not_configured",
            "Test-mode Stripe secret key is not allowed in production",
        );
    }
    let success_url = match require_env("STRIPE_CHECKOUT_SUCCESS_URL") {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    let cancel_url = match require_env("STRIPE_CHECKOUT_CANCEL_URL") {
        Ok(v) => v,
        Err(resp) => return resp,
    };

    let revenue_profile = db::revenue::upsert_profile(
        pool.get_ref(),
        &IngestRevenueProfileInput {
            id: None,
            profile_type: "series".to_string(),
            profile_ref_id: series_id.clone(),
            currency: Some("USD".to_string()),
            config: Some(json!({})),
        },
    )
    .await;
    let profile_id = match revenue_profile {
        Ok(Ok(row)) => Some(row.id),
        _ => None,
    };

    let existing_customer = db::payments::lookup_stripe_customer_by_user_id(pool.get_ref(), user_id)
        .await
        .ok()
        .flatten();

    let mut metadata = HashMap::new();
    metadata.insert("user_id".to_string(), user_id.to_string());
    metadata.insert("episode_id".to_string(), canonical_episode_id.clone());
    metadata.insert("series_id".to_string(), series_id.clone());
    metadata.insert("access_mode".to_string(), access_mode.clone());
    if let Some(ref reel_id) = body.reel_id {
        if !reel_id.trim().is_empty() {
            metadata.insert("reel_id".to_string(), reel_id.trim().to_string());
        }
    }
    if body.amount_cents.is_some() {
        metadata.insert("client_amount_ignored".to_string(), "true".to_string());
    }

    let stripe_session = create_stripe_checkout_session(
        &stripe_secret,
        &checkout_mode,
        &server_price_id,
        &success_url,
        &cancel_url,
        principal.email.as_deref(),
        existing_customer.as_deref(),
        &metadata,
        &user_id.to_string(),
    )
    .await;
    let stripe_session = match stripe_session {
        Ok(v) => v,
        Err(err) => {
            eprintln!("[PAYMENTS_CHECKOUT] stripe_session_error={err}");
            return payments_error(
                StatusCode::BAD_GATEWAY,
                "stripe_checkout_failed",
                "Could not create Stripe checkout session",
            );
        }
    };

    let stripe_session_id = stripe_session
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let checkout_url = stripe_session
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if stripe_session_id.is_empty() || checkout_url.is_empty() {
        return payments_error(
            StatusCode::BAD_GATEWAY,
            "stripe_checkout_failed",
            "Stripe response missing checkout URL",
        );
    }
    let stripe_customer_id = stripe_session
        .get("customer")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let amount_total = stripe_session.get("amount_total").and_then(Value::as_i64);
    let currency = stripe_session
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or("usd")
        .to_string();

    if let Some(ref customer_id) = stripe_customer_id {
        let _ = db::payments::upsert_customer_map(pool.get_ref(), user_id, customer_id).await;
    }

    let persisted = db::payments::insert_checkout(
        pool.get_ref(),
        &NewCheckoutInput {
            user_id,
            stripe_session_id: stripe_session_id.clone(),
            stripe_customer_id: stripe_customer_id.clone(),
            stripe_price_id: server_price_id.clone(),
            checkout_mode: checkout_mode.clone(),
            amount_total_cents: amount_total,
            currency: currency.clone(),
            episode_id: Some(canonical_episode_id.clone()),
            series_id: Some(series_id.clone()),
            access_mode: Some(access_mode.clone()),
            profile_id: profile_id.clone(),
            metadata: json!({
                "episodeNumber": episode_number,
                "freeEpisodeCount": free_episode_count,
                "clientAmountCents": body.amount_cents,
                "requestedPriceId": body.requested_price_id,
                "stripePriceId": server_price_id
            }),
        },
    )
    .await;
    if let Err(err) = persisted {
        eprintln!("[PAYMENTS_CHECKOUT] persist_failed={err}");
        return payments_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "checkout_persist_failed",
            "Checkout created but local persistence failed",
        );
    }

    HttpResponse::Ok().json(json!({
        "ok": true,
        "checkout": CheckoutResponse {
            checkout_url,
            session_id: stripe_session_id,
            mode: checkout_mode
        },
        "price": {
            "stripePriceId": server_price_id,
            "source": "server"
        },
        "product": {
            "episodeId": canonical_episode_id,
            "requestedEpisodeId": requested_episode_id
        }
    }))
}

/// POST /api/payments/webhook
pub async fn stripe_webhook(
    req: HttpRequest,
    body: web::Bytes,
    pool: web::Data<PgPool>,
) -> HttpResponse {
    if let Err(resp) = check_payments_enabled() {
        return resp;
    }

    let stripe_sig = req
        .headers()
        .get("Stripe-Signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if stripe_sig.is_empty() {
        return payments_error(
            StatusCode::BAD_REQUEST,
            "missing_signature",
            "Stripe-Signature header is required",
        );
    }
    let webhook_secret = match require_env("STRIPE_WEBHOOK_SECRET") {
        Ok(v) => v,
        Err(resp) => return resp,
    };
    if let Err(resp) = verify_webhook_signature(&body, &stripe_sig, &webhook_secret) {
        return resp;
    }

    let payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return payments_error(
                StatusCode::BAD_REQUEST,
                "invalid_json",
                "Webhook payload is not valid JSON",
            )
        }
    };
    let event_id = payload
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let event_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if event_id.is_empty() || event_type.is_empty() {
        return payments_error(
            StatusCode::BAD_REQUEST,
            "invalid_event_payload",
            "Stripe event missing id or type",
        );
    }

    let begin = db::payments::begin_webhook_event(
        pool.get_ref(),
        &event_id,
        &event_type,
        payload.get("livemode").and_then(Value::as_bool),
        &payload,
    )
    .await;
    let begin = match begin {
        Ok(v) => v,
        Err(err) => {
            eprintln!("[PAYMENTS_WEBHOOK] event_register_failed id={event_id} error={err}");
            return payments_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "event_register_failed",
                "Could not register webhook event",
            );
        }
    };
    if begin == BeginWebhookOutcome::Duplicate {
        let _ = db::payments::mark_webhook_event_processed(
            pool.get_ref(),
            &event_id,
            "duplicate",
            None,
        )
        .await;
        return HttpResponse::Ok().json(json!({ "ok": true, "duplicate": true }));
    }

    let object = payload
        .get("data")
        .and_then(|v| v.get("object"))
        .cloned()
        .unwrap_or(Value::Null);

    let process_result = if CHECKOUT_EVENT_TYPES.contains(&event_type.as_str()) {
        process_checkout_event(pool.get_ref(), &event_type, &object).await
    } else if SUBSCRIPTION_EVENT_TYPES.contains(&event_type.as_str()) {
        process_subscription_event(pool.get_ref(), &object).await
    } else if INVOICE_EVENT_TYPES.contains(&event_type.as_str()) {
        process_invoice_event(pool.get_ref(), &event_type, &object).await
    } else {
        Ok(())
    };

    match process_result {
        Ok(()) => {
            let status = if CHECKOUT_EVENT_TYPES.contains(&event_type.as_str())
                || SUBSCRIPTION_EVENT_TYPES.contains(&event_type.as_str())
                || INVOICE_EVENT_TYPES.contains(&event_type.as_str())
            {
                "processed"
            } else {
                "ignored"
            };
            let _ = db::payments::mark_webhook_event_processed(pool.get_ref(), &event_id, status, None).await;
            HttpResponse::Ok().json(json!({ "ok": true }))
        }
        Err(resp) => {
            let _ = db::payments::mark_webhook_event_processed(
                pool.get_ref(),
                &event_id,
                "failed",
                Some("webhook processing failed"),
            )
            .await;
            resp
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hmac::KeyInit;

    fn sign(secret: &str, ts: i64, payload: &str) -> String {
        let signed_payload = format!("{ts}.{payload}");
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("mac");
        mac.update(signed_payload.as_bytes());
        let digest = mac.finalize().into_bytes();
        format!("t={ts},v1={}", hex::encode(digest))
    }

    #[test]
    fn signature_header_parser_extracts_timestamp_and_v1() {
        let (ts, sigs) = parse_signature_header("t=12345,v1=abc,v0=legacy,v1=def");
        assert_eq!(ts, Some(12345));
        assert_eq!(sigs, vec!["abc".to_string(), "def".to_string()]);
    }

    #[test]
    fn webhook_signature_accepts_valid_signature() {
        let payload = r#"{"id":"evt_test","type":"checkout.session.completed"}"#;
        let ts = Utc::now().timestamp();
        let secret = "whsec_test_secret";
        let header = sign(secret, ts, payload);
        let result = verify_webhook_signature(payload.as_bytes(), &header, secret);
        assert!(result.is_ok());
    }

    #[test]
    fn webhook_signature_rejects_invalid_signature() {
        let payload = r#"{"id":"evt_test","type":"checkout.session.completed"}"#;
        let ts = Utc::now().timestamp();
        let header = format!("t={ts},v1=deadbeef");
        let result = verify_webhook_signature(payload.as_bytes(), &header, "whsec_test_secret");
        assert!(result.is_err());
    }

    #[test]
    fn server_price_resolution_prefers_episode_lock_price() {
        std::env::set_var("STRIPE_PRICE_ID_EPISODE", "price_episode");
        std::env::set_var("STRIPE_PRICE_ID_SUBSCRIPTION", "price_sub");
        let (mode, price) = resolve_price_from_server("EPISODE_LOCK").expect("price");
        assert_eq!(mode, "payment");
        assert_eq!(price, "price_episode");
    }

    #[test]
    fn paid_episode_logic_respects_free_window_and_override() {
        assert!(!is_paid_episode("subscription", 2, 2, false));
        assert!(is_paid_episode("subscription", 3, 2, false));
        assert!(!is_paid_episode("free", 8, 0, false));
        assert!(!is_paid_episode("episode_lock", 5, 2, true));
    }

    #[test]
    fn requested_price_mismatch_rejected() {
        let ok = validate_requested_price(Some("price_ok"), "price_ok");
        assert!(ok.is_ok());
        let mismatch = validate_requested_price(Some("price_attacker"), "price_server");
        assert!(mismatch.is_err());
    }

    #[test]
    fn stale_signature_is_rejected() {
        let payload = r#"{"id":"evt_test","type":"checkout.session.completed"}"#;
        let secret = "whsec_test_secret";
        let ts = Utc::now().timestamp() - 3600;
        let header = sign(secret, ts, payload);
        let result = verify_webhook_signature(payload.as_bytes(), &header, secret);
        assert!(result.is_err());
    }

    #[test]
    fn subscription_active_status_excludes_past_due() {
        assert!(normalize_subscription_active("active"));
        assert!(normalize_subscription_active("trialing"));
        assert!(!normalize_subscription_active("past_due"));
        assert!(!normalize_subscription_active("incomplete"));
    }

    #[test]
    fn production_runtime_detection_respects_env_and_host() {
        std::env::remove_var("REELFORGE_ENV");
        std::env::remove_var("RUST_ENV");
        std::env::remove_var("RAILWAY_ENVIRONMENT");
        std::env::remove_var("RENDER");
        assert!(!is_production_runtime());
        std::env::set_var("REELFORGE_ENV", "production");
        assert!(is_production_runtime());
    }

    #[test]
    fn checkout_regression_guard_blocks_expired_after_paid() {
        assert!(should_ignore_checkout_regression(
            "complete",
            "paid",
            "expired",
            false
        ));
        assert!(should_ignore_checkout_regression(
            "complete",
            "no_payment_required",
            "complete",
            false
        ));
        assert!(!should_ignore_checkout_regression(
            "open",
            "pending",
            "complete",
            true
        ));
    }
}
