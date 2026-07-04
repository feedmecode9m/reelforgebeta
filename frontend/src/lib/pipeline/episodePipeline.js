/**
 * Phase 31 — multi-user episode production pipeline.
 */

export { PIPELINE_STAGES } from '../api/pipelineApi.js';

import {
    PIPELINE_STAGES,
    fetchPipeline,
    isPipelineApiAvailable,
    logPipelineDiag,
    normalizePipelineRow,
    updatePipelineEpisode
} from '../api/pipelineApi.js';
import { buildEpisodeOperationRows } from '../series/productionHealth.js';
import {
    assignTaskToMember,
    ensureTeamForSeries,
    getCurrentTeamUserId
} from '../teams/creatorTeams.js';
import { syncWorkflowTasks } from '../workflow/workflowEngine.js';
import { scheduleEpisodeRelease } from '../release/releaseCenter.js';

export const PIPELINE_STORAGE_KEY = 'reelforge_episode_pipeline';

/** @typedef {typeof PIPELINE_STAGES[number]} PipelineStage */

/**
 * @typedef {Object} PipelineCard
 * @property {string} id
 * @property {string} episodeId
 * @property {string} title
 * @property {PipelineStage} stage
 * @property {string | null} assignedUserId
 * @property {string | null} assignedUserName
 * @property {string | null} approvedBy
 * @property {string | null} approvedByName
 * @property {number} updatedAt
 * @property {boolean} hasAsset
 * @property {'none' | 'pending' | 'approved' | 'blocked'} reviewStatus
 * @property {boolean} publishingBlocked
 */

/** @param {Record<string, unknown> | null | undefined} row */
function resolveReviewStatus(row) {
    if (!row) return 'none';
    if (row.approvedBy) return 'approved';
    if (row.stage === 'REVIEW') return 'pending';
    if (row.stage === 'READY' && !row.approvedBy) return 'blocked';
    return 'none';
}

/** @param {string} episodeId */
export function getPipelineReviewStatus(episodeId) {
    const store = loadPipelineStore();
    const row = store.rows.find((item) => String(item.episodeId || item.episode_id) === episodeId);
    return resolveReviewStatus(row);
}

/** @param {string} episodeId */
export function isPublishingBlocked(episodeId) {
    const store = loadPipelineStore();
    const row = store.rows.find((item) => String(item.episodeId || item.episode_id) === episodeId);
    if (!row) return true;
    return row.stage !== 'READY' || !row.approvedBy;
}

/** @returns {{ version: number; rows: Record<string, unknown>[] }} */
function loadPipelineStore() {
    if (typeof window === 'undefined') return { version: 1, rows: [] };
    try {
        const raw = localStorage.getItem(PIPELINE_STORAGE_KEY);
        if (!raw) return { version: 1, rows: [] };
        const parsed = JSON.parse(raw);
        return { version: 1, rows: Array.isArray(parsed.rows) ? parsed.rows : [] };
    } catch {
        return { version: 1, rows: [] };
    }
}

/** @param {{ version: number; rows: Record<string, unknown>[] }} store */
function persistPipelineStore(store) {
    if (typeof window === 'undefined') return;
    const next = JSON.stringify(store);
    const prev = localStorage.getItem(PIPELINE_STORAGE_KEY);
    if (prev === next) return;
    localStorage.setItem(PIPELINE_STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent('reelforge:pipeline-updated'));
}

/** @param {Record<string, unknown>} row @param {Record<string, string>} [userNames] */
function enrichPipelineRow(row, userNames = {}) {
    const normalized = normalizePipelineRow(row);
    return {
        ...normalized,
        assignedUserName: normalized.assignedUserId
            ? userNames[normalized.assignedUserId] || normalized.assignedUserId
            : null,
        approvedByName: normalized.approvedBy
            ? userNames[normalized.approvedBy] || normalized.approvedBy
            : null
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export async function hydratePipeline(seriesId, feedReels = []) {
    const episodes = buildEpisodeOperationRows(feedReels, seriesId);
    const episodeIds = episodes.map((row) => row.episodeId);
    const store = loadPipelineStore();

    let remoteRows = [];
    if (await isPipelineApiAvailable()) {
        const remote = await fetchPipeline(seriesId, episodeIds);
        if (Array.isArray(remote)) {
            remoteRows = remote;
        }
    }

    const merged = new Map(
        store.rows
            .filter((row) => episodeIds.includes(String(row.episodeId || row.episode_id)))
            .map((row) => [String(row.episodeId || row.episode_id), normalizePipelineRow(row)])
    );

    for (const row of remoteRows) {
        const normalized = normalizePipelineRow(row);
        merged.set(normalized.episodeId, normalized);
    }

    for (const episode of episodes) {
        if (!merged.has(episode.episodeId)) {
            merged.set(episode.episodeId, {
                id: `pip-local-${episode.episodeId}`,
                episodeId: episode.episodeId,
                stage: inferInitialStage(episode),
                assignedUserId: null,
                approvedBy: null,
                updatedAt: Date.now()
            });
        }
    }

    store.rows = Array.from(merged.values());
    persistPipelineStore(store);
    return buildPipelineBoard(seriesId, feedReels);
}

/** @param {Record<string, unknown>} episode */
function inferInitialStage(episode) {
    if (episode.status === 'Published' || episode.publishingStatus === 'Published') {
        return 'PUBLISHED';
    }
    if (episode.status === 'Ready') return 'READY';
    if (episode.status === 'Scheduled') return 'REVIEW';
    if (episode.status === 'Missing Asset') return 'PRODUCTION';
    if (episode.metadataComplete && episode.reelInFeed) return 'EDITING';
    if (episode.reelInFeed) return 'PRODUCTION';
    if (episode.status === 'Draft') return 'SCRIPT';
    return 'IDEA';
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export async function buildPipelineBoard(seriesId, feedReels = []) {
    const episodes = buildEpisodeOperationRows(feedReels, seriesId);
    const team = await ensureTeamForSeries(seriesId);
    const userNames = Object.fromEntries(
        (team?.members || []).map((member) => [member.userId, member.displayName])
    );
    for (const user of team?.users || []) {
        userNames[String(user.id)] = String(user.displayName || user.display_name || user.id);
    }

    const store = loadPipelineStore();
    const byEpisode = new Map(
        store.rows.map((row) => [String(row.episodeId || row.episode_id), enrichPipelineRow(row, userNames)])
    );

    /** @type {Record<PipelineStage, PipelineCard[]>} */
    const columns = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, []]));

    for (const episode of episodes) {
        const row = byEpisode.get(episode.episodeId) || {
            id: `pip-local-${episode.episodeId}`,
            episodeId: episode.episodeId,
            stage: inferInitialStage(episode),
            assignedUserId: null,
            approvedBy: null,
            updatedAt: Date.now()
        };
        const stage = /** @type {PipelineStage} */ (row.stage || 'IDEA');
        const card = {
            id: row.id,
            episodeId: episode.episodeId,
            title: episode.episodeTitle || episode.episodeId,
            stage,
            assignedUserId: row.assignedUserId || null,
            assignedUserName: row.assignedUserName || null,
            approvedBy: row.approvedBy || null,
            approvedByName: row.approvedByName || null,
            updatedAt: row.updatedAt || Date.now(),
            hasAsset: episode.status !== 'Missing Asset',
            reviewStatus: resolveReviewStatus(row),
            publishingBlocked: stage !== 'READY' || !row.approvedBy
        };
        if (!columns[stage]) columns[stage] = [];
        columns[stage].push(card);
    }

    for (const stage of PIPELINE_STAGES) {
        columns[stage].sort((a, b) => a.title.localeCompare(b.title));
    }

    return { seriesId, columns, stages: PIPELINE_STAGES };
}

/**
 * @param {string} episodeId
 * @param {PipelineStage} stage
 * @param {string} [seriesId]
 * @param {Record<string, unknown>[]} [feedReels]
 */
export async function movePipelineStage(episodeId, stage, seriesId, feedReels = []) {
    const store = loadPipelineStore();
    const existing = store.rows.find((row) => String(row.episodeId || row.episode_id) === episodeId);
    const fromStage = existing?.stage || 'IDEA';

    if (stage === 'PUBLISHED') {
        throw new Error('Use publishPipelineEpisode for PUBLISHED stage');
    }

    if (stage === 'READY' && fromStage === 'REVIEW' && !existing?.approvedBy) {
        logPipelineDiag('PIPELINE_REVIEW', {
            episodeId,
            status: 'blocked',
            reason: 'approval_required',
            seriesId: seriesId || null
        });
        throw new Error('Review approval required before READY');
    }

    const updated = await persistPipelineMutation(episodeId, { stage });
    logPipelineDiag('PIPELINE_MOVE', { episodeId, fromStage, toStage: stage, seriesId: seriesId || null });

    if (stage === 'REVIEW') {
        logPipelineDiag('PIPELINE_REVIEW', {
            episodeId,
            status: 'submitted',
            fromStage,
            seriesId: seriesId || null
        });
        dispatchPipelineSideEffects('review', { episodeId, seriesId, fromStage });
    }

    if (seriesId) {
        void syncWorkflowTasks(seriesId, feedReels);
    }
    dispatchPipelineSideEffects('move', { episodeId, stage, seriesId });
    return updated;
}

/**
 * @param {string} episodeId
 * @param {string} userId
 * @param {string} [seriesId]
 */
export async function assignPipelineEpisode(episodeId, userId, seriesId) {
    const updated = await persistPipelineMutation(episodeId, { assignedUserId: userId });
    logPipelineDiag('PIPELINE_ASSIGN', { episodeId, userId, seriesId: seriesId || null });

    if (seriesId) {
        const team = await ensureTeamForSeries(seriesId);
        if (team?.id) {
            await assignTaskToMember(team.id, `pipeline-${episodeId}`, userId, seriesId);
        } else {
            dispatchPipelineSideEffects('assign', { episodeId, userId, seriesId });
        }
    } else {
        dispatchPipelineSideEffects('assign', { episodeId, userId, seriesId });
    }

    return updated;
}

/**
 * @param {string} episodeId
 * @param {string} [seriesId]
 * @param {Record<string, unknown>[]} [feedReels]
 */
export async function submitPipelineReview(episodeId, seriesId, feedReels = []) {
    return movePipelineStage(
        episodeId,
        'REVIEW',
        seriesId,
        feedReels
    );
}

/**
 * @param {string} episodeId
 * @param {string} [approverUserId]
 * @param {string} [seriesId]
 */
export async function approvePipelineEpisode(episodeId, approverUserId = getCurrentTeamUserId(), seriesId) {
    const team = seriesId ? await ensureTeamForSeries(seriesId) : null;
    const member = team?.members?.find((item) => item.userId === approverUserId);
    const role = member?.role || 'REVIEWER';
    if (!['OWNER', 'PRODUCER', 'REVIEWER'].includes(role)) {
        throw new Error('Only reviewers, producers, or owners can approve pipeline stages');
    }

    const updated = await persistPipelineMutation(episodeId, {
        approvedBy: approverUserId,
        stage: 'READY'
    });
    logPipelineDiag('PIPELINE_APPROVAL', {
        episodeId,
        approverUserId,
        role,
        seriesId: seriesId || null
    });
    dispatchPipelineSideEffects('approval', { episodeId, approverUserId, seriesId });
    return updated;
}

/**
 * @param {string} episodeId
 * @param {string} [seriesId]
 * @param {Record<string, unknown>[]} [feedReels]
 */
export async function publishPipelineEpisode(episodeId, seriesId, feedReels = []) {
    const store = loadPipelineStore();
    const existing = store.rows.find((row) => String(row.episodeId || row.episode_id) === episodeId);
    if (existing?.stage !== 'READY') {
        logPipelineDiag('PIPELINE_REVIEW', {
            episodeId,
            status: 'blocked',
            reason: 'not_ready',
            seriesId: seriesId || null
        });
        throw new Error('Publishing gate: episode must be READY before publish');
    }
    if (!existing?.approvedBy) {
        logPipelineDiag('PIPELINE_REVIEW', {
            episodeId,
            status: 'blocked',
            reason: 'approval_required',
            seriesId: seriesId || null
        });
        throw new Error('Publishing gate: review approval required');
    }

    const updated = await persistPipelineMutation(episodeId, { stage: 'PUBLISHED' });
    logPipelineDiag('PIPELINE_MOVE', {
        episodeId,
        fromStage: existing.stage,
        toStage: 'PUBLISHED',
        seriesId: seriesId || null,
        action: 'publish'
    });
    logPipelineDiag('PIPELINE_PUBLISH', {
        episodeId,
        seriesId: seriesId || null
    });

    if (seriesId) {
        const today = new Date().toISOString().slice(0, 10);
        scheduleEpisodeRelease(seriesId, episodeId, today, '12:00');
        void syncWorkflowTasks(seriesId, feedReels);
    }

    dispatchPipelineSideEffects('publish', { episodeId, seriesId });
    return updated;
}

/**
 * @param {string} episodeId
 * @param {{ stage?: string; assignedUserId?: string; approvedBy?: string }} patch
 */
async function persistPipelineMutation(episodeId, patch) {
    const store = loadPipelineStore();
    let row = store.rows.find((item) => String(item.episodeId || item.episode_id) === episodeId);

    if (!row) {
        row = {
            id: `pip-local-${episodeId}`,
            episodeId,
            stage: 'IDEA',
            assignedUserId: null,
            approvedBy: null,
            updatedAt: Date.now()
        };
        store.rows.push(row);
    }

    if (patch.stage) row.stage = patch.stage;
    if (patch.assignedUserId !== undefined) row.assignedUserId = patch.assignedUserId;
    if (patch.approvedBy !== undefined) row.approvedBy = patch.approvedBy;
    row.updatedAt = Date.now();
    persistPipelineStore(store);

    if (await isPipelineApiAvailable()) {
        const remote = await updatePipelineEpisode(episodeId, patch);
        if (!remote?.disabled && remote?.episodeId) {
            const normalized = normalizePipelineRow(remote);
            const index = store.rows.findIndex(
                (item) => String(item.episodeId || item.episode_id) === episodeId
            );
            if (index >= 0) store.rows[index] = normalized;
            else store.rows.push(normalized);
            persistPipelineStore(store);
            return normalized;
        }
    }

    return normalizePipelineRow(row);
}

/** @param {'move' | 'assign' | 'review' | 'approval' | 'publish'} action @param {Record<string, unknown>} detail */
function dispatchPipelineSideEffects(action, detail) {
    if (typeof window === 'undefined') return;

    if (action === 'assign') {
        window.dispatchEvent(
            new CustomEvent('reelforge:task-assigned', {
                detail: {
                    taskId: `pipeline-${detail.episodeId}`,
                    userId: detail.userId,
                    seriesId: detail.seriesId,
                    assigneeName: detail.userId,
                    taskTitle: `Pipeline ${detail.episodeId}`
                }
            })
        );
    }

    if (action === 'review') {
        window.dispatchEvent(
            new CustomEvent('reelforge:pipeline-review', {
                detail: {
                    episodeId: detail.episodeId,
                    seriesId: detail.seriesId,
                    fromStage: detail.fromStage
                }
            })
        );
    }

    if (action === 'approval') {
        window.dispatchEvent(
            new CustomEvent('reelforge:pipeline-approval', {
                detail: {
                    episodeId: detail.episodeId,
                    approverUserId: detail.approverUserId,
                    seriesId: detail.seriesId
                }
            })
        );
    }

    if (action === 'publish') {
        window.dispatchEvent(
            new CustomEvent('reelforge:episode-published', {
                detail: {
                    episodeId: detail.episodeId,
                    seriesId: detail.seriesId
                }
            })
        );
    }

    window.dispatchEvent(new CustomEvent('reelforge:pipeline-updated', { detail }));
}

export function resetEpisodePipeline() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(PIPELINE_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('reelforge:pipeline-updated'));
}

let pipelineInitialized = false;

export function initEpisodePipeline() {
    if (typeof window === 'undefined' || pipelineInitialized) return;
    pipelineInitialized = true;

    window.__reelforgePipeline = {
        PIPELINE_STAGES,
        hydratePipeline,
        buildPipelineBoard,
        movePipelineStage,
        assignPipelineEpisode,
        submitPipelineReview,
        approvePipelineEpisode,
        publishPipelineEpisode,
        getPipelineReviewStatus,
        isPublishingBlocked,
        resetEpisodePipeline
    };
}
