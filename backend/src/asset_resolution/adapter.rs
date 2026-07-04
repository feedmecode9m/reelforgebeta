//! AssetResolutionAdapter — pure bridge (Phase 1c.2 / 1c.3).

use uuid::Uuid;

use super::types::{
    AdapterResult, AssetInventoryRecord, AssetState, AssetType, MaterializedAssetBundle,
    MetadataSnapshot, SemanticMediaBinding,
};

const EPISODE_PREFIX: &str = "episode:";
const ASSET_PREFIX: &str = "asset:";

/// Stateless asset → semantic resolver (no I/O).
pub struct AssetResolutionAdapter;

impl AssetResolutionAdapter {
    pub fn resolve(
        media_reference: Option<&str>,
        metadata: &MetadataSnapshot,
        inventory: &[AssetInventoryRecord],
    ) -> AdapterResult {
        if media_reference.is_none() || media_reference == Some("") {
            return Self::missing_reference(None, metadata);
        }
        let media_reference = media_reference.unwrap();

        let matched = Self::find_record(media_reference, inventory);
        let Some(record) = matched else {
            return Self::missing_reference(Some(media_reference.to_string()), metadata);
        };

        if record.asset_state == AssetState::Failed {
            return Self::failed_state(media_reference, metadata);
        }
        if matches!(
            record.asset_state,
            AssetState::Pending | AssetState::Processing
        ) {
            return Self::pending_state(media_reference, metadata);
        }
        if record.asset_state == AssetState::Ready {
            if media_reference.starts_with(ASSET_PREFIX) {
                let id_str = &media_reference[ASSET_PREFIX.len()..];
                if Uuid::parse_str(id_str).ok() != Some(record.asset_id) {
                    return Self::stale_reference(media_reference, metadata);
                }
            }
            if record.asset_type == AssetType::Derived {
                return Self::ready_derived(media_reference, record, metadata);
            }
            let thumb_policy = metadata
                .thumbnail_resolution
                .as_deref()
                .unwrap_or("MUST_PLACEHOLDER");
            if thumb_policy == "SHOULD_EXIST"
                && record.thumbnail_asset_id.is_none()
                && matches!(record.asset_type, AssetType::Video | AssetType::Image)
            {
                return Self::ready_with_bundle(
                    media_reference,
                    record,
                    metadata,
                    "DERIVED_MEDIA",
                    true,
                );
            }
            return Self::ready_with_bundle(media_reference, record, metadata, "REAL_MEDIA", true);
        }

        Self::missing_reference(Some(media_reference.to_string()), metadata)
    }

    /// Exposed for runtime enrichment lookup (`runtime_asset_mode` only).
    #[allow(dead_code)]
    pub(crate) fn find_record_for_runtime<'a>(
        media_reference: &str,
        inventory: &'a [AssetInventoryRecord],
    ) -> Option<&'a AssetInventoryRecord> {
        Self::find_record(media_reference, inventory)
    }

    fn find_record<'a>(
        media_reference: &str,
        inventory: &'a [AssetInventoryRecord],
    ) -> Option<&'a AssetInventoryRecord> {
        if let Some(id_str) = media_reference.strip_prefix(ASSET_PREFIX) {
            let id = Uuid::parse_str(id_str).ok()?;
            return inventory.iter().find(|r| r.asset_id == id);
        }
        if let Some(ep_str) = media_reference.strip_prefix(EPISODE_PREFIX) {
            let episode_id = Uuid::parse_str(ep_str).ok()?;
            let mut candidates: Vec<&AssetInventoryRecord> = inventory
                .iter()
                .filter(|r| r.scope_episode_id == Some(episode_id))
                .collect();
            if candidates.is_empty() {
                return None;
            }
            candidates.sort_by(|a, b| {
                state_rank(a.asset_state)
                    .cmp(&state_rank(b.asset_state))
                    .then_with(|| type_rank(a.asset_type).cmp(&type_rank(b.asset_type)))
                    .then_with(|| a.asset_id.cmp(&b.asset_id))
            });
            return candidates.last().copied();
        }
        None
    }

    fn missing_reference(
        media_reference: Option<String>,
        metadata: &MetadataSnapshot,
    ) -> AdapterResult {
        AdapterResult {
            binding: SemanticMediaBinding {
                media_reference,
                inventory_state: "MISSING".into(),
                media_state: "FALLBACK_MEDIA".into(),
                media_intent: metadata
                    .media_intent
                    .clone()
                    .unwrap_or_else(|| "UNKNOWN".into()),
                media_failure_mode: "missing_reference".into(),
                media_reference_validity: "absent".into(),
                thumbnail_resolution: metadata
                    .thumbnail_resolution
                    .clone()
                    .unwrap_or_else(|| "MUST_PLACEHOLDER".into()),
                bundle_entry_key: String::new(),
                intent_validation_warn: false,
            },
            bundle: MaterializedAssetBundle::default(),
        }
    }

    fn failed_state(media_reference: &str, metadata: &MetadataSnapshot) -> AdapterResult {
        AdapterResult {
            binding: SemanticMediaBinding {
                media_reference: Some(media_reference.to_string()),
                inventory_state: "FAILED".into(),
                media_state: "FALLBACK_MEDIA".into(),
                media_intent: metadata
                    .media_intent
                    .clone()
                    .unwrap_or_else(|| "UNKNOWN".into()),
                media_failure_mode: "none".into(),
                media_reference_validity: "stale".into(),
                thumbnail_resolution: metadata
                    .thumbnail_resolution
                    .clone()
                    .unwrap_or_else(|| "MUST_PLACEHOLDER".into()),
                bundle_entry_key: media_reference.to_string(),
                intent_validation_warn: false,
            },
            bundle: MaterializedAssetBundle::default(),
        }
    }

    fn pending_state(media_reference: &str, metadata: &MetadataSnapshot) -> AdapterResult {
        AdapterResult {
            binding: SemanticMediaBinding {
                media_reference: Some(media_reference.to_string()),
                inventory_state: "PENDING".into(),
                media_state: "PLACEHOLDER_MEDIA".into(),
                media_intent: metadata
                    .media_intent
                    .clone()
                    .unwrap_or_else(|| "UNKNOWN".into()),
                media_failure_mode: "delayed_availability".into(),
                media_reference_validity: "pending".into(),
                thumbnail_resolution: metadata
                    .thumbnail_resolution
                    .clone()
                    .unwrap_or_else(|| "MUST_PLACEHOLDER".into()),
                bundle_entry_key: media_reference.to_string(),
                intent_validation_warn: false,
            },
            bundle: MaterializedAssetBundle::default(),
        }
    }

    fn stale_reference(media_reference: &str, metadata: &MetadataSnapshot) -> AdapterResult {
        AdapterResult {
            binding: SemanticMediaBinding {
                media_reference: Some(media_reference.to_string()),
                inventory_state: "MISSING".into(),
                media_state: "FALLBACK_MEDIA".into(),
                media_intent: metadata
                    .media_intent
                    .clone()
                    .unwrap_or_else(|| "UNKNOWN".into()),
                media_failure_mode: "stale_reference".into(),
                media_reference_validity: "stale".into(),
                thumbnail_resolution: metadata
                    .thumbnail_resolution
                    .clone()
                    .unwrap_or_else(|| "MUST_PLACEHOLDER".into()),
                bundle_entry_key: media_reference.to_string(),
                intent_validation_warn: false,
            },
            bundle: MaterializedAssetBundle::default(),
        }
    }

    fn ready_derived(
        media_reference: &str,
        record: &AssetInventoryRecord,
        metadata: &MetadataSnapshot,
    ) -> AdapterResult {
        Self::ready_with_bundle(media_reference, record, metadata, "DERIVED_MEDIA", true)
    }

    fn ready_with_bundle(
        media_reference: &str,
        record: &AssetInventoryRecord,
        metadata: &MetadataSnapshot,
        media_state: &str,
        include_primary: bool,
    ) -> AdapterResult {
        let intent = metadata
            .media_intent
            .clone()
            .unwrap_or_else(|| "UNKNOWN".into());
        let mut bundle = MaterializedAssetBundle::default();
        if include_primary {
            bundle.entries.insert(
                media_reference.to_string(),
                format!("handle:{}", record.asset_id),
            );
        }
        if let Some(thumb_id) = record.thumbnail_asset_id {
            bundle
                .entries
                .insert(format!("{media_reference}#thumb"), format!("handle:{thumb_id}"));
        }
        AdapterResult {
            binding: SemanticMediaBinding {
                media_reference: Some(media_reference.to_string()),
                inventory_state: "READY".into(),
                media_state: media_state.to_string(),
                media_intent: intent.clone(),
                media_failure_mode: "none".into(),
                media_reference_validity: "valid".into(),
                thumbnail_resolution: metadata
                    .thumbnail_resolution
                    .clone()
                    .unwrap_or_else(|| "SHOULD_EXIST".into()),
                bundle_entry_key: media_reference.to_string(),
                intent_validation_warn: intent_validation_warn(record.asset_type, &intent),
            },
            bundle,
        }
    }
}

fn state_rank(s: AssetState) -> u8 {
    match s {
        AssetState::Ready => 3,
        AssetState::Processing => 2,
        AssetState::Pending => 1,
        AssetState::Failed => 0,
    }
}

fn type_rank(t: AssetType) -> u8 {
    match t {
        AssetType::Video => 3,
        AssetType::Image => 2,
        AssetType::Derived => 1,
        AssetType::Audio => 0,
    }
}

fn intent_validation_warn(asset_type: AssetType, intent: &str) -> bool {
    match asset_type {
        AssetType::Video => !matches!(
            intent,
            "MICRO_DRAMA" | "DOCUMENTARY" | "CLIP" | "MUSIC_VIDEO" | "UNKNOWN"
        ),
        AssetType::Audio => intent == "DOCUMENTARY",
        _ => false,
    }
}

pub fn metadata_snapshot_from_json(meta: &serde_json::Map<String, serde_json::Value>) -> MetadataSnapshot {
    MetadataSnapshot {
        media_intent: meta.get("media_intent").and_then(|v| v.as_str()).map(str::to_string),
        media_placeholder_policy: meta
            .get("media_placeholder_policy")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        thumbnail_resolution: meta
            .get("thumbnail_resolution")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asset_resolution::mock_registry::MockAssetRegistry;
    use crate::asset_resolution::scenario_feed::AssetScenarioFeed;
    use crate::asset_resolution::scenario_validation::{
        assert_adapter_expectation, resolve_step, AdapterStepExpectation,
    };

    #[test]
    fn adapter_deterministic() {
        let registry = MockAssetRegistry::harness();
        let meta = MetadataSnapshot {
            media_intent: Some("DOCUMENTARY".into()),
            thumbnail_resolution: Some("SHOULD_EXIST".into()),
            ..Default::default()
        };
        let r = "episode:a1000000-0000-4000-8000-000000000001";
        let a = AssetResolutionAdapter::resolve(Some(r), &meta, registry.records());
        let b = AssetResolutionAdapter::resolve(Some(r), &meta, registry.records());
        assert_eq!(a, b);
    }

    #[test]
    fn upload_lifecycle_scenario_replay() {
        let feed = AssetScenarioFeed::upload_lifecycle_scenario();
        let meta = MetadataSnapshot {
            media_intent: Some("DOCUMENTARY".into()),
            thumbnail_resolution: Some("SHOULD_EXIST".into()),
            ..Default::default()
        };
        let media_ref = format!("episode:{}", crate::asset_resolution::scenario_feed::HARNESS_EPISODE_ID);
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
        for (i, ((_, step), expected)) in feed.replay().zip(expectations).enumerate() {
            let result = resolve_step(&media_ref, &meta, &step.inventory);
            assert_adapter_expectation(&result, step.label, expected);
            let replay = AssetScenarioFeed::upload_lifecycle_scenario();
            let again = resolve_step(&media_ref, &meta, replay.inventory_at(i));
            assert_eq!(result, again);
        }
    }

    #[test]
    fn delayed_encoding_scenario_stable_processing() {
        let feed = AssetScenarioFeed::delayed_encoding_scenario();
        let meta = MetadataSnapshot::default();
        let media_ref = format!("episode:{}", crate::asset_resolution::scenario_feed::HARNESS_EPISODE_ID);
        let p1 = resolve_step(&media_ref, &meta, feed.inventory_at(1));
        let p2 = resolve_step(&media_ref, &meta, feed.inventory_at(2));
        assert_eq!(p1, p2);
        assert_eq!(p1.binding.media_state, "PLACEHOLDER_MEDIA");
        let ready = resolve_step(&media_ref, &meta, feed.inventory_at(3));
        assert_eq!(ready.binding.media_state, "REAL_MEDIA");
    }

    #[test]
    fn partial_failure_batch_scenario() {
        let feed = AssetScenarioFeed::partial_failure_batch_scenario();
        let meta = MetadataSnapshot::default();
        let media_ref = format!("episode:{}", crate::asset_resolution::scenario_feed::HARNESS_EPISODE_ID);
        let expectations = [
            ("batch_processing", "PLACEHOLDER_MEDIA", "PENDING"),
            ("partial_ready_partial_failed", "REAL_MEDIA", "READY"),
            ("batch_failed", "FALLBACK_MEDIA", "FAILED"),
        ];
        for (i, (label, media_state, inventory_state)) in expectations.iter().enumerate() {
            let result = resolve_step(&media_ref, &meta, feed.inventory_at(i));
            assert_eq!(result.binding.media_state, *media_state, "{label}");
            assert_eq!(result.binding.inventory_state, *inventory_state, "{label}");
        }
    }
}
