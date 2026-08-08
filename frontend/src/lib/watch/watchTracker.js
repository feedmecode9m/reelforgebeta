import { fetchWatchStatus, postWatchEvent, getOrCreateViewerId } from '../api/watch.js';
import { resolveWatchProgress, updateWatchProgress } from '../series/seriesWatchProgress.js';
import {
    recordEpisodeCompletion,
    recordWatchDuration
} from '../observability/platformMetrics.js';
import { fetchViewerHistoryForReel, postViewerHistory } from '../api/viewerAccount.js';
import { isAuthenticatedSync } from '../auth/index.js';
import { applyPendingResume, setPendingResume, clearPendingResume } from '../viewer/resumePosition.js';

let enabled = false;
let statusChecked = false;
let sessionId = null;
let wasPaused = false;
let currentReelId = null;
let currentEpisodeId = null;
let lastHistoryPostAt = 0;

async function ensureEnabled() {
    if (statusChecked) return enabled;
    try {
        const status = await fetchWatchStatus();
        enabled = !status.disabled && status.enabled === true;
    } catch {
        enabled = false;
    }
    statusChecked = true;
    return enabled;
}

function newSessionId() {
    return crypto.randomUUID();
}

function snapshot(videoEl) {
    const position = videoEl?.currentTime ?? 0;
    const duration =
        videoEl?.duration && Number.isFinite(videoEl.duration) ? videoEl.duration : null;
    return { position_seconds: position, duration_seconds: duration };
}

function persistLocalWatchProgress(videoEl) {
    if (!currentReelId && !currentEpisodeId) return;
    const snap = snapshot(videoEl);
    if (!snap.duration_seconds || snap.duration_seconds <= 0) return;
    const percent = (snap.position_seconds / snap.duration_seconds) * 100;
    updateWatchProgress(currentEpisodeId, currentReelId, percent);
}

/**
 * VIEWER-1: save account-scoped playback history when signed in.
 * @param {HTMLVideoElement | null | undefined} videoEl
 * @param {{ completed?: boolean; force?: boolean }} [opts]
 */
async function persistAccountHistory(videoEl, opts = {}) {
    if (!isAuthenticatedSync() || !currentReelId) return;
    const now = Date.now();
    if (!opts.force && !opts.completed && now - lastHistoryPostAt < 8000) {
        return;
    }
    const snap = snapshot(videoEl);
    lastHistoryPostAt = now;
    try {
        await postViewerHistory({
            reelId: currentReelId,
            positionSeconds: snap.position_seconds,
            durationSeconds: snap.duration_seconds,
            completed: opts.completed === true
        });
    } catch {
        /* non-blocking */
    }
}

async function emit(eventType, videoEl, extra = {}) {
    if (!(await ensureEnabled())) return;
    if (!sessionId || !currentReelId) return;

    const snap = snapshot(videoEl);
    const body = {
        event_type: eventType,
        session_id: sessionId,
        reel_id: currentReelId,
        episode_id: currentEpisodeId || undefined,
        position_seconds: snap.position_seconds,
        duration_seconds: snap.duration_seconds,
        ...extra
    };

    try {
        await postWatchEvent(body);
    } catch (err) {
        if (import.meta.env.DEV) {
            console.warn('[watchTracker]', eventType, err?.message || err);
        }
    }
}

/**
 * Bind theater session when a reel opens.
 * Local progress binding is always active; API emission remains gated by ensureEnabled().
 * @param {{ reelId?: string | null; episodeId?: string | null; seriesId?: string | null; seasonNumber?: number | null }} params
 */
export async function watchSessionStart({ reelId, episodeId = null, seriesId = null, seasonNumber = null } = {}) {
    sessionId = newSessionId();
    wasPaused = false;
    currentReelId = reelId ? String(reelId) : null;
    currentEpisodeId = episodeId ? String(episodeId) : null;
    lastHistoryPostAt = 0;
    clearPendingResume();
    getOrCreateViewerId();

    await resolveWatchProgress(currentEpisodeId, currentReelId, {
        preferApi: true,
        syncToLocal: true,
        restoreContext: 'session_start'
    });

    // VIEWER-1: account resume foundation
    if (isAuthenticatedSync() && currentReelId) {
        try {
            const row = await fetchViewerHistoryForReel(currentReelId);
            if (row && !row.completed) {
                setPendingResume(currentReelId, row.positionSeconds, {
                    completed: row.completed,
                    durationSeconds: row.durationSeconds
                });
                const duration = Number(row.durationSeconds);
                if (Number.isFinite(duration) && duration > 0 && row.positionSeconds != null) {
                    const percent = (Number(row.positionSeconds) / duration) * 100;
                    updateWatchProgress(currentEpisodeId, currentReelId, percent);
                }
            }
        } catch {
            /* local/resolve still works */
        }
    }

    if (import.meta.env.DEV) {
        console.log('[watchTracker] session-start', {
            reelId: currentReelId,
            episodeId: currentEpisodeId,
            seriesId: seriesId || null,
            seasonNumber: seasonNumber ?? null,
            apiEnabled: await ensureEnabled()
        });
    }
}

/**
 * Call from theater loadedmetadata (minimal wire) to resume.
 * @param {HTMLVideoElement} videoEl
 * @param {string | null | undefined} reelId
 */
export function watchApplyResume(videoEl, reelId = currentReelId) {
    return applyPendingResume(videoEl, reelId || currentReelId);
}

export async function watchOnPlay(videoEl) {
    const type = wasPaused ? 'RESUME' : 'PLAY';
    wasPaused = false;
    await emit(type, videoEl, { started_at: new Date().toISOString() });
}

export async function watchOnPause(videoEl) {
    wasPaused = true;
    persistLocalWatchProgress(videoEl);
    await persistAccountHistory(videoEl, { force: true });
    const snap = snapshot(videoEl);
    if (snap.duration_seconds && snap.duration_seconds > 0) {
        recordWatchDuration({
            episodeId: currentEpisodeId,
            reelId: currentReelId,
            durationMs: snap.position_seconds * 1000
        });
    }
    await emit('PAUSE', videoEl);
}

export async function watchOnComplete(videoEl) {
    persistLocalWatchProgress(videoEl);
    updateWatchProgress(currentEpisodeId, currentReelId, 100);
    await persistAccountHistory(videoEl, { completed: true, force: true });
    const snap = snapshot(videoEl);
    recordEpisodeCompletion({
        episodeId: currentEpisodeId,
        reelId: currentReelId,
        durationMs:
            snap.duration_seconds && snap.duration_seconds > 0
                ? snap.duration_seconds * 1000
                : undefined
    });
    await emit('COMPLETE', videoEl, { ended_at: new Date().toISOString() });
    wasPaused = false;
}

export async function watchOnExit(videoEl) {
    persistLocalWatchProgress(videoEl);
    await persistAccountHistory(videoEl, { force: true });
    const snap = snapshot(videoEl);
    if (snap.duration_seconds && snap.duration_seconds > 0) {
        recordWatchDuration({
            episodeId: currentEpisodeId,
            reelId: currentReelId,
            durationMs: snap.position_seconds * 1000
        });
    }
    await emit('EXIT', videoEl, { ended_at: new Date().toISOString() });
    sessionId = null;
    currentReelId = null;
    currentEpisodeId = null;
    wasPaused = false;
}

/** Throttled progress save during playback (timeupdate from theater). */
export async function watchOnProgress(videoEl) {
    persistLocalWatchProgress(videoEl);
    await persistAccountHistory(videoEl, { force: false });
}

export function isWatchTrackingEnabled() {
    return enabled;
}

export function resetWatchTrackerForTests() {
    enabled = false;
    statusChecked = false;
    sessionId = null;
    wasPaused = false;
    currentReelId = null;
    currentEpisodeId = null;
    lastHistoryPostAt = 0;
    clearPendingResume();
}

if (typeof window !== 'undefined') {
    window.__reelforgeWatchTracking = {
        watchSessionStart,
        watchOnPlay,
        watchOnPause,
        watchOnComplete,
        watchOnExit,
        watchOnProgress,
        watchApplyResume,
        isWatchTrackingEnabled,
        resolveWatchProgress
    };
}
