/**
 * Phase 36 — Guide Me 3.0: contextual operational assistant for Smart Production Studio.
 * Aggregates Sentinel, Copilot, Action Engine, Production Health, Workflow, Release Center, Teams.
 */

import { buildCommandCenterSnapshot } from '../command/commandCenter.js';
import { buildStudioActionPlan } from '../series/actionEngine.js';
import { computeProductionReadiness, computeSeriesHealth } from '../series/productionHealth.js';
import { buildStudioAssistantMission } from '../copilot/studioAssistant.js';
import { buildCreatorCopilotBrief } from '../copilot/creatorCopilot.js';
import { buildWorkflowTasks } from '../series/workflowEngine.js';
import { getWorkflowTasksForSeries } from '../workflow/workflowEngine.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';
import { masterAnalysis, getSentinelGuideMeOverlay } from '../sentinel/sentinelAssistant.js';
import { getOpenTasksForAssignment } from '../teams/creatorTeams.js';
import { getSeriesById } from '../series/seriesStore.js';
import { PIPELINE_STORAGE_KEY } from '../pipeline/episodePipeline.js';
import { getNotifications, getUnreadCount } from '../notifications/notificationCenter.js';
import { WORKSPACE_TABS } from './studioWorkspace.js';

export const GUIDE_ME_MODE_KEY = 'reelforge_guide_me_mode';
export const GUIDE_ME_COMPLETE_KEY = 'reelforge_guide_me_complete';
export const GUIDE_ME_ASSISTANT_MODE_KEY = 'reelforge_guide_me_assistant_mode';
export const GUIDE_ME_ENGINE_VERSION = '3.0.0';

/** @typedef {'beginner' | 'creator' | 'producer' | 'executive'} GuideMeAssistantModeId */

/** @type {{ id: GuideMeAssistantModeId; name: string; description: string }[]} */
export const GUIDE_ME_ASSISTANT_MODES = [
    {
        id: 'beginner',
        name: 'Beginner',
        description: 'Plain-language coaching with step-by-step guidance.'
    },
    {
        id: 'creator',
        name: 'Creator',
        description: 'Balanced creative and operational recommendations.'
    },
    {
        id: 'producer',
        name: 'Producer',
        description: 'Workflow-first priorities for daily production runs.'
    },
    {
        id: 'executive',
        name: 'Studio Executive',
        description: 'KPI-focused mission brief for release readiness.'
    }
];

export const GUIDE_ME_ASSISTANT_MODE_IDS = GUIDE_ME_ASSISTANT_MODES.map((mode) => mode.id);

/** @typedef {'Readiness' | 'Coverage' | 'Workflow' | 'Notifications'} CoachingCategory */

/**
 * @typedef {Object} GuideMeSectionGuide
 * @property {string} id
 * @property {string} title
 * @property {typeof WORKSPACE_TABS[number] | 'Panel'} workspace
 * @property {string} [selector]
 * @property {string} whatIsThis
 * @property {string} whyItMatters
 * @property {string} whenToUse
 * @property {string} ifIgnored
 * @property {string} doNext
 * @property {string} safeUsage
 * @property {string} productionConsequences
 */

/**
 * @typedef {Object} CoachingCard
 * @property {string} id
 * @property {CoachingCategory} category
 * @property {string} message
 * @property {string} hint
 * @property {'info' | 'warning' | 'critical'} tone
 * @property {string} [actionLabel]
 * @property {string} [targetTab]
 * @property {string} [targetSection]
 */

/**
 * @typedef {Object} GuideMeTourStep
 * @property {string} id
 * @property {string} selector
 * @property {string} title
 * @property {string} whatIsThis
 * @property {string} whyItMatters
 * @property {string} whenToUse
 * @property {string} ifIgnored
 * @property {string} doNext
 * @property {string} safeUsage
 * @property {string} productionConsequences
 */

/**
 * @param {'GUIDE_ME_CONTEXT' | 'GUIDE_ME_RECOMMENDATION' | 'GUIDE_ME_ACTION' | 'GUIDEME_MISSION' | 'GUIDEME_ACTION' | 'GUIDEME_RECOMMENDATION'} tag
 * @param {Record<string, unknown>} detail
 */
export function logGuideMeDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {string | null | undefined} modeId */
export function normalizeGuideMeAssistantMode(modeId) {
    const id = String(modeId || 'creator');
    return /** @type {GuideMeAssistantModeId} */ (
        GUIDE_ME_ASSISTANT_MODE_IDS.includes(/** @type {GuideMeAssistantModeId} */ (id)) ? id : 'creator'
    );
}

/** @returns {GuideMeAssistantModeId} */
export function loadGuideMeAssistantMode() {
    if (typeof window === 'undefined') return 'creator';
    try {
        return normalizeGuideMeAssistantMode(localStorage.getItem(GUIDE_ME_ASSISTANT_MODE_KEY));
    } catch {
        return 'creator';
    }
}

/** @param {GuideMeAssistantModeId} modeId */
export function saveGuideMeAssistantMode(modeId) {
    const normalized = normalizeGuideMeAssistantMode(modeId);
    if (typeof window !== 'undefined') {
        try {
            localStorage.setItem(GUIDE_ME_ASSISTANT_MODE_KEY, normalized);
        } catch {
            /* ignore */
        }
    }
    logGuideMeDiag('GUIDEME_ACTION', { phase: 'mode_changed', mode: normalized });
    return normalized;
}

/**
 * @param {GuideMeAssistantModeId} mode
 * @param {Record<GuideMeAssistantModeId, string>} variants
 */
function copyForMode(mode, variants) {
    return variants[mode] || variants.creator;
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {{ mode?: GuideMeAssistantModeId; silent?: boolean }} [options]
 */
export function buildGuideMeOperationalBrief(seriesId, feedReels = [], options = {}) {
    const mode = normalizeGuideMeAssistantMode(options.mode || loadGuideMeAssistantMode());
    const assistant = buildStudioAssistantMission(seriesId, feedReels);
    const copilot = buildCreatorCopilotBrief(seriesId, feedReels);
    const actionPlan = buildStudioActionPlan(seriesId, feedReels);
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const health = computeSeriesHealth(feedReels, seriesId);
    const workflowPlan = buildWorkflowTasks(seriesId, feedReels);
    const openWorkflowTasks = getWorkflowTasksForSeries(seriesId).filter((task) => task.status !== 'COMPLETE');
    const release = buildReleaseCenterSnapshot(seriesId, feedReels);
    const sentinel = masterAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    const sentinelOverlay = getSentinelGuideMeOverlay(sentinel);
    const teamAssignments = getOpenTasksForAssignment(seriesId);
    const series = getSeriesById(seriesId);

    /** @type {Record<string, unknown>} */
    const context = {
        seriesId,
        seriesName: series?.title || seriesId,
        readinessScore: readiness.weightedPercent,
        blockers: [
            ...actionPlan.blockers.map((blocker) => blocker.title),
            ...workflowPlan.blockers.map((blocker) => blocker.title)
        ].slice(0, 5),
        workflowState: {
            openTasks: openWorkflowTasks.length,
            bottleneckCount: workflowPlan.blockers.length,
            blockedStages: workflowPlan.blockers.map((blocker) => blocker.title).slice(0, 3)
        },
        publishingState: {
            launchReadinessScore: release.launchReadiness.launchReadinessScore,
            scheduledEpisodes: release.releaseHealth.episodesScheduled ?? 0,
            episodesMissingAssets: release.releaseHealth.episodesMissingAssets,
            daysUntilLaunch: release.releaseHealth.daysUntilLaunch
        },
        teamState: {
            openAssignments: teamAssignments.length,
            unreadNotifications: getUnreadCount()
        }
    };

    const missionOfTheDay = copyForMode(mode, {
        beginner: `Today's goal: ${assistant.mission.todaysMission}`,
        creator: assistant.mission.todaysMission,
        producer: `Production run: ${assistant.mission.topPriority.title} before release checks.`,
        executive: `Mission — ${context.seriesName}: reach ${assistant.mission.projectedReadiness.targetReadiness}% readiness (${readiness.weightedPercent}% now).`
    });

    const biggestBlocker = {
        title: sentinelOverlay.biggestBlocker || assistant.insights.biggestBlocker.summary,
        detail: assistant.insights.biggestBlocker.detail,
        tone: assistant.insights.biggestBlocker.tone,
        targetTab: assistant.insights.biggestBlocker.targetTab,
        targetSection: assistant.insights.biggestBlocker.targetSection,
        summary: copyForMode(mode, {
            beginner: `What's slowing you down: ${assistant.insights.biggestBlocker.summary}`,
            creator: assistant.insights.biggestBlocker.summary,
            producer: `Blocker: ${assistant.insights.biggestBlocker.summary}`,
            executive: `Primary blocker — ${assistant.insights.biggestBlocker.summary}`
        })
    };

    const fastestWin = {
        title: assistant.mission.quickWin.title,
        detail: assistant.mission.quickWin.detail,
        impact: assistant.mission.quickWin.impact,
        estimatedMinutes: assistant.mission.quickWin.estimatedMinutes,
        targetTab: assistant.mission.quickWin.targetTab,
        targetSection: assistant.mission.quickWin.targetSection,
        summary: copyForMode(mode, {
            beginner: `Quick win: ${assistant.mission.quickWin.title} (~${assistant.mission.quickWin.estimatedMinutes} min).`,
            creator: assistant.insights.fastestReadinessGain.summary,
            producer: `Fastest gain: ${assistant.insights.fastestReadinessGain.summary}`,
            executive: `Quick win (+${assistant.mission.quickWin.impact}%): ${assistant.mission.quickWin.title}`
        })
    };

    const recommendedNextAction = {
        title: sentinelOverlay.highestImpactAction?.title || assistant.insights.whatNext.summary,
        detail: sentinelOverlay.highestImpactAction?.detail || assistant.insights.whatNext.detail,
        impact: sentinelOverlay.highestImpactAction?.impact || assistant.mission.topPriority.impact,
        targetTab: sentinelOverlay.highestImpactAction?.targetTab || assistant.insights.whatNext.targetTab,
        targetSection:
            sentinelOverlay.highestImpactAction?.targetSection || assistant.insights.whatNext.targetSection,
        summary: copyForMode(mode, {
            beginner: `Do this next: ${assistant.insights.whatNext.summary}`,
            creator: assistant.insights.whatNext.summary,
            producer: `Next action: ${assistant.insights.whatNext.summary}`,
            executive: `Recommended action — ${assistant.insights.whatNext.summary}`
        })
    };

    const releaseReadinessAdvice = {
        title: assistant.insights.releaseRisks.summary,
        detail: assistant.insights.releaseRisks.detail,
        tone: assistant.insights.releaseRisks.tone,
        launchReadinessScore: release.launchReadiness.launchReadinessScore,
        targetTab: assistant.insights.releaseRisks.targetTab,
        targetSection: assistant.insights.releaseRisks.targetSection,
        summary: copyForMode(mode, {
            beginner:
                release.launchReadiness.launchReadinessScore >= 70
                    ? 'Release schedule looks stable — keep confirming videos before premiere.'
                    : `Release needs attention: ${assistant.insights.releaseRisks.summary}`,
            creator: assistant.insights.releaseRisks.summary,
            producer: `Release readiness ${release.launchReadiness.launchReadinessScore}% — ${assistant.insights.releaseRisks.summary}`,
            executive: `Launch readiness ${release.launchReadiness.launchReadinessScore}% · ${assistant.insights.publishingRecommendations.summary}`
        })
    };

    if (!options.silent) {
        logGuideMeDiag('GUIDEME_MISSION', {
            mode,
            seriesId,
            seriesName: context.seriesName,
            missionOfTheDay,
            readinessScore: context.readinessScore,
            projectedReadiness: assistant.mission.projectedReadiness.projected,
            targetReadiness: assistant.mission.projectedReadiness.targetReadiness
        });

        logGuideMeDiag('GUIDEME_ACTION', {
            mode,
            seriesId,
            recommendedNextAction: recommendedNextAction.title,
            biggestBlocker: biggestBlocker.title,
            fastestWin: fastestWin.title,
            openWorkflowTasks: context.workflowState.openTasks,
            teamAssignments: context.teamState.openAssignments
        });

        logGuideMeDiag('GUIDEME_RECOMMENDATION', {
            mode,
            seriesId,
            releaseAdvice: releaseReadinessAdvice.summary,
            publishingRecommendation: assistant.insights.publishingRecommendations.summary,
            copilotPriority: copilot.topPriorities[0]?.title || null,
            sentinelScore: sentinel.readinessScore
        });

        for (const insight of assistant.insightList) {
            logGuideMeDiag('GUIDE_ME_RECOMMENDATION', {
                cardId: insight.id,
                category: insight.label,
                message: insight.summary,
                tone: insight.tone,
                targetTab: insight.targetTab
            });
        }
    }

    return {
        mode,
        version: GUIDE_ME_ENGINE_VERSION,
        context,
        missionOfTheDay,
        biggestBlocker,
        fastestWin,
        recommendedNextAction,
        releaseReadinessAdvice,
        mission: assistant.mission,
        insights: assistant.insightList,
        assistant
    };
}

/** @param {Partial<GuideMeSectionGuide> & Pick<GuideMeSectionGuide, 'id' | 'title' | 'whatIsThis' | 'whyItMatters' | 'whenToUse' | 'ifIgnored' | 'doNext' | 'safeUsage' | 'productionConsequences'>} section */
function sectionGuide(section) {
    return {
        workspace: 'Panel',
        selector: `[data-guide-me-section="${section.id}"]`,
        ...section
    };
}

/** @type {Record<string, GuideMeSectionGuide>} */
export const GUIDE_ME_SECTIONS = {
    overview: {
        id: 'overview',
        title: 'Overview',
        workspace: 'Overview',
        selector: '[data-workspace-overview]',
        whatIsThis: 'Your home screen. It shows how ready your show is right now.',
        whyItMatters: 'You see the biggest problems first without digging through every panel.',
        whenToUse: 'Open Studio and start here every work session.',
        ifIgnored: 'Small problems pile up and you may miss a release deadline.',
        doNext: 'Read the coaching cards, then open the tab that matches your top problem.',
        safeUsage: 'Refresh after big changes so the numbers stay accurate.',
        productionConsequences: 'Skipping overview checks often leads to publishing episodes that are not viewer-ready.'
    },
    production: {
        id: 'production',
        title: 'Production',
        workspace: 'Production',
        selector: '[data-workspace-panel-production]',
        whatIsThis: 'Where you track health scores, workflow tasks, and the episode pipeline.',
        whyItMatters: 'Production is the daily checklist that keeps episodes moving toward release.',
        whenToUse: 'Use this when episodes are stuck, tasks are overdue, or pipeline stages need updates.',
        ifIgnored: 'Episodes stay in early stages and never reach viewers.',
        doNext: 'Clear blockers in workflow tasks, then move pipeline cards forward one stage at a time.',
        safeUsage: 'Finish review steps before marking an episode ready to publish.',
        productionConsequences: 'Rushing pipeline moves without review can publish unfinished work.'
    },
    content: {
        id: 'content',
        title: 'Content',
        workspace: 'Content',
        selector: '[data-workspace-panel-content]',
        whatIsThis: 'Where you attach videos, schedule releases, and review every episode row.',
        whyItMatters: 'Viewers need videos, titles, and release dates before they can watch your show.',
        whenToUse: 'Use this when videos are missing, metadata is wrong, or release dates are empty.',
        ifIgnored: 'Episodes exist on paper but viewers see blank or broken pages.',
        doNext: 'Clear the missing asset queue, then set release dates for ready episodes.',
        safeUsage: 'Double-check season and episode numbers before attaching a video.',
        productionConsequences: 'Wrong attachments break auto-play and confuse viewers about episode order.'
    },
    teams: {
        id: 'teams',
        title: 'Teams',
        workspace: 'Teams',
        selector: '[data-workspace-panel-teams]',
        whatIsThis: 'Where you invite collaborators and assign roles like writer, editor, or reviewer.',
        whyItMatters: 'Shows with teams move faster because everyone knows their job.',
        whenToUse: 'Use this when more than one person works on the same series.',
        ifIgnored: 'One person carries every task and bottlenecks grow.',
        doNext: 'Assign roles, then match workflow tasks to the right teammate.',
        safeUsage: 'Give reviewers approval power only when you trust their sign-off.',
        productionConsequences: 'Unclear roles cause duplicate edits or missed review steps.'
    },
    analytics: {
        id: 'analytics',
        title: 'Analytics',
        workspace: 'Analytics',
        selector: '[data-workspace-panel-analytics]',
        whatIsThis: 'Charts and graphs that show how viewers watch and engage with your show.',
        whyItMatters: 'You learn which episodes work so you can make smarter creative choices.',
        whenToUse: 'Use this after publishing to see what viewers finish and what they skip.',
        ifIgnored: 'You keep guessing instead of using real viewer behavior.',
        doNext: 'Check completion rates, then promote strong episodes in your hero banner.',
        safeUsage: 'Look for trends over time, not just one day of data.',
        productionConsequences: 'Ignoring analytics can waste effort on episodes viewers rarely finish.'
    },
    automation: {
        id: 'automation',
        title: 'Automation',
        workspace: 'Automation',
        selector: '[data-workspace-panel-automation]',
        whatIsThis: 'Smart suggestions that rank what to fix next across your whole series.',
        whyItMatters: 'The coach saves time by turning messy status into a short to-do list.',
        whenToUse: 'Use this when you feel overwhelmed and need a clear starting point.',
        ifIgnored: 'You may fix easy wins last and stay blocked on bigger issues.',
        doNext: 'Start with the top priority, then work down the recommended list.',
        safeUsage: 'Treat suggestions as guidance — you still approve every publish action.',
        productionConsequences: 'Blindly following suggestions without checking content quality can still hurt viewer trust.'
    },
    system: {
        id: 'system',
        title: 'System',
        workspace: 'System',
        selector: '[data-workspace-panel-system]',
        whatIsThis: 'Warnings, repair tools, and system alerts for your studio setup.',
        whyItMatters: 'This catches hidden problems before they break a release day.',
        whenToUse: 'Use this when something feels wrong or repair suggestions appear on overview.',
        ifIgnored: 'Small glitches become launch-day surprises.',
        doNext: 'Run repair suggestions one at a time and confirm each fix in the theater.',
        safeUsage: 'Read each warning before clicking repair — some fixes change publishing state.',
        productionConsequences: 'Unfixed system warnings can block publishing gates or hide missing assets.'
    },
    readinessMeter: sectionGuide({
        id: 'readinessMeter',
        title: 'Readiness Score',
        selector: '[data-studio-walkthrough="readinessMeter"], [data-workspace-metric-readiness]',
        whatIsThis: 'A score that blends metadata, videos, publishing, and release dates.',
        whyItMatters: 'It tells you how close the series is to a smooth launch.',
        whenToUse: 'Check before scheduling a premiere or publishing a full season.',
        ifIgnored: 'You may launch with missing videos or unfinished details.',
        doNext: 'Raise the lowest bar first — usually missing videos or unpublished episodes.',
        safeUsage: 'Aim for strong scores in every bar, not just the total number.',
        productionConsequences: 'Low readiness at launch increases viewer drop-off and support requests.'
    }),
    episodeOperations: sectionGuide({
        id: 'episodeOperations',
        title: 'Episode Operations',
        selector: '[data-studio-walkthrough="episodeOperations"]',
        whatIsThis: 'A table of every episode with video, publish, and schedule status.',
        whyItMatters: 'One view shows which episodes still need work.',
        whenToUse: 'Use before batch publishing or when auditing a season.',
        ifIgnored: 'Draft episodes with missing videos slip through unnoticed.',
        doNext: 'Filter for missing or draft rows and fix them top to bottom.',
        safeUsage: 'Review all seasons — do not assume season one is the only one that matters.',
        productionConsequences: 'Unreviewed rows cause broken episode order in the theater.'
    }),
    missingAssetQueue: sectionGuide({
        id: 'missingAssetQueue',
        title: 'Missing Asset Queue',
        selector: '[data-studio-walkthrough="missingAssetQueue"]',
        whatIsThis: 'A waiting list of episodes that still need a video file attached.',
        whyItMatters: 'An episode without a video cannot play for anyone.',
        whenToUse: 'Use immediately after uploading new reels or importing media.',
        ifIgnored: 'Published episodes may show empty players.',
        doNext: 'Attach the correct reel to each queued episode.',
        safeUsage: 'Match episode numbers carefully before attaching.',
        productionConsequences: 'Wrong attachments break binge-watching and confuse episode guides.'
    }),
    seriesMetadata: sectionGuide({
        id: 'seriesMetadata',
        title: 'Series Metadata',
        selector: '[data-studio-walkthrough="seriesMetadata"]',
        whatIsThis: 'Titles, descriptions, season numbers, and story details for each video.',
        whyItMatters: 'Theater and episode lists display these details to viewers.',
        whenToUse: 'Fill this in right after uploading a new reel.',
        ifIgnored: 'Viewers see blank titles or wrong episode order.',
        doNext: 'Save metadata for every reel before publishing.',
        safeUsage: 'Verify season and episode numbers twice before saving.',
        productionConsequences: 'Bad metadata breaks search, sorting, and next-episode buttons.'
    }),
    publishingProfiles: sectionGuide({
        id: 'publishingProfiles',
        title: 'Publishing Profiles',
        selector: '[data-studio-walkthrough="publishingProfiles"]',
        whatIsThis: 'Settings that control how your show looks and plays in the full-screen theater.',
        whyItMatters: 'Different genres need different layouts and navigation styles.',
        whenToUse: 'Set once per series, then preview in the theater after changes.',
        ifIgnored: 'Theater layout may not match your show style.',
        doNext: 'Pick a profile and watch one episode in the theater to confirm.',
        safeUsage: 'Avoid switching profiles during an active premiere window.',
        productionConsequences: 'Mid-release profile changes can confuse returning viewers.'
    }),
    workflowTasks: sectionGuide({
        id: 'workflowTasks',
        title: 'Production Workflow',
        selector: '[data-workflow-task-center]',
        whatIsThis: 'A task list built from gaps like missing videos, metadata, or release dates.',
        whyItMatters: 'Tasks turn vague problems into clear assignments.',
        whenToUse: 'Use daily to track what still blocks release readiness.',
        ifIgnored: 'Blockers stay invisible until launch day.',
        doNext: 'Complete blocker tasks first, then mark them done.',
        safeUsage: 'Assign tasks to teammates when roles are set in Teams.',
        productionConsequences: 'Open blocker tasks directly delay publishing gates.'
    }),
    releaseCenter: sectionGuide({
        id: 'releaseCenter',
        title: 'Release Center',
        selector: '[data-release-center]',
        whatIsThis: 'A calendar for scheduling when episodes go live.',
        whyItMatters: 'Planned releases build audience anticipation and steady growth.',
        whenToUse: 'Use after episodes are ready and published internally.',
        ifIgnored: 'Episodes may go live at random times without a cadence.',
        doNext: 'Schedule the next episode with a clear date and preview the countdown.',
        safeUsage: 'Confirm videos and metadata before locking a premiere date.',
        productionConsequences: 'Premature schedules advertise episodes that are not viewer-ready.'
    }),
    pipelineBoard: sectionGuide({
        id: 'pipelineBoard',
        title: 'Pipeline Board',
        selector: '[data-pipeline-board]',
        whatIsThis: 'A board that tracks each episode from idea to published.',
        whyItMatters: 'You see where every episode sits in the creative process.',
        whenToUse: 'Use when episodes stall in editing, review, or ready stages.',
        ifIgnored: 'Work piles up in early stages and nothing ships.',
        doNext: 'Move one card forward only when that stage is truly finished.',
        safeUsage: 'Get reviewer approval before moving to ready or published.',
        productionConsequences: 'Skipping review stages publishes unfinished edits.'
    }),
    creatorCopilot: sectionGuide({
        id: 'creatorCopilot',
        title: 'Creator Copilot',
        selector: '[data-creator-copilot]',
        whatIsThis: 'A smart assistant that summarizes risks, quick wins, and next steps.',
        whyItMatters: 'It helps you decide what matters most when time is short.',
        whenToUse: 'Use when the overview feels busy or you need a prioritized plan.',
        ifIgnored: 'You may spend time on low-impact fixes first.',
        doNext: 'Follow the top priority, then check projected readiness after.',
        safeUsage: 'Combine copilot advice with your creative judgment.',
        productionConsequences: 'Ignoring critical risks listed here often delays release readiness.'
    }),
    notifications: sectionGuide({
        id: 'notifications',
        title: 'Notifications',
        selector: '[data-workspace-notifications]',
        whatIsThis: 'Alerts about assignments, missing assets, releases, and team updates.',
        whyItMatters: 'You stay informed when something needs your attention.',
        whenToUse: 'Check whenever the unread count rises on overview.',
        ifIgnored: 'Teammates wait on approvals and tasks go stale.',
        doNext: 'Open unread items and resolve the newest team actions first.',
        safeUsage: 'Mark items read only after you have taken action or delegated.',
        productionConsequences: 'Missed notifications delay reviews and block publishing handoffs.'
    })
};

const TEAM_NOTIFICATION_TYPES = new Set([
    'workflow_assigned',
    'task_assigned',
    'team_role_changed',
    'team_member_added'
]);

const FALLBACK_TOUR_IDS = [
    'seriesMetadata',
    'episodeOperations',
    'missingAssetQueue',
    'readinessMeter',
    'publishingProfiles'
];

/** @param {string} seriesId @param {Record<string, unknown>[]} [feedReels] */
function countActionsToReadiness(seriesId, feedReels = []) {
    const plan = buildStudioActionPlan(seriesId, feedReels);
    return Math.max(plan.recommendations.length, plan.blockers.length, 0);
}

/** @param {string} seriesId @param {Record<string, unknown>[]} [feedReels] */
function countPipelineStageRows(stage) {
    if (typeof window === 'undefined') return 0;
    try {
        const raw = localStorage.getItem(PIPELINE_STORAGE_KEY);
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        return (parsed.rows || []).filter((row) => String(row.stage || '') === stage).length;
    } catch {
        return 0;
    }
}

/** @param {string} seriesId @param {Record<string, unknown>[]} [feedReels] */
function buildWorkflowBlockerMessage(seriesId, feedReels = []) {
    try {
        for (const stage of ['EDITING', 'REVIEW', 'PRODUCTION']) {
            if (countPipelineStageRows(stage) > 0) {
                const label = stage.charAt(0) + stage.slice(1).toLowerCase();
                return `${label} is blocking publication.`;
            }
        }
        const snapshot = buildCommandCenterSnapshot(seriesId, feedReels);
        if (snapshot.workflow.bottleneckCount > 0) {
            return 'Workflow tasks are blocking publication.';
        }
    } catch {
        /* ignore */
    }
    return 'Workflow looks clear — keep tasks moving toward ready.';
}

/** @param {string} seriesId @param {Record<string, unknown>[]} [feedReels] */
function countTeamActionsNeedingAttention(seriesId, feedReels = []) {
    void seriesId;
    void feedReels;
    return getNotifications().filter(
        (item) => !item.read && TEAM_NOTIFICATION_TYPES.has(item.type)
    ).length;
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @returns {CoachingCard[]}
 */
export function buildContextualCoachingCards(seriesId, feedReels = []) {
    const assistant = buildStudioAssistantMission(seriesId, feedReels);

    /** @type {CoachingCard[]} */
    const cards = assistant.insightList.map((insight) => ({
        id: insight.id,
        category: /** @type {CoachingCategory} */ (
            insight.id === 'missing-assets'
                ? 'Coverage'
                : insight.id === 'release-risks'
                  ? 'Workflow'
                  : insight.id === 'what-next' || insight.id === 'fastest-readiness-gain'
                    ? 'Readiness'
                    : 'Notifications'
        ),
        message: insight.summary,
        hint: insight.detail,
        tone: insight.tone,
        actionLabel: insight.actionLabel,
        targetTab: insight.targetTab,
        targetSection: insight.targetSection
    }));

    logGuideMeDiag('GUIDE_ME_CONTEXT', {
        seriesId,
        readinessScore: assistant.currentReadiness,
        mission: assistant.mission.todaysMission,
        insightCount: assistant.insightList.length,
        assistantVersion: '3.0'
    });

    for (const card of cards) {
        logGuideMeDiag('GUIDE_ME_RECOMMENDATION', {
            cardId: card.id,
            category: card.category,
            message: card.message,
            tone: card.tone,
            targetTab: card.targetTab
        });
        logGuideMeDiag('GUIDEME_RECOMMENDATION', {
            cardId: card.id,
            category: card.category,
            message: card.message,
            tone: card.tone,
            targetTab: card.targetTab
        });
    }

    return cards;
}

/** @param {GuideMeSectionGuide} guide @returns {GuideMeTourStep} */
function guideToTourStep(guide) {
    return {
        id: guide.id,
        selector: guide.selector || `[data-guide-me-section="${guide.id}"]`,
        title: guide.title,
        whatIsThis: guide.whatIsThis,
        whyItMatters: guide.whyItMatters,
        whenToUse: guide.whenToUse,
        ifIgnored: guide.ifIgnored,
        doNext: guide.doNext,
        safeUsage: guide.safeUsage,
        productionConsequences: guide.productionConsequences
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @returns {GuideMeTourStep[]}
 */
export function buildGuideMeTourSteps(seriesId, feedReels = []) {
    const assistant = buildStudioAssistantMission(seriesId, feedReels);
    buildContextualCoachingCards(seriesId, feedReels);
    const plan = buildStudioActionPlan(seriesId, feedReels);
    const prioritySectionIds = [];

    if (plan.blockers.length > 0 || assistant.insights.missingAssets.tone !== 'info') {
        prioritySectionIds.push('missingAssetQueue', 'seriesMetadata', 'episodeOperations');
    }
    if (assistant.insights.releaseRisks.tone !== 'info') {
        prioritySectionIds.push('releaseCenter');
    }

    prioritySectionIds.push('readinessMeter', 'overview', 'workflowTasks', 'publishingProfiles');

    /** @type {GuideMeTourStep[]} */
    const steps = [];
    const seen = new Set();
    for (const sectionId of prioritySectionIds) {
        const guide = GUIDE_ME_SECTIONS[sectionId];
        if (!guide || seen.has(sectionId)) continue;
        seen.add(sectionId);
        steps.push(guideToTourStep(guide));
    }

    const tour = steps.slice(0, 6);
    logGuideMeDiag('GUIDE_ME_ACTION', {
        phase: 'tour_built',
        seriesId,
        stepCount: tour.length,
        stepIds: tour.map((step) => step.id),
        blockerCount: plan.blockers.length
    });

    if (tour.length >= 5) return tour;

    return FALLBACK_TOUR_IDS.map((id) => guideToTourStep(GUIDE_ME_SECTIONS[id]));
}

/** @param {string} sectionId */
export function getGuideMeSection(sectionId) {
    return GUIDE_ME_SECTIONS[sectionId] || null;
}

/** @returns {GuideMeSectionGuide[]} */
export function listGuideMeSections() {
    return Object.values(GUIDE_ME_SECTIONS);
}

export function isGuideMeModeEnabled() {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(GUIDE_ME_MODE_KEY) === 'true';
    } catch {
        return false;
    }
}

/** @param {boolean} enabled */
export function setGuideMeModeEnabled(enabled) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(GUIDE_ME_MODE_KEY, enabled ? 'true' : 'false');
    } catch {
        /* ignore */
    }
    document.documentElement.toggleAttribute('data-guide-me-mode', enabled);
    logGuideMeDiag('GUIDE_ME_ACTION', {
        phase: enabled ? 'mode_enabled' : 'mode_disabled',
        enabled
    });
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {typeof WORKSPACE_TABS[number]} [activeTab]
 */
export function emitGuideMePanelContext(seriesId, feedReels = [], activeTab = 'Overview') {
    const assistant = buildStudioAssistantMission(seriesId, feedReels);
    const tabKey = activeTab.toLowerCase();
    const section = GUIDE_ME_SECTIONS[tabKey] || GUIDE_ME_SECTIONS.overview;
    logGuideMeDiag('GUIDE_ME_CONTEXT', {
        seriesId,
        activeTab,
        sectionId: section.id,
        whatIsThis: section.whatIsThis,
        safeUsage: section.safeUsage,
        productionConsequences: section.productionConsequences,
        todaysMission: assistant.mission.todaysMission,
        projectedReadiness: assistant.mission.projectedReadiness.projected
    });
}

export function isGuideMeComplete() {
    if (typeof window === 'undefined') return false;
    try {
        return localStorage.getItem(GUIDE_ME_COMPLETE_KEY) === 'true';
    } catch {
        return false;
    }
}

export function markGuideMeComplete() {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(GUIDE_ME_COMPLETE_KEY, 'true');
    } catch {
        /* ignore */
    }
    logGuideMeDiag('GUIDE_ME_ACTION', { phase: 'coach_complete' });
}

let guideMeInitialized = false;

export function initGuideMeEngine() {
    if (typeof window === 'undefined' || guideMeInitialized) return;
    guideMeInitialized = true;

    setGuideMeModeEnabled(isGuideMeModeEnabled());

    window.__reelforgeGuideMe = {
        GUIDE_ME_ENGINE_VERSION,
        GUIDE_ME_ASSISTANT_MODES,
        GUIDE_ME_ASSISTANT_MODE_IDS,
        GUIDE_ME_SECTIONS,
        WORKSPACE_TABS,
        buildGuideMeOperationalBrief,
        buildContextualCoachingCards,
        buildGuideMeTourSteps,
        buildStudioAssistantMission,
        getGuideMeSection,
        listGuideMeSections,
        isGuideMeModeEnabled,
        setGuideMeModeEnabled,
        loadGuideMeAssistantMode,
        saveGuideMeAssistantMode,
        normalizeGuideMeAssistantMode,
        emitGuideMePanelContext,
        isGuideMeComplete,
        markGuideMeComplete,
        logGuideMeDiag
    };

    logGuideMeDiag('GUIDEME_MISSION', {
        phase: 'engine_initialized',
        version: GUIDE_ME_ENGINE_VERSION,
        modeCount: GUIDE_ME_ASSISTANT_MODES.length
    });
    logGuideMeDiag('GUIDE_ME_CONTEXT', {
        phase: 'engine_initialized',
        sectionCount: Object.keys(GUIDE_ME_SECTIONS).length
    });
}
