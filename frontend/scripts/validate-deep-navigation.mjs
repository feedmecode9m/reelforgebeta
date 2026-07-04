#!/usr/bin/env node
/**
 * Phase 63 — Deep Navigation Layer validation.
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
    if (
        /\[(NAVIGATION_TARGET|NAVIGATION_SUCCESS|NAVIGATION_FAILURE|NAV_TARGET|NAV_SUCCESS|NAV_FAILURE|NAVIGATION_ACTION)\]\s*\{/.test(text)
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.setItem('reelforge_studio_workspace_tab', 'Overview');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-studio-workspace-layout]', { timeout: 15000 });
await page.waitForSelector('[data-global-search-open]', { timeout: 15000 });

const runtime = await page.evaluate(async () => {
    const nav = window.__reelforgeNavigation;
    const signal = {
        searchNavigate: 0,
        openReel: 0,
        workflowNavigate: 0
    };
    window.addEventListener('reelforge:search-navigate', () => {
        signal.searchNavigate += 1;
    });
    window.addEventListener('reelforge:search-open-reel', () => {
        signal.openReel += 1;
    });
    window.addEventListener('reelforge:workflow-navigate', () => {
        signal.workflowNavigate += 1;
    });

    const results = {
        studioTab: nav?.navigateToTarget?.({ type: 'studio_tab', tab: 'Teams' }) || false,
        workflow: nav?.navigateToTarget?.({ type: 'workflow', tab: 'Production' }) || false,
        episode:
            nav?.navigateToTarget?.({ type: 'episode', episodeId: 'ep-neon-vengeance-s1e1' }) || false,
        marketplace:
            nav?.navigateToTarget?.({ type: 'marketplace_listing', listingId: 'validator-listing' }) || false,
        commandCenter:
            nav?.navigateToTarget?.({
                type: 'command_center_page',
                dashboardSection: 'security',
                tab: 'System'
            }) || false,
        security:
            nav?.navigateToTarget?.({ type: 'security_incident', incidentId: 'validator-incident' }) || false,
        revenue: nav?.navigateToTarget?.({ type: 'revenue_section', section: 'revenue' }) || false,
        failureCase: nav?.navigateToTarget?.(null) || false
    };

    // Trigger surface-level actions that should route through deep navigation.
    window.__reelforgeNotifications?.createNotification?.(
        'workflow_assigned',
        'Deep navigation validation notification.',
        { seriesId: 'series-neon-vengeance' }
    );

    return {
        hasHook: Boolean(nav),
        targetResults: results,
        signal
    };
});

assertRuntime('deep navigation hook initialized', runtime.hasHook, stats, runtime);
assertRuntime(
    'deep navigation supports target navigation types',
    runtime.targetResults.studioTab &&
        runtime.targetResults.workflow &&
        runtime.targetResults.episode &&
        runtime.targetResults.marketplace &&
        runtime.targetResults.commandCenter &&
        runtime.targetResults.security &&
        runtime.targetResults.revenue,
    stats,
    runtime
);
assertRuntime(
    'deep navigation emits internal navigation events',
    runtime.signal.searchNavigate >= 1 || runtime.signal.workflowNavigate >= 1,
    stats,
    runtime
);

// Surface checks: search result + guide-me action + notification click.
await page.click('[data-global-search-open]');
await page.waitForSelector('[data-global-search-input]', { timeout: 10000 });
await page.fill('[data-global-search-input]', 'security issues');
await page.waitForTimeout(500);
if ((await page.locator('[data-global-search-result]').count()) > 0) {
    await page.locator('[data-global-search-result]').first().click();
}
if ((await page.locator('[data-studio-assistant-action="next-action"]').count()) > 0) {
    await page.locator('[data-studio-assistant-action="next-action"]').first().click();
}
if ((await page.locator('[data-notification-trigger]').count()) > 0) {
    await page.locator('[data-notification-trigger]').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
    if ((await page.locator('[data-notification-item]').count()) > 0) {
        await page.locator('[data-notification-item]').first().click({ force: true }).catch(() => {});
    }
}
await page.waitForTimeout(250);

assertRuntime(
    'deep navigation diagnostics emitted',
    (logs.some((line) => /\[NAVIGATION_TARGET\]\s*\{/.test(line)) ||
        logs.some((line) => /\[NAV_TARGET\]\s*\{/.test(line)) ||
        logs.some((line) => /\[NAVIGATION_ACTION\]\s*\{/.test(line))) &&
        (logs.some((line) => /\[NAVIGATION_SUCCESS\]\s*\{/.test(line)) ||
            logs.some((line) => /\[NAV_SUCCESS\]\s*\{/.test(line)) ||
            logs.some((line) => /\[NAVIGATION_ACTION\]\s*\{/.test(line))) &&
        (logs.some((line) => /\[NAVIGATION_FAILURE\]\s*\{/.test(line)) ||
            logs.some((line) => /\[NAV_FAILURE\]\s*\{/.test(line)) ||
            logs.some((line) => /\[NAVIGATION_ACTION\]\s*\{/.test(line))),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'DEEP_NAVIGATION_COMPLETE=true');
