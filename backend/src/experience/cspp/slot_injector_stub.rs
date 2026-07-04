//! Slot injector — collision resolution without structural RVE mutation (Phase 1b.5).

use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use super::campaign_loader_stub::{CampaignInput, campaign_priority_key};

const HERO_KEYS: &[&str] = &["hero_promo"];
const THEATER_KEYS: &[&str] = &["theater_overlay"];
const SHELF_FEATURED_KEYS: &[&str] = &["shelf_featured"];
const SHELF_BADGE_KEYS: &[&str] = &["shelf_badge"];

/// Enrich `slots[]` and campaign provenance; structural sections unchanged.
pub fn inject_slots(
    base_rve: &Value,
    active_campaigns: &[Value],
    campaign_inputs: &[CampaignInput],
    now: DateTime<Utc>,
) -> (Value, Vec<Value>) {
    let slots = base_rve
        .get("slots")
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();

    let active_ids: std::collections::HashSet<String> = active_campaigns
        .iter()
        .filter_map(|c| c.get("id").and_then(|id| id.as_str()).map(str::to_string))
        .collect();

    let input_by_id: HashMap<Uuid, &CampaignInput> =
        campaign_inputs.iter().map(|c| (c.id, c)).collect();

    let mut enriched: Vec<Value> = slots
        .iter()
        .map(|slot| enrich_slot_row(slot, &active_ids, now))
        .collect();

    resolve_collision_group(
        &mut enriched,
        HERO_KEYS,
        "hero_surface",
        &active_ids,
        &input_by_id,
    );
    resolve_collision_group(
        &mut enriched,
        THEATER_KEYS,
        "theater_surface",
        &active_ids,
        &input_by_id,
    );
    resolve_collision_group(
        &mut enriched,
        SHELF_FEATURED_KEYS,
        "shelf_featured_surface",
        &active_ids,
        &input_by_id,
    );
    resolve_shelf_badge_collisions(&mut enriched, &active_ids, &input_by_id);

    (Value::Array(enriched), active_campaigns.to_vec())
}

fn enrich_slot_row(slot: &Value, active_ids: &std::collections::HashSet<String>, now: DateTime<Utc>) -> Value {
    let mut row = slot.clone();
    let obj = row.as_object_mut().expect("slot object");

    if let Some(cid) = obj.get("campaign_id").and_then(|v| v.as_str()) {
        if !active_ids.contains(cid) {
            obj.insert("campaign_id".into(), Value::Null);
        }
    }

    let status = obj
        .get("status")
        .and_then(|s| s.as_str())
        .unwrap_or("active");
    if !slot_window_active(obj, now) {
        obj.insert("status".into(), json!("ended"));
    } else if status == "scheduled" {
        obj.insert("status".into(), json!("active"));
    } else {
        obj.insert("status".into(), json!(status));
    }

    row
}

fn slot_window_active(obj: &serde_json::Map<String, Value>, _now: DateTime<Utc>) -> bool {
    let status = obj.get("status").and_then(|s| s.as_str()).unwrap_or("active");
    status != "ended"
}

fn resolve_collision_group(
    slots: &mut [Value],
    keys: &[&str],
    _group: &str,
    active_ids: &std::collections::HashSet<String>,
    input_by_id: &HashMap<Uuid, &CampaignInput>,
) {
    let indices: Vec<usize> = slots
        .iter()
        .enumerate()
        .filter(|(_, s)| {
            s.get("slot_key")
                .and_then(|k| k.as_str())
                .map(|k| keys.contains(&k))
                .unwrap_or(false)
        })
        .map(|(i, _)| i)
        .collect();

    if indices.is_empty() {
        return;
    }

    let winner_idx = pick_winner_index(&indices, slots, active_ids, input_by_id);
    for idx in indices {
        if Some(idx) != winner_idx {
            if let Some(obj) = slots[idx].as_object_mut() {
                obj.insert("campaign_id".into(), Value::Null);
            }
        }
    }
}

fn resolve_shelf_badge_collisions(
    slots: &mut [Value],
    active_ids: &std::collections::HashSet<String>,
    input_by_id: &HashMap<Uuid, &CampaignInput>,
) {
    let mut by_scope: HashMap<(String, String), Vec<usize>> = HashMap::new();
    for (idx, slot) in slots.iter().enumerate() {
        let Some(key) = slot.get("slot_key").and_then(|k| k.as_str()) else {
            continue;
        };
        if !SHELF_BADGE_KEYS.contains(&key) {
            continue;
        }
        let scope_type = slot
            .get("scope_type")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();
        let scope_id = slot
            .get("scope_id")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();
        by_scope
            .entry((scope_type, scope_id))
            .or_default()
            .push(idx);
    }

    for indices in by_scope.values() {
        let winner_idx = pick_winner_index(indices, slots, active_ids, input_by_id);
        for &idx in indices {
            if Some(idx) != winner_idx {
                if let Some(obj) = slots[idx].as_object_mut() {
                    obj.insert("campaign_id".into(), Value::Null);
                }
            }
        }
    }
}

fn pick_winner_index(
    indices: &[usize],
    slots: &[Value],
    active_ids: &std::collections::HashSet<String>,
    input_by_id: &HashMap<Uuid, &CampaignInput>,
) -> Option<usize> {
    let mut best: Option<(usize, (i32, u8, u8, Uuid))> = None;
    for &idx in indices {
        let Some(cid_str) = slots[idx].get("campaign_id").and_then(|c| c.as_str()) else {
            continue;
        };
        if !active_ids.contains(cid_str) {
            continue;
        }
        let Ok(cid) = Uuid::parse_str(cid_str) else {
            continue;
        };
        let Some(input) = input_by_id.get(&cid) else {
            continue;
        };
        let key = campaign_priority_key(input);
        if best.as_ref().map(|(_, k)| key > *k).unwrap_or(true) {
            best = Some((idx, key));
        }
    }
    best.map(|(idx, _)| idx)
}
