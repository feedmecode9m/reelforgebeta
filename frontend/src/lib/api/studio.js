import { API_BASE_URL, fetchWithRetry } from '../api.js';

/**
 * @typedef {{ enabled: boolean; counts?: { projects: number; series: number; seasons: number; episodes: number; episodes_with_reel: number } }} StudioStatus
 */

async function studioFetch(path, options = {}) {
    const res = await fetchWithRetry(`${API_BASE_URL}${path}`, options, {
        retries: 1,
        notifyReconnectOnFailure: false
    });
    if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        return { disabled: true, error: body.error || 'Studio hierarchy disabled' };
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Studio API failed (${res.status})`);
    }
    return res.json();
}

/** @returns {Promise<StudioStatus | { disabled: true; error: string }>} */
export async function fetchStudioStatus() {
    return studioFetch('/api/studio/status');
}

export async function fetchStudioProjects() {
    return studioFetch('/api/studio/projects');
}

/** @param {string} projectId */
export async function fetchProjectTree(projectId) {
    return studioFetch(`/api/studio/projects/${projectId}/tree`);
}

/** @param {{ name: string; slug?: string }} body */
export async function createStudioProject(body) {
    return studioFetch('/api/studio/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {{ project_id: string; title: string; description?: string }} body */
export async function createStudioSeries(body) {
    return studioFetch('/api/studio/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {{ series_id: string; season_number: number; title?: string }} body */
export async function createStudioSeason(body) {
    return studioFetch('/api/studio/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {{ season_id: string; episode_number: number; title: string; description?: string; reel_id?: string }} body */
export async function createStudioEpisode(body) {
    return studioFetch('/api/studio/episodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {string} episodeId @param {string} reelId */
export async function attachReelToEpisode(episodeId, reelId) {
    return studioFetch(`/api/studio/episodes/${episodeId}/attach-reel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reel_id: reelId })
    });
}

export async function backfillStudioHierarchy() {
    return studioFetch('/api/studio/backfill', { method: 'POST' });
}
