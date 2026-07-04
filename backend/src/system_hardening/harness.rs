//! Shared harness inputs for system hardening tests.

use serde_json::{json, Value};

use crate::experience::contract::SCHEMA_VERSION;

/// Frozen harness vector (documentary) — aligned with pipeline_integration_tests.
pub fn harness_base_rve() -> Value {
    json!({
        "schema_version": SCHEMA_VERSION,
        "resolve_context": {
            "episode_id": "a1000000-0000-4000-8000-000000000001",
            "project_id": "c3000000-0000-4000-8000-000000000003",
            "resolved_at": "2026-06-03T12:00:00Z",
            "enforce_paywall": false
        },
        "layout": {
            "preset_key": "MINIMAL",
            "definition": { "panels": { "hero": { "visible": true, "zone": "top" } }, "shelf_order": [] }
        },
        "theme": { "tokens": {} },
        "labels": { "episode_label": "system_hardening" },
        "metadata": { "harness_content_format": "DOCUMENTARY" },
        "visibility": {
            "hero": { "enabled": true, "mode": "OFF" },
            "panels": {
                "hero": { "effective_visible": true, "baseline_visible": true },
                "continue_watching": { "effective_visible": true, "baseline_visible": true }
            }
        },
        "campaigns": [],
        "slots": [],
        "monetization_presentation": {},
        "watch_features": {
            "continue_watching_enabled": true,
            "recommendations_enabled": false,
            "downloads_enabled": false,
            "comments_enabled": false
        },
        "provenance": {
            "schema_version": { "value": SCHEMA_VERSION, "source": "default" },
            "resolve_context.project_id": { "value": "c3000000-0000-4000-8000-000000000003", "source": "episode" },
            "layout.preset_key": { "value": "MINIMAL", "source": "default" },
            "labels.episode_label": { "value": "system_hardening", "source": "default" },
            "visibility.hero.mode": { "value": "OFF", "source": "default" },
            "visibility.hero.enabled": { "value": true, "source": "default" }
        }
    })
}

/// Frozen semantic `metadata` media keys (Phase 1b.7).
pub const FROZEN_MEDIA_METADATA_KEYS: &[&str] = &[
    "media_state",
    "media_intent",
    "media_placeholder_policy",
    "media_reference",
    "inventory_state",
    "thumbnail_resolution",
    "media_failure_mode",
    "media_reference_validity",
];
