#!/usr/bin/env node
/**
 * Phase 66B — Revenue dashboard runtime validation.
 */
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    loginAdminAndOpenStudio,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const page = await browser.newPage();
const logs = [];

function hasDiagTag(lines, tag) {
    const pattern = new RegExp(`\\[${tag}\\]\\s*\\{`);
    return lines.some((line) => pattern.test(line));
}

page.on('console', (msg) => {
    const text = msg.text();
    if (/\[(REVENUE_DASHBOARD|REVENUE_KPI)\]\s*\{/.test(text)) logs.push(text);
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.locator('[data-command-dashboard-section="security"]').first().click();
await page.waitForSelector('[data-command-dashboard-detail="security"]', { timeout: 15000 });

const detailBefore = await page
    .locator('[data-command-dashboard-detail]')
    .first()
    .getAttribute('data-command-dashboard-detail')
    .catch(() => '');

await page.locator('[data-command-dashboard-section="revenue"]').first().click();
await page.waitForSelector('[data-command-dashboard-detail="revenue"]', { timeout: 15000 });

const detailAfter = await page
    .locator('[data-command-dashboard-detail]')
    .first()
    .getAttribute('data-command-dashboard-detail')
    .catch(() => '');

assertRuntime(
    'revenue section is reachable in command center',
    await page.locator('[data-command-dashboard-detail="revenue"]').first().isVisible(),
    stats
);
assertRuntime(
    'revenue tab selection causes visible UI state change',
    detailBefore !== detailAfter && detailAfter === 'revenue',
    stats,
    { detailBefore, detailAfter }
);

const runtime = await page.evaluate(() => {
    const revenueCore = window.__reelforgeRevenueCore;
    const revenueRuntime = window.__reelforgeRevenue;
    if (!revenueCore || !revenueRuntime?.buildRevenueDashboardBrief) {
        return { hasHooks: false };
    }
    const baseline = revenueCore.buildRevenueDashboardBrief('series-neon-vengeance', []);
    const syntheticFeed = [
        {
            id: 'phase66b-revenue-synthetic-1',
            seriesId: 'series-neon-vengeance',
            revenue_cents: 750000,
            views: 12000,
            likes: 1800
        }
    ];
    const simulated = revenueCore.buildRevenueDashboardBrief('series-neon-vengeance', syntheticFeed);
    revenueRuntime.emitRevenueDashboardDiagnostics?.('refresh', simulated, { source: 'phase66b-validator' });
    return {
        hasHooks: true,
        baselineMrr: baseline?.kpis?.mrr?.formatted || '',
        simulatedMrr: simulated?.kpis?.mrr?.formatted || '',
        forecastCount: Array.isArray(simulated?.forecasts) ? simulated.forecasts.length : 0,
        hasSeriesRevenueKpi: Boolean(simulated?.kpis?.seriesRevenue?.formatted)
    };
});

assertRuntime('revenue hooks initialized', runtime.hasHooks === true, stats, runtime);
assertRuntime(
    'revenue dashboard computes KPI + forecast behavior at runtime',
    runtime.hasSeriesRevenueKpi && runtime.forecastCount >= 1,
    stats,
    runtime
);
assertRuntime(
    'revenue diagnostics emitted',
    hasDiagTag(logs, 'REVENUE_CORE') || hasDiagTag(logs, 'REVENUE_DASHBOARD') || hasDiagTag(logs, 'REVENUE_KPI'),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'REVENUE_DASHBOARD_TRUTH_COMPLETE=true');
