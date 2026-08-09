/**
 * Exclusive playback helpers — pause non-Theater media while Theater is open.
 * Prevents hero/shelf <video> elements competing for bandwidth with the primary MP4.
 */

/** @type {HTMLVideoElement[]} */
let pausedByTheater = [];

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
 * Pause every playing page video that is not the Theater primary.
 * Safe to call multiple times — only tracks videos paused by the first call until resume.
 */
export function pauseCompetingPageVideos() {
    if (typeof document === 'undefined') return;
    // Keep prior list if theater re-opened without resume (e.g. episode change).
    const stillTracked = new Set(pausedByTheater);
    const playing = [...document.querySelectorAll('video')].filter(
        (v) => !isTheaterPrimaryVideo(v) && !v.paused && !v.ended
    );
    for (const v of playing) {
        try {
            v.pause();
            if (!stillTracked.has(v)) {
                pausedByTheater.push(v);
                stillTracked.add(v);
            }
        } catch {
            /* ignore */
        }
    }
}

/**
 * Resume videos we paused when opening Theater (best-effort).
 */
export function resumeCompetingPageVideos() {
    const list = pausedByTheater;
    pausedByTheater = [];
    for (const v of list) {
        try {
            if (v && v.isConnected) {
                const p = v.play?.();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
        } catch {
            /* autoplay may block — acceptable */
        }
    }
}
