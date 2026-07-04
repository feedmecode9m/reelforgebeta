import { getOrCreateViewerId } from '../api/watch.js';
import {
    fetchDashboardAnalytics,
    fetchSeriesAnalytics,
    isAnalyticsApiAvailable,
    logAnalyticsAggregate,
    logAnalyticsEvent,
    metricEventToAnalyticsPayload,
    normalizeAnalyticsSnapshot,
    postAnalyticsEvent
} from '../api/analyticsApi.js';
import { loadWatchProgressMap } from '../series/seriesWatchProgress.js';

export const METRICS_STORAGE_KEY = 'reelforge_platform_metrics';
const MAX_EVENTS = 2000;
const SNAPSHOT_REFRESH_MS = 5000;

/** @typedef {'theater_open' | 'episode_completion' | 'watch_duration' | 'studio_usage' | 'publish_action' | 'repair_action' | 'workflow_completion'} MetricType */

/** @type {readonly MetricType[]} */
export const METRIC_TYPES = /** @type {const} */ ([
    'theater_open',
    'episode_completion',
    'watch_duration',
    'studio_usage',
    'publish_action',
    'repair_action',
    'workflow_completion'
]);

/**
 * @typedef {Object} MetricEvent
 * @property {string} id
 * @property {MetricType} type
 * @property {number} timestamp
 * @property {string} viewerId
 * @property {string} [seriesId]
 * @property {string} [episodeId]
 * @property {string} [reelId]
 * @property {string} [episodeTitle]
 * @property {number} [value]
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {Object} OperationsSnapshot
 * @property {number} dailyActiveViewers
 * @property {number} seriesCompletionRate
 * @property {{ episodeId: string; title: string; views: number }[]} mostWatchedEpisodes
 * @property {number} studioProductivity
 * @property {number} publishingVelocity
 * @property {number} generatedAt
 */

/** @returns {{ version: number; events: MetricEvent[] }} */
function loadStore() {
    if (typeof window === 'undefined') return { version: 1, events: [] };
    try {
        const raw = localStorage.getItem(METRICS_STORAGE_KEY);
        if (!raw) return { version: 1, events: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.events)) return { version: 1, events: [] };
        return { version: 1, events: parsed.events };
    } catch {
        return { version: 1, events: [] };
    }
}

/** @param {{ version: number; events: MetricEvent[] }} store */
function persistStore(store) {
    if (typeof window === 'undefined') return false;
    try {
        const trimmed = {
            version: 1,
            events: store.events.slice(-MAX_EVENTS)
        };
        localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(trimmed));
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('reelforge:metrics-updated'));
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {string} phase
 * @param {Record<string, unknown>} [detail]
 */
export function logMetricsDiag(phase, detail = {}) {
    if (phase === 'record') {
        logAnalyticsEvent({ phase, ...detail });
        return;
    }
    if (phase === 'aggregate') {
        logAnalyticsAggregate({ phase, ...detail });
        return;
    }
    logAnalyticsEvent({ phase, ...detail });
}

/** @type {Map<string, { snapshot: OperationsSnapshot; fetchedAt: number }>} */
const snapshotCache = new Map();
let snapshotRefreshTimer = null;
let analyticsApiReady = null;

function snapshotCacheKey(seriesId) {
    return seriesId || '__global__';
}

/**
 * @param {string} [seriesId]
 * @returns {Promise<OperationsSnapshot | null>}
 */
async function fetchSnapshotFromApi(seriesId) {
    const available = await isAnalyticsApiAvailable();
    if (!available) return null;

    const response = seriesId ? await fetchSeriesAnalytics(seriesId) : await fetchDashboardAnalytics();
    if (!response || response.disabled) return null;

    const snapshot = normalizeAnalyticsSnapshot(response);
    const key = snapshotCacheKey(seriesId);
    snapshotCache.set(key, { snapshot, fetchedAt: Date.now() });

    logAnalyticsAggregate({
        source: seriesId ? 'series' : 'dashboard',
        seriesId: seriesId || null,
        ...snapshot,
        eventCount: response.eventCount ?? response.event_count ?? null
    });

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reelforge:metrics-updated'));
    }

    return snapshot;
}

/**
 * @param {string} [seriesId]
 */
function scheduleSnapshotRefresh(seriesId) {
    const key = snapshotCacheKey(seriesId);
    const cached = snapshotCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < SNAPSHOT_REFRESH_MS) return;

    void fetchSnapshotFromApi(seriesId);
}

/**
 * @param {string} [seriesId]
 * @returns {OperationsSnapshot}
 */
function computeLocalSnapshot(seriesId) {
    const store = loadStore();
    const today = dayKey();
    const todayEvents = eventsForDay(store.events, today);
    const weekEvents = eventsInLastDays(store.events, 7);

    const scopedToday = seriesId
        ? todayEvents.filter((e) => !e.seriesId || e.seriesId === seriesId)
        : todayEvents;
    const scopedWeek = seriesId
        ? weekEvents.filter((e) => !e.seriesId || e.seriesId === seriesId)
        : weekEvents;

    const dailyActiveViewers = new Set(
        scopedToday.map((e) => e.viewerId).filter(Boolean)
    ).size;

    const theaterOpens = scopedToday.filter((e) => e.type === 'theater_open').length;
    const completions = scopedToday.filter((e) => e.type === 'episode_completion').length;
    const watchProgress = loadWatchProgressMap();
    const completedFromProgress = Object.values(watchProgress).filter((v) => v >= 95).length;
    const completionDenominator = Math.max(theaterOpens, completions, 1);
    const seriesCompletionRate = Math.min(
        100,
        Math.round(((completions + completedFromProgress * 0.25) / completionDenominator) * 100)
    );

    /** @type {Record<string, { episodeId: string; title: string; views: number }>} */
    const episodeViews = {};
    for (const event of scopedWeek) {
        if (event.type !== 'theater_open' && event.type !== 'episode_completion') continue;
        const key = event.episodeId || event.reelId;
        if (!key) continue;
        if (!episodeViews[key]) {
            episodeViews[key] = {
                episodeId: event.episodeId || key,
                title: event.episodeTitle || event.episodeId || key,
                views: 0
            };
        }
        episodeViews[key].views += 1;
        if (event.episodeTitle) episodeViews[key].title = event.episodeTitle;
    }

    const mostWatchedEpisodes = Object.values(episodeViews)
        .sort((a, b) => b.views - a.views)
        .slice(0, 5);

    const studioProductivity =
        scopedToday.filter((e) => e.type === 'studio_usage').length +
        scopedToday.filter((e) => e.type === 'repair_action').length +
        scopedToday.filter((e) => e.type === 'workflow_completion').length;

    const publishingVelocity = scopedWeek
        .filter((e) => e.type === 'publish_action')
        .reduce((sum, e) => sum + (e.value || 1), 0);

    return {
        dailyActiveViewers,
        seriesCompletionRate,
        mostWatchedEpisodes,
        studioProductivity,
        publishingVelocity,
        generatedAt: Date.now()
    };
}

/**
 * @param {MetricType} type
 * @param {Omit<MetricEvent, 'id' | 'type' | 'timestamp' | 'viewerId'>} [payload]
 */
export function recordMetric(type, payload = {}) {
    const store = loadStore();
    /** @type {MetricEvent} */
    const event = {
        id: crypto.randomUUID(),
        type,
        timestamp: Date.now(),
        viewerId: getOrCreateViewerId(),
        ...payload
    };
    store.events.push(event);
    persistStore(store);
    logAnalyticsEvent({
        phase: 'record',
        type,
        seriesId: event.seriesId || null,
        episodeId: event.episodeId || null,
        value: event.value ?? null
    });

    void postAnalyticsEvent(metricEventToAnalyticsPayload(event)).then((result) => {
        if (result?.disabled) return;
        scheduleSnapshotRefresh(event.seriesId);
    });

    return event;
}

/** @param {Record<string, unknown> | null | undefined} reel @param {Record<string, unknown>} [extra] */
export function recordTheaterOpen(reel, extra = {}) {
    return recordMetric('theater_open', {
        reelId: reel?.id != null ? String(reel.id) : undefined,
        episodeId: reel?.episodeId || reel?.episode_id ? String(reel.episodeId || reel.episode_id) : undefined,
        seriesId: extra.seriesId ? String(extra.seriesId) : undefined,
        episodeTitle: reel?.title || reel?.name ? String(reel.title || reel.name) : undefined,
        meta: extra
    });
}

/** @param {{ episodeId?: string | null; reelId?: string | null; seriesId?: string | null; episodeTitle?: string | null; durationMs?: number }} params */
export function recordEpisodeCompletion(params = {}) {
    if (params.durationMs) {
        recordMetric('watch_duration', {
            episodeId: params.episodeId || undefined,
            reelId: params.reelId || undefined,
            seriesId: params.seriesId || undefined,
            episodeTitle: params.episodeTitle || undefined,
            value: params.durationMs
        });
    }
    return recordMetric('episode_completion', {
        episodeId: params.episodeId || undefined,
        reelId: params.reelId || undefined,
        seriesId: params.seriesId || undefined,
        episodeTitle: params.episodeTitle || undefined,
        value: 100,
        meta: { completed: true }
    });
}

/** @param {{ episodeId?: string | null; reelId?: string | null; seriesId?: string | null; durationMs?: number }} params */
export function recordWatchDuration(params = {}) {
    if (!params.durationMs || params.durationMs <= 0) return null;
    return recordMetric('watch_duration', {
        episodeId: params.episodeId || undefined,
        reelId: params.reelId || undefined,
        seriesId: params.seriesId || undefined,
        value: Math.round(params.durationMs)
    });
}

/** @param {{ seriesId?: string | null; source?: string }} [params] */
export function recordStudioUsage(params = {}) {
    return recordMetric('studio_usage', {
        seriesId: params.seriesId || undefined,
        value: 1,
        meta: { source: params.source || 'control-center' }
    });
}

/** @param {{ seriesId?: string | null; episodeCount?: number; cadence?: string }} params */
export function recordPublishAction(params = {}) {
    return recordMetric('publish_action', {
        seriesId: params.seriesId || undefined,
        value: params.episodeCount || 1,
        meta: { cadence: params.cadence || 'manual' }
    });
}

/** @param {{ seriesId?: string | null; issueType?: string; reelId?: string | null }} params */
export function recordRepairAction(params = {}) {
    return recordMetric('repair_action', {
        seriesId: params.seriesId || undefined,
        reelId: params.reelId || undefined,
        value: 1,
        meta: { issueType: params.issueType || 'unknown' }
    });
}

/** @param {{ seriesId?: string | null; taskId?: string; actionType?: string }} params */
export function recordWorkflowCompletion(params = {}) {
    return recordMetric('workflow_completion', {
        seriesId: params.seriesId || undefined,
        value: 1,
        meta: { taskId: params.taskId || null, actionType: params.actionType || null }
    });
}

/** @param {Record<string, unknown>} entry */
function entryUpdatedAt(entry) {
    const value = entry?.updatedAt;
    return Number.isFinite(value) ? Number(value) : 0;
}

/**
 * Latest-modified-wins merge for keyed metric aggregates.
 * @param {Record<string, Record<string, unknown>>} base
 * @param {Record<string, Record<string, unknown>>} incoming
 */
export function mergeEntryMaps(base, incoming) {
    /** @type {Record<string, Record<string, unknown>>} */
    const merged = { ...base };
    for (const [key, incomingEntry] of Object.entries(incoming || {})) {
        const baseEntry = merged[key];
        if (!baseEntry || entryUpdatedAt(incomingEntry) >= entryUpdatedAt(baseEntry)) {
            merged[key] = incomingEntry;
        }
    }
    return merged;
}

/** @param {number} [timestamp] */
function dayKey(timestamp = Date.now()) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

/** @param {MetricEvent[]} events */
function eventsForDay(events, day = dayKey()) {
    return events.filter((e) => dayKey(e.timestamp) === day);
}

/** @param {MetricEvent[]} events @param {number} days */
function eventsInLastDays(events, days) {
    const cutoff = Date.now() - days * 86400000;
    return events.filter((e) => e.timestamp >= cutoff);
}

/**
 * @param {string} [seriesId]
 * @returns {OperationsSnapshot}
 */
export function getOperationsSnapshot(seriesId) {
    const key = snapshotCacheKey(seriesId);
    const cached = snapshotCache.get(key);
    if (cached) {
        logAnalyticsAggregate({
            phase: 'aggregate',
            source: 'cache',
            seriesId: seriesId || null,
            ...cached.snapshot,
            eventCount: loadStore().events.length
        });
        scheduleSnapshotRefresh(seriesId);
        return cached.snapshot;
    }

    scheduleSnapshotRefresh(seriesId);

    const snapshot = computeLocalSnapshot(seriesId);
    logAnalyticsAggregate({
        phase: 'aggregate',
        source: 'local',
        seriesId: seriesId || null,
        ...snapshot,
        eventCount: loadStore().events.length
    });
    return snapshot;
}

/** Reset metrics (tests/dev). */
export function resetPlatformMetrics() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(METRICS_STORAGE_KEY);
    snapshotCache.clear();
    logAnalyticsEvent({ phase: 'reset' });
}

let metricsListenersBound = false;

function startSnapshotRefreshLoop() {
    if (typeof window === 'undefined' || snapshotRefreshTimer) return;
    snapshotRefreshTimer = window.setInterval(() => {
        void fetchSnapshotFromApi();
    }, SNAPSHOT_REFRESH_MS);
}

/** Wire cross-module metric events and expose test hooks. */
export function initPlatformMetrics() {
    if (typeof window === 'undefined' || metricsListenersBound) return;
    metricsListenersBound = true;

    window.addEventListener('reelforge:metrics-publish', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        recordPublishAction({
            seriesId: detail.seriesId,
            episodeCount: detail.episodeCount,
            cadence: detail.cadence
        });
    });

    window.addEventListener('reelforge:metrics-workflow', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        recordWorkflowCompletion({
            seriesId: detail.seriesId,
            taskId: detail.taskId,
            actionType: detail.actionType
        });
    });

    window.addEventListener('reelforge:metrics-repair', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        recordRepairAction({
            seriesId: detail.seriesId,
            reelId: detail.reelId,
            issueType: detail.issueType
        });
    });

    window.__reelforgeMetrics = {
        recordMetric,
        getOperationsSnapshot,
        resetPlatformMetrics,
        mergeEntryMaps,
        METRIC_TYPES,
        refreshAnalyticsSnapshot: fetchSnapshotFromApi
    };

    analyticsApiReady = isAnalyticsApiAvailable().then((available) => {
        if (available) {
            void fetchSnapshotFromApi();
        }
        return available;
    });

    startSnapshotRefreshLoop();
    logAnalyticsEvent({ phase: 'init' });
}
