/**
 * Viewer-facing episode poster resolution for All Episodes / series shelves.
 *
 * Presentation only — does not change media binding, playback selection,
 * catalog authority, or vault persistence.
 *
 * Priority:
 *   1. Explicit chip / episode poster fields
 *   2. Ready vault asset fields keyed by mediaAssetId
 *   3. Deterministic product poster path `/thumbs/{mediaAssetId}.jpg` (viewer card only)
 */

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanUrl(value) {
    return String(value || '').trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function thumbOf(item) {
    if (!item || typeof item !== 'object') return '';
    const nested =
        item.episodeEnrichment && typeof item.episodeEnrichment === 'object'
            ? /** @type {Record<string, unknown>} */ (item.episodeEnrichment)
            : null;
    return cleanUrl(
        item.thumbnailUrl ||
            item.thumbnail_url ||
            item.thumbnail ||
            item.posterUrl ||
            item.poster_url ||
            item.poster ||
            item.artworkUrl ||
            nested?.artworkUrl
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function assetIdOf(item) {
    if (!item || typeof item !== 'object') return '';
    return cleanUrl(item.id || item.mediaAssetId || item.assetId || item.reelId);
}

/**
 * Deterministic viewer poster path from stable media id (product thumbnail convention).
 * @param {unknown} mediaAssetId
 * @returns {string}
 */
export function posterPathFromMediaAssetId(mediaAssetId) {
    const id = cleanUrl(mediaAssetId);
    if (!id || !UUID_RE.test(id)) return '';
    return `/thumbs/${id}.jpg`;
}

/**
 * Resolve the poster URL for a viewer episode card.
 *
 * @param {{
 *   episode?: import('./seriesTypes.js').Episode | Record<string, unknown> | null;
 *   chipThumbnailUrl?: string | null;
 *   readyVaultAssets?: Record<string, unknown>[];
 * }} [input]
 * @returns {string}
 */
export function resolveViewerEpisodePosterUrl(input = {}) {
    const episode = input.episode && typeof input.episode === 'object' ? input.episode : null;
    const chipThumb = cleanUrl(input.chipThumbnailUrl);
    if (chipThumb) return chipThumb;

    const epThumb = thumbOf(episode);
    if (epThumb) return epThumb;

    const mediaId = cleanUrl(
        episode?.mediaAssetId || episode?.reelId || episode?.heroVaultAssetId || ''
    );
    if (!mediaId) return '';

    const ready = Array.isArray(input.readyVaultAssets) ? input.readyVaultAssets : [];
    const bound = ready.find((asset) => assetIdOf(asset) === mediaId) || null;
    const fromVault = thumbOf(bound);
    if (fromVault) return fromVault;

    // Viewer-card only fallback: product serves `/thumbs/{mediaAssetId}.jpg` for ready reels.
    return posterPathFromMediaAssetId(mediaId);
}
