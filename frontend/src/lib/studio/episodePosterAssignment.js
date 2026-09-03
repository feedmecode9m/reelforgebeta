/**
 * Thumbnail Vault → canonical episode poster assignment helpers.
 *
 * Poster authority: Episode.thumbnailUrl / episodes.thumbnail_url (URL-only V1).
 * Does not mutate reelId, mediaAssetId, or episodeId.
 */

import { toRelativeMediaPath } from '../config.js';

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
