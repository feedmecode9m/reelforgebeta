import { toRelativeMediaPath } from '../../lib/config.js';
import { resolveMediaUrl } from '../../lib/api/reelContract.js';
import { sanitizeGoogleDriveUrl, isValidVideoUrl } from '../../lib/runtime-guards.js';

/** @param {string | null | undefined} url */
export function isPassthroughMediaUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const t = url.trim();
    return t.startsWith('blob:') || t.startsWith('data:');
}

/**
 * Single render pipeline: path normalization → resolveMediaUrl → toBackendMediaUrl.
 *
 * @param {string | null | undefined} originalUrl
 * @param {'video' | 'thumbnail' | 'poster' | 'image' | 'media'} [type='thumbnail']
 * @param {string} [context='MediaRenderer']
 * @returns {string}
 */
export function resolveMediaForRender(originalUrl, type = 'thumbnail', context = 'MediaRenderer') {
    const original = originalUrl == null ? '' : String(originalUrl).trim();
    if (!original) return '';
    if (isPassthroughMediaUrl(original)) return original;

    const kind = type === 'video' ? 'video' : 'thumbnail';
    return resolveMediaUrl(original, kind, context);
}

/**
 * @deprecated Use resolveMediaForRender — kept for existing imports.
 */
export function resolveDisplayUrl(originalUrl, type = 'media', context = 'MediaRenderer') {
    const renderType = type === 'video' ? 'video' : type === 'media' ? 'thumbnail' : type;
    const resolved = resolveMediaForRender(originalUrl, renderType, context);
    if (import.meta.env.DEV) {
        const original = originalUrl == null ? '' : String(originalUrl).trim();
        console.debug('[MediaRenderer]', { type, originalUrl: original, resolvedUrl: resolved });
    }
    return resolved;
}

/**
 * Shelf/feed video src — validates URL then resolves through the render pipeline.
 * @param {string | null | undefined} url
 * @returns {string}
 */
export function resolveValidatedVideoUrl(url) {
    const sanitized = sanitizeGoogleDriveUrl(url);
    if (!isValidVideoUrl(sanitized)) {
        if (import.meta.env.DEV) {
            console.debug('[MediaRenderer]', { type: 'video', originalUrl: url, resolvedUrl: '' });
        }
        return '';
    }
    return resolveMediaForRender(sanitized, 'video', 'resolveValidatedVideoUrl');
}

/**
 * Poster background helper — terminates at toBackendMediaUrl via resolveMediaForRender.
 * @param {string | null | undefined} originalUrl
 * @param {'poster' | 'thumbnail'} [type='poster']
 */
export function resolvePosterBackgroundUrl(originalUrl, type = 'poster') {
    return resolveMediaForRender(originalUrl, type, 'resolvePosterBackgroundUrl');
}

/** @deprecated Alias — relative path helper for storage layer only. */
export function toRelativePosterPath(originalUrl) {
    const original = originalUrl == null ? '' : String(originalUrl).trim();
    if (!original) return '';
    const relative = toRelativeMediaPath(original);
    if (relative.startsWith('/thumbs/') || relative.startsWith('/videos/')) return relative;
    if (relative.startsWith('/')) return relative;
    return `/thumbs/${relative.replace(/^\/+/, '')}`;
}
