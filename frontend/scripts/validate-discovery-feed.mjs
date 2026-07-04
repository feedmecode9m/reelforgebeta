#!/usr/bin/env node
/**
 * Phase 69 — Discovery feed validation.
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
    if (/\[(DISCOVERY_FEED|DISCOVERY_CARD|DISCOVERY_REFRESH)\]\s*\{/.test(text)) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('reelforge_discovery_feed_state');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });
await page.waitForSelector('[data-discovery-feed]', { timeout: 15000 });
await page.waitForTimeout(350);

const runtime = await page.evaluate(async () => {
    let engine = window.__reelforgeDiscoveryFeed;
    if (!engine) {
        try {
            const mod = await import('/src/lib/discovery/discoveryFeedEngine.js');
            mod.initDiscoveryFeedEngine?.();
            engine = window.__reelforgeDiscoveryFeed;
        } catch {
            /* ignore */
        }
    }

    const initial = engine?.refreshDiscoveryFeed?.({ reason: 'validator_initial' }) || null;
    const initialUpdatedAt = Number(initial?.updatedAt || 0);

    window.dispatchEvent(new CustomEvent('reelforge:workflow-tasks-updated'));
    window.dispatchEvent(new CustomEvent('reelforge:marketplace-updated'));
    window.dispatchEvent(new CustomEvent('reelforge:release-schedule-updated'));
    window.dispatchEvent(new CustomEvent('reelforge:revenue-updated'));

    await new Promise((resolve) => setTimeout(resolve, 280));

    const refreshed = engine?.loadDiscoveryFeedStore?.() || null;
    const persistedRaw = localStorage.getItem('reelforge_discovery_feed_state');
    const sectionKeys = Object.keys(refreshed?.sections || {});
    const cards = refreshed?.cards || [];
    const scoreSorted = cards.every((card, index) => index === 0 || Number(cards[index - 1]?.score || 0) >= Number(card?.score || 0));

    return {
        hasHook: Boolean(engine),
        visibleOnHomepage: Boolean(document.querySelector('[data-discovery-feed]')),
        hasState: Boolean(refreshed),
        updatedAfterActivity: Number(refreshed?.updatedAt || 0) >= initialUpdatedAt,
        sectionKeys,
        cardCount: cards.length,
        hasPersistedState: Boolean(persistedRaw),
        scoreSorted
    };
});

const requiredSections = [
    'trendingCreators',
    'marketplaceOpportunities',
    'upcomingReleases',
    'revenueMilestones',
    'sentinelInsights',
    'teamHighlights',
    'productionWins',
    'dailyRecommendations'
];

assertRuntime('discovery feed hook initialized', runtime.hasHook, stats, runtime);
assertRuntime('discovery feed visible on homepage', runtime.visibleOnHomepage, stats, runtime);
assertRuntime('discovery feed state persisted', runtime.hasState && runtime.hasPersistedState, stats, runtime);
assertRuntime(
    'discovery feed includes required sections',
    requiredSections.every((section) => runtime.sectionKeys.includes(section)),
    stats,
    runtime
);
assertRuntime(
    'discovery feed reacts to platform activity',
    runtime.updatedAfterActivity && runtime.cardCount >= 8,
    stats,
    runtime
);
assertRuntime('discovery feed ranking is score sorted', runtime.scoreSorted, stats, runtime);
assertRuntime(
    'discovery feed diagnostics emitted',
    hasDiagTag(logs, 'DISCOVERY_FEED') &&
        hasDiagTag(logs, 'DISCOVERY_CARD') &&
        hasDiagTag(logs, 'DISCOVERY_REFRESH'),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'DISCOVERY_FEED_COMPLETE=true');
