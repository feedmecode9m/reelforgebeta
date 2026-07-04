#!/usr/bin/env node
/**
 * Phase 58 — Dynamic homepage feed validation.
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
    if (text.includes('[HOME_FEED]') || text.includes('[HOME_FEED_REFRESH]')) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.removeItem('reelforge_homepage_discovery_feed');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-production-command-center]', { timeout: 15000 });

const runtime = await page.evaluate(async () => {
    let homeFeed = window.__reelforgeHomepageFeed;
    if (!homeFeed) {
        try {
            const mod = await import('/src/lib/discovery/homepageDiscoveryFeed.js');
            mod.initHomepageDiscoveryFeed?.();
            homeFeed = window.__reelforgeHomepageFeed;
        } catch {
            /* ignore */
        }
    }

    const seriesId = 'series-neon-vengeance';

    const threat = window.__reelforgeThreatDetection;
    const notifications = window.__reelforgeNotifications;
    const release = window.__reelforgeRelease;
    const market = window.__reelforgeMarketplace;

    const episode = (() => {
        try {
            return (
                window.__reelforgeSeries?.catalog?.[0]?.seasons?.[0]?.episodes?.[0]?.episodeId ||
                'ep-neon-vengeance-s1e1'
            );
        } catch {
            return 'ep-neon-vengeance-s1e1';
        }
    })();

    if (notifications?.createNotification) {
        await notifications.createNotification(
            'readiness_changed',
            'Homepage feed validation notification.',
            { source: 'phase58-validator', seriesId }
        );
    }

    if (release?.scheduleEpisodeRelease) {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(
            tomorrow.getDate()
        ).padStart(2, '0')}`;
        release.scheduleEpisodeRelease(seriesId, episode, dateStr, '18:30');
    }

    if (market?.createMarketplaceListing) {
        market.createMarketplaceListing({
            category: 'editing',
            title: 'Homepage Validator Edit Service',
            description: 'Validator generated listing for homepage feed refresh.'
        });
    }

    if (threat?.recordThreatEvent) {
        threat.recordThreatEvent('api', 'endpoint_burst', {
            simulated: true,
            source: 'phase58-validator'
        });
    }

    window.dispatchEvent(new CustomEvent('reelforge:upload-updated', { detail: { reelId: 'validator-reel' } }));
    window.dispatchEvent(new CustomEvent('reelforge:workflow-tasks-updated'));
    window.dispatchEvent(new CustomEvent('reelforge:notifications-updated'));
    window.dispatchEvent(new CustomEvent('reelforge:release-schedule-updated'));
    window.dispatchEvent(new CustomEvent('reelforge:marketplace-updated'));

    const built = homeFeed?.refreshHomepageFeed?.({ reason: 'validator_manual_refresh' });
    const state = homeFeed?.getHomepageFeedState?.() || built || null;
    const sections = state?.sections || {};

    return {
        hasHook: Boolean(homeFeed),
        hasState: Boolean(state),
        sectionKeys: Object.keys(sections),
        sectionSizes: Object.fromEntries(
            Object.entries(sections).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
        )
    };
});

const expectedSections = [
    'continueWatching',
    'trending',
    'recentlyUploaded',
    'newTeamActivity',
    'upcomingReleases',
    'marketplaceOpportunities',
    'creatorRecommendations',
    'securityAlerts',
    'sentinelRecommendations'
];

assertRuntime('homepage feed hook initialized', runtime.hasHook, stats, runtime);
assertRuntime('homepage feed state persisted', runtime.hasState, stats, runtime);
assertRuntime(
    'homepage feed includes required sections',
    expectedSections.every((section) => runtime.sectionKeys.includes(section)),
    stats,
    runtime
);
assertRuntime(
    'homepage feed sections have content',
    expectedSections.filter((section) => (runtime.sectionSizes?.[section] || 0) > 0).length >= 5,
    stats,
    runtime
);
assertRuntime(
    'homepage feed diagnostics emitted',
    logs.some((line) => line.includes('[HOME_FEED]')) &&
        logs.some((line) => line.includes('[HOME_FEED_REFRESH]')),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'HOMEPAGE_FEED_COMPLETE=true');
