//! Asset Resolution bridge (Phase 1c.2 / 1c.3).
//! Not part of the experience compose pipeline.

pub mod adapter;
pub mod types;

#[cfg(feature = "runtime_asset_mode")]
pub mod adapter_runtime;

#[cfg(test)]
pub mod mock_registry;
#[cfg(test)]
pub mod scenario_feed;
#[cfg(test)]
pub mod scenario_validation;

pub use adapter::{metadata_snapshot_from_json, AssetResolutionAdapter};
#[cfg(feature = "runtime_asset_mode")]
pub use adapter_runtime::RuntimeEnrichedResult;
pub use types::{
    AdapterResult, AssetInventoryRecord, AssetSource, AssetState, AssetType,
    MaterializedAssetBundle, MetadataSnapshot, SemanticMediaBinding,
};
