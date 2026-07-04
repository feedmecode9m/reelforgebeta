//! Media semantic resolver (Phase 1b.6) — inventory, failure, and thumbnail policy.

use serde_json::{json, Value};

use super::failure_model::{evaluate_reference, FailureSimulationInput, ReferenceValidity};
use super::inventory_state::{inventory_to_media_state, InventoryState, InventoryTransitionInput};
use super::placeholder_policy::{
    content_format_to_media_intent, default_placeholder_policy, MediaPlaceholderPolicy, MediaState,
};
use super::thumbnail_policy::{
    derived_representation_allowed, resolve_thumbnail_policy, ThumbnailPolicyInput,
};

const META_STATE: &str = "media_state";
const META_INTENT: &str = "media_intent";
const META_POLICY: &str = "media_placeholder_policy";
const META_REFERENCE: &str = "media_reference";
const META_INVENTORY: &str = "inventory_state";
const META_THUMBNAIL: &str = "thumbnail_resolution";
const META_FAILURE: &str = "media_failure_mode";
const META_REF_VALIDITY: &str = "media_reference_validity";

const HARNESS_FORMAT: &str = "harness_content_format";
const HARNESS_STATE: &str = "harness_media_state";
const HARNESS_INVENTORY: &str = "harness_inventory_state";
const HARNESS_DERIVED: &str = "harness_semantic_derived";
const HARNESS_STALE_REF: &str = "harness_reference_stale";
const HARNESS_DELAYED: &str = "harness_reference_delayed";
const HARNESS_SUPPRESS_REF: &str = "harness_suppress_reference";

/// Apply semantic media fields into `metadata` (schema `1.0.0` has no top-level `media` block).
///
/// CSPP boundary: this layer does not read `campaigns[]` or `slots[]` and does not assume media
/// exists. Campaign overlays are independent (GR-03 applies only downstream in orchestrator).
pub fn apply_media_semantic_stub(delivered_rve: Value) -> Value {
    let mut rve = delivered_rve;
    let Some(obj) = rve.as_object_mut() else {
        return rve;
    };

    let content_format = extract_content_format(obj);
    let intent = content_format_to_media_intent(&content_format);
    let policy = obj
        .get("metadata")
        .and_then(|m| m.as_object())
        .and_then(extract_policy_override)
        .unwrap_or_else(|| default_placeholder_policy(intent));

    let hero_mode_off = obj
        .get("visibility")
        .and_then(|v| v.get("hero"))
        .and_then(|h| h.get("mode"))
        .and_then(|m| m.as_str())
        .map(|m| m == "OFF")
        .unwrap_or(true);

    let surface_visible = obj
        .get("visibility")
        .and_then(|v| v.get("panels"))
        .and_then(|p| p.get("hero"))
        .and_then(|panel| panel.get("effective_visible"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let meta_snapshot = obj
        .get("metadata")
        .and_then(|m| m.as_object())
        .cloned()
        .unwrap_or_default();

    let inventory = parse_inventory_state(&meta_snapshot);
    let failure_input = FailureSimulationInput {
        inventory,
        suppress_reference: meta_snapshot
            .get(HARNESS_SUPPRESS_REF)
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        stale_reference: meta_snapshot
            .get(HARNESS_STALE_REF)
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        delayed_availability: meta_snapshot
            .get(HARNESS_DELAYED)
            .and_then(|v| v.as_bool())
            .unwrap_or(inventory == InventoryState::Pending),
    };

    let tentative_reference = build_tentative_reference(obj);
    let (reference_validity, failure_mode, media_reference) =
        evaluate_reference(&tentative_reference, failure_input);

    let reference_valid = reference_validity == ReferenceValidity::Valid;
    let derived_hint = meta_snapshot
        .get(HARNESS_DERIVED)
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let state = if let Some(override_state) = harness_state_override(&meta_snapshot) {
        override_state
    } else {
        let derived_allowed =
            derived_representation_allowed(reference_validity, derived_hint);
        inventory_to_media_state(InventoryTransitionInput {
            inventory,
            policy,
            intent,
            hero_mode_off,
            reference_valid,
            derived_allowed,
            delayed_availability: failure_input.delayed_availability,
        })
    };

    let thumbnail = resolve_thumbnail_policy(ThumbnailPolicyInput {
        media_state: state,
        inventory,
        reference_validity,
        placeholder_policy: policy,
        surface_visible,
    });

    let meta = obj.entry("metadata").or_insert_with(|| json!({}));
    let meta_obj = meta.as_object_mut().expect("metadata object");

    meta_obj.insert(META_INVENTORY.to_string(), json!(inventory.as_wire_str()));
    meta_obj.insert(META_STATE.to_string(), json!(state.as_wire_str()));
    meta_obj.insert(META_INTENT.to_string(), json!(intent.as_wire_str()));
    meta_obj.insert(META_POLICY.to_string(), json!(policy.as_wire_str()));
    meta_obj.insert(META_REFERENCE.to_string(), media_reference);
    meta_obj.insert(
        META_THUMBNAIL.to_string(),
        json!(thumbnail.as_wire_str()),
    );
    meta_obj.insert(
        META_FAILURE.to_string(),
        json!(failure_mode.as_wire_str()),
    );
    meta_obj.insert(
        META_REF_VALIDITY.to_string(),
        json!(reference_validity.as_wire_str()),
    );

    rve
}

fn parse_inventory_state(meta: &serde_json::Map<String, Value>) -> InventoryState {
    if let Some(raw) = meta
        .get(HARNESS_INVENTORY)
        .or_else(|| meta.get(META_INVENTORY))
        .and_then(|v| v.as_str())
    {
        if let Some(parsed) = InventoryState::parse(raw) {
            return parsed;
        }
    }
    InventoryState::Missing
}

fn extract_content_format(obj: &serde_json::Map<String, Value>) -> String {
    if let Some(fmt) = obj
        .get("experience_profile")
        .and_then(|p| p.get("content_format"))
        .and_then(|c| c.as_str())
    {
        return fmt.to_string();
    }
    obj.get("metadata")
        .and_then(|m| m.as_object())
        .and_then(|m| m.get(HARNESS_FORMAT))
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN")
        .to_string()
}

fn extract_policy_override(meta: &serde_json::Map<String, Value>) -> Option<MediaPlaceholderPolicy> {
    let raw = meta.get(META_POLICY)?.as_str()?;
    match raw {
        "CONTENT_ONLY" => Some(MediaPlaceholderPolicy::ContentOnly),
        "CONTENT_THEN_PLACEHOLDER" => Some(MediaPlaceholderPolicy::ContentThenPlaceholder),
        "CONTENT_THEN_GENERATED" => Some(MediaPlaceholderPolicy::ContentThenGenerated),
        "FULLY_SYNTHETIC_ALLOWED" => Some(MediaPlaceholderPolicy::FullySyntheticAllowed),
        _ => None,
    }
}

fn harness_state_override(meta: &serde_json::Map<String, Value>) -> Option<MediaState> {
    let raw = meta.get(HARNESS_STATE)?.as_str()?;
    match raw {
        "REAL_MEDIA" => Some(MediaState::RealMedia),
        "DERIVED_MEDIA" => Some(MediaState::DerivedMedia),
        "PLACEHOLDER_MEDIA" => Some(MediaState::PlaceholderMedia),
        "FALLBACK_MEDIA" => Some(MediaState::FallbackMedia),
        _ => None,
    }
}

fn build_tentative_reference(obj: &serde_json::Map<String, Value>) -> Value {
    if let Some(ep) = obj
        .get("resolve_context")
        .and_then(|c| c.get("episode_id"))
        .and_then(|e| e.as_str())
    {
        return json!(format!("episode:{ep}"));
    }
    Value::Null
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn applies_semantic_metadata_fields() {
        let delivered = json!({
            "metadata": { "harness_content_format": "DOCUMENTARY" },
            "visibility": {
                "hero": { "mode": "STATIC_IMAGE", "enabled": true },
                "panels": { "hero": { "effective_visible": true, "baseline_visible": true } }
            },
            "resolve_context": {
                "episode_id": "a1000000-0000-4000-8000-000000000001",
                "project_id": "c3000000-0000-4000-8000-000000000003",
                "resolved_at": "2026-06-03T12:00:00Z",
                "enforce_paywall": false
            }
        });
        let out = apply_media_semantic_stub(delivered);
        assert_eq!(out["metadata"]["media_intent"], "DOCUMENTARY");
        assert_eq!(out["metadata"]["inventory_state"], "MISSING");
        assert_eq!(out["metadata"]["media_placeholder_policy"], "CONTENT_THEN_PLACEHOLDER");
        assert_eq!(out["metadata"]["media_state"], "PLACEHOLDER_MEDIA");
        assert_eq!(out["metadata"]["thumbnail_resolution"], "MUST_PLACEHOLDER");
        assert_eq!(out["metadata"]["media_failure_mode"], "none");
        assert!(out["metadata"]["media_reference"]
            .as_str()
            .unwrap()
            .starts_with("episode:"));
    }

    #[test]
    fn ready_inventory_with_valid_reference() {
        let delivered = json!({
            "metadata": {
                "harness_content_format": "CLIP",
                "harness_inventory_state": "READY"
            },
            "visibility": {
                "hero": { "mode": "STATIC_IMAGE", "enabled": true },
                "panels": { "hero": { "effective_visible": true, "baseline_visible": true } }
            },
            "resolve_context": {
                "episode_id": "a1000000-0000-4000-8000-000000000001",
                "project_id": "c3000000-0000-4000-8000-000000000003",
                "resolved_at": "2026-06-03T12:00:00Z",
                "enforce_paywall": false
            }
        });
        let out = apply_media_semantic_stub(delivered);
        assert_eq!(out["metadata"]["media_state"], "REAL_MEDIA");
        assert_eq!(out["metadata"]["thumbnail_resolution"], "SHOULD_EXIST");
    }

    #[test]
    fn missing_reference_failure() {
        let delivered = json!({
            "metadata": {
                "harness_inventory_state": "READY",
                "harness_suppress_reference": true
            },
            "visibility": {
                "hero": { "mode": "STATIC_IMAGE", "enabled": true },
                "panels": { "hero": { "effective_visible": true, "baseline_visible": true } }
            },
            "resolve_context": {
                "project_id": "c3000000-0000-4000-8000-000000000003",
                "resolved_at": "2026-06-03T12:00:00Z",
                "enforce_paywall": false
            }
        });
        let out = apply_media_semantic_stub(delivered);
        assert!(out["metadata"]["media_reference"].is_null());
        assert_eq!(out["metadata"]["media_failure_mode"], "missing_reference");
        assert_eq!(out["metadata"]["media_reference_validity"], "absent");
    }

    #[test]
    fn pending_delayed_availability() {
        let delivered = json!({
            "metadata": {
                "harness_content_format": "DOCUMENTARY",
                "harness_inventory_state": "PENDING",
                "harness_reference_delayed": true
            },
            "visibility": {
                "hero": { "mode": "STATIC_IMAGE", "enabled": true },
                "panels": { "hero": { "effective_visible": true, "baseline_visible": true } }
            },
            "resolve_context": {
                "episode_id": "a1000000-0000-4000-8000-000000000001",
                "project_id": "c3000000-0000-4000-8000-000000000003",
                "resolved_at": "2026-06-03T12:00:00Z",
                "enforce_paywall": false
            }
        });
        let out = apply_media_semantic_stub(delivered);
        assert_eq!(out["metadata"]["media_failure_mode"], "delayed_availability");
        assert_eq!(out["metadata"]["media_reference_validity"], "pending");
        assert_eq!(out["metadata"]["media_state"], "PLACEHOLDER_MEDIA");
    }
}
