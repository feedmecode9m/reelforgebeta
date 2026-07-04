/**
 * Phase 17 — collaborative production teams with API-backed persistence.
 */

export { TEAM_ROLES } from '../api/teamApi.js';

import {
    TEAM_ROLES,
    addTeamMember,
    assignTeamTask,
    createTeam,
    fetchAssignedTasks,
    fetchTeamActivity,
    fetchTeamMembers,
    fetchTeams,
    fetchUsers,
    isTeamApiAvailable,
    logTaskAssigned,
    logTeamMemberAdded,
    logTeamRoleChanged,
    updateTeamMemberRole
} from '../api/teamApi.js';
import { getWorkflowTasksForSeries } from '../workflow/workflowEngine.js';

export const TEAM_STORAGE_KEY = 'reelforge_creator_teams';
export const CURRENT_TEAM_USER_KEY = 'reelforge_current_team_user';

/** @typedef {'OWNER' | 'PRODUCER' | 'EDITOR' | 'WRITER' | 'REVIEWER'} TeamRole */

/**
 * @typedef {Object} TeamMember
 * @property {string} id
 * @property {string} teamId
 * @property {string} userId
 * @property {TeamRole} role
 * @property {string} displayName
 * @property {string} [email]
 */

/**
 * @typedef {Object} TeamSnapshot
 * @property {string} id
 * @property {string} name
 * @property {string} [seriesId]
 * @property {TeamMember[]} members
 * @property {Record<string, unknown>[]} activity
 * @property {Record<string, unknown>[]} users
 */

/** @returns {{ version: number; teams: Record<string, unknown>[]; members: Record<string, TeamMember[]>; activity: Record<string, Record<string, unknown>[]> }} */
function loadTeamStore() {
    if (typeof window === 'undefined') {
        return { version: 1, teams: [], members: {}, activity: {} };
    }
    try {
        const raw = localStorage.getItem(TEAM_STORAGE_KEY);
        if (!raw) return { version: 1, teams: [], members: {}, activity: {} };
        const parsed = JSON.parse(raw);
        return {
            version: 1,
            teams: Array.isArray(parsed.teams) ? parsed.teams : [],
            members: parsed.members || {},
            activity: parsed.activity || {}
        };
    } catch {
        return { version: 1, teams: [], members: {}, activity: {} };
    }
}

/** @param {ReturnType<typeof loadTeamStore>} store */
function persistTeamStore(store) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent('reelforge:teams-updated'));
}

/** @param {Record<string, unknown>} member */
function normalizeMember(member) {
    return {
        id: String(member.id || ''),
        teamId: String(member.teamId || member.team_id || ''),
        userId: String(member.userId || member.user_id || ''),
        role: /** @type {TeamRole} */ (String(member.role || 'EDITOR').toUpperCase()),
        displayName: String(member.displayName || member.display_name || member.userId || 'Member'),
        email: member.email ? String(member.email) : undefined
    };
}

/** @param {Record<string, unknown>} team */
function normalizeTeam(team) {
    return {
        id: String(team.id || ''),
        name: String(team.name || 'Production Team'),
        seriesId: team.seriesId || team.series_id ? String(team.seriesId || team.series_id) : undefined
    };
}

/** @returns {string} */
export function getCurrentTeamUserId() {
    if (typeof window === 'undefined') return 'user-owner-1';
    return localStorage.getItem(CURRENT_TEAM_USER_KEY) || 'user-owner-1';
}

/** @param {string} userId */
export function setCurrentTeamUserId(userId) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(CURRENT_TEAM_USER_KEY, userId);
    window.dispatchEvent(new CustomEvent('reelforge:teams-updated'));
}

/**
 * @param {string} seriesId
 * @returns {Promise<TeamSnapshot | null>}
 */
export async function ensureTeamForSeries(seriesId) {
    const store = loadTeamStore();
    let team = store.teams.find((item) => item.seriesId === seriesId);

    if (await isTeamApiAvailable()) {
        const remoteTeams = await fetchTeams(seriesId);
        if (Array.isArray(remoteTeams) && remoteTeams.length > 0) {
            team = normalizeTeam(remoteTeams[0]);
        } else if (!team) {
            const created = await createTeam({
                name: 'Production Team',
                seriesId,
                ownerUserId: getCurrentTeamUserId()
            });
            if (!created?.disabled && created?.id) {
                team = normalizeTeam(created);
            }
        }
    }

    if (!team) {
        team = {
            id: `team-local-${seriesId}`,
            name: 'Production Team',
            seriesId
        };
        if (!store.teams.some((item) => item.seriesId === seriesId)) {
            store.teams.push(team);
            store.members[team.id] = [
                {
                    id: 'tm-local-owner',
                    teamId: team.id,
                    userId: getCurrentTeamUserId(),
                    role: 'OWNER',
                    displayName: 'Studio Owner'
                }
            ];
            persistTeamStore(store);
        }
    }

    return hydrateTeamSnapshot(team, seriesId);
}

/**
 * @param {Record<string, unknown>} team
 * @param {string} seriesId
 * @returns {Promise<TeamSnapshot>}
 */
export async function hydrateTeamSnapshot(team, seriesId) {
    const normalized = normalizeTeam(team);
    const store = loadTeamStore();

    let members = /** @type {TeamMember[]} */ ([]);
    let activity = /** @type {Record<string, unknown>[]} */ ([]);
    let users = /** @type {Record<string, unknown>[]} */ ([]);

    if (await isTeamApiAvailable()) {
        const [remoteMembers, remoteActivity, remoteUsers] = await Promise.all([
            fetchTeamMembers(normalized.id),
            fetchTeamActivity(normalized.id),
            fetchUsers()
        ]);
        if (Array.isArray(remoteMembers)) {
            members = remoteMembers.map(normalizeMember);
            store.members[normalized.id] = members;
        }
        if (Array.isArray(remoteActivity)) {
            activity = remoteActivity;
            store.activity[normalized.id] = activity;
        }
        if (Array.isArray(remoteUsers)) {
            users = remoteUsers;
        }
    }

    if (members.length === 0) {
        members = (store.members[normalized.id] || []).map(normalizeMember);
    }
    if (activity.length === 0) {
        activity = store.activity[normalized.id] || [];
    }

    if (!store.teams.some((item) => item.id === normalized.id)) {
        store.teams.push(normalized);
    }
    persistTeamStore(store);

    return {
        ...normalized,
        members,
        activity,
        users
    };
}

/**
 * @param {string} teamId
 * @param {string} userId
 * @param {TeamRole} [role]
 */
export async function addMemberToTeam(teamId, userId, role = 'EDITOR') {
    let member = null;
    if (await isTeamApiAvailable()) {
        const result = await addTeamMember(teamId, { userId, role });
        if (!result?.disabled) {
            member = normalizeMember(result);
        }
    }

    if (!member) {
        const store = loadTeamStore();
        const existing = (store.members[teamId] || []).find((item) => item.userId === userId);
        member = existing || {
            id: `tm-local-${userId}`,
            teamId,
            userId,
            role,
            displayName: userId
        };
        store.members[teamId] = [...(store.members[teamId] || []).filter((item) => item.userId !== userId), member];
        persistTeamStore(store);
    }

    logTeamMemberAdded({
        teamId,
        userId: member.userId,
        role: member.role,
        displayName: member.displayName
    });

    return member;
}

/**
 * @param {string} teamId
 * @param {string} userId
 * @param {TeamRole} role
 */
export async function changeMemberRole(teamId, userId, role) {
    let member = null;
    if (await isTeamApiAvailable()) {
        const result = await updateTeamMemberRole(teamId, userId, { role });
        if (!result?.disabled) {
            member = normalizeMember(result);
        }
    }

    if (!member) {
        const store = loadTeamStore();
        store.members[teamId] = (store.members[teamId] || []).map((item) =>
            item.userId === userId ? { ...item, role } : item
        );
        member = normalizeMember(store.members[teamId].find((item) => item.userId === userId) || {
            teamId,
            userId,
            role
        });
        persistTeamStore(store);
    }

    logTeamRoleChanged({
        teamId,
        userId,
        role: member.role,
        displayName: member.displayName
    });

    return member;
}

/**
 * @param {string} teamId
 * @param {string} taskId
 * @param {string} userId
 * @param {string} [seriesId]
 */
export async function assignTaskToMember(teamId, taskId, userId, seriesId) {
    let result = null;
    if (await isTeamApiAvailable()) {
        result = await assignTeamTask(teamId, {
            taskId,
            userId,
            assignedBy: getCurrentTeamUserId()
        });
    }

    const memberName =
        result?.member?.displayName ||
        loadTeamStore().members[teamId]?.find((item) => item.userId === userId)?.displayName ||
        userId;

    logTaskAssigned({
        teamId,
        taskId,
        userId,
        assignedTo: memberName,
        seriesId: seriesId || null
    });

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('reelforge:task-assigned', {
                detail: {
                    taskId,
                    userId,
                    seriesId,
                    assigneeName: memberName,
                    taskTitle: result?.task?.title || result?.task?.metadata?.title || taskId
                }
            })
        );
        window.dispatchEvent(new CustomEvent('reelforge:workflow-tasks-updated'));
        window.dispatchEvent(new CustomEvent('reelforge:teams-updated'));
    }

    return result;
}

/**
 * @param {string} teamId
 * @param {string} userId
 * @param {string} seriesId
 */
export async function getAssignedTasksForMember(teamId, userId, seriesId) {
    if (await isTeamApiAvailable()) {
        const remote = await fetchAssignedTasks(teamId, userId, seriesId);
        if (Array.isArray(remote)) return remote;
    }

    const member = loadTeamStore().members[teamId]?.find((item) => item.userId === userId);
    const displayName = member?.displayName || userId;
    return getWorkflowTasksForSeries(seriesId).filter(
        (task) => task.assignedTo === displayName || task.assignedTo === userId
    );
}

/** @param {string} seriesId */
export function getOpenTasksForAssignment(seriesId) {
    return getWorkflowTasksForSeries(seriesId).filter((task) => task.status !== 'COMPLETE');
}

export function resetCreatorTeams() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TEAM_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('reelforge:teams-updated'));
}

let teamsInitialized = false;

export function initCreatorTeams() {
    if (typeof window === 'undefined' || teamsInitialized) return;
    teamsInitialized = true;

    window.__reelforgeTeams = {
        TEAM_ROLES,
        ensureTeamForSeries,
        addMemberToTeam,
        changeMemberRole,
        assignTaskToMember,
        getAssignedTasksForMember,
        getOpenTasksForAssignment,
        getCurrentTeamUserId,
        setCurrentTeamUserId,
        resetCreatorTeams
    };
}
