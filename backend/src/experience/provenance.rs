//! Provenance helpers — used by resolver (Phase 1a.4). No composition logic here.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Contract §6 provenance entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProvenanceEntry {
    pub value: Value,
    pub source: ProvenanceSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_version: Option<Uuid>,
}

/// Contract §6.2 source enum.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceSource {
    Default,
    Platform,
    Project,
    Series,
    Season,
    Episode,
    Profile,
    Campaign,
}

impl ProvenanceSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Platform => "platform",
            Self::Project => "project",
            Self::Series => "series",
            Self::Season => "season",
            Self::Episode => "episode",
            Self::Profile => "profile",
            Self::Campaign => "campaign",
        }
    }
}

pub fn scope_id(scope_type: &str, id: Uuid) -> String {
    format!("{scope_type}:{id}")
}

pub fn entry<T: Serialize>(
    value: &T,
    source: ProvenanceSource,
    scope: Option<String>,
    profile_version: Option<Uuid>,
) -> ProvenanceEntry {
    ProvenanceEntry {
        value: serde_json::to_value(value).unwrap_or(Value::Null),
        source,
        scope,
        profile_version,
    }
}

pub fn entry_json(
    value: Value,
    source: ProvenanceSource,
    scope: Option<String>,
    profile_version: Option<Uuid>,
) -> ProvenanceEntry {
    ProvenanceEntry {
        value,
        source,
        scope,
        profile_version,
    }
}
