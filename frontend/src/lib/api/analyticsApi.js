import { API_BASE_URL, fetchWithRetry } from '../api.js';

const THROTTLE_MS = 500;
const MAX_FAILURES = 3;
const CIRCUIT_OPEN_MS = 30_000;
const SCROLL_IDLE_MS = 300;

const STATUS_CACHE_TTL_MS = 15_000;
const AGGREGATE_LOG_COOLDOWN_MS = 1_500;
let analyticsStatusCache = /** @type {{ value: Record<string, unknown>; fetchedAt: number } | null} */ (null);
let analyticsStatusInFlight = /** @type {Promise<Record<string, unknown>> | null} */ (null);
let lastAggregateLogKey = '';
let lastAggregateLogAt = 0;
let lastCallTime = 0;
let failureCount = 0;
let circuitOpenUntil = 0;
let activeRequest = /** @type {AbortController | null} */ (null);
let scrollTimeout = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
let scrollSettled = true;
let scrollListenerBound = false;

function shouldThrottle() {
    const now = Date.now();
    if (now - lastCallTime < THROTTLE_MS) return true;
    lastCallTime = now;
    return false;
}

function isCircuitOpen() {
    const now = Date.now();
    if (circuitOpenUntil > now) return true;
    if (failureCount >= MAX_FAILURES) {
        circuitOpenUntil = now + CIRCUIT_OPEN_MS;
        console.warn('Analytics circuit breaker opened for 30 seconds');
        return true;
    }
    return false;
}

function markSuccess() {
    failureCount = 0;
}

/**
 * @param {unknown} err
 */
function isAbortError(err) {
    return (
        (typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError') ||
        String(err?.message || '').toLowerCase().includes('aborted')
    );
}

/**
 * @param {unknown} err
 */
function markFailure(err) {
    if (isAbortError(err)) return;
    failureCount += 1;
    console.warn(`Analytics failed (${failureCount}/${MAX_FAILURES})`);
    if (failureCount >= MAX_FAILURES && circuitOpenUntil <= Date.now()) {
        circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
        console.warn('Analytics circuit breaker opened for 30 seconds');
    }
}

function bindScrollAbortHandler() {
    if (typeof window === 'undefined' || scrollListenerBound) return;
    scrollListenerBound = true;
    window.addEventListener(
        'scroll',
        () => {
            if (activeRequest) {
                activeRequest.abort();
                activeRequest = null;
            }
            if (scrollTimeout) clearTimeout(scrollTimeout);
            scrollSettled = false;
            scrollTimeout = setTimeout(() => {
                scrollSettled = true;
            }, SCROLL_IDLE_MS);
        },
        { passive: true }
    );
}

function shouldSkipRequest() {
    if (isCircuitOpen()) return true;
    if (shouldThrottle()) return true;
    if (!scrollSettled) return true;
    return false;
}

bindScrollAbortHandler();

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
function logAnalyticsDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {Record<string, unknown>} detail */
export function logAnalyticsEvent(detail = {}) {
    logAnalyticsDiag('ANALYTICS_EVENT', detail);
}

/** @param {Record<string, unknown>} detail */
export function logAnalyticsAggregate(detail = {}) {
    const now = Date.now();
    const key = JSON.stringify(detail);
    if (
        key &&
        key === lastAggregateLogKey &&
        now - lastAggregateLogAt < AGGREGATE_LOG_COOLDOWN_MS
    ) {
        return;
    }
    lastAggregateLogKey = key;
    lastAggregateLogAt = now;
    logAnalyticsDiag('ANALYTICS_AGGREGATE', detail);
}

async function analyticsFetch(path, options = {}, meta = {}) {
    if (shouldSkipRequest()) {
        return { disabled: true, error: 'Analytics request skipped' };
    }

    const method = options.method || 'GET';
    const isWrite = method !== 'GET' && method !== 'HEAD';
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    activeRequest = controller;
    let signal = controller?.signal;
    if (options.signal && signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
        signal = AbortSignal.any([options.signal, signal]);
    } else if (options.signal) {
        signal = options.signal;
    }
    const requestOptions = signal ? { ...options, signal } : options;

    try {
        const res = await fetchWithRetry(`${API_BASE_URL}${path}`, requestOptions, {
            retries: 1,
            notifyReconnectOnFailure: false
        });
        if (res.status === 404) {
            const body = await res.json().catch(() => ({}));
            markSuccess();
            return { disabled: true, error: body.error || 'Analytics API disabled' };
        }
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Analytics API failed (${res.status})`);
        }

        const body = await res.json();
        markSuccess();
        if (isWrite) {
            logAnalyticsEvent({ path, method, ...meta });
        } else {
            logAnalyticsAggregate({ path, method, ...meta });
        }
        return body;
    } catch (err) {
        markFailure(err);
        throw err;
    } finally {
        if (activeRequest === controller) {
            activeRequest = null;
        }
    }
}

/** @returns {Promise<{ enabled?: boolean; count?: number; disabled?: boolean; error?: string }>} */
export async function fetchAnalyticsApiStatus() {
    if (shouldSkipRequest()) {
        return analyticsStatusCache?.value || { disabled: true, error: 'Analytics request skipped' };
    }

    const now = Date.now();
    if (analyticsStatusCache && now - analyticsStatusCache.fetchedAt < STATUS_CACHE_TTL_MS) {
        return analyticsStatusCache.value;
    }
    if (analyticsStatusInFlight) {
        return analyticsStatusInFlight;
    }

    analyticsStatusInFlight = (async () => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    activeRequest = controller;
    try {
        const signal =
            controller && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
                ? AbortSignal.any([AbortSignal.timeout(4000), controller.signal])
                : AbortSignal.timeout(4000);
        const res = await fetchWithRetry(
            `${API_BASE_URL}/api/analytics/status`,
            { signal },
            { retries: 0, retryDelayMs: 250, notifyReconnectOnFailure: false }
        );
        if (res.status === 404) {
            const body = await res.json().catch(() => ({}));
            const value = { disabled: true, error: body.error || 'Analytics API disabled' };
            analyticsStatusCache = { value, fetchedAt: Date.now() };
            markSuccess();
            return value;
        }
        if (!res.ok) {
            const value = { disabled: true, error: `Analytics API failed (${res.status})` };
            analyticsStatusCache = { value, fetchedAt: Date.now() };
            markFailure(new Error(value.error));
            return value;
        }
        const body = await res.json();
        logAnalyticsAggregate({ path: '/api/analytics/status', source: 'status' });
        analyticsStatusCache = { value: body, fetchedAt: Date.now() };
        markSuccess();
        return body;
    } catch (err) {
        const value = { disabled: true, error: err?.message || 'Analytics API unavailable' };
        analyticsStatusCache = { value, fetchedAt: Date.now() };
        markFailure(err);
        return value;
    } finally {
        analyticsStatusInFlight = null;
        if (activeRequest === controller) {
            activeRequest = null;
        }
    }
    })();

    return analyticsStatusInFlight;
}

/** @returns {Promise<boolean>} */
export async function isAnalyticsApiAvailable() {
    const status = await fetchAnalyticsApiStatus();
    return !status.disabled && status.enabled !== false;
}

/**
 * @param {{
 *   id?: string;
 *   eventType: string;
 *   userId?: string;
 *   seriesId?: string;
 *   episodeId?: string;
 *   payload?: Record<string, unknown>;
 * }} event
 */
export async function postAnalyticsEvent(event) {
    try {
        return await analyticsFetch(
            '/api/analytics',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event)
            },
            {
                eventType: event.eventType,
                seriesId: event.seriesId || null,
                episodeId: event.episodeId || null
            }
        );
    } catch (err) {
        return { disabled: true, error: err?.message || 'Analytics API unavailable' };
    }
}

/** @returns {Promise<import('../observability/platformMetrics.js').OperationsSnapshot | { disabled: boolean; error?: string }>} */
export async function fetchDashboardAnalytics() {
    try {
        return await analyticsFetch('/api/analytics/dashboard', {}, { source: 'dashboard' });
    } catch (err) {
        return { disabled: true, error: err?.message || 'Analytics API unavailable' };
    }
}

/** @param {string} seriesId */
export async function fetchSeriesAnalytics(seriesId) {
    try {
        return await analyticsFetch(
            `/api/analytics/series/${encodeURIComponent(seriesId)}`,
            {},
            { seriesId, source: 'series' }
        );
    } catch (err) {
        return { disabled: true, error: err?.message || 'Analytics API unavailable' };
    }
}

/**
 * @param {import('../observability/platformMetrics.js').MetricEvent} event
 */
export function metricEventToAnalyticsPayload(event) {
    return {
        id: event.id,
        eventType: event.type,
        userId: event.viewerId,
        seriesId: event.seriesId,
        episodeId: event.episodeId,
        payload: {
            reelId: event.reelId || null,
            episodeTitle: event.episodeTitle || null,
            value: event.value ?? null,
            meta: event.meta || null,
            viewerId: event.viewerId
        }
    };
}

/**
 * @param {Record<string, unknown>} apiSnapshot
 * @returns {import('../observability/platformMetrics.js').OperationsSnapshot}
 */
export function normalizeAnalyticsSnapshot(apiSnapshot) {
    const mostWatched = Array.isArray(apiSnapshot.mostWatchedEpisodes)
        ? apiSnapshot.mostWatchedEpisodes.map((entry) => ({
              episodeId: String(entry.episodeId || entry.episode_id || 'unknown'),
              title: String(entry.title || entry.episodeId || entry.episode_id || 'Episode'),
              views: Number(entry.views) || 0
          }))
        : [];

    const generatedAtRaw = apiSnapshot.generatedAt || apiSnapshot.generated_at;
    const generatedAt =
        typeof generatedAtRaw === 'string'
            ? Date.parse(generatedAtRaw) || Date.now()
            : Number(generatedAtRaw) || Date.now();

    return {
        dailyActiveViewers: Number(apiSnapshot.dailyActiveViewers ?? apiSnapshot.daily_active_viewers) || 0,
        seriesCompletionRate:
            Number(apiSnapshot.seriesCompletionRate ?? apiSnapshot.series_completion_rate) || 0,
        mostWatchedEpisodes: mostWatched,
        studioProductivity:
            Number(apiSnapshot.studioProductivity ?? apiSnapshot.studio_productivity) || 0,
        publishingVelocity:
            Number(apiSnapshot.publishingVelocity ?? apiSnapshot.publishing_velocity) || 0,
        generatedAt
    };
}
