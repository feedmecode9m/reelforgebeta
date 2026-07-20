/**
 * Phase 44 — Enterprise Foundation.
 * Organizational hierarchy for large studios: Organization → Studios → Departments → Teams → Series → Creators.
 */

import { computeProductionReadiness } from '../series/productionHealth.js';
import { getWorkflowOperationsSnapshot } from '../workflow/workflowEngine.js';
import { shouldStreamDiagnostics } from '../diagnostics/pipelineSnapshot.js';

export const ENTERPRISE_VERSION = '1.0.0';
export const ENTERPRISE_STORAGE_KEY = 'reelforge_enterprise_structure';

export const ENTERPRISE_ROLES = /** @type {const} */ ([
    'Owner',
    'Executive',
    'Producer',
    'Manager',
    'Creator',
    'Viewer'
]);

export const ENTERPRISE_HIERARCHY = /** @type {const} */ ([
    'Organization',
    'Studios',
    'Departments',
    'Teams',
    'Series',
    'Creators'
]);

/** @typedef {typeof ENTERPRISE_ROLES[number]} EnterpriseRole */

/**
 * @typedef {Object} EnterpriseCreator
 * @property {string} id
 * @property {string} userId
 * @property {string} displayName
 * @property {EnterpriseRole} role
 * @property {string} [seriesId]
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} EnterpriseSeries
 * @property {string} id
 * @property {string} title
 * @property {string} teamId
 * @property {string} [status]
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} EnterpriseTeam
 * @property {string} id
 * @property {string} name
 * @property {string} departmentId
 * @property {EnterpriseSeries[]} series
 * @property {EnterpriseCreator[]} creators
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} EnterpriseDepartment
 * @property {string} id
 * @property {string} name
 * @property {string} studioId
 * @property {EnterpriseTeam[]} teams
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} EnterpriseStudio
 * @property {string} id
 * @property {string} name
 * @property {string} organizationId
 * @property {EnterpriseDepartment[]} departments
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} EnterpriseRoleAssignment
 * @property {string} id
 * @property {string} userId
 * @property {string} displayName
 * @property {EnterpriseRole} role
 * @property {'organization' | 'studio' | 'department' | 'team' | 'series'} scopeType
 * @property {string} scopeId
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} EnterpriseOrganization
 * @property {string} id
 * @property {string} name
 * @property {EnterpriseStudio[]} studios
 * @property {EnterpriseRoleAssignment[]} roleAssignments
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} EnterpriseStore
 * @property {string} version
 * @property {EnterpriseOrganization[]} organizations
 * @property {string} activeOrganizationId
 */

/**
 * @typedef {Object} OrganizationHealthBrief
 * @property {string} organizationId
 * @property {string} organizationName
 * @property {number} healthScore
 * @property {string} grade
 * @property {{ studios: number; departments: number; teams: number; series: number; creators: number; roles: number }} counts
 * @property {string[]} gaps
 * @property {Record<string, unknown>} signals
 */

/**
 * @param {'ENTERPRISE_CREATED' | 'ENTERPRISE_ROLE' | 'ENTERPRISE_HEALTH'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logEnterpriseDiag(tag, detail = {}) {
    if (!shouldStreamDiagnostics()) return;
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {EnterpriseStore} */
function defaultEnterpriseStore() {
    return {
        version: ENTERPRISE_VERSION,
        organizations: [],
        activeOrganizationId: ''
    };
}

/** @returns {EnterpriseStore} */
export function loadEnterpriseStore() {
    if (typeof window === 'undefined') return defaultEnterpriseStore();
    try {
        const raw = localStorage.getItem(ENTERPRISE_STORAGE_KEY);
        if (!raw) return defaultEnterpriseStore();
        const parsed = JSON.parse(raw);
        return {
            version: ENTERPRISE_VERSION,
            organizations: Array.isArray(parsed.organizations) ? parsed.organizations : [],
            activeOrganizationId: String(parsed.activeOrganizationId || '')
        };
    } catch {
        return defaultEnterpriseStore();
    }
}

/** @param {EnterpriseStore} store */
function persistEnterpriseStore(store) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ENTERPRISE_STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent('reelforge:enterprise-updated', { detail: store }));
}

/** @param {string} [prefix] */
function createEnterpriseId(prefix = 'ent') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** @param {string | null | undefined} role */
export function normalizeEnterpriseRole(role) {
    const match = ENTERPRISE_ROLES.find((item) => item.toLowerCase() === String(role || '').toLowerCase());
    return match || 'Viewer';
}

/** @param {EnterpriseOrganization | null | undefined} organization */
export function countOrganizationEntities(organization) {
    const counts = {
        studios: 0,
        departments: 0,
        teams: 0,
        series: 0,
        creators: 0,
        roles: organization?.roleAssignments?.length || 0
    };
    if (!organization) return counts;

    for (const studio of organization.studios || []) {
        counts.studios += 1;
        for (const department of studio.departments || []) {
            counts.departments += 1;
            for (const team of department.teams || []) {
                counts.teams += 1;
                counts.series += (team.series || []).length;
                counts.creators += (team.creators || []).length;
            }
        }
    }
    return counts;
}

/**
 * @param {{ name?: string; ownerUserId?: string; ownerDisplayName?: string }} [input]
 */
export function createOrganization(input = {}) {
    const store = loadEnterpriseStore();
    const organization = /** @type {EnterpriseOrganization} */ ({
        id: createEnterpriseId('org'),
        name: String(input.name || 'ReelForge Studio Group').trim() || 'ReelForge Studio Group',
        studios: [],
        roleAssignments: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    const ownerUserId = String(input.ownerUserId || 'user-owner-1');
    const ownerDisplayName = String(input.ownerDisplayName || 'Organization Owner');
    organization.roleAssignments.push({
        id: createEnterpriseId('role'),
        userId: ownerUserId,
        displayName: ownerDisplayName,
        role: 'Owner',
        scopeType: 'organization',
        scopeId: organization.id,
        updatedAt: Date.now()
    });

    store.organizations.push(organization);
    store.activeOrganizationId = organization.id;
    persistEnterpriseStore(store);

    logEnterpriseDiag('ENTERPRISE_CREATED', {
        entity: 'organization',
        organizationId: organization.id,
        name: organization.name
    });

    return organization;
}

/**
 * @param {string} organizationId
 * @param {{ name?: string }} [input]
 */
export function createStudio(organizationId, input = {}) {
    const store = loadEnterpriseStore();
    const organization = store.organizations.find((item) => item.id === organizationId);
    if (!organization) throw new Error(`Organization not found: ${organizationId}`);

    const studio = /** @type {EnterpriseStudio} */ ({
        id: createEnterpriseId('studio'),
        name: String(input.name || 'Main Studio').trim() || 'Main Studio',
        organizationId,
        departments: [],
        updatedAt: Date.now()
    });

    organization.studios.push(studio);
    organization.updatedAt = Date.now();
    persistEnterpriseStore(store);

    logEnterpriseDiag('ENTERPRISE_CREATED', {
        entity: 'studio',
        organizationId,
        studioId: studio.id,
        name: studio.name
    });

    return studio;
}

/**
 * @param {string} organizationId
 * @param {string} studioId
 * @param {{ name?: string }} [input]
 */
export function createDepartment(organizationId, studioId, input = {}) {
    const store = loadEnterpriseStore();
    const organization = store.organizations.find((item) => item.id === organizationId);
    const studio = organization?.studios.find((item) => item.id === studioId);
    if (!organization || !studio) {
        throw new Error(`Studio not found: ${organizationId}/${studioId}`);
    }

    const department = /** @type {EnterpriseDepartment} */ ({
        id: createEnterpriseId('dept'),
        name: String(input.name || 'Production').trim() || 'Production',
        studioId,
        teams: [],
        updatedAt: Date.now()
    });

    studio.departments.push(department);
    organization.updatedAt = Date.now();
    persistEnterpriseStore(store);

    logEnterpriseDiag('ENTERPRISE_CREATED', {
        entity: 'department',
        organizationId,
        studioId,
        departmentId: department.id,
        name: department.name
    });

    return department;
}

/**
 * @param {string} organizationId
 * @param {string} studioId
 * @param {string} departmentId
 * @param {{ name?: string; seriesId?: string; seriesTitle?: string; creator?: { userId?: string; displayName?: string; role?: EnterpriseRole } }} [input]
 */
export function createTeam(organizationId, studioId, departmentId, input = {}) {
    const store = loadEnterpriseStore();
    const organization = store.organizations.find((item) => item.id === organizationId);
    const studio = organization?.studios.find((item) => item.id === studioId);
    const department = studio?.departments.find((item) => item.id === departmentId);
    if (!organization || !studio || !department) {
        throw new Error(`Department not found: ${organizationId}/${studioId}/${departmentId}`);
    }

    const team = /** @type {EnterpriseTeam} */ ({
        id: createEnterpriseId('team'),
        name: String(input.name || 'Production Team').trim() || 'Production Team',
        departmentId,
        series: [],
        creators: [],
        updatedAt: Date.now()
    });

    if (input.seriesId) {
        team.series.push({
            id: String(input.seriesId),
            title: String(input.seriesTitle || input.seriesId),
            teamId: team.id,
            status: 'active',
            updatedAt: Date.now()
        });
    }

    if (input.creator?.userId) {
        team.creators.push({
            id: createEnterpriseId('creator'),
            userId: String(input.creator.userId),
            displayName: String(input.creator.displayName || input.creator.userId),
            role: normalizeEnterpriseRole(input.creator.role || 'Creator'),
            seriesId: input.seriesId ? String(input.seriesId) : undefined,
            updatedAt: Date.now()
        });
    }

    department.teams.push(team);
    organization.updatedAt = Date.now();
    persistEnterpriseStore(store);

    logEnterpriseDiag('ENTERPRISE_CREATED', {
        entity: 'team',
        organizationId,
        studioId,
        departmentId,
        teamId: team.id,
        name: team.name,
        seriesCount: team.series.length,
        creatorCount: team.creators.length
    });

    return team;
}

/**
 * @param {{
 *   organizationId: string;
 *   userId: string;
 *   displayName?: string;
 *   role: EnterpriseRole | string;
 *   scopeType?: EnterpriseRoleAssignment['scopeType'];
 *   scopeId?: string;
 * }} input
 */
export function assignRole(input) {
    const store = loadEnterpriseStore();
    const organization = store.organizations.find((item) => item.id === input.organizationId);
    if (!organization) throw new Error(`Organization not found: ${input.organizationId}`);

    const role = normalizeEnterpriseRole(input.role);
    const scopeType = input.scopeType || 'organization';
    const scopeId = String(input.scopeId || organization.id);
    const existing = organization.roleAssignments.find(
        (item) => item.userId === input.userId && item.scopeType === scopeType && item.scopeId === scopeId
    );

    if (existing) {
        existing.role = role;
        existing.displayName = String(input.displayName || existing.displayName || input.userId);
        existing.updatedAt = Date.now();
        organization.updatedAt = Date.now();
        persistEnterpriseStore(store);
        logEnterpriseDiag('ENTERPRISE_ROLE', {
            action: 'updated',
            organizationId: organization.id,
            userId: existing.userId,
            role: existing.role,
            scopeType,
            scopeId
        });
        return existing;
    }

    const assignment = /** @type {EnterpriseRoleAssignment} */ ({
        id: createEnterpriseId('role'),
        userId: String(input.userId),
        displayName: String(input.displayName || input.userId),
        role,
        scopeType,
        scopeId,
        updatedAt: Date.now()
    });

    organization.roleAssignments.push(assignment);
    organization.updatedAt = Date.now();
    persistEnterpriseStore(store);

    logEnterpriseDiag('ENTERPRISE_ROLE', {
        action: 'assigned',
        organizationId: organization.id,
        userId: assignment.userId,
        role: assignment.role,
        scopeType,
        scopeId
    });

    return assignment;
}

/**
 * @param {string} [organizationId]
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function getOrganizationHealth(organizationId, feedReels = []) {
    const store = loadEnterpriseStore();
    const resolvedId = organizationId || store.activeOrganizationId || store.organizations[0]?.id || '';
    const organization = store.organizations.find((item) => item.id === resolvedId) || null;
    const counts = countOrganizationEntities(organization);

    const gaps = [];
    if (!organization) gaps.push('No active organization configured');
    if (counts.studios === 0) gaps.push('No studios provisioned');
    if (counts.departments === 0) gaps.push('No departments provisioned');
    if (counts.teams === 0) gaps.push('No teams provisioned');
    if (counts.series === 0) gaps.push('No series mapped to teams');
    if (counts.creators === 0) gaps.push('No creators assigned');
    if (!organization?.roleAssignments.some((item) => item.role === 'Owner')) gaps.push('Missing Owner role');

    let productionScore = 72;
    let workflowOpenTasks = 0;
    if (feedReels.length > 0 && counts.series > 0) {
        const seriesId = organization?.studios?.[0]?.departments?.[0]?.teams?.[0]?.series?.[0]?.id;
        if (seriesId) {
            try {
                productionScore = computeProductionReadiness(feedReels, seriesId).weightedPercent;
                workflowOpenTasks = getWorkflowOperationsSnapshot(seriesId, feedReels).openTaskCount;
            } catch {
                // keep defaults
            }
        }
    }

    const structureScore = Math.min(
        100,
        counts.studios * 12 +
            counts.departments * 10 +
            counts.teams * 10 +
            counts.series * 8 +
            counts.creators * 6 +
            Math.min(counts.roles * 4, 20)
    );
    const gapPenalty = gaps.length * 8;
    const healthScore = Math.max(0, Math.min(100, Math.round(structureScore * 0.55 + productionScore * 0.45 - gapPenalty)));

    const grade =
        healthScore >= 85 ? 'Excellent' : healthScore >= 70 ? 'Healthy' : healthScore >= 50 ? 'Developing' : 'At Risk';

    const brief = /** @type {OrganizationHealthBrief} */ ({
        organizationId: resolvedId,
        organizationName: organization?.name || 'Unassigned Organization',
        healthScore,
        grade,
        counts,
        gaps,
        signals: {
            hierarchy: ENTERPRISE_HIERARCHY,
            productionScore,
            workflowOpenTasks,
            roleCoverage: counts.roles,
            activeOrganizationId: store.activeOrganizationId
        }
    });

    logEnterpriseDiag('ENTERPRISE_HEALTH', {
        organizationId: brief.organizationId,
        organizationName: brief.organizationName,
        healthScore: brief.healthScore,
        grade: brief.grade,
        counts: brief.counts,
        gapCount: brief.gaps.length
    });

    return brief;
}

/** @param {string} [organizationId] */
export function getActiveOrganization(organizationId) {
    const store = loadEnterpriseStore();
    const resolvedId = organizationId || store.activeOrganizationId || store.organizations[0]?.id || '';
    return store.organizations.find((item) => item.id === resolvedId) || null;
}

/**
 * @param {string} [organizationId]
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function buildEnterpriseControlBrief(organizationId, feedReels = []) {
    const organization = getActiveOrganization(organizationId);
    const health = getOrganizationHealth(organization?.id, feedReels);
    const hierarchy = (organization?.studios || []).map((studio) => ({
        id: studio.id,
        name: studio.name,
        departments: (studio.departments || []).map((department) => ({
            id: department.id,
            name: department.name,
            teams: (department.teams || []).map((team) => ({
                id: team.id,
                name: team.name,
                series: team.series || [],
                creators: team.creators || []
            }))
        }))
    }));

    return {
        organization,
        health,
        hierarchy,
        roles: organization?.roleAssignments || [],
        hierarchyLabels: ENTERPRISE_HIERARCHY,
        roleLabels: ENTERPRISE_ROLES
    };
}

let enterpriseInitialized = false;

export function initEnterpriseManager() {
    if (typeof window === 'undefined' || enterpriseInitialized) return;
    enterpriseInitialized = true;

    window.__reelforgeEnterprise = {
        ENTERPRISE_VERSION,
        ENTERPRISE_STORAGE_KEY,
        ENTERPRISE_ROLES,
        ENTERPRISE_HIERARCHY,
        createOrganization,
        createStudio,
        createDepartment,
        createTeam,
        assignRole,
        getOrganizationHealth,
        getActiveOrganization,
        buildEnterpriseControlBrief,
        loadEnterpriseStore,
        logEnterpriseDiag
    };

    logEnterpriseDiag('ENTERPRISE_CREATED', {
        phase: 'engine_initialized',
        version: ENTERPRISE_VERSION,
        hierarchy: ENTERPRISE_HIERARCHY,
        roles: ENTERPRISE_ROLES
    });
}
