#!/usr/bin/env node
/**
 * Phase 61 — Daily engagement validation.
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
    if (/\[DAILY_ENGAGEMENT\]\s*\{/.test(text)) logs.push(text);
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.removeItem('daily_engagement_state');
    localStorage.setItem('reelforge_studio_workspace_tab', 'Overview');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-studio-workspace-layout]', { timeout: 15000 });
await page.waitForSelector('[data-workspace-tab="overview"]', { timeout: 15000 }).catch(() => {});
await page.click('[data-workspace-tab="overview"]').catch(() => {});
await page.waitForTimeout(200);
await page.waitForSelector('[data-daily-engagement]', { timeout: 15000 });

const runtime = await page.evaluate(() => {
    const daily = window.__reelforgeDailyEngagement;
    const state =
        daily?.refreshDailyEngagementState?.({
            seriesId: 'series-neon-vengeance',
            feedReels: Array.isArray(window.__reelforgeReels) ? window.__reelforgeReels : []
        }) || null;
    const persisted = localStorage.getItem('daily_engagement_state');
    const parsed = persisted ? JSON.parse(persisted) : null;
    const keys = Object.keys(parsed?.cards || {});
    const keySet = new Set(keys);
    const required = [
        'dailyStudioTip',
        'dailyCreatorChallenge',
        'todaysRelease',
        'trendingCreator',
        'sentinelInsightOfDay',
        'revenueInsightOfDay',
        'marketplaceOpportunityOfDay'
    ];
    return {
        hasHook: Boolean(daily),
        hasState: Boolean(state || parsed),
        hasStorage: Boolean(persisted),
        keys,
        hasRequiredCards: required.every((key) => keySet.has(key)),
        renderedCards: document.querySelectorAll('[data-daily-engagement-card]').length
    };
});

assertRuntime('daily engagement hook initialized', runtime.hasHook, stats, runtime);
assertRuntime('daily engagement state available', runtime.hasState, stats, runtime);
assertRuntime('daily engagement persisted in storage', runtime.hasStorage, stats, runtime);
assertRuntime('daily engagement includes required cards', runtime.hasRequiredCards, stats, runtime);
assertRuntime('daily engagement cards render on overview', runtime.renderedCards >= 7, stats, runtime);
assertRuntime(
    'daily engagement diagnostics emitted',
    hasDiagTag(logs, 'DAILY_ENGAGEMENT'),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'DAILY_ENGAGEMENT_COMPLETE=true');
