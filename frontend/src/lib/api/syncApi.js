import { API_BASE_URL, fetchWithRetry } from '../api.js';

const DEVICE_STORAGE_KEY = 'reelforge_sync_device_id';

/** @returns {string} */
export function getOrCreateSyncDeviceId() {
    if (typeof localStorage === 'undefined') return `device-${crypto.randomUUID()}`;
    let id = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(DEVICE_STORAGE_KEY, id);
    }
    return id;
}

async function syncFetch(path, options = {}) {
    const res = await fetchWithRetry(
        `${API_BASE_URL}${path}`,
        {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'X-Reelforge-Device-Id': getOrCreateSyncDeviceId(),
                ...(options.headers || {})
            },
            signal: options.signal || AbortSignal.timeout(5000)
        },
        { retries: 0, retryDelayMs: 250 }
    );
    if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        return { disabled: true, error: body.error || 'Studio sync disabled' };
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Sync API failed (${res.status})`);
    }
    return res.json();
}

/** @returns {Promise<{ enabled?: boolean; disabled?: boolean; error?: string }>} */
export async function fetchSyncStatus() {
    try {
        return await syncFetch('/api/sync/status');
    } catch (err) {
        return { disabled: true, error: err?.message || 'Sync API unavailable' };
    }
}

/** @returns {Promise<{ payload?: Record<string, unknown>; disabled?: boolean; error?: string }>} */
export async function pullSyncState() {
    try {
        return await syncFetch('/api/sync/state');
    } catch (err) {
        return { disabled: true, error: err?.message || 'Sync pull failed' };
    }
}

/** @param {Record<string, unknown>} domains */
export async function pushSyncState(domains) {
    return syncFetch('/api/sync/push', {
        method: 'POST',
        body: JSON.stringify({
            device_id: getOrCreateSyncDeviceId(),
            domains
        })
    });
}
