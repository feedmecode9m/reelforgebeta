/**
 * Phase 43 — Security Operations Center.
 * Aggregates audit, threat detection, Sentinel, and platform metrics into a unified SOC brief.
 */

import { getOperationsSnapshot } from '../observability/platformMetrics.js';
import { postSecurityEvent } from '../api/securityApi.js';
import { masterAnalysis } from '../sentinel/sentinelAssistant.js';
import { runSecurityAudit } from './securityAuditEngine.js';
import {
    analyzeThreats,
    loadSecurityEvents,
    getThreatSnapshot
} from './threatDetectionEngine.js';
import { logSocDiag } from './securityOperationsDiagnostics.js';

export const SOC_VERSION = '1.0.0';

export const SOC_DASHBOARD_SECTIONS = /** @type {const} */ ([
    { id: 'threat-timeline', title: 'Threat Timeline' },
    { id: 'active-incidents', title: 'Active Incidents' },
    { id: 'threat-map', title: 'Threat Map' },
    { id: 'recent-security-events', title: 'Recent Security Events' },
    { id: 'attack-surface-overview', title: 'Attack Surface Overview' },
    { id: 'security-audit-results', title: 'Security Audit Results' },
    { id: 'platform-security-score', title: 'Platform Security Score' },
    { id: 'recommended-actions', title: 'Recommended Actions' }
]);

/** @typedef {'GREEN' | 'YELLOW' | 'ORANGE' | 'RED'} ThreatLevel */

/**
 * @param {ThreatLevel} level
 */
function severityFromThreatLevel(level) {
    if (level === 'RED') return 'critical';
    if (level === 'ORANGE') return 'high';
    if (level === 'YELLOW') return 'medium';
    return 'low';
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {{ emitDiagnostics?: boolean }} [options]
 */
export function buildSecurityOperationsBrief(seriesId = 'series-neon-vengeance', feedReels = [], options = {}) {
    const audit =
        typeof window !== 'undefined' && window.__reelforgeSecurityAudit?.runSecurityAudit
            ? window.__reelforgeSecurityAudit.runSecurityAudit({ emitDiagnostics: false })
            : runSecurityAudit({ emitDiagnostics: false });
    const threat = analyzeThreats({ emitDiagnostics: false });
    const sentinel = masterAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    const operations = getOperationsSnapshot(seriesId);
    const events = loadSecurityEvents().events.slice(-40);

    const threatTimeline = events
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 12)
        .map((event) => ({
            id: event.id,
            category: event.category,
            type: event.type,
            timestamp: event.timestamp,
            label: `${event.category} · ${event.type}`,
            detail: JSON.stringify(event.detail || {}).slice(0, 120)
        }));

    const activeIncidents = threat.activeThreats.map((item) => ({
        id: item.id,
        category: item.category,
        level: item.level,
        title: item.title,
        detail: item.detail,
        recommendedAction: item.recommendedAction,
        count: item.count,
        severity: severityFromThreatLevel(item.level)
    }));

    const threatMap = Object.entries(threat.categoryCounts).map(([category, count]) => {
        const zoneThreat = threat.activeThreats.find((item) => item.category === category);
        return {
            category,
            count,
            level: zoneThreat?.level || (count > 0 ? 'YELLOW' : 'GREEN'),
            label: category.charAt(0).toUpperCase() + category.slice(1)
        };
    });

    const recentSecurityEvents = events
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 8)
        .map((event) => ({
            id: event.id,
            category: event.category,
            type: event.type,
            timestamp: event.timestamp
        }));

    const auditedRoutes = audit.riskReport?.auditedRoutes || {};
    const routeCount = Object.values(auditedRoutes).reduce(
        (sum, routes) => sum + (Array.isArray(routes) ? routes.length : 0),
        0
    );

    const attackSurfaceOverview = {
        domainCount: audit.domains.length,
        routeCount,
        failingDomains: audit.domains.filter((domain) => domain.score < 75).map((domain) => domain.label),
        exposure: audit.riskReport?.apiExposure || {},
        categories: audit.categories,
        studioActivity: operations.studioProductivity,
        publishingVelocity: operations.publishingVelocity
    };

    const securityAuditResults = {
        score: audit.score,
        grade: audit.scoreReport?.grade || 'Moderate',
        findingCount: audit.findings.length,
        topFindings: audit.findings.slice(0, 5).map((finding) => ({
            id: finding.id,
            severity: finding.severity,
            title: finding.title,
            domain: finding.domain
        })),
        recommendations: audit.recommendations.slice(0, 5)
    };

    const platformSecurityScore = {
        combinedScore: Math.round((audit.score + threat.score + sentinel.securityScore) / 3),
        auditScore: audit.score,
        threatScore: threat.score,
        sentinelScore: sentinel.securityScore,
        threatLevel: threat.level,
        readinessScore: sentinel.readinessScore,
        grade:
            audit.score >= 85 && threat.score >= 85
                ? 'Strong'
                : audit.score >= 70 && threat.score >= 70
                  ? 'Moderate'
                  : 'Elevated'
    };

    const recommendedActions = [
        threat.recommendedAction,
        ...audit.recommendations.slice(0, 3),
        ...sentinel.recommendations.filter((item) => /security|threat|audit|auth|permission/i.test(item)).slice(0, 2),
        sentinel.executiveSummary
    ]
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index)
        .slice(0, 6)
        .map((action, index) => ({
            id: `soc-action-${index + 1}`,
            title: action.length > 72 ? `${action.slice(0, 69)}...` : action,
            detail: action
        }));

    const brief = {
        seriesId,
        generatedAt: Date.now(),
        platformSecurityScore,
        threatLevel: threat.level,
        sections: {
            threatTimeline,
            activeIncidents,
            threatMap,
            recentSecurityEvents,
            attackSurfaceOverview,
            securityAuditResults,
            platformSecurityScore,
            recommendedActions
        },
        sources: {
            securityAuditEngine: audit.score,
            threatDetectionEngine: threat.score,
            sentinelAssistant: sentinel.securityScore,
            platformMetrics: operations.generatedAt
        }
    };

    if (options.emitDiagnostics !== false) {
        emitSecurityOperationsDiagnostics('refresh', brief);
    }

    return brief;
}

/**
 * @param {'load' | 'refresh'} phase
 * @param {ReturnType<typeof buildSecurityOperationsBrief>} brief
 */
export function emitSecurityOperationsDiagnostics(phase, brief) {
    logSocDiag('SOC_SCORE', {
        phase,
        seriesId: brief.seriesId,
        combinedScore: brief.platformSecurityScore.combinedScore,
        auditScore: brief.platformSecurityScore.auditScore,
        threatScore: brief.platformSecurityScore.threatScore,
        sentinelScore: brief.platformSecurityScore.sentinelScore,
        threatLevel: brief.threatLevel
    });

    for (const entry of brief.sections.threatTimeline.slice(0, 6)) {
        logSocDiag('SOC_TIMELINE', {
            phase,
            seriesId: brief.seriesId,
            id: entry.id,
            category: entry.category,
            type: entry.type,
            timestamp: entry.timestamp
        });
    }

    for (const incident of brief.sections.activeIncidents.slice(0, 4)) {
        logSocDiag('SECURITY_INCIDENT', {
            phase,
            seriesId: brief.seriesId,
            id: incident.id,
            level: incident.level,
            category: incident.category,
            title: incident.title
        });
        void postSecurityEvent({
            id: `soc-incident-${brief.seriesId}-${incident.id}-${phase}`,
            source: 'security_operations_center',
            eventType: 'security_incident',
            category: incident.category || 'soc',
            severity: incident.level || incident.severity || 'YELLOW',
            title: incident.title,
            message: incident.detail,
            seriesId: brief.seriesId,
            payload: {
                phase,
                incidentId: incident.id,
                count: incident.count
            }
        });
    }

    for (const action of brief.sections.recommendedActions.slice(0, 3)) {
        logSocDiag('SOC_ALERT', {
            phase,
            seriesId: brief.seriesId,
            id: action.id,
            title: action.title
        });
        void postSecurityEvent({
            id: `soc-alert-${brief.seriesId}-${action.id}-${phase}`,
            source: 'security_operations_center',
            eventType: 'soc_alert',
            category: 'soc',
            severity: brief.threatLevel,
            title: action.title,
            message: action.detail,
            seriesId: brief.seriesId,
            payload: {
                phase,
                actionId: action.id
            }
        });
    }
}

let socInitialized = false;

export function initSecurityOperationsCenter() {
    if (typeof window === 'undefined' || socInitialized) return;
    socInitialized = true;

    window.__reelforgeSecurityOperationsCenter = {
        SOC_VERSION,
        SOC_DASHBOARD_SECTIONS,
        buildSecurityOperationsBrief,
        emitSecurityOperationsDiagnostics,
        getThreatSnapshot,
        logSocDiag
    };

    logSocDiag('SOC_SCORE', {
        phase: 'engine_initialized',
        version: SOC_VERSION,
        sectionCount: SOC_DASHBOARD_SECTIONS.length
    });
}
