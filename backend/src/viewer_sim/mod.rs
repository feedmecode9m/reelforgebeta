//! Viewer simulation scaffold (Phase 1b.4) — no DOM or rendering logic.

pub mod bind_validation;
pub mod render_tree_builder;
pub mod viewer_simulation;

pub use bind_validation::validate_runtime_bind;
pub use crate::asset_runtime::BindValidationOutcome;
pub use render_tree_builder::{RenderNode, RenderTree};
pub use viewer_simulation::simulate_viewer;
