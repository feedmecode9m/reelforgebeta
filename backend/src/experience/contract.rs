//! ResolvedViewerExperience contract types and JSON Schema validation.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;

pub const SCHEMA_VERSION: &str = "1.0.0";

pub static RESERVED_METADATA_PREFIXES: &[&str] = &[
    "rf.",
    "system.",
    "internal.",
    "ai.",
    "ads.",
    "recommendation.",
];

static EMBEDDED_SCHEMA: &str =
    include_str!("../../../schemas/resolved_viewer_experience.schema.json");

static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();

fn compiled_validator() -> &'static jsonschema::Validator {
    VALIDATOR.get_or_init(|| {
        let json: Value = serde_json::from_str(EMBEDDED_SCHEMA).expect("invalid embedded schema");
        jsonschema::validator_for(&json).expect("compile RVE schema")
    })
}

#[derive(Debug)]
pub enum RveValidationError {
    Invalid(Vec<String>),
    ReservedMetadataKey(String),
}

impl std::fmt::Display for RveValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(v) => write!(f, "RVE validation failed: {v:?}"),
            Self::ReservedMetadataKey(k) => write!(f, "reserved metadata key: {k}"),
        }
    }
}

impl std::error::Error for RveValidationError {}

/// Validate a resolved payload against the embedded JSON Schema.
pub fn validate_rve(value: &Value) -> Result<(), RveValidationError> {
    if let Some(obj) = value.get("metadata").and_then(|m| m.as_object()) {
        for key in obj.keys() {
            validate_metadata_key(key)?;
        }
    }
    if let Some(ext) = value
        .get("extensions")
        .and_then(|e| e.get("custom_metadata"))
        .and_then(|c| c.get("values"))
        .and_then(|v| v.as_object())
    {
        for key in ext.keys() {
            validate_metadata_key(key)?;
        }
    }

    let validator = compiled_validator();
    if let Err(e) = validator.validate(value) {
        return Err(RveValidationError::Invalid(vec![e.to_string()]));
    }
    Ok(())
}

/// Reject reserved namespaces (contract §9 + schema propertyNames).
pub fn validate_metadata_key(key: &str) -> Result<(), RveValidationError> {
    for prefix in RESERVED_METADATA_PREFIXES {
        if key.starts_with(prefix) {
            return Err(RveValidationError::ReservedMetadataKey(key.to_string()));
        }
    }
    let mut chars = key.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return Err(RveValidationError::ReservedMetadataKey(key.to_string())),
    }
    for c in chars {
        if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '_' {
            return Err(RveValidationError::ReservedMetadataKey(key.to_string()));
        }
    }
    Ok(())
}

/// Null-critical paths the resolver must populate (contract §10.1).
pub const NULL_CRITICAL_PATHS: &[&str] = &[
    "schema_version",
    "resolve_context.project_id",
    "resolve_context.resolved_at",
    "layout.preset_key",
    "layout.definition.panels",
    "labels.episode_label",
    "visibility.hero.mode",
    "visibility.hero.enabled",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveContextContract {
    pub episode_id: Option<uuid::Uuid>,
    pub reel_id: Option<uuid::Uuid>,
    pub project_id: uuid::Uuid,
    pub series_id: Option<uuid::Uuid>,
    pub season_id: Option<uuid::Uuid>,
    pub resolved_at: chrono::DateTime<chrono::Utc>,
    pub enforce_paywall: bool,
}
