//! Abstract asset inventory types (Phase 1c.1 / 1c.2 contract).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetType {
    Video,
    Image,
    Audio,
    Derived,
}

impl AssetType {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Image => "image",
            Self::Audio => "audio",
            Self::Derived => "derived",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssetState {
    Pending,
    Processing,
    Ready,
    Failed,
}

impl AssetState {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Processing => "PROCESSING",
            Self::Ready => "READY",
            Self::Failed => "FAILED",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetSource {
    Upload,
    Ingest,
    Generated,
    External,
}

impl AssetSource {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::Upload => "upload",
            Self::Ingest => "ingest",
            Self::Generated => "generated",
            Self::External => "external",
        }
    }
}

/// Asset Layer catalog row (not stored in RVE).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetInventoryRecord {
    pub asset_id: Uuid,
    pub asset_type: AssetType,
    pub asset_state: AssetState,
    pub asset_source: AssetSource,
    pub thumbnail_asset_id: Option<Uuid>,
    pub scope_episode_id: Option<Uuid>,
    pub scope_reel_id: Option<Uuid>,
}

/// RVE metadata fields consumed by the adapter (snapshot only).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MetadataSnapshot {
    pub media_intent: Option<String>,
    pub media_placeholder_policy: Option<String>,
    pub thumbnail_resolution: Option<String>,
}

/// Reconciled semantic view for Viewer bind (not written to RVE).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SemanticMediaBinding {
    pub media_reference: Option<String>,
    pub inventory_state: String,
    pub media_state: String,
    pub media_intent: String,
    pub media_failure_mode: String,
    pub media_reference_validity: String,
    pub thumbnail_resolution: String,
    pub bundle_entry_key: String,
    pub intent_validation_warn: bool,
}

/// Opaque display handles for Viewer (no URLs).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterializedAssetBundle {
    pub entries: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdapterResult {
    pub binding: SemanticMediaBinding,
    pub bundle: MaterializedAssetBundle,
}
