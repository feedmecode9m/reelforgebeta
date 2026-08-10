/**
 * Viewer telemetry — local watch progress for theater intelligence.
 * Key: reelforge_series_watch_progress
 */

import { fetchWatchProgress } from '../api/watch.js';

export const WATCH_PROGRESS_STORAGE_KEY = 'reelforge_series_watch_progress';
const WATCH_PROGRESS_META_KEY = 'reelforge_series_watch_progress_meta';

/**
 * @param {'WATCH_PROGRESS' | 'WATCH_SYNC' | 'WATCH_RESTORE'} tag
 * @param {Record<string, unknown>} [detail]
 */
function logWatchProgressDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeProgressValue(value) {
    if (Number.isFinite(value)) {
        return Math.max(0, Math.min(100, Math.round(Number(value))));
    }
    if (value && typeof value === 'object') {
        const objectValue = /** @type {Record<string, unknown>} */ (value);
        const candidates = [
            objectValue.percent,
            objectValue.completion_percent,
            objectValue.progress_percent,
            objectValue.completionPercent
        ];
        for (const candidate of candidates) {
            if (Number.isFinite(candidate)) {
                return Math.max(0, Math.min(100, Math.round(Number(candidate))));
            }
        }
    }
    return null;
}

/** @returns {Record<string, number>} */
function loadWatchProgressMeta() {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(WATCH_PROGRESS_META_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/** @param {Record<string, number>} map */
function persistWatchProgressMeta(map) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(WATCH_PROGRESS_META_KEY, JSON.stringify(map));
    } catch {
        // non-fatal
    }
}

/** @returns {Record<string, number>} */
export function loadWatchProgressMap() {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(WATCH_PROGRESS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/** @param {Record<string, number>} map */
export function persistWatchProgressMap(map) {
    if (typeof window === 'undefined') return false;
    try {
        localStorage.setItem(WATCH_PROGRESS_STORAGE_KEY, JSON.stringify(map));
        if (typeof window !== 'undefined') {
            window.dispatchEvent(
                new CustomEvent('reelforge:sync-schedule', { detail: { domain: 'watchProgress' } })
            );
        }
        return true;
    } catch (err) {
        console.warn('[seriesWatchProgress] persist failed', err);
        return false;
    }
}

/**
 * @param {string | null | undefined} episodeId
 * @param {string | null | undefined} reelId
 * @param {number} percent 0–100
 */
export function updateWatchProgress(episodeId, reelId, percent) {
    const clamped = normalizeProgressValue(percent);
    if (clamped == null) return;
    const map = loadWatchProgressMap();
    const meta = loadWatchProgressMeta();
    const at = Date.now();
    if (episodeId) {
        map[String(episodeId)] = clamped;
        meta[String(episodeId)] = at;
    }
    if (reelId) {
        map[String(reelId)] = clamped;
        meta[String(reelId)] = at;
    }
    persistWatchProgressMeta(meta);
    persistWatchProgressMap(map);
}

/**
 * @param {string} episodeId
 * @param {string} [reelId]
 * @returns {number | null}
 */
export function getStoredWatchPercent(episodeId, reelId) {
    const map = loadWatchProgressMap();
    const key = episodeId || reelId || '';
    const value = map[key] ?? (reelId ? map[reelId] : undefined);
    return normalizeProgressValue(value);
}

/** @returns {boolean} */
export function hasWatchProgressData() {
    return Object.keys(loadWatchProgressMap()).length > 0;
}

/** Position-accurate viewer progress (not filename-based). */
export const WATCH_POSITION_STORAGE_KEY = 'reelforge_viewer_watch_positions';

/**
 * @typedef {{
 *   viewerId: string;
 *   reelId: string;
 *   position: number;
 *   duration: number;
 *   completed: boolean;
 *   percent: number;
 *   updatedAt: number;
 * }} ViewerWatchPosition
 */

/** @returns {Record<string, ViewerWatchPosition>} */
export function loadWatchPositionMap() {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(WATCH_POSITION_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/** @param {Record<string, ViewerWatchPosition>} map */
export function persistWatchPositionMap(map) {
    if (typeof window === 'undefined') return false;
    try {
        localStorage.setItem(WATCH_POSITION_STORAGE_KEY, JSON.stringify(map || {}));
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {{
 *   viewerId?: string;
 *   reelId: string;
 *   position: number;
 *   duration: number;
 *   completed?: boolean;
 * }} input
 * @returns {ViewerWatchPosition | null}
 */
export function savePlaybackPosition(input) {
    const reelId = String(input?.reelId || '').trim();
    if (!reelId) return null;
    const duration = Math.max(0, Number(input.duration) || 0);
    const position = Math.max(0, Math.min(duration || Number(input.position) || 0, Number(input.position) || 0));
    const percent =
        duration > 0 ? Math.max(0, Math.min(100, Math.round((position / duration) * 100))) : 0;
    const completed =
        input.completed === true || (duration > 0 && position / duration >= 0.92) || percent >= 92;
    /** @type {ViewerWatchPosition} */
    const row = {
        viewerId: String(input.viewerId || 'local-viewer'),
        reelId,
        position: completed ? duration : position,
        duration,
        completed,
        percent: completed ? 100 : percent,
        updatedAt: Date.now()
    };
    const map = loadWatchPositionMap();
    map[reelId] = row;
    persistWatchPositionMap(map);
    // Keep percent map in sync for existing badge rails
    updateWatchProgress(null, reelId, row.percent);
    return row;
}

/** @param {string} reelId */
export function getPlaybackPosition(reelId) {
    const id = String(reelId || '').trim();
    if (!id) return null;
    return loadWatchPositionMap()[id] || null;
}

/**
 * Continue Watching rail rows sorted by recency.
 * @param {{ limit?: number; viewerId?: string }} [options]
 * @returns {ViewerWatchPosition[]}
 */
export function listContinueWatching(options = {}) {
    const limit = Math.max(1, Math.min(40, Number(options.limit) || 12));
    const viewerId = String(options.viewerId || '').trim();
    return Object.values(loadWatchPositionMap())
        .filter((row) => {
            if (!row || row.completed) return false;
            if (viewerId && row.viewerId !== viewerId) return false;
            return Number(row.position) > 0 && Number(row.duration) > 0;
        })
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, limit);
}

/**
 * @param {number} position
 * @param {number} duration
 */
export function formatRemainingLabel(position, duration) {
    const rem = Math.max(0, Math.floor((Number(duration) || 0) - (Number(position) || 0)));
    const m = Math.floor(rem / 60);
    const s = rem % 60;
    return `${m}:${String(s).padStart(2, '0')} remaining`;
}

/**
 * @param {string | null | undefined} episodeId
 * @param {string | null | undefined} reelId
 * @param {{
 *   preferApi?: boolean;
 *   syncToLocal?: boolean;
 *   restoreContext?: 'session_start' | 'manual' | 'background';
 * }} [options]
 */
export async function resolveWatchProgress(episodeId, reelId, options = {}) {
    const episodeKey = episodeId ? String(episodeId) : '';
    const reelKey = reelId ? String(reelId) : '';
    const preferApi = options.preferApi !== false;
    const syncToLocal = options.syncToLocal !== false;
    const restoreContext = options.restoreContext || 'manual';

    const localPercent = getStoredWatchPercent(episodeKey, reelKey);
    const base = {
        episodeId: episodeKey || null,
        reelId: reelKey || null,
        localPercent,
        preferApi
    };

    logWatchProgressDiag('WATCH_PROGRESS', {
        ...base,
        phase: 'resolve_start'
    });

    if (!preferApi || !episodeKey) {
        const resolved = {
            percent: localPercent,
            source: localPercent == null ? 'none' : 'local',
            localPercent,
            apiPercent: null,
            synced: false,
            apiAttempted: false
        };
        logWatchProgressDiag('WATCH_RESTORE', {
            ...base,
            source: resolved.source,
            restoreContext
        });
        return resolved;
    }

    try {
        const remote = await fetchWatchProgress(episodeKey);
        if (remote?.disabled) {
            logWatchProgressDiag('WATCH_SYNC', {
                ...base,
                phase: 'api_disabled'
            });
            return {
                percent: localPercent,
                source: localPercent == null ? 'none' : 'local',
                localPercent,
                apiPercent: null,
                synced: false,
                apiAttempted: true
            };
        }

        const apiPercent = normalizeProgressValue(
            remote?.completion_percent ??
                remote?.completionPercent ??
                remote?.progress_percent ??
                remote?.percent
        );
        const resolvedPercent = apiPercent ?? localPercent;
        const shouldSync =
            syncToLocal &&
            apiPercent != null &&
            (localPercent == null || Math.abs(apiPercent - localPercent) >= 1);

        if (shouldSync) {
            updateWatchProgress(episodeKey, reelKey, apiPercent);
        }

        logWatchProgressDiag('WATCH_SYNC', {
            ...base,
            phase: 'api_resolved',
            apiPercent,
            synced: shouldSync
        });
        logWatchProgressDiag('WATCH_RESTORE', {
            ...base,
            source: apiPercent != null ? 'api' : localPercent != null ? 'local' : 'none',
            resolvedPercent,
            restoreContext
        });

        return {
            percent: resolvedPercent,
            source: apiPercent != null ? 'api' : localPercent != null ? 'local' : 'none',
            localPercent,
            apiPercent,
            synced: shouldSync,
            apiAttempted: true
        };
    } catch (error) {
        logWatchProgressDiag('WATCH_SYNC', {
            ...base,
            phase: 'api_error',
            error: error instanceof Error ? error.message : String(error)
        });
        logWatchProgressDiag('WATCH_RESTORE', {
            ...base,
            source: localPercent != null ? 'local' : 'none',
            restoreContext
        });
        return {
            percent: localPercent,
            source: localPercent != null ? 'local' : 'none',
            localPercent,
            apiPercent: null,
            synced: false,
            apiAttempted: true
        };
    }
}
