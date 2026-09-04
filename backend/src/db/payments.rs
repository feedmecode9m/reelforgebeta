use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct EpisodeCheckoutContext {
    pub canonical_episode_id: String,
    pub series_id: String,
    pub episode_number: i32,
    pub is_free_override: bool,
    pub access_mode: String,
    pub free_episode_count: i32,
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PaymentCheckoutRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub stripe_session_id: String,
    pub stripe_customer_id: Option<String>,
    pub stripe_price_id: String,
    pub checkout_mode: String,
    pub checkout_status: String,
    pub payment_status: String,
    pub amount_total_cents: Option<i64>,
    pub currency: String,
    pub episode_id: Option<String>,
    pub series_id: Option<String>,
    pub access_mode: Option<String>,
    pub profile_id: Option<String>,
    pub metadata: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct NewCheckoutInput {
    pub user_id: Uuid,
    pub stripe_session_id: String,
    pub stripe_customer_id: Option<String>,
    pub stripe_price_id: String,
    pub checkout_mode: String,
    pub amount_total_cents: Option<i64>,
    pub currency: String,
    pub episode_id: Option<String>,
    pub series_id: Option<String>,
    pub access_mode: Option<String>,
    pub profile_id: Option<String>,
    pub metadata: Value,
}

#[derive(Debug, Clone)]
pub struct CheckoutStatusPatch {
    pub stripe_session_id: String,
    pub stripe_customer_id: Option<String>,
    pub checkout_status: Option<String>,
    pub payment_status: Option<String>,
    pub amount_total_cents: Option<i64>,
    pub currency: Option<String>,
    pub metadata_patch: Option<Value>,
    pub completed: bool,
}

#[derive(Debug, Clone)]
pub struct EventInsertResult {
    pub inserted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BeginWebhookOutcome {
    Process,
    Duplicate,
}

pub async fn insert_checkout(
    pool: &PgPool,
    input: &NewCheckoutInput,
) -> Result<PaymentCheckoutRow, sqlx::Error> {
    sqlx::query_as::<_, PaymentCheckoutRow>(
        r#"
        INSERT INTO payment_checkouts (
            user_id, stripe_session_id, stripe_customer_id, stripe_price_id,
            checkout_mode, checkout_status, payment_status, amount_total_cents,
            currency, episode_id, series_id, access_mode, profile_id, metadata
        )
        VALUES ($1, $2, $3, $4, $5, 'open', 'pending', $6, $7, $8, $9, $10, $11, $12)
        RETURNING
            id, user_id, stripe_session_id, stripe_customer_id, stripe_price_id,
            checkout_mode, checkout_status, payment_status, amount_total_cents,
            currency, episode_id, series_id, access_mode, profile_id, metadata,
            created_at, updated_at, completed_at
        "#,
    )
    .bind(input.user_id)
    .bind(&input.stripe_session_id)
    .bind(input.stripe_customer_id.as_deref())
    .bind(&input.stripe_price_id)
    .bind(&input.checkout_mode)
    .bind(input.amount_total_cents)
    .bind(input.currency.to_lowercase())
    .bind(input.episode_id.as_deref())
    .bind(input.series_id.as_deref())
    .bind(input.access_mode.as_deref())
    .bind(input.profile_id.as_deref())
    .bind(input.metadata.clone())
    .fetch_one(pool)
    .await
}

pub async fn upsert_customer_map(
    pool: &PgPool,
    user_id: Uuid,
    stripe_customer_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO payment_customers (user_id, stripe_customer_id, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (user_id) DO UPDATE SET
            stripe_customer_id = EXCLUDED.stripe_customer_id,
            updated_at = now()
        "#,
    )
    .bind(user_id)
    .bind(stripe_customer_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn register_webhook_event(
    pool: &PgPool,
    stripe_event_id: &str,
    event_type: &str,
    livemode: Option<bool>,
    payload: &Value,
) -> Result<EventInsertResult, sqlx::Error> {
    let inserted_rows = sqlx::query(
        r#"
        INSERT INTO payment_webhook_events (stripe_event_id, event_type, livemode, payload)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (stripe_event_id) DO NOTHING
        "#,
    )
    .bind(stripe_event_id)
    .bind(event_type)
    .bind(livemode)
    .bind(payload)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(EventInsertResult {
        inserted: inserted_rows > 0,
    })
}

pub async fn begin_webhook_event(
    pool: &PgPool,
    stripe_event_id: &str,
    event_type: &str,
    livemode: Option<bool>,
    payload: &Value,
) -> Result<BeginWebhookOutcome, sqlx::Error> {
    let inserted_rows = sqlx::query(
        r#"
        INSERT INTO payment_webhook_events (stripe_event_id, event_type, livemode, payload, status, processed)
        VALUES ($1, $2, $3, $4, 'received', false)
        ON CONFLICT (stripe_event_id) DO NOTHING
        "#,
    )
    .bind(stripe_event_id)
    .bind(event_type)
    .bind(livemode)
    .bind(payload)
    .execute(pool)
    .await?
    .rows_affected();
    if inserted_rows > 0 {
        return Ok(BeginWebhookOutcome::Process);
    }

    // Retry previously failed events exactly once per retry attempt.
    let revived_rows = sqlx::query(
        r#"
        UPDATE payment_webhook_events
        SET status = 'received',
            processed = false,
            error_message = NULL,
            payload = $2,
            event_type = $3,
            livemode = $4
        WHERE stripe_event_id = $1
          AND status = 'failed'
        "#,
    )
    .bind(stripe_event_id)
    .bind(payload)
    .bind(event_type)
    .bind(livemode)
    .execute(pool)
    .await?
    .rows_affected();
    if revived_rows > 0 {
        return Ok(BeginWebhookOutcome::Process);
    }

    Ok(BeginWebhookOutcome::Duplicate)
}

pub async fn mark_webhook_event_processed(
    pool: &PgPool,
    stripe_event_id: &str,
    status: &str,
    error_message: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE payment_webhook_events
        SET processed = ($2 = 'processed' OR $2 = 'duplicate' OR $2 = 'ignored'),
            status = $2,
            error_message = $3,
            processed_at = now()
        WHERE stripe_event_id = $1
        "#,
    )
    .bind(stripe_event_id)
    .bind(status)
    .bind(error_message)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn find_checkout_by_session_id(
    pool: &PgPool,
    stripe_session_id: &str,
) -> Result<Option<PaymentCheckoutRow>, sqlx::Error> {
    sqlx::query_as::<_, PaymentCheckoutRow>(
        r#"
        SELECT
            id, user_id, stripe_session_id, stripe_customer_id, stripe_price_id,
            checkout_mode, checkout_status, payment_status, amount_total_cents,
            currency, episode_id, series_id, access_mode, profile_id, metadata,
            created_at, updated_at, completed_at
        FROM payment_checkouts
        WHERE stripe_session_id = $1
        LIMIT 1
        "#,
    )
    .bind(stripe_session_id)
    .fetch_optional(pool)
    .await
}

pub async fn update_checkout_state(
    pool: &PgPool,
    patch: &CheckoutStatusPatch,
) -> Result<Option<PaymentCheckoutRow>, sqlx::Error> {
    sqlx::query_as::<_, PaymentCheckoutRow>(
        r#"
        UPDATE payment_checkouts
        SET stripe_customer_id = COALESCE($2, stripe_customer_id),
            checkout_status = COALESCE($3, checkout_status),
            payment_status = COALESCE($4, payment_status),
            amount_total_cents = COALESCE($5, amount_total_cents),
            currency = COALESCE($6, currency),
            metadata = CASE
                WHEN $7::jsonb IS NULL THEN metadata
                ELSE metadata || $7::jsonb
            END,
            completed_at = CASE
                WHEN $8 THEN COALESCE(completed_at, now())
                ELSE completed_at
            END,
            updated_at = now()
        WHERE stripe_session_id = $1
        RETURNING
            id, user_id, stripe_session_id, stripe_customer_id, stripe_price_id,
            checkout_mode, checkout_status, payment_status, amount_total_cents,
            currency, episode_id, series_id, access_mode, profile_id, metadata,
            created_at, updated_at, completed_at
        "#,
    )
    .bind(&patch.stripe_session_id)
    .bind(patch.stripe_customer_id.as_deref())
    .bind(patch.checkout_status.as_deref())
    .bind(patch.payment_status.as_deref())
    .bind(patch.amount_total_cents)
    .bind(patch.currency.as_deref())
    .bind(patch.metadata_patch.clone())
    .bind(patch.completed)
    .fetch_optional(pool)
    .await
}

pub async fn set_user_paid_entitlement(
    pool: &PgPool,
    user_id: Uuid,
    active: bool,
    status: Option<&str>,
    customer_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    let existing: Option<Value> = sqlx::query_scalar("SELECT settings FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

    let mut settings = existing.unwrap_or_else(|| json!({}));
    if !settings.is_object() {
        settings = json!({});
    }
    let obj = settings.as_object_mut().expect("settings object");
    obj.insert("hasPaidAccess".to_string(), Value::Bool(active));
    obj.insert("subscriptionActive".to_string(), Value::Bool(active));
    if let Some(raw_status) = status {
        obj.insert(
            "subscriptionStatus".to_string(),
            Value::String(raw_status.to_string()),
        );
    }
    let billing = obj
        .entry("billing".to_string())
        .or_insert_with(|| json!({}));
    if !billing.is_object() {
        *billing = json!({});
    }
    let billing_obj = billing.as_object_mut().expect("billing object");
    billing_obj.insert("hasPaidAccess".to_string(), Value::Bool(active));
    billing_obj.insert("subscriptionActive".to_string(), Value::Bool(active));
    if let Some(raw_status) = status {
        billing_obj.insert(
            "subscriptionStatus".to_string(),
            Value::String(raw_status.to_string()),
        );
    }
    if let Some(cid) = customer_id {
        let stripe = obj.entry("stripe".to_string()).or_insert_with(|| json!({}));
        if !stripe.is_object() {
            *stripe = json!({});
        }
        let stripe_obj = stripe.as_object_mut().expect("stripe object");
        stripe_obj.insert(
            "customerId".to_string(),
            Value::String(cid.to_string()),
        );
        if let Some(raw_status) = status {
            stripe_obj.insert(
                "subscriptionStatus".to_string(),
                Value::String(raw_status.to_string()),
            );
        }
    }

    sqlx::query("UPDATE users SET settings = $2, updated_at = now() WHERE id = $1")
        .bind(user_id)
        .bind(settings)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn lookup_user_id_by_stripe_customer(
    pool: &PgPool,
    stripe_customer_id: &str,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM payment_customers WHERE stripe_customer_id = $1 LIMIT 1",
    )
    .bind(stripe_customer_id)
    .fetch_optional(pool)
    .await
}

pub async fn lookup_stripe_customer_by_user_id(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar::<_, String>(
        "SELECT stripe_customer_id FROM payment_customers WHERE user_id = $1 LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn read_user_paid_entitlement(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let settings: Option<Value> = sqlx::query_scalar("SELECT settings FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    let Some(settings) = settings else {
        return Ok(false);
    };

    fn parse_boolish(value: &Value) -> Option<bool> {
        match value {
            Value::Bool(v) => Some(*v),
            Value::Number(n) => n.as_i64().map(|v| v > 0),
            Value::String(raw) => {
                let s = raw.trim().to_ascii_lowercase();
                if ["1", "true", "yes", "active", "paid", "subscriber", "trialing"].contains(&s.as_str()) {
                    return Some(true);
                }
                if ["0", "false", "no", "inactive", "free", "none", "cancelled", "canceled", "expired", "incomplete", "unpaid", "paused"].contains(&s.as_str()) {
                    return Some(false);
                }
                None
            }
            _ => None,
        }
    }

    let mut candidates: Vec<&Value> = Vec::new();
    if let Some(obj) = settings.as_object() {
        if let Some(v) = obj.get("hasPaidAccess") {
            candidates.push(v);
        }
        if let Some(v) = obj.get("subscriptionActive") {
            candidates.push(v);
        }
        if let Some(billing) = obj.get("billing").and_then(Value::as_object) {
            if let Some(v) = billing.get("hasPaidAccess") {
                candidates.push(v);
            }
            if let Some(v) = billing.get("subscriptionActive") {
                candidates.push(v);
            }
        }
    }

    for value in candidates {
        if let Some(parsed) = parse_boolish(value) {
            return Ok(parsed);
        }
    }
    Ok(false)
}

pub async fn resolve_episode_checkout_context(
    pool: &PgPool,
    episode_id: &str,
) -> Result<Option<(String, i32, bool, String, i32)>, sqlx::Error> {
    let resolved = resolve_checkout_episode_context(pool, episode_id, None).await?;
    let Some(ctx) = resolved else {
        return Ok(None);
    };
    Ok(Some((
        ctx.series_id,
        ctx.episode_number,
        ctx.is_free_override,
        ctx.access_mode,
        ctx.free_episode_count,
    )))
}

pub async fn resolve_checkout_episode_context(
    pool: &PgPool,
    requested_episode_id: &str,
    requested_reel_id: Option<&str>,
) -> Result<Option<EpisodeCheckoutContext>, sqlx::Error> {
    let trimmed_episode_id = requested_episode_id.trim();
    if trimmed_episode_id.is_empty() {
        return Ok(None);
    }
    if let Some(row) = fetch_checkout_context_by_episode_id(pool, trimmed_episode_id).await? {
        return Ok(Some(row));
    }
    let reel_uuid = requested_reel_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| Uuid::parse_str(value).ok());
    let Some(reel_uuid) = reel_uuid else {
        return Ok(None);
    };
    fetch_checkout_context_by_reel_id(pool, reel_uuid).await
}

async fn fetch_checkout_context_by_episode_id(
    pool: &PgPool,
    episode_id: &str,
) -> Result<Option<EpisodeCheckoutContext>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
            CAST(se.id AS TEXT) AS canonical_episode_id,
            CAST(ss.id AS TEXT) AS series_id,
            se.episode_number,
            se.is_free_override,
            COALESCE(NULLIF(ss.access_mode, ''), 'FREE') AS access_mode,
            COALESCE(ss.free_episode_count, 2) AS free_episode_count
        FROM studio_episodes se
        INNER JOIN studio_seasons sz ON sz.id = se.season_id
        INNER JOIN studio_series ss ON ss.id = sz.series_id
        WHERE CAST(se.id AS TEXT) = $1
        LIMIT 1
        "#,
    )
    .bind(episode_id)
    .fetch_optional(pool)
    .await?;
    if row.is_some() {
        return parse_episode_checkout_context_row(row);
    }
    fetch_public_catalog_checkout_context_by_episode_id(pool, episode_id).await
}

async fn fetch_public_catalog_checkout_context_by_episode_id(
    pool: &PgPool,
    episode_id: &str,
) -> Result<Option<EpisodeCheckoutContext>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
            e.id AS canonical_episode_id,
            s.id AS series_id,
            e.episode_number,
            false AS is_free_override,
            COALESCE(NULLIF(s.access_mode, ''), 'FREE') AS access_mode,
            COALESCE(s.free_episode_count, 2) AS free_episode_count
        FROM episodes e
        INNER JOIN seasons sz ON sz.id = e.season_id
        INNER JOIN series s ON s.id = sz.series_id
        WHERE e.id = $1
        LIMIT 1
        "#,
    )
    .bind(episode_id)
    .fetch_optional(pool)
    .await?;
    parse_episode_checkout_context_row(row)
}

async fn fetch_checkout_context_by_reel_id(
    pool: &PgPool,
    reel_id: Uuid,
) -> Result<Option<EpisodeCheckoutContext>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
            CAST(se.id AS TEXT) AS canonical_episode_id,
            CAST(ss.id AS TEXT) AS series_id,
            se.episode_number,
            se.is_free_override,
            COALESCE(NULLIF(ss.access_mode, ''), 'FREE') AS access_mode,
            COALESCE(ss.free_episode_count, 2) AS free_episode_count
        FROM studio_episodes se
        INNER JOIN studio_seasons sz ON sz.id = se.season_id
        INNER JOIN studio_series ss ON ss.id = sz.series_id
        WHERE se.reel_id = $1
        LIMIT 1
        "#,
    )
    .bind(reel_id)
    .fetch_optional(pool)
    .await?;
    if row.is_some() {
        return parse_episode_checkout_context_row(row);
    }
    fetch_public_catalog_checkout_context_by_reel_id(pool, reel_id).await
}

async fn fetch_public_catalog_checkout_context_by_reel_id(
    pool: &PgPool,
    reel_id: Uuid,
) -> Result<Option<EpisodeCheckoutContext>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
            e.id AS canonical_episode_id,
            s.id AS series_id,
            e.episode_number,
            false AS is_free_override,
            COALESCE(NULLIF(s.access_mode, ''), 'FREE') AS access_mode,
            COALESCE(s.free_episode_count, 2) AS free_episode_count
        FROM episodes e
        INNER JOIN seasons sz ON sz.id = e.season_id
        INNER JOIN series s ON s.id = sz.series_id
        WHERE e.reel_id = CAST($1 AS TEXT)
        LIMIT 1
        "#,
    )
    .bind(reel_id)
    .fetch_optional(pool)
    .await?;
    parse_episode_checkout_context_row(row)
}

fn parse_episode_checkout_context_row(
    row: Option<sqlx::postgres::PgRow>,
) -> Result<Option<EpisodeCheckoutContext>, sqlx::Error> {
    let Some(row) = row else {
        return Ok(None);
    };
    let canonical_episode_id: String = row.try_get("canonical_episode_id")?;
    let series_id: String = row.try_get("series_id")?;
    let episode_number: i32 = row.try_get("episode_number")?;
    let is_free_override: bool = row.try_get("is_free_override")?;
    let access_mode: String = row.try_get("access_mode")?;
    let free_episode_count: i32 = row.try_get("free_episode_count")?;
    Ok(Some(EpisodeCheckoutContext {
        canonical_episode_id,
        series_id,
        episode_number,
        is_free_override,
        access_mode,
        free_episode_count,
    }))
}
