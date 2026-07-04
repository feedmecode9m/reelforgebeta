/**
 * Phase 41/46 — Revenue dashboard diagnostics facade.
 * Brief and KPI calculations live in revenueCore.js.
 */

export {
    buildRevenueDashboardBrief,
    formatRevenueCurrency,
    syncRevenueConsistencyCheck
} from './revenueCore.js';

import { logRevenueDiag } from './revenueDiagnostics.js';
import { buildRevenueDashboardBrief } from './revenueCore.js';

/**
 * @param {'load' | 'refresh'} phase
 * @param {ReturnType<typeof buildRevenueDashboardBrief>} brief
 * @param {Record<string, unknown>} [extra]
 */
export function emitRevenueDashboardDiagnostics(phase, brief, extra = {}) {
    logRevenueDiag('REVENUE_DASHBOARD', {
        phase,
        seriesId: brief.seriesId,
        currency: brief.currency,
        episodeCount: brief.episodeCount,
        creatorCount: brief.creatorCount,
        teamCount: brief.teamCount,
        aggregateNetMonthlyCents: brief.aggregateNetMonthlyCents,
        ...extra
    });

    Object.values(brief.kpis).forEach((kpi) => {
        logRevenueDiag('REVENUE_KPI', {
            phase,
            seriesId: brief.seriesId,
            kpiId: kpi.id,
            label: kpi.label,
            cents: kpi.cents,
            formatted: kpi.formatted
        });
    });

    brief.forecasts.forEach((forecast) => {
        logRevenueDiag('REVENUE_FORECAST', {
            phase,
            seriesId: brief.seriesId,
            horizonDays: forecast.horizonDays,
            label: forecast.label,
            netCents: forecast.netCents,
            grossCents: forecast.grossCents,
            growthRate: forecast.growthRate
        });
    });
}

let revenueDashboardInitialized = false;

export function initRevenueDashboard() {
    if (typeof window === 'undefined' || revenueDashboardInitialized) return;
    revenueDashboardInitialized = true;

    if (window.__reelforgeRevenue) {
        window.__reelforgeRevenue.buildRevenueDashboardBrief = buildRevenueDashboardBrief;
        window.__reelforgeRevenue.emitRevenueDashboardDiagnostics = emitRevenueDashboardDiagnostics;
    }
}
