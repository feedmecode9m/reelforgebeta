import { API_BASE_URL, fetchWithRetry } from '../api.js';

export const ACCESS_MODES = [
    'FREE',
    'EPISODE_LOCK',
    'SEASON_PASS',
    'VIP',
    'SUBSCRIPTION'
];

async function monetizationFetch(path, options = {}) {
    const res = await fetchWithRetry(`${API_BASE_URL}${path}`, options, { retries: 1 });
    if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        return { disabled: true, error: body.error || 'Monetization API disabled' };
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Monetization API failed (${res.status})`);
    }
    return res.json();
}

export async function fetchMonetizationStatus() {
    return monetizationFetch('/api/monetization/status');
}

/** @param {string} [projectId] */
export async function fetchMonetizationConfig(projectId) {
    const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
    return monetizationFetch(`/api/monetization/config${q}`);
}

/** @param {string} seriesId @param {Record<string, unknown>} body */
export async function updateSeriesMonetization(seriesId, body) {
    return monetizationFetch(`/api/monetization/series/${seriesId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {string} episodeId @param {Record<string, unknown>} body */
export async function updateEpisodeMonetization(episodeId, body) {
    return monetizationFetch(`/api/monetization/episodes/${episodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {string} projectId @param {Record<string, unknown>} body */
export async function updateProjectMonetization(projectId, body) {
    return monetizationFetch(`/api/monetization/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}
