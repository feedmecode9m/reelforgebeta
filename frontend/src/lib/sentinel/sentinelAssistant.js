/**
 * Phase 34 — ReelForge Sentinel AI Assistant.
 * Operational intelligence brain aggregating platform, security, production, and team signals.
 */

import { get } from 'svelte/store';
import { postSecurityEvent } from '../api/securityApi.js';
import { runSecurityAudit } from '../security/securityAuditEngine.js';
import { getThreatSnapshot } from '../security/threatDetectionEngine.js';
import { runPlatformAudit } from '../platform/platformAudit.js';
import { getOperationsSnapshot } from '../observability/platformMetrics.js';
import {
    computeProductionReadiness,
    computeSeriesHealth,
    getMissingAssetQueue
} from '../series/productionHealth.js';
import { buildStudioActionPlan } from '../series/actionEngine.js';
import { buildCreatorCopilotBrief, projectCopilotReadiness } from '../copilot/creatorCopilot.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';
import {
    getWorkflowOperationsSnapshot,
    getWorkflowTasksForSeries
} from '../workflow/workflowEngine.js';
import { getNotifications, getUnreadCount } from '../notifications/notificationCenter.js';
import { getOpenTasksForAssignment, TEAM_STORAGE_KEY } from '../teams/creatorTeams.js';
import { buildHeroCommandBrief } from '../hero/heroIntelligence.js';
import { seriesCatalog, getSeriesById } from '../series/seriesStore.js';
import { getEpisodeById } from '../series/seriesStore.js';

export const SENTINEL_ASSISTANT_VERSION = '4.0.0';

/** @typedef {'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'} SentinelRiskLevel */
/** @typedef {'GREEN' | 'YELLOW' | 'ORANGE' | 'RED'} ThreatLevel */

/**
 * @typedef {Object} SentinelIssue
 * @property {string} id
 * @property {string} title
 * @property {string} detail
 * @property {'info' | 'warning' | 'critical'} severity
 * @property {string} domain
 */

/**
 * @typedef {Object} SentinelAction
 * @property {string} title
 * @property {string} detail
 * @property {string} [targetTab]
 * @property {string} [targetSection]
 * @property {number} [impact]
 */

/**
 * @typedef {Object} SentinelMasterAnalysis
 * @property {number} readinessScore
 * @property {number} securityScore
 * @property {ThreatLevel} threatLevel
 * @property {number} publishingScore
 * @property {number} workflowHealth
 * @property {number} teamHealth
 * @property {SentinelIssue[]} topIssues
 * @property {string[]} recommendations
 * @property {string[]} quickWins
 * @property {SentinelIssue[]} blockers
 * @property {SentinelAction[]} nextActions
 * @property {string} summary
 * @property {string} executiveSummary
 * @property {SentinelRiskLevel} riskLevel
 * @property {number} platformHealth
 * @property {{ current: number; projected: number; delta: number; targetReadiness: number }} projectedReadiness
 */

export const SENTINEL_QUESTIONS = /** @type {const} */ ([
    { id: 'fix-next', label: 'What should I do next?' },
    { id: 'readiness-low', label: 'Why is readiness low?' },
    { id: 'blocking-release', label: 'What is blocking release?' },
    { id: 'security-risk', label: 'What is my biggest security risk?' },
    { id: 'series-attention', label: 'Which series needs attention?' },
    { id: 'workflow-stalled', label: 'Which workflow is stalled?' }
]);
/** @type {Record<string, number>} */
const lastSentinelAlertPostedAt = {};
const SENTINEL_ALERT_POST_COOLDOWN_MS = 60_000;

/**
 * @param {'SENTINEL_ANALYSIS' | 'SENTINEL_RECOMMENDATION' | 'SENTINEL_ALERT' | 'SENTINEL_SUMMARY'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logSentinelDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

function maxRiskLevel(levels) {
    const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
    return levels.reduce((max, level) => (rank[level] > rank[max] ? level : max), 'LOW');
}

function riskFromReadiness(score, criticalCount = 0) {
    if (criticalCount > 0 || score < 50) return 'CRITICAL';
    if (score < 70) return 'HIGH';
    if (score < 85) return 'MEDIUM';
    return 'LOW';
}

function topIssuesFrom(issues, limit = 5) {
    const severityRank = { critical: 0, warning: 1, info: 2 };
    return [...issues]
        .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
        .slice(0, limit);
}

/** @param {string | null | undefined} episodeId */
function episodeCode(episodeId) {
    if (!episodeId) return '';
    const ctx = getEpisodeById(episodeId);
    if (!ctx?.episode) return '';
    return `E${String(ctx.episode.episodeNumber).padStart(2, '0')}`;
}

/** @param {string} seriesId */
function probeTeamHealth(seriesId) {
    let memberCount = 0;
    let activityCount = 0;
    let openAssignments = getOpenTasksForAssignment(seriesId).length;

    if (typeof window !== 'undefined') {
        try {
            const raw = localStorage.getItem(TEAM_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                const team =
                    (parsed.teams || []).find((item) => item.seriesId === seriesId) ||
                    (parsed.teams || [])[0];
                if (team?.id) {
                    memberCount = (parsed.members?.[team.id] || []).length;
                    activityCount = (parsed.activity?.[team.id] || []).length;
                }
            }
        } catch {
            /* ignore */
        }
    }

    const score = Math.max(
        0,
        Math.min(100, 40 + memberCount * 10 + Math.min(activityCount, 5) * 8 - openAssignments * 6)
    );

    return { score, memberCount, activityCount, openAssignments };
}

function buildExampleRecommendations(seriesId, feedReels, context) {
    const health = computeSeriesHealth(feedReels, seriesId);
    const series = getSeriesById(seriesId);
    const seriesTitle = series?.title || 'Neon Vengeance';
    const missing = getMissingAssetQueue(feedReels, seriesId);
    const episodeCodes = missing.slice(0, 2).map((row) => episodeCode(row.episodeId)).filter(Boolean);
    const examples = [];
    const projection = context.projection;
    const threatLevel = context.threatLevel;
    const blockers = context.blockers || [];

    if (episodeCodes.length >= 2) {
        examples.push(
            `Upload assets for ${episodeCodes.join(' and ')} to raise readiness from ${projection.current}% to ${projection.projected}%.`
        );
    } else if (health.missingAssets > 0) {
        examples.push(
            `Upload assets for ${health.missingAssets} missing episode${health.missingAssets === 1 ? '' : 's'} to raise readiness from ${projection.current}% to ${projection.projected}%.`
        );
    }

    if (threatLevel !== 'GREEN') {
        examples.push('Security score dropped due to workflow mutation activity.');
    }

    if (blockers.some((item) => item.domain === 'publishing' || item.title.toLowerCase().includes('release'))) {
        examples.push(`Series ${seriesTitle} is blocked by missing scheduled episodes.`);
    }

    const metrics = getOperationsSnapshot(seriesId);
    if ((metrics?.publishingVelocity || 0) < 1) {
        examples.push('Publishing velocity below target.');
    }

    return examples;
}

/**
 * @param {string} [seriesId]
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function analyzePlatform(seriesId = 'series-neon-vengeance', feedReels = []) {
    void runPlatformAudit;
    const catalog = get(seriesCatalog);
    const metrics = getOperationsSnapshot(seriesId);
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const hero = buildHeroCommandBrief(seriesId, feedReels);

    /** @type {SentinelIssue[]} */
    const issues = [];
    if (catalog.length === 0) {
        issues.push({
            id: 'platform-no-catalog',
            title: 'Series catalog empty',
            detail: 'Platform audit reports degraded series store.',
            severity: 'critical',
            domain: 'platform'
        });
    }
    if (readiness.weightedPercent < 85) {
        issues.push({
            id: 'platform-readiness-gap',
            title: 'Platform readiness below target',
            detail: `Weighted readiness is ${readiness.weightedPercent}%.`,
            severity: readiness.weightedPercent < 70 ? 'warning' : 'info',
            domain: 'platform'
        });
    }
    if ((metrics?.studioSessions || 0) === 0) {
        issues.push({
            id: 'platform-low-activity',
            title: 'Limited studio activity telemetry',
            detail: 'Platform metrics show sparse recent studio usage.',
            severity: 'info',
            domain: 'platform'
        });
    }

    const platformHealth = Math.round(
        (readiness.weightedPercent + hero.primary.readinessPercent + (metrics?.studioProductivity || 50)) / 3
    );

    return {
        summary: `Platform health ${platformHealth}% · hero spotlight on ${hero.primary.seriesTitle}.`,
        platformHealth,
        readinessScore: readiness.weightedPercent,
        issues
    };
}

export function analyzeSecurity() {
    const audit =
        typeof window !== 'undefined' && window.__reelforgeSecurityAudit?.runSecurityAudit
            ? window.__reelforgeSecurityAudit.runSecurityAudit({ emitDiagnostics: false })
            : runSecurityAudit({ emitDiagnostics: false });
    const threat = getThreatSnapshot();

    /** @type {SentinelIssue[]} */
    const issues = [];
    for (const finding of audit.findings.slice(0, 5)) {
        issues.push({
            id: finding.id,
            title: finding.title,
            detail: finding.detail || finding.description || finding.title,
            severity: finding.severity === 'Critical' || finding.severity === 'High' ? 'critical' : 'warning',
            domain: 'security'
        });
    }
    for (const active of threat.activeThreats.slice(0, 3)) {
        issues.push({
            id: active.id,
            title: active.title,
            detail: active.detail,
            severity: active.level === 'RED' || active.level === 'ORANGE' ? 'critical' : 'warning',
            domain: 'threat'
        });
    }

    const securityScore = Math.round((audit.score + threat.score) / 2);
    return {
        summary: `Security ${securityScore}/100 · live threat ${threat.level}.`,
        securityScore,
        threatLevel: threat.level,
        issues,
        recommendations: audit.recommendations.slice(0, 4)
    };
}

export function analyzeProduction(seriesId, feedReels = []) {
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const health = computeSeriesHealth(feedReels, seriesId);
    const actionPlan = buildStudioActionPlan(seriesId, feedReels);
    const missing = getMissingAssetQueue(feedReels, seriesId);

    /** @type {SentinelIssue[]} */
    const issues = [];
    /** @type {SentinelIssue[]} */
    const blockers = [];

    if (health.missingAssets > 0) {
        const issue = {
            id: 'production-missing-assets',
            title: `${health.missingAssets} episodes missing assets`,
            detail: 'Asset coverage gaps suppress weighted readiness.',
            severity: 'critical',
            domain: 'production'
        };
        issues.push(issue);
        blockers.push(issue);
    }

    for (const blocker of actionPlan.blockers.slice(0, 3)) {
        const issue = {
            id: blocker.id || `blocker-${blocker.title}`,
            title: blocker.title,
            detail: blocker.description || blocker.title,
            severity: 'critical',
            domain: 'production'
        };
        issues.push(issue);
        blockers.push(issue);
    }

    return {
        summary: `Production readiness ${readiness.weightedPercent}%.`,
        readinessScore: readiness.weightedPercent,
        issues,
        blockers,
        missingQueue: missing,
        quickWins: actionPlan.quickWins.map((item) => item.title),
        nextActions: actionPlan.recommendations.slice(0, 3).map((item) => ({
            title: item.title,
            detail: item.description || item.title,
            targetTab: 'Production',
            targetSection: 'workflowTasks',
            impact: item.impact
        }))
    };
}

export function analyzePublishing(seriesId, feedReels = []) {
    const release = buildReleaseCenterSnapshot(seriesId, feedReels);
    const copilot = buildCreatorCopilotBrief(seriesId, feedReels);
    const metrics = getOperationsSnapshot(seriesId);

    /** @type {SentinelIssue[]} */
    const issues = [];
    if (release.launchReadiness.launchReadinessScore < 80) {
        issues.push({
            id: 'publishing-launch-readiness',
            title: `Launch readiness ${release.launchReadiness.launchReadinessScore}%`,
            detail: `${release.launchReadiness.missingEpisodes} episodes not release-ready.`,
            severity: 'warning',
            domain: 'publishing'
        });
    }
    if ((metrics?.publishingVelocity || 0) < 1) {
        issues.push({
            id: 'publishing-velocity',
            title: 'Publishing velocity below target',
            detail: 'Recent publish actions are below the expected studio cadence.',
            severity: 'warning',
            domain: 'publishing'
        });
    }

    const publishingScore = Math.round(
        (release.launchReadiness.launchReadinessScore + copilot.currentReadiness) / 2
    );

    return {
        summary: `Publishing score ${publishingScore}% · launch readiness ${release.launchReadiness.launchReadinessScore}%.`,
        publishingScore,
        issues,
        recommendations: copilot.recommendedActions.slice(0, 4).map((item) => item.title)
    };
}

export function analyzeWorkflows(seriesId, feedReels = []) {
    const workflow = getWorkflowOperationsSnapshot(seriesId, feedReels);
    const tasks = getWorkflowTasksForSeries(seriesId);
    const openTasks = tasks.filter((task) => task.status !== 'COMPLETE');
    const stalled = openTasks.filter(
        (task) => task.status === 'IN_PROGRESS' && Date.now() - task.createdAt > 86400000
    );
    const unread = getUnreadCount();

    /** @type {SentinelIssue[]} */
    const issues = [];
    for (const task of stalled.slice(0, 3)) {
        issues.push({
            id: `workflow-stalled-${task.id}`,
            title: `Stalled workflow: ${task.title || task.taskType}`,
            detail: 'Task has been in progress for over 24 hours.',
            severity: 'critical',
            domain: 'workflow'
        });
    }
    if (openTasks.length >= 8) {
        issues.push({
            id: 'workflow-open-tasks',
            title: `${openTasks.length} open workflow tasks`,
            detail: `${workflow.pendingCount} pending · ${workflow.inProgressCount} in progress`,
            severity: 'warning',
            domain: 'workflow'
        });
    }
    if (unread >= 5) {
        issues.push({
            id: 'notification-backlog',
            title: `${unread} unread notifications`,
            detail: getNotifications()
                .filter((item) => !item.read)
                .slice(0, 2)
                .map((item) => item.title || item.message)
                .join(' · '),
            severity: 'info',
            domain: 'notifications'
        });
    }

    const workflowHealth = Math.max(
        0,
        Math.min(100, 100 - openTasks.length * 4 - stalled.length * 12 - Math.max(0, unread - 4) * 2)
    );

    return {
        summary:
            stalled.length > 0
                ? `${stalled.length} stalled workflow${stalled.length === 1 ? '' : 's'} detected.`
                : `${openTasks.length} open workflow tasks.`,
        workflowHealth,
        issues,
        nextActions: openTasks.slice(0, 3).map((task) => ({
            title: task.title || task.taskType,
            detail: 'Complete this workflow task to restore momentum.',
            targetTab: 'Production',
            targetSection: 'workflowTasks'
        }))
    };
}

export function analyzeTeams(seriesId, feedReels = []) {
    void feedReels;
    const team = probeTeamHealth(seriesId);

    /** @type {SentinelIssue[]} */
    const issues = [];
    if (team.memberCount === 0) {
        issues.push({
            id: 'team-no-members',
            title: 'No active team members',
            detail: 'Creator team roster is empty for this series.',
            severity: 'warning',
            domain: 'team'
        });
    }
    if (team.openAssignments >= 4) {
        issues.push({
            id: 'team-open-assignments',
            title: `${team.openAssignments} open team assignments`,
            detail: 'Assignments are waiting on owner or editor action.',
            severity: 'warning',
            domain: 'team'
        });
    }

    return {
        summary: `Team health ${team.score}% · ${team.activityCount} recent activities.`,
        teamHealth: team.score,
        issues
    };
}

/**
 * @param {string} [seriesId]
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {{ emitDiagnostics?: boolean }} [options]
 * @returns {SentinelMasterAnalysis}
 */
export function masterAnalysis(seriesId = 'series-neon-vengeance', feedReels = [], options = {}) {
    const emitDiagnostics = options.emitDiagnostics !== false;

    const platform = analyzePlatform(seriesId, feedReels);
    const security = analyzeSecurity();
    const production = analyzeProduction(seriesId, feedReels);
    const publishing = analyzePublishing(seriesId, feedReels);
    const workflows = analyzeWorkflows(seriesId, feedReels);
    const teams = analyzeTeams(seriesId, feedReels);
    const copilot = buildCreatorCopilotBrief(seriesId, feedReels);
    const projection = projectCopilotReadiness(copilot);

    const topIssues = topIssuesFrom(
        [
            ...platform.issues,
            ...security.issues,
            ...production.issues,
            ...publishing.issues,
            ...workflows.issues,
            ...teams.issues
        ],
        5
    );

    const blockers = topIssuesFrom(
        [...production.blockers, ...topIssues.filter((issue) => issue.severity === 'critical')],
        5
    );

    const quickWins = [
        ...copilot.quickWins.map((item) => item.title),
        ...production.quickWins
    ].filter((value, index, list) => list.indexOf(value) === index).slice(0, 5);

    const recommendations = [
        ...buildExampleRecommendations(seriesId, feedReels, {
            projection: {
                current: projection.readinessBefore,
                projected: projection.readinessAfter
            },
            threatLevel: security.threatLevel,
            blockers
        }),
        ...security.recommendations,
        ...publishing.recommendations,
        ...copilot.recommendedActions.map((item) => item.title)
    ].filter((value, index, list) => list.indexOf(value) === index).slice(0, 8);

    const nextActions = [
        ...(production.nextActions || []),
        ...(workflows.nextActions || [])
    ].slice(0, 6);

    const readinessScore = Math.round(
        (platform.readinessScore +
            production.readinessScore +
            publishing.publishingScore +
            workflows.workflowHealth +
            teams.teamHealth) /
            5
    );

    const riskLevel = maxRiskLevel([
        riskFromReadiness(readinessScore, blockers.length),
        security.threatLevel === 'RED'
            ? 'CRITICAL'
            : security.threatLevel === 'ORANGE'
              ? 'HIGH'
              : security.threatLevel === 'YELLOW'
                ? 'MEDIUM'
                : 'LOW'
    ]);

    const executiveSummary = topIssues[0]
        ? `${topIssues[0].title} — ${topIssues[0].detail}`
        : `Platform stable at ${readinessScore}% readiness with no critical alerts.`;

    const summary = `Sentinel master analysis — readiness ${readinessScore}%, security ${security.securityScore}/100, threat ${security.threatLevel}.`;

    const master = {
        readinessScore,
        securityScore: security.securityScore,
        threatLevel: security.threatLevel,
        publishingScore: publishing.publishingScore,
        workflowHealth: workflows.workflowHealth,
        teamHealth: teams.teamHealth,
        topIssues,
        recommendations,
        quickWins,
        blockers,
        nextActions,
        summary,
        executiveSummary,
        riskLevel,
        platformHealth: platform.platformHealth,
        projectedReadiness: {
            current: projection.readinessBefore,
            projected: projection.readinessAfter,
            delta: Math.max(0, projection.readinessAfter - projection.readinessBefore),
            targetReadiness: projection.targetReadiness
        }
    };

    if (emitDiagnostics) {
        logSentinelDiag('SENTINEL_ANALYSIS', {
            readinessScore: master.readinessScore,
            securityScore: master.securityScore,
            threatLevel: master.threatLevel,
            publishingScore: master.publishingScore,
            workflowHealth: master.workflowHealth,
            teamHealth: master.teamHealth,
            issueCount: master.topIssues.length
        });

        for (const recommendation of master.recommendations.slice(0, 5)) {
            logSentinelDiag('SENTINEL_RECOMMENDATION', { recommendation });
        }

        for (const issue of master.topIssues.filter((item) => item.severity !== 'info').slice(0, 4)) {
            logSentinelDiag('SENTINEL_ALERT', {
                id: issue.id,
                title: issue.title,
                severity: issue.severity,
                domain: issue.domain
            });
            const alertKey = `${seriesId}:${issue.id}`;
            const now = Date.now();
            const shouldPost =
                !lastSentinelAlertPostedAt[alertKey] ||
                now - lastSentinelAlertPostedAt[alertKey] >= SENTINEL_ALERT_POST_COOLDOWN_MS;
            if (shouldPost) {
                lastSentinelAlertPostedAt[alertKey] = now;
                void postSecurityEvent({
                    id: `sentinel-alert-${seriesId}-${issue.id}`,
                    source: 'sentinel_assistant',
                    eventType: 'sentinel_alert',
                    category: issue.domain || 'sentinel',
                    severity:
                        issue.severity === 'critical'
                            ? 'RED'
                            : issue.severity === 'warning'
                              ? 'ORANGE'
                              : 'YELLOW',
                    title: issue.title,
                    message: issue.detail,
                    seriesId,
                    payload: {
                        issueId: issue.id,
                        riskLevel: master.riskLevel,
                        threatLevel: master.threatLevel
                    }
                });
            }
        }

        logSentinelDiag('SENTINEL_SUMMARY', {
            executiveSummary: master.executiveSummary,
            riskLevel: master.riskLevel,
            nextAction: master.nextActions[0]?.title || null,
            quickWin: master.quickWins[0] || null,
            blocker: master.blockers[0]?.title || null
        });
    }

    return master;
}

/** Backward-compatible alias. */
export function buildSentinelAnalysis(seriesId, feedReels = [], options = {}) {
    const master = masterAnalysis(seriesId, feedReels, options);
    return {
        summary: master.summary,
        riskLevel: master.riskLevel,
        readinessScore: master.readinessScore,
        topIssues: master.topIssues,
        recommendations: master.recommendations,
        nextActions: master.nextActions
    };
}

/** Backward-compatible alias. */
export function analyzeWorkflow(seriesId, feedReels = []) {
    const result = analyzeWorkflows(seriesId, feedReels);
    return {
        summary: result.summary,
        riskLevel: result.workflowHealth < 60 ? 'HIGH' : result.workflowHealth < 80 ? 'MEDIUM' : 'LOW',
        readinessScore: result.workflowHealth,
        topIssues: result.issues,
        recommendations: [],
        nextActions: result.nextActions || []
    };
}

/** @param {SentinelMasterAnalysis} master */
export function getSentinelGuideMeOverlay(master) {
    return {
        biggestBlocker:
            master.blockers[0]?.title ||
            master.topIssues.find((issue) => issue.severity === 'critical')?.title ||
            'No critical blockers detected',
        biggestQuickWin: master.quickWins[0] || 'Complete a small metadata fix for a quick readiness gain',
        highestImpactAction: master.nextActions[0] || {
            title: master.recommendations[0] || 'Review production overview',
            detail: master.executiveSummary,
            targetTab: 'Overview',
            targetSection: 'readinessMeter',
            impact: master.projectedReadiness.delta
        }
    };
}

export function askSentinel(questionId, seriesId = 'series-neon-vengeance', feedReels = []) {
    const question = SENTINEL_QUESTIONS.find((item) => item.id === questionId);
    const master = masterAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    const overlay = getSentinelGuideMeOverlay(master);

    let answer = master.executiveSummary;
    if (questionId === 'fix-next') {
        answer = `${overlay.highestImpactAction.title} — ${overlay.highestImpactAction.detail}`;
    } else if (questionId === 'readiness-low') {
        answer = analyzeProduction(seriesId, feedReels).summary;
    } else if (questionId === 'blocking-release') {
        answer = master.recommendations.find((item) => /blocked|release|schedule/i.test(item)) || master.executiveSummary;
    } else if (questionId === 'security-risk') {
        answer = analyzeSecurity().summary;
    } else if (questionId === 'series-attention') {
        const series = getSeriesById(seriesId);
        answer = `${series?.title || 'Active series'} readiness ${master.readinessScore}% with ${master.blockers.length} blockers.`;
    } else if (questionId === 'workflow-stalled') {
        answer = analyzeWorkflows(seriesId, feedReels).summary;
    }

    logSentinelDiag('SENTINEL_RECOMMENDATION', {
        questionId,
        question: question?.label || questionId,
        answer
    });

    return { questionId, question: question?.label || questionId, answer, analysis: master };
}

export function buildSentinelReports(seriesId = 'series-neon-vengeance', feedReels = []) {
    const master = masterAnalysis(seriesId, feedReels, { emitDiagnostics: false });

    return {
        analysisReport: {
            version: SENTINEL_ASSISTANT_VERSION,
            seriesId,
            generatedAt: Date.now(),
            ...master,
            domains: {
                platform: analyzePlatform(seriesId, feedReels).summary,
                security: analyzeSecurity().summary,
                production: analyzeProduction(seriesId, feedReels).summary,
                publishing: analyzePublishing(seriesId, feedReels).summary,
                workflows: analyzeWorkflows(seriesId, feedReels).summary,
                teams: analyzeTeams(seriesId, feedReels).summary
            }
        },
        recommendationsReport: {
            version: SENTINEL_ASSISTANT_VERSION,
            seriesId,
            generatedAt: Date.now(),
            recommendations: master.recommendations,
            quickWins: master.quickWins,
            blockers: master.blockers.map((item) => item.title),
            nextActions: master.nextActions,
            guideMeOverlay: getSentinelGuideMeOverlay(master),
            questions: SENTINEL_QUESTIONS.map((item) => ({
                id: item.id,
                label: item.label,
                sampleAnswer: askSentinel(item.id, seriesId, feedReels).answer
            }))
        }
    };
}

let sentinelAssistantInitialized = false;

export function initSentinelAssistant(options = {}) {
    if (typeof window === 'undefined' || sentinelAssistantInitialized) return null;
    sentinelAssistantInitialized = true;

    window.__reelforgeSentinel = {
        SENTINEL_ASSISTANT_VERSION,
        SENTINEL_QUESTIONS,
        analyzePlatform,
        analyzeSecurity,
        analyzeProduction,
        analyzePublishing,
        analyzeWorkflows,
        analyzeWorkflow,
        analyzeTeams,
        masterAnalysis,
        buildSentinelAnalysis,
        getSentinelGuideMeOverlay,
        askSentinel,
        buildSentinelReports,
        logSentinelDiag
    };

    logSentinelDiag('SENTINEL_ANALYSIS', {
        phase: 'engine_initialized',
        version: SENTINEL_ASSISTANT_VERSION,
        seriesId: options.seriesId || 'series-neon-vengeance'
    });

    return masterAnalysis(options.seriesId, options.feedReels, { emitDiagnostics: false });
}
