//! Media semantic layer (Phase 1b.4–1b.6).
//! Inventory, failure, and thumbnail decisions only — no storage, CDN, or generation.

pub mod failure_model;
pub mod inventory_state;
pub mod media_semantic_resolver;
pub mod placeholder_policy;
pub mod thumbnail_policy;

pub use failure_model::{MediaFailureMode, ReferenceValidity};
pub use inventory_state::InventoryState;
pub use media_semantic_resolver::apply_media_semantic_stub;
pub use placeholder_policy::{
    content_format_to_media_intent, MediaIntent, MediaPlaceholderPolicy, MediaState,
};
pub use thumbnail_policy::ThumbnailResolution;
