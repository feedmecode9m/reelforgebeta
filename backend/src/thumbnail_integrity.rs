//! Poster JPEG integrity — independent of viewer/feed identity.
//!
//! Rejects the known ffmpeg 674-byte 320×240 placeholder frames and
//! other files too small to be a usable card poster.

/// Known bad ffmpeg placeholder size (q=2, 320×240, near-solid frame).
pub const KNOWN_TINY_FFMPEG_BYTES: u64 = 674;
/// Minimum on-disk size for a usable poster.
pub const MIN_POSTER_BYTES: u64 = 8_000;
/// Minimum long-edge pixels.
pub const MIN_POSTER_LONG_EDGE: u32 = 480;
/// Minimum short-edge pixels.
pub const MIN_POSTER_SHORT_EDGE: u32 = 240;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PosterClass {
    Valid,
    Missing,
    TinyPlaceholder,
    TooSmall,
    InvalidDimensions,
    Unreadable,
}

impl PosterClass {
    pub fn as_str(self) -> &'static str {
        match self {
            PosterClass::Valid => "valid",
            PosterClass::Missing => "missing",
            PosterClass::TinyPlaceholder => "tiny_placeholder",
            PosterClass::TooSmall => "too_small",
            PosterClass::InvalidDimensions => "invalid_dimensions",
            PosterClass::Unreadable => "unreadable",
        }
    }

    pub fn is_valid(self) -> bool {
        self == PosterClass::Valid
    }

    pub fn needs_regeneration(self) -> bool {
        !matches!(self, PosterClass::Valid | PosterClass::Missing)
    }
}

/// JPEG SOF0/SOF2 width × height.
pub fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let mut i = 2usize;
    while i + 3 < bytes.len() {
        if bytes[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = bytes[i + 1];
        i += 2;
        if marker == 0xD9 || marker == 0xDA {
            break;
        }
        if marker == 0x00 || (0xD0..=0xD9).contains(&marker) {
            continue;
        }
        if i + 1 >= bytes.len() {
            return None;
        }
        let len = u16::from_be_bytes([bytes[i], bytes[i + 1]]) as usize;
        if len < 2 || i + len > bytes.len() {
            return None;
        }
        if matches!(
            marker,
            0xC0 | 0xC1 | 0xC2 | 0xC3 | 0xC5 | 0xC6 | 0xC7 | 0xC9 | 0xCA | 0xCB | 0xCD | 0xCE
                | 0xCF
        ) && len >= 7
        {
            let h = u16::from_be_bytes([bytes[i + 3], bytes[i + 4]]) as u32;
            let w = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
            if w > 0 && h > 0 {
                return Some((w, h));
            }
        }
        i += len;
    }
    None
}

pub fn classify_poster_bytes(bytes: &[u8]) -> PosterClass {
    if bytes.is_empty() {
        return PosterClass::Missing;
    }
    if !crate::media_seed::is_valid_image_bytes(bytes) {
        return PosterClass::Unreadable;
    }
    let n = bytes.len() as u64;
    if n == KNOWN_TINY_FFMPEG_BYTES || n < 2_048 {
        return PosterClass::TinyPlaceholder;
    }
    let Some((w, h)) = jpeg_dimensions(bytes) else {
        return PosterClass::Unreadable;
    };
    let long = w.max(h);
    let short = w.min(h);
    if long < MIN_POSTER_LONG_EDGE || short < MIN_POSTER_SHORT_EDGE {
        return PosterClass::InvalidDimensions;
    }
    if n < MIN_POSTER_BYTES {
        return PosterClass::TooSmall;
    }
    PosterClass::Valid
}

pub fn is_usable_poster(bytes: &[u8]) -> bool {
    classify_poster_bytes(bytes) == PosterClass::Valid
}

pub fn classify_poster_path(path: &std::path::Path) -> PosterClass {
    if !path.is_file() {
        return PosterClass::Missing;
    }
    match std::fs::read(path) {
        Ok(bytes) => classify_poster_bytes(&bytes),
        Err(_) => PosterClass::Unreadable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty() {
        assert_eq!(classify_poster_bytes(&[]), PosterClass::Missing);
    }

    #[test]
    fn rejects_known_tiny_size() {
        let mut bytes = vec![0xFF, 0xD8, 0xFF];
        bytes.resize(674, 0);
        assert_eq!(classify_poster_bytes(&bytes), PosterClass::TinyPlaceholder);
    }
}
