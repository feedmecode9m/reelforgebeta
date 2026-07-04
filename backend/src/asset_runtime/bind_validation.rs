//! Viewer bind-time media_reference checks (no rendering changes).

use super::asset_registry::AssetRecord;

/// Outcome of optional runtime asset validation at bind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BindValidationOutcome {
    /// No runtime record supplied — skip validation.
    Skipped,
    /// Reference absent or not an `asset:{uuid}` token.
    NotApplicable,
    /// `asset:{uuid}` matches registry row.
    Valid,
    /// Token present but no registry row.
    RegistryMiss,
    /// Token id does not match registry row id.
    IdMismatch,
}

/// Validate `media_reference` against an optional runtime catalog row only.
/// Does not alter semantic binding or composition output.
pub fn validate_media_reference_bind(
    media_reference: Option<&str>,
    runtime_asset: Option<&AssetRecord>,
) -> BindValidationOutcome {
    let Some(record) = runtime_asset else {
        return BindValidationOutcome::Skipped;
    };
    let Some(token_id) = super::asset_registry::asset_id_from_media_reference(media_reference) else {
        return BindValidationOutcome::NotApplicable;
    };
    if token_id == record.asset_id {
        BindValidationOutcome::Valid
    } else {
        BindValidationOutcome::IdMismatch
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_asset_token() {
        let record = AssetRecord {
            asset_id: "f1000000-0000-4000-8000-000000000101".into(),
            asset_type: "video".into(),
            asset_state: "READY".into(),
        };
        let outcome = validate_media_reference_bind(
            Some("asset:f1000000-0000-4000-8000-000000000101"),
            Some(&record),
        );
        assert_eq!(outcome, BindValidationOutcome::Valid);
    }
}
