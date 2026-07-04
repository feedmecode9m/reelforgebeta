//! Golden snapshot fixtures (documentary harness).

/// Frozen `metadata` media fields JSON.
pub const MEDIA_METADATA_JSON: &str =
    include_str!("snapshots/media_metadata_documentary.json");

/// Frozen delivered-with-media RVE JSON.
pub const DELIVERED_WITH_MEDIA_JSON: &str =
    include_str!("snapshots/delivered_with_media_documentary.json");

/// Frozen CompositionPlan JSON.
pub const COMPOSITION_PLAN_JSON: &str =
    include_str!("snapshots/composition_plan_documentary.json");
