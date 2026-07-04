//! Optional runtime bind validation hook (does not affect CompositionPlan).

use serde_json::Value;

use crate::asset_runtime::{validate_media_reference_bind, AssetRecord};
use crate::asset_runtime::BindValidationOutcome;

/// Viewer bind hook: validate `metadata.media_reference` against optional runtime asset row.
///
/// Does not read catalogs, mutate RVE, or change render output.
pub fn validate_runtime_bind(
    delivered_rve: &Value,
    runtime_asset: Option<&AssetRecord>,
) -> BindValidationOutcome {
    let media_reference = delivered_rve
        .get("metadata")
        .and_then(|m| m.get("media_reference"))
        .and_then(|v| v.as_str());
    validate_media_reference_bind(media_reference, runtime_asset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::asset_runtime::{AssetRecord, BindValidationOutcome};
    use serde_json::json;

    #[test]
    fn hook_does_not_require_runtime_asset() {
        let rve = json!({
            "metadata": { "media_reference": "episode:a1000000-0000-4000-8000-000000000001" }
        });
        assert_eq!(
            validate_runtime_bind(&rve, None),
            BindValidationOutcome::Skipped
        );
    }

    #[test]
    fn hook_validates_asset_token_only() {
        let rve = json!({
            "metadata": { "media_reference": "asset:f1000000-0000-4000-8000-000000000101" }
        });
        let record = AssetRecord {
            asset_id: "f1000000-0000-4000-8000-000000000101".into(),
            asset_type: "video".into(),
            asset_state: "READY".into(),
        };
        assert_eq!(
            validate_runtime_bind(&rve, Some(&record)),
            BindValidationOutcome::Valid
        );
    }
}
