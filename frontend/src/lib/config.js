const BACKEND_PORT =
    import.meta.env.VITE_BACKEND_PORT ||
    import.meta.env.BACKEND_PORT ||
    '8080';

import { pipelineDiag } from './diagnostics/pipelineDiag.js';

function isLoopbackOrigin(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url);
        const host = String(parsed.hostname || '').toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
    } catch {
        return false;
    }
}

function sanitizeExternalBaseUrl(url, contextLabel) {
    const normalized = String(url || '').trim().replace(/\/$/, '');
    if (!normalized) return '';
    if (import.meta.env.PROD && isLoopbackOrigin(normalized)) {
        console.warn(
            `[ReelForge] Ignoring ${contextLabel}="${normalized}" in preview/production build (loopback origin is unreachable for remote testers).`
        );
        return '';
    }
    return normalized;
}

function devAllowsRemoteBackendOrigin() {
    // Default-dev invariant: never mix local REST proxy + remote websocket/media origins.
    // Opt-in escape hatch for developers testing against remote backends while running `npm run dev`.
    return import.meta.env.VITE_USE_CONFIGURED_API_URL_IN_DEV === 'true';
}

function resolveConfiguredApiUrl() {
    const candidates = [
        ['VITE_API_URL', import.meta.env.VITE_API_URL],
        ['VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL],
        ['VITE_BACKEND_URL', import.meta.env.VITE_BACKEND_URL]
    ];
    for (const [label, value] of candidates) {
        const sanitized = sanitizeExternalBaseUrl(value, label);
        if (import.meta.env.DEV && sanitized && !devAllowsRemoteBackendOrigin() && !isLoopbackOrigin(sanitized)) {
            // In dev, ignore remote origins unless explicitly opted-in.
            continue;
        }
        if (sanitized) return sanitized;
    }
    return '';
}

/** Netlify static hosts must use same-origin /api (see public/_redirects). */
function isNetlifyStaticHost() {
    if (typeof window === 'undefined') return false;
    const host = window.location.hostname.toLowerCase();
    return host.endsWith('.netlify.app') || host.endsWith('.netlify.live');
}

function shouldUseSameOriginApi() {
    if (import.meta.env.VITE_USE_SAME_ORIGIN_API === 'true') return true;
    // Drop/manual deploys may omit build env; never call Railway directly from the browser on Netlify.
    if (import.meta.env.PROD && isNetlifyStaticHost()) return true;
    return false;
}

function resolveBackendUrl() {
    if (shouldUseSameOriginApi()) {
        return '';
    }
    const configured = resolveConfiguredApiUrl();
    if (configured) return configured;
    if (import.meta.env.DEV) {
        return `http://localhost:${BACKEND_PORT}`;
    }
    if (import.meta.env.PROD) {
        console.error(
            '[ReelForge] VITE_API_URL (or VITE_BACKEND_URL) is required for production builds. Media URLs will be wrong.'
        );
    }
    return '';
}

/** When true, production uses same-origin /api and /videos (Netlify _redirects proxy). */
export const USE_SAME_ORIGIN_API = shouldUseSameOriginApi();

/** Origin for static media (/videos, /thumbs). */
export const BACKEND_URL = resolveBackendUrl();

/** Optional dedicated media origin for preview/production sharing. */
export const ASSET_BASE_URL = sanitizeExternalBaseUrl(
    import.meta.env.VITE_ASSET_BASE_URL || BACKEND_URL,
    'VITE_ASSET_BASE_URL'
);

export const DEFAULT_MEDIA_PLACEHOLDER = '/placeholders/media-fallback.svg';
export const DEFAULT_AVATAR_PLACEHOLDER = '/placeholders/avatar-fallback.svg';
console.info('[ASSET_RESOLUTION_HOTFIX_APPLIED]', {
    staticAssetsMovedToPublic: true,
    dynamicBaseUrlConfigured: true,
    fallbackImagesImplemented: true
});

/**
 * Base URL for API fetch calls.
 * Empty string uses same-origin /api (Vite proxy in dev, Netlify _redirects in prod).
 */
function resolveApiBaseUrl() {
    if (shouldUseSameOriginApi()) return '';
    if (import.meta.env.DEV && import.meta.env.VITE_FORCE_DIRECT_BACKEND_API !== 'true') {
        return '';
    }
    const configured = resolveConfiguredApiUrl() || BACKEND_URL;
    // Mission 3 root cause: prod builds must never POST to localhost from remote browsers.
    if (import.meta.env.PROD && (!configured || isLoopbackOrigin(configured))) {
        return '';
    }
    return configured;
}

export const API_BASE_URL = resolveApiBaseUrl();

/** Feature flag: enable signed direct-to-storage uploads for large media. */
export const USE_SIGNED_UPLOADS =
    import.meta.env.VITE_USE_SIGNED_UPLOADS === 'true' ||
    (import.meta.env.PROD &&
        isNetlifyStaticHost() &&
        import.meta.env.VITE_USE_SIGNED_UPLOADS !== 'false');

/** Minimum size (bytes) to use signed upload flow when enabled. */
export const SIGNED_UPLOADS_MIN_BYTES = Number.parseInt(
    import.meta.env.VITE_SIGNED_UPLOADS_MIN_BYTES || '',
    10
) || 25_000_000;

/** Direct Railway origin for large PUT uploads (bypasses Netlify multipart proxy). */
function resolveDirectUploadBaseUrl() {
    const candidates = [
        import.meta.env.VITE_DIRECT_UPLOAD_BASE_URL,
        import.meta.env.VITE_BACKEND_URL,
        import.meta.env.VITE_API_URL
    ];
    for (const value of candidates) {
        const sanitized = sanitizeExternalBaseUrl(value, 'VITE_DIRECT_UPLOAD_BASE_URL');
        if (sanitized) return sanitized;
    }
    if (import.meta.env.DEV) {
        return `http://localhost:${BACKEND_PORT}`;
    }
    return 'https://reelforge-deploy-production.up.railway.app';
}

export const DIRECT_UPLOAD_BASE_URL = resolveDirectUploadBaseUrl();

pipelineDiag('ROUTER', 'resolveApiBaseUrl', 'config.js', {
    result: API_BASE_URL || 'same-origin',
    detail: {
        sameOrigin: USE_SAME_ORIGIN_API,
        backendUrl: BACKEND_URL || '(same-origin-relative-media)'
    }
});

console.info('[API_ROUTING]', {
    sameOrigin: USE_SAME_ORIGIN_API,
    apiBase: API_BASE_URL || '(same-origin)',
    backendUrl: BACKEND_URL || '(same-origin-relative-media)'
});

/** Opt-in: use same-origin /videos via Vite proxy instead of direct backend URLs. */
const USE_VITE_MEDIA_PROXY = import.meta.env.VITE_USE_VITE_MEDIA_PROXY === 'true';

/**
 * Dev media routing mirrors resolveApiBaseUrl(): same-origin /thumbs and /videos via Vite proxy
 * unless VITE_FORCE_DIRECT_BACKEND_API=true or VITE_USE_VITE_MEDIA_PROXY is explicitly set false
 * with direct backend forced.
 */
function shouldUseSameOriginMediaInDev() {
    if (!import.meta.env.DEV) return false;
    if (USE_VITE_MEDIA_PROXY) return true;
    return import.meta.env.VITE_FORCE_DIRECT_BACKEND_API !== 'true';
}

function isMediaPath(pathname) {
    return pathname.startsWith('/videos/') || pathname.startsWith('/thumbs/');
}

/**
 * Strip backend origin (or fix double-prefix corruption) → `/videos/...` or `/thumbs/...`.
 * @param {string | null | undefined} path
 * @returns {string}
 */
export function toRelativeMediaPath(path) {
    if (!path || typeof path !== 'string') return '';
    let trimmed = path.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return trimmed;

    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const u = new URL(trimmed);
            // Keep third-party URLs (e.g. via.placeholder.com demo thumbnails) intact.
            if (!isMediaPath(u.pathname)) {
                return trimmed;
            }
            return u.pathname + u.search;
        } catch {
            return trimmed;
        }
    }

    // Repair `/thumbs/http://host/thumbs/file.jpg` corruption
    const embedded = trimmed.match(/^\/(thumbs|videos)\/https?:\/\/[^/]+\/(thumbs|videos)\/(.+)$/i);
    if (embedded) {
        return `/${embedded[2]}/${embedded[3]}`;
    }

    return trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
}

/**
 * Normalize any media path to a browser-loadable URL.
 * Default: full backend origin (http://localhost:8080/...) so media never hits Vite :5173.
 * Idempotent — safe to call on already-resolved absolute URLs.
 * @param {string | null | undefined} path
 * @returns {string}
 */
export function toBackendMediaUrl(path) {
    if (!path || typeof path !== 'string') return '';
    const trimmed = path.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return trimmed;

    const relative = toRelativeMediaPath(trimmed);

    if (/^https?:\/\//i.test(trimmed) && isMediaPath(relative)) {
        if (shouldUseSameOriginMediaInDev()) {
            logResolvedMediaUrl('media', relative, trimmed, 'toBackendMediaUrl:dev-same-origin-rewrite');
            return relative;
        }
        if (BACKEND_URL) {
            const resolved = `${BACKEND_URL}${relative}`;
            logResolvedMediaUrl('media', resolved, trimmed, 'toBackendMediaUrl:absolute');
            return resolved;
        }
    }

    if (!relative.startsWith('/')) {
        logResolvedMediaUrl('media', trimmed, trimmed, 'toBackendMediaUrl:passthrough');
        return trimmed;
    }

    if (shouldUseSameOriginMediaInDev()) {
        logResolvedMediaUrl('media', relative, trimmed, 'toBackendMediaUrl:dev-same-origin');
        return relative;
    }

    const mediaBaseUrl = ASSET_BASE_URL || BACKEND_URL;
    if (!mediaBaseUrl) {
        logResolvedMediaUrl('media', relative, trimmed, 'toBackendMediaUrl:no-backend');
        return relative;
    }

    const resolved = `${mediaBaseUrl}${relative}`;
    logResolvedMediaUrl('media', resolved, trimmed, 'toBackendMediaUrl');
    return resolved;
}

const VIDEO_MIME_BY_EXT = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska'
};

/**
 * Browser `<source type>` hint from path or URL.
 * @param {string | null | undefined} pathOrUrl
 * @returns {string}
 */
export function videoMimeForPath(pathOrUrl) {
    if (!pathOrUrl || typeof pathOrUrl !== 'string') return 'video/mp4';
    const ext = pathOrUrl.split('?')[0].split('.').pop()?.toLowerCase() || '';
    return VIDEO_MIME_BY_EXT[ext] || 'video/mp4';
}

/**
 * @param {string | null | undefined} path
 * @returns {{ url: string; mime: string }}
 */
export function resolveVideoMedia(path) {
    const url = toBackendMediaUrl(path);
    return { url, mime: videoMimeForPath(path || url) };
}

/** @param {string} url */
export function isBackendMediaOrigin(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('blob:') || url.startsWith('data:')) return true;
    if (!url.startsWith('http')) return false;
    const base = BACKEND_URL || `http://localhost:${BACKEND_PORT}`;
    try {
        const resolved = new URL(url);
        const expected = new URL(base);
        return resolved.origin === expected.origin;
    } catch {
        return false;
    }
}

/** @param {string} url */
export function isRelativeMediaLeak(url) {
    if (!url || typeof url !== 'string') return false;
    const t = url.trim();
    if (!t || t.startsWith('blob:') || t.startsWith('data:') || t.startsWith('http')) return false;
    return t.startsWith('/') || t.startsWith('videos/') || t.startsWith('thumbs/');
}

/**
 * Dev-only: scan DOM for media attributes that did not resolve to backend origin.
 * @returns {{ ok: boolean; leaks: Array<{ tag: string; attr: string; value: string }> }}
 */
export function auditRenderedMediaUrls() {
    if (typeof document === 'undefined') return { ok: true, leaks: [] };
    const leaks = [];
    const push = (el, attr, value) => {
        if (!value || typeof value !== 'string') return;
        const v = value.trim();
        if (!v || v.startsWith('blob:') || v.startsWith('data:')) return;
        if (isRelativeMediaLeak(v) || (v.startsWith('http') && !isBackendMediaOrigin(v))) {
            leaks.push({ tag: el.tagName?.toLowerCase() || '?', attr, value: v });
        }
    };

    document.querySelectorAll('img[src], video[src], source[src]').forEach((el) => {
        push(el, 'src', el.getAttribute('src') || '');
    });
    document.querySelectorAll('video[poster]').forEach((el) => {
        push(el, 'poster', el.getAttribute('poster') || '');
    });
    document.querySelectorAll('[style*="background-image"]').forEach((el) => {
        const style = el.getAttribute('style') || '';
        const match = style.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/i);
        if (match?.[1]) push(el, 'background-image', match[1]);
    });

    if (import.meta.env.DEV) {
        if (leaks.length) {
            console.warn('[MEDIA URL audit] relative or non-backend leaks:', leaks);
        } else {
            console.log('[MEDIA URL audit] OK — no relative media leaks in DOM');
        }
    }
    return { ok: leaks.length === 0, leaks };
}

/** @param {'video' | 'thumbnail' | 'media'} kind @param {string} resolved @param {string} [original] @param {string} [context] */
const _loggedMediaUrls = new Set();
export function logResolvedMediaUrl(kind, resolved, original = '', context = '') {
    if (!import.meta.env.DEV || !resolved) return;
    const key = `${original}|${resolved}|${context || kind}`;
    if (_loggedMediaUrls.has(key)) return;
    _loggedMediaUrls.add(key);
    console.log('[MEDIA URL]', {
        original: original || resolved,
        resolved,
        context: context || kind
    });
}

/** Dev-only: final URL at render boundary (theater, vault, hero, shelf). */
const _finalSurfaceLog = new Set();
export function logFinalMediaUrl(surface, url) {
    if (!import.meta.env.DEV || !url || typeof url !== 'string') return;
    const key = `${surface}:${url}`;
    if (_finalSurfaceLog.has(key)) return;
    _finalSurfaceLog.add(key);
    console.log('[MEDIA URL]', url);
}
