/**
 * High-confidence vault title → canonical series/episode binding.
 *
 * Only infers when episode numbers are explicit in titles.
 * Persists via seriesStore APIs (does not invent a parallel store).
 * Does not modify mockSeriesData.js.
 */

import { get } from 'svelte/store';
import {
    attachEpisodeReel,
    bindEpisodeToFeedReel,
    getEpisodeById,
    getEpisodeByReelId,
    getReelSeriesMetadata,
    getSeriesById,
    saveReelSeriesMetadata,
    seriesCatalog
} from './seriesStore.js';

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {Record<string, unknown>} detail
 */
export function logVaultSeriesInference(detail = {}) {
    console.info('[VAULT_SERIES_INFERENCE]', {
        ...detail,
        ts: new Date().toISOString()
    });
}

/**
 * @param {string} value
 */
export function slugifySeriesKey(value) {
    return (
        String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'series'
    );
}

/**
 * @param {string} raw
 */
function stripMediaExtension(raw) {
    return String(raw || '')
        .trim()
        .replace(/\.(mp4|mov|webm|m4v|avi|mkv)$/i, '')
        .trim();
}

/**
 * @param {string} raw
 */
function cleanSeriesBase(raw) {
    return String(raw || '')
        .replace(/[\s\-_.]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @param {unknown} value
 */
function normalizeTitleish(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Known removable production / house prefixes that never form the series base alone.
 * Kept allowlist-tight — does not strip arbitrary leading words.
 */
const PRODUCTION_TITLE_PREFIXES = ['MICROS', 'MICRO', 'RFPROD', 'RF'];

/**
 * Known franchise series roots (canonical identity).
 * Episode suffixes (Motherland, V1, numbered labels) never redefine these.
 */
const FRANCHISE_KEYWORDS = ['STIRRED'];

/**
 * Tokens that are episode décor only — never become a series title.
 */
const EPISODE_ONLY_SUFFIXES = new Set([
    'motherland',
    'final',
    'cut',
    'director',
    'extended',
    'recut',
    'rough',
    'draft',
    'alt',
    'alternate',
    'teaser',
    'trailer',
    'preview'
]);

/**
 * @param {string} value
 */
function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip house/production prefixes (MICROS …) from a vault title.
 * @param {string} raw
 */
export function stripProductionTitlePrefixes(raw) {
    let text = cleanSeriesBase(raw);
    let guard = 0;
    while (guard < 6) {
        guard += 1;
        let hit = false;
        for (const prefix of PRODUCTION_TITLE_PREFIXES) {
            const re = new RegExp(`^${escapeRegExp(prefix)}[\\s\\-_.]+`, 'i');
            if (re.test(text)) {
                text = cleanSeriesBase(text.replace(re, ''));
                hit = true;
                break;
            }
        }
        if (!hit) break;
    }
    return text;
}

/**
 * True when a candidate series base is only episode décor / version noise.
 * @param {string} candidate
 */
function isEpisodeOnlySeriesCandidate(candidate) {
    const cleaned = cleanSeriesBase(candidate);
    if (!cleaned) return true;
    if (/^\d+$/.test(cleaned)) return true;
    if (/^[Vv]\d{1,3}$/i.test(cleaned)) return true;
    if (PRODUCTION_TITLE_PREFIXES.some((p) => p.toLowerCase() === cleaned.toLowerCase())) {
        return true;
    }
    const tokens = cleaned
        .toLowerCase()
        .split(/[\s\-_.]+/)
        .filter(Boolean);
    if (!tokens.length) return true;
    // Pure version stacks: V1 V2
    if (tokens.every((t) => /^v\d{1,3}$/i.test(t) || /^\d+$/.test(t))) return true;
    // Motherland / final cut alone
    if (tokens.every((t) => EPISODE_ONLY_SUFFIXES.has(t) || /^v?\d{1,3}$/i.test(t))) {
        return true;
    }
    return false;
}

/**
 * Pull canonical franchise identity + episode number from known keywords.
 * Preserves full human title as episodeTitle.
 *
 * @param {string} rawTitle
 * @returns {{
 *   seriesTitle: string;
 *   seasonNumber: number;
 *   episodeNumber: number;
 *   episodeTitle: string;
 *   confidence: string;
 *   rawTitle: string;
 *   normalizedTitle: string;
 * } | null}
 */
export function parseFranchiseEpisodeTitle(rawTitle) {
    const full = stripMediaExtension(rawTitle);
    if (!full || full.length < 3) return null;
    if (UUID_RE.test(full)) return null;

    const stripped = stripProductionTitlePrefixes(full);
    if (!stripped) return null;

    for (const franchise of FRANCHISE_KEYWORDS) {
        // Franchise must appear as its own token (not inside another word).
        const headRe = new RegExp(`^${escapeRegExp(franchise)}(?:[\\s\\-_.]+(.*))?$`, 'i');
        const headMatch = stripped.match(headRe);
        if (!headMatch) continue;

        const rest = cleanSeriesBase(headMatch[1] || '');
        /** @type {number | null} */
        let episodeNumber = null;
        let confidence = 'franchise-keyword';

        // STIRRED V1(2) / STIRRED Motherland V1(2) — paren episode index
        let m = rest.match(/[Vv](\d{1,3})\s*[\(\[]\s*(\d{1,3})\s*[\)\]]\s*$/);
        if (m) {
            episodeNumber = Math.max(1, Number(m[2]) || Number(m[1]) || 1);
            confidence = 'franchise-version-paren';
        }

        // STIRRED 2 Motherland / STIRRED 1 — leading number after franchise
        if (episodeNumber == null) {
            m = rest.match(/^(\d{1,3})(?:[\s\-_.]+.*)?$/);
            if (m) {
                episodeNumber = Math.max(1, Number(m[1]) || 1);
                confidence = 'franchise-leading-number';
            }
        }

        // STIRRED V1 / STIRRED Motherland V3 — version token (prefer leading number when both)
        if (episodeNumber == null) {
            m = rest.match(/(?:^|[\s\-_.])[Vv](\d{1,3})\s*$/);
            if (m) {
                episodeNumber = Math.max(1, Number(m[1]) || 1);
                confidence = 'franchise-version';
            }
        }

        // Bare STIRRED with no number — not high-confidence
        if (episodeNumber == null) return null;

        return {
            seriesTitle: franchise,
            seasonNumber: 1,
            episodeNumber,
            episodeTitle: full,
            confidence,
            rawTitle: full,
            normalizedTitle: franchise
        };
    }

    return null;
}

/**
 * Normalize creator vault naming into a canonical series/episode seed.
 *
 * Accepts:
 *   - MICROS STIRRED V1 / MICROS STIRRED V2 (production prefix + franchise + version)
 *   - STIRRED V1 (bare franchise version)
 *
 * Rejects series roots that are only episode décor (Motherland, V1, …).
 *
 * @param {string | null | undefined} rawTitle
 * @returns {{
 *   seriesTitle: string;
 *   seasonNumber: number;
 *   episodeNumber: number;
 *   episodeTitle?: string;
 *   confidence: string;
 *   rawTitle: string;
 *   normalizedTitle: string;
 * } | null}
 */
export function normalizeVaultTitle(rawTitle) {
    const raw = stripMediaExtension(rawTitle);
    if (!raw || raw.length < 3) return null;
    if (UUID_RE.test(raw)) return null;

    // Franchise path first (preserves full title semantics).
    const franchise = parseFranchiseEpisodeTitle(raw);
    if (franchise) return franchise;

    // Episode suffix: version marker V1 / V2 (standalone token at end)
    const versionMatch = raw.match(/^(?=.*[A-Za-z])(.+?)[\s\-_.]+[Vv](\d{1,3})\s*$/);
    if (!versionMatch) return null;

    const head = cleanSeriesBase(versionMatch[1]);
    const episodeNumber = Math.max(1, Math.min(999, Number(versionMatch[2]) || 1));
    if (!head || head.length < 2) return null;

    // Strip production prefix if present
    let seriesTitle = stripProductionTitlePrefixes(head);
    // If after stripping prefix we only have décor, fail — do not invent "Motherland" series
    if (isEpisodeOnlySeriesCandidate(seriesTitle)) return null;

    // Prefer franchise keyword embedded in remaining head
    const franchiseFromHead = parseFranchiseEpisodeTitle(`${seriesTitle} V${episodeNumber}`);
    if (franchiseFromHead) {
        return {
            ...franchiseFromHead,
            episodeTitle: raw,
            rawTitle: raw
        };
    }

    seriesTitle = cleanSeriesBase(seriesTitle);
    if (
        seriesTitle.length < 2 ||
        /^\d+$/.test(seriesTitle) ||
        isEpisodeOnlySeriesCandidate(seriesTitle)
    ) {
        return null;
    }

    return {
        seriesTitle,
        seasonNumber: 1,
        episodeNumber,
        episodeTitle: raw,
        confidence: 'normalized-prefix-version',
        rawTitle: raw,
        normalizedTitle: seriesTitle
    };
}

/**
 * Parse only high-confidence episode titles (explicit season/ep or trailing number).
 * Priority:
 *   (0) known franchise keywords
 *   (A) explicit patterns (with franchise / décor guards)
 *   (B) normalized creator naming
 *   (C) null
 *
 * @param {string | null | undefined} rawTitle
 * @returns {{
 *   seriesTitle: string;
 *   seasonNumber: number;
 *   episodeNumber: number;
 *   episodeTitle?: string;
 *   confidence: string;
 *   rawTitle?: string;
 *   normalizedTitle?: string;
 * } | null}
 */
export function parseHighConfidenceEpisodeTitle(rawTitle) {
    let text = stripMediaExtension(rawTitle);
    if (!text || text.length < 3) return null;
    if (UUID_RE.test(text)) return null;
    if (/^img[_\s-]?\d+/i.test(text)) return null;
    if (/^hero[-_\s]?background/i.test(text)) return null;
    if (/^untitled/i.test(text)) return null;

    // --- 0. Known franchise keywords (STIRRED 2 Motherland, STIRRED V1, …) ---
    const franchise = parseFranchiseEpisodeTitle(text);
    if (franchise) return franchise;

    // --- A. Existing explicit patterns ---

    // NAME V1(2) / NAME V1 (2) — version + episode in parens
    let m = text.match(/^(.*?)[\s\-_.]*[Vv]\d+\s*[\(\[]\s*(\d{1,3})\s*[\)\]]\s*$/);
    if (m) {
        let seriesTitle = cleanSeriesBase(m[1]);
        seriesTitle = stripProductionTitlePrefixes(seriesTitle);
        // Prefer franchise inside left-hand side
        const viaFranchise = parseFranchiseEpisodeTitle(text);
        if (viaFranchise) return viaFranchise;
        if (seriesTitle.length >= 2 && !isEpisodeOnlySeriesCandidate(seriesTitle)) {
            // Drop trailing episode-only tokens from series base (STIRRED Motherland → STIRRED)
            const franchiseEmbed = FRANCHISE_KEYWORDS.find((f) =>
                new RegExp(`^${escapeRegExp(f)}(?:[\\s\\-_.]|$)`, 'i').test(seriesTitle)
            );
            if (franchiseEmbed) {
                return {
                    seriesTitle: franchiseEmbed,
                    seasonNumber: 1,
                    episodeNumber: Math.max(1, Number(m[2]) || 1),
                    episodeTitle: text,
                    confidence: 'version-paren-ep',
                    rawTitle: text,
                    normalizedTitle: franchiseEmbed
                };
            }
            return {
                seriesTitle,
                seasonNumber: 1,
                episodeNumber: Math.max(1, Number(m[2]) || 1),
                episodeTitle: text,
                confidence: 'version-paren-ep'
            };
        }
    }

    // NAME S01E02 / NAME S1E2 (optional trailing subtitle after packed marker)
    m = text.match(
        /^(.*?)[\s\-_.]*(?:[\[(])?S(\d{1,2})\s*[Ee](\d{1,3})[\])]?(?:[\s\-_.]+.*)?\s*$/i
    );
    if (m) {
        let seriesTitle = stripProductionTitlePrefixes(cleanSeriesBase(m[1]));
        if (seriesTitle.length >= 2 && !isEpisodeOnlySeriesCandidate(seriesTitle)) {
            return {
                seriesTitle,
                seasonNumber: Math.max(1, Number(m[2]) || 1),
                episodeNumber: Math.max(1, Number(m[3]) || 1),
                episodeTitle: text,
                confidence: 'sxe'
            };
        }
    }

    // NAME S01 EPISODE 2 / NAME S1 EP 3 (season token + episode word/number, not packed SxxExx)
    m = text.match(
        /^(.*?)[\s\-_.]*(?:[\[(])?S(\d{1,2})[\s\-_.]+(?:ep(?:isode)?[\s\-_.]*)(\d{1,3})[\])]?(?:[\s\-_.]+.*)?\s*$/i
    );
    if (m) {
        let seriesTitle = stripProductionTitlePrefixes(cleanSeriesBase(m[1]));
        if (seriesTitle.length >= 2 && !isEpisodeOnlySeriesCandidate(seriesTitle)) {
            return {
                seriesTitle,
                seasonNumber: Math.max(1, Number(m[2]) || 1),
                episodeNumber: Math.max(1, Number(m[3]) || 1),
                episodeTitle: text,
                confidence: 'sxe-episode'
            };
        }
    }

    // NAME EP 2 / NAME Episode 3  (optional trailing subtitle: EPISODE 2 - SUBTITLE)
    m = text.match(
        /^(.*?)[\s\-_.]+(?:ep(?:isode)?[\s\-_.]*)(\d{1,3})(?:[\s\-_.]+.+)?\s*$/i
    );
    if (m) {
        let seriesTitle = stripProductionTitlePrefixes(cleanSeriesBase(m[1]));
        if (seriesTitle.length >= 2 && !isEpisodeOnlySeriesCandidate(seriesTitle)) {
            return {
                seriesTitle,
                seasonNumber: 1,
                episodeNumber: Math.max(1, Number(m[2]) || 1),
                episodeTitle: text,
                confidence: 'ep-token'
            };
        }
    }

    // NAME 1 / STIRRED 1 — requires letter in base + standalone trailing number
    m = text.match(/^(?=.*[A-Za-z])(.+?)[\s\-_.]+(\d{1,3})\s*$/);
    if (m) {
        let seriesTitle = stripProductionTitlePrefixes(cleanSeriesBase(m[1]));
        // Avoid pure camera dumps and year-only bases; reject episode-only bases
        if (
            seriesTitle.length >= 2 &&
            !/^\d+$/.test(seriesTitle) &&
            !/^dsc/i.test(seriesTitle) &&
            !/^vid_/i.test(seriesTitle) &&
            !isEpisodeOnlySeriesCandidate(seriesTitle)
        ) {
            return {
                seriesTitle,
                seasonNumber: 1,
                episodeNumber: Math.max(1, Number(m[2]) || 1),
                episodeTitle: text,
                confidence: 'trailing-number'
            };
        }
    }

    // --- B. Normalized creator naming (prefix + version / franchise) ---
    const normalized = normalizeVaultTitle(text);
    if (normalized) return normalized;

    // --- C. Fail closed ---
    return null;
}

/**
 * Map internal parse confidence codes → viewer/vault tier (high|medium|low).
 * Deterministic; does not invent franchises.
 * @param {string | null | undefined} code
 * @returns {'high' | 'medium' | 'low'}
 */
export function mapSeriesParseConfidence(code) {
    const c = String(code || '').toLowerCase();
    if (!c) return 'low';
    if (
        c === 'high' ||
        c === 'sxe' ||
        c === 'sxe-episode' ||
        c === 'ep-token' ||
        c === 'trailing-number' ||
        c === 'version-paren-ep' ||
        c === 'franchise-leading-number' ||
        c === 'franchise-version' ||
        c === 'franchise-version-paren' ||
        c === 'franchise-keyword'
    ) {
        return 'high';
    }
    if (
        c === 'medium' ||
        c === 'normalized-prefix-version' ||
        c === 'series-subtitle' ||
        c === 'series-root'
    ) {
        return 'medium';
    }
    if (c === 'low') return 'low';
    return 'medium';
}

/**
 * @typedef {{
 *   seriesLabel: string;
 *   seasonNumber: number;
 *   episodeNumber: number;
 *   confidence: 'high' | 'medium' | 'low';
 *   episodeTitle?: string;
 *   parseConfidence?: string;
 * }} VaultSeriesIdentity
 */

/**
 * Parse a free-form series-only title: "STIRRED - The Beginning".
 * Returns medium confidence — series root only, default season/episode 1.
 * Does not hardcode franchise names.
 *
 * @param {string} text
 * @returns {VaultSeriesIdentity | null}
 */
function parseSeriesSubtitleIdentity(text) {
    const m = text.match(/^(?=.*[A-Za-z])(.+?)\s*[-–—]\s+(.+)$/);
    if (!m) return null;
    let seriesTitle = stripProductionTitlePrefixes(cleanSeriesBase(m[1]));
    const subtitle = cleanSeriesBase(m[2]);
    if (!seriesTitle || seriesTitle.length < 2 || !subtitle) return null;
    // Reject if left side already carries episode markers
    if (/\bS\d{1,2}\s*[Ee]\d{1,3}\b/i.test(seriesTitle)) return null;
    if (/\b(?:ep(?:isode)?)\s*\d{1,3}\b/i.test(seriesTitle)) return null;
    if (isEpisodeOnlySeriesCandidate(seriesTitle)) return null;
    if (/^\d+$/.test(seriesTitle)) return null;
    return {
        seriesLabel: seriesTitle,
        seasonNumber: 1,
        episodeNumber: 1,
        confidence: 'medium',
        episodeTitle: text,
        parseConfidence: 'series-subtitle'
    };
}

/**
 * Canonical Hero Vault series identity from a title or asset row.
 * Prefer persisted seriesIdentity / flat fields; otherwise parse deterministically.
 *
 * Examples:
 *   "STIRRED S01E01" → { seriesLabel:"STIRRED", seasonNumber:1, episodeNumber:1, confidence:"high" }
 *   "STIRRED S01 EPISODE 2" → same shape, ep 2
 *   "STIRRED - The Beginning" → medium, ep 1
 *
 * @param {Record<string, unknown> | string | null | undefined} assetOrTitle
 * @returns {VaultSeriesIdentity | null}
 */
export function buildVaultSeriesIdentity(assetOrTitle) {
    const isObj = assetOrTitle && typeof assetOrTitle === 'object';
    /** @type {Record<string, unknown>} */
    const item = isObj ? /** @type {Record<string, unknown>} */ (assetOrTitle) : {};
    const title = isObj
        ? String(item.name || item.title || item.fileName || item.file_name || item.displayTitle || '').trim()
        : String(assetOrTitle || '')
              .trim()
              .replace(/\.(mp4|mov|webm|m4v|avi|mkv)$/i, '');

    // 1) Explicit nested seriesIdentity (Hero Vault authority)
    const nested =
        item.seriesIdentity && typeof item.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (item.seriesIdentity)
            : null;
    if (nested) {
        const seriesLabel = cleanSeriesBase(
            String(nested.seriesLabel || nested.series_label || nested.seriesTitle || '')
        );
        const seasonNumber = Number(nested.seasonNumber ?? nested.season_number);
        const episodeNumber = Number(nested.episodeNumber ?? nested.episode_number);
        if (
            seriesLabel &&
            Number.isFinite(seasonNumber) &&
            seasonNumber >= 1 &&
            Number.isFinite(episodeNumber) &&
            episodeNumber >= 1
        ) {
            const confRaw = String(nested.confidence || 'high').toLowerCase();
            /** @type {'high' | 'medium' | 'low'} */
            const confidence =
                confRaw === 'low' || confRaw === 'medium' || confRaw === 'high'
                    ? confRaw
                    : mapSeriesParseConfidence(confRaw);
            return {
                seriesLabel,
                seasonNumber: Math.max(1, Math.floor(seasonNumber)),
                episodeNumber: Math.max(1, Math.floor(episodeNumber)),
                confidence,
                episodeTitle: String(nested.episodeTitle || title || seriesLabel).trim(),
                parseConfidence: String(nested.parseConfidence || 'persisted')
            };
        }
    }

    // 2) Flat vault metadata fields
    const flatLabel = cleanSeriesBase(
        String(item.seriesLabel || item.series_label || item.seriesName || item.series_name || '')
    );
    const flatSeason = Number(item.seasonNumber ?? item.season_number);
    const flatEpisode = Number(item.episodeNumber ?? item.episode_number);
    if (
        flatLabel &&
        Number.isFinite(flatSeason) &&
        flatSeason >= 1 &&
        Number.isFinite(flatEpisode) &&
        flatEpisode >= 1
    ) {
        return {
            seriesLabel: flatLabel,
            seasonNumber: Math.max(1, Math.floor(flatSeason)),
            episodeNumber: Math.max(1, Math.floor(flatEpisode)),
            confidence: 'high',
            episodeTitle: String(item.episodeTitle || item.episode_title || title || flatLabel).trim(),
            parseConfidence: 'flat-metadata'
        };
    }

    // 3) Title parse (no second relationship matcher — same high-confidence path)
    const parsed = parseHighConfidenceEpisodeTitle(title);
    if (parsed) {
        const seriesLabel = cleanSeriesBase(String(parsed.seriesTitle || ''));
        if (seriesLabel) {
            return {
                seriesLabel,
                seasonNumber: Math.max(1, Number(parsed.seasonNumber) || 1),
                episodeNumber: Math.max(1, Number(parsed.episodeNumber) || 1),
                confidence: mapSeriesParseConfidence(parsed.confidence),
                episodeTitle: String(parsed.episodeTitle || title || seriesLabel).trim(),
                parseConfidence: String(parsed.confidence || '')
            };
        }
    }

    // 4) Series root + subtitle (deterministic, medium)
    if (title) {
        const sub = parseSeriesSubtitleIdentity(stripMediaExtension(title));
        if (sub) return sub;
    }

    // Flat label alone (season/ep missing → default 1) when creator set seriesLabel only
    if (flatLabel) {
        return {
            seriesLabel: flatLabel,
            seasonNumber:
                Number.isFinite(flatSeason) && flatSeason >= 1 ? Math.floor(flatSeason) : 1,
            episodeNumber:
                Number.isFinite(flatEpisode) && flatEpisode >= 1 ? Math.floor(flatEpisode) : 1,
            confidence: 'medium',
            episodeTitle: String(item.episodeTitle || title || flatLabel).trim(),
            parseConfidence: 'flat-label-only'
        };
    }

    return null;
}

/**
 * Attach optional seriesIdentity onto a vault asset without mutating the input.
 * Missing identity remains valid (returns a shallow copy only when identity can be derived).
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {Record<string, unknown> | null | undefined}
 */
export function withVaultSeriesIdentity(asset) {
    if (!asset || typeof asset !== 'object') return asset;
    const existing =
        asset.seriesIdentity && typeof asset.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.seriesIdentity)
            : null;
    const built = buildVaultSeriesIdentity(asset);
    if (!built) {
        return asset;
    }
    // Preserve explicit persisted identity; still ensure flat mirrors when missing
    if (
        existing &&
        String(existing.seriesLabel || existing.series_label || '').trim() &&
        Number(existing.seasonNumber ?? existing.season_number) >= 1 &&
        Number(existing.episodeNumber ?? existing.episode_number) >= 1
    ) {
        const identity = buildVaultSeriesIdentity({ ...asset, seriesIdentity: existing }) || built;
        return {
            ...asset,
            seriesIdentity: {
                seriesLabel: identity.seriesLabel,
                seasonNumber: identity.seasonNumber,
                episodeNumber: identity.episodeNumber,
                confidence: identity.confidence
            },
            seriesLabel: String(asset.seriesLabel || identity.seriesLabel).trim() || identity.seriesLabel,
            seasonNumber:
                Number(asset.seasonNumber ?? asset.season_number) >= 1
                    ? Number(asset.seasonNumber ?? asset.season_number)
                    : identity.seasonNumber,
            episodeNumber:
                Number(asset.episodeNumber ?? asset.episode_number) >= 1
                    ? Number(asset.episodeNumber ?? asset.episode_number)
                    : identity.episodeNumber
        };
    }
    return {
        ...asset,
        seriesIdentity: {
            seriesLabel: built.seriesLabel,
            seasonNumber: built.seasonNumber,
            episodeNumber: built.episodeNumber,
            confidence: built.confidence
        },
        seriesLabel: String(asset.seriesLabel || built.seriesLabel).trim() || built.seriesLabel,
        seasonNumber:
            Number(asset.seasonNumber ?? asset.season_number) >= 1
                ? Number(asset.seasonNumber ?? asset.season_number)
                : built.seasonNumber,
        episodeNumber:
            Number(asset.episodeNumber ?? asset.episode_number) >= 1
                ? Number(asset.episodeNumber ?? asset.episode_number)
                : built.episodeNumber
    };
}

/**
 * @param {unknown} reelId
 */
export function isRealVaultUuid(reelId) {
    return UUID_RE.test(String(reelId || '').trim());
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 */
function reelDisplayTitle(reel) {
    return String(reel?.name || reel?.title || reel?.fileName || reel?.file_name || '').trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 */
function hasPlayableMedia(reel) {
    const url = String(reel?.url || reel?.video_url || reel?.videoUrl || '').trim();
    return Boolean(reel?.id && url && !url.startsWith('blob:'));
}

/**
 * @param {string} reelId
 */
export function isReelAlreadySeriesBound(reelId) {
    const id = String(reelId || '').trim();
    if (!id) return true;
    if (getEpisodeByReelId(id)) return true;
    const meta = getReelSeriesMetadata(id);
    // Only treat metadata as authoritative when the referenced episode exists in catalog
    if (meta?.episodeId && getEpisodeById(String(meta.episodeId))) return true;
    // Explicit studio structured metadata — do not override when episode is catalog-backed
    if (
        meta?.seriesId &&
        meta?.episodeNumber &&
        String(meta.seriesName || '').trim() &&
        meta?.episodeId &&
        getEpisodeById(String(meta.episodeId))
    ) {
        if (getSeriesById(String(meta.seriesId))) return true;
    }
    return false;
}

/**
 * @param {string} seriesTitle
 */
function ensureSeriesInCatalog(seriesTitle) {
    const title = cleanSeriesBase(seriesTitle);
    const slug = slugifySeriesKey(title);
    const seriesId = `series-${slug}`;

    const byId = getSeriesById(seriesId);
    if (byId) return byId;

    const byTitle = get(seriesCatalog).find(
        (s) => String(s.title || '').trim().toLowerCase() === title.toLowerCase()
    );
    if (byTitle) return byTitle;

    /** @type {import('./seriesTypes.js').Series} */
    const created = {
        id: seriesId,
        title,
        // Creator truth: no synthetic marketing description or genre.
        // Season 1 shell is structural scaffolding only (empty until episodes bind).
        description: '',
        tags: ['vault-inferred'],
        seasons: [
            {
                seasonId: `season-${slug}-1`,
                seasonNumber: 1,
                title: 'Season 1',
                episodes: []
            }
        ]
    };

    seriesCatalog.update((items) => {
        if (items.some((s) => s.id === seriesId)) return items;
        return [...items, created];
    });

    logVaultSeriesInference({
        phase: 'series-created',
        seriesId,
        seriesTitle: title,
        source: 'vault-title-inference'
    });

    return getSeriesById(seriesId) || created;
}

/**
 * Ensure episode exists in series catalog.
 * Same episode number can hold distinct vault titles (STIRRED 1 vs STIRRED V1).
 * @param {string} seriesId
 * @param {number} seasonNumber
 * @param {number} episodeNumber
 * @param {string} episodeTitle
 * @returns {import('./seriesTypes.js').Episode | null}
 */
function ensureEpisodeInCatalog(seriesId, seasonNumber, episodeNumber, episodeTitle) {
    const series = getSeriesById(seriesId);
    if (!series) return null;

    const slug = slugifySeriesKey(seriesId.replace(/^series-/, '') || series.title);
    const humanTitle = cleanSeriesBase(episodeTitle) || `Episode ${episodeNumber}`;
    const titleSlug = slugifySeriesKey(humanTitle);
    const padS = String(seasonNumber).padStart(2, '0');
    const padE = String(episodeNumber).padStart(2, '0');
    const baseId = `ep-${slug}-s${padS}e${padE}`;

    // Prefer stable short id when title is just the franchise + number.
    // Disambiguate STIRRED 1 vs STIRRED V1 with a version suffix.
    const simpleNumber = new RegExp(
        `^${escapeRegExp(series.title || slug)}[\\s\\-_.]+${episodeNumber}$`,
        'i'
    );
    const simpleVersion = new RegExp(
        `^${escapeRegExp(series.title || slug)}[\\s\\-_.]+[Vv]${episodeNumber}$`,
        'i'
    );
    let episodeId = baseId;
    if (simpleVersion.test(humanTitle)) {
        episodeId = `${baseId}-v${episodeNumber}`;
    } else if (!simpleNumber.test(humanTitle) && titleSlug && titleSlug !== slug) {
        episodeId = `${baseId}-${titleSlug}`.slice(0, 96);
    }

    const existingCtx = getEpisodeById(episodeId);
    if (existingCtx?.episode) {
        if (
            humanTitle &&
            String(existingCtx.episode.title || '').trim().toLowerCase() !== humanTitle.toLowerCase()
        ) {
            seriesCatalog.update((items) =>
                items.map((s) => {
                    if (s.id !== seriesId) return s;
                    return {
                        ...s,
                        seasons: (s.seasons || []).map((season) => {
                            if (season.seasonNumber !== seasonNumber) return season;
                            return {
                                ...season,
                                episodes: (season.episodes || []).map((ep) =>
                                    ep.episodeId === episodeId ? { ...ep, title: humanTitle } : ep
                                )
                            };
                        })
                    };
                })
            );
            return getEpisodeById(episodeId)?.episode || existingCtx.episode;
        }
        return existingCtx.episode;
    }

    const seasonHit = series.seasons?.find((s) => s.seasonNumber === seasonNumber);
    const existingByTitle = seasonHit?.episodes?.find(
        (e) =>
            String(e.title || '').trim().toLowerCase() === humanTitle.toLowerCase() ||
            e.episodeId === episodeId
    );
    if (existingByTitle) {
        return getEpisodeById(existingByTitle.episodeId)?.episode || existingByTitle;
    }

    /** @type {import('./seriesTypes.js').Episode} */
    const episode = {
        episodeId,
        episodeNumber,
        title: humanTitle,
        status: 'published',
        reelId: null,
        tags: ['vault-inferred']
    };

    seriesCatalog.update((items) =>
        items.map((s) => {
            if (s.id !== seriesId) return s;
            const seasons = Array.isArray(s.seasons) ? [...s.seasons] : [];
            let seasonIdx = seasons.findIndex((se) => se.seasonNumber === seasonNumber);
            if (seasonIdx < 0) {
                seasons.push({
                    seasonId: `season-${slug}-${seasonNumber}`,
                    seasonNumber,
                    title: `Season ${seasonNumber}`,
                    episodes: [episode]
                });
            } else {
                const season = { ...seasons[seasonIdx] };
                const episodes = Array.isArray(season.episodes) ? [...season.episodes] : [];
                if (
                    episodes.some(
                        (e) =>
                            e.episodeId === episodeId ||
                            (e.episodeNumber === episodeNumber &&
                                String(e.title || '').toLowerCase() === humanTitle.toLowerCase())
                    )
                ) {
                    return s;
                }
                episodes.push(episode);
                episodes.sort((a, b) => {
                    if (a.episodeNumber !== b.episodeNumber) {
                        return a.episodeNumber - b.episodeNumber;
                    }
                    return String(a.title || '').localeCompare(String(b.title || ''));
                });
                season.episodes = episodes;
                seasons[seasonIdx] = season;
            }
            return { ...s, seasons };
        })
    );

    logVaultSeriesInference({
        phase: 'episode-created',
        seriesId,
        episodeId,
        episodeNumber,
        episodeTitle: humanTitle,
        source: 'vault-title-inference'
    });

    return getEpisodeById(episodeId)?.episode || episode;
}

/**
 * Group vault reels with high-confidence title parses that share a series base.
 *
 * @param {Record<string, unknown>[]} reels
 */
export function buildHighConfidenceTitleGroups(reels = []) {
    /** @type {Map<string, Array<{ reel: Record<string, unknown>; parsed: ReturnType<typeof parseHighConfidenceEpisodeTitle> }>>} */
    const groups = new Map();

    for (const reel of reels) {
        if (!reel?.id || !hasPlayableMedia(reel)) continue;
        if (!isRealVaultUuid(reel.id)) continue;
        if (isReelAlreadySeriesBound(String(reel.id))) continue;

        const parsed = parseHighConfidenceEpisodeTitle(reelDisplayTitle(reel));
        if (!parsed) continue;

        const key = parsed.seriesTitle.toLowerCase();
        const list = groups.get(key) || [];
        list.push({ reel, parsed });
        groups.set(key, list);
    }

    /** @type {Array<{ seriesTitle: string; members: typeof groups extends Map<string, infer V> ? V : never }>} */
    const out = [];
    for (const [, members] of groups) {
        if (!members.length) continue;
        // High confidence: at least one explicit-number parse (always true here).
        // Prefer multi-member groups; allow singleton when confidence is sxe / ep-token / trailing-number / version-paren.
        const seriesTitle = members[0].parsed.seriesTitle;
        out.push({ seriesTitle, members });
    }
    return out;
}

/**
 * Infer series/episodes from vault titles and bind via seriesStore APIs.
 *
 * @param {Record<string, unknown>[]} reels
 * @param {{ source?: string }} [options]
 * @returns {{ bound: number; skipped: number; groups: number; seriesIds: string[]; bindings: Array<Record<string, unknown>> }}
 */
export function inferAndBindVaultSeries(reels = [], options = {}) {
    const source = options.source || 'vault-inference';
    const groups = buildHighConfidenceTitleGroups(reels);

    logVaultSeriesInference({
        phase: 'start',
        source,
        reelCount: reels.filter((r) => r?.id).length,
        groupCount: groups.length
    });

    let bound = 0;
    let skipped = 0;
    /** @type {string[]} */
    const seriesIds = [];
    /** @type {Array<Record<string, unknown>>} */
    const bindings = [];

    for (const group of groups) {
        const series = ensureSeriesInCatalog(group.seriesTitle);
        if (!series?.id) {
            skipped += group.members.length;
            continue;
        }
        if (!seriesIds.includes(series.id)) seriesIds.push(series.id);

        // Dedupe by season + episode number + human title (keep STIRRED 1 and STIRRED V1)
        /** @type {Map<string, typeof group.members[0]>} */
        const byEpKey = new Map();
        for (const member of group.members) {
            const human =
                member.parsed.episodeTitle ||
                reelDisplayTitle(member.reel) ||
                group.seriesTitle;
            const key = `${member.parsed.seasonNumber}:${member.parsed.episodeNumber}:${normalizeTitleish(human)}`;
            if (!byEpKey.has(key)) byEpKey.set(key, member);
            else skipped += 1;
        }

        for (const member of byEpKey.values()) {
            const reelId = String(member.reel.id);
            if (isReelAlreadySeriesBound(reelId)) {
                skipped += 1;
                continue;
            }

            const episodeTitle =
                member.parsed.episodeTitle ||
                reelDisplayTitle(member.reel) ||
                group.seriesTitle;
            const episode = ensureEpisodeInCatalog(
                series.id,
                member.parsed.seasonNumber,
                member.parsed.episodeNumber,
                episodeTitle
            );
            const episodeId = episode?.episodeId ? String(episode.episodeId) : '';
            if (!episodeId) {
                skipped += 1;
                logVaultSeriesInference({
                    phase: 'episode-ensure-failed',
                    seriesId: series.id,
                    mediaId: reelId,
                    source
                });
                continue;
            }

            // attachEpisodeReel → bindEpisodeToFeedReel (catalog reelId + metadata seed)
            let attached = false;
            try {
                attached = Boolean(attachEpisodeReel(episodeId, reelId));
            } catch (err) {
                logVaultSeriesInference({
                    phase: 'attach-error',
                    seriesId: series.id,
                    episodeId,
                    mediaId: reelId,
                    error: err?.message || String(err),
                    source
                });
            }
            if (!attached) {
                const boundOk = bindEpisodeToFeedReel(reelId, episodeId, {
                    seriesId: series.id,
                    seriesName: series.title,
                    seasonNumber: member.parsed.seasonNumber,
                    episodeNumber: member.parsed.episodeNumber,
                    episodeTitle,
                    episodeStatus: 'published'
                });
                if (!boundOk) {
                    skipped += 1;
                    logVaultSeriesInference({
                        phase: 'bind-failed',
                        seriesId: series.id,
                        episodeId,
                        mediaId: reelId,
                        source
                    });
                    continue;
                }
            }

            // Authoritative studio map write (includes seriesName, S/E, episodeId)
            const saved = saveReelSeriesMetadata(
                reelId,
                {
                    reelId,
                    seriesId: series.id,
                    seriesName: series.title,
                    seasonNumber: member.parsed.seasonNumber,
                    episodeNumber: member.parsed.episodeNumber,
                    episodeTitle,
                    episodeId,
                    episodeStatus: 'published'
                },
                { sourceType: 'vault', context: 'inferAndBindVaultSeries' }
            );

            // Prefer full vault title as aliases seed (title match first; aliases second).
            const aliasSeed = [];
            if (
                episodeTitle &&
                String(episode?.title || '').trim() &&
                normalizeTitleish(episodeTitle) !== normalizeTitleish(episode.title)
            ) {
                aliasSeed.push(episodeTitle);
            }

            // Stamp Hero Vault mediaAssetId on catalog episode (reuse ready vault id — no re-upload).
            seriesCatalog.update((items) =>
                items.map((s) => {
                    if (s.id !== series.id) return s;
                    return {
                        ...s,
                        seasons: s.seasons.map((season) => ({
                            ...season,
                            episodes: season.episodes.map((ep) => {
                                if (ep.episodeId !== episodeId) return ep;
                                return {
                                    ...ep,
                                    reelId,
                                    mediaAssetId: reelId,
                                    thumbnailAssetId: ep.thumbnailAssetId || null,
                                    aliases: Array.from(
                                        new Set([...(ep.aliases || []), ...aliasSeed])
                                    )
                                };
                            })
                        }))
                    };
                })
            );

            const byReel = getEpisodeByReelId(reelId);
            if (!byReel?.episode || String(byReel.episode.reelId) !== reelId) {
                skipped += 1;
                logVaultSeriesInference({
                    phase: 'post-bind-verify-failed',
                    seriesId: series.id,
                    episodeId,
                    mediaId: reelId,
                    metaEpisodeId: saved?.episodeId || null,
                    source
                });
                continue;
            }

            bound += 1;
            bindings.push({
                mediaId: reelId,
                seriesId: series.id,
                episodeId,
                seasonNumber: member.parsed.seasonNumber,
                episodeNumber: member.parsed.episodeNumber,
                confidence: member.parsed.confidence,
                metadata: {
                    reelId: saved?.reelId || reelId,
                    seriesId: saved?.seriesId || series.id,
                    seriesName: saved?.seriesName || series.title,
                    seasonNumber: saved?.seasonNumber ?? member.parsed.seasonNumber,
                    episodeNumber: saved?.episodeNumber ?? member.parsed.episodeNumber,
                    episodeTitle: saved?.episodeTitle || episodeTitle,
                    episodeId: saved?.episodeId || episodeId
                }
            });

            logVaultSeriesInference({
                phase: 'bound',
                source,
                seriesId: series.id,
                episodeId,
                mediaId: reelId,
                seriesTitle: series.title,
                episodeTitle,
                confidence: member.parsed.confidence,
                rawTitle: member.parsed.rawTitle || reelDisplayTitle(member.reel) || episodeTitle,
                normalizedTitle:
                    member.parsed.normalizedTitle ||
                    (member.parsed.confidence === 'normalized-prefix-version'
                        ? member.parsed.seriesTitle
                        : undefined)
            });
        }
    }

    logVaultSeriesInference({
        phase: 'complete',
        source,
        bound,
        skipped,
        groups: groups.length,
        seriesIds
    });

    return { bound, skipped, groups: groups.length, seriesIds, bindings };
}
