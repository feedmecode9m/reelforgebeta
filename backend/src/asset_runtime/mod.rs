//! Runtime asset catalog (in-memory only). Not part of the semantic compose pipeline.

pub mod asset_registry;
pub mod bind_validation;

pub use asset_registry::{
    asset_id_from_media_reference, AssetRecord, AssetRegistry, InMemoryAssetRegistry,
};
pub use bind_validation::{validate_media_reference_bind, BindValidationOutcome};

#[cfg(test)]
mod runtime_integration_tests;
