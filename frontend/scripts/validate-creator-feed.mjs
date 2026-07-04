#!/usr/bin/env node
/**
 * Phase 64 — Creator Home Feed validation.
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

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[CREATOR_FEED]')) logs.push(text);
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.removeItem('reelforge_creator_home_feed');
    localStorage.setItem('reelforge_studio_workspace_tab', 'Overview');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-studio-workspace-layout]', { timeout: 15000 });
await page.click('[data-workspace-tab="overview"]').catch(() => {});
await page.waitForSelector('[data-workspace-overview]', { timeout: 15000 });
await page.waitForTimeout(250);
await page.waitForSelector('[data-creator-feed]', { timeout: 15000 });
await page.waitForSelector('[data-creator-feed-card]', { timeout: 15000 });

const runtime = await page.evaluate(() => {
    const feed = window.__reelforgeCreatorFeed;
    const built = feed?.refreshCreatorHomeFeed?.({
        seriesId: 'series-neon-vengeance',
        feedReels: Array.isArray(window.__reelforgeReels) ? window.__reelforgeReels : [],
        reason: 'validator'
    }) || null;
    const cards = built?.cards || [];
    const kinds = cards.map((card) => card.kind);
    const required = [
        'daily_engagement',
        'today_tasks',
        'marketplace_opportunities',
        'revenue_snapshot',
        'team_activity',
        'security_alerts',
        'trending_series',
        'upcoming_releases'
    ];
    const sorted = cards.every((card, index) => index === 0 || card.importance <= cards[index - 1].importance);
    const renderedKinds = Array.from(document.querySelectorAll('[data-creator-feed-kind]')).map((el) =>
        el.getAttribute('data-creator-feed-kind')
    );
    return {
        hasHook: Boolean(feed),
        hasBuiltState: Boolean(built),
        cardCount: cards.length,
        hasRequiredKinds: required.every((kind) => kinds.includes(kind)),
        sortedByImportance: sorted,
        renderedCount: document.querySelectorAll('[data-creator-feed-card]').length,
        renderedHasRequiredKinds: required.every((kind) => renderedKinds.includes(kind))
    };
});

assertRuntime('creator feed hook initialized', runtime.hasHook, stats, runtime);
assertRuntime('creator feed builds dynamic cards', runtime.hasBuiltState && runtime.cardCount >= 8, stats, runtime);
assertRuntime('creator feed includes required card families', runtime.hasRequiredKinds, stats, runtime);
assertRuntime('creator feed cards sorted by importance', runtime.sortedByImportance, stats, runtime);
assertRuntime(
    'creator feed cards render in overview',
    runtime.renderedCount >= 8 && runtime.renderedHasRequiredKinds,
    stats,
    runtime
);
assertRuntime(
    'creator feed diagnostics emitted',
    logs.some((line) => line.includes('[CREATOR_FEED]')),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'CREATOR_FEED_COMPLETE=true');
