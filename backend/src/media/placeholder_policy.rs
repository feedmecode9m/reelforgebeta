//! Static content-format → media semantics (Phase 1b.5).

use serde::{Deserialize, Serialize};

/// Semantic media intent (MEDIA_REPRESENTATION_CONTRACT).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MediaIntent {
    MicroDrama,
    MusicVideo,
    Clip,
    Documentary,
    Unknown,
}

impl MediaIntent {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::MicroDrama => "MICRO_DRAMA",
            Self::MusicVideo => "MUSIC_VIDEO",
            Self::Clip => "CLIP",
            Self::Documentary => "DOCUMENTARY",
            Self::Unknown => "UNKNOWN",
        }
    }
}

/// Semantic media state (MEDIA_REPRESENTATION_CONTRACT).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MediaState {
    RealMedia,
    DerivedMedia,
    PlaceholderMedia,
    FallbackMedia,
}

impl MediaState {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::RealMedia => "REAL_MEDIA",
            Self::DerivedMedia => "DERIVED_MEDIA",
            Self::PlaceholderMedia => "PLACEHOLDER_MEDIA",
            Self::FallbackMedia => "FALLBACK_MEDIA",
        }
    }
}

/// Placeholder policy (MEDIA_REPRESENTATION_CONTRACT §2.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MediaPlaceholderPolicy {
    ContentOnly,
    ContentThenPlaceholder,
    ContentThenGenerated,
    FullySyntheticAllowed,
}

impl MediaPlaceholderPolicy {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            Self::ContentOnly => "CONTENT_ONLY",
            Self::ContentThenPlaceholder => "CONTENT_THEN_PLACEHOLDER",
            Self::ContentThenGenerated => "CONTENT_THEN_GENERATED",
            Self::FullySyntheticAllowed => "FULLY_SYNTHETIC_ALLOWED",
        }
    }
}

/// Static mapping from experience profile `content_format` strings.
pub fn content_format_to_media_intent(content_format: &str) -> MediaIntent {
    match content_format.to_ascii_uppercase().as_str() {
        "DOCUMENTARY" => MediaIntent::Documentary,
        "MICRO_DRAMA" => MediaIntent::MicroDrama,
        "MUSIC_VIDEO" => MediaIntent::MusicVideo,
        "CLIP" => MediaIntent::Clip,
        _ => MediaIntent::Unknown,
    }
}

/// Default placeholder policy per content format (media inventory §5.1).
pub fn default_placeholder_policy(intent: MediaIntent) -> MediaPlaceholderPolicy {
    match intent {
        MediaIntent::Unknown => MediaPlaceholderPolicy::ContentOnly,
        _ => MediaPlaceholderPolicy::ContentThenPlaceholder,
    }
}

/// Deterministic `media_state` from RVE-only signals (no inventory / URLs).
pub fn resolve_media_state(
    intent: MediaIntent,
    policy: MediaPlaceholderPolicy,
    hero_mode_off: bool,
    semantic_real_hint: bool,
    semantic_derived_hint: bool,
) -> MediaState {
    if semantic_real_hint {
        return MediaState::RealMedia;
    }
    if semantic_derived_hint {
        return MediaState::DerivedMedia;
    }
    if hero_mode_off && matches!(policy, MediaPlaceholderPolicy::ContentOnly) {
        return MediaState::FallbackMedia;
    }
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
