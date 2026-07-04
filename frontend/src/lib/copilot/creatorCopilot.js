/**
 * Phase 12 — Creator Copilot: rule-based production advisor.
 * Analyzes readiness, workflow tasks, release schedule, and asset coverage.
 * No LLM integration; deterministic local reasoning only.
 */

import {
    computeProductionReadiness,
    computeSeriesHealth,
    buildEpisodeOperationRows
} from '../series/productionHealth.js';
import { computeEpisodeAssetCoverage } from '../series/episodeAssetStatus.js';
import { getSeriesEpisodeCounts } from '../series/seriesIntelligence.js';
import { buildStudioActionPlan } from '../series/actionEngine.js';
import { buildWorkflowTasks } from '../series/workflowEngine.js';
import { getEpisodeById } from '../series/seriesStore.js';
import { getWorkflowTasksForSeries } from '../workflow/workflowEngine.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';

/** @typedef {'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'} CopilotPriority */

/**
 * @typedef {Object} CopilotRecommendation
 * @property {string} id
 * @property {CopilotPriority} priority
 * @property {string} title
 * @property {string} description
 * @property {number} impact
 * @property {number} estimatedMinutes
 * @property {number} order
 * @property {string} [category]
 */

/**
 * @typedef {Object} CopilotFastestPathStep
 * @property {number} step
 * @property {string} label
 * @property {number} impact
 * @property {number} estimatedMinutes
 * @property {CopilotPriority} priority
 */

/**
 * @typedef {Object} ReadinessAnalysis
 * @property {number} score
 * @property {number} metadata
 * @property {number} assets
 * @property {number} publishing
 * @property {number} releaseSchedule
 */

/**
 * @typedef {Object} WorkflowAnalysis
 * @property {number} openTasks
 * @property {number} pendingTasks
 * @property {number} inProgressTasks
 * @property {number} criticalTasks
 * @property {number} estimatedMinutes
 */

/**
 * @typedef {Object} ReleaseAnalysis
 * @property {number} episodesScheduled
 * @property {number} episodesReady
 * @property {number} missingAssets
 * @property {number | null} daysUntilLaunch
 * @property {number} launchReadinessScore
 */

/**
 * @typedef {Object} AssetCoverageAnalysis
 * @property {number} totalEpisodes
 * @property {number} coveredEpisodes
 * @property {number} missingAssets
 * @property {number} coveragePercent
 */

/**
 * @typedef {Object} CopilotAnalysis
 * @property {ReadinessAnalysis} readiness
 * @property {WorkflowAnalysis} workflow
 * @property {ReleaseAnalysis} release
 * @property {AssetCoverageAnalysis} assets
 */

/**
 * @typedef {Object} CreatorCopilotBrief
 * @property {number} currentReadiness
 * @property {string} biggestBlocker
 * @property {string[]} fastestPath
 * @property {CopilotFastestPathStep[]} fastestPathDetail
 * @property {number} targetReadiness
 * @property {number} projectedReadiness
 * @property {number} estimatedTime
 * @property {CopilotRecommendation[]} recommendations
 * @property {CopilotRecommendation[]} topPriorities
 * @property {CopilotRecommendation[]} quickWins
 * @property {CopilotRecommendation[]} criticalRisks
 * @property {CopilotRecommendation[]} recommendedActions
 * @property {CopilotAnalysis} analysis
 * @property {number} totalEpisodes
 * @property {number} missingAssets
 */

const PRIORITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const TASK_MINUTES = {
    'missing-asset': 3,
    'missing-metadata': 2,
    'unpublished-episode': 2,
    'unscheduled-episode': 3,
    'missing-runtime': 1,
    'missing-description': 2,
    'missing-thumbnail': 2,
    'missing-season-structure': 5
};

const QUICK_WIN_MAX_MINUTES = 2;
const COPILOT_MEMO_TTL_MS = 2_000;
let lastCopilotMemo = /** @type {{ key: string; at: number; brief: CreatorCopilotBrief } | null} */ (null);

/**
 * @param {Record<string, unknown>[]} feedReels
 */
function buildCopilotFeedSignature(feedReels = []) {
    return (feedReels || [])
        .map((reel) =>
            [
                reel?.id || reel?.reelId || '',
                reel?.episodeId || reel?.episode_id || '',
                reel?.url || reel?.video_url || reel?.videoUrl || '',
                reel?.thumbnail || reel?.thumbnailUrl || reel?.thumbnail_url || '',
                reel?.updatedAt || reel?.createdAt || ''
            ].join('|')
        )
        .join('||');
}

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
export function logCopilotDiag(tag, detail) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/**
 * @param {string | null | undefined} episodeId
 */
function episodeNumberLabel(episodeId) {
    if (!episodeId) return '';
    const ctx = getEpisodeById(episodeId);
    if (!ctx?.episode) return '';
    const season = ctx.season?.seasonNumber ?? 1;
    return `S${season}:E${String(ctx.episode.episodeNumber).padStart(2, '0')}`;
}

/**
 * @param {string} actionType
 * @param {number} impact
 * @param {boolean} [isBlocker]
 */
export function resolveCopilotPriority(actionType, impact, isBlocker = false) {
    if (isBlocker || actionType === 'missing-asset' || actionType === 'missing-season-structure') {
        return 'CRITICAL';
    }
    if (actionType === 'unpublished-episode' || actionType === 'unscheduled-episode' || impact >= 5) {
        return 'HIGH';
    }
    if (
        actionType === 'missing-description' ||
        actionType === 'missing-runtime' ||
        actionType === 'missing-metadata' ||
        impact >= 2
    ) {
        return 'MEDIUM';
    }
    return 'LOW';
}

/**
 * @param {{ actionType?: string; episodeId?: string | null; title?: string; impact?: number }} item
 */
function humanizeAction(item) {
    const label = episodeNumberLabel(item.episodeId);
    const type = item.actionType || '';

    if (type === 'missing-asset') {
        return label ? `Upload ${label} reel` : 'Attach missing reel';
    }
    if (type === 'unpublished-episode') {
        return label ? `Publish ${label}` : 'Publish ready episode';
    }
    if (type === 'unscheduled-episode') {
        return label ? `Schedule ${label}` : 'Schedule release date';
    }
    if (type === 'missing-description') {
        return label ? `Add description to ${label}` : 'Add episode descriptions';
    }
    if (type === 'missing-runtime') {
        return label ? `Add runtime to ${label}` : 'Add episode runtime';
    }
    if (type === 'missing-thumbnail') {
        return label ? `Add thumbnail to ${label}` : 'Add thumbnails';
    }
    if (type === 'missing-metadata') {
        return label ? `Complete metadata for ${label}` : 'Complete metadata';
    }
    if (type === 'missing-season-structure') {
        return 'Fix season structure';
    }

    return item.title || 'Complete production task';
}

/**
 * @param {{ actionType?: string; episodeId?: string | null; title?: string; description?: string; impact?: number }} item
 */
export function formatBiggestBlocker(item) {
    if (!item) return 'No blockers detected — series is on track.';

    const label = episodeNumberLabel(item.episodeId);
    const type = item.actionType || '';

    if (type === 'missing-asset' && label) {
        return `${label} has no reel attached.`;
    }
    if (type === 'missing-season-structure') {
        return item.description || item.title || 'Season structure needs attention.';
    }
    if (type === 'unpublished-episode' && label) {
        return `${label} is ready but not published.`;
    }
    if (type === 'unscheduled-episode' && label) {
        return `${label} has no release schedule.`;
    }
    if (type === 'missing-description' && label) {
        return `${label} is missing a description.`;
    }

    return item.description || item.title || 'Production gap detected.';
}

/** @param {string} seriesId @param {Record<string, unknown>[]} [feedReels] */
export function analyzeReadiness(seriesId, feedReels = []) {
    const readiness = computeProductionReadiness(feedReels, seriesId);
    return {
        score: readiness.weightedPercent,
        metadata: readiness.metadata,
        assets: readiness.assets,
        publishing: readiness.publishing,
        releaseSchedule: readiness.releaseSchedule
    };
}

/** @param {string} seriesId */
export function analyzeWorkflowTasks(seriesId) {
    const tasks = getWorkflowTasksForSeries(seriesId).filter((task) => task.status !== 'COMPLETE');
    const pendingTasks = tasks.filter((task) => task.status === 'PENDING').length;
    const inProgressTasks = tasks.filter((task) => task.status === 'IN_PROGRESS').length;
    const criticalTasks = tasks.filter((task) => task.priority <= 1).length;
    const estimatedMinutes = tasks.reduce((sum, task) => sum + (task.estimatedMinutes || 2), 0);

    return {
        openTasks: tasks.length,
        pendingTasks,
        inProgressTasks,
        criticalTasks,
        estimatedMinutes
    };
}

/** @param {string} seriesId @param {Record<string, unknown>[]} [feedReels] */
export function analyzeReleaseSchedule(seriesId, feedReels = []) {
    const snapshot = buildReleaseCenterSnapshot(seriesId, feedReels);
    return {
        episodesScheduled: snapshot.releaseHealth.episodesScheduled,
        episodesReady: snapshot.releaseHealth.episodesReady,
        missingAssets: snapshot.releaseHealth.episodesMissingAssets,
        daysUntilLaunch: snapshot.releaseHealth.daysUntilLaunch,
        launchReadinessScore: snapshot.launchReadiness.launchReadinessScore
    };
}

/** @param {string} seriesId @param {Record<string, unknown>[]} [feedReels] */
export function analyzeAssetCoverage(seriesId, feedReels = []) {
    const rows = buildEpisodeOperationRows(feedReels, seriesId);
    const coverage = computeEpisodeAssetCoverage(feedReels, seriesId);
    const totalEpisodes = rows.length || 1;
    const coveredEpisodes = rows.filter((row) => Boolean(row.reelId)).length;

    return {
        totalEpisodes: rows.length,
        coveredEpisodes,
        missingAssets: coverage.episodesMissingAssets,
        coveragePercent: coverage.coveragePercent || Math.round((coveredEpisodes / totalEpisodes) * 100)
    };
}

/**
 * @param {import('../series/workflowEngine.js').WorkflowPlan} workflowPlan
 * @param {number} [targetReadiness]
 */
function buildFastestPath(workflowPlan, targetReadiness = 80) {
    const ordered = workflowPlan.completionPath
        .map((id) => workflowPlan.tasks.find((task) => task.id === id))
        .filter(Boolean);

    /** @type {CopilotFastestPathStep[]} */
    const steps = [];
    let projected = workflowPlan.readinessScore;

    for (const task of ordered) {
        if (projected >= targetReadiness) break;

        const priority = resolveCopilotPriority(
            task.actionType,
            task.impact,
            workflowPlan.blockers.some((b) => b.id === task.id)
        );
        steps.push({
            step: steps.length + 1,
            label: humanizeAction(task),
            impact: task.impact,
            estimatedMinutes: task.estimatedMinutes,
            priority
        });
        projected = Math.min(100, projected + task.impact);
    }

    return {
        steps,
        labels: steps.map((s) => s.label),
        projectedReadiness: projected,
        estimatedTime: steps.reduce((sum, s) => sum + s.estimatedMinutes, 0)
    };
}

/**
 * @param {import('../series/actionEngine.js').StudioActionPlan} actionPlan
 * @param {import('../series/workflowEngine.js').WorkflowPlan} workflowPlan
 */
function buildPrioritizedRecommendations(actionPlan, workflowPlan) {
    /** @type {Map<string, CopilotRecommendation>} */
    const seen = new Map();

    const blockerIds = new Set([
        ...actionPlan.blockers.map((b) => b.id),
        ...workflowPlan.blockers.map((b) => b.id)
    ]);

    for (const rec of actionPlan.recommendations) {
        const actionType = rec.actionType;
        const minutes = TASK_MINUTES[actionType] || 2;
        const isBlocker = blockerIds.has(rec.id);
        seen.set(rec.id, {
            id: rec.id,
            priority: resolveCopilotPriority(actionType, rec.impact, isBlocker),
            title: humanizeAction(rec),
            description: rec.description,
            impact: rec.impact,
            estimatedMinutes: minutes,
            order: rec.priority
        });
    }

    for (const task of workflowPlan.tasks) {
        if (seen.has(task.id)) continue;
        seen.set(task.id, {
            id: task.id,
            priority: resolveCopilotPriority(task.actionType, task.impact, blockerIds.has(task.id)),
            title: humanizeAction(task),
            description: task.title,
            impact: task.impact,
            estimatedMinutes: task.estimatedMinutes,
            order: task.impact * -1
        });
    }

    return [...seen.values()].sort((a, b) => {
        const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        if (b.impact !== a.impact) return b.impact - a.impact;
        return a.order - b.order;
    });
}

/**
 * @param {CopilotRecommendation[]} recommendations
 */
function categorizeRecommendations(recommendations) {
    const criticalRisks = recommendations
        .filter((rec) => rec.priority === 'CRITICAL')
        .slice(0, 5)
        .map((rec) => ({ ...rec, category: 'critical-risk' }));

    const topPriorities = recommendations
        .filter((rec) => rec.priority === 'CRITICAL' || rec.priority === 'HIGH')
        .slice(0, 5)
        .map((rec) => ({ ...rec, category: 'top-priority' }));

    const quickWins = recommendations
        .filter(
            (rec) =>
                rec.estimatedMinutes <= QUICK_WIN_MAX_MINUTES &&
                rec.impact >= 1 &&
                rec.priority !== 'CRITICAL'
        )
        .slice(0, 5)
        .map((rec) => ({ ...rec, category: 'quick-win' }));

    const recommendedActions = recommendations
        .slice(0, 8)
        .map((rec) => ({ ...rec, category: 'recommended-action' }));

    return { topPriorities, quickWins, criticalRisks, recommendedActions };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @returns {CreatorCopilotBrief}
 */
export function buildCreatorCopilotBrief(seriesId, feedReels = []) {
    const workflowSignature = getWorkflowTasksForSeries(seriesId)
        .map((task) => `${task.id}:${task.status}:${task.priority}:${task.estimatedImpact}`)
        .join('|');
    const memoKey = `${seriesId}::${buildCopilotFeedSignature(feedReels)}::${workflowSignature}`;
    const now = Date.now();
    if (lastCopilotMemo && lastCopilotMemo.key === memoKey && now - lastCopilotMemo.at < COPILOT_MEMO_TTL_MS) {
        return lastCopilotMemo.brief;
    }

    const readinessAnalysis = analyzeReadiness(seriesId, feedReels);
    const workflowAnalysis = analyzeWorkflowTasks(seriesId);
    const releaseAnalysis = analyzeReleaseSchedule(seriesId, feedReels);
    const assetAnalysis = analyzeAssetCoverage(seriesId, feedReels);

    const health = computeSeriesHealth(feedReels, seriesId);
    const actionPlan = buildStudioActionPlan(seriesId, feedReels);
    const workflowPlan = buildWorkflowTasks(seriesId, feedReels);
    const counts = getSeriesEpisodeCounts(seriesId);

    const analysis = {
        readiness: readinessAnalysis,
        workflow: workflowAnalysis,
        release: releaseAnalysis,
        assets: assetAnalysis
    };

    const blockerSource =
        workflowPlan.blockers[0] ||
        actionPlan.blockers[0] ||
        actionPlan.recommendations[0] ||
        null;

    const targetReadiness = Math.min(100, Math.max(80, readinessAnalysis.score + 1));
    const fastest = buildFastestPath(workflowPlan, targetReadiness);
    const recommendations = buildPrioritizedRecommendations(actionPlan, workflowPlan);
    const { topPriorities, quickWins, criticalRisks, recommendedActions } =
        categorizeRecommendations(recommendations);

    const brief = {
        currentReadiness: readinessAnalysis.score,
        biggestBlocker: formatBiggestBlocker(blockerSource),
        fastestPath: fastest.labels,
        fastestPathDetail: fastest.steps,
        targetReadiness,
        projectedReadiness: fastest.projectedReadiness,
        estimatedTime: fastest.estimatedTime || workflowPlan.estimatedMinutes || workflowAnalysis.estimatedMinutes,
        recommendations: recommendedActions,
        topPriorities,
        quickWins,
        criticalRisks,
        recommendedActions,
        analysis,
        totalEpisodes: counts.totalEpisodes,
        missingAssets: health.missingAssets
    };

    logCopilotDiag('COPILOT_ANALYSIS', {
        seriesId,
        currentReadiness: brief.currentReadiness,
        projectedReadiness: brief.projectedReadiness,
        targetReadiness: brief.targetReadiness,
        estimatedTime: brief.estimatedTime,
        biggestBlocker: brief.biggestBlocker,
        analysis,
        topPriorityCount: topPriorities.length,
        quickWinCount: quickWins.length,
        criticalRiskCount: criticalRisks.length,
        recommendedActionCount: recommendedActions.length
    });

    for (const rec of recommendedActions.slice(0, 6)) {
        logCopilotDiag('COPILOT_RECOMMENDATION', {
            seriesId,
            id: rec.id,
            priority: rec.priority,
            title: rec.title,
            impact: rec.impact,
            estimatedMinutes: rec.estimatedMinutes,
            category: rec.category
        });
    }

    lastCopilotMemo = {
        key: memoKey,
        at: now,
        brief
    };

    return brief;
}

/**
 * @param {CreatorCopilotBrief} brief
 */
export function projectCopilotReadiness(brief) {
    return {
        readinessBefore: brief.currentReadiness,
        readinessAfter: brief.projectedReadiness,
        targetReadiness: brief.targetReadiness,
        estimatedTime: brief.estimatedTime
    };
}

export function initCreatorCopilot() {
    if (typeof window === 'undefined') return;
    window.__reelforgeCopilot = {
        buildCreatorCopilotBrief,
        projectCopilotReadiness,
        analyzeReadiness,
        analyzeWorkflowTasks,
        analyzeReleaseSchedule,
        analyzeAssetCoverage,
        resolveCopilotPriority
    };
}
