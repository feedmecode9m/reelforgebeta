import { API_BASE_URL, fetchWithRetry } from '../api.js';

export const PIPELINE_STAGES = /** @type {const} */ ([
    'IDEA',
    'SCRIPT',
    'STORYBOARD',
    'PRODUCTION',
    'EDITING',
    'REVIEW',
    'READY',
    'PUBLISHED'
]);

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
export function logPipelineDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

async function pipelineFetch(path, options = {}) {
    const res = await fetchWithRetry(`${API_BASE_URL}${path}`, options, {
        retries: 1,
        notifyReconnectOnFailure: false
    });
    if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        return { disabled: true, error: body.error || 'Pipeline API disabled' };
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Pipeline API failed (${res.status})`);
    }
    return res.json();
}

/** @returns {Promise<{ enabled?: boolean; count?: number; disabled?: boolean; error?: string }>} */
export async function fetchPipelineApiStatus() {
    try {
        const res = await fetchWithRetry(
            `${API_BASE_URL}/api/pipeline/status`,
            { signal: AbortSignal.timeout(4000) },
            { retries: 0, retryDelayMs: 250, notifyReconnectOnFailure: false }
        );
        if (res.status === 404) {
            const body = await res.json().catch(() => ({}));
            return { disabled: true, error: body.error || 'Pipeline API disabled' };
        }
        if (!res.ok) {
            return { disabled: true, error: `Pipeline API failed (${res.status})` };
        }
        return res.json();
    } catch (err) {
        return { disabled: true, error: err?.message || 'Pipeline API unavailable' };
    }
}

/** @returns {Promise<boolean>} */
export async function isPipelineApiAvailable() {
    const status = await fetchPipelineApiStatus();
    return !status.disabled && status.enabled !== false;
}

/**
 * @param {string} [seriesId]
 * @param {string[]} [episodeIds]
 */
export async function fetchPipeline(seriesId, episodeIds = []) {
    try {
        const query = new URLSearchParams();
        if (seriesId) query.set('seriesId', seriesId);
        if (episodeIds.length) query.set('episodeIds', episodeIds.join(','));
        const suffix = query.toString() ? `?${query.toString()}` : '';
        return await pipelineFetch(`/api/pipeline${suffix}`);
    } catch (err) {
        return { disabled: true, error: err?.message || 'Pipeline API unavailable' };
    }
}

/**
 * @param {string} episodeId
 * @param {{ stage?: string; assignedUserId?: string; approvedBy?: string }} input
 */
export async function updatePipelineEpisode(episodeId, input) {
    try {
        return await pipelineFetch(`/api/pipeline/${encodeURIComponent(episodeId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
        });
    } catch (err) {
        return { disabled: true, error: err?.message || 'Pipeline API unavailable' };
    }
}

/** @param {Record<string, unknown>} row */
export function normalizePipelineRow(row) {
    const updatedAtRaw = row.updatedAt || row.updated_at;
    return {
        id: String(row.id || ''),
        episodeId: String(row.episodeId || row.episode_id || ''),
        stage: String(row.stage || 'IDEA'),
        assignedUserId: row.assignedUserId || row.assigned_user_id || null,
        approvedBy: row.approvedBy || row.approved_by || null,
        updatedAt:
            typeof updatedAtRaw === 'string'
                ? Date.parse(updatedAtRaw) || Date.now()
                : Number(updatedAtRaw) || Date.now()
    };
}
