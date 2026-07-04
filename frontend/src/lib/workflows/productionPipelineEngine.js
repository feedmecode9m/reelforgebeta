/**
 * Phase 45 — Multi-user production pipeline engine.
 * Series-level task pipelines with ownership, handoffs, dependencies, and approval chains.
 * Integrates with creator teams and the existing workflow engine.
 */

import { buildEpisodeOperationRows } from '../series/productionHealth.js';
import {
    assignTaskToMember,
    ensureTeamForSeries,
    getCurrentTeamUserId
} from '../teams/creatorTeams.js';
import { syncWorkflowTasks } from '../workflow/workflowEngine.js';
import {
    approvePipelineEpisode,
    assignPipelineEpisode,
    movePipelineStage
} from '../pipeline/episodePipeline.js';

export const PRODUCTION_PIPELINE_VERSION = '1.0.0';
export const PRODUCTION_PIPELINE_STORAGE_KEY = 'reelforge_production_pipeline';

export const PRODUCTION_PIPELINE_STAGES = /** @type {const} */ ([
    'IDEA',
    'WRITING',
    'STORYBOARD',
    'PRODUCTION',
    'EDITING',
    'REVIEW',
    'APPROVAL',
    'PUBLISHING',
    'RELEASED'
]);

/** @type {Record<typeof PRODUCTION_PIPELINE_STAGES[number], string>} */
export const PRODUCTION_PIPELINE_STAGE_LABELS = {
    IDEA: 'Idea',
    WRITING: 'Writing',
    STORYBOARD: 'Storyboard',
    PRODUCTION: 'Production',
    EDITING: 'Editing',
    REVIEW: 'Review',
    APPROVAL: 'Approval',
    PUBLISHING: 'Publishing',
    RELEASED: 'Released'
};

/** @typedef {typeof PRODUCTION_PIPELINE_STAGES[number]} ProductionPipelineStage */

/**
 * @typedef {Object} ProductionPipelineHandoff
 * @property {string} fromUserId
 * @property {string} toUserId
 * @property {ProductionPipelineStage} stage
 * @property {number} timestamp
 */

/**
 * @typedef {Object} ProductionPipelineApproval
 * @property {string} userId
 * @property {number} approvedAt
 */

/**
 * @typedef {Object} ProductionPipelineTask
 * @property {string} id
 * @property {string} title
 * @property {string} [episodeId]
 * @property {ProductionPipelineStage} stage
 * @property {string | null} ownerUserId
 * @property {string | null} ownerDisplayName
 * @property {boolean} blocked
 * @property {string} blockReason
 * @property {string[]} dependsOn
 * @property {string[]} approvalChain
 * @property {ProductionPipelineApproval[]} approvals
 * @property {ProductionPipelineHandoff[]} handoffHistory
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} ProductionPipeline
 * @property {string} id
 * @property {string} seriesId
 * @property {ProductionPipelineTask[]} tasks
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} ProductionPipelineStore
 * @property {string} version
 * @property {Record<string, ProductionPipeline>} pipelines
 */

/**
 * @param {'PIPELINE_CREATED' | 'PIPELINE_STAGE' | 'PIPELINE_BLOCKED' | 'PIPELINE_APPROVED'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logProductionPipelineDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {ProductionPipelineStore} */
function defaultStore() {
    return { version: PRODUCTION_PIPELINE_VERSION, pipelines: {} };
}

/** @returns {ProductionPipelineStore} */
export function loadProductionPipelineStore() {
    if (typeof window === 'undefined') return defaultStore();
    try {
        const raw = localStorage.getItem(PRODUCTION_PIPELINE_STORAGE_KEY);
        if (!raw) return defaultStore();
        const parsed = JSON.parse(raw);
        return {
            version: PRODUCTION_PIPELINE_VERSION,
            pipelines: parsed.pipelines && typeof parsed.pipelines === 'object' ? parsed.pipelines : {}
        };
    } catch {
        return defaultStore();
    }
}

/** @param {ProductionPipelineStore} store */
function persistProductionPipelineStore(store) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(PRODUCTION_PIPELINE_STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent('reelforge:production-pipeline-updated', { detail: store }));
}

/** @param {string} [prefix] */
function createId(prefix = 'ppt') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** @param {string | null | undefined} stage */
export function normalizeProductionPipelineStage(stage) {
    const upper = String(stage || 'IDEA').toUpperCase();
    if (PRODUCTION_PIPELINE_STAGES.includes(/** @type {ProductionPipelineStage} */ (upper))) {
        return /** @type {ProductionPipelineStage} */ (upper);
    }
    const legacy = {
        SCRIPT: 'WRITING',
        READY: 'APPROVAL',
        PUBLISHED: 'RELEASED'
    };
    if (legacy[upper]) return legacy[upper];
    return 'IDEA';
}

/** @param {ProductionPipelineStage} from @param {ProductionPipelineStage} to */
function isValidStageTransition(from, to) {
    const fromIndex = PRODUCTION_PIPELINE_STAGES.indexOf(from);
    const toIndex = PRODUCTION_PIPELINE_STAGES.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return false;
    return toIndex === fromIndex || toIndex === fromIndex + 1 || toIndex === fromIndex - 1;
}

/** @param {string} seriesId @param {ProductionPipelineStore} store */
function getPipelineRecord(seriesId, store = loadProductionPipelineStore()) {
    return store.pipelines[seriesId] || null;
}

/**
 * @param {string} seriesId
 * @param {{ seedFromEpisodes?: boolean; feedReels?: Record<string, unknown>[] }} [options]
 */
export function createProductionPipeline(seriesId, options = {}) {
    const store = loadProductionPipelineStore();
    if (store.pipelines[seriesId]) {
        return store.pipelines[seriesId];
    }

    const pipeline = /** @type {ProductionPipeline} */ ({
        id: createId('pipe'),
        seriesId,
        tasks: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    if (options.seedFromEpisodes !== false && options.feedReels?.length) {
        const episodes = buildEpisodeOperationRows(options.feedReels, seriesId);
        for (const episode of episodes.slice(0, 12)) {
            pipeline.tasks.push({
                id: createId('task'),
                title: String(episode.episodeTitle || episode.episodeId),
                episodeId: String(episode.episodeId),
                stage: inferTaskStageFromEpisode(episode),
                ownerUserId: null,
                ownerDisplayName: null,
                blocked: false,
                blockReason: '',
                dependsOn: [],
                approvalChain: ['user-reviewer-1', 'user-producer-1'],
                approvals: [],
                handoffHistory: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }
    }

    store.pipelines[seriesId] = pipeline;
    persistProductionPipelineStore(store);

    logProductionPipelineDiag('PIPELINE_CREATED', {
        pipelineId: pipeline.id,
        seriesId,
        taskCount: pipeline.tasks.length
    });

    return pipeline;
}

/** @param {Record<string, unknown>} episode */
function inferTaskStageFromEpisode(episode) {
    if (episode.status === 'Published' || episode.publishingStatus === 'Published') return 'RELEASED';
    if (episode.status === 'Ready') return 'APPROVAL';
    if (episode.status === 'Scheduled') return 'PUBLISHING';
    if (episode.status === 'Missing Asset') return 'PRODUCTION';
    if (episode.metadataComplete && episode.reelInFeed) return 'EDITING';
    if (episode.reelInFeed) return 'PRODUCTION';
    if (episode.status === 'Draft') return 'WRITING';
    return 'IDEA';
}

/**
 * @param {string} seriesId
 * @param {{
 *   title?: string;
 *   episodeId?: string;
 *   stage?: ProductionPipelineStage | string;
 *   ownerUserId?: string;
 *   ownerDisplayName?: string;
 *   dependsOn?: string[];
 *   approvalChain?: string[];
 * }} [input]
 */
export function createProductionTask(seriesId, input = {}) {
    const store = loadProductionPipelineStore();
    const pipeline = store.pipelines[seriesId] || createProductionPipeline(seriesId);
    const task = /** @type {ProductionPipelineTask} */ ({
        id: createId('task'),
        title: String(input.title || input.episodeId || 'Production Task').trim() || 'Production Task',
        episodeId: input.episodeId ? String(input.episodeId) : undefined,
        stage: normalizeProductionPipelineStage(input.stage),
        ownerUserId: input.ownerUserId ? String(input.ownerUserId) : null,
        ownerDisplayName: input.ownerDisplayName ? String(input.ownerDisplayName) : null,
        blocked: false,
        blockReason: '',
        dependsOn: Array.isArray(input.dependsOn) ? input.dependsOn.map(String) : [],
        approvalChain: Array.isArray(input.approvalChain)
            ? input.approvalChain.map(String)
            : ['user-reviewer-1', 'user-producer-1'],
        approvals: [],
        handoffHistory: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    });

    pipeline.tasks.push(task);
    pipeline.updatedAt = Date.now();
    store.pipelines[seriesId] = pipeline;
    persistProductionPipelineStore(store);

    logProductionPipelineDiag('PIPELINE_CREATED', {
        entity: 'task',
        pipelineId: pipeline.id,
        taskId: task.id,
        seriesId,
        stage: task.stage
    });

    return task;
}

/**
 * @param {string} seriesId
 * @param {string} taskId
 * @param {string} userId
 * @param {string} [displayName]
 */
export async function assignTaskOwner(seriesId, taskId, userId, displayName = '') {
    const store = loadProductionPipelineStore();
    const pipeline = store.pipelines[seriesId];
    const task = pipeline?.tasks.find((item) => item.id === taskId);
    if (!pipeline || !task) throw new Error(`Production task not found: ${taskId}`);

    task.ownerUserId = userId;
    task.ownerDisplayName = displayName || userId;
    task.updatedAt = Date.now();
    pipeline.updatedAt = Date.now();
    persistProductionPipelineStore(store);

    const team = await ensureTeamForSeries(seriesId);
    if (team?.id) {
        try {
            await assignTaskToMember(team.id, taskId, userId, seriesId);
        } catch {
            // team assignment is best-effort when API is unavailable
        }
    }

    return task;
}

/**
 * @param {string} seriesId
 * @param {string} taskId
 * @param {string} toUserId
 * @param {{ fromUserId?: string; displayName?: string }} [options]
 */
export async function handoffTask(seriesId, taskId, toUserId, options = {}) {
    const store = loadProductionPipelineStore();
    const pipeline = store.pipelines[seriesId];
    const task = pipeline?.tasks.find((item) => item.id === taskId);
    if (!pipeline || !task) throw new Error(`Production task not found: ${taskId}`);

    const fromUserId = options.fromUserId || task.ownerUserId || getCurrentTeamUserId();
    task.handoffHistory.push({
        fromUserId,
        toUserId,
        stage: task.stage,
        timestamp: Date.now()
    });
    task.updatedAt = Date.now();
    pipeline.updatedAt = Date.now();
    persistProductionPipelineStore(store);

    await assignTaskOwner(seriesId, taskId, toUserId, options.displayName || toUserId);
    return task;
}

/** @param {ProductionPipelineTask} task @param {ProductionPipeline} pipeline */
function unresolvedDependencies(task, pipeline) {
    return task.dependsOn.filter((dependencyId) => {
        const dependency = pipeline.tasks.find((item) => item.id === dependencyId);
        if (!dependency) return true;
        return dependency.stage !== 'RELEASED';
    });
}

/**
 * @param {string} seriesId
 * @param {string} taskId
 * @param {ProductionPipelineStage | string} stage
 * @param {Record<string, unknown>[]} [feedReels]
 */
export async function transitionTaskStage(seriesId, taskId, stage, feedReels = []) {
    const store = loadProductionPipelineStore();
    const pipeline = store.pipelines[seriesId] || createProductionPipeline(seriesId, { feedReels });
    const task = pipeline.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Production task not found: ${taskId}`);

    const nextStage = normalizeProductionPipelineStage(stage);
    const fromStage = task.stage;

    if (task.blocked) {
        logProductionPipelineDiag('PIPELINE_BLOCKED', {
            taskId,
            seriesId,
            fromStage,
            toStage: nextStage,
            reason: task.blockReason || 'task_blocked'
        });
        throw new Error(task.blockReason || 'Task is blocked');
    }

    const pendingDependencies = unresolvedDependencies(task, pipeline);
    if (pendingDependencies.length > 0) {
        logProductionPipelineDiag('PIPELINE_BLOCKED', {
            taskId,
            seriesId,
            fromStage,
            toStage: nextStage,
            reason: 'dependencies_pending',
            dependsOn: pendingDependencies
        });
        throw new Error('Dependencies must reach Released before this transition');
    }

    if (nextStage === 'APPROVAL' && task.approvalChain.length > 0 && task.approvals.length < task.approvalChain.length) {
        logProductionPipelineDiag('PIPELINE_BLOCKED', {
            taskId,
            seriesId,
            fromStage,
            toStage: nextStage,
            reason: 'approval_chain_incomplete',
            requiredApprovals: task.approvalChain.length,
            receivedApprovals: task.approvals.length
        });
        throw new Error('Approval chain must complete before Approval stage');
    }

    if (!isValidStageTransition(fromStage, nextStage) && fromStage !== nextStage) {
        logProductionPipelineDiag('PIPELINE_BLOCKED', {
            taskId,
            seriesId,
            fromStage,
            toStage: nextStage,
            reason: 'invalid_transition'
        });
        throw new Error(`Invalid stage transition: ${fromStage} → ${nextStage}`);
    }

    task.stage = nextStage;
    task.updatedAt = Date.now();
    pipeline.updatedAt = Date.now();
    persistProductionPipelineStore(store);

    logProductionPipelineDiag('PIPELINE_STAGE', {
        taskId,
        seriesId,
        fromStage,
        toStage: nextStage,
        ownerUserId: task.ownerUserId
    });

    if (task.episodeId) {
        await syncEpisodePipelineFromTask(task, seriesId, feedReels);
    }

    void syncWorkflowTasks(seriesId, feedReels);
    return task;
}

/** @param {ProductionPipelineTask} task @param {string} seriesId @param {Record<string, unknown>[]} feedReels */
async function syncEpisodePipelineFromTask(task, seriesId, feedReels) {
    const episodeStageMap = {
        IDEA: 'IDEA',
        WRITING: 'SCRIPT',
        STORYBOARD: 'STORYBOARD',
        PRODUCTION: 'PRODUCTION',
        EDITING: 'EDITING',
        REVIEW: 'REVIEW',
        APPROVAL: 'READY',
        PUBLISHING: 'READY',
        RELEASED: 'PUBLISHED'
    };
    const mapped = episodeStageMap[task.stage];
    if (!mapped || !task.episodeId) return;

    try {
        if (mapped === 'PUBLISHED') {
            if (task.approvals.length >= Math.max(1, task.approvalChain.length)) {
                await movePipelineStage(task.episodeId, 'READY', seriesId, feedReels);
                await approvePipelineEpisode(task.episodeId, task.approvals.at(-1)?.userId, seriesId);
            }
        } else {
            await movePipelineStage(
                task.episodeId,
                /** @type {import('../pipeline/episodePipeline.js').PipelineStage} */ (mapped),
                seriesId,
                feedReels
            );
        }
        if (task.ownerUserId) {
            await assignPipelineEpisode(task.episodeId, task.ownerUserId, seriesId);
        }
    } catch {
        // episode pipeline sync is best-effort
    }
}

/**
 * @param {string} seriesId
 * @param {string} taskId
 * @param {string} [reason]
 */
export function blockTask(seriesId, taskId, reason = 'Blocked by production manager') {
    const store = loadProductionPipelineStore();
    const pipeline = store.pipelines[seriesId];
    const task = pipeline?.tasks.find((item) => item.id === taskId);
    if (!pipeline || !task) throw new Error(`Production task not found: ${taskId}`);

    task.blocked = true;
    task.blockReason = reason;
    task.updatedAt = Date.now();
    pipeline.updatedAt = Date.now();
    persistProductionPipelineStore(store);

    logProductionPipelineDiag('PIPELINE_BLOCKED', {
        taskId,
        seriesId,
        stage: task.stage,
        reason
    });

    return task;
}

/** @param {string} seriesId @param {string} taskId */
export function unblockTask(seriesId, taskId) {
    const store = loadProductionPipelineStore();
    const pipeline = store.pipelines[seriesId];
    const task = pipeline?.tasks.find((item) => item.id === taskId);
    if (!pipeline || !task) throw new Error(`Production task not found: ${taskId}`);

    task.blocked = false;
    task.blockReason = '';
    task.updatedAt = Date.now();
    pipeline.updatedAt = Date.now();
    persistProductionPipelineStore(store);
    return task;
}

/** @param {string} seriesId @param {string} taskId */
export function getTaskDependencies(seriesId, taskId) {
    const pipeline = getPipelineRecord(seriesId);
    const task = pipeline?.tasks.find((item) => item.id === taskId);
    if (!task) return { dependsOn: [], unresolved: [] };
    return {
        dependsOn: task.dependsOn,
        unresolved: pipeline ? unresolvedDependencies(task, pipeline) : []
    };
}

/**
 * @param {string} seriesId
 * @param {string} taskId
 * @param {string} [approverUserId]
 */
export function submitTaskApproval(seriesId, taskId, approverUserId = getCurrentTeamUserId()) {
    const store = loadProductionPipelineStore();
    const pipeline = store.pipelines[seriesId];
    const task = pipeline?.tasks.find((item) => item.id === taskId);
    if (!pipeline || !task) throw new Error(`Production task not found: ${taskId}`);

    if (!task.approvalChain.includes(approverUserId)) {
        logProductionPipelineDiag('PIPELINE_BLOCKED', {
            taskId,
            seriesId,
            reason: 'approver_not_in_chain',
            approverUserId
        });
        throw new Error('Approver is not in the approval chain');
    }

    if (task.approvals.some((entry) => entry.userId === approverUserId)) {
        return task;
    }

    task.approvals.push({ userId: approverUserId, approvedAt: Date.now() });
    task.updatedAt = Date.now();
    pipeline.updatedAt = Date.now();

    if (task.approvals.length >= task.approvalChain.length && task.stage === 'REVIEW') {
        task.stage = 'APPROVAL';
    }

    persistProductionPipelineStore(store);

    logProductionPipelineDiag('PIPELINE_APPROVED', {
        taskId,
        seriesId,
        approverUserId,
        approvalsReceived: task.approvals.length,
        approvalsRequired: task.approvalChain.length,
        stage: task.stage
    });

    return task;
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export async function buildProductionPipelineBoard(seriesId, feedReels = []) {
    const pipeline = createProductionPipeline(seriesId, { feedReels });
    const team = await ensureTeamForSeries(seriesId);
    const userNames = Object.fromEntries(
        (team?.members || []).map((member) => [member.userId, member.displayName])
    );

    /** @type {Record<ProductionPipelineStage, ProductionPipelineTask[]>} */
    const columns = Object.fromEntries(PRODUCTION_PIPELINE_STAGES.map((stage) => [stage, []]));

    for (const task of pipeline.tasks) {
        if (task.ownerUserId && !task.ownerDisplayName) {
            task.ownerDisplayName = userNames[task.ownerUserId] || task.ownerUserId;
        }
        const stage = normalizeProductionPipelineStage(task.stage);
        columns[stage].push(task);
    }

    for (const stage of PRODUCTION_PIPELINE_STAGES) {
        columns[stage].sort((a, b) => a.title.localeCompare(b.title));
    }

    return {
        seriesId,
        pipelineId: pipeline.id,
        columns,
        stages: PRODUCTION_PIPELINE_STAGES,
        stageLabels: PRODUCTION_PIPELINE_STAGE_LABELS
    };
}

let productionPipelineInitialized = false;

export function initProductionPipelineEngine() {
    if (typeof window === 'undefined' || productionPipelineInitialized) return;
    productionPipelineInitialized = true;

    window.__reelforgeProductionPipeline = {
        PRODUCTION_PIPELINE_VERSION,
        PRODUCTION_PIPELINE_STAGES,
        PRODUCTION_PIPELINE_STAGE_LABELS,
        createProductionPipeline,
        createProductionTask,
        assignTaskOwner,
        handoffTask,
        transitionTaskStage,
        blockTask,
        unblockTask,
        getTaskDependencies,
        submitTaskApproval,
        buildProductionPipelineBoard,
        loadProductionPipelineStore,
        logProductionPipelineDiag
    };

    logProductionPipelineDiag('PIPELINE_CREATED', {
        phase: 'engine_initialized',
        version: PRODUCTION_PIPELINE_VERSION,
        stageCount: PRODUCTION_PIPELINE_STAGES.length
    });
}
