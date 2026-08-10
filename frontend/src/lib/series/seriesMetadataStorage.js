/**
 * Phase 4 — reel-level series metadata persisted in localStorage only.
 */

export const SERIES_METADATA_STORAGE_KEY = 'reelforge_series_metadata';

/**
 * @typedef {Object} ReelSeriesMetadata
 * @property {string} reelId
 * @property {string} seriesName
 * @property {number} seasonNumber
 * @property {number} episodeNumber
 * @property {string} episodeTitle
 * @property {string} [description]
 * @property {string} [genre]
 * @property {string} [suggestedGenre] Intelligence proposal only — never official until creator assigns genre
 * @property {string} [intelligenceExplanation] Labeled suggestion text for studio/viewer
 * @property {string[]} [tags]
 * @property {number} [runtime]
 * @property {number} [releaseYear]
 * @property {'draft' | 'ready' | 'published' | 'archived'} [episodeStatus]
 * @property {string} [episodeId]
 * @property {string} [seriesId]
 * @property {number} [updatedAt]
 */

/**
 * True when LS value is the offline API wrapper formerly written under the metadata key.
 * @param {unknown} parsed
 */
function isOfflineApiCacheBlob(parsed) {
    return (
        Boolean(parsed) &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Array.isArray(/** @type {{ catalog?: unknown }} */ (parsed).catalog) &&
        /** @type {{ map?: unknown }} */ (parsed).map &&
        typeof /** @type {{ map?: unknown }} */ (parsed).map === 'object'
    );
}

/** @returns {Record<string, ReelSeriesMetadata>} */
export function loadReelSeriesMetadataMap() {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(SERIES_METADATA_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        // Legacy collision: offline catalog was stored under the same key as the reel map.
        if (isOfflineApiCacheBlob(parsed)) {
            return /** @type {Record<string, ReelSeriesMetadata>} */ (
                /** @type {{ map: Record<string, ReelSeriesMetadata> }} */ (parsed).map || {}
            );
        }
        // Hybrid pollution: strip non-reel keys left by the collision repair race.
        /** @type {Record<string, ReelSeriesMetadata>} */
        const out = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (key === 'catalog' || key === 'map' || key === 'cachedAt') continue;
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            out[key] = /** @type {ReelSeriesMetadata} */ (value);
        }
        return out;
    } catch {
        return {};
    }
}

/** @param {Record<string, ReelSeriesMetadata>} map */
export function persistReelSeriesMetadataMap(map) {
    if (typeof window === 'undefined') return false;
    try {
        localStorage.setItem(SERIES_METADATA_STORAGE_KEY, JSON.stringify(map));
        return true;
    } catch (err) {
        console.warn('[seriesMetadata] persist failed', err);
        return false;
    }
}

/** @param {string} reelId */
export function getStoredReelSeriesMetadata(reelId) {
    if (!reelId) return null;
    const map = loadReelSeriesMetadataMap();
    return map[reelId] || null;
}

/**
 * @param {string} reelId
 * @param {Partial<ReelSeriesMetadata>} patch
 * @returns {ReelSeriesMetadata | null}
 */
export function upsertStoredReelSeriesMetadata(reelId, patch) {
    if (!reelId) return null;
    const map = loadReelSeriesMetadataMap();
    const prev = map[reelId] || {};
    const next = {
        ...prev,
        ...patch,
        reelId,
        seasonNumber: Number(patch.seasonNumber ?? prev.seasonNumber ?? 1) || 1,
        episodeNumber: Number(patch.episodeNumber ?? prev.episodeNumber ?? 1) || 1,
        tags: normalizeTags(patch.tags ?? prev.tags ?? []),
        updatedAt: Date.now()
    };
    map[reelId] = next;
    persistReelSeriesMetadataMap(map);
    return next;
}

/** @param {string[] | string | undefined} tags */
export function normalizeTags(tags) {
    if (!tags) return [];
    const list = Array.isArray(tags) ? tags : String(tags).split(',');
    return list.map((t) => String(t).trim()).filter(Boolean);
}
