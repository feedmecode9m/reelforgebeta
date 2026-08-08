/**
 * VIEWER-1: authenticated consumer personalization APIs.
 */

import { API_BASE_URL, fetchWithRetry } from '../api.js';
import { getAuthHeaders, isAuthenticatedSync } from '../auth/index.js';

async function viewerFetch(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...(options.headers || {})
    };
    const res = await fetchWithRetry(
        `${API_BASE_URL}${path}`,
        {
            ...options,
            headers
        },
        { retries: 1, notifyReconnectOnFailure: false }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(body.message || body.error || `Request failed (${res.status})`);
        err.status = res.status;
        err.body = body;
        throw err;
    }
    return body;
}

/** @returns {Promise<object|null>} */
export async function fetchViewerProfile() {
    if (!isAuthenticatedSync()) return null;
    const data = await viewerFetch('/api/account/profile');
    return data.profile || null;
}

/**
 * @param {{ displayName?: string; avatarPlaceholder?: string; settings?: Record<string, unknown> }} patch
 */
export async function updateViewerProfile(patch) {
    return viewerFetch('/api/account/profile', {
        method: 'PUT',
        body: JSON.stringify({
            displayName: patch.displayName,
            avatarPlaceholder: patch.avatarPlaceholder,
            settings: patch.settings
        })
    });
}

/**
 * @param {{ includeCompleted?: boolean; limit?: number }} [opts]
 */
export async function fetchViewerHistory(opts = {}) {
    if (!isAuthenticatedSync()) return { items: [] };
    const params = new URLSearchParams();
    if (opts.includeCompleted) params.set('includeCompleted', 'true');
    if (opts.limit != null) params.set('limit', String(opts.limit));
    const q = params.toString() ? `?${params}` : '';
    const data = await viewerFetch(`/api/viewer/history${q}`);
    return { items: Array.isArray(data.items) ? data.items : [] };
}

/**
 * @param {{
 *   reelId: string;
 *   positionSeconds?: number;
 *   durationSeconds?: number | null;
 *   completed?: boolean;
 * }} payload
 */
export async function postViewerHistory(payload) {
    if (!isAuthenticatedSync() || !payload?.reelId) return null;
    return viewerFetch('/api/viewer/history', {
        method: 'POST',
        body: JSON.stringify({
            reelId: String(payload.reelId),
            positionSeconds: payload.positionSeconds,
            durationSeconds: payload.durationSeconds,
            completed: payload.completed
        })
    });
}

/** Resume position for a single reel from continue-watching foundation. */
export async function fetchViewerHistoryForReel(reelId) {
    if (!isAuthenticatedSync() || !reelId) return null;
    const { items } = await fetchViewerHistory({ includeCompleted: true, limit: 100 });
    const id = String(reelId);
    return items.find((it) => String(it.reelId) === id) || null;
}

export async function fetchWatchlist() {
    if (!isAuthenticatedSync()) return { items: [] };
    const data = await viewerFetch('/api/viewer/watchlist');
    return { items: Array.isArray(data.items) ? data.items : [] };
}

/** @param {string} reelId */
export async function addToWatchlist(reelId) {
    if (!reelId) return null;
    return viewerFetch('/api/viewer/watchlist', {
        method: 'POST',
        body: JSON.stringify({ reelId: String(reelId) })
    });
}

/** @param {string} reelId */
export async function removeFromWatchlist(reelId) {
    if (!reelId) return null;
    return viewerFetch(`/api/viewer/watchlist/${encodeURIComponent(String(reelId))}`, {
        method: 'DELETE'
    });
}
