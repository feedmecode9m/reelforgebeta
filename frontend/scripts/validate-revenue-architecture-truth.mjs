#!/usr/bin/env node
/**
 * Phase 44 — Revenue architecture runtime validation.
 */
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const page = await browser.newPage();

await page.goto(`${DEFAULT_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__reelforgeRevenue, { timeout: 15000 });

const architecture = await page.evaluate(() => {
    const api = window.__reelforgeRevenue;
    const store = api.loadRevenueStore();
    const profile =
        store.series?.['series-neon-vengeance'] ||
        api.buildSeriesRevenueProfile('series-neon-vengeance');
    const forecasts = api.buildRevenueHorizonForecasts(profile, { horizons: [30, 90, 180] });
    return {
        ok: Boolean(store) && Array.isArray(forecasts) && forecasts.length >= 1,
        forecastCount: forecasts?.length || 0,
        hasPlatformProfile: Boolean(store.platform?.platformId)
    };
});

assertRuntime('revenue store loads at runtime', architecture.hasPlatformProfile, stats, architecture);
assertRuntime(
    'revenue horizon forecasts compute at runtime',
    architecture.forecastCount >= 1,
    stats,
    architecture
);

const persisted = await page.evaluate(() => {
    const api = window.__reelforgeRevenue;
    const seriesId = `series-truth-${Date.now()}`;
    api.saveSeriesRevenueProfile(seriesId, { currency: 'USD' });
    const store = api.loadRevenueStore();
    return Boolean(store.series?.[seriesId]);
});

assertRuntime('revenue series profile persists to localStorage', persisted, stats);

await browser.close();
emitTruthSummary(stats, 'REVENUE_ARCHITECTURE_TRUTH_COMPLETE=true');
