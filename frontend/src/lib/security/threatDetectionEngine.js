/**
 * Phase S2 — ReelForge Sentinel Threat Detection Engine.
 * Live monitoring for upload, workflow, notification, team, and API abuse patterns.
 */

import { postSecurityEvent } from '../api/securityApi.js';
import { applySecurityPolicy } from './securityPolicyEngine.js';

export const SECURITY_EVENTS_STORAGE_KEY = 'reelforge_security_events';
export const THREAT_DETECTION_VERSION = '2.0.0';

/** @typedef {'GREEN' | 'YELLOW' | 'ORANGE' | 'RED'} ThreatLevel */
/** @typedef {'upload' | 'workflow' | 'notification' | 'team' | 'api'} ThreatCategory */

/**
 * @typedef {Object} SecurityEventRecord
 * @property {string} id
 * @property {ThreatCategory} category
 * @property {string} type
 * @property {number} timestamp
 * @property {Record<string, unknown>} detail
 */

/**
 * @typedef {Object} ActiveThreat
 * @property {string} id
 * @property {ThreatCategory} category
 * @property {ThreatLevel} level
 * @property {string} title
 * @property {string} detail
 * @property {string} recommendedAction
 * @property {number} count
 * @property {number} windowMs
 */

/**
 * @typedef {Object} ThreatDetectionSnapshot
 * @property {number} score
 * @property {ThreatLevel} level
 * @property {ActiveThreat[]} activeThreats
 * @property {string} recommendedAction
 * @property {number} eventCount
 * @property {Record<ThreatCategory, number>} categoryCounts
 * @property {number} timestamp
 */

const WINDOW_MS = 60_000;
const LONG_WINDOW_MS = 300_000;
const MAX_STORED_EVENTS = 400;

/** @type {SecurityEventRecord[]} */
let memoryEvents = [];

/** @type {ReturnType<typeof setInterval> | null} */
let sweepTimer = null;

/** @type {ThreatDetectionSnapshot | null} */
let lastSnapshot = null;

/** @type {typeof window.fetch | null} */
let nativeFetch = null;

/** @type {Record<string, number>} */
const lastAlertAt = {};
/** @type {Record<string, number>} */
const lastThreatPostedAt = {};
const THREAT_POST_COOLDOWN_MS = 15_000;

/** @type {Record<string, number[]>} */
const signalTimestamps = {};
/** @type {Record<string, number>} */
const signalCooldownAt = {};

/**
 * @param {string} key
 * @param {number} cooldownMs
 */
function signalCoolingDown(key, cooldownMs = 2000) {
    const now = Date.now();
    const lastAt = signalCooldownAt[key] || 0;
    if (now - lastAt < cooldownMs) return true;
    signalCooldownAt[key] = now;
    return false;
}

const THRESHOLDS = {
    upload: { yellow: 3, orange: 8, red: 15 },
    workflow: { yellow: 4, orange: 10, red: 20 },
    notification: { yellow: 6, orange: 14, red: 25 },
    team: { yellow: 4, orange: 9, red: 16 },
    api: { yellow: 12, orange: 30, red: 50 },
    apiFailures: { yellow: 3, orange: 8, red: 15 }
};

/**
 * @param {'THREAT_EVENT' | 'THREAT_SCORE' | 'THREAT_LEVEL'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logThreatDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {{ version: number; events: SecurityEventRecord[] }} */
export function loadSecurityEvents() {
    if (typeof window === 'undefined') {
        return { version: 1, events: [...memoryEvents] };
    }
    try {
        const raw = localStorage.getItem(SECURITY_EVENTS_STORAGE_KEY);
        if (!raw) return { version: 1, events: [...memoryEvents] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.events)) return { version: 1, events: [...memoryEvents] };
        memoryEvents = parsed.events.slice(-MAX_STORED_EVENTS);
        return { version: 1, events: [...memoryEvents] };
    } catch {
        return { version: 1, events: [...memoryEvents] };
    }
}

/** @param {SecurityEventRecord[]} events */
export function persistSecurityEvents(events) {
    memoryEvents = events.slice(-MAX_STORED_EVENTS);
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(
            SECURITY_EVENTS_STORAGE_KEY,
            JSON.stringify({ version: 1, events: memoryEvents, updatedAt: Date.now() })
        );
    } catch {
        /* ignore quota errors */
    }
}

/**
 * @param {ThreatCategory} category
 * @param {string} type
 * @param {Record<string, unknown>} [detail]
 */
export function recordThreatEvent(category, type, detail = {}) {
    const event = /** @type {SecurityEventRecord} */ ({
        id: `${category}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        category,
        type,
        timestamp: Date.now(),
        detail
    });

    const store = loadSecurityEvents();
    store.events.push(event);
    persistSecurityEvents(store.events);

    logThreatDiag('THREAT_EVENT', {
        category,
        type,
        ...detail
    });

    const snapshot = analyzeThreats({ emitDiagnostics: true });
    const postKey = `${category}:${type}`;
    const now = Date.now();
    const shouldPostToApi =
        !lastThreatPostedAt[postKey] || now - lastThreatPostedAt[postKey] >= THREAT_POST_COOLDOWN_MS;
    if (shouldPostToApi) {
        lastThreatPostedAt[postKey] = now;
        void postSecurityEvent({
            id: event.id,
            source: 'threat_detection',
            eventType: type,
            category,
            severity: snapshot.level,
            title: `Threat event: ${category}`,
            message: type,
            payload: {
                ...detail,
                category,
                type,
                localTimestamp: event.timestamp
            },
            eventTimestamp: new Date(event.timestamp).toISOString()
        });
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reelforge:threat-updated', { detail: snapshot }));
    }

    return { event, snapshot };
}

/** @param {string} key @param {number} [windowMs] */
function pushSignal(key, windowMs = WINDOW_MS) {
    const now = Date.now();
    const list = signalTimestamps[key] || [];
    list.push(now);
    signalTimestamps[key] = list.filter((ts) => now - ts <= windowMs);
    return signalTimestamps[key].length;
}

/** @param {string} key @param {number} [windowMs] */
function signalCount(key, windowMs = WINDOW_MS) {
    const now = Date.now();
    const list = signalTimestamps[key] || [];
    signalTimestamps[key] = list.filter((ts) => now - ts <= windowMs);
    return signalTimestamps[key].length;
}

/**
 * @param {ThreatCategory} category
 * @param {string} type
 * @param {Record<string, unknown>} [detail]
 * @param {number} [cooldownMs]
 */
function maybeRecordAbuse(category, type, detail = {}, cooldownMs = 15_000) {
    const alertKey = `${category}:${type}`;
    const now = Date.now();
    if (lastAlertAt[alertKey] && now - lastAlertAt[alertKey] < cooldownMs) {
        return null;
    }
    lastAlertAt[alertKey] = now;
    return recordThreatEvent(category, type, detail);
}

/**
 * @param {string} signalKey
 * @param {ThreatCategory} category
 * @param {string} type
 * @param {{ yellow: number; orange: number; red: number }} thresholds
 * @param {Record<string, unknown>} [detail]
 */
function trackSignal(signalKey, category, type, thresholds, detail = {}) {
    const count = pushSignal(signalKey);
    if (count >= thresholds.yellow) {
        return maybeRecordAbuse(category, type, { ...detail, count, signalKey });
    }
    return null;
}

/** @param {number} sinceMs @param {ThreatCategory} [category] @param {string} [type] */
function countEvents(sinceMs, category, type) {
    const cutoff = Date.now() - sinceMs;
    return loadSecurityEvents().events.filter((event) => {
        if (event.timestamp < cutoff) return false;
        if (category && event.category !== category) return false;
        if (type && event.type !== type) return false;
        return true;
    }).length;
}

/** @param {number} count @param {{ yellow: number; orange: number; red: number }} thresholds */
function levelFromCount(count, thresholds) {
    if (count >= thresholds.red) return 'RED';
    if (count >= thresholds.orange) return 'ORANGE';
    if (count >= thresholds.yellow) return 'YELLOW';
    return 'GREEN';
}

/** @param {ThreatLevel} level */
function levelRank(level) {
    return { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 }[level];
}

/** @param {ThreatLevel} a @param {ThreatLevel} b */
function maxLevel(a, b) {
    return levelRank(a) >= levelRank(b) ? a : b;
}

/** @param {ThreatLevel} level */
function recommendedActionForLevel(level) {
    if (level === 'GREEN') return 'Continue monitoring — no active abuse patterns detected.';
    if (level === 'YELLOW') return 'Review recent studio activity and confirm expected operator behavior.';
    if (level === 'ORANGE') return 'Throttle mutating actions, verify admin session, and inspect workflow/notifications.';
    return 'Pause destructive actions, revoke admin access, and audit API logs immediately.';
}

/**
 * @param {{ emitDiagnostics?: boolean }} [options]
 * @returns {ThreatDetectionSnapshot}
 */
export function analyzeThreats(options = {}) {
    const emitDiagnostics = options.emitDiagnostics !== false;
    const events = loadSecurityEvents().events;
    const categoryCounts = /** @type {Record<ThreatCategory, number>} */ ({
        upload: countEvents(WINDOW_MS, 'upload'),
        workflow: countEvents(WINDOW_MS, 'workflow'),
        notification: countEvents(WINDOW_MS, 'notification'),
        team: countEvents(WINDOW_MS, 'team'),
        api: countEvents(WINDOW_MS, 'api')
    });

    const uploadBurst = countEvents(WINDOW_MS, 'upload', 'upload_burst');
    const uploadVolume = countEvents(LONG_WINDOW_MS, 'upload', 'upload_volume');
    const workflowSpam = countEvents(WINDOW_MS, 'workflow', 'task_spam');
    const workflowMutations = countEvents(WINDOW_MS, 'workflow', 'mutation_burst');
    const notificationFlood = countEvents(WINDOW_MS, 'notification', 'notification_flood');
    const notificationLoop = countEvents(WINDOW_MS, 'notification', 'notification_loop');
    const teamAssignments = countEvents(WINDOW_MS, 'team', 'mass_assignment');
    const teamRoles = countEvents(WINDOW_MS, 'team', 'role_change');
    const teamOwnership = countEvents(WINDOW_MS, 'team', 'ownership_transfer');
    const apiHits = countEvents(WINDOW_MS, 'api', 'endpoint_burst');
    const apiMutations = countEvents(WINDOW_MS, 'api', 'mutation_burst');
    const apiFailures = countEvents(WINDOW_MS, 'api', 'failure_burst');

    /** @type {ActiveThreat[]} */
    const activeThreats = [];

    const uploadLevel = maxLevel(
        levelFromCount(uploadBurst, THRESHOLDS.upload),
        levelFromCount(uploadVolume, { yellow: 5, orange: 12, red: 24 })
    );
    if (uploadLevel !== 'GREEN') {
        activeThreats.push({
            id: 'upload-abuse',
            category: 'upload',
            level: uploadLevel,
            title: 'Upload abuse pattern',
            detail: `${uploadBurst} rapid uploads in 60s · ${uploadVolume} uploads in 5m`,
            recommendedAction: 'Rate-limit uploads and verify operator identity before accepting media.',
            count: uploadBurst,
            windowMs: WINDOW_MS
        });
    }

    const workflowLevel = maxLevel(
        levelFromCount(workflowSpam, THRESHOLDS.workflow),
        levelFromCount(workflowMutations, THRESHOLDS.workflow)
    );
    if (workflowLevel !== 'GREEN') {
        activeThreats.push({
            id: 'workflow-abuse',
            category: 'workflow',
            level: workflowLevel,
            title: 'Workflow abuse pattern',
            detail: `${workflowSpam} task spam events · ${workflowMutations} mutation bursts`,
            recommendedAction: 'Inspect workflow task center for automated loops or bulk edits.',
            count: workflowSpam + workflowMutations,
            windowMs: WINDOW_MS
        });
    }

    const notificationLevel = maxLevel(
        levelFromCount(notificationFlood, THRESHOLDS.notification),
        levelFromCount(notificationLoop, THRESHOLDS.notification)
    );
    if (notificationLevel !== 'GREEN') {
        activeThreats.push({
            id: 'notification-abuse',
            category: 'notification',
            level: notificationLevel,
            title: 'Notification abuse pattern',
            detail: `${notificationFlood} floods · ${notificationLoop} loop signals`,
            recommendedAction: 'Clear notification triggers and pause auto-generated alerts.',
            count: notificationFlood + notificationLoop,
            windowMs: WINDOW_MS
        });
    }

    const teamLevel = maxLevel(
        maxLevel(
            levelFromCount(teamAssignments, THRESHOLDS.team),
            levelFromCount(teamRoles, THRESHOLDS.team)
        ),
        levelFromCount(teamOwnership, { yellow: 2, orange: 4, red: 6 })
    );
    if (teamLevel !== 'GREEN') {
        activeThreats.push({
            id: 'team-abuse',
            category: 'team',
            level: teamLevel,
            title: 'Team abuse pattern',
            detail: `${teamAssignments} mass assignments · ${teamRoles} role changes · ${teamOwnership} ownership transfers`,
            recommendedAction: 'Validate team role changes with OWNER approval and audit assignment logs.',
            count: teamAssignments + teamRoles + teamOwnership,
            windowMs: WINDOW_MS
        });
    }

    const apiLevel = maxLevel(
        maxLevel(levelFromCount(apiHits, THRESHOLDS.api), levelFromCount(apiMutations, THRESHOLDS.api)),
        levelFromCount(apiFailures, THRESHOLDS.apiFailures)
    );
    if (apiLevel !== 'GREEN') {
        activeThreats.push({
            id: 'api-abuse',
            category: 'api',
            level: apiLevel,
            title: 'API abuse pattern',
            detail: `${apiHits} endpoint bursts · ${apiMutations} mutations · ${apiFailures} failures`,
            recommendedAction: 'Enable API rate limits and inspect failing routes for credential abuse.',
            count: apiHits + apiMutations + apiFailures,
            windowMs: WINDOW_MS
        });
    }

    let level = /** @type {ThreatLevel} */ ('GREEN');
    for (const threat of activeThreats) {
        level = maxLevel(level, threat.level);
    }

    const penalty = activeThreats.reduce((sum, threat) => {
        if (threat.level === 'RED') return sum + 22;
        if (threat.level === 'ORANGE') return sum + 14;
        if (threat.level === 'YELLOW') return sum + 8;
        return sum;
    }, 0);

    const score = Math.max(0, Math.min(100, 100 - penalty));
    if (score < 50) level = 'RED';
    else if (score < 70) level = maxLevel(level, 'ORANGE');
    else if (score < 85) level = maxLevel(level, 'YELLOW');
    else if (activeThreats.length === 0) level = 'GREEN';

    const snapshot = /** @type {ThreatDetectionSnapshot} */ ({
        score,
        level,
        activeThreats,
        recommendedAction: recommendedActionForLevel(level),
        eventCount: events.length,
        categoryCounts,
        timestamp: Date.now()
    });

    lastSnapshot = snapshot;
    applySecurityPolicy(snapshot, { source: 'analyzeThreats' });

    if (emitDiagnostics) {
        logThreatDiag('THREAT_SCORE', {
            score,
            activeThreats: activeThreats.length,
            categoryCounts,
            eventCount: events.length
        });
        logThreatDiag('THREAT_LEVEL', {
            level,
            recommendedAction: snapshot.recommendedAction,
            activeThreatIds: activeThreats.map((threat) => threat.id)
        });
    }

    return snapshot;
}

/** @returns {ThreatDetectionSnapshot} */
export function getThreatSnapshot() {
    return lastSnapshot || analyzeThreats({ emitDiagnostics: false });
}

/** @returns {{ threatReport: Record<string, unknown>; scoreReport: Record<string, unknown> }} */
export function buildThreatReports() {
    const snapshot = analyzeThreats({ emitDiagnostics: false });
    const events = loadSecurityEvents().events.slice(-50);

    return {
        threatReport: {
            version: THREAT_DETECTION_VERSION,
            level: snapshot.level,
            activeThreats: snapshot.activeThreats,
            recentEvents: events,
            categoryCounts: snapshot.categoryCounts,
            storageKey: SECURITY_EVENTS_STORAGE_KEY,
            timestamp: snapshot.timestamp
        },
        scoreReport: {
            version: THREAT_DETECTION_VERSION,
            score: snapshot.score,
            level: snapshot.level,
            recommendedAction: snapshot.recommendedAction,
            activeThreatCount: snapshot.activeThreats.length,
            eventCount: snapshot.eventCount,
            timestamp: snapshot.timestamp
        }
    };
}

function bindPlatformListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('reelforge:notifications-updated', () => {
        if (signalCoolingDown('notification:flood:event', 2000)) return;
        trackSignal('notification:flood', 'notification', 'notification_flood', THRESHOLDS.notification);
        if (signalCount('notification:flood', 10_000) >= 4) {
            trackSignal('notification:loop', 'notification', 'notification_loop', THRESHOLDS.notification);
        }
    });

    window.addEventListener('reelforge:workflow-tasks-updated', () => {
        trackSignal('workflow:spam', 'workflow', 'task_spam', THRESHOLDS.workflow);
        trackSignal('workflow:mutation', 'workflow', 'mutation_burst', THRESHOLDS.workflow);
    });

    window.addEventListener('reelforge:task-assigned', () => {
        trackSignal('team:assignment', 'team', 'mass_assignment', THRESHOLDS.team);
    });

    window.addEventListener('reelforge:teams-updated', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        const action = String(detail.action || detail.type || '');
        if (action.includes('role')) {
            trackSignal('team:role', 'team', 'role_change', THRESHOLDS.team, { action });
        }
        if (action.includes('owner')) {
            trackSignal('team:owner', 'team', 'ownership_transfer', THRESHOLDS.team, { action });
        }
    });

    window.addEventListener('reelforge:pipeline-updated', () => {
        trackSignal('workflow:pipeline', 'workflow', 'mutation_burst', THRESHOLDS.workflow, {
            source: 'pipeline'
        });
    });
}

function bindFetchMonitor() {
    if (typeof window === 'undefined' || nativeFetch) return;
    nativeFetch = window.fetch.bind(window);

    window.fetch = async (...args) => {
        const input = args[0];
        const init = args[1] || {};
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = (init.method || 'GET').toUpperCase();
        const isMutation = method !== 'GET' && method !== 'HEAD';
        const isSecurityApi = url.includes('/api/security/events');
        const isHealthProbe =
            url.includes('/health') ||
            url.includes('/api/status') ||
            url.includes('/api/analytics/status');

        if (!isSecurityApi && !isHealthProbe && url.includes('/api/reels') && method === 'POST') {
            trackSignal('upload:burst', 'upload', 'upload_burst', THRESHOLDS.upload, { url, method });
            trackSignal('upload:volume', 'upload', 'upload_volume', { yellow: 5, orange: 12, red: 24 }, {
                url,
                method
            });
        }

        if (!isSecurityApi && !isHealthProbe && url.includes('/api/')) {
            trackSignal('api:endpoint', 'api', 'endpoint_burst', THRESHOLDS.api, { url, method });
            if (isMutation) {
                trackSignal('api:mutation', 'api', 'mutation_burst', THRESHOLDS.api, { url, method });
            }
        }

        try {
            const response = await nativeFetch(...args);
            if (!response.ok && !isSecurityApi && !isHealthProbe && url.includes('/api/')) {
                trackSignal('api:failure', 'api', 'failure_burst', THRESHOLDS.apiFailures, {
                    url,
                    method,
                    status: response.status
                });
            }
            return response;
        } catch (error) {
            if (!isSecurityApi && !isHealthProbe && url.includes('/api/')) {
                trackSignal('api:failure', 'api', 'failure_burst', THRESHOLDS.apiFailures, {
                    url,
                    method,
                    error: error?.message || 'fetch_failed'
                });
            }
            throw error;
        }
    };
}

function startSweepTimer() {
    if (typeof window === 'undefined' || sweepTimer) return;
    sweepTimer = window.setInterval(() => {
        const store = loadSecurityEvents();
        const cutoff = Date.now() - LONG_WINDOW_MS * 2;
        const trimmed = store.events.filter((event) => event.timestamp >= cutoff);
        if (trimmed.length !== store.events.length) {
            persistSecurityEvents(trimmed);
        }
        analyzeThreats({ emitDiagnostics: false });
    }, 30_000);
}

/** Validation helper — injects synthetic abuse events for Playwright. */
export function simulateThreatBurst(category = 'api_abuse') {
    const bursts = {
        upload_abuse: { category: 'upload', type: 'upload_burst', count: 8 },
        workflow_abuse: { category: 'workflow', type: 'task_spam', count: 12 },
        notification_abuse: { category: 'notification', type: 'notification_flood', count: 15 },
        team_abuse: { category: 'team', type: 'role_change', count: 6 },
        api_abuse: { category: 'api', type: 'endpoint_burst', count: 20 }
    };
    const burst = bursts[category] || bursts.api_abuse;
    const store = loadSecurityEvents();
    const now = Date.now();

    for (let i = 0; i < burst.count; i += 1) {
        store.events.push({
            id: `${burst.category}-${burst.type}-sim-${now}-${i}`,
            category: burst.category,
            type: burst.type,
            timestamp: now - i * 150,
            detail: { simulated: true, category, index: i }
        });
    }

    persistSecurityEvents(store.events);

    logThreatDiag('THREAT_EVENT', {
        phase: 'simulated_burst',
        category: burst.category,
        type: burst.type,
        count: burst.count
    });

    const snapshot = analyzeThreats({ emitDiagnostics: true });
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reelforge:threat-updated', { detail: snapshot }));
    }

    return snapshot;
}

/** @param {{ bindFetch?: boolean }} [options] */
export function initThreatDetectionEngine(options = {}) {
    if (typeof window === 'undefined') return null;

    loadSecurityEvents();
    if (options.bindFetch !== false) {
        bindFetchMonitor();
    }
    bindPlatformListeners();
    startSweepTimer();

    const snapshot = analyzeThreats({ emitDiagnostics: true });

    window.__reelforgeThreatDetection = {
        THREAT_DETECTION_VERSION,
        SECURITY_EVENTS_STORAGE_KEY,
        recordThreatEvent,
        analyzeThreats,
        getThreatSnapshot,
        buildThreatReports,
        loadSecurityEvents,
        simulateThreatBurst,
        logThreatDiag
    };

    logThreatDiag('THREAT_EVENT', {
        phase: 'engine_initialized',
        version: THREAT_DETECTION_VERSION,
        storageKey: SECURITY_EVENTS_STORAGE_KEY
    });

    return snapshot;
}
