import { API_BASE_URL, fetchWithRetry } from '../api.js';

async function platformFetch(path, options = {}) {
    const res = await fetchWithRetry(`${API_BASE_URL}${path}`, options, { retries: 1 });
    if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        return { disabled: true, error: body.error || 'Platform configuration disabled' };
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Platform API failed (${res.status})`);
    }
    if (res.status === 204) return null;
    return res.json();
}

export async function fetchPlatformStatus() {
    return platformFetch('/api/platform/status');
}

export async function fetchPlatformConfig() {
    return platformFetch('/api/platform/config');
}

/** @param {Record<string, unknown>} body */
export async function updatePlatformSite(body) {
    return platformFetch('/api/platform/site', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {Record<string, unknown>} body */
export async function updatePlatformHero(body) {
    return platformFetch('/api/platform/hero', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {Record<string, unknown>} body */
export async function updatePlatformFeatures(body) {
    return platformFetch('/api/platform/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {Record<string, unknown>} body */
export async function createPlatformCampaign(body) {
    return platformFetch('/api/platform/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {string} id @param {Record<string, unknown>} body */
export async function updatePlatformCampaign(id, body) {
    return platformFetch(`/api/platform/campaigns/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}

/** @param {string} id */
export async function deletePlatformCampaign(id) {
    return platformFetch(`/api/platform/campaigns/${id}`, { method: 'DELETE' });
}

export const HERO_MODES = [
    'OFF',
    'STATIC',
    'CAROUSEL',
    'FEATURED_SERIES',
    'LATEST_RELEASE',
    'PROMOTED'
];

export const CAMPAIGN_TYPES = ['CONTEST', 'PREMIERE', 'PROMOTION', 'SPONSOR'];

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'active', 'ended', 'archived'];
