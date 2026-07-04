//! Viewer simulation — maps Base + Delivered RVE to CompositionPlan (Phase 1b.5).
//!
//! **Media boundary:** Viewer tolerates null `metadata.media_reference` and any
//! `media_failure_mode`; composition uses visibility and slots only — no asset fetch.

use serde_json::Value;

use crate::experience::cspp::composition_plan::CompositionPlan;

/// Compose Viewer plan from frozen RVE inputs only (no DB, no merge).
pub fn simulate_viewer(base_rve: &Value, delivered_rve: &Value) -> CompositionPlan {
    let _ = delivered_rve
        .get("metadata")
        .and_then(|m| m.get("media_reference"));
    CompositionPlan::from_rve_pair(base_rve, delivered_rve)
}
