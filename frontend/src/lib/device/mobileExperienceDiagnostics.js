/**
 * LOCAL-MOBILE-EXPERIENCE-HARDENING-1 — mobile identity + shelf diagnostics.
 * LOCAL-MOBILE-PLAYBACK-TRACE-1 — play-path trace only (no playback rewrite).
 */

import { detectMobilePresentation } from './mobilePresentation.js';
import { REEL_TITLES_PERSISTENT_KEY } from '../hero/heroTitleIntelligence.js';
import { lookupPersistentTitleEntry } from '../content/persistentTitleMap.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Classify where a displayed mobile card title came from.
 * @param {string} assetId
 * @param {string} displayedTitle
 * @param {{ vaultTitle?: string; catalogTitle?: string }} [hints]
 * @returns {'persistent' | 'catalog' | 'fallback' | 'empty'}
 */
export function classifyMobileTitleSource(assetId, displayedTitle, hints = {}) {
    const shown = text(displayedTitle);
    if (!shown) return 'empty';
    const id = text(assetId);
    let persistent = text(hints.vaultTitle);
    if (!persistent && id && typeof localStorage !== 'undefined') {
        try {
            const map = JSON.parse(localStorage.getItem(REEL_TITLES_PERSISTENT_KEY) || '{}');
            const entry = lookupPersistentTitleEntry(map, { id });
            persistent = text(entry?.title || entry?.title_original);
        } catch {
            /* ignore */
        }
    }
    if (persistent && persistent === shown) return 'persistent';
    const catalog = text(hints.catalogTitle);
    if (catalog && catalog === shown) return 'catalog';
    if (persistent) return 'persistent';
    if (catalog) return 'catalog';
    return 'fallback';
}

/**
 * @param {{
 *   assetId?: string;
 *   vaultTitle?: string;
 *   displayedTitle?: string;
 *   seriesLine?: string;
 *   catalogTitle?: string;
 *   source?: string;
 * }} detail
 */
export function logMobileIdentityTrace(detail = {}) {
    if (typeof window === 'undefined') return;
    if (!detectMobilePresentation()) return;
    const assetId = text(detail.assetId);
    const displayedTitle = text(detail.displayedTitle);
    const vaultTitle = text(detail.vaultTitle);
    const seriesLine = text(detail.seriesLine);
    const source =
        text(detail.source) ||
        classifyMobileTitleSource(assetId, displayedTitle, {
            vaultTitle,
            catalogTitle: detail.catalogTitle
        });
    console.info('[MOBILE_IDENTITY_TRACE]', {
        device: 'mobile',
        assetId: assetId || null,
        vaultTitle: vaultTitle || null,
        displayedTitle: displayedTitle || null,
        seriesLine: seriesLine || null,
        source,
        ts: new Date().toISOString()
    });
}

/**
 * @param {{
 *   shelf?: string;
 *   rawCount?: number;
 *   hydratedCount?: number;
 *   visibleCount?: number;
 *   domCount?: number | null;
 *   failureStage?: string | null;
 * }} detail
 */
export function logMobileShelfTrace(detail = {}) {
    if (typeof window === 'undefined') return;
    if (!detectMobilePresentation()) return;
    console.info('[MOBILE_SHELF_TRACE]', {
        device: 'mobile',
        shelf: text(detail.shelf) || null,
        rawCount: Number(detail.rawCount) || 0,
        hydratedCount: Number(detail.hydratedCount) || 0,
        visibleCount: Number(detail.visibleCount) || 0,
        domCount: detail.domCount == null ? null : Number(detail.domCount),
        failureStage: detail.failureStage || null,
        ts: new Date().toISOString()
    });
}

/**
 * LOCAL-MOBILE-PLAYBACK-TRACE-4 — compact <video> readiness snapshot for iPhone sink.
 * @param {HTMLVideoElement | null | undefined} video
 * @returns {Record<string, unknown>}
 */
export function snapshotMobileTheaterVideo(video) {
    if (!video) {
        return {
            currentSrc: null,
            srcAttr: null,
            sourceSrc: null,
            networkState: null,
            mediaErrorCode: null,
            mediaErrorMessage: null,
            preload: null,
            hasSourceChild: false
        };
    }
    const source = video.querySelector?.('source');
    const sourceSrc = text(source?.getAttribute?.('src') || '');
    const err = video.error;
    return {
        currentSrc: text(video.currentSrc).slice(0, 160) || null,
        srcAttr: text(video.getAttribute?.('src') || video.src).slice(0, 160) || null,
        sourceSrc: sourceSrc.slice(0, 160) || null,
        networkState: video.networkState,
        mediaErrorCode: err && typeof err.code === 'number' ? err.code : null,
        mediaErrorMessage: text(err?.message).slice(0, 80) || null,
        preload: text(video.preload) || null,
        hasSourceChild: Boolean(source)
    };
}

/**
 * Trace mobile play handoff layers — does not start playback or invent URLs.
 * Always logs on mobile presentation; also logs when force=true (desktop debug).
 *
 * @param {string} phase
 * @param {{
 *   assetId?: string;
 *   title?: string;
 *   mediaUrl?: string;
 *   resolver?: string;
 *   viewerOpen?: boolean | null;
 *   videoMounted?: boolean | null;
 *   playCalled?: boolean | null;
 *   source?: string;
 *   category?: string;
 *   hitTop?: string;
 *   reason?: string;
 *   force?: boolean;
 *   videoEl?: HTMLVideoElement | null;
 * }} [detail]
 */
export function logMobilePlayTrace(phase, detail = {}) {
    if (typeof window === 'undefined') return;
    if (!detail.force && !detectMobilePresentation()) return;
    const reelHint =
        typeof document !== 'undefined'
            ? document.querySelector('[data-theater-container], [data-theater-video]')
            : null;
    const video =
        detail.videoEl ||
        (typeof document !== 'undefined'
            ? /** @type {HTMLVideoElement | null} */ (document.querySelector('video[data-theater-video]'))
            : null);
    const snap = snapshotMobileTheaterVideo(video);
    const payload = {
        event: 'MOBILE_PLAY_TRACE',
        device: detectMobilePresentation() ? 'mobile' : 'desktop',
        phase: text(phase) || 'unknown',
        assetId: text(detail.assetId) || null,
        title: text(detail.title) || null,
        mediaUrl:
            text(detail.mediaUrl).slice(0, 160) ||
            snap.currentSrc ||
            snap.sourceSrc ||
            snap.srcAttr ||
            null,
        resolver: text(detail.resolver) || null,
        viewerOpen:
            detail.viewerOpen != null
                ? Boolean(detail.viewerOpen)
                : Boolean(document.querySelector('[data-theater-container]')),
        videoMounted:
            detail.videoMounted != null ? Boolean(detail.videoMounted) : Boolean(video),
        playCalled: detail.playCalled == null ? null : Boolean(detail.playCalled),
        source: text(detail.source) || null,
        category: text(detail.category) || null,
        hitTop: text(detail.hitTop) || null,
        reason: text(detail.reason) || null,
        videoPaused: video ? Boolean(video.paused) : null,
        videoReadyState: video ? video.readyState : null,
        theaterNode: Boolean(reelHint),
        currentSrc: snap.currentSrc,
        srcAttr: snap.srcAttr,
        sourceSrc: snap.sourceSrc,
        networkState: snap.networkState,
        mediaErrorCode: snap.mediaErrorCode,
        mediaErrorMessage: snap.mediaErrorMessage,
        preload: snap.preload,
        hasSourceChild: snap.hasSourceChild,
        timestamp: new Date().toISOString()
    };
    payload.ts = payload.timestamp;
    console.info('[MOBILE_PLAY_TRACE]', payload);
    postMobilePlayTraceRemote(payload);
}

/**
 * LOCAL-MOBILE-PLAYBACK-TRACE-3 — fire-and-forget sink for iPhone (no Safari Web Inspector).
 * Same-origin `/api` so Vite proxy works from LAN IPs. No-op outside `import.meta.env.DEV`.
 * @param {Record<string, unknown>} payload
 */
function postMobilePlayTraceRemote(payload) {
    if (typeof window === 'undefined') return;
    if (!import.meta.env.DEV) return;
    const phase = text(payload.phase) || 'unknown';
    const body = JSON.stringify(payload);
    try {
        // sendBeacon survives iOS burst-from-click better than stacked keepalive fetch.
        const queued =
            typeof navigator !== 'undefined' &&
            typeof navigator.sendBeacon === 'function' &&
            navigator.sendBeacon(
                '/api/debug/mobile-trace',
                new Blob([body], { type: 'application/json' })
            );
        if (!queued) {
            fetch('/api/debug/mobile-trace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                keepalive: true
            }).catch(() => {});
        }
        console.info('[MOBILE_PLAY_TRACE_REMOTE]', { sent: true, phase, beacon: Boolean(queued) });
    } catch {
        console.info('[MOBILE_PLAY_TRACE_REMOTE]', { sent: false, phase });
    }
}

/**
 * Best-effort: what sits under a card center at tap time (overlay detection).
 * @param {HTMLElement | null | undefined} el
 * @returns {string}
 */
export function describeElementUnderPoint(el) {
    if (!el || typeof document === 'undefined' || typeof el.getBoundingClientRect !== 'function') {
        return '';
    }
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + Math.min(40, rect.height / 2);
    const top = document.elementFromPoint(x, y);
    if (!top) return 'none';
    const cls = String(top.className || '').toString().slice(0, 80);
    return `${top.tagName}${cls ? '.' + cls.replace(/\s+/g, '.') : ''}`;
}

/**
 * @returns {boolean}
 */
export function isMobileExperienceSurface() {
    return detectMobilePresentation();
}
