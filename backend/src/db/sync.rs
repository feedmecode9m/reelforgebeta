use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::PgPool;

pub const DEFAULT_WORKSPACE_ID: &str = "default";

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct SyncStateRow {
    pub workspace_id: String,
    pub payload: Value,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SyncPushInput {
    pub workspace_id: Option<String>,
    pub device_id: Option<String>,
    #[serde(default)]
    pub domains: Map<String, Value>,
}

fn empty_domains() -> Value {
    serde_json::json!({
        "version": 1,
        "seriesMetadata": { "entries": {}, "updatedAt": 0 },
        "workflowTasks": { "entries": {}, "updatedAt": 0 },
        "releaseSchedule": { "entries": {}, "updatedAt": 0 },
        "publishingState": { "entries": {}, "updatedAt": 0 }
    })
}

fn entry_updated_at(value: &Value) -> i64 {
    value
        .get("updatedAt")
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
}

fn merge_entry_maps(base: &Map<String, Value>, incoming: &Map<String, Value>) -> Map<String, Value> {
    let mut merged = base.clone();
    for (key, incoming_entry) in incoming {
        let base_entry = merged.get(key);
        let keep_incoming = match base_entry {
            None => true,
            Some(base_val) => entry_updated_at(incoming_entry) >= entry_updated_at(base_val),
        };
        if keep_incoming {
            merged.insert(key.clone(), incoming_entry.clone());
        }
    }
    merged
}

fn domain_entries(payload: &Value, domain: &str) -> Map<String, Value> {
    payload
        .get(domain)
        .and_then(|d| d.get("entries"))
        .and_then(|e| e.as_object())
        .cloned()
        .unwrap_or_default()
}

fn set_domain_entries(payload: &mut Value, domain: &str, entries: Map<String, Value>) {
    let max_updated = entries
        .values()
        .map(entry_updated_at)
        .max()
        .unwrap_or(0);

    if let Some(obj) = payload.as_object_mut() {
        obj.insert(
            domain.to_string(),
            serde_json::json!({
                "entries": entries,
                "updatedAt": max_updated
            }),
        );
    }
}

pub fn merge_sync_payload(base: &Value, incoming_domains: &Map<String, Value>) -> Value {
    let mut merged = if base.is_null() || base.as_object().is_none() {
        empty_domains()
    } else {
        base.clone()
    };

    for domain in [
        "seriesMetadata",
        "workflowTasks",
        "releaseSchedule",
        "publishingState",
    ] {
        let Some(incoming_domain) = incoming_domains.get(domain) else {
            continue;
        };
        let Some(incoming_entries) = incoming_domain.get("entries").and_then(|e| e.as_object()) else {
            continue;
        };

        let base_entries = domain_entries(&merged, domain);
        let next_entries = merge_entry_maps(&base_entries, incoming_entries);
        set_domain_entries(&mut merged, domain, next_entries);
    }

    if let Some(obj) = merged.as_object_mut() {
        obj.insert("version".to_string(), serde_json::json!(1));
        if let Some(device_id) = incoming_domains
            .get("_meta")
            .and_then(|m| m.get("deviceId"))
            .and_then(|v| v.as_str())
        {
            obj.insert(
                "lastDeviceId".to_string(),
                serde_json::json!(device_id),
            );
        }
    }

    merged
}

pub async fn get_sync_state(pool: &PgPool, workspace_id: &str) -> Result<SyncStateRow, sqlx::Error> {
    let row: Option<SyncStateRow> = sqlx::query_as(
        r#"
        SELECT workspace_id, payload, updated_at
        FROM studio_sync_state
        WHERE workspace_id = $1
        "#,
    )
    .bind(workspace_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.unwrap_or(SyncStateRow {
        workspace_id: workspace_id.to_string(),
        payload: empty_domains(),
        updated_at: Utc::now(),
    }))
}

pub async fn merge_sync_state(
    pool: &PgPool,
    workspace_id: &str,
    incoming_domains: &Map<String, Value>,
) -> Result<SyncStateRow, sqlx::Error> {
    let current = get_sync_state(pool, workspace_id).await?;
    let merged = merge_sync_payload(&current.payload, incoming_domains);

    sqlx::query_as(
        r#"
        INSERT INTO studio_sync_state (workspace_id, payload, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (workspace_id) DO UPDATE SET
            payload = EXCLUDED.payload,
            updated_at = now()
        RETURNING workspace_id, payload, updated_at
        "#,
    )
    .bind(workspace_id)
    .bind(&merged)
    .fetch_one(pool)
    .await
}
