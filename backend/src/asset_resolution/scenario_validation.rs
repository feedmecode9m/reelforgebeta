//! Shared scenario → adapter expectations for tests (Phase 1c.4).

use super::adapter::AssetResolutionAdapter;
use super::types::{AdapterResult, MetadataSnapshot};

/// Frozen mapping expectations per scenario step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdapterStepExpectation {
    pub media_state: &'static str,
    pub inventory_state: &'static str,
    pub media_reference_validity: &'static str,
    pub media_failure_mode: &'static str,
    pub bundle_nonempty: bool,
}

pub fn assert_adapter_expectation(
    result: &AdapterResult,
    step_label: &str,
    expected: AdapterStepExpectation,
) {
    assert_eq!(
        result.binding.media_state, expected.media_state,
        "step {step_label}: media_state"
    );
    assert_eq!(
        result.binding.inventory_state, expected.inventory_state,
        "step {step_label}: inventory_state"
    );
    assert_eq!(
        result.binding.media_reference_validity, expected.media_reference_validity,
        "step {step_label}: media_reference_validity"
    );
    assert_eq!(
        result.binding.media_failure_mode, expected.media_failure_mode,
        "step {step_label}: media_failure_mode"
    );
    assert_eq!(
        !result.bundle.entries.is_empty(),
        expected.bundle_nonempty,
        "step {step_label}: bundle_nonempty"
    );
}

pub fn resolve_step(
    media_reference: &str,
    metadata: &MetadataSnapshot,
    inventory: &[super::types::AssetInventoryRecord],
) -> AdapterResult {
    let a = AssetResolutionAdapter::resolve(Some(media_reference), metadata, inventory);
    let b = AssetResolutionAdapter::resolve(Some(media_reference), metadata, inventory);
    assert_eq!(a, b, "adapter must be deterministic per step");
    a
}
