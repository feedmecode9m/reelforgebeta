/**
 * ReelForge Media Contract v1 — single source of truth for reel payloads.
 * Mirrors docs/MEDIA_CONTRACT_v1.md (ReelV1).
 *
 * @typedef {'video' | 'image' | 'thumbnail'} ReelType
 *
 * @typedef {Object} ReelV1
 * @property {string} id
 * @property {string} name - Display title (DB title)
 * @property {string} fileName - Disk basename under public/videos or public/thumbs
 * @property {ReelType} type - Primary media kind
 * @property {string} url - Absolute primary media URL
 * @property {string} [thumbnailUrl] - Absolute preview image
 * @property {string} category
 * @property {'pending' | 'processing' | 'ready' | 'failed'} status
 * @property {string} createdAt - ISO 8601 timestamp
 */

import { toBackendMediaUrl, logResolvedMediaUrl, toRelativeMediaPath } from '../config.js';

const REEL_TYPES = new Set(['video', 'image', 'thumbnail']);
const DEV = import.meta.env.DEV;

/**
 * Resolve relative media paths to backend origin URLs (sole public resolver).
 * @param {string | null | undefined} url
 * @param {'video' | 'thumbnail' | 'media'} [kind='media']
 * @returns {string}
 */
export function resolveMediaUrl(url, kind = 'media', context = kind) {
    if (!url || typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
        logResolvedMediaUrl(kind, trimmed, trimmed, context);
        return trimmed;
    }

    const relative = toRelativeMediaPath(trimmed);
    if (relative.startsWith('blob:') || relative.startsWith('data:')) {
        logResolvedMediaUrl(kind, relative, trimmed, context);
        return relative;
    }

    let path = relative;
    if (!relative.startsWith('/thumbs/') && !relative.startsWith('/videos/')) {
        if (/\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(relative)) {
            path = `/videos/${relative.replace(/^\/+/, '')}`;
        } else if (relative.startsWith('/')) {
            path = relative;
        } else {
            path = `/thumbs/${relative.replace(/^\/+/, '')}`;
        }
    }

    const resolved = toBackendMediaUrl(path);
    logResolvedMediaUrl(kind, resolved, trimmed, context);
    return resolved;
}

/**
 * @param {Record<string, unknown> | string} reelOrUrl
 * @returns {ReelType}
 */
export function inferMediaType(reelOrUrl) {
    if (typeof reelOrUrl === 'string') {
        const url = reelOrUrl;
        if (/\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(url) || url.includes('/videos/')) {
            return 'video';
        }
        if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) || url.includes('/thumbs/')) {
            return 'image';
        }
        return 'thumbnail';
    }
    const raw = reelOrUrl;
    if (raw?.type && REEL_TYPES.has(String(raw.type))) return /** @type {ReelType} */ (raw.type);
    return inferMediaType(String(raw?.url || raw?.video_url || raw?.thumbnail_url || ''));
}

/** @param {Record<string, unknown> | null | undefined} reel */
export function isVideoReel(reel) {
    if (!reel) return false;
    const url = String(reel.url || reel.video_url || '').trim();
    if (url.includes('/videos/') || /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(url)) {
        return true;
    }
    const type = inferMediaType(reel);
    return type === 'video' || String(reel.type || '').startsWith('video/');
}

/** @param {Record<string, unknown> | null | undefined} reel */
export function isImageReel(reel) {
    if (!reel) return false;
    if (isVideoReel(reel)) return false;
    const type = inferMediaType(reel);
    return type === 'image' || type === 'thumbnail' || Boolean(reel.url);
}

/** @param {string | null | undefined} url */
function fileNameFromUrl(url) {
    if (!url) return '';
    return String(url).split('/').pop()?.split('?')[0] || '';
}

/**
 * Map legacy backend payloads to the Reel contract (Option C safety net).
 * @param {Record<string, unknown>} raw
 * @returns {ReelV1 & Record<string, unknown>}
 */
function fromLegacy(raw) {
    const type = inferMediaType(raw);
    const thumbLegacy =
        raw.thumbnailUrl ??
        raw.thumbnail_url ??
        raw.thumbnailPath ??
        raw.thumbnail_path ??
        raw.previewUrl ??
        '';
    const videoLegacy =
        raw.url ??
        raw.video_url ??
        raw.videoUrl ??
        raw.videoPath ??
        raw.video_path ??
        raw.src ??
        '';

    let url = '';
    let thumbnailUrl = '';

    if (type === 'video') {
        url = resolveMediaUrl(String(videoLegacy || thumbLegacy), 'video');
        thumbnailUrl = resolveMediaUrl(String(thumbLegacy || videoLegacy), 'thumbnail');
    } else {
        url = resolveMediaUrl(String(thumbLegacy || videoLegacy), 'thumbnail');
        thumbnailUrl = url;
    }

    const fileName = String(
        raw.fileName ?? raw.file_name ?? fileNameFromUrl(videoLegacy || thumbLegacy)
    );

    return {
        id: String(raw.id ?? crypto.randomUUID()),
        name: String(raw.name ?? raw.title ?? raw.filename ?? 'Untitled'),
        fileName,
        type,
        url,
        thumbnailUrl,
        category: String(raw.category ?? 'Trending'),
        status: String(raw.status ?? 'ready'),
        createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString())
    };
}

/**
 * Normalize any API/local payload into a ReelV1 contract object.
 * Preserves UI extension fields (category, isPlaceholder, likes, etc.).
 *
 * @param {Record<string, unknown> | null | undefined} raw
 * @param {string} [endpoint='unknown']
 * @returns {Record<string, unknown> | null}
 */
export function normalizeReel(raw, endpoint = 'unknown') {
    if (!raw || typeof raw !== 'object') return null;

    const thumbRaw =
        raw.thumbnailUrl ?? raw.thumbnail_url ?? raw.thumbnailPath ?? raw.thumbnail_path;
    const type = inferMediaType(raw);
    const contract =
        raw.url && (raw.name || raw.title)
            ? {
                  id: String(raw.id),
                  name: String(raw.name ?? raw.title ?? 'Untitled'),
                  fileName: String(
                      raw.fileName ??
                          raw.file_name ??
                          fileNameFromUrl(raw.url ?? raw.video_url)
                  ),
                  type,
                  url: resolveMediaUrl(String(raw.url), type === 'video' ? 'video' : 'media'),
                  thumbnailUrl:
                      thumbRaw != null && String(thumbRaw).trim() !== ''
                          ? resolveMediaUrl(String(thumbRaw), 'thumbnail')
                          : type === 'image'
                            ? resolveMediaUrl(String(raw.url), 'thumbnail')
                            : '',
                  category: String(raw.category ?? 'Trending'),
                  status: String(raw.status ?? 'ready'),
                  createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString())
              }
            : fromLegacy(raw);

    const status = contract.status;

    const merged = {
        ...raw,
        ...contract,
        title: contract.name,
        category: contract.category,
        created_at: contract.createdAt,
        status
    };

    const isReadyCatalog =
        endpoint.includes('GET /api/reels') || endpoint === 'WS CREATED';
    if (
        status !== 'ready' &&
        !raw.isPlaceholder &&
        endpoint !== 'ingest-poll' &&
        !isReadyCatalog
    ) {
        return null;
    }

    if (
        endpoint !== 'POST /api/media/upload' &&
        endpoint !== 'POST /api/reels' &&
        endpoint !== 'POST /api/thumbs/upload' &&
        endpoint !== 'POST /api/videos/upload'
    ) {
        assertReelContract(merged, endpoint);
    }
    return merged;
}

/**
 * @param {unknown[]} items
 * @param {string} [endpoint='unknown']
 * @returns {Record<string, unknown>[]}
 */
export function normalizeReels(items, endpoint = 'unknown') {
    if (!Array.isArray(items)) return [];
    return items.map((item) => normalizeReel(item, endpoint)).filter(Boolean);
}

/**
 * @param {Record<string, unknown>} reel
 * @returns {true}
 */
export function validateReel(reel) {
    const errors = [];
    if (!reel?.id) errors.push("missing 'id'");
    if (!reel?.name) errors.push("missing 'name'");
    if (!reel?.type || !REEL_TYPES.has(reel.type)) errors.push("missing or invalid 'type'");
    if (!reel?.url) errors.push("missing 'url'");
    if (
        (reel?.thumbnailUrl === undefined || reel?.thumbnailUrl === null) &&
        reel?.type !== 'video'
    ) {
        errors.push("missing 'thumbnailUrl'");
    }
    if (!reel?.createdAt) errors.push("missing 'createdAt'");

    if (errors.length) {
        throw new Error(`Invalid Reel contract: ${errors.join(', ')}`);
    }
    return true;
}

/**
 * Dev-only runtime guard for API drift.
 * @param {Record<string, unknown>} reel
 * @param {string} endpoint
 */
export function assertReelContract(reel, endpoint) {
    if (!DEV || !reel || reel.isPlaceholder) return;
    try {
        validateReel(reel);
    } catch (error) {
        console.error(
            `[API Contract Violation] ${endpoint} returned reel missing required fields. ${error.message}`,
            { raw: reel }
        );
    }
}

/**
 * Build a local-only reel (placeholders, offline vault) that satisfies the contract.
 * @param {Record<string, unknown>} partial
 * @returns {Record<string, unknown>}
 */
export function createLocalReel(partial = {}) {
    return normalizeReel(
        {
            id: partial.id ?? crypto.randomUUID(),
            name: partial.name ?? partial.title ?? 'Untitled',
            fileName: partial.fileName ?? partial.file_name ?? fileNameFromUrl(partial.url),
            type: partial.type ?? 'image',
            url: partial.url ?? partial.thumbnailUrl ?? '',
            thumbnailUrl: partial.thumbnailUrl ?? partial.url ?? '',
            createdAt: partial.createdAt ?? partial.created_at ?? new Date().toISOString(),
            ...partial
        },
        'local'
    );
}

/**
 * Video vault entry from a normalized reel (display name from reel.name, disk ops from fileName).
 * @param {Record<string, unknown>} reel
 * @returns {Record<string, unknown>}
 */
export function reelToVaultEntry(reel) {
    const fileName =
        String(reel.fileName || reel.file_name || fileNameFromUrl(reel.url)).trim() ||
        'Untitled';
    const name = String(reel.name || reel.title || 'Untitled');
    return {
        id: String(reel.id || `reel_${fileName}`),
        name,
        fileName,
        url: resolveMediaUrl(String(reel.url || ''), 'video'),
        thumbnail: reel.thumbnailUrl ? resolveMediaUrl(String(reel.thumbnailUrl), 'thumbnail') : '',
        type: fileName.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4',
        addedAt: reel.createdAt || reel.created_at || new Date().toISOString()
    };
}

/** @deprecated Use isVideoReel */
export function hasPlayableVideo(reel) {
    return isVideoReel(reel);
}

/** @deprecated Use isImageReel */
export function hasDisplayableImage(reel) {
    return isImageReel(reel);
}
