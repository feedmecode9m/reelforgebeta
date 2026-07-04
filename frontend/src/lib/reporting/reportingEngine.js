/**
 * Phase 46 — Enterprise Reporting Engine.
 * Automatic executive reports across production, publishing, revenue, security, teams, and marketplace.
 */

import { computeProductionReadiness, computeSeriesHealth } from '../series/productionHealth.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';
import { buildRevenueDashboardBrief } from '../revenue/revenueCore.js';
import { buildSecurityOperationsBrief } from '../security/securityOperationsCenter.js';
import { getWorkflowOperationsSnapshot } from '../workflow/workflowEngine.js';
import { TEAM_STORAGE_KEY } from '../teams/creatorTeams.js';
import { loadMarketplaceStore } from '../marketplace/marketplaceEngine.js';
import { getOrganizationHealth } from '../enterprise/enterpriseManager.js';

export const REPORTING_ENGINE_VERSION = '1.0.0';
export const REPORTING_STORAGE_KEY = 'reelforge_executive_reports';

export const REPORT_CADENCES = /** @type {const} */ (['Daily', 'Weekly', 'Monthly', 'Quarterly']);

export const REPORT_METRICS = /** @type {const} */ ([
    'Production',
    'Publishing',
    'Revenue',
    'Security',
    'Teams',
    'Marketplace'
]);

/** @typedef {typeof REPORT_CADENCES[number]} ReportCadence */
/** @typedef {typeof REPORT_METRICS[number]} ReportMetric */
/** @typedef {'json' | 'csv' | 'pdf'} ReportExportFormat */

/**
 * @typedef {Object} ExecutiveReport
 * @property {string} id
 * @property {ReportCadence} cadence
 * @property {string} seriesId
 * @property {number} generatedAt
 * @property {number} periodStart
 * @property {number} periodEnd
 * @property {Record<ReportMetric, Record<string, unknown>>} metrics
 * @property {string[]} highlights
 * @property {string[]} risks
 */

/**
 * @param {'REPORT_GENERATED' | 'REPORT_EXPORT' | 'REPORT_SUMMARY'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logReportingDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {number} cents @param {string} [currency] */
function formatRevenueNet(cents, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0
    }).format(Number(cents || 0) / 100);
}

/** @returns {{ version: string; reports: ExecutiveReport[] }} */
function defaultReportingStore() {
    return { version: REPORTING_ENGINE_VERSION, reports: [] };
}

/** @returns {{ version: string; reports: ExecutiveReport[] }} */
export function loadReportingStore() {
    if (typeof window === 'undefined') return defaultReportingStore();
    try {
        const raw = localStorage.getItem(REPORTING_STORAGE_KEY);
        if (!raw) return defaultReportingStore();
        const parsed = JSON.parse(raw);
        return {
            version: REPORTING_ENGINE_VERSION,
            reports: Array.isArray(parsed.reports) ? parsed.reports : []
        };
    } catch {
        return defaultReportingStore();
    }
}

/** @param {{ version: string; reports: ExecutiveReport[] }} store */
function persistReportingStore(store) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(REPORTING_STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent('reelforge:reporting-updated', { detail: store }));
}

/** @param {ReportCadence | string} cadence */
export function normalizeReportCadence(cadence) {
    const match = REPORT_CADENCES.find((item) => item.toLowerCase() === String(cadence || '').toLowerCase());
    return match || 'Daily';
}

/** @param {ReportCadence} cadence @param {number} [now] */
export function resolveReportPeriod(cadence, now = Date.now()) {
    const end = now;
    const dayMs = 24 * 60 * 60 * 1000;
    const startOffsets = {
        Daily: dayMs,
        Weekly: dayMs * 7,
        Monthly: dayMs * 30,
        Quarterly: dayMs * 90
    };
    return {
        periodStart: end - (startOffsets[cadence] || dayMs),
        periodEnd: end
    };
}

/** @returns {{ teamCount: number; memberCount: number }} */
function getTeamStats() {
    if (typeof window === 'undefined') return { teamCount: 1, memberCount: 1 };
    try {
        const raw = localStorage.getItem(TEAM_STORAGE_KEY);
        if (!raw) return { teamCount: 1, memberCount: 1 };
        const parsed = JSON.parse(raw);
        const teams = Array.isArray(parsed.teams) ? parsed.teams : [];
        const members = parsed.members && typeof parsed.members === 'object' ? parsed.members : {};
        const memberCount = Object.values(members).reduce(
            (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
            0
        );
        return {
            teamCount: Math.max(teams.length, 1),
            memberCount: Math.max(memberCount, 1)
        };
    } catch {
        return { teamCount: 1, memberCount: 1 };
    }
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function collectReportMetrics(seriesId, feedReels = []) {
    const health = computeSeriesHealth(feedReels, seriesId);
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const workflow = getWorkflowOperationsSnapshot(seriesId, feedReels);
    const publishing = buildReleaseCenterSnapshot(seriesId, feedReels);
    const revenue = buildRevenueDashboardBrief(seriesId, feedReels, { monthlyViewers: Math.max(health.totalEpisodes * 250, 1000) });
    const security = buildSecurityOperationsBrief(seriesId, feedReels, { emitDiagnostics: false });
    const teamStats = getTeamStats();
    const marketplace = loadMarketplaceStore();
    const organization = getOrganizationHealth(seriesId, feedReels);

    const marketplaceCreators = Object.keys(marketplace.creators || {}).length;
    const marketplaceServices = Object.keys(marketplace.services || {}).length;
    const marketplaceGigs = Object.values(marketplace.gigs || {}).filter(
        (gig) => gig.status === 'open' || gig.status === 'in_progress'
    ).length;

    return {
        Production: {
            readinessPercent: readiness.weightedPercent,
            missingAssets: health.missingAssets,
            totalEpisodes: health.totalEpisodes,
            openTasks: workflow.openTaskCount,
            inProgressTasks: workflow.inProgressCount,
            projectedReadiness: workflow.projectedReadiness
        },
        Publishing: {
            releaseHealth: publishing.releaseHealth?.launchReadinessScore ?? publishing.launchReadiness?.launchReadinessScore ?? 0,
            launchReadiness: publishing.launchReadiness?.launchReadinessScore ?? 0,
            scheduledCount: publishing.launchReadiness?.scheduledEpisodes ?? 0,
            publishedCount: publishing.calendar?.filter?.((entry) => entry.status === 'released')?.length ?? 0,
            premiereCountdown: publishing.premiereCountdown ?? null
        },
        Revenue: {
            mrr: revenue.kpis?.mrr?.formatted ?? '—',
            arr: revenue.kpis?.arr?.formatted ?? '—',
            netMonthly: formatRevenueNet(revenue.aggregateNetMonthlyCents, revenue.currency),
            forecastHorizon: revenue.forecasts?.length ?? 0,
            activeStreams: revenue.seriesEstimates?.length ?? 0
        },
        Security: {
            combinedScore: security.platformSecurityScore?.combinedScore ?? security.platformSecurityScore ?? 0,
            threatLevel: security.threatLevel,
            auditScore: security.platformSecurityScore?.auditScore ?? 0,
            activeIncidents: security.sections?.activeIncidents?.length ?? 0
        },
        Teams: {
            teamCount: teamStats.teamCount,
            memberCount: teamStats.memberCount,
            organizationHealth: organization.healthScore,
            organizationGrade: organization.grade
        },
        Marketplace: {
            creators: marketplaceCreators,
            services: marketplaceServices,
            activeGigs: marketplaceGigs,
            reviews: Object.keys(marketplace.reviews || {}).length
        }
    };
}

/**
 * @param {Record<ReportMetric, Record<string, unknown>>} metrics
 */
export function summarizeReportMetrics(metrics) {
    const highlights = [];
    const risks = [];

    if (Number(metrics.Production?.readinessPercent || 0) >= 75) {
        highlights.push(`Production readiness at ${metrics.Production.readinessPercent}%`);
    } else {
        risks.push(`Production readiness below target (${metrics.Production?.readinessPercent || 0}%)`);
    }

    if (Number(metrics.Publishing?.launchReadiness || 0) >= 70) {
        highlights.push(`Publishing health stable at ${metrics.Publishing.launchReadiness}%`);
    } else {
        risks.push('Publishing pipeline needs attention');
    }

    if (Number(metrics.Security?.combinedScore || 0) >= 80) {
        highlights.push(`Security posture strong (${metrics.Security.combinedScore}/100)`);
    } else {
        risks.push(`Security score elevated (${metrics.Security?.combinedScore || 0}/100)`);
    }

    if (Number(metrics.Teams?.memberCount || 0) > 1) {
        highlights.push(`${metrics.Teams.memberCount} collaborators active across teams`);
    }

    if (Number(metrics.Marketplace?.activeGigs || 0) > 0) {
        highlights.push(`${metrics.Marketplace.activeGigs} marketplace gigs in flight`);
    }

    logReportingDiag('REPORT_SUMMARY', {
        highlightCount: highlights.length,
        riskCount: risks.length,
        metrics: REPORT_METRICS
    });

    return { highlights, risks };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {{ cadence?: ReportCadence | string; persist?: boolean }} [options]
 */
export function generateExecutiveReport(seriesId, feedReels = [], options = {}) {
    const cadence = normalizeReportCadence(options.cadence || 'Daily');
    const { periodStart, periodEnd } = resolveReportPeriod(cadence);
    const metrics = collectReportMetrics(seriesId, feedReels);
    const { highlights, risks } = summarizeReportMetrics(metrics);

    const report = /** @type {ExecutiveReport} */ ({
        id: `report-${cadence.toLowerCase()}-${Date.now()}`,
        cadence,
        seriesId,
        generatedAt: Date.now(),
        periodStart,
        periodEnd,
        metrics,
        highlights,
        risks
    });

    if (options.persist !== false) {
        const store = loadReportingStore();
        store.reports.unshift(report);
        store.reports = store.reports.slice(0, 24);
        persistReportingStore(store);
    }

    logReportingDiag('REPORT_GENERATED', {
        reportId: report.id,
        cadence: report.cadence,
        seriesId: report.seriesId,
        metricCount: REPORT_METRICS.length
    });

    return report;
}

/**
 * @param {ExecutiveReport} report
 * @param {ReportExportFormat} format
 */
export function exportExecutiveReport(report, format = 'json') {
    if (format === 'json') {
        const payload = JSON.stringify(report, null, 2);
        logReportingDiag('REPORT_EXPORT', {
            reportId: report.id,
            format: 'json',
            bytes: payload.length
        });
        return { format: 'json', mimeType: 'application/json', filename: `${report.id}.json`, payload };
    }

    if (format === 'csv') {
        const rows = [
            ['metric', 'key', 'value'],
            ...REPORT_METRICS.flatMap((metric) =>
                Object.entries(report.metrics[metric] || {}).map(([key, value]) => [
                    metric,
                    key,
                    String(value)
                ])
            )
        ];
        const payload = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        logReportingDiag('REPORT_EXPORT', {
            reportId: report.id,
            format: 'csv',
            rowCount: rows.length - 1
        });
        return { format: 'csv', mimeType: 'text/csv', filename: `${report.id}.csv`, payload };
    }

    const pdfPayload = {
        documentType: 'executive-report',
        version: REPORTING_ENGINE_VERSION,
        title: `${report.cadence} Executive Report`,
        seriesId: report.seriesId,
        generatedAt: report.generatedAt,
        period: {
            start: new Date(report.periodStart).toISOString(),
            end: new Date(report.periodEnd).toISOString()
        },
        sections: REPORT_METRICS.map((metric) => ({
            heading: metric,
            metrics: report.metrics[metric],
            body: Object.entries(report.metrics[metric] || {})
                .map(([key, value]) => `${key}: ${value}`)
                .join(' · ')
        })),
        highlights: report.highlights,
        risks: report.risks,
        printable: true
    };

    logReportingDiag('REPORT_EXPORT', {
        reportId: report.id,
        format: 'pdf',
        sectionCount: pdfPayload.sections.length
    });

    return {
        format: 'pdf',
        mimeType: 'application/json',
        filename: `${report.id}.pdf-ready.json`,
        payload: JSON.stringify(pdfPayload, null, 2),
        pdfReady: pdfPayload
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function buildExecutiveReportsDashboard(seriesId, feedReels = []) {
    const store = loadReportingStore();
    const latestByCadence = Object.fromEntries(
        REPORT_CADENCES.map((cadence) => [
            cadence,
            store.reports.find((report) => report.cadence === cadence && report.seriesId === seriesId) ||
                generateExecutiveReport(seriesId, feedReels, { cadence, persist: false })
        ])
    );

    return {
        seriesId,
        cadences: REPORT_CADENCES,
        metrics: REPORT_METRICS,
        latestByCadence,
        recentReports: store.reports.filter((report) => report.seriesId === seriesId).slice(0, 8)
    };
}

let reportingInitialized = false;

export function initReportingEngine() {
    if (typeof window === 'undefined' || reportingInitialized) return;
    reportingInitialized = true;

    window.__reelforgeReporting = {
        REPORTING_ENGINE_VERSION,
        REPORT_CADENCES,
        REPORT_METRICS,
        generateExecutiveReport,
        exportExecutiveReport,
        buildExecutiveReportsDashboard,
        collectReportMetrics,
        summarizeReportMetrics,
        loadReportingStore,
        logReportingDiag
    };

    logReportingDiag('REPORT_GENERATED', {
        phase: 'engine_initialized',
        version: REPORTING_ENGINE_VERSION,
        cadences: REPORT_CADENCES,
        metrics: REPORT_METRICS
    });
}
