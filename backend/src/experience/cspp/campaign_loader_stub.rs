//! Campaign loader for CSPP (Phase 1b.5).

use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

/// Normalized campaign row for CSPP (no URLs).
#[derive(Debug, Clone)]
pub struct CampaignInput {
    pub id: Uuid,
    pub campaign_name: String,
    pub campaign_type: String,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub administrative_status: String,
    pub priority: i32,
    pub target_series_id: Option<Uuid>,
    pub target_episode_id: Option<Uuid>,
}

/// Load platform campaigns when a pool is available; otherwise empty.
pub async fn load_campaigns(pool: Option<&PgPool>) -> Vec<CampaignInput> {
    let Some(pool) = pool else {
        return Vec::new();
    };
    let rows = match crate::db::platform_config::list_campaigns(pool).await {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    rows.into_iter()
        .map(|r| CampaignInput {
            id: r.id,
            campaign_name: r.campaign_name,
            campaign_type: r.campaign_type,
            start_date: r.start_date,
            end_date: r.end_date,
            administrative_status: r.status,
            priority: 0,
            target_series_id: None,
            target_episode_id: None,
        })
        .collect()
}

/// Filter + map to RVE `campaigns[]` items (active only in output).
pub fn active_campaigns_for_context(
    inputs: &[CampaignInput],
    now: DateTime<Utc>,
    episode_id: Option<Uuid>,
    series_id: Option<Uuid>,
) -> Vec<Value> {
    let mut active: Vec<&CampaignInput> = inputs
        .iter()
        .filter(|c| is_campaign_active(c, now, episode_id, series_id))
        .collect();

    active.sort_by(|a, b| {
        b.priority
            .cmp(&a.priority)
            .then_with(|| targeting_rank(b).cmp(&targeting_rank(a)))
            .then_with(|| type_rank(&b.campaign_type).cmp(&type_rank(&a.campaign_type)))
            .then_with(|| b.id.cmp(&a.id))
    });

    active
        .into_iter()
        .map(campaign_to_rve)
        .collect()
}

fn is_campaign_active(
    c: &CampaignInput,
    now: DateTime<Utc>,
    episode_id: Option<Uuid>,
    series_id: Option<Uuid>,
) -> bool {
    if c.administrative_status != "active" {
        return false;
    }
    if let Some(start) = c.start_date {
        if now < start {
            return false;
        }
    }
    if let Some(end) = c.end_date {
        if now >= end {
            return false;
        }
    }
    if let Some(target_ep) = c.target_episode_id {
        if episode_id != Some(target_ep) {
            return false;
        }
    }
    if let Some(target_series) = c.target_series_id {
        if series_id != Some(target_series) {
            return false;
        }
    }
    true
}

fn targeting_rank(c: &CampaignInput) -> u8 {
    if c.target_episode_id.is_some() {
        3
    } else if c.target_series_id.is_some() {
        2
    } else {
        1
    }
}

fn type_rank(campaign_type: &str) -> u8 {
    match campaign_type {
        "PREMIERE" => 4,
        "CONTEST" => 3,
        "PROMOTION" => 2,
        "SPONSOR" => 1,
        _ => 0,
    }
}

fn campaign_to_rve(c: &CampaignInput) -> Value {
    json!({
        "id": c.id,
        "campaign_name": c.campaign_name,
        "campaign_type": c.campaign_type,
        "status": "active",
        "start_date": c.start_date.map(|d| d.to_rfc3339()),
        "end_date": c.end_date.map(|d| d.to_rfc3339()),
        "priority": c.priority,
        "target_series_id": c.target_series_id,
        "target_episode_id": c.target_episode_id,
    })
}

pub fn campaign_priority_key(c: &CampaignInput) -> (i32, u8, u8, Uuid) {
    (
        c.priority,
        targeting_rank(c),
        type_rank(&c.campaign_type),
        c.id,
    )
}
