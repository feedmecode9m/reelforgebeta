//! E2E pipeline + Phase 1b.7 contract lock tests.
//! Harness vectors, cross-layer invariants, and regression guards.

use super::compose_pipeline::run_from_base_rve;
use super::contract::{validate_rve, SCHEMA_VERSION};
use super::cspp::composition_plan::COMPOSITION_PLAN_VERSION;
use serde_json::json;
use serde_json::Value;

fn harness_vector_base_rve(vector_id: &str, content_format: &str) -> Value {
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
        "labels": { "episode_label": vector_id },
        "metadata": { "harness_content_format": content_format },
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
            "labels.episode_label": { "value": vector_id, "source": "default" },
            "visibility.hero.mode": { "value": "OFF", "source": "default" },
            "visibility.hero.enabled": { "value": true, "source": "default" }
        }
    })
}

fn assert_pipeline_ok(vector_id: &str, content_format: &str) {
    let base = harness_vector_base_rve(vector_id, content_format);
    validate_rve(&base).expect("harness base RVE must validate");

    let artifacts = run_from_base_rve(base);

    validate_rve(&artifacts.base_rve).expect("base_rve valid");
    validate_rve(&artifacts.delivered_rve).expect("delivered_rve valid");
    validate_rve(&artifacts.delivered_with_media).expect("delivered_with_media valid");

    assert_eq!(
        super::cspp::structural_snapshot(&artifacts.base_rve),
        super::cspp::structural_snapshot(&artifacts.delivered_rve)
    );

    let meta = &artifacts.delivered_with_media["metadata"];
    assert!(meta.get("media_state").is_some());
    assert!(meta.get("media_intent").is_some());
    assert!(meta.get("media_placeholder_policy").is_some());
    assert!(meta.get("inventory_state").is_some());
    assert!(meta.get("thumbnail_resolution").is_some());
    assert!(meta.get("media_failure_mode").is_some());

    let plan = &artifacts.composition_plan;
    assert_eq!(plan.plan_version, COMPOSITION_PLAN_VERSION);
    assert_eq!(plan.schema_version, SCHEMA_VERSION);
}

#[test]
fn pipeline_vector_documentary() {
    assert_pipeline_ok("documentary", "DOCUMENTARY");
}

#[test]
fn pipeline_vector_micro_drama() {
    assert_pipeline_ok("micro_drama", "MICRO_DRAMA");
}

#[test]
fn pipeline_vector_music_video() {
    assert_pipeline_ok("music_video", "MUSIC_VIDEO");
}

#[test]
fn pipeline_vector_clip() {
    assert_pipeline_ok("clip", "CLIP");
}

#[test]
fn pipeline_vector_failure_case() {
    assert_pipeline_ok("failure_case", "UNKNOWN");
}

#[test]
fn pipeline_full_run_with_database_optional() {
    let rt = tokio::runtime::Runtime::new().expect("runtime");
    rt.block_on(async {
        let Some(url) = std::env::var("DATABASE_URL").ok() else {
            eprintln!("skip pipeline_full_run: DATABASE_URL not set");
            return;
        };
        let pool = sqlx::PgPool::connect(&url).await.expect("connect");
        let _ = crate::db::run_migrations(&pool).await;

        let episode_id: Option<uuid::Uuid> = sqlx::query_scalar(
            r#"SELECT e.id FROM studio_episodes e LIMIT 1"#,
        )
        .fetch_optional(&pool)
        .await
        .expect("query");

        let Some(episode_id) = episode_id else {
            eprintln!("skip pipeline_full_run: no episodes");
            return;
        };

        let artifacts = super::compose_pipeline::run(&pool, episode_id)
            .await
            .expect("pipeline run");
        validate_rve(&artifacts.base_rve).expect("base valid");
        validate_rve(&artifacts.delivered_with_media).expect("delivered valid");
        assert_eq!(artifacts.composition_plan.schema_version, SCHEMA_VERSION);
    });
}

// --- Phase 1b.7: frozen semantic constants (must match media modules) ---

const FROZEN_MEDIA_STATES: &[&str] = &[
    "REAL_MEDIA",
    "DERIVED_MEDIA",
    "PLACEHOLDER_MEDIA",
    "FALLBACK_MEDIA",
];
const FROZEN_MEDIA_INTENTS: &[&str] = &[
    "MICRO_DRAMA",
    "MUSIC_VIDEO",
    "CLIP",
    "DOCUMENTARY",
    "UNKNOWN",
];
const FROZEN_INVENTORY: &[&str] = &["PENDING", "READY", "MISSING", "FAILED"];
const FROZEN_PLACEHOLDER_POLICIES: &[&str] = &[
    "CONTENT_ONLY",
    "CONTENT_THEN_PLACEHOLDER",
    "CONTENT_THEN_GENERATED",
    "FULLY_SYNTHETIC_ALLOWED",
];
const FROZEN_THUMBNAIL: &[&str] = &["SHOULD_EXIST", "ALLOW_DERIVED", "MUST_PLACEHOLDER"];
const FROZEN_FAILURE_MODES: &[&str] = &[
    "none",
    "missing_reference",
    "stale_reference",
    "delayed_availability",
];
const FROZEN_REF_VALIDITY: &[&str] = &["valid", "absent", "stale", "pending"];

#[test]
fn contract_lock_frozen_enum_consistency() {
    use crate::media::{
        content_format_to_media_intent, InventoryState, MediaIntent, MediaPlaceholderPolicy,
        MediaState,
    };

    assert_eq!(MediaState::RealMedia.as_wire_str(), FROZEN_MEDIA_STATES[0]);
    assert_eq!(MediaState::DerivedMedia.as_wire_str(), FROZEN_MEDIA_STATES[1]);
    assert_eq!(MediaState::PlaceholderMedia.as_wire_str(), FROZEN_MEDIA_STATES[2]);
    assert_eq!(MediaState::FallbackMedia.as_wire_str(), FROZEN_MEDIA_STATES[3]);

    assert_eq!(MediaIntent::Documentary.as_wire_str(), "DOCUMENTARY");
    assert_eq!(
        content_format_to_media_intent("MICRO_DRAMA").as_wire_str(),
        FROZEN_MEDIA_INTENTS[0]
    );

    for inv in FROZEN_INVENTORY {
        assert!(InventoryState::parse(inv).is_some());
    }

    assert_eq!(
        MediaPlaceholderPolicy::ContentThenPlaceholder.as_wire_str(),
        FROZEN_PLACEHOLDER_POLICIES[1]
    );

    let _ = (FROZEN_THUMBNAIL, FROZEN_FAILURE_MODES, FROZEN_REF_VALIDITY);
}

#[test]
fn contract_lock_resolver_base_campaigns_empty() {
    let base = harness_vector_base_rve("documentary", "DOCUMENTARY");
    assert_eq!(base["campaigns"], json!([]));
}

#[test]
fn contract_lock_resolver_media_metadata_present() {
    let artifacts = run_from_base_rve(harness_vector_base_rve("clip", "CLIP"));
    let meta = &artifacts.delivered_with_media["metadata"];
    for key in [
        "media_state",
        "media_intent",
        "media_placeholder_policy",
        "inventory_state",
    ] {
        let val = meta.get(key).and_then(|v| v.as_str()).expect(key);
        assert!(!val.is_empty(), "{key} must be non-empty wire enum");
    }
    assert!(
        FROZEN_MEDIA_STATES.contains(&meta["media_state"].as_str().unwrap()),
        "media_state must be frozen enum"
    );
    assert!(
        FROZEN_MEDIA_INTENTS.contains(&meta["media_intent"].as_str().unwrap()),
        "media_intent must be frozen enum"
    );
}

#[test]
fn contract_lock_cspp_structural_immutable() {
    let base = harness_vector_base_rve("music_video", "MUSIC_VIDEO");
    let artifacts = run_from_base_rve(base);
    assert_eq!(
        super::cspp::structural_snapshot(&artifacts.base_rve),
        super::cspp::structural_snapshot(&artifacts.delivered_rve)
    );
}

#[test]
fn contract_lock_cspp_viewer_determinism() {
    let base = harness_vector_base_rve("micro_drama", "MICRO_DRAMA");
    let a = run_from_base_rve(base.clone());
    let b = run_from_base_rve(base);
    assert_eq!(a.composition_plan, b.composition_plan);
}

#[test]
fn contract_lock_failure_model_exhaustive() {
    use crate::media::failure_model::{
        evaluate_reference, FailureSimulationInput, MediaFailureMode, ReferenceValidity,
    };
    use crate::media::InventoryState;

    let ref_episode = json!("episode:a1000000-0000-4000-8000-000000000001");

    let cases: &[(InventoryState, bool, bool, bool, ReferenceValidity, MediaFailureMode)] = &[
        (
            InventoryState::Ready,
            true,
            false,
            false,
            ReferenceValidity::Absent,
            MediaFailureMode::MissingReference,
        ),
        (
            InventoryState::Ready,
            false,
            true,
            false,
            ReferenceValidity::Stale,
            MediaFailureMode::StaleReference,
        ),
        (
            InventoryState::Pending,
            false,
            false,
            true,
            ReferenceValidity::Pending,
            MediaFailureMode::DelayedAvailability,
        ),
        (
            InventoryState::Ready,
            false,
            false,
            false,
            ReferenceValidity::Valid,
            MediaFailureMode::None,
        ),
    ];

    for (inv, suppress, stale, delayed, exp_validity, exp_mode) in cases {
        let (validity, mode, _) = evaluate_reference(
            &ref_episode,
            FailureSimulationInput {
                inventory: *inv,
                suppress_reference: *suppress,
                stale_reference: *stale,
                delayed_availability: *delayed,
            },
        );
        assert_eq!(validity, *exp_validity, "inventory {inv:?}");
        assert_eq!(mode, *exp_mode, "inventory {inv:?}");
    }

    for inv in [
        InventoryState::Pending,
        InventoryState::Ready,
        InventoryState::Missing,
        InventoryState::Failed,
    ] {
        assert!(FROZEN_INVENTORY.contains(&inv.as_wire_str()));
    }
}

#[test]
fn contract_lock_inventory_state_complete() {
    use crate::media::inventory_state::{inventory_to_media_state, InventoryState, InventoryTransitionInput};
    use crate::media::{MediaIntent, MediaPlaceholderPolicy, MediaState};

    let policy = MediaPlaceholderPolicy::ContentThenPlaceholder;
    let inputs = [
        (InventoryState::Ready, true, false, MediaState::RealMedia),
        (InventoryState::Failed, false, false, MediaState::FallbackMedia),
        (InventoryState::Missing, false, false, MediaState::PlaceholderMedia),
        (InventoryState::Pending, false, true, MediaState::PlaceholderMedia),
    ];

    for (inventory, reference_valid, delayed, expected) in inputs {
        let state = inventory_to_media_state(InventoryTransitionInput {
            inventory,
            policy,
            intent: MediaIntent::Documentary,
            hero_mode_off: false,
            reference_valid,
            derived_allowed: false,
            delayed_availability: delayed,
        });
        assert_eq!(state, expected, "{inventory:?}");
        assert!(FROZEN_MEDIA_STATES.contains(&state.as_wire_str()));
    }
}

#[test]
fn regression_missing_media_reference_stable() {
    let mut base = harness_vector_base_rve("failure_case", "UNKNOWN");
    base["metadata"]["harness_inventory_state"] = json!("READY");
    base["metadata"]["harness_suppress_reference"] = json!(true);
    if let Some(ctx) = base.get_mut("resolve_context").and_then(|c| c.as_object_mut()) {
        ctx.remove("episode_id");
    }

    let a = run_from_base_rve(base.clone());
    let b = run_from_base_rve(base);
    for artifacts in [&a, &b] {
        let meta = &artifacts.delivered_with_media["metadata"];
        assert!(meta["media_reference"].is_null());
        assert_eq!(meta["media_failure_mode"], "missing_reference");
        assert_eq!(meta["media_reference_validity"], "absent");
    }
    assert_eq!(
        a.delivered_with_media["metadata"]["media_failure_mode"],
        b.delivered_with_media["metadata"]["media_failure_mode"]
    );
}

#[test]
fn regression_placeholder_policy_documentary() {
    let artifacts = run_from_base_rve(harness_vector_base_rve("documentary", "DOCUMENTARY"));
    let policy = artifacts.delivered_with_media["metadata"]["media_placeholder_policy"]
        .as_str()
        .unwrap();
    assert_eq!(policy, "CONTENT_THEN_PLACEHOLDER");
    let a = run_from_base_rve(harness_vector_base_rve("documentary", "DOCUMENTARY"));
    let b = run_from_base_rve(harness_vector_base_rve("documentary", "DOCUMENTARY"));
    assert_eq!(
        a.delivered_with_media["metadata"]["media_placeholder_policy"],
        b.delivered_with_media["metadata"]["media_placeholder_policy"]
    );
}

#[test]
fn regression_campaign_slot_collision_deterministic() {
    use chrono::TimeZone;
    use super::cspp::{self, campaign_loader_stub::CampaignInput};
    use uuid::Uuid;

    let mut base = harness_vector_base_rve("music_video", "MUSIC_VIDEO");
    base["slots"] = json!([
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
    ]);

    let inputs = vec![
        CampaignInput {
            id: Uuid::parse_str("b2000000-0000-4000-8000-000000000002").unwrap(),
            campaign_name: "A".into(),
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
            campaign_name: "B".into(),
            campaign_type: "PROMOTION".into(),
            start_date: None,
            end_date: None,
            administrative_status: "active".into(),
            priority: 5,
            target_series_id: None,
            target_episode_id: None,
        },
    ];
    let now = chrono::Utc.with_ymd_and_hms(2026, 6, 3, 12, 0, 0).unwrap();
    let active = cspp::campaign_loader_stub::active_campaigns_for_context(&inputs, now, None, None);

    let d1 = cspp::enrich_with_campaign_inputs(base.clone(), inputs.clone(), now);
    let d2 = cspp::enrich_with_campaign_inputs(base, inputs, now);
    let winner = "b2000000-0000-4000-8000-000000000002";
    for delivered in [&d1, &d2] {
        let bound: Vec<_> = delivered["slots"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| !s["campaign_id"].is_null())
            .collect();
        assert_eq!(bound.len(), 1);
        assert_eq!(bound[0]["campaign_id"].as_str().unwrap(), winner);
        assert_eq!(delivered["campaigns"].as_array().unwrap().len(), active.len());
    }
    assert_eq!(d1["slots"], d2["slots"]);
}

#[test]
fn regression_viewer_surface_rendering_deterministic() {
    let mut base = harness_vector_base_rve("micro_drama", "MICRO_DRAMA");
    base["visibility"]["hero"]["mode"] = json!("STATIC_IMAGE");
    base["metadata"]["harness_inventory_state"] = json!("READY");

    let p1 = run_from_base_rve(base.clone());
    let p2 = run_from_base_rve(base);
    assert_eq!(p1.composition_plan, p2.composition_plan);
    assert_eq!(p1.composition_plan.schema_version, SCHEMA_VERSION);
}

// --- Phase 1c.3 / 1c.4: asset adapter + scenario feed (test-only; not in compose_pipeline) ---

fn adapter_snapshot_from_pipeline(vector_id: &str, content_format: &str) -> (String, crate::asset_resolution::MetadataSnapshot) {
    let artifacts = run_from_base_rve(harness_vector_base_rve(vector_id, content_format));
    let meta = artifacts.delivered_with_media["metadata"]
        .as_object()
        .expect("metadata object");
    let media_ref = meta
        .get("media_reference")
        .and_then(|v| v.as_str())
        .expect("harness episode must emit media_reference")
        .to_string();
    let snap = crate::asset_resolution::metadata_snapshot_from_json(meta);
    (media_ref, snap)
}

#[test]
fn phase_1c3_adapter_ready_maps_to_real_media() {
    use crate::asset_resolution::mock_registry::MockAssetRegistry;
    use crate::asset_resolution::scenario_feed::AssetScenarioFeed;
    use crate::asset_resolution::AssetResolutionAdapter;

    let (media_ref, snap) = adapter_snapshot_from_pipeline("documentary", "DOCUMENTARY");
    let registry = MockAssetRegistry::from_scenario_step(
        &AssetScenarioFeed::upload_lifecycle_scenario(),
        2,
    );
    let result = AssetResolutionAdapter::resolve(Some(&media_ref), &snap, registry.records());

    assert_eq!(result.binding.media_state, "REAL_MEDIA");
    assert_eq!(result.binding.inventory_state, "READY");
    assert_eq!(result.binding.media_reference_validity, "valid");
    assert!(result.bundle.entries.contains_key(&media_ref));
}

#[test]
fn phase_1c3_adapter_processing_maps_to_placeholder() {
    use crate::asset_resolution::mock_registry::MockAssetRegistry;
    use crate::asset_resolution::scenario_feed::AssetScenarioFeed;
    use crate::asset_resolution::AssetResolutionAdapter;

    let (media_ref, snap) = adapter_snapshot_from_pipeline("clip", "CLIP");
    let registry = MockAssetRegistry::from_scenario_step(
        &AssetScenarioFeed::upload_lifecycle_scenario(),
        1,
    );
    let result = AssetResolutionAdapter::resolve(Some(&media_ref), &snap, registry.records());

    assert_eq!(result.binding.media_state, "PLACEHOLDER_MEDIA");
    assert_eq!(result.binding.inventory_state, "PENDING");
    assert_eq!(result.binding.media_reference_validity, "pending");
    assert_eq!(result.binding.media_failure_mode, "delayed_availability");
    assert!(result.bundle.entries.is_empty());
}

#[test]
fn phase_1c3_adapter_missing_maps_to_fallback() {
    use crate::asset_resolution::mock_registry::MockAssetRegistry;
    use crate::asset_resolution::scenario_feed::AssetScenarioFeed;
    use crate::asset_resolution::AssetResolutionAdapter;

    let (media_ref, snap) = adapter_snapshot_from_pipeline("music_video", "MUSIC_VIDEO");
    let registry = MockAssetRegistry::from_scenario_step(
        &AssetScenarioFeed::upload_lifecycle_scenario(),
        0,
    );
    let result = AssetResolutionAdapter::resolve(Some(&media_ref), &snap, registry.records());

    assert_eq!(result.binding.media_state, "FALLBACK_MEDIA");
    assert_eq!(result.binding.inventory_state, "MISSING");
    assert_eq!(result.binding.media_failure_mode, "missing_reference");
    assert!(result.bundle.entries.is_empty());
}

#[test]
fn phase_1c3_adapter_failed_maps_to_fallback() {
    use crate::asset_resolution::mock_registry::MockAssetRegistry;
    use crate::asset_resolution::scenario_feed::AssetScenarioFeed;
    use crate::asset_resolution::AssetResolutionAdapter;

    let (media_ref, snap) = adapter_snapshot_from_pipeline("micro_drama", "MICRO_DRAMA");
    let registry = MockAssetRegistry::from_scenario_step(
        &AssetScenarioFeed::upload_lifecycle_scenario(),
        3,
    );
    let result = AssetResolutionAdapter::resolve(Some(&media_ref), &snap, registry.records());

    assert_eq!(result.binding.media_state, "FALLBACK_MEDIA");
    assert_eq!(result.binding.inventory_state, "FAILED");
    assert_eq!(result.binding.media_reference_validity, "stale");
    assert!(result.bundle.entries.is_empty());
}

#[test]
fn phase_1c3_adapter_deterministic_and_viewer_sim_unchanged() {
    use crate::asset_resolution::mock_registry::MockAssetRegistry;
    use crate::asset_resolution::AssetResolutionAdapter;

    let base = harness_vector_base_rve("documentary", "DOCUMENTARY");
    let artifacts = run_from_base_rve(base.clone());
    let repeat = run_from_base_rve(base);
    assert_eq!(artifacts.composition_plan, repeat.composition_plan);

    let meta = artifacts.delivered_with_media["metadata"]
        .as_object()
        .unwrap();
    let media_ref = meta["media_reference"].as_str().unwrap();
    let snap = crate::asset_resolution::metadata_snapshot_from_json(meta);
    let registry = MockAssetRegistry::harness();

    let a = AssetResolutionAdapter::resolve(Some(media_ref), &snap, registry.records());
    let b = AssetResolutionAdapter::resolve(Some(media_ref), &snap, registry.records());
    assert_eq!(a, b);
    assert_eq!(a.binding.media_state, "REAL_MEDIA");
}

#[test]
fn phase_1c4_upload_lifecycle_scenario_e2e() {
    use crate::asset_resolution::scenario_feed::AssetScenarioFeed;
    use crate::asset_resolution::scenario_validation::{
        assert_adapter_expectation, resolve_step, AdapterStepExpectation,
    };

    let (media_ref, snap) = adapter_snapshot_from_pipeline("documentary", "DOCUMENTARY");
    let feed = AssetScenarioFeed::upload_lifecycle_scenario();
    let base = harness_vector_base_rve("documentary", "DOCUMENTARY");
    let plan_before = run_from_base_rve(base.clone()).composition_plan;
    let plan_after = run_from_base_rve(base).composition_plan;
    assert_eq!(plan_before, plan_after);

    let expectations = [
        AdapterStepExpectation {
            media_state: "FALLBACK_MEDIA",
            inventory_state: "MISSING",
            media_reference_validity: "absent",
            media_failure_mode: "missing_reference",
            bundle_nonempty: false,
        },
        AdapterStepExpectation {
            media_state: "PLACEHOLDER_MEDIA",
            inventory_state: "PENDING",
            media_reference_validity: "pending",
            media_failure_mode: "delayed_availability",
            bundle_nonempty: false,
        },
        AdapterStepExpectation {
            media_state: "REAL_MEDIA",
            inventory_state: "READY",
            media_reference_validity: "valid",
            media_failure_mode: "none",
            bundle_nonempty: true,
        },
        AdapterStepExpectation {
            media_state: "FALLBACK_MEDIA",
            inventory_state: "FAILED",
            media_reference_validity: "stale",
            media_failure_mode: "none",
            bundle_nonempty: false,
        },
    ];

    let mut timeline = Vec::new();
    for (i, (_, step)) in feed.replay().enumerate() {
        let result = resolve_step(&media_ref, &snap, &step.inventory);
        assert_adapter_expectation(&result, step.label, expectations[i]);
        timeline.push(result);
    }
    let replay = AssetScenarioFeed::upload_lifecycle_scenario();
    for (i, expected) in timeline.iter().enumerate() {
        let again = resolve_step(&media_ref, &snap, replay.inventory_at(i));
        assert_eq!(*expected, again);
    }
}

#[test]
fn phase_1c4_delayed_encoding_scenario_e2e() {
    use crate::asset_resolution::scenario_feed::AssetScenarioFeed;
    use crate::asset_resolution::scenario_validation::resolve_step;

    let (media_ref, snap) = adapter_snapshot_from_pipeline("clip", "CLIP");
    let feed = AssetScenarioFeed::delayed_encoding_scenario();

    let missing = resolve_step(&media_ref, &snap, feed.inventory_at(0));
    assert_eq!(missing.binding.media_state, "FALLBACK_MEDIA");

    let pass1 = resolve_step(&media_ref, &snap, feed.inventory_at(1));
    let pass2 = resolve_step(&media_ref, &snap, feed.inventory_at(2));
    assert_eq!(pass1, pass2);
    assert_eq!(pass1.binding.media_state, "PLACEHOLDER_MEDIA");

    let ready = resolve_step(&media_ref, &snap, feed.inventory_at(3));
    assert_eq!(ready.binding.media_state, "REAL_MEDIA");
}

#[test]
fn phase_1c4_partial_failure_batch_scenario_e2e() {
    use crate::asset_resolution::scenario_feed::AssetScenarioFeed;
    use crate::asset_resolution::scenario_validation::resolve_step;

    let (media_ref, snap) = adapter_snapshot_from_pipeline("music_video", "MUSIC_VIDEO");
    let feed = AssetScenarioFeed::partial_failure_batch_scenario();

    let processing = resolve_step(&media_ref, &snap, feed.inventory_at(0));
    assert_eq!(processing.binding.media_state, "PLACEHOLDER_MEDIA");

    let mixed = resolve_step(&media_ref, &snap, feed.inventory_at(1));
    assert_eq!(mixed.binding.media_state, "REAL_MEDIA");
    assert_eq!(mixed.binding.inventory_state, "READY");

    let all_failed = resolve_step(&media_ref, &snap, feed.inventory_at(2));
    assert_eq!(all_failed.binding.media_state, "FALLBACK_MEDIA");
    assert_eq!(all_failed.binding.inventory_state, "FAILED");
}

#[test]
fn phase_1c4_mock_registry_backward_compatible_with_scenarios() {
    use crate::asset_resolution::mock_registry::MockAssetRegistry;
    use crate::asset_resolution::scenario_feed::AssetScenarioFeed;
    use crate::asset_resolution::AssetResolutionAdapter;

    let (media_ref, snap) = adapter_snapshot_from_pipeline("micro_drama", "MICRO_DRAMA");
    let lifecycle = AssetScenarioFeed::upload_lifecycle_scenario();

    let pairs = [
        (MockAssetRegistry::missing_episode(), 0usize),
        (MockAssetRegistry::processing_episode(), 1),
        (MockAssetRegistry::ready_episode(), 2),
        (MockAssetRegistry::failed_episode(), 3),
    ];
    for (registry, step) in pairs {
        let from_scenario =
            MockAssetRegistry::from_scenario_step(&lifecycle, step);
        assert_eq!(registry.records(), from_scenario.records());
        let legacy = AssetResolutionAdapter::resolve(Some(&media_ref), &snap, registry.records());
        let scenario =
            AssetResolutionAdapter::resolve(Some(&media_ref), &snap, from_scenario.records());
        assert_eq!(legacy, scenario);
    }
}
