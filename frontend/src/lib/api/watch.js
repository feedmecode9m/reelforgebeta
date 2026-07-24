import { API_BASE_URL, fetchWithRetry } from '../api.js';

const VIEWER_STORAGE_KEY = 'reelforge_viewer_id';

/** Stable anonymous viewer id for progress / continue APIs. */
export function getOrCreateViewerId() {
    if (typeof localStorage === 'undefined') return `anon-${crypto.randomUUID()}`;
    let id = localStorage.getItem(VIEWER_STORAGE_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(VIEWER_STORAGE_KEY, id);
    }
    return id;
}

function watchHeaders() {
    return {
        'Content-Type': 'application/json',
        'X-Reelforge-Viewer-Id': getOrCreateViewerId()
    };
}

async function watchFetch(path, options = {}) {
    const res = await fetchWithRetry(`${API_BASE_URL}${path}`, {
        ...options,
        headers: { ...watchHeaders(), ...(options.headers || {}) }
    }, { retries: 1, notifyReconnectOnFailure: false });
    if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        return { disabled: true, error: body.error || 'Watch tracking API disabled' };
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Watch API failed (${res.status})`);
    }
    return res.json();
}

export async function fetchWatchStatus() {
    return watchFetch('/api/watch/status');
}

/** @param {Record<string, unknown>} body */
export async function postWatchEvent(body) {
    return watchFetch('/api/watch/event', {
        method: 'POST',
        body: JSON.stringify({
            viewer_id: getOrCreateViewerId(),
            ...body
        })
    });
}

/** @param {string} episodeId */
export async function fetchWatchProgress(episodeId) {
    const viewer = encodeURIComponent(getOrCreateViewerId());
    return watchFetch(`/api/watch/progress/${episodeId}?viewer_id=${viewer}`);
}

/** @param {{ limit?: number }} [opts] */
export async function fetchContinueWatching(opts = {}) {
    const viewer = encodeURIComponent(getOrCreateViewerId());
    const limit = opts.limit != null ? `&limit=${opts.limit}` : '';
    return watchFetch(`/api/watch/continue?viewer_id=${viewer}${limit}`);
}
