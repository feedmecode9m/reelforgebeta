/**
 * Theater primary-video playback diagnostics.
 * Distinguishes frontend races vs buffering vs server/range problems.
 * Opt-in: DEV, DEBUG_THEATER, or ?debug=theater
 */

import { logMobilePlayTrace } from '../device/mobileExperienceDiagnostics.js';

/** @param {HTMLVideoElement | null | undefined} el */
export function snapshotTheaterVideo(el) {
    if (!el) {
        return {
            src: null,
            currentSrc: null,
            readyState: null,
            networkState: null,
            bufferedRanges: [],
            bufferAhead: null,
            currentTime: null,
            duration: null,
            paused: null,
            seeking: null,
            playbackRate: null,
            videoWidth: null,
            videoHeight: null
        };
    }

    /** @type {Array<{ start: number; end: number }>} */
    const bufferedRanges = [];
    try {
        const b = el.buffered;
        for (let i = 0; i < b.length; i += 1) {
            bufferedRanges.push({ start: b.start(i), end: b.end(i) });
        }
    } catch {
        /* empty */
    }

    let bufferAhead = null;
    if (bufferedRanges.length) {
        const last = bufferedRanges[bufferedRanges.length - 1];
        const t = Number(el.currentTime) || 0;
        if (last.end >= t) bufferAhead = Number((last.end - t).toFixed(2));
        else bufferAhead = 0;
    }

    return {
        src: el.getAttribute('src') || el.src || null,
        currentSrc: el.currentSrc || null,
        readyState: el.readyState,
        networkState: el.networkState,
        bufferedRanges,
        bufferAhead,
        currentTime: Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(2)) : null,
        duration: Number.isFinite(el.duration) ? Number(el.duration.toFixed(2)) : null,
        paused: el.paused,
        seeking: el.seeking,
        playbackRate: el.playbackRate,
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight
    };
}

/**
 * @returns {boolean}
 */
export function isTheaterPlaybackDiagEnabled() {
    if (typeof window === 'undefined') return false;
    try {
        if (import.meta.env?.DEV) return true;
        return new URLSearchParams(window.location.search).get('debug') === 'theater';
    } catch {
        return false;
    }
}

/**
 * Log phase + snapshot for buffering / lifecycle (rate-limited for progress).
 * @param {string} phase
 * @param {HTMLVideoElement | null | undefined} el
 * @param {Record<string, unknown>} [extra]
 */
export function logTheaterPlaybackPhase(phase, el, extra = {}) {
    if (!isTheaterPlaybackDiagEnabled()) return;
    const snap = snapshotTheaterVideo(el);
    console.info('[THEATER_PLAYBACK]', {
        phase,
        ts: new Date().toISOString(),
        reelId: extra.reelId ?? null,
        ...snap,
        ...extra
    });
}

/**
 * Attach lifecycle listeners to the primary Theater video once per mount.
 * Does not force play/load; observation only (except we always run snapshot logging when enabled).
 *
 * @param {HTMLVideoElement} videoEl
 * @param {{ getReelId?: () => string | null }} [opts]
 * @returns {() => void} dispose
 */
export function attachTheaterPlaybackDiagnostics(videoEl, opts = {}) {
    if (!videoEl || typeof videoEl.addEventListener !== 'function') return () => {};

    const getReelId = opts.getReelId || (() => null);
    /** @type {Record<string, number>} */
    const lastLogAt = {};
    const minIntervalMs = {
        progress: 2500,
        timeupdate: 999999, // never log timeupdate flood
        waiting: 0,
        stalled: 0,
        suspend: 500,
        canplay: 0,
        canplaythrough: 0,
        loadedmetadata: 0,
        loadeddata: 0,
        playing: 0,
        pause: 200,
        error: 0,
        seeking: 0,
        seeked: 0,
        durationchange: 300
    };

    /**
     * @param {string} phase
     * @param {Event} [ev]
     */
    const onPhase = (phase, ev) => {
        const now = Date.now();
        const min = minIntervalMs[phase] ?? 0;
        if (min && lastLogAt[phase] && now - lastLogAt[phase] < min) return;
        lastLogAt[phase] = now;

        /** @type {Record<string, unknown>} */
        const extra = { reelId: getReelId() };
        if (phase === 'error' && ev?.currentTarget) {
            const el = /** @type {HTMLVideoElement} */ (ev.currentTarget);
            extra.mediaErrorCode = el.error?.code ?? null;
            extra.mediaErrorMessage = el.error?.message ?? null;
        }
        logTheaterPlaybackPhase(phase, videoEl, extra);
        if (
            phase === 'loadedmetadata' ||
            phase === 'canplay' ||
            phase === 'error' ||
            phase === 'stalled' ||
            phase === 'waiting'
        ) {
            const phaseMap = {
                loadedmetadata: 'VIDEO_LOADED_METADATA',
                canplay: 'VIDEO_CANPLAY',
                error: 'VIDEO_ERROR',
                stalled: 'VIDEO_STALLED',
                waiting: 'VIDEO_WAITING'
            };
            logMobilePlayTrace(phaseMap[phase], {
                assetId: String(getReelId() || '').trim(),
                resolver: `theaterPlaybackDiagnostics.${phase}`,
                source: 'theater-video-lifecycle',
                reason:
                    phase === 'error'
                        ? String(extra.mediaErrorMessage || extra.mediaErrorCode || 'media-error')
                        : phase,
                viewerOpen: true,
                videoMounted: true,
                videoEl
            });
        }
    };

    const phases = [
        'loadedmetadata',
        'loadeddata',
        'canplay',
        'canplaythrough',
        'playing',
        'waiting',
        'stalled',
        'suspend',
        'pause',
        'error',
        'progress',
        'seeking',
        'seeked',
        'durationchange'
    ];

    /** @type {Array<[string, EventListener]>} */
    const handlers = phases.map((phase) => {
        /** @type {EventListener} */
        const fn = (ev) => onPhase(phase, ev);
        videoEl.addEventListener(phase, fn);
        return [phase, fn];
    });

    onPhase('attach');

    return () => {
        for (const [phase, fn] of handlers) {
            videoEl.removeEventListener(phase, fn);
        }
    };
}

/**
 * Count primary Theater video elements + page-level competitors (for validation).
 * @returns {{ theaterVideos: number; otherVideosPlaying: number; theaterSrcs: string[] }}
 */
export function inspectTheaterPlaybackElements() {
    if (typeof document === 'undefined') {
        return { theaterVideos: 0, otherVideosPlaying: 0, theaterSrcs: [] };
    }
    const theater = [...document.querySelectorAll('video[data-theater-video], video.theater-video')];
    const others = [...document.querySelectorAll('video')].filter(
        (v) => !v.hasAttribute('data-theater-video') && !v.classList.contains('theater-video')
    );
    return {
        theaterVideos: theater.length,
        otherVideosPlaying: others.filter((v) => !v.paused && !v.ended).length,
        theaterSrcs: [
            ...new Set(
                theater
                    .map((v) => String(v.currentSrc || v.src || '').trim())
                    .filter(Boolean)
            )
        ]
    };
}
