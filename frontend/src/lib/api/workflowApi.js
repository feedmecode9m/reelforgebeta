import { API_BASE_URL, fetchWithRetry } from '../api.js';
import { enforceWorkflowPolicy } from '../security/securityPolicyEngine.js';

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
function logWorkflowDbDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {Record<string, unknown>} detail */
export function logWorkflowDbRead(detail = {}) {
    logWorkflowDbDiag('WORKFLOW_DB_READ', detail);
}

/** @param {Record<string, unknown>} detail */
export function logWorkflowDbWrite(detail = {}) {
    logWorkflowDbDiag('WORKFLOW_DB_WRITE', detail);
}

async function workflowFetch(path, options = {}, meta = {}) {
    const method = options.method || 'GET';
    const isWrite = method !== 'GET' && method !== 'HEAD';

    const res = await fetchWithRetry(`${API_BASE_URL}${path}`, options, { retries: 1 });
    if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        return { disabled: true, error: body.error || 'Workflow API disabled' };
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Workflow API failed (${res.status})`);
    }

    const body = await res.json();
    if (isWrite) {
        logWorkflowDbWrite({ path, method, ...meta });
    } else {
        logWorkflowDbRead({ path, method, ...meta });
    }
    return body;
}

/** @returns {Promise<{ enabled?: boolean; count?: number; disabled?: boolean; error?: string }>} */
export async function fetchWorkflowApiStatus() {
    try {
        const res = await fetchWithRetry(
            `${API_BASE_URL}/api/workflow/status`,
            { signal: AbortSignal.timeout(4000) },
            { retries: 0, retryDelayMs: 250 }
        );
        if (res.status === 404) {
            const body = await res.json().catch(() => ({}));
            return { disabled: true, error: body.error || 'Workflow API disabled' };
        }
        if (!res.ok) {
            return { disabled: true, error: `Workflow API failed (${res.status})` };
        }
        const body = await res.json();
        logWorkflowDbRead({ path: '/api/workflow/status', source: 'status' });
        return body;
    } catch (err) {
        return { disabled: true, error: err?.message || 'Workflow API unavailable' };
    }
}

/** @returns {Promise<boolean>} */
export async function isWorkflowApiAvailable() {
    const status = await fetchWorkflowApiStatus();
    return !status.disabled && status.enabled !== false;
}

/** @param {string} [seriesId] */
export async function fetchWorkflowTasks(seriesId) {
    try {
        const query = seriesId ? `?seriesId=${encodeURIComponent(seriesId)}` : '';
        return await workflowFetch(`/api/workflow/tasks${query}`, {}, { seriesId, source: 'tasks' });
    } catch (err) {
        return { disabled: true, error: err?.message || 'Workflow API unavailable' };
    }
}

/** @param {Record<string, unknown>} task */
export async function createWorkflowTask(task) {
    const policy = enforceWorkflowPolicy({ operation: 'create_workflow_task_api' });
    if (!policy.allowed) {
        throw new Error(policy.reason);
    }
    return workflowFetch(
        '/api/workflow/tasks',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(task)
        },
        { taskId: task.id, seriesId: task.seriesId, source: 'create-task' }
    );
}

/** @param {string} taskId @param {Record<string, unknown>} updates */
export async function updateWorkflowTask(taskId, updates) {
    const policy = enforceWorkflowPolicy({ operation: 'update_workflow_task_api' });
    if (!policy.allowed) {
        throw new Error(policy.reason);
    }
    return workflowFetch(
        `/api/workflow/tasks/${encodeURIComponent(taskId)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        },
        { taskId, source: 'update-task' }
    );
}

/** @param {string} taskId */
export async function deleteWorkflowTask(taskId) {
    const policy = enforceWorkflowPolicy({ operation: 'delete_workflow_task_api' });
    if (!policy.allowed) {
        throw new Error(policy.reason);
    }
    return workflowFetch(
        `/api/workflow/tasks/${encodeURIComponent(taskId)}`,
        { method: 'DELETE' },
        { taskId, source: 'delete-task' }
    );
}

/** @param {Record<string, unknown>} apiTask */
export function apiTaskToOperational(apiTask) {
    return {
        id: String(apiTask.id),
        seriesId: String(apiTask.seriesId),
        episodeId: apiTask.episodeId ? String(apiTask.episodeId) : '',
        taskType: apiTask.taskType,
        priority: Number(apiTask.priority) || 4,
        estimatedImpact: Number(apiTask.estimatedImpact ?? apiTask.metadata?.estimatedImpact) || 1,
        status: apiTask.status || 'PENDING',
        createdAt: apiTask.createdAt ? Date.parse(apiTask.createdAt) || Date.now() : Date.now(),
        title: apiTask.title ? String(apiTask.title) : undefined,
        reelId: apiTask.reelId ? String(apiTask.reelId) : null,
        estimatedMinutes:
            apiTask.estimatedMinutes != null
                ? Number(apiTask.estimatedMinutes)
                : apiTask.metadata?.estimatedMinutes != null
                  ? Number(apiTask.metadata.estimatedMinutes)
                  : undefined,
        assignedTo: apiTask.assignedTo ? String(apiTask.assignedTo) : null,
        completedAt: apiTask.completedAt ? Date.parse(apiTask.completedAt) : null
    };
}

/** @param {import('../workflow/workflowEngine.js').WorkflowOperationalTask} task */
export function operationalTaskToApi(task) {
    return {
        id: task.id,
        seriesId: task.seriesId,
        episodeId: task.episodeId || undefined,
        taskType: task.taskType,
        priority: task.priority,
        status: task.status,
        assignedTo: task.assignedTo || undefined,
        title: task.title,
        reelId: task.reelId || undefined,
        estimatedImpact: task.estimatedImpact,
        estimatedMinutes: task.estimatedMinutes
    };
}
