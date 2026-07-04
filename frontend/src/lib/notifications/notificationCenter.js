/**
 * Phase 18 — in-app notification center with API-backed persistence.
 */

import { getOrCreateViewerId } from '../api/watch.js';
import {
    NOTIFICATION_TYPES,
    fetchNotifications,
    fetchUnreadCount,
    isNotificationApiAvailable,
    logNotificationCreated,
    logNotificationRead,
    markAllNotificationsReadApi,
    markNotificationReadApi,
    normalizeNotification,
    postNotification
} from '../api/notificationApi.js';
import { getCurrentTeamUserId } from '../teams/creatorTeams.js';
import { computeProductionReadiness } from '../series/productionHealth.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';

export const NOTIFICATION_STORAGE_KEY = 'reelforge_notifications';
const TRIGGER_STATE_KEY = 'reelforge_notification_triggers';

/** @typedef {typeof NOTIFICATION_TYPES[number]} NotificationType */

/**
 * @typedef {Object} NotificationItem
 * @property {string} id
 * @property {string} userId
 * @property {NotificationType} type
 * @property {string} message
 * @property {boolean} read
 * @property {Record<string, unknown>} payload
 * @property {number} createdAt
 */

/** @returns {string} */
export function getNotificationUserId() {
    if (typeof window === 'undefined') return 'user-owner-1';
    try {
        return getCurrentTeamUserId() || getOrCreateViewerId();
    } catch {
        return getOrCreateViewerId();
    }
}

/** @returns {{ version: number; items: NotificationItem[] }} */
function loadNotificationStore() {
    if (typeof window === 'undefined') return { version: 1, items: [] };
    try {
        const raw = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
        if (!raw) return { version: 1, items: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.items)) return { version: 1, items: [] };
        return { version: 1, items: parsed.items.map(normalizeNotification) };
    } catch {
        return { version: 1, items: [] };
    }
}

/** @param {{ version: number; items: NotificationItem[] }} store */
function persistNotificationStore(store) {
    if (typeof window === 'undefined') return;
    const trimmed = { version: 1, items: store.items.slice(-300) };
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent('reelforge:notifications-updated'));
}

/** @returns {Record<string, unknown>} */
function loadTriggerState() {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(TRIGGER_STATE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

/** @param {Record<string, unknown>} state */
function persistTriggerState(state) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TRIGGER_STATE_KEY, JSON.stringify(state));
}

/**
 * @param {NotificationType} type
 * @param {string} message
 * @param {Record<string, unknown>} [payload]
 */
export async function createNotification(type, message, payload = {}) {
    const userId = getNotificationUserId();
    const item = {
        id: crypto.randomUUID(),
        userId,
        type,
        message,
        read: false,
        payload,
        createdAt: Date.now()
    };

    const store = loadNotificationStore();
    store.items.unshift(item);
    persistNotificationStore(store);

    logNotificationCreated({
        id: item.id,
        userId,
        type,
        message
    });

    void postNotification({
        id: item.id,
        userId,
        type,
        message,
        payload
    });

    return item;
}

/** @param {string} [userId] */
export async function hydrateNotifications(userId = getNotificationUserId()) {
    const store = loadNotificationStore();
    if (!(await isNotificationApiAvailable())) {
        return store.items.filter((item) => item.userId === userId);
    }

    const remote = await fetchNotifications(userId);
    if (!Array.isArray(remote)) {
        return store.items.filter((item) => item.userId === userId);
    }

    const merged = new Map(store.items.map((item) => [item.id, item]));
    for (const row of remote) {
        const normalized = normalizeNotification(row);
        merged.set(normalized.id, normalized);
    }

    store.items = Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt);
    persistNotificationStore(store);
    return store.items.filter((item) => item.userId === userId);
}

/** @param {string} [userId] */
export function getNotifications(userId = getNotificationUserId()) {
    return loadNotificationStore()
        .items.filter((item) => item.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt);
}

/** @param {string} [userId] */
export function getUnreadCount(userId = getNotificationUserId()) {
    return getNotifications(userId).filter((item) => !item.read).length;
}

/** @param {string} id */
export async function markNotificationRead(id) {
    const store = loadNotificationStore();
    const item = store.items.find((entry) => entry.id === id);
    if (!item || item.read) return item || null;

    item.read = true;
    persistNotificationStore(store);
    logNotificationRead({ id, type: item.type, userId: item.userId });
    void markNotificationReadApi(id);
    return item;
}

/** @param {string} [userId] */
export async function markAllNotificationsRead(userId = getNotificationUserId()) {
    const store = loadNotificationStore();
    let updated = 0;
    for (const item of store.items) {
        if (item.userId === userId && !item.read) {
            item.read = true;
            updated += 1;
        }
    }
    persistNotificationStore(store);
    if (updated > 0) {
        logNotificationRead({ userId, updated, scope: 'all' });
    }
    void markAllNotificationsReadApi(userId);
    return updated;
}

/** @param {{ taskId: string; taskTitle?: string; assigneeName?: string; seriesId?: string }} detail */
export async function notifyWorkflowAssigned(detail) {
    return createNotification(
        'workflow_assigned',
        `Workflow task "${detail.taskTitle || detail.taskId}" assigned to ${detail.assigneeName || 'team member'}.`,
        detail
    );
}

/** @param {{ episodeId: string; seriesId?: string; episodeTitle?: string }} detail */
export async function notifyEpisodePublished(detail) {
    return createNotification(
        'episode_published',
        `Episode "${detail.episodeTitle || detail.episodeId}" is now published.`,
        detail
    );
}

/** @param {{ seriesId?: string; episodeId?: string; count?: number }} detail */
export async function notifyAssetMissing(detail) {
    const count = detail.count || 1;
    return createNotification(
        'asset_missing',
        `${count} episode${count === 1 ? '' : 's'} missing assets in production queue.`,
        detail
    );
}

/** @param {{ seriesId: string; previous: number; current: number }} detail */
export async function notifyReadinessChanged(detail) {
    const direction = detail.current >= detail.previous ? 'improved' : 'declined';
    return createNotification(
        'readiness_changed',
        `Series readiness ${direction}: ${detail.previous}% → ${detail.current}%.`,
        detail
    );
}

/** @param {{ seriesId: string; daysUntil: number; launchDate?: string | null }} detail */
export async function notifyReleaseApproaching(detail) {
    return createNotification(
        'release_approaching',
        `Release approaching in ${detail.daysUntil} day${detail.daysUntil === 1 ? '' : 's'}${detail.launchDate ? ` (${detail.launchDate})` : ''}.`,
        detail
    );
}

/** @param {{ episodeId?: string; seriesId?: string; fromStage?: string }} detail */
export async function notifyPipelineReview(detail) {
    return createNotification(
        'readiness_changed',
        `Pipeline review submitted for ${detail.episodeId || 'episode'}`,
        { ...detail, pipelineEvent: 'review' }
    );
}

/** @param {{ episodeId?: string; seriesId?: string; approverUserId?: string }} detail */
export async function notifyPipelineApproval(detail) {
    return createNotification(
        'readiness_changed',
        `Pipeline approved for ${detail.episodeId || 'episode'}`,
        { ...detail, pipelineEvent: 'approval' }
    );
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export async function evaluateNotificationTriggers(seriesId, feedReels = []) {
    if (!seriesId || typeof window === 'undefined') return;

    const state = loadTriggerState();
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const readinessKey = `readiness:${seriesId}`;
    const previousReadiness = Number(state[readinessKey]);
    if (
        Number.isFinite(previousReadiness) &&
        previousReadiness !== readiness.weightedPercent &&
        Math.abs(previousReadiness - readiness.weightedPercent) >= 3
    ) {
        await notifyReadinessChanged({
            seriesId,
            previous: previousReadiness,
            current: readiness.weightedPercent
        });
    }
    state[readinessKey] = readiness.weightedPercent;

    const releaseSnapshot = buildReleaseCenterSnapshot(seriesId, feedReels);
    const days = releaseSnapshot.premiereCountdown?.days;
    const releaseKey = `release:${seriesId}`;
    if (typeof days === 'number' && days > 0 && days <= 7) {
        const signature = `${days}:${releaseSnapshot.releaseHealth?.launchDate || ''}`;
        if (state[releaseKey] !== signature) {
            await notifyReleaseApproaching({
                seriesId,
                daysUntil: days,
                launchDate: releaseSnapshot.releaseHealth?.launchDate || null
            });
            state[releaseKey] = signature;
        }
    }

    persistTriggerState(state);
}

export function resetNotifications() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(NOTIFICATION_STORAGE_KEY);
    localStorage.removeItem(TRIGGER_STATE_KEY);
    window.dispatchEvent(new CustomEvent('reelforge:notifications-updated'));
}

let notificationsInitialized = false;

export function initNotificationCenter() {
    if (typeof window === 'undefined' || notificationsInitialized) return;
    notificationsInitialized = true;

    void hydrateNotifications();

    window.addEventListener('reelforge:workflow-tasks-updated', () => {
        void hydrateNotifications();
    });
    window.addEventListener('reelforge:teams-updated', () => {
        void hydrateNotifications();
    });
    window.addEventListener('reelforge:release-updated', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        if (detail.seriesId) {
            void evaluateNotificationTriggers(detail.seriesId, detail.feedReels || []);
        }
        void hydrateNotifications();
    });

    window.addEventListener('reelforge:task-assigned', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        void notifyWorkflowAssigned({
            taskId: detail.taskId,
            taskTitle: detail.taskTitle,
            assigneeName: detail.assigneeName,
            seriesId: detail.seriesId
        });
    });

    window.addEventListener('reelforge:episode-published', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        void notifyEpisodePublished({
            episodeId: detail.episodeId,
            seriesId: detail.seriesId,
            episodeTitle: detail.episodeTitle
        });
    });

    window.addEventListener('reelforge:asset-missing-detected', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        void notifyAssetMissing({
            seriesId: detail.seriesId,
            episodeId: detail.episodeId,
            count: detail.count
        });
    });

    window.addEventListener('reelforge:pipeline-review', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        void notifyPipelineReview({
            episodeId: detail.episodeId,
            seriesId: detail.seriesId,
            fromStage: detail.fromStage
        });
    });

    window.addEventListener('reelforge:pipeline-approval', (event) => {
        const detail = /** @type {CustomEvent} */ (event).detail || {};
        void notifyPipelineApproval({
            episodeId: detail.episodeId,
            seriesId: detail.seriesId,
            approverUserId: detail.approverUserId
        });
    });

    window.__reelforgeNotifications = {
        NOTIFICATION_TYPES,
        createNotification,
        getNotifications,
        getUnreadCount,
        markNotificationRead,
        markAllNotificationsRead,
        notifyWorkflowAssigned,
        notifyEpisodePublished,
        notifyAssetMissing,
        notifyReadinessChanged,
        notifyReleaseApproaching,
        notifyPipelineReview,
        notifyPipelineApproval,
        evaluateNotificationTriggers,
        hydrateNotifications,
        resetNotifications,
        getNotificationUserId
    };
}
