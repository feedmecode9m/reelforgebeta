//! Thumbnail resolution policy — semantic decisions only (Phase 1b.6).
//! Does not generate, store, or fetch thumbnails.

use super::failure_model::ReferenceValidity;
use super::inventory_state::InventoryState;
use super::placeholder_policy::{MediaPlaceholderPolicy, MediaState};

/// Semantic thumbnail tier decision for orchestrator consumers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThumbnailResolution {
    /// Inventory READY + valid reference — real thumb expected.
    ShouldExist,
    /// No real thumb; derived proxy tier permitted.
    AllowDerived,
    /// Theme/layout placeholder required.
    MustUsePlaceholder,
}

impl ThumbnailResolution {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::ShouldExist => "SHOULD_EXIST",
            Self::AllowDerived => "ALLOW_DERIVED",
            Self::MustUsePlaceholder => "MUST_PLACEHOLDER",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ThumbnailPolicyInput {
    pub media_state: MediaState,
    pub inventory: InventoryState,
    pub reference_validity: ReferenceValidity,
    pub placeholder_policy: MediaPlaceholderPolicy,
    pub surface_visible: bool,
}

/// Deterministic thumbnail policy (no asset I/O).
pub fn resolve_thumbnail_policy(input: ThumbnailPolicyInput) -> ThumbnailResolution {
    use MediaState::*;
    use ReferenceValidity::*;
    use ThumbnailResolution::*;

    if !input.surface_visible {
        return MustUsePlaceholder;
    }

    match input.media_state {
        RealMedia if input.inventory == InventoryState::Ready && input.reference_validity == Valid => {
            ShouldExist
        }
        RealMedia => match input.reference_validity {
            Valid => ShouldExist,
            Stale => AllowDerived,
            Pending | Absent => MustUsePlaceholder,
        },
        DerivedMedia => AllowDerived,
        PlaceholderMedia | FallbackMedia => MustUsePlaceholder,
    }
}

/// Whether derived representation is semantically allowed for inventory transition.
pub fn derived_representation_allowed(
    reference_validity: ReferenceValidity,
    semantic_derived_hint: bool,
) -> bool {
    semantic_derived_hint || reference_validity == ReferenceValidity::Stale
}

#[cfg(test)]
mod tests {
    use super::*;
    use MediaPlaceholderPolicy::ContentThenPlaceholder;

    #[test]
    fn real_ready_valid_should_exist() {
        let decision = resolve_thumbnail_policy(ThumbnailPolicyInput {
            media_state: MediaState::RealMedia,
            inventory: InventoryState::Ready,
            reference_validity: ReferenceValidity::Valid,
            placeholder_policy: ContentThenPlaceholder,
            surface_visible: true,
        });
        assert_eq!(decision, ThumbnailResolution::ShouldExist);
    }

    #[test]
    fn placeholder_media_must_placeholder() {
        let decision = resolve_thumbnail_policy(ThumbnailPolicyInput {
            media_state: MediaState::PlaceholderMedia,
            inventory: InventoryState::Missing,
            reference_validity: ReferenceValidity::Absent,
            placeholder_policy: ContentThenPlaceholder,
            surface_visible: true,
        });
        assert_eq!(decision, ThumbnailResolution::MustUsePlaceholder);
    }
}
