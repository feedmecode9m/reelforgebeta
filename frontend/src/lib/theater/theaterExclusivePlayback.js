/**
 * Exclusive playback helpers — pause + unload non-Theater media while Theater is open.
 * Prevents hero/shelf/preview <video> elements competing for bandwidth with the primary MP4.
 */

import {
    claimPlaybackOwner,
    releasePlaybackOwner,
    getPlaybackOwner
} from '../media/playbackOwnership.js';

/**
 * @typedef {{
 *   el: HTMLVideoElement;
 *   srcAttr: string;
 *   sources: Array<{ src: string; type: string }>;
 *   wasPlaying: boolean;
 *   preload: string;
 *   currentTime: number;
 * }} SuspendedVideo
 */

/** @type {SuspendedVideo[]} */
let suspendedByTheater = [];

/**
 * @param {HTMLVideoElement} el
 */
function isTheaterPrimaryVideo(el) {
    if (!el) return false;
    if (el.hasAttribute('data-theater-video')) return true;
    if (el.classList.contains('theater-video') || el.classList.contains('theater-video-fg')) {
        return true;
    }
    return false;
}

/**
 * Hard-unload a single media element — terminates progressive/range downloads.
 * Used for competing page media and for outgoing Theater primary on remount.
 * @param {HTMLVideoElement | null | undefined} v
 * @returns {boolean}
 */
export function hardUnloadVideoElement(v) {
    if (!v) return false;
    try {
        v.pause();
    } catch {
        /* ignore */
    }
    try {
        for (const s of [...v.querySelectorAll('source')]) {
            s.removeAttribute('src');
            s.remove();
        }
        v.removeAttribute('src');
        // Empty string assignment drops active network pipelines in Chromium/WebKit.
        v.src = '';
        v.removeAttribute('src');
        try {
            v.preload = 'none';
        } catch {
            /* ignore */
        }
        v.load();
        return true;
    } catch {
        return false;
    }
}

/**
 * Snapshot network sources then detach so the browser drops range downloads.
 * @param {HTMLVideoElement} v
 * @returns {SuspendedVideo | null}
 */
function snapshotAndUnloadVideo(v) {
    if (!v) return null;
    const sourceEls = [...v.querySelectorAll('source')];
    const sources = sourceEls
        .map((s) => ({
            src: String(s.getAttribute('src') || '').trim(),
            type: String(s.getAttribute('type') || '').trim()
        }))
        .filter((s) => s.src);
    const srcAttr = String(v.getAttribute('src') || '').trim();
    const wasPlaying = !v.paused && !v.ended;
    const preload = String(v.getAttribute('preload') || v.preload || '');
    const currentTime = Number(v.currentTime) || 0;

    hardUnloadVideoElement(v);

    return {
        el: v,
        srcAttr,
        sources,
        wasPlaying,
        preload,
        currentTime
    };
}

/**
 * Claim Theater bandwidth ownership and unload competing Hero/Vault/preview media.
 * Call BEFORE Theater attaches a media source so masters never race the derivative.
 * @param {string} [reason]
 */
export function beginTheaterExclusiveSession(reason = 'theater-open-before-attach') {
    claimPlaybackOwner('theater', reason);
    pauseCompetingPageVideos();
}

/**
 * Pause and unload every page video that is not the Theater primary.
 * Safe to call multiple times — already-suspended nodes are updated in place.
 */
export function pauseCompetingPageVideos() {
    if (typeof document === 'undefined') return;

    claimPlaybackOwner('theater', 'theater-open-exclusive');

    const already = new Set(suspendedByTheater.map((s) => s.el));
    const all = [...document.querySelectorAll('video')];

    for (const v of all) {
        if (isTheaterPrimaryVideo(v)) continue;
        if (already.has(v)) {
            // Re-assert unload if Svelte rebound src while Theater is open.
            try {
                if (v.getAttribute('src') || v.querySelector('source') || (v.currentSrc && !v.ended)) {
                    const had = suspendedByTheater.find((s) => s.el === v);
                    const snap = snapshotAndUnloadVideo(v);
                    if (snap && had) {
                        // Keep original snapshot fields for restore.
                        had.el = snap.el;
                    } else if (snap) {
                        suspendedByTheater.push(snap);
                    }
                } else {
                    try {
                        v.pause();
                    } catch {
                        /* ignore */
                    }
                }
            } catch {
                /* ignore */
            }
            continue;
        }
        const snap = snapshotAndUnloadVideo(v);
        if (snap) {
            suspendedByTheater.push(snap);
            already.add(v);
        }
    }

    if (import.meta.env?.DEV) {
        console.info('[THEATER_EXCLUSIVE]', {
            phase: 'pause-unload',
            suspended: suspendedByTheater.length,
            owner: getPlaybackOwner(),
            ts: new Date().toISOString()
        });
    }
}

/**
 * Restore sources unloaded when opening Theater (best-effort).
 * Does not force autoplay for non-hero previews; only replays if it was playing.
 */
export function resumeCompetingPageVideos() {
    const list = suspendedByTheater;
    suspendedByTheater = [];
    releasePlaybackOwner('theater', 'theater-close');

    for (const item of list) {
        const v = item.el;
        try {
            if (!v || !v.isConnected) continue;

            // Prefer <source> restoration when card used useSourceElement.
            if (item.sources && item.sources.length) {
                v.removeAttribute('src');
                for (const s of item.sources) {
                    const el = document.createElement('source');
                    el.src = s.src;
                    if (s.type) el.type = s.type;
                    v.appendChild(el);
                }
            } else if (item.srcAttr) {
                v.setAttribute('src', item.srcAttr);
                v.src = item.srcAttr;
            }

            if (item.preload) {
                try {
                    v.preload = item.preload;
                } catch {
                    /* ignore */
                }
            }

            // Only restore play for media that was mid-play (typically hero).
            // Svelte remounts may overwrite these attributes shortly after.
            if (item.wasPlaying) {
                const p = v.play?.();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
        } catch {
            /* autoplay may block — acceptable */
        }
    }

    if (import.meta.env?.DEV) {
        console.info('[THEATER_EXCLUSIVE]', {
            phase: 'resume-restore',
            restored: list.length,
            owner: getPlaybackOwner(),
            ts: new Date().toISOString()
        });
    }
}

/**
 * Count non-theater videos still holding a network src (validation / diagnostics).
 * @returns {{ competitorsWithSrc: number; theaterVideos: number }}
 */
export function inspectCompetingVideoSources() {
    if (typeof document === 'undefined') {
        return { competitorsWithSrc: 0, theaterVideos: 0 };
    }
    const all = [...document.querySelectorAll('video')];
    let theaterVideos = 0;
    let competitorsWithSrc = 0;
    for (const v of all) {
        if (isTheaterPrimaryVideo(v)) {
            theaterVideos += 1;
            continue;
        }
        const hasSrc = Boolean(
            (v.getAttribute('src') || '').trim() ||
                v.querySelector('source[src]') ||
                (v.currentSrc && String(v.currentSrc).trim())
        );
        if (hasSrc) competitorsWithSrc += 1;
    }
    return { competitorsWithSrc, theaterVideos };
}
