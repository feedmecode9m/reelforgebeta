/**
 * Thumbnail Vault → canonical episode poster assignment helpers.
 *
 * Poster authority: Episode.thumbnailUrl / episodes.thumbnail_url (URL-only V1).
 * Does not mutate reelId, mediaAssetId, or episodeId.
 */

import { toRelativeMediaPath } from '../config.js';
import { getEpisodeByMediaIdentity } from '../series/seriesStore.js';
import {
    isAuthoritativeCatalogBinding,
    resolveCanonicalCatalogOwner
} from '../series/canonicalCatalogOwnership.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTitle(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * @param {unknown} row
 * @returns {string}
 */
function mediaRowTitle(row) {
    if (!row || typeof row !== 'object') return '';
    const entry = /** @type {Record<string, unknown>} */ (row);
    return String(entry.name || entry.title || entry.fileName || '').trim();
}

/**
 * @param {unknown} asset
 * @returns {string}
 */
function videoAssetReelId(asset) {
    if (!asset || typeof asset !== 'object') return '';
    const row = /** @type {Record<string, unknown>} */ (asset);
    return String(row.id || row.mediaAssetId || row.reelId || row.personal_video_id || '').trim();
}

/**
 * @param {unknown} entry
 * @returns {string[]}
 */
function linkedMediaIdsFromThumbnail(entry) {
    if (!entry || typeof entry !== 'object') return [];
    const row = /** @type {Record<string, unknown>} */ (entry);
    /** @type {string[]} */
    const ordered = [
        row.personal_video_id,
        row.personalVideoId,
        row.linkedVideoId,
        row.sourceReelId,
        row.videoId,
        row.video_id,
        row.reelId,
        row.mediaAssetId
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    const seen = new Set();
    return ordered.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

/**
 * @param {string} mediaId
 * @returns {{
 *   series: import('../series/seriesTypes.js').Series;
 *   season: import('../series/seriesTypes.js').Season;
 *   episode: import('../series/seriesTypes.js').Episode;
 * } | null}
 */
function resolveAuthoritativeOwnerForMediaId(mediaId) {
    const id = String(mediaId || '').trim();
    if (!id) return null;
    const canonical = resolveCanonicalCatalogOwner(id);
    if (canonical) return canonical;
    const ctx = getEpisodeByMediaIdentity(id);
    if (ctx && isAuthoritativeCatalogBinding(ctx)) return ctx;
    return null;
}

/**
 * @param {unknown} thumbnailEntry
 * @param {unknown[]} videoAssets
 * @returns {unknown[]}
 */
function findMatchingVideoAssets(thumbnailEntry, videoAssets) {
    const thumbTitle = normalizeTitle(mediaRowTitle(thumbnailEntry));
    if (!thumbTitle) return [];
    /** @type {unknown[]} */
    const exact = [];
    /** @type {unknown[]} */
    const partial = [];
    for (const asset of videoAssets || []) {
        const videoTitle = normalizeTitle(mediaRowTitle(asset));
        if (!videoTitle) continue;
        if (videoTitle === thumbTitle) exact.push(asset);
        else if (videoTitle.includes(thumbTitle) || thumbTitle.includes(videoTitle)) {
            partial.push(asset);
        }
    }
    if (exact.length === 1) return exact;
    if (exact.length > 1) return [];
    if (partial.length === 1) return partial;
    return [];
}

/**
 * Resolve the canonical episode target for a Thumbnail Vault poster assignment.
 *
 * Priority:
 *   1) Linked playable media ids on the thumbnail entry (personal_video_id, etc.)
 *   2) Unique Video Vault title match → authoritative reel owner
 *
 * The thumbnail image UUID alone is never assumed to be the playable reel id.
 *
 * @param {unknown} thumbnailEntry
 * @param {import('../series/seriesTypes.js').Series[]} catalog
 * @param {{ videoAssets?: unknown[] }} [options]
 * @returns {{
 *   seriesId: string;
 *   seasonNumber: number;
 *   episodeId: string;
 *   reelId: string | null;
 *   reason: string;
 * } | null}
 */
export function resolvePosterAssignmentTarget(thumbnailEntry, catalog, options = {}) {
    void catalog;
    if (!thumbnailEntry || typeof thumbnailEntry !== 'object') return null;

    for (const mediaId of linkedMediaIdsFromThumbnail(thumbnailEntry)) {
        const owner = resolveAuthoritativeOwnerForMediaId(mediaId);
        if (owner?.series?.id && owner?.episode?.episodeId) {
            return {
                seriesId: String(owner.series.id),
                seasonNumber: Number(owner.season?.seasonNumber) || 1,
                episodeId: String(owner.episode.episodeId),
                reelId: owner.episode.reelId ? String(owner.episode.reelId) : null,
                reason: 'linked-media-id'
            };
        }
    }

    const videoAssets = Array.isArray(options.videoAssets) ? options.videoAssets : [];
    const matches = findMatchingVideoAssets(thumbnailEntry, videoAssets);
    if (matches.length === 1) {
        const reelId = videoAssetReelId(matches[0]);
        const owner = resolveAuthoritativeOwnerForMediaId(reelId);
        if (owner?.series?.id && owner?.episode?.episodeId) {
            return {
                seriesId: String(owner.series.id),
                seasonNumber: Number(owner.season?.seasonNumber) || 1,
                episodeId: String(owner.episode.episodeId),
                reelId: owner.episode.reelId ? String(owner.episode.reelId) : null,
                reason: 'video-title-match'
            };
        }
    }

    return null;
}

/**
 * Canonical browser/API poster URL from a Thumbnail Vault entry.
 * @param {unknown} entry
 * @returns {string}
 */
export function resolveThumbnailVaultPosterUrl(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const row = /** @type {Record<string, unknown>} */ (entry);
    const raw = String(row.url || row.thumbnailUrl || '').trim();
    if (!raw) return '';
    const relative = toRelativeMediaPath(raw);
    return String(relative || raw).trim();
}

/**
 * @param {import('../series/seriesTypes.js').Series[]} catalog
 */
export function listCatalogSeriesOptions(catalog) {
    /** @type {Array<{ id: string; title: string }>} */
    const items = [];
    for (const series of catalog || []) {
        const id = String(series?.id || '').trim();
        if (!id) continue;
        items.push({
            id,
            title: String(series?.title || id).trim() || id
        });
    }
    return items.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * @param {import('../series/seriesTypes.js').Series[]} catalog
 * @param {string} seriesId
 */
export function listSeasonOptionsForSeries(catalog, seriesId) {
    const sid = String(seriesId || '').trim();
    if (!sid) return [];
    const series = (catalog || []).find((row) => String(row?.id || '') === sid);
    /** @type {Array<{ seasonNumber: number; title: string; label: string }>} */
    const items = [];
    for (const season of series?.seasons || []) {
        const seasonNumber = Number(season?.seasonNumber);
        if (!Number.isFinite(seasonNumber) || seasonNumber < 1) continue;
        const title = String(season?.title || '').trim() || `Season ${seasonNumber}`;
        items.push({ seasonNumber, title, label: title });
    }
    return items.sort((a, b) => a.seasonNumber - b.seasonNumber);
}

/**
 * @param {import('../series/seriesTypes.js').Series[]} catalog
 * @param {string} seriesId
 * @param {number} seasonNumber
 */
export function listEpisodeOptionsForSeason(catalog, seriesId, seasonNumber) {
    const sid = String(seriesId || '').trim();
    const sn = Number(seasonNumber);
    if (!sid || !Number.isFinite(sn)) return [];
    const series = (catalog || []).find((row) => String(row?.id || '') === sid);
    const season = (series?.seasons || []).find((row) => Number(row?.seasonNumber) === sn);
    /** @type {Array<{
     *   episodeId: string;
     *   episodeNumber: number;
     *   title: string;
     *   reelId: string | null;
     *   thumbnailUrl: string;
     *   label: string;
     * }>} */
    const items = [];
    for (const episode of season?.episodes || []) {
        const episodeId = String(episode?.episodeId || '').trim();
        if (!episodeId) continue;
        const episodeNumber = Number(episode?.episodeNumber) || 0;
        const title = String(episode?.title || '').trim() || `Episode ${episodeNumber || '?'}`;
        items.push({
            episodeId,
            episodeNumber,
            title,
            reelId: episode?.reelId ? String(episode.reelId) : null,
            thumbnailUrl: String(episode?.thumbnailUrl || '').trim(),
            label: `E${String(episodeNumber).padStart(2, '0')} — ${title}`
        });
    }
    return items.sort((a, b) => a.episodeNumber - b.episodeNumber);
}
