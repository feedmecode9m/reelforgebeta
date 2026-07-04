import { API_BASE_URL, fetchWithRetry } from '../api.js';

export const TEAM_ROLES = /** @type {const} */ ([
    'OWNER',
    'PRODUCER',
    'EDITOR',
    'WRITER',
    'REVIEWER'
]);

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
export function logTeamDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {Record<string, unknown>} detail */
export function logTeamMemberAdded(detail = {}) {
    logTeamDiag('TEAM_MEMBER_ADDED', detail);
}

/** @param {Record<string, unknown>} detail */
export function logTeamRoleChanged(detail = {}) {
    logTeamDiag('TEAM_ROLE_CHANGED', detail);
}

/** @param {Record<string, unknown>} detail */
export function logTaskAssigned(detail = {}) {
    logTeamDiag('TASK_ASSIGNED', detail);
}

async function teamFetch(path, options = {}) {
    const res = await fetchWithRetry(`${API_BASE_URL}${path}`, options, { retries: 1 });
    if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        return { disabled: true, error: body.error || 'Team API disabled' };
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Team API failed (${res.status})`);
    }
    return res.json();
}

/** @returns {Promise<{ enabled?: boolean; teamCount?: number; userCount?: number; disabled?: boolean; error?: string }>} */
export async function fetchTeamApiStatus() {
    try {
        const res = await fetchWithRetry(
            `${API_BASE_URL}/api/teams/status`,
            { signal: AbortSignal.timeout(4000) },
            { retries: 0, retryDelayMs: 250 }
        );
        if (res.status === 404) {
            const body = await res.json().catch(() => ({}));
            return { disabled: true, error: body.error || 'Team API disabled' };
        }
        if (!res.ok) {
            return { disabled: true, error: `Team API failed (${res.status})` };
        }
        return res.json();
    } catch (err) {
        return { disabled: true, error: err?.message || 'Team API unavailable' };
    }
}

/** @returns {Promise<boolean>} */
export async function isTeamApiAvailable() {
    const status = await fetchTeamApiStatus();
    return !status.disabled && status.enabled !== false;
}

/** @returns {Promise<Record<string, unknown>[] | { disabled: boolean; error?: string }>} */
export async function fetchUsers() {
    try {
        return await teamFetch('/api/users');
    } catch (err) {
        return { disabled: true, error: err?.message || 'Team API unavailable' };
    }
}

/** @param {string} [seriesId] */
export async function fetchTeams(seriesId) {
    try {
        const query = seriesId ? `?seriesId=${encodeURIComponent(seriesId)}` : '';
        return await teamFetch(`/api/teams${query}`);
    } catch (err) {
        return { disabled: true, error: err?.message || 'Team API unavailable' };
    }
}

/**
 * @param {{ name: string; seriesId?: string; ownerUserId?: string; id?: string }} input
 */
export async function createTeam(input) {
    try {
        return await teamFetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
        });
    } catch (err) {
        return { disabled: true, error: err?.message || 'Team API unavailable' };
    }
}

/** @param {string} teamId */
export async function fetchTeamMembers(teamId) {
    try {
        return await teamFetch(`/api/teams/${encodeURIComponent(teamId)}/members`);
    } catch (err) {
        return { disabled: true, error: err?.message || 'Team API unavailable' };
    }
}

/**
 * @param {string} teamId
 * @param {{ userId: string; role?: string }} input
 */
export async function addTeamMember(teamId, input) {
    try {
        return await teamFetch(`/api/teams/${encodeURIComponent(teamId)}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
        });
    } catch (err) {
        return { disabled: true, error: err?.message || 'Team API unavailable' };
    }
}

/**
 * @param {string} teamId
 * @param {string} userId
 * @param {{ role: string }} input
 */
export async function updateTeamMemberRole(teamId, userId, input) {
    try {
        return await teamFetch(
            `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input)
            }
        );
    } catch (err) {
        return { disabled: true, error: err?.message || 'Team API unavailable' };
    }
}

/** @param {string} teamId */
export async function fetchTeamActivity(teamId) {
    try {
        return await teamFetch(`/api/teams/${encodeURIComponent(teamId)}/activity`);
    } catch (err) {
        return { disabled: true, error: err?.message || 'Team API unavailable' };
    }
}

/**
 * @param {string} teamId
 * @param {{ taskId: string; userId: string; assignedBy?: string }} input
 */
export async function assignTeamTask(teamId, input) {
    try {
        return await teamFetch(`/api/teams/${encodeURIComponent(teamId)}/assign-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
        });
    } catch (err) {
        return { disabled: true, error: err?.message || 'Team API unavailable' };
    }
}

/**
 * @param {string} teamId
 * @param {string} userId
 * @param {string} [seriesId]
 */
export async function fetchAssignedTasks(teamId, userId, seriesId) {
    try {
        const query = new URLSearchParams({ userId });
        if (seriesId) query.set('seriesId', seriesId);
        return await teamFetch(
            `/api/teams/${encodeURIComponent(teamId)}/assigned-tasks?${query.toString()}`
        );
    } catch (err) {
        return { disabled: true, error: err?.message || 'Team API unavailable' };
    }
}
