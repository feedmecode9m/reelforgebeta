import { API_BASE_URL, fetchWithRetry } from '../api.js';

export const NOTIFICATION_TYPES = /** @type {const} */ ([
    'workflow_assigned',
    'episode_published',
    'asset_missing',
    'readiness_changed',
    'release_approaching'
]);

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
export function logNotificationDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {Record<string, unknown>} detail */
export function logNotificationCreated(detail = {}) {
    logNotificationDiag('NOTIFICATION_CREATED', detail);
}

/** @param {Record<string, unknown>} detail */
export function logNotificationRead(detail = {}) {
    logNotificationDiag('NOTIFICATION_READ', detail);
}

async function notificationFetch(path, options = {}) {
    const res = await fetchWithRetry(`${API_BASE_URL}${path}`, options, {
        retries: 1,
        notifyReconnectOnFailure: false
    });
    if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        return { disabled: true, error: body.error || 'Notification API disabled' };
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Notification API failed (${res.status})`);
    }
    return res.json();
}

/** @returns {Promise<{ enabled?: boolean; count?: number; disabled?: boolean; error?: string }>} */
export async function fetchNotificationApiStatus() {
    try {
        const res = await fetchWithRetry(
            `${API_BASE_URL}/api/notifications/status`,
            { signal: AbortSignal.timeout(4000) },
            { retries: 0, retryDelayMs: 250, notifyReconnectOnFailure: false }
        );
        if (res.status === 404) {
            const body = await res.json().catch(() => ({}));
            return { disabled: true, error: body.error || 'Notification API disabled' };
        }
        if (!res.ok) {
            return { disabled: true, error: `Notification API failed (${res.status})` };
        }
        return res.json();
    } catch (err) {
        return { disabled: true, error: err?.message || 'Notification API unavailable' };
    }
}

/** @returns {Promise<boolean>} */
export async function isNotificationApiAvailable() {
    const status = await fetchNotificationApiStatus();
    return !status.disabled && status.enabled !== false;
}

/** @param {string} userId @param {boolean} [unreadOnly] */
export async function fetchNotifications(userId, unreadOnly = false) {
    try {
        const query = new URLSearchParams({ userId });
        if (unreadOnly) query.set('unreadOnly', 'true');
        return await notificationFetch(`/api/notifications?${query.toString()}`);
    } catch (err) {
        return { disabled: true, error: err?.message || 'Notification API unavailable' };
    }
}

/** @param {string} userId */
export async function fetchUnreadCount(userId) {
    try {
        return await notificationFetch(
            `/api/notifications/unread-count?userId=${encodeURIComponent(userId)}`
        );
    } catch (err) {
        return { disabled: true, error: err?.message || 'Notification API unavailable', unread: 0 };
    }
}

/**
 * @param {{
 *   id?: string;
 *   userId: string;
 *   type: string;
 *   message: string;
 *   payload?: Record<string, unknown>;
 * }} input
 */
export async function postNotification(input) {
    try {
        return await notificationFetch('/api/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
        });
    } catch (err) {
        return { disabled: true, error: err?.message || 'Notification API unavailable' };
    }
}

/** @param {string} id */
export async function markNotificationReadApi(id) {
    try {
        return await notificationFetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
            method: 'PUT'
        });
    } catch (err) {
        return { disabled: true, error: err?.message || 'Notification API unavailable' };
    }
}

/** @param {string} userId */
export async function markAllNotificationsReadApi(userId) {
    try {
        return await notificationFetch(
            `/api/notifications/read-all?userId=${encodeURIComponent(userId)}`,
            { method: 'PUT' }
        );
    } catch (err) {
        return { disabled: true, error: err?.message || 'Notification API unavailable' };
    }
}

/** @param {Record<string, unknown>} row */
export function normalizeNotification(row) {
    const createdAtRaw = row.createdAt || row.created_at;
    return {
        id: String(row.id || ''),
        userId: String(row.userId || row.user_id || ''),
        type: String(row.type || row.notification_type || 'workflow_assigned'),
        message: String(row.message || ''),
        read: Boolean(row.read),
        payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
        createdAt:
            typeof createdAtRaw === 'string'
                ? Date.parse(createdAtRaw) || Date.now()
                : Number(createdAtRaw) || Date.now()
    };
}
