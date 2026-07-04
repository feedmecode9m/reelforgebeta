/**
 * Phase 28 — Production Command Center aggregator.
 * Composes existing readiness, workflow, release, team, notification, and repair systems.
 */

import { computeProductionReadiness, computeSeriesHealth } from '../series/productionHealth.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';
import { getWorkflowOperationsSnapshot, syncWorkflowTasks } from '../workflow/workflowEngine.js';
import { buildRepairPlan } from '../series/studioRepairEngine.js';
import { getUnreadCount, getNotifications } from '../notifications/notificationCenter.js';
import { getOperationsSnapshot } from '../observability/platformMetrics.js';
import { TEAM_STORAGE_KEY } from '../teams/creatorTeams.js';
import { buildStudioActionPlan } from '../series/actionEngine.js';
import { buildCreatorCopilotBrief } from '../copilot/creatorCopilot.js';
import { masterAnalysis } from '../sentinel/sentinelAssistant.js';
import { buildHeroCommandBrief } from '../hero/heroIntelligence.js';

export const COMMAND_SECTIONS = /** @type {const} */ ([
    'Production',
    'Content',
    'Teams',
    'Analytics',
    'Automation',
    'System'
]);

export const COMMAND_STATUS_SECTIONS = /** @type {const} */ ([
    'Mission Status',
    'Series Status',
    'Workflow Status',
    'Publishing Status',
    'Team Status',
    'System Status'
]);

/** Phase 37 — single-pane dashboard sections */
export const COMMAND_DASHBOARD_SECTIONS = /** @type {const} */ ([
    { id: 'executive-overview', title: 'Executive Overview' },
    { id: 'security', title: 'Security' },
    { id: 'production', title: 'Production' },
    { id: 'publishing', title: 'Publishing' },
    { id: 'teams', title: 'Teams' },
    { id: 'revenue', title: 'Revenue' }
]);

/**
 * @typedef {Object} TodaysFocusItem
 * @property {string} id
 * @property {string} label
 * @property {string} [detail]
 * @property {string} [category]
 */

/**
 * @typedef {Object} CommandStatusSection
 * @property {string} id
 * @property {typeof COMMAND_STATUS_SECTIONS[number]} title
 * @property {string} headline
 * @property {string} detail
 * @property {string} [metric]
 */

/**
 * @typedef {Object} ProductionRisk
 * @property {string} id
 * @property {string} label
 * @property {string} severity
 * @property {string} [source]
 */

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
export function logCommandCenterDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {string} seriesId */
function getCachedTeamActivity(seriesId) {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(TEAM_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        const team = (parsed.teams || []).find(
            (item) => item.seriesId === seriesId || String(item.id || '').includes(seriesId)
        );
        if (!team) return [];
        return parsed.activity?.[team.id] || [];
    } catch {
        return [];
    }
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function buildCommandCenterSnapshot(seriesId, feedReels = []) {
    const health = computeSeriesHealth(feedReels, seriesId);
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const workflowSync = syncWorkflowTasks(seriesId, feedReels);
    const workflow = getWorkflowOperationsSnapshot(seriesId, feedReels);
    const release = buildReleaseCenterSnapshot(seriesId, feedReels);
    const repair = buildRepairPlan(seriesId, feedReels);
    const teamActivity = getCachedTeamActivity(seriesId);
    const analytics = getOperationsSnapshot(seriesId);
    const notifications = getNotifications();

    const openTasks = workflowSync.tasks.filter((task) => task.status !== 'COMPLETE');
    const bottlenecks = openTasks.filter((task) => task.taskType === 'MISSING_ASSET');
    const activeReleases = (release.calendar || []).filter(
        (entry) => entry.status === 'scheduled' || entry.status === 'ready'
    );

    return {
        seriesId,
        section: 'overview',
        readiness: {
            score: readiness.weightedPercent,
            metadata: readiness.metadata,
            assets: readiness.assets,
            publishing: readiness.publishing,
            releaseSchedule: readiness.releaseSchedule
        },
        health: {
            overallReadinessScore: health.overallReadinessScore,
            assetCoverage: health.assetCoverage,
            missingAssets: health.missingAssets,
            publishedEpisodes: health.publishedEpisodes,
            totalEpisodes: health.totalEpisodes
        },
        workflow: {
            openTaskCount: workflow.openTaskCount,
            pendingCount: workflow.pendingCount,
            inProgressCount: workflow.inProgressCount,
            projectedReadiness: workflow.projectedReadiness,
            bottleneckCount: bottlenecks.length,
            bottlenecks: bottlenecks.slice(0, 5).map((task) => ({
                id: task.id,
                title: task.title || task.id,
                taskType: task.taskType,
                priority: task.priority
            }))
        },
        releases: {
            activeCount: activeReleases.length,
            scheduledCount: activeReleases.filter((entry) => entry.status === 'scheduled').length,
            premiereDays: release.premiereCountdown?.days ?? null,
            entries: activeReleases.slice(0, 5).map((entry) => ({
                episodeId: entry.episodeId,
                title: entry.episodeTitle,
                status: entry.status,
                releaseDate: entry.releaseDate
            }))
        },
        team: {
            activityCount: teamActivity.length,
            recentActivity: teamActivity.slice(0, 5).map((item) => ({
                type: item.activityType || item.activity_type,
                user: item.displayName || item.display_name || 'System'
            }))
        },
        notifications: {
            unreadCount: getUnreadCount(),
            recent: notifications.slice(0, 5).map((item) => ({
                id: item.id,
                type: item.type,
                message: item.message,
                read: item.read
            }))
        },
        repair: {
            suggestionCount: repair.repairableCount,
            issueCount: repair.issues.length,
            suggestions: repair.repairPlan.slice(0, 5).map((item) => ({
                id: item.id,
                label: item.label,
                severity: item.severity
            }))
        },
        analytics: {
            dailyActiveViewers: analytics.dailyActiveViewers,
            publishingVelocity: analytics.publishingVelocity,
            studioProductivity: analytics.studioProductivity
        },
        generatedAt: Date.now()
    };
}

/** @param {import('../series/actionEngine.js').StudioRecommendation} rec */
function recommendationToFocusLabel(rec) {
    const title = rec.title || 'Complete next production step';
    switch (rec.actionType) {
        case 'missing-asset':
            return title.includes('Attach') ? title.replace(/^Attach reel to /i, 'Upload ') : `Upload ${title}`;
        case 'unscheduled-episode':
            return 'Schedule Release';
        case 'unpublished-episode':
            return title.startsWith('Publish') ? title : `Publish ${title}`;
        case 'missing-metadata':
            return title;
        default:
            return title;
    }
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @returns {TodaysFocusItem[]}
 */
export function buildTodaysFocus(seriesId, feedReels = []) {
    const actionPlan = buildStudioActionPlan(seriesId, feedReels);
    const copilot = buildCreatorCopilotBrief(seriesId, feedReels);
    /** @type {TodaysFocusItem[]} */
    const items = [];

    for (const rec of actionPlan.recommendations.slice(0, 2)) {
        items.push({
            id: `focus-${rec.id}`,
            label: recommendationToFocusLabel(rec),
            detail: rec.description,
            category: rec.actionType
        });
    }

    const needsReviewer = copilot.analysis.workflow.openTasks > 0 && copilot.analysis.workflow.inProgressTasks === 0;
    if (needsReviewer && items.length < 3) {
        items.push({
            id: 'focus-assign-reviewer',
            label: 'Assign Reviewer',
            detail: 'Move review tasks to a teammate so publishing can continue.',
            category: 'team'
        });
    }

    if (copilot.analysis.release.episodesReady > 0 && !items.some((item) => item.label === 'Schedule Release')) {
        items.push({
            id: 'focus-schedule-release',
            label: 'Schedule Release',
            detail: 'Set a release date for ready episodes.',
            category: 'release'
        });
    }

    const focus = items.slice(0, 3);
    if (focus.length === 0) {
        focus.push({
            id: 'focus-monitor',
            label: 'Monitor readiness',
            detail: 'Production is on track — review analytics before the next drop.',
            category: 'mission'
        });
    }

    return focus;
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @returns {ProductionRisk[]}
 */
export function buildProductionRisks(seriesId, feedReels = []) {
    const snapshot = buildCommandCenterSnapshot(seriesId, feedReels);
    const copilot = buildCreatorCopilotBrief(seriesId, feedReels);
    /** @type {ProductionRisk[]} */
    const risks = [];

    for (const risk of copilot.criticalRisks.slice(0, 3)) {
        risks.push({
            id: `copilot-${risk.id}`,
            label: risk.title,
            severity: risk.priority,
            source: 'copilot'
        });
    }

    for (const suggestion of snapshot.repair.suggestions.slice(0, 3)) {
        risks.push({
            id: `repair-${suggestion.id}`,
            label: suggestion.label,
            severity: suggestion.severity || 'MEDIUM',
            source: 'repair'
        });
    }

    const seen = new Set();
    return risks.filter((risk) => {
        if (seen.has(risk.label)) return false;
        seen.add(risk.label);
        return true;
    }).slice(0, 5);
}

/**
 * @param {ReturnType<typeof buildCommandCenterSnapshot>} snapshot
 * @param {TodaysFocusItem[]} todaysFocus
 * @param {ProductionRisk[]} productionRisks
 * @returns {CommandStatusSection[]}
 */
export function buildCommandStatusSections(snapshot, todaysFocus, productionRisks) {
    const focusPreview = todaysFocus.map((item) => item.label).join(' · ') || 'Stay on mission';

    return [
        {
            id: 'mission',
            title: 'Mission Status',
            headline: `${snapshot.readiness.score}% readiness`,
            detail: focusPreview,
            metric: `${todaysFocus.length} focus items`
        },
        {
            id: 'series',
            title: 'Series Status',
            headline: `${snapshot.health.assetCoverage}% coverage`,
            detail: `${snapshot.health.publishedEpisodes} published · ${snapshot.health.missingAssets} missing assets`,
            metric: `${snapshot.health.totalEpisodes} episodes`
        },
        {
            id: 'workflow',
            title: 'Workflow Status',
            headline: `${snapshot.workflow.bottleneckCount} bottlenecks`,
            detail: `${snapshot.workflow.openTaskCount} open tasks · ${snapshot.workflow.inProgressCount} in progress`,
            metric: `${snapshot.workflow.projectedReadiness}% projected`
        },
        {
            id: 'publishing',
            title: 'Publishing Status',
            headline: `${snapshot.releases.activeCount} active releases`,
            detail:
                snapshot.releases.premiereDays != null
                    ? `Premiere in ${snapshot.releases.premiereDays} day${snapshot.releases.premiereDays === 1 ? '' : 's'}`
                    : `${snapshot.releases.scheduledCount} scheduled`,
            metric: `${snapshot.readiness.publishing}% publishing readiness`
        },
        {
            id: 'team',
            title: 'Team Status',
            headline: `${snapshot.team.activityCount} recent events`,
            detail:
                snapshot.team.recentActivity[0]
                    ? `${snapshot.team.recentActivity[0].user} · ${snapshot.team.recentActivity[0].type}`
                    : 'No recent team activity',
            metric: `${snapshot.workflow.pendingCount} pending handoffs`
        },
        {
            id: 'system',
            title: 'System Status',
            headline: `${snapshot.notifications.unreadCount} unread alerts`,
            detail: `${productionRisks.length} production risks · ${snapshot.repair.suggestionCount} repair suggestions`,
            metric: `${snapshot.repair.issueCount} tracked issues`
        }
    ];
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function buildCommandCenterBrief(seriesId, feedReels = []) {
    const snapshot = buildCommandCenterSnapshot(seriesId, feedReels);
    const todaysFocus = buildTodaysFocus(seriesId, feedReels);
    const productionRisks = buildProductionRisks(seriesId, feedReels);
    const statusSections = buildCommandStatusSections(snapshot, todaysFocus, productionRisks);

    return {
        snapshot,
        todaysFocus,
        productionRisks,
        statusSections
    };
}

/**
 * Phase 37 — platform-wide operational brief for Production Command Center.
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function buildPlatformOperationsBrief(seriesId, feedReels = []) {
    const brief = buildCommandCenterBrief(seriesId, feedReels);
    const sentinel = masterAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    const hero = buildHeroCommandBrief(seriesId, feedReels);
    const operations = getOperationsSnapshot(seriesId);

    /** @type {{ id: string; title: string; severity: string; source?: string; detail?: string }[]} */
    const topRisks = [];
    const seenRisks = new Set();

    for (const risk of brief.productionRisks) {
        if (seenRisks.has(risk.label)) continue;
        seenRisks.add(risk.label);
        topRisks.push({
            id: risk.id,
            title: risk.label,
            severity: risk.severity,
            source: risk.source,
            detail: risk.label
        });
    }

    for (const issue of sentinel.topIssues) {
        if (seenRisks.has(issue.title)) continue;
        seenRisks.add(issue.title);
        topRisks.push({
            id: issue.id || `sentinel-${topRisks.length}`,
            title: issue.title,
            severity: issue.severity || 'MEDIUM',
            source: 'sentinel',
            detail: issue.detail
        });
    }

    const recommendedActions = sentinel.nextActions.slice(0, 4);
    if (recommendedActions.length === 0) {
        for (const [index, recommendation] of sentinel.recommendations.slice(0, 4).entries()) {
            recommendedActions.push({
                id: `rec-${index}`,
                title: recommendation,
                detail: recommendation,
                targetTab: 'Overview',
                impact: 0
            });
        }
    }

    const dashboardSections = [
        {
            id: 'executive-overview',
            title: 'Executive Overview',
            headline: `${sentinel.readinessScore}% platform readiness`,
            detail: sentinel.executiveSummary,
            metric: `${brief.todaysFocus.length} focus items`
        },
        {
            id: 'security',
            title: 'Security',
            headline: `${sentinel.securityScore}/100 security score`,
            detail: `Live threat level ${sentinel.threatLevel}`,
            metric: `${sentinel.topIssues.filter((issue) => issue.source === 'security').length} security signals`
        },
        {
            id: 'production',
            title: 'Production',
            headline: `${brief.snapshot.readiness.score}% series readiness`,
            detail: `${brief.snapshot.workflow.openTaskCount} open tasks · ${brief.snapshot.workflow.bottleneckCount} bottlenecks`,
            metric: `${sentinel.workflowHealth}% workflow health`
        },
        {
            id: 'publishing',
            title: 'Publishing',
            headline: `${sentinel.publishingScore}% publishing health`,
            detail: `${brief.snapshot.releases.activeCount} active releases · ${brief.snapshot.readiness.publishing}% publishing readiness`,
            metric:
                brief.snapshot.releases.premiereDays != null
                    ? `Premiere in ${brief.snapshot.releases.premiereDays}d`
                    : `${brief.snapshot.releases.scheduledCount} scheduled`
        },
        {
            id: 'teams',
            title: 'Teams',
            headline: `${sentinel.teamHealth}% team health`,
            detail:
                brief.snapshot.team.recentActivity[0]
                    ? `${brief.snapshot.team.recentActivity[0].user} · ${brief.snapshot.team.recentActivity[0].type}`
                    : `${brief.snapshot.team.activityCount} recent events`,
            metric: `${brief.snapshot.notifications.unreadCount} unread notifications`
        },
        {
            id: 'revenue',
            title: 'Revenue',
            headline: 'Executive revenue dashboard',
            detail: 'MRR, ARR, series revenue, per-episode/creator/team KPIs, and forecast horizons.',
            metric: 'Live revenue KPIs'
        },
        {
            id: 'marketplace',
            title: 'Marketplace',
            headline: 'Creator marketplace listings',
            detail: 'Browse services, create listings, manage gigs, and track marketplace activity.',
            metric: 'Live marketplace CRUD'
        },
        {
            id: 'enterprise',
            title: 'Enterprise',
            headline: 'Studio organization hierarchy',
            detail: 'Organizations, studios, departments, teams, series, creators, and enterprise roles.',
            metric: 'Organization health'
        },
        {
            id: 'reports',
            title: 'Reports',
            headline: 'Executive reporting engine',
            detail: 'Daily, weekly, monthly, and quarterly reports across production, publishing, revenue, security, teams, and marketplace.',
            metric: 'Auto-generated summaries'
        }
    ];

    return {
        ...brief,
        sentinel,
        hero,
        operations,
        readinessScore: sentinel.readinessScore,
        securityScore: sentinel.securityScore,
        threatLevel: sentinel.threatLevel,
        teamHealth: sentinel.teamHealth,
        workflowHealth: sentinel.workflowHealth,
        publishingHealth: sentinel.publishingScore,
        notifications: brief.snapshot.notifications,
        topRisks: topRisks.slice(0, 5),
        recommendedActions: recommendedActions.slice(0, 5),
        dashboardSections
    };
}

/**
 * @param {'load' | 'refresh'} phase
 * @param {string} seriesId
 * @param {ReturnType<typeof buildCommandCenterBrief>} brief
 * @param {Record<string, unknown>} [extra]
 */
export function emitCommandCenterDiagnostics(phase, seriesId, brief, extra = {}) {
    const platformBrief = brief.dashboardSections ? brief : buildPlatformOperationsBrief(seriesId, extra.feedReels || []);
    const payload = {
        seriesId,
        readinessScore: platformBrief.readinessScore ?? brief.snapshot.readiness.score,
        securityScore: platformBrief.securityScore,
        threatLevel: platformBrief.threatLevel,
        teamHealth: platformBrief.teamHealth,
        workflowHealth: platformBrief.workflowHealth,
        publishingHealth: platformBrief.publishingHealth,
        activeReleases: brief.snapshot.releases.activeCount,
        bottleneckCount: brief.snapshot.workflow.bottleneckCount,
        unreadNotifications: brief.snapshot.notifications.unreadCount,
        productionRiskCount: brief.productionRisks.length,
        topRiskCount: platformBrief.topRisks?.length ?? brief.productionRisks.length,
        recommendedActionCount: platformBrief.recommendedActions?.length ?? 0,
        repairSuggestions: brief.snapshot.repair.suggestionCount,
        focusCount: brief.todaysFocus.length,
        statusSectionCount: brief.statusSections.length,
        dashboardSectionCount: platformBrief.dashboardSections?.length ?? COMMAND_DASHBOARD_SECTIONS.length,
        heroSeries: platformBrief.hero?.primary?.seriesTitle,
        operationsViewers: platformBrief.operations?.dailyActiveViewers,
        ...extra
    };

    logCommandCenterDiag('COMMAND_CENTER', { phase, ...payload });

    if (phase === 'load') {
        logCommandCenterDiag('COMMAND_CENTER_LOAD', { phase, ...payload });
    }
    logCommandCenterDiag('COMMAND_CENTER_REFRESH', { phase, ...payload });
}

let commandCenterInitialized = false;

export function initCommandCenter() {
    if (typeof window === 'undefined' || commandCenterInitialized) return;
    commandCenterInitialized = true;

    window.__reelforgeCommandCenter = {
        COMMAND_SECTIONS,
        COMMAND_STATUS_SECTIONS,
        COMMAND_DASHBOARD_SECTIONS,
        buildCommandCenterSnapshot,
        buildCommandCenterBrief,
        buildPlatformOperationsBrief,
        buildTodaysFocus,
        buildProductionRisks,
        buildCommandStatusSections,
        emitCommandCenterDiagnostics,
        logCommandCenterDiag
    };
}
