/**
 * Viewer-facing episode poster resolution for All Episodes / series shelves.
 *
 * Presentation only — does not change media binding, playback selection,
 * catalog authority, or vault persistence.
 *
 * Priority:
 *   1. Explicit chip / episode poster fields (absolute API thumbs pass through)
 *   2. Ready vault / catalog inventory fields keyed by mediaAssetId
 *      (thumbnailUrl, thumbnailPath, image-type url with correct extension)
 *   3. Last-resort product identity path only when a real path cannot be found
 *
 * Final URLs always pass through resolveMediaUrl so:
 *   - absolute production thumbs stay absolute (never `/thumbs/https://…`)
 *   - relative `/thumbs/*` joins the media origin when configured
 *   - double-prefixed corruption is peeled before resolve
 */

import { resolveMediaUrl } from '../api/reelContract.js';

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(\?|$)/i;

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanUrl(value) {
    return String(value || '').trim();
}

/**
 * Peel accidental `/thumbs/https://host/thumbs/file.ext` corruption back to a loadable URL.
 * Production browsers showed this exact DOM src (404) when absolute API thumbs were re-prefixed.
 * @param {string} raw
 * @returns {string}
 */
export function repairDoublePrefixedMediaUrl(raw) {
    const trimmed = cleanUrl(raw);
    if (!trimmed) return '';

    // `/thumbs/https://host/...` or `/videos/https://host/...`
    const nakedAbs = trimmed.match(/^\/(?:thumbs|videos)\/(https?:\/\/.+)$/i);
    if (nakedAbs) return cleanUrl(nakedAbs[1]);

    // `/thumbs/http://host/thumbs/file.ext` → `/thumbs/file.ext`
    const embedded = trimmed.match(/^\/(thumbs|videos)\/https?:\/\/[^/]+\/(thumbs|videos)\/(.+)$/i);
    if (embedded) return `/${embedded[2]}/${embedded[3]}`;

    return trimmed;
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
    const explicit = cleanUrl(
        item.thumbnailUrl ||
            item.thumbnail_url ||
            item.thumbnailPath ||
            item.thumbnail_path ||
            item.thumbnail ||
            item.posterUrl ||
            item.poster_url ||
            item.poster ||
            item.artworkUrl ||
            nested?.artworkUrl
    );
    if (explicit) return explicit;

    // Image reels often only set `url` to the real /thumbs/{id}.png (never invent .jpg).
    const primary = cleanUrl(item.url || item.mediaUrl || item.src || '');
    const type = cleanUrl(item.type).toLowerCase();
    if (
        primary &&
        (type === 'image' ||
            type.startsWith('image/') ||
            IMAGE_EXT_RE.test(primary) ||
            primary.includes('/thumbs/'))
    ) {
        return primary;
    }
    return '';
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function assetIdOf(item) {
    if (!item || typeof item !== 'object') return '';
    return cleanUrl(item.id || item.mediaAssetId || item.assetId || item.reelId);
}

/**
 * @param {string} raw
 * @returns {string}
 */
function finalizePosterUrl(raw) {
    const trimmed = repairDoublePrefixedMediaUrl(raw);
    if (!trimmed) return '';
    return resolveMediaUrl(trimmed, 'thumbnail', 'viewerEpisodePoster') || '';
}

/**
 * Relative poster path for a stable media id.
 * Prefer a proven extension from a known thumb URL; last-resort `.jpg` keeps
 * cold-load catalog UUID cards (STIRRED) working when inventory is empty.
 * Never invent over an already-known absolute/relative art URL — callers must
 * pass those through finalizePosterUrl first.
 *
 * @param {unknown} mediaAssetId
 * @param {string} [knownThumbHint] absolute/relative thumb with a real extension
 * @returns {string}
 */
export function posterPathFromMediaAssetId(mediaAssetId, knownThumbHint = '') {
    const id = cleanUrl(mediaAssetId);
    if (!id || !UUID_RE.test(id)) return '';

    const hint = cleanUrl(knownThumbHint);
    const fromHint = hint.match(IMAGE_EXT_RE);
    if (fromHint) {
        const file = hint.split('/').pop()?.split('?')[0] || '';
        if (file && file.toLowerCase().includes(id.toLowerCase())) {
            return `/thumbs/${file}`;
        }
        const ext = fromHint[1].toLowerCase().replace('jpeg', 'jpg');
        return `/thumbs/${id}.${ext}`;
    }
    // Last resort only — many production reels use .png; prefer inventory when available.
    return `/thumbs/${id}.jpg`;
}

/**
 * Resolve the poster URL for a viewer episode card (browser-loadable).
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
    if (chipThumb) return finalizePosterUrl(chipThumb);

    const epThumb = thumbOf(episode);
    if (epThumb) return finalizePosterUrl(epThumb);

    const mediaId = cleanUrl(
        episode?.mediaAssetId || episode?.reelId || episode?.heroVaultAssetId || ''
    );
    if (!mediaId) return '';

    const ready = Array.isArray(input.readyVaultAssets) ? input.readyVaultAssets : [];
    const bound = ready.find((asset) => assetIdOf(asset) === mediaId) || null;
    const fromVault = thumbOf(bound);
    if (fromVault) return finalizePosterUrl(fromVault);

    // Only invent identity path when no real inventory art exists for this media id.
    return finalizePosterUrl(posterPathFromMediaAssetId(mediaId));
}
