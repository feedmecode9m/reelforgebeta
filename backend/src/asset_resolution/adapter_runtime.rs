//! Optional runtime catalog enrichment (`runtime_asset_mode` feature only).

use crate::asset_runtime::{asset_id_from_media_reference, AssetRecord, AssetRegistry};

use super::adapter::AssetResolutionAdapter;
use super::types::{AdapterResult, AssetInventoryRecord, MetadataSnapshot};

/// Adapter output plus optional runtime catalog row (binding unchanged).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeEnrichedResult {
    pub result: AdapterResult,
    pub runtime_asset: Option<AssetRecord>,
}

impl AssetResolutionAdapter {
    /// Same mapping as [`resolve`](super::adapter::AssetResolutionAdapter::resolve), then optional registry lookup.
    pub fn resolve_with_runtime<R: AssetRegistry + ?Sized>(
        media_reference: Option<&str>,
        metadata: &MetadataSnapshot,
        inventory: &[AssetInventoryRecord],
        registry: Option<&R>,
    ) -> RuntimeEnrichedResult {
        let result = Self::resolve(media_reference, metadata, inventory);
        let runtime_asset = registry.and_then(|reg| {
            runtime_lookup(media_reference, inventory, result.binding.media_reference.as_deref(), reg)
        });
        RuntimeEnrichedResult {
            result,
            runtime_asset,
        }
    }
}

fn runtime_lookup<R: AssetRegistry + ?Sized>(
    media_reference: Option<&str>,
    inventory: &[AssetInventoryRecord],
    binding_reference: Option<&str>,
    registry: &R,
) -> Option<AssetRecord> {
    let reference = binding_reference.or(media_reference)?;
    if let Some(id) = asset_id_from_media_reference(Some(reference)) {
        return registry.get_asset(&id);
    }
    let record = super::adapter::AssetResolutionAdapter::find_record_for_runtime(reference, inventory)?;
    registry.get_asset(&record.asset_id.to_string())
}

#[cfg(all(test, feature = "runtime_asset_mode"))]
mod tests {
    use super::*;
    use crate::asset_resolution::mock_registry::MockAssetRegistry;
    use crate::asset_resolution::scenario_feed::AssetScenarioFeed;
    use crate::asset_runtime::InMemoryAssetRegistry;
    use crate::asset_resolution::MetadataSnapshot;

    #[test]
    fn runtime_enrichment_does_not_change_binding() {
        let inventory = MockAssetRegistry::ready_episode();
        let meta = MetadataSnapshot::default();
        let media_ref = "episode:a1000000-0000-4000-8000-000000000001";
        let base = AssetResolutionAdapter::resolve(Some(media_ref), &meta, inventory.records());
        let runtime_reg = InMemoryAssetRegistry::harness_dataset();
        let enriched = AssetResolutionAdapter::resolve_with_runtime(
            Some(media_ref),
            &meta,
            inventory.records(),
            Some(&runtime_reg),
        );
        assert_eq!(base, enriched.result);
        assert!(enriched.runtime_asset.is_some());
        assert_eq!(enriched.runtime_asset.as_ref().unwrap().asset_state, "READY");
    }

    #[test]
    fn missing_runtime_row_leaves_binding_unchanged() {
        let inventory = MockAssetRegistry::ready_episode();
        let meta = MetadataSnapshot::default();
        let media_ref = "asset:00000000-0000-0000-0000-000000000000";
        let base = AssetResolutionAdapter::resolve(Some(media_ref), &meta, inventory.records());
        let runtime_reg = InMemoryAssetRegistry::harness_dataset();
        let enriched = AssetResolutionAdapter::resolve_with_runtime(
            Some(media_ref),
            &meta,
            inventory.records(),
            Some(&runtime_reg),
        );
        assert_eq!(base, enriched.result);
        assert!(enriched.runtime_asset.is_none());
        assert_eq!(base.binding.media_state, "FALLBACK_MEDIA");
    }
}
