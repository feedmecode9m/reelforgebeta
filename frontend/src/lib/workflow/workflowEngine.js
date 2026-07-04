/**
 * Phase 15 — Production workflow engine with PostgreSQL-backed task persistence.
 * Orchestrates productionHealth + actionEngine diagnostics into actionable work items.
 * Offline fallback: localStorage cache when API unavailable.
 */

import { writable } from 'svelte/store';
import {
    buildWorkflowTasks,
    buildTaskNavigation,
    projectReadinessFromWorkflow,
    WORKFLOW_NAV_TARGETS
} from '../series/workflowEngine.js';
import { buildStudioActionPlan } from '../series/actionEngine.js';
import { computeProductionReadiness } from '../series/productionHealth.js';
import { STUDIO_HELP } from '../studio/studioHelpRegistry.js';
import {
    fetchWorkflowTasks,
    createWorkflowTask,
    updateWorkflowTask,
    isWorkflowApiAvailable,
    apiTaskToOperational,
    operationalTaskToApi,
    logWorkflowDbRead,
    logWorkflowDbWrite
} from '../api/workflowApi.js';
import { enforceWorkflowPolicy } from '../security/securityPolicyEngine.js';

export const WORKFLOW_TASK_STORAGE_KEY = 'reelforge_workflow_tasks';

/** @typedef {'PENDING' | 'IN_PROGRESS' | 'COMPLETE'} WorkflowTaskStatus */

/** @typedef {'MISSING_ASSET' | 'MISSING_METADATA' | 'UNPUBLISHED_EPISODE' | 'MISSING_RUNTIME' | 'MISSING_THUMBNAIL' | 'MISSING_RELEASE_DATE'} WorkflowTaskType */

/**
 * @typedef {Object} WorkflowOperationalTask
 * @property {string} id
 * @property {string} seriesId
 * @property {string} episodeId
 * @property {WorkflowTaskType} taskType
 * @property {number} priority
 * @property {number} estimatedImpact
 * @property {WorkflowTaskStatus} status
 * @property {number} createdAt
 * @property {string} [title]
 * @property {string | null} [reelId]
 * @property {number} [estimatedMinutes]
 * @property {string | null} [assignedTo]
 * @property {number | null} [completedAt]
 */

/** @type {readonly WorkflowTaskType[]} */
export const WORKFLOW_TASK_TYPES = /** @type {const} */ ([
    'MISSING_ASSET',
    'MISSING_METADATA',
    'UNPUBLISHED_EPISODE',
    'MISSING_RUNTIME',
    'MISSING_THUMBNAIL',
    'MISSING_RELEASE_DATE'
]);

/** @type {readonly WorkflowTaskStatus[]} */
export const WORKFLOW_TASK_STATUSES = /** @type {const} */ ([
    'PENDING',
    'IN_PROGRESS',
    'COMPLETE'
]);

/** @type {'local' | 'api' | 'syncing'} */
export const workflowPersistenceMode = writable('local');

/** @type {Record<string, WorkflowTaskType>} */
const ACTION_TO_TASK_TYPE = {
    'missing-asset': 'MISSING_ASSET',
    'missing-description': 'MISSING_METADATA',
    'missing-runtime': 'MISSING_RUNTIME',
    'missing-thumbnail': 'MISSING_THUMBNAIL',
    'unpublished-episode': 'UNPUBLISHED_EPISODE',
    'unscheduled-episode': 'MISSING_RELEASE_DATE'
};

let apiHydrationStarted = false;
const WORKFLOW_SYNC_MEMO_TTL_MS = 1_500;
/** @type {Map<string, { hash: string; at: number; result: ReturnType<typeof syncWorkflowTasks> }>} */
const workflowSyncMemo = new Map();

/**
 * @param {Record<string, unknown>[]} feedReels
 */
function buildFeedSignature(feedReels = []) {
    return (feedReels || [])
        .map((reel) =>
            [
                reel?.id || reel?.reelId || '',
                reel?.episodeId || reel?.episode_id || '',
                reel?.url || reel?.video_url || reel?.videoUrl || '',
                reel?.thumbnail || reel?.thumbnailUrl || ''
            ].join('|')
        )
        .join('||');
}

/**
 * @param {WorkflowOperationalTask[]} tasks
 */
function buildTaskSignature(tasks = []) {
    return tasks
        .map((task) =>
            [
                task.id,
                task.seriesId,
                task.status,
                task.priority,
                task.estimatedImpact,
                task.reelId || '',
                task.completedAt || 0
            ].join(':')
        )
        .join('|');
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
export function logWorkflowTaskDiag(tag, detail) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {{ version: number; tasks: WorkflowOperationalTask[] }} */
export function loadWorkflowTaskStore() {
    if (typeof window === 'undefined') return { version: 1, tasks: [] };
    try {
        const raw = localStorage.getItem(WORKFLOW_TASK_STORAGE_KEY);
        if (!raw) return { version: 1, tasks: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.tasks)) return { version: 1, tasks: [] };
        return { version: 1, tasks: parsed.tasks };
    } catch {
        return { version: 1, tasks: [] };
    }
}

/** @param {{ version: number; tasks: WorkflowOperationalTask[] }} store */
export function persistWorkflowTaskStore(store) {
    if (typeof window === 'undefined') return false;
    try {
        const next = JSON.stringify(store);
        const prev = localStorage.getItem(WORKFLOW_TASK_STORAGE_KEY);
        if (prev === next) return true;
        localStorage.setItem(WORKFLOW_TASK_STORAGE_KEY, next);
        window.dispatchEvent(new CustomEvent('reelforge:workflow-tasks-updated'));
        void pushStoreToApi(store);
        return true;
    } catch {
        return false;
    }
}

/** @param {{ version: number; tasks: WorkflowOperationalTask[] }} store */
async function pushStoreToApi(store) {
    try {
        const available = await isWorkflowApiAvailable();
        if (!available) {
            logWorkflowDbWrite({ source: 'fallback', reason: 'api-unavailable' });
            workflowPersistenceMode.set('local');
            return;
        }

        for (const task of store.tasks) {
            await createWorkflowTask(operationalTaskToApi(task));
        }
        workflowPersistenceMode.set('api');
    } catch (err) {
        logWorkflowDbWrite({
            source: 'fallback',
            reason: err?.message || 'api-push-failed'
        });
        workflowPersistenceMode.set('local');
    }
}

/** Hydrate workflow tasks from PostgreSQL when available. */
export async function hydrateWorkflowTasksFromApi() {
    try {
        const available = await isWorkflowApiAvailable();
        if (!available) {
            logWorkflowDbRead({ source: 'fallback', reason: 'api-unavailable' });
            workflowPersistenceMode.set('local');
            return loadWorkflowTaskStore();
        }

        const response = await fetchWorkflowTasks();
        if (response?.disabled) {
            logWorkflowDbRead({ source: 'fallback', reason: response.error || 'api-disabled' });
            workflowPersistenceMode.set('local');
            return loadWorkflowTaskStore();
        }

        if (Array.isArray(response)) {
            const tasks = response.map((row) => apiTaskToOperational(row));
            const store = { version: 1, tasks };
            if (typeof window !== 'undefined') {
                localStorage.setItem(WORKFLOW_TASK_STORAGE_KEY, JSON.stringify(store));
            }
            workflowPersistenceMode.set('api');
            logWorkflowDbRead({ source: 'api', taskCount: tasks.length });
            return store;
        }

        return loadWorkflowTaskStore();
    } catch (err) {
        logWorkflowDbRead({ source: 'fallback', reason: err?.message || 'api-error' });
        workflowPersistenceMode.set('local');
        return loadWorkflowTaskStore();
    }
}

/** @param {number} impact */
function priorityFromImpact(impact) {
    if (impact >= 10) return 1;
    if (impact >= 5) return 2;
    if (impact >= 2) return 3;
    return 4;
}

/**
 * @param {import('../series/workflowEngine.js').WorkflowTask} candidate
 * @param {string} seriesId
 */
function createOperationalTask(candidate, seriesId) {
    return {
        id: candidate.id,
        seriesId,
        episodeId: candidate.episodeId || '',
        taskType: ACTION_TO_TASK_TYPE[candidate.actionType] || 'MISSING_METADATA',
        priority: priorityFromImpact(candidate.impact),
        estimatedImpact: candidate.impact,
        status: /** @type {WorkflowTaskStatus} */ ('PENDING'),
        createdAt: Date.now(),
        title: candidate.title,
        reelId: candidate.navigation?.reelId || null,
        estimatedMinutes: candidate.estimatedMinutes,
        assignedTo: null,
        completedAt: null
    };
}

/**
 * @param {WorkflowOperationalTask} task
 */
async function persistTaskMutation(task) {
    try {
        const available = await isWorkflowApiAvailable();
        if (!available) {
            logWorkflowDbWrite({ source: 'fallback', taskId: task.id, reason: 'api-unavailable' });
            return;
        }
        await updateWorkflowTask(task.id, operationalTaskToApi(task));
        workflowPersistenceMode.set('api');
    } catch (err) {
        logWorkflowDbWrite({
            source: 'fallback',
            taskId: task.id,
            reason: err?.message || 'api-update-failed'
        });
    }
}

/**
 * Sync generated production gaps with persisted workflow tasks.
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function syncWorkflowTasks(seriesId, feedReels = []) {
    const currentStore = loadWorkflowTaskStore();
    const inputHash = `${seriesId}::${buildFeedSignature(feedReels)}::${buildTaskSignature(currentStore.tasks.filter((task) => task.seriesId === seriesId))}`;
    const memo = workflowSyncMemo.get(seriesId);
    const now = Date.now();
    if (memo && memo.hash === inputHash && now - memo.at < WORKFLOW_SYNC_MEMO_TTL_MS) {
        return memo.result;
    }

    const policy = enforceWorkflowPolicy({ operation: 'sync_workflow_tasks' });
    if (!policy.allowed) {
        const existingTasks = getWorkflowTasksForSeries(seriesId);
        const blockedResult = {
            tasks: existingTasks,
            plan: { tasks: [] },
            projected: { readinessBefore: 0, readinessAfter: 0 },
            actionPlan: { recommendations: [], blockers: [], quickWins: [] },
            created: 0,
            completed: 0
        };
        logWorkflowTaskDiag('WORKFLOW_ENGINE', {
            seriesId,
            blockedByPolicy: true,
            reason: policy.reason,
            taskCount: existingTasks.filter((task) => task.status !== 'COMPLETE').length
        });
        workflowSyncMemo.set(seriesId, { hash: inputHash, at: now, result: blockedResult });
        return blockedResult;
    }

    const plan = buildWorkflowTasks(seriesId, feedReels);
    const actionPlan = buildStudioActionPlan(seriesId, feedReels);
    const store = loadWorkflowTaskStore();
    const candidateIds = new Set(plan.tasks.map((task) => task.id));
    let created = 0;
    let completed = 0;
    let missingAssetCreated = 0;

    for (const candidate of plan.tasks) {
        const existing = store.tasks.find((task) => task.id === candidate.id);
        if (!existing) {
            const task = createOperationalTask(candidate, seriesId);
            store.tasks.push(task);
            created += 1;
            if (task.taskType === 'MISSING_ASSET') {
                missingAssetCreated += 1;
            }
            logWorkflowTaskDiag('WORKFLOW_TASK_CREATED', {
                taskId: task.id,
                seriesId,
                episodeId: task.episodeId,
                taskType: task.taskType,
                priority: task.priority,
                estimatedImpact: task.estimatedImpact
            });
        } else {
            existing.estimatedImpact = candidate.impact;
            existing.priority = priorityFromImpact(candidate.impact);
            existing.title = candidate.title;
            existing.reelId = candidate.navigation?.reelId || existing.reelId || null;
            existing.estimatedMinutes = candidate.estimatedMinutes;
        }
    }

    for (const task of store.tasks) {
        if (task.seriesId !== seriesId) continue;
        if (task.status === 'COMPLETE') continue;
        if (!candidateIds.has(task.id)) {
            task.status = 'COMPLETE';
            task.completedAt = Date.now();
            completed += 1;
            logWorkflowTaskDiag('WORKFLOW_TASK_COMPLETED', {
                taskId: task.id,
                seriesId,
                episodeId: task.episodeId,
                autoResolved: true
            });
        }
    }

    persistWorkflowTaskStore(store);

    if (missingAssetCreated > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('reelforge:asset-missing-detected', {
                detail: { seriesId, count: missingAssetCreated }
            })
        );
    }

    const seriesTasks = store.tasks
        .filter((task) => task.seriesId === seriesId)
        .sort((a, b) => a.priority - b.priority || b.estimatedImpact - a.estimatedImpact);

    const projected = projectReadinessFromWorkflow(plan);

    logWorkflowTaskDiag('WORKFLOW_ENGINE', {
        seriesId,
        taskCount: seriesTasks.filter((t) => t.status !== 'COMPLETE').length,
        created,
        completed,
        readinessBefore: projected.readinessBefore,
        readinessAfter: projected.readinessAfter,
        actionRecommendations: actionPlan.recommendations.length,
        usesMockData: false,
        helpAvailable: Boolean(STUDIO_HELP.productionHealth)
    });

    const result = {
        tasks: seriesTasks,
        plan,
        projected,
        actionPlan,
        created,
        completed
    };
    workflowSyncMemo.set(seriesId, { hash: inputHash, at: now, result });
    return result;
}

/** @param {string} seriesId */
export function getWorkflowTasksForSeries(seriesId) {
    return loadWorkflowTaskStore()
        .tasks.filter((task) => task.seriesId === seriesId)
        .sort((a, b) => a.priority - b.priority || b.estimatedImpact - a.estimatedImpact);
}

/** @param {string} taskId */
export function assignWorkflowTask(taskId) {
    const policy = enforceWorkflowPolicy({ operation: 'assign_workflow_task' });
    if (!policy.allowed) {
        logWorkflowTaskDiag('WORKFLOW_TASK_ASSIGNED', {
            taskId,
            blockedByPolicy: true,
            reason: policy.reason
        });
        return null;
    }

    const store = loadWorkflowTaskStore();
    const task = store.tasks.find((item) => item.id === taskId);
    if (!task) return null;
    task.status = 'IN_PROGRESS';
    task.assignedTo = 'studio';
    persistWorkflowTaskStore(store);
    void persistTaskMutation(task);
    logWorkflowTaskDiag('WORKFLOW_TASK_ASSIGNED', {
        taskId: task.id,
        seriesId: task.seriesId,
        episodeId: task.episodeId,
        taskType: task.taskType
    });
    return task;
}

/** @param {string} taskId */
export function completeWorkflowTask(taskId) {
    const policy = enforceWorkflowPolicy({ operation: 'complete_workflow_task' });
    if (!policy.allowed) {
        logWorkflowTaskDiag('WORKFLOW_TASK_COMPLETED', {
            taskId,
            blockedByPolicy: true,
            reason: policy.reason
        });
        return null;
    }

    const store = loadWorkflowTaskStore();
    const task = store.tasks.find((item) => item.id === taskId);
    if (!task) return null;
    task.status = 'COMPLETE';
    task.completedAt = Date.now();
    persistWorkflowTaskStore(store);
    void persistTaskMutation(task);
    logWorkflowTaskDiag('WORKFLOW_TASK_COMPLETED', {
        taskId: task.id,
        seriesId: task.seriesId,
        episodeId: task.episodeId,
        taskType: task.taskType
    });
    return task;
}

/**
 * Resolve legacy navigation for a persisted task.
 * @param {WorkflowOperationalTask} task
 */
export function resolveTaskNavigation(task) {
    const actionType = Object.entries(ACTION_TO_TASK_TYPE).find(([, type]) => type === task.taskType)?.[0];
    if (!actionType) return buildTaskNavigation('missing-description', task.episodeId, task.reelId);
    return buildTaskNavigation(
        /** @type {import('../series/workflowEngine.js').WorkflowActionType} */ (actionType),
        task.episodeId,
        task.reelId
    );
}

/** @param {string} seriesId @param {Record<string, unknown>[]} [feedReels] */
export function getWorkflowOperationsSnapshot(seriesId, feedReels = []) {
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const sync = syncWorkflowTasks(seriesId, feedReels);
    const open = sync.tasks.filter((task) => task.status !== 'COMPLETE');
    return {
        seriesId,
        readinessScore: readiness.weightedPercent,
        projectedReadiness: sync.projected.readinessAfter,
        openTaskCount: open.length,
        pendingCount: open.filter((task) => task.status === 'PENDING').length,
        inProgressCount: open.filter((task) => task.status === 'IN_PROGRESS').length,
        completeCount: sync.tasks.filter((task) => task.status === 'COMPLETE').length
    };
}

export function resetWorkflowTasks() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(WORKFLOW_TASK_STORAGE_KEY);
}

export function initWorkflowEngine() {
    if (typeof window === 'undefined') return;

    if (!apiHydrationStarted) {
        apiHydrationStarted = true;
        void hydrateWorkflowTasksFromApi();
    }

    window.__reelforgeWorkflow = {
        syncWorkflowTasks,
        assignWorkflowTask,
        completeWorkflowTask,
        getWorkflowTasksForSeries,
        resetWorkflowTasks,
        hydrateWorkflowTasksFromApi,
        buildWorkflowTasks,
        projectReadinessFromWorkflow,
        WORKFLOW_NAV_TARGETS,
        WORKFLOW_TASK_TYPES,
        WORKFLOW_TASK_STATUSES
    };
}
