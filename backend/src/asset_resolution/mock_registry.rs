//! In-memory mock asset catalog for tests only (Phase 1c.3 / 1c.4).

use std::collections::HashMap;
use uuid::Uuid;

use super::scenario_feed::AssetScenarioFeed;
use super::types::AssetInventoryRecord;

/// Test-only registry; not used by production `compose_pipeline`.
#[derive(Debug, Clone)]
pub struct MockAssetRegistry {
    by_id: HashMap<Uuid, AssetInventoryRecord>,
    records: Vec<AssetInventoryRecord>,
}

impl MockAssetRegistry {
    pub fn from_records(records: Vec<AssetInventoryRecord>) -> Self {
        let by_id = records.iter().map(|r| (r.asset_id, r.clone())).collect();
        Self { by_id, records }
    }

    /// Build a registry view from a scenario step index.
    pub fn from_scenario_step(feed: &AssetScenarioFeed, step: usize) -> Self {
        Self::from_records(feed.inventory_at(step).to_vec())
    }

    pub fn records(&self) -> &[AssetInventoryRecord] {
        &self.records
    }

    pub fn get(&self, asset_id: Uuid) -> Option<&AssetInventoryRecord> {
        self.by_id.get(&asset_id)
    }

    /// Static harness dataset for pipeline / adapter integration tests.
    pub fn harness() -> Self {
        Self::from_scenario_step(&AssetScenarioFeed::harness_snapshot_scenario(), 0)
    }

    /// READY primary video only (wins episode binding).
    pub fn ready_episode() -> Self {
        Self::from_scenario_step(
            &AssetScenarioFeed::upload_lifecycle_scenario(),
            2, // ready
        )
    }

    pub fn processing_episode() -> Self {
        Self::from_scenario_step(
            &AssetScenarioFeed::upload_lifecycle_scenario(),
            1, // processing
        )
    }

    pub fn failed_episode() -> Self {
        Self::from_scenario_step(
            &AssetScenarioFeed::upload_lifecycle_scenario(),
            3, // failed
        )
    }

    pub fn missing_episode() -> Self {
        Self::from_scenario_step(
            &AssetScenarioFeed::upload_lifecycle_scenario(),
            0, // missing
        )
    }
}
