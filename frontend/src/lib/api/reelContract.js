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
import { reelResEntry, reelResExit, reelResNormalizeBranch, reelResReelSnapshot } from '../diagnostics/reelResolutionTrace.js';
import { logBg7kCardNormalize } from '../diagnostics/bg7kCardRenderTrace.js';

const REEL_TYPES = new Set(['video', 'image', 'thumbnail']);
const VIDEO_FILE_EXT = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i;
const DEV = import.meta.env.DEV;

/**
 * Detect playable video from filename, URL, or MIME — independent of backend type label.
 * @param {Record<string, unknown> | null | undefined} raw
 */
function isPlayableVideoSignal(raw) {
    if (!raw || typeof raw !== 'object') return false;
    const mime = String(
        raw.mimeType || raw.mime_type || raw.contentType || raw.content_type || ''
    ).toLowerCase();
    const declaredType = String(raw.type || '').toLowerCase();
    if (mime.startsWith('video/') || declaredType.startsWith('video/')) return true;

    const fileName = String(raw.fileName || raw.file_name || '').trim();
    if (fileName && VIDEO_FILE_EXT.test(fileName)) return true;

    const url = String(
        raw.url || raw.video_url || raw.videoUrl || raw.videoPath || raw.video_path || raw.src || ''
    ).trim();
    if (!url) return false;
    if (VIDEO_FILE_EXT.test(url)) return true;
    if (url.includes('/prod/') && VIDEO_FILE_EXT.test(url.split('?')[0])) return true;
    return false;
}

/**
 * @param {Record<string, unknown>} raw
 */
function resolveVideoRepairReason(raw) {
    const fileName = String(raw.fileName || raw.file_name || '').trim();
    if (fileName && VIDEO_FILE_EXT.test(fileName)) return 'video_filename_extension';
    const url = String(raw.url || raw.video_url || raw.videoUrl || '').trim();
    if (url.includes('/prod/') && VIDEO_FILE_EXT.test(url.split('?')[0])) return 'r2_prod_video_url';
    if (url && VIDEO_FILE_EXT.test(url)) return 'video_url_extension';
    const mime = String(raw.mimeType || raw.mime_type || raw.contentType || '').toLowerCase();
    if (mime.startsWith('video/')) return 'video_mime';
    if (String(raw.type || '').toLowerCase().startsWith('video/')) return 'video_type_mime';
    return 'video_signal';
}

/**
 * Override incorrect backend/catalog type labels for playable video assets.
 * @param {Record<string, unknown>} raw
 * @param {ReelType | string} inferredType
 * @returns {ReelType}
 */
function repairPrimaryMediaType(raw, inferredType) {
    if (inferredType === 'video' || !isPlayableVideoSignal(raw)) {
        return /** @type {ReelType} */ (inferredType);
    }
    const afterType = /** @type {ReelType} */ ('video');
    console.log('[MEDIA_TYPE_REPAIR]', {
        id: String(raw.id || ''),
        beforeType: inferredType,
        afterType,
        reason: resolveVideoRepairReason(raw)
    });
    return afterType;
}

/**
 * Canonical primary media type for any reel-like object (feed cards, vault, API).
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {ReelType}
 */
export function ensurePrimaryMediaType(reel) {
    if (!reel || typeof reel !== 'object') return 'thumbnail';
    return repairPrimaryMediaType(reel, inferMediaType(reel));
}

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

    // Absolute http(s) — never rewrite to relative /videos (breaks cross-host hero media).
    if (/^https?:\/\//i.test(trimmed)) {
        logResolvedMediaUrl(kind, trimmed, trimmed, `${context}:absolute_passthrough`);
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
        if (
            VIDEO_FILE_EXT.test(url) ||
            url.includes('/videos/') ||
            (url.includes('/prod/') && VIDEO_FILE_EXT.test(url.split('?')[0]))
        ) {
            return 'video';
        }
        if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) || url.includes('/thumbs/')) {
            return 'image';
        }
        return 'thumbnail';
    }
    const raw = reelOrUrl;
    if (isPlayableVideoSignal(raw)) {
        const declared =
            raw?.type && REEL_TYPES.has(String(raw.type)) ? String(raw.type) : '';
        if (declared && declared !== 'video') {
            console.log('[MEDIA_TYPE_REPAIR]', {
                id: String(raw.id || ''),
                beforeType: declared,
                afterType: 'video',
                reason: resolveVideoRepairReason(raw)
            });
        }
        return 'video';
    }
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
 * @param {ReelType} [resolvedType]
 * @returns {ReelV1 & Record<string, unknown>}
 */
function fromLegacy(raw, resolvedType) {
    const type = resolvedType ?? repairPrimaryMediaType(raw, inferMediaType(raw));
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
    const t0 = performance.now();
    reelResEntry('normalizeReel', { endpoint, rawType: typeof raw });
    if (!raw || typeof raw !== 'object') {
        reelResNormalizeBranch('early_return_null_not_object', { endpoint });
        reelResExit('normalizeReel', t0, { endpoint, result: null, reason: 'not_object' });
        return null;
    }

    const thumbRaw =
        raw.thumbnailUrl ?? raw.thumbnail_url ?? raw.thumbnailPath ?? raw.thumbnail_path;
    const type = repairPrimaryMediaType(raw, inferMediaType(raw));
    const useDirectContract = Boolean(raw.url && (raw.name || raw.title));
    reelResNormalizeBranch(useDirectContract ? 'direct_contract_path' : 'fromLegacy_path', {
        endpoint,
        hasUrl: Boolean(raw.url),
        hasName: Boolean(raw.name || raw.title),
        inferredType: type
    });
    const contract =
        useDirectContract
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
            : fromLegacy(raw, type);

    const status = contract.status;

    const merged = {
        ...raw,
        ...contract,
        title: contract.name,
        category: contract.category,
        created_at: contract.createdAt,
        status,
        type: ensurePrimaryMediaType({ ...raw, ...contract })
    };

    const isReadyCatalog =
        endpoint.includes('GET /api/reels') || endpoint === 'WS CREATED';
    if (
        status !== 'ready' &&
        !raw.isPlaceholder &&
        endpoint !== 'ingest-poll' &&
        !isReadyCatalog
    ) {
        reelResNormalizeBranch('early_return_null_status_gate', {
            endpoint,
            status,
            isPlaceholder: Boolean(raw.isPlaceholder)
        });
        reelResExit('normalizeReel', t0, { endpoint, result: null, reason: 'status_gate' });
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
    reelResReelSnapshot('normalizeReel:result', merged, {
        endpoint,
        urlEmpty: !merged.url,
        thumbnailEmpty: merged.thumbnailUrl === '' || merged.thumbnailUrl == null,
        idMissing: !merged.id
    });
    const originalUrl = String(
        raw.url ?? raw.video_url ?? raw.videoUrl ?? raw.videoPath ?? raw.src ?? ''
    );
    logBg7kCardNormalize(
        String(merged.id || ''),
        originalUrl,
        String(merged.url || ''),
        String(merged.thumbnailUrl || ''),
        endpoint
    );
    reelResExit('normalizeReel', t0, {
        endpoint,
        id: merged.id,
        url: merged.url,
        thumbnailUrl: merged.thumbnailUrl,
        status: merged.status,
        category: merged.category
    });
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
