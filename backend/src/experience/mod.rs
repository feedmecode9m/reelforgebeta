//! Viewer Experience Layer — model and contract (Phase 1a.3).
//! Composition lives in `experience_resolve.rs` (Phase 1a.4).

pub mod compose_pipeline;
pub mod contract;
pub mod cspp;
pub mod experience_resolve;
pub mod hierarchy;
pub mod layout_presets;
pub mod metadata_registry;
pub mod platform_defaults;
pub mod profiles;
pub mod provenance;
pub mod slots;
pub mod theme_tokens;

pub(crate) mod loader;

#[cfg(test)]
mod integration_tests;

#[cfg(test)]
mod pipeline_integration_tests;

#[cfg(test)]
mod resolve_tests;
