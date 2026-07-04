/**
 * Phase 22 — predictive studio repair engine v2.
 * Detects production problems before release by composing existing repair, workflow,
 * release, and team systems.
 */

import { buildRepairPlan } from '../series/studioRepairEngine.js';
import {
    buildEpisodeOperationRows,
    getMissingAssetQueue
} from '../series/productionHealth.js';
import { syncWorkflowTasks } from '../workflow/workflowEngine.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';
import { getOpenTasksForAssignment } from '../teams/creatorTeams.js';

export const PREDICTION_CATEGORIES = /** @type {const} */ ([
    'missing_assets',
    'missing_thumbnails',
    'incomplete_metadata',
    'workflow_bottlenecks',
    'release_blockers',
    'team_assignment_gaps'
]);

/** @typedef {'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'} PredictionSeverity */

/**
 * @typedef {Object} RepairPrediction
 * @property {string} id
 * @property {typeof PREDICTION_CATEGORIES[number]} category
 * @property {PredictionSeverity} severity
 * @property {string} title
 * @property {string} detail
 * @property {string} [episodeId]
 * @property {string | null} [reelId]
 * @property {number} riskScore
 * @property {Record<string, unknown>} [meta]
 */

/**
 * @typedef {Object} RepairRecommendation
 * @property {string} id
 * @property {string} predictionId
 * @property {typeof PREDICTION_CATEGORIES[number]} category
 * @property {string} action
 * @property {string} label
 * @property {PredictionSeverity} priority
 * @property {boolean} autoRepairable
 * @property {string} [repairAction]
 */

/**
 * @typedef {Object} PredictiveRepairSnapshot
 * @property {string} seriesId
 * @property {RepairPrediction[]} predictions
 * @property {RepairRecommendation[]} recommendations
 * @property {Record<typeof PREDICTION_CATEGORIES[number], number>} categoryCounts
 * @property {number} preReleaseRiskScore
 * @property {number} blockerCount
 * @property {number} generatedAt
 */

const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * @param {'REPAIR_PREDICTION' | 'REPAIR_RECOMMENDATION'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logPredictiveRepairDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/**
 * @param {typeof PREDICTION_CATEGORIES[number]} category
 * @param {PredictionSeverity} severity
 * @param {string} title
 * @param {string} detail
 * @param {Record<string, unknown>} [extra]
 * @returns {RepairPrediction}
 */
function makePrediction(category, severity, title, detail, extra = {}) {
    const riskBase = { CRITICAL: 90, HIGH: 70, MEDIUM: 45, LOW: 20 };
    return {
        id: `prediction-${category}-${extra.episodeId || extra.reelId || extra.taskId || title}`.replace(
            /\s+/g,
            '-'
        ),
        category,
        severity,
        title,
        detail,
        episodeId: extra.episodeId ? String(extra.episodeId) : undefined,
        reelId: extra.reelId ? String(extra.reelId) : null,
        riskScore: riskBase[severity] + (extra.riskBoost ? Number(extra.riskBoost) : 0),
        meta: extra.meta || undefined
    };
}

/**
 * @param {RepairPrediction} prediction
 * @param {string} action
 * @param {string} label
 * @param {boolean} autoRepairable
 * @param {string} [repairAction]
 * @returns {RepairRecommendation}
 */
function makeRecommendation(prediction, action, label, autoRepairable, repairAction) {
    return {
        id: `recommendation-${prediction.id}`,
        predictionId: prediction.id,
        category: prediction.category,
        action,
        label,
        priority: prediction.severity,
        autoRepairable,
        repairAction
    };
}

/** @param {RepairPrediction[]} predictions */
function buildRecommendations(predictions) {
    /** @type {RepairRecommendation[]} */
    const recommendations = [];

    for (const prediction of predictions) {
        switch (prediction.category) {
            case 'missing_assets':
                recommendations.push(
                    makeRecommendation(
                        prediction,
                        'attach-missing-asset',
                        'Attach reel asset before release window',
                        false
                    )
                );
                break;
            case 'missing_thumbnails':
                recommendations.push(
                    makeRecommendation(
                        prediction,
                        'assign-thumbnail',
                        'Assign series poster or generated thumbnail',
                        true,
                        'assign-series-poster-thumbnail'
                    )
                );
                break;
            case 'incomplete_metadata':
                recommendations.push(
                    makeRecommendation(
                        prediction,
                        'complete-metadata',
                        'Fill synopsis and runtime metadata',
                        true,
                        prediction.meta?.issue === 'missing-runtime'
                            ? 'infer-runtime-from-catalog'
                            : 'generate-default-description'
                    )
                );
                break;
            case 'workflow_bottlenecks':
                recommendations.push(
                    makeRecommendation(
                        prediction,
                        'resolve-workflow-task',
                        'Clear workflow bottleneck before premiere',
                        false
                    )
                );
                break;
            case 'release_blockers':
                recommendations.push(
                    makeRecommendation(
                        prediction,
                        'unblock-release',
                        prediction.meta?.repairAction === 'schedule-default-release-date'
                            ? 'Schedule default release date'
                            : 'Resolve release blocker before launch',
                        Boolean(prediction.meta?.repairAction),
                        prediction.meta?.repairAction
                            ? String(prediction.meta.repairAction)
                            : undefined
                    )
                );
                break;
            case 'team_assignment_gaps':
                recommendations.push(
                    makeRecommendation(
                        prediction,
                        'assign-team-member',
                        'Assign owner to open production task',
                        false
                    )
                );
                break;
            default:
                break;
        }
    }

    return recommendations.sort(
        (a, b) => SEVERITY_RANK[a.priority] - SEVERITY_RANK[b.priority]
    );
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown> | Record<string, unknown>[]} feed
 * @returns {PredictiveRepairSnapshot}
 */
export function buildPredictiveRepairSnapshot(seriesId, feed = []) {
    const feedReels = Array.isArray(feed) ? feed : Object.values(feed || {}).flat();
    const repairPlan = buildRepairPlan(seriesId, feedReels);
    const missingAssets = getMissingAssetQueue(feedReels, seriesId);
    const operationRows = buildEpisodeOperationRows(feedReels, seriesId);
    const workflow = syncWorkflowTasks(seriesId, feedReels);
    const release = buildReleaseCenterSnapshot(seriesId, feedReels);
    const openTasks = getOpenTasksForAssignment(seriesId);

    /** @type {RepairPrediction[]} */
    const predictions = [];
    const seen = new Set();

    /** @param {RepairPrediction} item */
    function pushPrediction(item) {
        if (seen.has(item.id)) return;
        seen.add(item.id);
        predictions.push(item);
    }

    for (const row of missingAssets) {
        pushPrediction(
            makePrediction(
                'missing_assets',
                'CRITICAL',
                `Missing asset · ${row.episodeTitle || row.episodeId}`,
                `${row.episodeLabel || row.episodeId} has no attached reel in feed`,
                { episodeId: row.episodeId, reelId: row.reelId, riskBoost: 5 }
            )
        );
    }

    for (const row of operationRows) {
        if (row.reelId && !row.reelInFeed) {
            pushPrediction(
                makePrediction(
                    'missing_assets',
                    'HIGH',
                    `Asset not in feed · ${row.episodeTitle || row.episodeId}`,
                    `${row.episodeLabel || row.episodeId} reel is not visible in production feed`,
                    { episodeId: row.episodeId, reelId: row.reelId }
                )
            );
        }
    }

    for (const issue of repairPlan.issues.filter((item) => item.issue === 'missing-thumbnail')) {
        pushPrediction(
            makePrediction(
                'missing_thumbnails',
                issue.severity,
                `Missing thumbnail · ${issue.label}`,
                issue.detail,
                { episodeId: issue.episodeId, reelId: issue.reelId }
            )
        );
    }

    for (const issue of repairPlan.issues.filter((item) =>
        ['missing-description', 'missing-runtime', 'orphaned-episode', 'unlinked-reel'].includes(
            item.issue
        )
    )) {
        pushPrediction(
            makePrediction(
                'incomplete_metadata',
                issue.severity,
                `Incomplete metadata · ${issue.label}`,
                issue.detail,
                {
                    episodeId: issue.episodeId,
                    reelId: issue.reelId,
                    meta: { issue: issue.issue, repairAction: issue.action }
                }
            )
        );
    }

    const bottlenecks = workflow.tasks.filter(
        (task) =>
            task.status !== 'COMPLETE' &&
            (task.taskType === 'MISSING_ASSET' || task.priority <= 2 || task.estimatedImpact >= 15)
    );

    for (const task of bottlenecks.slice(0, 8)) {
        pushPrediction(
            makePrediction(
                'workflow_bottlenecks',
                task.taskType === 'MISSING_ASSET' ? 'CRITICAL' : 'HIGH',
                `Workflow bottleneck · ${task.title || task.taskType}`,
                `Open ${task.taskType} task blocking production readiness`,
                {
                    episodeId: task.episodeId,
                    reelId: task.reelId,
                    taskId: task.id,
                    meta: { taskType: task.taskType, priority: task.priority }
                }
            )
        );
    }

    const scheduledWithoutAssets = (release.calendar || []).filter(
        (entry) =>
            (entry.status === 'scheduled' || entry.status === 'ready') && !entry.hasAsset
    );
    for (const entry of scheduledWithoutAssets) {
        pushPrediction(
            makePrediction(
                'release_blockers',
                'CRITICAL',
                `Release blocker · ${entry.episodeTitle || entry.episodeId}`,
                `${entry.episodeLabel} is scheduled but missing production asset`,
                { episodeId: entry.episodeId, riskBoost: 8 }
            )
        );
    }

    if (
        release.launchReadiness?.launchReadinessScore != null &&
        release.launchReadiness.launchReadinessScore < 70 &&
        release.releaseHealth?.daysUntilLaunch != null &&
        release.releaseHealth.daysUntilLaunch <= 14
    ) {
        pushPrediction(
            makePrediction(
                'release_blockers',
                'HIGH',
                'Launch readiness below threshold',
                `Launch readiness ${release.launchReadiness.launchReadinessScore}% with premiere in ${release.releaseHealth.daysUntilLaunch}d`,
                { riskBoost: 6, meta: { launchReadinessScore: release.launchReadiness.launchReadinessScore } }
            )
        );
    }

    for (const issue of repairPlan.issues.filter((item) => item.issue === 'missing-release-date')) {
        pushPrediction(
            makePrediction(
                'release_blockers',
                issue.severity,
                `Release date missing · ${issue.label}`,
                issue.detail,
                {
                    episodeId: issue.episodeId,
                    reelId: issue.reelId,
                    meta: { repairAction: issue.action }
                }
            )
        );
    }

    const unassigned = openTasks.filter((task) => !task.assignedTo);
    for (const task of unassigned.slice(0, 8)) {
        pushPrediction(
            makePrediction(
                'team_assignment_gaps',
                task.priority <= 2 ? 'HIGH' : 'MEDIUM',
                `Unassigned task · ${task.title || task.taskType}`,
                `No team member assigned to ${task.taskType} workflow task`,
                {
                    episodeId: task.episodeId,
                    reelId: task.reelId,
                    taskId: task.id,
                    meta: { taskType: task.taskType }
                }
            )
        );
    }

    const sortedPredictions = predictions.sort(
        (a, b) =>
            SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            b.riskScore - a.riskScore
    );

    /** @type {Record<typeof PREDICTION_CATEGORIES[number], number>} */
    const categoryCounts = {
        missing_assets: 0,
        missing_thumbnails: 0,
        incomplete_metadata: 0,
        workflow_bottlenecks: 0,
        release_blockers: 0,
        team_assignment_gaps: 0
    };

    for (const prediction of sortedPredictions) {
        categoryCounts[prediction.category] += 1;
    }

    const recommendations = buildRecommendations(sortedPredictions);
    const blockerCount =
        categoryCounts.release_blockers +
        categoryCounts.missing_assets +
        categoryCounts.workflow_bottlenecks;
    const preReleaseRiskScore = Math.min(
        100,
        Math.round(
            sortedPredictions.reduce((sum, item) => sum + item.riskScore, 0) /
                Math.max(sortedPredictions.length, 1)
        )
    );

    logPredictiveRepairDiag('REPAIR_PREDICTION', {
        seriesId,
        predictionCount: sortedPredictions.length,
        categoryCounts,
        preReleaseRiskScore,
        blockerCount
    });

    for (const recommendation of recommendations.slice(0, 5)) {
        logPredictiveRepairDiag('REPAIR_RECOMMENDATION', {
            seriesId,
            recommendationId: recommendation.id,
            category: recommendation.category,
            action: recommendation.action,
            priority: recommendation.priority,
            autoRepairable: recommendation.autoRepairable
        });
    }

    return {
        seriesId,
        predictions: sortedPredictions,
        recommendations,
        categoryCounts,
        preReleaseRiskScore,
        blockerCount,
        generatedAt: Date.now()
    };
}

let predictiveRepairInitialized = false;

export function initPredictiveRepairEngine() {
    if (typeof window === 'undefined' || predictiveRepairInitialized) return;
    predictiveRepairInitialized = true;

    window.__reelforgePredictiveRepair = {
        PREDICTION_CATEGORIES,
        buildPredictiveRepairSnapshot,
        logPredictiveRepairDiag
    };
}
