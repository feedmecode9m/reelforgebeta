//! Failure simulation — semantic reference validity only (Phase 1b.6).

use serde_json::Value;

use super::inventory_state::InventoryState;

/// Reference handling outcome (no URL construction).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReferenceValidity {
    Valid,
    Absent,
    Stale,
    Pending,
}

impl ReferenceValidity {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::Valid => "valid",
            Self::Absent => "absent",
            Self::Stale => "stale",
            Self::Pending => "pending",
        }
    }
}

/// Deterministic failure classification for incomplete media reality.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaFailureMode {
    None,
    MissingReference,
    StaleReference,
    DelayedAvailability,
}

impl MediaFailureMode {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::MissingReference => "missing_reference",
            Self::StaleReference => "stale_reference",
            Self::DelayedAvailability => "delayed_availability",
        }
    }
}

/// Harness / metadata signals for failure simulation (no persistence).
#[derive(Debug, Clone, Copy, Default)]
pub struct FailureSimulationInput {
    pub inventory: InventoryState,
    pub suppress_reference: bool,
    pub stale_reference: bool,
    pub delayed_availability: bool,
}

/// Evaluate opaque `media_reference` semantics.
pub fn evaluate_reference(
    tentative_reference: &Value,
    input: FailureSimulationInput,
) -> (ReferenceValidity, MediaFailureMode, Value) {
    if input.delayed_availability || input.inventory == InventoryState::Pending {
        return (
            ReferenceValidity::Pending,
            MediaFailureMode::DelayedAvailability,
            tentative_reference.clone(),
        );
    }

    if input.suppress_reference || tentative_reference.is_null() {
        return (
            ReferenceValidity::Absent,
            MediaFailureMode::MissingReference,
            Value::Null,
        );
    }

    if input.stale_reference {
        return (
            ReferenceValidity::Stale,
            MediaFailureMode::StaleReference,
            tentative_reference.clone(),
        );
    }

    if !reference_is_well_formed(tentative_reference) {
        return (
            ReferenceValidity::Stale,
            MediaFailureMode::StaleReference,
            Value::Null,
        );
    }

    (
        ReferenceValidity::Valid,
        MediaFailureMode::None,
        tentative_reference.clone(),
    )
}

fn reference_is_well_formed(reference: &Value) -> bool {
    let Some(s) = reference.as_str() else {
        return false;
    };
    s.starts_with("episode:") && s.len() > "episode:".len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_reference_is_absent() {
        let (validity, mode, out) = evaluate_reference(
            &Value::Null,
            FailureSimulationInput {
                inventory: InventoryState::Missing,
                suppress_reference: true,
                ..Default::default()
            },
        );
        assert_eq!(validity, ReferenceValidity::Absent);
        assert_eq!(mode, MediaFailureMode::MissingReference);
        assert!(out.is_null());
    }

    #[test]
    fn stale_reference_flag() {
        let (validity, mode, _) = evaluate_reference(
            &json!("episode:deadbeef-dead-beef-dead-beefdeadbeef"),
            FailureSimulationInput {
                inventory: InventoryState::Ready,
                stale_reference: true,
                ..Default::default()
            },
        );
        assert_eq!(validity, ReferenceValidity::Stale);
        assert_eq!(mode, MediaFailureMode::StaleReference);
    }
}
