/**
 * VIEWER-1 helpers for resume position (seconds), used by watchTracker + theater.
 */

/** @type {number | null} */
let pendingResumeSeconds = null;
/** @type {string | null} */
let pendingResumeReelId = null;

/**
 * @param {string | null | undefined} reelId
 * @param {number | null | undefined} positionSeconds
 * @param {{ completed?: boolean; durationSeconds?: number | null }} [meta]
 */
export function setPendingResume(reelId, positionSeconds, meta = {}) {
    const id = reelId ? String(reelId) : null;
    const pos = Number(positionSeconds);
    const completed = meta.completed === true;
    const duration = Number(meta.durationSeconds);

    if (!id || !Number.isFinite(pos) || pos < 3) {
        clearPendingResume();
        return;
    }
    // Completed titles: hide from continue; replay starts at 0 unless user seeks.
    if (completed) {
        clearPendingResume();
        return;
    }
    if (Number.isFinite(duration) && duration > 0 && pos / duration >= 0.9) {
        clearPendingResume();
        return;
    }

    pendingResumeReelId = id;
    pendingResumeSeconds = pos;
}

export function clearPendingResume() {
    pendingResumeSeconds = null;
    pendingResumeReelId = null;
}

/**
 * Apply once when video metadata is ready (safe for theater/media elements).
 * @param {HTMLVideoElement | null | undefined} videoEl
 * @param {string | null | undefined} reelId
 */
export function applyPendingResume(videoEl, reelId) {
    if (!videoEl || !pendingResumeReelId || pendingResumeSeconds == null) return false;
    if (reelId && String(reelId) !== pendingResumeReelId) return false;

    const target = pendingResumeSeconds;
    const duration = Number(videoEl.duration);
    clearPendingResume();

    if (!Number.isFinite(target) || target < 3) return false;
    if (Number.isFinite(duration) && duration > 0) {
        // Leave a small buffer before the end.
        const max = Math.max(0, duration - 1.5);
        videoEl.currentTime = Math.min(target, max);
    } else {
        try {
            videoEl.currentTime = target;
        } catch {
            return false;
        }
    }
    return true;
}

export function getPendingResume() {
    return {
        reelId: pendingResumeReelId,
        positionSeconds: pendingResumeSeconds
    };
}
