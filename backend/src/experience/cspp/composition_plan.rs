//! Composition plan wire shape (Phase 1b.5).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::viewer_sim::render_tree_builder::{self, RenderTree};

pub const COMPOSITION_PLAN_VERSION: &str = "1.0.0";

/// Deterministic composition plan artifact from Viewer simulation boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompositionPlan {
    pub plan_version: String,
    pub schema_version: String,
    pub admitted_surfaces: Vec<String>,
    pub render_tree: RenderTree,
}

impl CompositionPlan {
    pub fn from_rve_pair(base_rve: &Value, delivered_rve: &Value) -> Self {
        let schema_version = delivered_rve
            .get("schema_version")
            .or_else(|| base_rve.get("schema_version"))
            .and_then(|v| v.as_str())
            .unwrap_or("1.0.0")
            .to_string();

        Self {
            plan_version: COMPOSITION_PLAN_VERSION.to_string(),
            schema_version,
            admitted_surfaces: render_tree_builder::admitted_surfaces(base_rve),
            render_tree: render_tree_builder::build_render_tree(base_rve, delivered_rve),
        }
    }

    /// Back-compat alias for scaffold callers.
    pub fn stub_from_rve(base_rve: &Value, delivered_rve: &Value) -> Self {
        Self::from_rve_pair(base_rve, delivered_rve)
    }
}
