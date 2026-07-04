#!/usr/bin/env node
/**
 * Phase 53 — Revenue backend foundation validation.
 */
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    loginAdminAndOpenStudio,
    openCommandCenterSection,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[REVENUE_API]') ||
        text.includes('[REVENUE_SYNC]') ||
        text.includes('[REVENUE_FORECAST]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await openCommandCenterSection(page, 'revenue');

assertRuntime(
    'revenue dashboard mounted with backend data path',
    await page.locator('[data-revenue-dashboard]').isVisible(),
    stats
);

for (const kpi of ['mrr', 'arr', 'series-revenue', 'revenue-per-creator', 'revenue-per-team']) {
    assertRuntime(
        `revenue KPI ${kpi} visible`,
        await page.locator(`[data-revenue-kpi-${kpi}]`).isVisible(),
        stats
    );
}

const apiChecks = await page.evaluate(async () => {
    const seriesId = 'series-neon-vengeance';
    const profileResp = await fetch('/api/revenue/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            profileType: 'series',
            profileRefId: seriesId,
            currency: 'USD',
            config: { source: 'validate-revenue-backend' }
        })
    });
    const profileBody = await profileResp.json().catch(() => ({}));

    const dashboardResp = await fetch(`/api/revenue/dashboard?seriesId=${encodeURIComponent(seriesId)}`);
    const dashboardBody = await dashboardResp.json().catch(() => ({}));

    const forecastResp = await fetch(`/api/revenue/forecast?seriesId=${encodeURIComponent(seriesId)}`);
    const forecastBody = await forecastResp.json().catch(() => ({}));

    const creatorResp = await fetch('/api/revenue/creator/creator-owner-1');
    const creatorBody = await creatorResp.json().catch(() => ({}));

    return {
        profileOk: profileResp.ok,
        profileId: profileBody?.profile?.id || null,
        dashboardOk: dashboardResp.ok,
        dashboardForecasts: Array.isArray(dashboardBody?.forecasts) ? dashboardBody.forecasts.length : 0,
        forecastOk: forecastResp.ok,
        forecastCount: Array.isArray(forecastBody?.forecasts) ? forecastBody.forecasts.length : 0,
        creatorOk: creatorResp.ok,
        creatorCount: Number(creatorBody?.count || 0)
    };
});

assertRuntime('POST /api/revenue/profile succeeds', apiChecks.profileOk, stats, apiChecks);
assertRuntime(
    'GET /api/revenue/dashboard succeeds',
    apiChecks.dashboardOk && apiChecks.dashboardForecasts >= 1,
    stats,
    apiChecks
);
assertRuntime(
    'GET /api/revenue/forecast succeeds',
    apiChecks.forecastOk && apiChecks.forecastCount >= 1,
    stats,
    apiChecks
);
assertRuntime('GET /api/revenue/creator/:id succeeds', apiChecks.creatorOk, stats, apiChecks);

assertRuntime(
    'revenue diagnostics emitted',
    logs.some((line) => line.includes('[REVENUE_API]')) &&
        logs.some((line) => line.includes('[REVENUE_SYNC]')) &&
        logs.some((line) => line.includes('[REVENUE_FORECAST]')),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'REVENUE_BACKEND_COMPLETE=true');
