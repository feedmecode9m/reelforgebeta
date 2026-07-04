/**
 * Studio workflow engine — converts production diagnostics into executable tasks.
 * Uses productionHealth outputs only; does not alter readiness calculations.
 */

import {
    computeProductionReadiness,
    buildEpisodeOperationRows
} from './productionHealth.js';
import { getEpisodeById, getReelSeriesMetadata } from './seriesStore.js';

/** Mirrors productionHealth.js READINESS_WEIGHTS — do not change independently. */
const WORKFLOW_WEIGHTS = {
    metadata: 25,
    assets: 35,
    publishing: 25,
    releaseSchedule: 15
};

/** Estimated minutes per workflow action type. */
const TASK_ESTIMATES = {
    'missing-asset': 3,
    'missing-description': 2,
    'missing-runtime': 1,
    'missing-thumbnail': 2,
    'unpublished-episode': 2,
    'unscheduled-episode': 3
};

/** @typedef {'missing-asset' | 'missing-description' | 'missing-runtime' | 'missing-thumbnail' | 'unpublished-episode' | 'unscheduled-episode'} WorkflowActionType */

/** @typedef {'episode-editor' | 'reel-attach' | 'metadata-editor' | 'release-scheduler'} WorkflowNavTarget */

/**
 * @typedef {Object} WorkflowNavigation
 * @property {WorkflowNavTarget} target
 * @property {string | null} episodeId
 * @property {string | null} reelId
 * @property {string | null} [focusField]
 * @property {string} selector
 */

/**
 * @typedef {Object} WorkflowTask
 * @property {string} id
 * @property {string} title
 * @property {number} impact
 * @property {number} estimatedMinutes
 * @property {WorkflowActionType} actionType
 * @property {string | null} episodeId
 * @property {WorkflowNavigation} navigation
 */

/**
 * @typedef {Object} WorkflowPlan
 * @property {WorkflowTask[]} blockers
 * @property {WorkflowTask[]} tasks
 * @property {string[]} completionPath
 * @property {number} estimatedMinutes
 * @property {number} readinessScore
 * @property {number} projectedReadiness
 */

/** @type {Record<WorkflowNavTarget, string>} */
export const WORKFLOW_NAV_TARGETS = {
    'episode-editor': '[data-episode-operations-table]',
    'reel-attach': '[data-missing-asset-queue]',
    'metadata-editor': '[data-series-metadata-editor]',
    'release-scheduler': '[data-series-metadata-editor]'
};

/** @type {Record<WorkflowActionType, WorkflowNavTarget>} */
const ACTION_NAV_MAP = {
    'missing-asset': 'reel-attach',
    'missing-description': 'metadata-editor',
    'missing-runtime': 'metadata-editor',
    'missing-thumbnail': 'episode-editor',
    'unpublished-episode': 'release-scheduler',
    'unscheduled-episode': 'release-scheduler'
};

/** @type {Record<WorkflowActionType, string | null>} */
const ACTION_FOCUS_MAP = {
    'missing-asset': null,
    'missing-description': 'description',
    'missing-runtime': 'runtime',
    'missing-thumbnail': null,
    'unpublished-episode': 'episodeStatus',
    'unscheduled-episode': 'episodeStatus'
};

/**
 * @param {number} currentPct
 * @param {number} newPct
 * @param {number} weight
 */
function pillarGain(currentPct, newPct, weight) {
    return Math.round(((newPct - currentPct) * weight) / 100);
}

/**
 * @param {import('./productionHealth.js').EpisodeOperationRow} row
 */
function episodeLabel(row) {
    return `E${String(row.episodeNumber).padStart(2, '0')}`;
}

/**
 * @param {import('./productionHealth.js').EpisodeOperationRow} row
 */
function metadataGaps(row) {
    const ctx = getEpisodeById(row.episodeId);
    const studio = row.reelId ? getReelSeriesMetadata(row.reelId) : null;
    const episode = ctx?.episode;
    const series = ctx?.series;

    return {
        missingRuntime: !(row.runtime != null && row.runtime > 0),
        missingDescription: !Boolean(
            studio?.description?.trim() || episode?.description?.trim() || series?.description?.trim()
        ),
        missingTitle: !Boolean(row.episodeTitle?.trim()),
        missingGenre: !Boolean(studio?.genre?.trim() || episode?.genre?.trim() || series?.genre?.trim())
    };
}

/**
 * @param {string | null | undefined} episodeId
 * @param {string | null | undefined} reelId
 */
function resolveReelForTask(episodeId, reelId) {
    if (reelId) return reelId;
    const ctx = episodeId ? getEpisodeById(episodeId) : null;
    return ctx?.episode?.reelId || null;
}

/**
 * @param {WorkflowActionType} actionType
 * @param {string | null} episodeId
 * @param {string | null | undefined} reelId
 * @returns {WorkflowNavigation}
 */
export function buildTaskNavigation(actionType, episodeId, reelId) {
    const target = ACTION_NAV_MAP[actionType];
    const resolvedReelId = resolveReelForTask(episodeId, reelId || null);
    const focusField = ACTION_FOCUS_MAP[actionType];
    let selector = WORKFLOW_NAV_TARGETS[target];

    if (episodeId) {
        if (target === 'reel-attach') {
            selector = `[data-queue-item][data-episode-id="${episodeId}"]`;
        } else if (target === 'episode-editor') {
            selector = `[data-episode-op-row][data-episode-id="${episodeId}"]`;
        }
    }

    return {
        target,
        episodeId,
        reelId: resolvedReelId,
        focusField,
        selector
    };
}

/**
 * @param {Record<string, unknown>[]} feedReels
 * @param {string} seriesId
 * @param {import('./productionHealth.js').ProductionReadinessSnapshot} readiness
 * @param {import('./productionHealth.js').EpisodeOperationRow[]} rows
 * @returns {Omit<WorkflowTask, 'estimatedMinutes'>[]}
 */
function buildWorkflowCandidates(feedReels, seriesId, readiness, rows) {
    const total = rows.length || 1;
    const withAssets = rows.filter((r) => r.status !== 'Missing Asset' && r.reelInFeed).length;
    const metadataComplete = rows.filter((r) => r.metadataComplete).length;
    const published = rows.filter((r) => r.status === 'Published').length;
    const scheduledRecords = rows.filter(
        (r) => r.status === 'Scheduled' || r.publishingStatus === 'Draft'
    );
    const scheduledWithAssets = scheduledRecords.filter((r) => r.reelInFeed && r.reelId).length;

    /** @type {Omit<WorkflowTask, 'estimatedMinutes'>[]} */
    const candidates = [];
    const seenEpisodes = new Set();

    for (const row of rows) {
        if (row.status === 'Missing Asset') {
            const newAssetsPct = Math.round(((withAssets + 1) / total) * 100);
            const impact = Math.max(pillarGain(readiness.assets, newAssetsPct, WORKFLOW_WEIGHTS.assets), 1);
            candidates.push({
                id: `missing-asset-${row.episodeId}`,
                title: `Attach Reel to ${episodeLabel(row)}`,
                impact,
                actionType: 'missing-asset',
                episodeId: row.episodeId,
                navigation: buildTaskNavigation('missing-asset', row.episodeId, row.reelId)
            });
            seenEpisodes.add(row.episodeId);
        }
    }

    for (const row of rows) {
        if (seenEpisodes.has(row.episodeId)) continue;

        if (row.status === 'Ready' || row.publishingStatus === 'Ready') {
            const newPublishingPct = Math.round(((published + 1) / total) * 100);
            const impact = Math.max(
                pillarGain(readiness.publishing, newPublishingPct, WORKFLOW_WEIGHTS.publishing),
                1
            );
            candidates.push({
                id: `unpublished-${row.episodeId}`,
                title: `Publish ${episodeLabel(row)}`,
                impact,
                actionType: 'unpublished-episode',
                episodeId: row.episodeId,
                navigation: buildTaskNavigation('unpublished-episode', row.episodeId, row.reelId)
            });
            seenEpisodes.add(row.episodeId);
            continue;
        }

        if (row.publishingStatus === 'Draft' && row.reelInFeed && scheduledRecords.length > 0) {
            const newSchedulePct = Math.round(((scheduledWithAssets + 1) / scheduledRecords.length) * 100);
            const impact = Math.max(
                pillarGain(readiness.releaseSchedule, newSchedulePct, WORKFLOW_WEIGHTS.releaseSchedule),
                1
            );
            candidates.push({
                id: `unscheduled-${row.episodeId}`,
                title: `Schedule ${episodeLabel(row)}`,
                impact,
                actionType: 'unscheduled-episode',
                episodeId: row.episodeId,
                navigation: buildTaskNavigation('unscheduled-episode', row.episodeId, row.reelId)
            });
            seenEpisodes.add(row.episodeId);
            continue;
        }

        if (!row.reelInFeed || !row.reelId) continue;

        const gaps = metadataGaps(row);

        if (gaps.missingRuntime) {
            const newMetaPct = Math.round(((metadataComplete + 1) / total) * 100);
            const impact = Math.max(
                pillarGain(readiness.metadata, newMetaPct, WORKFLOW_WEIGHTS.metadata),
                1
            );
            candidates.push({
                id: `missing-runtime-${row.episodeId}`,
                title: `Add runtime to ${episodeLabel(row)}`,
                impact,
                actionType: 'missing-runtime',
                episodeId: row.episodeId,
                navigation: buildTaskNavigation('missing-runtime', row.episodeId, row.reelId)
            });
            seenEpisodes.add(row.episodeId);
            continue;
        }

        if (gaps.missingDescription) {
            const newMetaPct = Math.round(((metadataComplete + 1) / total) * 100);
            const impact = Math.max(
                pillarGain(readiness.metadata, newMetaPct, WORKFLOW_WEIGHTS.metadata),
                1
            );
            candidates.push({
                id: `missing-description-${row.episodeId}`,
                title: `Add description to ${episodeLabel(row)}`,
                impact,
                actionType: 'missing-description',
                episodeId: row.episodeId,
                navigation: buildTaskNavigation('missing-description', row.episodeId, row.reelId)
            });
            seenEpisodes.add(row.episodeId);
            continue;
        }

        if (!row.thumbnailUrl && row.reelInFeed) {
            candidates.push({
                id: `missing-thumbnail-${row.episodeId}`,
                title: `Add thumbnail to ${episodeLabel(row)}`,
                impact: 1,
                actionType: 'missing-thumbnail',
                episodeId: row.episodeId,
                navigation: buildTaskNavigation('missing-thumbnail', row.episodeId, row.reelId)
            });
            seenEpisodes.add(row.episodeId);
        }
    }

    return candidates.sort((a, b) => b.impact - a.impact);
}

/**
 * @param {Omit<WorkflowTask, 'estimatedMinutes'>[]} candidates
 * @returns {WorkflowTask[]}
 */
function withEstimates(candidates) {
    return candidates.map((task) => ({
        ...task,
        estimatedMinutes: TASK_ESTIMATES[task.actionType] || 2
    }));
}

/**
 * @param {WorkflowTask[]} tasks
 * @returns {string[]}
 */
function buildCompletionPath(tasks) {
    return [...tasks]
        .sort((a, b) => b.impact / b.estimatedMinutes - a.impact / a.estimatedMinutes)
        .map((task) => task.id);
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>} [feedReels]
 * @returns {WorkflowPlan}
 */
export function buildWorkflowTasks(seriesId, feedReels = []) {
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const rows = buildEpisodeOperationRows(feedReels, seriesId);
    const candidates = withEstimates(buildWorkflowCandidates(feedReels, seriesId, readiness, rows));

    const blockerTypes = new Set(['missing-asset']);
    const blockers = candidates.filter((task) => blockerTypes.has(task.actionType));
    const completionPath = buildCompletionPath(candidates);
    const pathTasks = completionPath
        .map((id) => candidates.find((task) => task.id === id))
        .filter(Boolean);
    const estimatedMinutes = pathTasks.reduce((sum, task) => sum + task.estimatedMinutes, 0);
    const projectedReadiness = Math.min(
        100,
        readiness.weightedPercent + pathTasks.reduce((sum, task) => sum + task.impact, 0)
    );

    return {
        blockers,
        tasks: candidates,
        completionPath,
        estimatedMinutes,
        readinessScore: readiness.weightedPercent,
        projectedReadiness
    };
}

/**
 * @param {WorkflowPlan} plan
 * @returns {{ readinessBefore: number, readinessAfter: number, totalImpact: number }}
 */
export function projectReadinessFromWorkflow(plan) {
    const pathTasks = plan.completionPath
        .map((id) => plan.tasks.find((task) => task.id === id))
        .filter(Boolean);
    const totalImpact = pathTasks.reduce((sum, task) => sum + task.impact, 0);

    return {
        readinessBefore: plan.readinessScore,
        readinessAfter: Math.min(100, plan.readinessScore + totalImpact),
        totalImpact
    };
}
