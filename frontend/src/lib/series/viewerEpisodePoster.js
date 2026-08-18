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
import { mediaPathAssetId } from '../content/persistentTitleMap.js';
import { isVaultVideoMediaUrl } from '../vault/normalizeVaultAsset.js';

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(\?|$)/i;
const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i;

/**
 * @param {string} raw
 * @returns {boolean}
 */
function isUsableEpisodePosterUrl(raw) {
    const trimmed = cleanUrl(raw);
    if (!trimmed) return false;
    if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return false;
    if (isVaultVideoMediaUrl(trimmed) || VIDEO_EXT_RE.test(trimmed)) return false;
    if (/\/videos\//i.test(trimmed) && !IMAGE_EXT_RE.test(trimmed) && !/\/thumbs\//i.test(trimmed)) {
        return false;
    }
    return true;
}

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
 * Catalog reel id, vault id, and R2 /prod/{uuid}.mp4 stem for the same file.
 * @param {Record<string, unknown> | null | undefined} episode
 * @param {string} [primaryId]
 * @returns {string[]}
 */
function posterLookupIds(episode, primaryId = '') {
    const seen = new Set();
    /** @type {string[]} */
    const out = [];
    const push = (value) => {
        const id = cleanUrl(value);
        if (!id || seen.has(id.toLowerCase())) return;
        seen.add(id.toLowerCase());
        out.push(id);
    };
    push(primaryId);
    if (episode && typeof episode === 'object') {
        push(episode.mediaAssetId);
        push(episode.reelId);
        push(episode.heroVaultAssetId);
        push(episode.id);
        push(
            mediaPathAssetId({
                ...episode,
                url: episode.mediaUrl || episode.url || episode.src,
                mediaUrl: episode.mediaUrl || episode.url || episode.src
            })
        );
    }
    return out;
}

/**
 * @param {Record<string, unknown>[]} ready
 * @param {string | string[]} mediaIds
 * @returns {string}
 */
function stillFromReadyVault(ready, mediaIds) {
    const ids = (Array.isArray(mediaIds) ? mediaIds : [mediaIds])
        .map((value) => cleanUrl(value))
        .filter(Boolean);
    if (!ids.length) return '';
    const items = Array.isArray(ready) ? ready : [];
    const idSet = new Set(ids.map((id) => id.toLowerCase()));

    for (const id of ids) {
        const bound = items.find((asset) => assetIdOf(asset) === id) || null;
        const boundThumb = thumbOf(bound);
        if (isUsableEpisodePosterUrl(boundThumb)) return boundThumb;
    }

    for (const item of items) {
        const itemId = assetIdOf(item);
        const thumb = thumbOf(item);
        const primary = cleanUrl(item?.url || item?.mediaUrl || item?.src || '');
        const playbackId = mediaPathAssetId({
            ...item,
            url: primary,
            mediaUrl: primary
        });
        const candidate = isUsableEpisodePosterUrl(thumb)
            ? thumb
            : isUsableEpisodePosterUrl(primary)
              ? primary
              : '';
        if (!candidate) continue;
        const linkedId = cleanUrl(item?.personal_video_id || item?.videoId || item?.video_id);
        if (
            idSet.has(itemId.toLowerCase()) ||
            (linkedId && idSet.has(linkedId.toLowerCase())) ||
            (playbackId && idSet.has(playbackId.toLowerCase())) ||
            ids.some(
                (id) =>
                    candidate.toLowerCase().includes(id.toLowerCase()) ||
                    primary.toLowerCase().includes(id.toLowerCase())
            )
        ) {
            return candidate;
        }
    }
    return '';
}

/**
 * @param {string} mediaId
 * @returns {string}
 */
function stillFromPersonalThumbnails(mediaIds) {
    const ids = (Array.isArray(mediaIds) ? mediaIds : [mediaIds])
        .map((value) => cleanUrl(value))
        .filter(Boolean);
    if (!ids.length || typeof localStorage === 'undefined') return '';
    try {
        const parsed = JSON.parse(localStorage.getItem('personal_thumbnails') || '[]');
        if (!Array.isArray(parsed)) return '';
        const idSet = new Set(ids.map((id) => id.toLowerCase()));
        for (const row of parsed) {
            if (!row) continue;
            if (typeof row === 'string') {
                const raw = cleanUrl(row);
                if (
                    isUsableEpisodePosterUrl(raw) &&
                    ids.some((id) => raw.toLowerCase().includes(id.toLowerCase()))
                ) {
                    return raw;
                }
                continue;
            }
            const pid = cleanUrl(row.personal_video_id || row.videoId);
            const rid = cleanUrl(row.id || row.assetId);
            const url = cleanUrl(row.url || row.thumbnailUrl || row.thumbnail);
            const pathId = mediaPathAssetId({ ...row, url, mediaUrl: url });
            if (
                !idSet.has(pid.toLowerCase()) &&
                !idSet.has(rid.toLowerCase()) &&
                !(pathId && idSet.has(pathId.toLowerCase())) &&
                !ids.some((id) => url.toLowerCase().includes(id.toLowerCase()))
            ) {
                continue;
            }
            if (isUsableEpisodePosterUrl(url)) return url;
        }
    } catch {
        /* ignore */
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
    const ready = Array.isArray(input.readyVaultAssets) ? input.readyVaultAssets : [];
    const mediaId = cleanUrl(
        episode?.mediaAssetId || episode?.reelId || episode?.heroVaultAssetId || ''
    );
    const lookupIds = posterLookupIds(episode, mediaId);
    // Prefer R2 /prod/{uuid} (catalog thumb path) over a vault-only personal id.
    const playbackId = episode
        ? mediaPathAssetId({
              ...episode,
              url: episode.mediaUrl || episode.url || episode.src,
              mediaUrl: episode.mediaUrl || episode.url || episode.src
          })
        : '';
    const inventId = cleanUrl(playbackId) || mediaId || lookupIds[0] || '';

    const chipThumb = cleanUrl(input.chipThumbnailUrl);
    if (isUsableEpisodePosterUrl(chipThumb)) return finalizePosterUrl(chipThumb);

    const epThumb = thumbOf(episode);
    if (isUsableEpisodePosterUrl(epThumb)) return finalizePosterUrl(epThumb);

    if (!lookupIds.length) return '';

    const fromPool = stillFromReadyVault(ready, lookupIds);
    if (fromPool) return finalizePosterUrl(fromPool);

    const fromThumbsVault = stillFromPersonalThumbnails(lookupIds);
    if (fromThumbsVault) return finalizePosterUrl(fromThumbsVault);

    for (const id of lookupIds) {
        const bound = ready.find((asset) => assetIdOf(asset) === id) || null;
        const fromVault = thumbOf(bound);
        if (isUsableEpisodePosterUrl(fromVault)) return finalizePosterUrl(fromVault);
    }

    // Only invent identity path when no real inventory art exists for this media id.
    return finalizePosterUrl(
        posterPathFromMediaAssetId(inventId, fromPool || fromThumbsVault || epThumb)
    );
}
