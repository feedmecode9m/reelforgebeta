//! Runtime slice invariants: pipeline unchanged; adapter determinism preserved.

use crate::experience::compose_pipeline::run_from_base_rve;
use crate::experience::contract::SCHEMA_VERSION;
use serde_json::json;

fn harness_base() -> serde_json::Value {
    json!({
        "schema_version": SCHEMA_VERSION,
        "resolve_context": {
            "episode_id": "a1000000-0000-4000-8000-000000000001",
            "project_id": "c3000000-0000-4000-8000-000000000003",
            "resolved_at": "2026-06-03T12:00:00Z",
            "enforce_paywall": false
        },
        "layout": { "preset_key": "MINIMAL", "definition": { "panels": {}, "shelf_order": [] } },
        "theme": { "tokens": {} },
        "labels": { "episode_label": "runtime_slice" },
        "metadata": { "harness_content_format": "DOCUMENTARY" },
        "visibility": {
            "hero": { "enabled": true, "mode": "OFF" },
            "panels": {
                "hero": { "effective_visible": true, "baseline_visible": true }
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
            "schema_version": { "value": SCHEMA_VERSION, "source": "default" }
        }
    })
}

#[test]
fn compose_pipeline_unchanged_without_runtime_feature() {
    let base = harness_base();
    let a = run_from_base_rve(base.clone());
    let b = run_from_base_rve(base);
    assert_eq!(a.composition_plan, b.composition_plan);
    assert_eq!(a.delivered_with_media, b.delivered_with_media);
    assert_eq!(a.base_rve, b.base_rve);
}

#[cfg(feature = "runtime_asset_mode")]
mod with_runtime {
    use super::*;
    use crate::asset_resolution::mock_registry::MockAssetRegistry;
    use crate::asset_resolution::AssetResolutionAdapter;
    use crate::asset_resolution::metadata_snapshot_from_json;
    use crate::asset_runtime::InMemoryAssetRegistry;
    use crate::viewer_sim::validate_runtime_bind;

    #[test]
    fn adapter_binding_identical_with_runtime_lookup() {
        let artifacts = run_from_base_rve(harness_base());
        let meta = artifacts.delivered_with_media["metadata"]
            .as_object()
            .unwrap();
        let snap = metadata_snapshot_from_json(meta);
        let media_ref = meta["media_reference"].as_str().unwrap();
        let inventory = MockAssetRegistry::ready_episode();
        let plain = AssetResolutionAdapter::resolve(Some(media_ref), &snap, inventory.records());
        let runtime_reg = InMemoryAssetRegistry::harness_dataset();
        let enriched = AssetResolutionAdapter::resolve_with_runtime(
            Some(media_ref),
            &snap,
            inventory.records(),
            Some(&runtime_reg),
        );
        assert_eq!(plain, enriched.result);
        let _ = validate_runtime_bind(&artifacts.delivered_with_media, enriched.runtime_asset.as_ref());
    }

    #[test]
    fn pipeline_output_identical_with_runtime_feature_enabled() {
        let a = run_from_base_rve(harness_base());
        let b = run_from_base_rve(harness_base());
        assert_eq!(a.composition_plan, b.composition_plan);
        assert_eq!(a.delivered_with_media, b.delivered_with_media);
    }
}
