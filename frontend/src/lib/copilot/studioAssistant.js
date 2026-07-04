/**
 * Phase 35 — Guide Me 3.0: context-aware Studio Assistant.
 * Aggregates Copilot, Action Engine, Production Health, Workflow, Notifications, Release Center.
 */

import { buildCreatorCopilotBrief, projectCopilotReadiness } from './creatorCopilot.js';
import { buildStudioActionPlan } from '../series/actionEngine.js';
import {
    computeProductionReadiness,
    computeSeriesHealth,
    getMissingAssetQueue
} from '../series/productionHealth.js';
import { buildWorkflowTasks } from '../series/workflowEngine.js';
import { getWorkflowTasksForSeries } from '../workflow/workflowEngine.js';
import { getNotifications, getUnreadCount } from '../notifications/notificationCenter.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';
import {
    DEFAULT_PUBLISHING_PROFILE,
    getPublishingProfile,
    normalizePublishingProfileId
} from '../publishing/publishingProfiles.js';
import { PUBLISHING_PROFILE_STORAGE_KEY } from '../publishing/publishingProfileStore.js';
import { getEpisodeById } from '../series/seriesStore.js';
import { masterAnalysis, getSentinelGuideMeOverlay } from '../sentinel/sentinelAssistant.js';

/**
 * @typedef {Object} StudioAssistantInsight
 * @property {string} id
 * @property {string} label
 * @property {string} summary
 * @property {string} detail
 * @property {'info' | 'warning' | 'critical'} tone
 * @property {string} [actionLabel]
 * @property {string} [targetTab]
 * @property {string} [targetSection]
 */

/**
 * @typedef {Object} StudioAssistantMissionPanel
 * @property {string} todaysMission
 * @property {{ title: string; detail: string; impact: number; targetTab: string; targetSection?: string }} topPriority
 * @property {{ title: string; detail: string; impact: number; estimatedMinutes: number; targetTab: string; targetSection?: string }} quickWin
 * @property {{ title: string; detail: string; severity: string; targetTab: string; targetSection?: string }} criticalRisk
 * @property {{ current: number; projected: number; delta: number; estimatedMinutes: number; targetReadiness: number }} projectedReadiness
 */

/**
 * @typedef {Object} StudioAssistantBrief
 * @property {string} seriesId
 * @property {number} currentReadiness
 * @property {StudioAssistantMissionPanel} mission
 * @property {Record<string, StudioAssistantInsight>} insights
 * @property {StudioAssistantInsight[]} insightList
 */

/**
 * @param {'STUDIO_ASSISTANT' | 'MISSION_GENERATED' | 'RISK_DETECTED'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logStudioAssistantDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {import('../publishing/publishingProfiles.js').PublishingProfileId} */
function loadActivePublishingProfileId() {
    if (typeof window === 'undefined') return DEFAULT_PUBLISHING_PROFILE;
    try {
        const stored = localStorage.getItem(PUBLISHING_PROFILE_STORAGE_KEY);
        return normalizePublishingProfileId(stored);
    } catch {
        return DEFAULT_PUBLISHING_PROFILE;
    }
}

/** @param {string | null | undefined} episodeId */
function episodeLabel(episodeId) {
    if (!episodeId) return '';
    const ctx = getEpisodeById(episodeId);
    if (!ctx?.episode) return '';
    const season = ctx.season?.seasonNumber ?? 1;
    return `S${season}E${String(ctx.episode.episodeNumber).padStart(2, '0')}`;
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
function buildReleaseRiskInsight(seriesId, feedReels) {
    const release = buildReleaseCenterSnapshot(seriesId, feedReels);
    const risks = [];

    if (release.releaseHealth.episodesMissingAssets > 0) {
        risks.push(
            `${release.releaseHealth.episodesMissingAssets} scheduled episode${release.releaseHealth.episodesMissingAssets === 1 ? '' : 's'} missing assets`
        );
    }
    if (release.launchReadiness.launchReadinessScore < 70) {
        risks.push(`Launch readiness at ${release.launchReadiness.launchReadinessScore}%`);
    }
    if (release.releaseHealth.daysUntilLaunch != null && release.releaseHealth.daysUntilLaunch <= 7) {
        risks.push(`Premiere in ${release.releaseHealth.daysUntilLaunch} day${release.releaseHealth.daysUntilLaunch === 1 ? '' : 's'}`);
    }
    if (release.launchReadiness.missingEpisodes > 0) {
        risks.push(`${release.launchReadiness.missingEpisodes} episode${release.launchReadiness.missingEpisodes === 1 ? '' : 's'} not release-ready`);
    }

    const summary =
        risks.length === 0
            ? 'No release risks detected — schedule looks stable.'
            : risks[0];

    return /** @type {StudioAssistantInsight} */ ({
        id: 'release-risks',
        label: 'Release risks',
        summary,
        detail: risks.length ? risks.join(' · ') : 'Keep monitoring upcoming premiere dates.',
        tone: risks.some((r) => r.includes('missing') || r.includes('Premiere')) ? 'critical' : risks.length ? 'warning' : 'info',
        actionLabel: risks.length ? 'Open release center' : 'Review schedule',
        targetTab: 'Content',
        targetSection: 'releaseCenter'
    });
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
function buildMissingAssetsInsight(seriesId, feedReels) {
    const queue = getMissingAssetQueue(feedReels, seriesId);
    const health = computeSeriesHealth(feedReels, seriesId);

    const labels = queue
        .slice(0, 3)
        .map((row) => row.episodeTitle || episodeLabel(row.episodeId) || row.episodeId)
        .filter(Boolean);

    return /** @type {StudioAssistantInsight} */ ({
        id: 'missing-assets',
        label: 'Missing assets',
        summary:
            queue.length === 0
                ? 'All tracked episodes have reels attached.'
                : `${queue.length} episode${queue.length === 1 ? '' : 's'} need video assets.`,
        detail:
            labels.length > 0
                ? `Queue: ${labels.join(', ')}${queue.length > labels.length ? ` +${queue.length - labels.length} more` : ''}`
                : `${health.missingAssets} missing of ${health.totalEpisodes} tracked episodes.`,
        tone: queue.length === 0 ? 'info' : queue.length <= 2 ? 'warning' : 'critical',
        actionLabel: queue.length ? 'Clear asset queue' : 'View coverage',
        targetTab: 'Content',
        targetSection: 'missingAssetQueue'
    });
}

/**
 * @param {import('./creatorCopilot.js').CreatorCopilotBrief} copilot
 * @param {import('../series/productionHealth.js').ProductionReadinessSnapshot} readiness
 */
function buildPublishingRecommendationsInsight(copilot, readiness) {
    const activeId = loadActivePublishingProfileId();
    const active = getPublishingProfile(activeId);
    const recommendations = [];

    if (readiness.publishing < 80) {
        recommendations.push('Complete publishing metadata before switching presentation modes.');
    }
    if (readiness.metadata < 75) {
        recommendations.push('Fill episode descriptions and runtime for richer metadata display.');
    }
    if (copilot.analysis.assets.coveragePercent >= 90 && activeId !== 'reelshort') {
        recommendations.push('Consider Reelshort profile for vertical micro-drama presentation.');
    }
    if (copilot.analysis.release.episodesScheduled >= 3 && activeId === 'reelshort') {
        recommendations.push('Netflix-style profile may improve binge navigation for multi-episode drops.');
    }
    if (copilot.analysis.release.daysUntilLaunch != null && activeId !== 'youtube-series') {
        recommendations.push('YouTube Series profile helps playlist-style premieres.');
    }

    const suggested = recommendations[0] || `Active profile: ${active.label} — metadata drives Theater presentation.`;

    return /** @type {StudioAssistantInsight} */ ({
        id: 'publishing-recommendations',
        label: 'Publishing recommendations',
        summary: suggested,
        detail:
            recommendations.length > 1
                ? recommendations.slice(0, 3).join(' ')
                : `${active.icon} ${active.description}`,
        tone: readiness.publishing < 60 ? 'warning' : 'info',
        actionLabel: 'Review publishing profiles',
        targetTab: 'Content',
        targetSection: 'publishingProfiles'
    });
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @returns {StudioAssistantBrief}
 */
export function buildStudioAssistantMission(seriesId, feedReels = []) {
    const copilot = buildCreatorCopilotBrief(seriesId, feedReels);
    const actionPlan = buildStudioActionPlan(seriesId, feedReels);
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const health = computeSeriesHealth(feedReels, seriesId);
    const workflowPlan = buildWorkflowTasks(seriesId, feedReels);
    const openWorkflowTasks = getWorkflowTasksForSeries(seriesId).filter((t) => t.status !== 'COMPLETE');
    const unread = getUnreadCount();
    const teamNotes = getNotifications().filter((n) => !n.read).slice(0, 3);
    const sentinel = masterAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    const sentinelGuide = getSentinelGuideMeOverlay(sentinel);

    const topRec = copilot.topPriorities[0] || copilot.recommendedActions[0] || actionPlan.recommendations[0];
    const quickRec = copilot.quickWins[0] || actionPlan.quickWins[0];
    const riskRec = copilot.criticalRisks[0];
    const projection = projectCopilotReadiness(copilot);

    const fastestGain = copilot.fastestPathDetail[0];
    const nextAction =
        sentinelGuide.highestImpactAction?.title ||
        (topRec ? topRec.title : workflowPlan.blockers[0]?.title || 'Review production overview');

    const whatNext = /** @type {StudioAssistantInsight} */ ({
        id: 'what-next',
        label: 'What should I do next?',
        summary: nextAction,
        detail:
            openWorkflowTasks.length > 0
                ? `${openWorkflowTasks.length} open workflow task${openWorkflowTasks.length === 1 ? '' : 's'} · ${unread} unread notification${unread === 1 ? '' : 's'}`
                : 'Follow the ranked mission below to raise readiness fastest.',
        tone: actionPlan.blockers.length ? 'critical' : 'info',
        actionLabel: 'Go to production',
        targetTab: actionPlan.blockers.length ? 'Production' : 'Overview',
        targetSection: actionPlan.blockers.length ? 'workflowTasks' : 'readinessMeter'
    });

    const blocker = /** @type {StudioAssistantInsight} */ ({
        id: 'biggest-blocker',
        label: 'Biggest blocker',
        summary: sentinelGuide.biggestBlocker || copilot.biggestBlocker,
        detail:
            sentinel.blockers[0]?.detail ||
            actionPlan.blockers[0]?.description ||
            workflowPlan.blockers[0]?.title ||
            'No hard blockers — maintain momentum on scheduled releases.',
        tone: actionPlan.blockers.length || workflowPlan.blockers.length ? 'critical' : 'info',
        actionLabel: actionPlan.blockers.length ? 'Resolve blocker' : 'View overview',
        targetTab: 'Production',
        targetSection: 'workflowTasks'
    });

    const fastest = /** @type {StudioAssistantInsight} */ ({
        id: 'fastest-readiness-gain',
        label: 'Fastest readiness gain',
        summary: sentinelGuide.biggestQuickWin.startsWith('+')
            ? sentinelGuide.biggestQuickWin
            : fastestGain
              ? `${fastestGain.label} (+${fastestGain.impact}%)`
              : sentinelGuide.biggestQuickWin,
        detail: copilot.fastestPath.slice(0, 3).join(' → ') || 'Complete top metadata and asset tasks.',
        tone: 'info',
        actionLabel: 'See action plan',
        targetTab: 'Automation',
        targetSection: 'creatorCopilot'
    });

    const releaseRisks = buildReleaseRiskInsight(seriesId, feedReels);
    const missingAssets = buildMissingAssetsInsight(seriesId, feedReels);
    const publishing = buildPublishingRecommendationsInsight(copilot, readiness);

    const insights = {
        whatNext,
        biggestBlocker: blocker,
        fastestReadinessGain: fastest,
        releaseRisks,
        missingAssets,
        publishingRecommendations: publishing
    };

    const insightList = Object.values(insights);

    const todaysMission =
        health.missingAssets > 0
            ? `Attach ${health.missingAssets} missing reel${health.missingAssets === 1 ? '' : 's'}, then ${nextAction.toLowerCase()}.`
            : readiness.weightedPercent >= 90
              ? 'Polish metadata and confirm release schedule for premiere.'
              : `Complete "${nextAction}" to push readiness toward ${projection.targetReadiness}%.`;

    const mission = /** @type {StudioAssistantMissionPanel} */ ({
        todaysMission,
        topPriority: {
            title: sentinelGuide.highestImpactAction?.title || topRec?.title || nextAction,
            detail:
                sentinelGuide.highestImpactAction?.detail ||
                topRec?.description ||
                blocker.detail,
            impact:
                sentinelGuide.highestImpactAction?.impact ||
                topRec?.impact ||
                actionPlan.recommendations[0]?.impact ||
                0,
            targetTab: sentinelGuide.highestImpactAction?.targetTab || whatNext.targetTab || 'Overview',
            targetSection: sentinelGuide.highestImpactAction?.targetSection || whatNext.targetSection
        },
        quickWin: {
            title:
                typeof sentinelGuide.biggestQuickWin === 'string'
                    ? sentinelGuide.biggestQuickWin
                    : quickRec?.title || fastestGain?.label || 'Add missing runtime fields',
            detail: quickRec?.description || 'Small metadata fixes compound quickly.',
            impact: quickRec?.impact || fastestGain?.impact || 1,
            estimatedMinutes: quickRec?.estimatedMinutes || fastestGain?.estimatedMinutes || 2,
            targetTab: 'Automation',
            targetSection: 'creatorCopilot'
        },
        criticalRisk: {
            title: riskRec?.title || sentinel.blockers[0]?.title || releaseRisks.summary,
            detail: riskRec?.description || sentinel.topIssues[0]?.detail || releaseRisks.detail,
            severity: riskRec?.priority || (releaseRisks.tone === 'critical' ? 'CRITICAL' : 'MEDIUM'),
            targetTab: releaseRisks.tone !== 'info' ? 'Content' : 'Overview',
            targetSection: releaseRisks.tone !== 'info' ? 'releaseCenter' : 'readinessMeter'
        },
        projectedReadiness: {
            current: sentinel.projectedReadiness.current,
            projected: sentinel.projectedReadiness.projected,
            delta: sentinel.projectedReadiness.delta,
            estimatedMinutes: projection.estimatedTime,
            targetReadiness: sentinel.projectedReadiness.targetReadiness
        }
    });

    logStudioAssistantDiag('STUDIO_ASSISTANT', {
        seriesId,
        currentReadiness: mission.projectedReadiness.current,
        projectedReadiness: mission.projectedReadiness.projected,
        openWorkflowTasks: openWorkflowTasks.length,
        unreadNotifications: unread,
        missingAssets: health.missingAssets,
        blockerCount: actionPlan.blockers.length,
        insightCount: insightList.length
    });

    logStudioAssistantDiag('MISSION_GENERATED', {
        seriesId,
        todaysMission: mission.todaysMission,
        topPriority: mission.topPriority.title,
        quickWin: mission.quickWin.title,
        criticalRisk: mission.criticalRisk.title,
        projectedReadiness: mission.projectedReadiness.projected,
        targetReadiness: mission.projectedReadiness.targetReadiness
    });

    if (riskRec || releaseRisks.tone === 'critical' || actionPlan.blockers.length) {
        logStudioAssistantDiag('RISK_DETECTED', {
            seriesId,
            riskTitle: mission.criticalRisk.title,
            severity: mission.criticalRisk.severity,
            releaseRisk: releaseRisks.summary,
            blockerCount: actionPlan.blockers.length
        });
    }

    for (const insight of insightList) {
        if (insight.tone === 'critical') {
            logStudioAssistantDiag('RISK_DETECTED', {
                seriesId,
                insightId: insight.id,
                label: insight.label,
                summary: insight.summary,
                severity: 'CRITICAL'
            });
        }
    }

    if (teamNotes.length) {
        void teamNotes;
    }

    return {
        seriesId,
        currentReadiness: readiness.weightedPercent,
        mission,
        insights,
        insightList
    };
}

let studioAssistantInitialized = false;

export function initStudioAssistant() {
    if (typeof window === 'undefined' || studioAssistantInitialized) return;
    studioAssistantInitialized = true;

    window.__reelforgeStudioAssistant = {
        buildStudioAssistantMission,
        logStudioAssistantDiag
    };

    logStudioAssistantDiag('STUDIO_ASSISTANT', { phase: 'engine_initialized', version: '3.0' });
}
