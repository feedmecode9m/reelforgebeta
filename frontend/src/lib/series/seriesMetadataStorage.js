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
 * @property {string[]} [tags]
 * @property {number} [runtime]
 * @property {number} [releaseYear]
 * @property {'draft' | 'ready' | 'published' | 'archived'} [episodeStatus]
 * @property {string} [episodeId]
 * @property {string} [seriesId]
 * @property {number} [updatedAt]
 */

/** @returns {Record<string, ReelSeriesMetadata>} */
export function loadReelSeriesMetadataMap() {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(SERIES_METADATA_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return /** @type {Record<string, ReelSeriesMetadata>} */ (parsed);
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
