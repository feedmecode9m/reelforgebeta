//! Campaign slot post-processor (Phase 1b.5).
//!
//! **Media boundary:** CSPP must not assume media exists. This module only mutates
//! `campaigns[]` and `slots[]`. It does not read or write `metadata.media_*` fields.
//! Media semantics are applied later in `media::apply_media_semantic_stub`.

pub mod campaign_loader_stub;
pub mod composition_plan;
pub mod slot_injector_stub;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use campaign_loader_stub::{active_campaigns_for_context, load_campaigns, CampaignInput};
use slot_injector_stub::inject_slots;

/// Synchronous enrich without DB campaign reads (harness / fixture path).
pub fn enrich(base_rve: Value) -> Value {
    let now = resolve_now(&base_rve);
    let (episode_id, series_id) = resolve_targeting(&base_rve);
    let inputs: Vec<CampaignInput> = Vec::new();
    let active = active_campaigns_for_context(&inputs, now, episode_id, series_id);
    apply_enrichment(base_rve, active, &inputs, now)
}

/// Enrich with optional platform campaign reads.
pub async fn enrich_with_pool(base_rve: Value, pool: Option<&PgPool>) -> Value {
    let now = resolve_now(&base_rve);
    let (episode_id, series_id) = resolve_targeting(&base_rve);
    let inputs = load_campaigns(pool).await;
    let active = active_campaigns_for_context(&inputs, now, episode_id, series_id);
    apply_enrichment(base_rve, active, &inputs, now)
}

fn apply_enrichment(
    base_rve: Value,
    active_campaigns: Vec<Value>,
    inputs: &[CampaignInput],
    now: DateTime<Utc>,
) -> Value {
    let (slots, campaigns) = inject_slots(&base_rve, &active_campaigns, inputs, now);
    let mut delivered = base_rve;
    if let Some(obj) = delivered.as_object_mut() {
        obj.insert("campaigns".into(), Value::Array(campaigns));
        obj.insert("slots".into(), slots);
    }
    delivered
}

fn resolve_now(base: &Value) -> DateTime<Utc> {
    base.get("resolve_context")
        .and_then(|c| c.get("resolved_at"))
        .and_then(|v| v.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

fn resolve_targeting(base: &Value) -> (Option<Uuid>, Option<Uuid>) {
    let ctx = base.get("resolve_context");
    let episode_id = ctx
        .and_then(|c| c.get("episode_id"))
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());
    let series_id = ctx
        .and_then(|c| c.get("series_id"))
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok());
    (episode_id, series_id)
}

/// Enrich with explicit campaign inputs (contract-lock / regression tests).
pub fn enrich_with_campaign_inputs(
    base_rve: Value,
    inputs: Vec<CampaignInput>,
    now: DateTime<Utc>,
) -> Value {
    let (episode_id, series_id) = resolve_targeting(&base_rve);
    let active = active_campaigns_for_context(&inputs, now, episode_id, series_id);
    apply_enrichment(base_rve, active, &inputs, now)
}

/// Preserve structural sections from Base (test helper).
pub fn structural_snapshot(rve: &Value) -> Value {
    let keys = [
        "schema_version",
        "resolve_context",
        "layout",
        "theme",
        "labels",
        "metadata",
        "visibility",
        "monetization_presentation",
        "watch_features",
    ];
    let mut out = serde_json::Map::new();
    if let Some(obj) = rve.as_object() {
        for k in keys {
            if let Some(v) = obj.get(k) {
                out.insert(k.to_string(), v.clone());
            }
        }
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;
    use uuid::Uuid;

    fn sample_base() -> Value {
        json!({
            "schema_version": "1.0.0",
            "resolve_context": {
                "episode_id": "a1000000-0000-4000-8000-000000000001",
                "project_id": "c3000000-0000-4000-8000-000000000003",
                "series_id": null,
                "resolved_at": "2026-06-03T12:00:00Z",
                "enforce_paywall": false
            },
            "layout": { "preset_key": "MINIMAL", "definition": { "panels": {}, "shelf_order": [] } },
            "theme": { "tokens": {} },
            "labels": { "episode_label": "Ep" },
            "metadata": {},
            "visibility": {
                "hero": { "enabled": true, "mode": "OFF" },
                "panels": { "hero": { "effective_visible": true, "baseline_visible": true } }
            },
            "campaigns": [],
            "slots": [
                {
                    "slot_key": "hero_promo",
                    "scope_type": "episode",
                    "scope_id": "a1000000-0000-4000-8000-000000000001",
                    "status": "active",
                    "campaign_id": "b2000000-0000-4000-8000-000000000002"
                },
                {
                    "slot_key": "hero_promo",
                    "scope_type": "platform",
                    "scope_id": null,
                    "status": "active",
                    "campaign_id": "c3000000-0000-4000-8000-000000000003"
                }
            ],
            "monetization_presentation": {},
            "watch_features": {
                "continue_watching_enabled": false,
                "recommendations_enabled": false,
                "downloads_enabled": false,
                "comments_enabled": false
            },
            "provenance": {
                "schema_version": { "value": "1.0.0", "source": "default" },
                "resolve_context.project_id": { "value": "c3000000-0000-4000-8000-000000000003", "source": "episode" },
                "layout.preset_key": { "value": "MINIMAL", "source": "default" },
                "labels.episode_label": { "value": "Ep", "source": "default" },
                "visibility.hero.mode": { "value": "OFF", "source": "default" },
                "visibility.hero.enabled": { "value": true, "source": "default" }
            }
        })
    }

    #[test]
    fn enrich_preserves_structural_sections() {
        let base = sample_base();
        let structural_before = structural_snapshot(&base);
        let inputs = vec![
            CampaignInput {
                id: Uuid::parse_str("b2000000-0000-4000-8000-000000000002").unwrap(),
                campaign_name: "Premiere".into(),
                campaign_type: "PREMIERE".into(),
                start_date: None,
                end_date: None,
                administrative_status: "active".into(),
                priority: 10,
                target_series_id: None,
                target_episode_id: None,
            },
            CampaignInput {
                id: Uuid::parse_str("c3000000-0000-4000-8000-000000000003").unwrap(),
                campaign_name: "Promo".into(),
                campaign_type: "PROMOTION".into(),
                start_date: None,
                end_date: None,
                administrative_status: "active".into(),
                priority: 5,
                target_series_id: None,
                target_episode_id: None,
            },
        ];
        let now = Utc.with_ymd_and_hms(2026, 6, 3, 12, 0, 0).unwrap();
        let active = active_campaigns_for_context(&inputs, now, None, None);
        let delivered = apply_enrichment(base, active, &inputs, now);
        assert_eq!(structural_snapshot(&delivered), structural_before);
        assert_eq!(delivered["campaigns"].as_array().unwrap().len(), 2);
        let bound: Vec<_> = delivered["slots"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| !s["campaign_id"].is_null())
            .collect();
        assert_eq!(bound.len(), 1);
        assert_eq!(
            bound[0]["campaign_id"].as_str().unwrap(),
            "b2000000-0000-4000-8000-000000000002"
        );
    }
}
