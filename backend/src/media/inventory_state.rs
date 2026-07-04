//! Semantic media inventory abstraction (Phase 1b.6).
//! No storage, persistence, or ingestion — decision inputs only.

use super::placeholder_policy::{MediaIntent, MediaPlaceholderPolicy, MediaState};

/// Semantic inventory lifecycle (Phase 1b.6 model).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum InventoryState {
    Pending,
    Ready,
    #[default]
    Missing,
    Failed,
}

impl InventoryState {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Ready => "READY",
            Self::Missing => "MISSING",
            Self::Failed => "FAILED",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.to_ascii_uppercase().as_str() {
            "PENDING" => Some(Self::Pending),
            "READY" => Some(Self::Ready),
            "MISSING" => Some(Self::Missing),
            "FAILED" => Some(Self::Failed),
            _ => None,
        }
    }
}

/// Inputs for deterministic inventory → `media_state` transition.
#[derive(Debug, Clone, Copy)]
pub struct InventoryTransitionInput {
    pub inventory: InventoryState,
    pub policy: MediaPlaceholderPolicy,
    pub intent: MediaIntent,
    pub hero_mode_off: bool,
    pub reference_valid: bool,
    pub derived_allowed: bool,
    pub delayed_availability: bool,
}

/// Deterministic inventory → `media_state` mapping (no asset I/O).
pub fn inventory_to_media_state(input: InventoryTransitionInput) -> MediaState {
    use InventoryState::*;

    match input.inventory {
        Failed => return MediaState::FallbackMedia,
        Pending if input.delayed_availability => {
            return placeholder_or_fallback(input.policy, input.hero_mode_off, input.intent);
        }
        Pending => {
            return placeholder_or_fallback(input.policy, input.hero_mode_off, input.intent);
        }
        Missing => {
            if input.derived_allowed {
                return MediaState::DerivedMedia;
            }
            return placeholder_or_fallback(input.policy, input.hero_mode_off, input.intent);
        }
        Ready if input.reference_valid => MediaState::RealMedia,
        Ready if input.derived_allowed => MediaState::DerivedMedia,
        Ready => placeholder_or_fallback(input.policy, input.hero_mode_off, input.intent),
    }
}

fn placeholder_or_fallback(
    policy: MediaPlaceholderPolicy,
    hero_mode_off: bool,
    intent: MediaIntent,
) -> MediaState {
    match policy {
        MediaPlaceholderPolicy::ContentOnly => MediaState::FallbackMedia,
        MediaPlaceholderPolicy::ContentThenPlaceholder
        | MediaPlaceholderPolicy::ContentThenGenerated
        | MediaPlaceholderPolicy::FullySyntheticAllowed => {
            if hero_mode_off && intent == MediaIntent::Unknown {
                MediaState::FallbackMedia
            } else {
                MediaState::PlaceholderMedia
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use MediaPlaceholderPolicy::ContentThenPlaceholder;

    #[test]
    fn ready_with_valid_ref_is_real() {
        let state = inventory_to_media_state(InventoryTransitionInput {
            inventory: InventoryState::Ready,
            policy: ContentThenPlaceholder,
            intent: MediaIntent::Documentary,
            hero_mode_off: false,
            reference_valid: true,
            derived_allowed: false,
            delayed_availability: false,
        });
        assert_eq!(state, MediaState::RealMedia);
    }

    #[test]
    fn failed_is_fallback() {
        let state = inventory_to_media_state(InventoryTransitionInput {
            inventory: InventoryState::Failed,
            policy: ContentThenPlaceholder,
            intent: MediaIntent::Clip,
            hero_mode_off: false,
            reference_valid: false,
            derived_allowed: false,
            delayed_availability: false,
        });
        assert_eq!(state, MediaState::FallbackMedia);
    }

    #[test]
    fn missing_uses_placeholder_when_policy_allows() {
        let state = inventory_to_media_state(InventoryTransitionInput {
            inventory: InventoryState::Missing,
            policy: ContentThenPlaceholder,
            intent: MediaIntent::MicroDrama,
            hero_mode_off: false,
            reference_valid: false,
            derived_allowed: false,
            delayed_availability: false,
        });
        assert_eq!(state, MediaState::PlaceholderMedia);
    }
}
