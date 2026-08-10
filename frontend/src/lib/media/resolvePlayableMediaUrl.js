/**
 * Canonical playable media URL selection (derivative vs master).
 *
 * Prefer optimized playbackUrl only when playbackStatus === "ready".
 * Always keep master fallback. Master-only contexts never select the derivative.
 *
 * Contexts:
 *   theater      — must prefer derivative (primary product path)
 *   hero         — prefer derivative when present
 *   vault_preview — hover previews only (poster-first idle unchanged at call site)
 *   download | studio | master — always master/source url
 */

/** @typedef {'theater' | 'hero' | 'vault_preview' | 'download' | 'studio' | 'master' | string} PlaybackContext */

/** Contexts that must never select a derivative. */
const MASTER_ONLY_CONTEXTS = new Set(['download', 'studio', 'master']);

/** Contexts that may select a ready derivative. */
const DERIVATIVE_CONTEXTS = new Set(['theater', 'hero', 'vault_preview', 'preview']);

/**
 * @returns {boolean}
 */
function isDevDiagnosticsEnabled() {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
            return true;
        }
    } catch {
        /* ignore */
    }
    if (typeof process !== 'undefined' && process.env) {
        if (process.env.REELFORGE_PLAYBACK_DIAG === '1') return true;
        if (process.env.NODE_ENV === 'development') return true;
    }
    try {
        if (typeof window !== 'undefined') {
            if (window.localStorage?.getItem('reelforge_playback_diag') === '1') return true;
            if (new URLSearchParams(window.location.search).get('debug') === 'playback') return true;
        }
    } catch {
        /* ignore */
    }
    return false;
}

/**
 * @param {string} context
 * @param {string} source
 */
function logDerivative(context, source) {
    // Always emit derivative selection so production acceptance can capture the marker.
    // Fallback (master) remains quiet outside DEV / explicit diag flags.
    console.info(`[PLAYBACK_DERIVATIVE]\ncontext=${context}\nsource=${source}`);
}

/**
 * Merge playback derivative metadata from one or more reel-like sources.
 * Prefers an explicit ready pair; otherwise first non-empty fields.
 * Used when feed redistributes strip/omit fields that catalog still has.
 *
 * @param {...(Record<string, unknown> | null | undefined)} sources
 * @returns {{ playbackUrl?: string, playbackStatus?: string }}
 */
export function mergePlaybackDerivativeFields(...sources) {
    let playbackUrl = '';
    let playbackStatus = '';
    for (const src of sources) {
        if (!src || typeof src !== 'object') continue;
        const url = String(src.playbackUrl || src.playback_url || '').trim();
        const status = String(src.playbackStatus || src.playback_status || '')
            .trim()
            .toLowerCase();
        if (url && status === 'ready') {
            return { playbackUrl: url, playbackStatus: 'ready' };
        }
        if (!playbackUrl && url) playbackUrl = url;
        if (!playbackStatus && status) playbackStatus = status;
    }
    return {
        ...(playbackUrl ? { playbackUrl } : {}),
        ...(playbackStatus ? { playbackStatus } : {})
    };
}

/**
 * @param {string} context
 * @param {string} reason
 */
function logFallback(context, reason) {
    if (!isDevDiagnosticsEnabled()) return;
    console.info(`[PLAYBACK_FALLBACK]\ncontext=${context}\nreason=${reason}`);
}

/**
 * Master / source media URL (API `url`, legacy video fields, hero mediaUrl).
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {string}
 */
export function getMasterMediaUrl(reel) {
    if (!reel || typeof reel !== 'object') return '';
    return String(
        reel.url ||
            reel.video_url ||
            reel.videoUrl ||
            reel.src ||
            reel.mediaUrl ||
            ''
    ).trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {string}
 */
export function getPlaybackDerivativeUrl(reel) {
    if (!reel || typeof reel !== 'object') return '';
    return String(reel.playbackUrl || reel.playback_url || '').trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {string}
 */
export function getPlaybackStatus(reel) {
    if (!reel || typeof reel !== 'object') return '';
    return String(reel.playbackStatus || reel.playback_status || '')
        .trim()
        .toLowerCase();
}

/**
 * True when a derivative URL exists and ingest reports ready.
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {boolean}
 */
export function isPlaybackDerivativeReady(reel) {
    return Boolean(getPlaybackDerivativeUrl(reel)) && getPlaybackStatus(reel) === 'ready';
}

/**
 * Resolve the browser-playable media URL for a given surface.
 *
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {PlaybackContext} [context='theater']
 * @param {{ silent?: boolean }} [options]
 * @returns {string}
 */
export function resolvePlayableMediaUrl(reel, context = 'theater', options = {}) {
    const silent = options?.silent === true;
    const ctx = String(context || 'theater')
        .trim()
        .toLowerCase() || 'theater';
    const master = getMasterMediaUrl(reel);

    if (!reel || typeof reel !== 'object') {
        if (!silent) logFallback(ctx, 'empty_reel');
        return master;
    }

    if (MASTER_ONLY_CONTEXTS.has(ctx)) {
        if (!silent) logFallback(ctx, 'master_context');
        return master;
    }

    const prefersDerivative = DERIVATIVE_CONTEXTS.has(ctx);
    if (!prefersDerivative) {
        // Unknown contexts: safe master default (rollback-friendly).
        if (!silent) logFallback(ctx, 'unknown_context');
        return master;
    }

    const derivative = getPlaybackDerivativeUrl(reel);
    const status = getPlaybackStatus(reel);

    if (derivative && status === 'ready') {
        if (!silent) logDerivative(ctx, 'playback_url');
        return derivative;
    }

    if (!silent) {
        let reason = 'no_derivative';
        if (derivative && status && status !== 'ready') reason = 'not_ready';
        else if (derivative && !status) reason = 'not_ready';
        logFallback(ctx, reason);
    }

    return master;
}
