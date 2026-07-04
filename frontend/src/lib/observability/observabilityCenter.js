/**
 * Phase 25 — enterprise observability center.
 * Platform-wide health monitoring composed from metrics, workflow, notifications, and API telemetry.
 */

import { METRICS_STORAGE_KEY, getOperationsSnapshot } from './platformMetrics.js';
import { WORKFLOW_TASK_STORAGE_KEY } from '../workflow/workflowEngine.js';
import { NOTIFICATION_STORAGE_KEY } from '../notifications/notificationCenter.js';

export const OBSERVABILITY_LATENCY_KEY = 'reelforge_observability_latency';

export const TRACKED_SIGNALS = /** @type {const} */ ([
    'api_latency',
    'database_latency',
    'workflow_throughput',
    'notification_throughput',
    'publishing_throughput',
    'viewer_engagement'
]);

/**
 * @typedef {Object} EnterpriseObservabilitySnapshot
 * @property {string} [seriesId]
 * @property {number} apiLatencyMs
 * @property {number} databaseLatencyMs
 * @property {number} workflowThroughput
 * @property {number} notificationThroughput
 * @property {number} publishingThroughput
 * @property {number} viewerEngagement
 * @property {number} healthScore
 * @property {{ level: 'info' | 'warning' | 'critical'; code: string; message: string }[]} alerts
 * @property {Record<typeof TRACKED_SIGNALS[number], number | string>} signals
 * @property {number} generatedAt
 */

/**
 * @param {'OBSERVABILITY' | 'HEALTH_SCORE' | 'SYSTEM_ALERT'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logObservabilityDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {{ api: number[]; database: number[] }} */
function loadLatencySamples() {
    if (typeof window === 'undefined') return { api: [], database: [] };
    try {
        const raw = localStorage.getItem(OBSERVABILITY_LATENCY_KEY);
        if (!raw) return { api: [], database: [] };
        const parsed = JSON.parse(raw);
        return {
            api: Array.isArray(parsed.api) ? parsed.api.map(Number).filter(Number.isFinite) : [],
            database: Array.isArray(parsed.database)
                ? parsed.database.map(Number).filter(Number.isFinite)
                : []
        };
    } catch {
        return { api: [], database: [] };
    }
}

/** @param {{ api: number[]; database: number[] }} samples */
function persistLatencySamples(samples) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(
            OBSERVABILITY_LATENCY_KEY,
            JSON.stringify({
                api: samples.api.slice(-100),
                database: samples.database.slice(-100)
            })
        );
    } catch {
        // non-fatal
    }
}

/**
 * @param {'api' | 'database'} type
 * @param {number} ms
 * @param {Record<string, unknown>} [meta]
 */
export function recordLatencySample(type, ms, meta = {}) {
    if (!Number.isFinite(ms) || ms < 0) return;
    const samples = loadLatencySamples();
    if (type === 'database') {
        samples.database.push(Math.round(ms));
    } else {
        samples.api.push(Math.round(ms));
    }
    persistLatencySamples(samples);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('reelforge:observability-updated', {
                detail: { type, ms, ...meta }
            })
        );
    }
}

/** @param {number[]} values */
function average(values, fallback = 0) {
    if (!values.length) return fallback;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** @param {number} timestamp @param {number} days */
function isWithinDays(timestamp, days) {
    return timestamp >= Date.now() - days * 86400000;
}

/** @returns {{ version: number; events: Record<string, unknown>[] }} */
function loadMetricEvents() {
    if (typeof window === 'undefined') return { version: 1, events: [] };
    try {
        const raw = localStorage.getItem(METRICS_STORAGE_KEY);
        if (!raw) return { version: 1, events: [] };
        const parsed = JSON.parse(raw);
        return parsed?.events ? parsed : { version: 1, events: [] };
    } catch {
        return { version: 1, events: [] };
    }
}

/** @returns {Record<string, unknown>[]} */
function loadWorkflowTasks() {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(WORKFLOW_TASK_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.tasks) ? parsed.tasks : [];
    } catch {
        return [];
    }
}

/** @returns {Record<string, unknown>[]} */
function loadNotifications() {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.items) ? parsed.items : [];
    } catch {
        return [];
    }
}

/** @param {string} url */
function isDatabasePath(url) {
    return /\/api\/(workflow|analytics|notifications|teams|pipeline|series|sync|postgres)/.test(url);
}

/**
 * @param {string} [seriesId]
 * @returns {EnterpriseObservabilitySnapshot}
 */
export function buildEnterpriseObservabilitySnapshot(seriesId) {
    const latency = loadLatencySamples();
    const events = loadMetricEvents().events;
    const scopedEvents = seriesId
        ? events.filter((event) => !event.seriesId || event.seriesId === seriesId)
        : events;
    const recentEvents = scopedEvents.filter((event) => isWithinDays(event.timestamp, 7));
    const ops = getOperationsSnapshot(seriesId);

    const workflowTasks = loadWorkflowTasks().filter(
        (task) => !seriesId || task.seriesId === seriesId
    );
    const workflowCompletions = recentEvents.filter((event) => event.type === 'workflow_completion').length;
    const workflowThroughput =
        workflowCompletions +
        workflowTasks.filter((task) => task.status === 'COMPLETE' && isWithinDays(task.completedAt || task.createdAt, 7))
            .length;

    const notificationItems = loadNotifications();
    const notificationThroughput = notificationItems.filter((item) =>
        isWithinDays(item.createdAt || item.timestamp || Date.now(), 7)
    ).length;

    const publishingThroughput = recentEvents
        .filter((event) => event.type === 'publish_action')
        .reduce((sum, event) => sum + (Number(event.value) || 1), 0);

    const theaterOpens = recentEvents.filter((event) => event.type === 'theater_open').length;
    const completions = recentEvents.filter((event) => event.type === 'episode_completion').length;
    const viewerEngagement = Math.round(
        ops.dailyActiveViewers * 10 +
            theaterOpens * 4 +
            completions * 6 +
            ops.seriesCompletionRate * 0.35
    );

    const apiLatencyMs = average(latency.api, 120);
    const databaseLatencyMs = average(latency.database, average(latency.api, 120) + 40);

    const signals = {
        api_latency: apiLatencyMs,
        database_latency: databaseLatencyMs,
        workflow_throughput: workflowThroughput,
        notification_throughput: notificationThroughput,
        publishing_throughput: publishingThroughput,
        viewer_engagement: viewerEngagement
    };

    const healthScore = computePlatformHealthScore({
        apiLatencyMs,
        databaseLatencyMs,
        workflowThroughput,
        notificationThroughput,
        publishingThroughput,
        viewerEngagement,
        completionRate: ops.seriesCompletionRate
    });

    const alerts = generateSystemAlerts({
        apiLatencyMs,
        databaseLatencyMs,
        workflowThroughput,
        notificationThroughput,
        publishingThroughput,
        viewerEngagement,
        healthScore,
        completionRate: ops.seriesCompletionRate
    });

    logObservabilityDiag('OBSERVABILITY', {
        seriesId: seriesId || null,
        signals,
        alertCount: alerts.length
    });

    logObservabilityDiag('HEALTH_SCORE', {
        seriesId: seriesId || null,
        healthScore,
        apiLatencyMs,
        databaseLatencyMs,
        viewerEngagement
    });

    for (const alert of alerts) {
        logObservabilityDiag('SYSTEM_ALERT', {
            seriesId: seriesId || null,
            level: alert.level,
            code: alert.code,
            message: alert.message
        });
    }

    return {
        seriesId,
        apiLatencyMs,
        databaseLatencyMs,
        workflowThroughput,
        notificationThroughput,
        publishingThroughput,
        viewerEngagement,
        healthScore,
        alerts,
        signals,
        generatedAt: Date.now()
    };
}

/**
 * @param {Record<string, number>} input
 */
export function computePlatformHealthScore(input) {
    let score = 100;

    if (input.apiLatencyMs > 800) score -= 25;
    else if (input.apiLatencyMs > 400) score -= 12;

    if (input.databaseLatencyMs > 1000) score -= 25;
    else if (input.databaseLatencyMs > 600) score -= 12;

    if (input.viewerEngagement < 20) score -= 20;
    else if (input.viewerEngagement < 50) score -= 8;

    if (input.workflowThroughput === 0) score -= 8;
    if (input.publishingThroughput === 0) score -= 6;
    if (input.notificationThroughput === 0) score -= 4;

    if (input.completionRate != null && input.completionRate < 40) score -= 10;

    score += Math.min(10, Math.floor(input.publishingThroughput / 2));
    score += Math.min(8, Math.floor(input.workflowThroughput / 3));

    return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * @param {Record<string, number> & { healthScore: number; completionRate?: number }} input
 */
export function generateSystemAlerts(input) {
    /** @type {EnterpriseObservabilitySnapshot['alerts']} */
    const alerts = [];

    if (input.healthScore < 50) {
        alerts.push({
            level: 'critical',
            code: 'HEALTH_CRITICAL',
            message: `Platform health score ${input.healthScore}% is below operational threshold`
        });
    } else if (input.healthScore < 70) {
        alerts.push({
            level: 'warning',
            code: 'HEALTH_DEGRADED',
            message: `Platform health score ${input.healthScore}% is degraded`
        });
    }

    if (input.apiLatencyMs > 400) {
        alerts.push({
            level: input.apiLatencyMs > 800 ? 'critical' : 'warning',
            code: 'API_LATENCY_HIGH',
            message: `Average API latency ${input.apiLatencyMs}ms exceeds target`
        });
    }

    if (input.databaseLatencyMs > 600) {
        alerts.push({
            level: input.databaseLatencyMs > 1000 ? 'critical' : 'warning',
            code: 'DATABASE_LATENCY_HIGH',
            message: `Average database latency ${input.databaseLatencyMs}ms exceeds target`
        });
    }

    if (input.viewerEngagement < 30) {
        alerts.push({
            level: 'warning',
            code: 'VIEWER_ENGAGEMENT_LOW',
            message: 'Viewer engagement signals are below expected levels'
        });
    }

    if (input.workflowThroughput === 0) {
        alerts.push({
            level: 'info',
            code: 'WORKFLOW_IDLE',
            message: 'No workflow throughput recorded in the current window'
        });
    }

    return alerts;
}

let fetchPatched = false;
let observabilityInitialized = false;

function patchFetchForLatency() {
    if (fetchPatched || typeof window === 'undefined') return;
    fetchPatched = true;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
        const started = performance.now();
        const url = String(args[0]);
        try {
            const response = await nativeFetch(...args);
            if (url.includes('/api/')) {
                const elapsed = performance.now() - started;
                recordLatencySample('api', elapsed, { url, status: response.status });
                if (isDatabasePath(url)) {
                    recordLatencySample('database', elapsed, { url, status: response.status });
                }
            }
            return response;
        } catch (error) {
            if (url.includes('/api/')) {
                recordLatencySample('api', performance.now() - started, { url, error: true });
            }
            throw error;
        }
    };
}

export function initObservabilityCenter() {
    if (typeof window === 'undefined' || observabilityInitialized) return;
    observabilityInitialized = true;

    patchFetchForLatency();

    window.addEventListener('reelforge:metrics-updated', () => {
        buildEnterpriseObservabilitySnapshot();
    });
    window.addEventListener('reelforge:notifications-updated', () => {
        buildEnterpriseObservabilitySnapshot();
    });
    window.addEventListener('reelforge:workflow-tasks-updated', () => {
        buildEnterpriseObservabilitySnapshot();
    });

    window.__reelforgeObservability = {
        TRACKED_SIGNALS,
        buildEnterpriseObservabilitySnapshot,
        computePlatformHealthScore,
        generateSystemAlerts,
        recordLatencySample,
        loadLatencySamples,
        logObservabilityDiag
    };

    buildEnterpriseObservabilitySnapshot();
}
