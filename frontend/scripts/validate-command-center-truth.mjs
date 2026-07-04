#!/usr/bin/env node
/**
 * Phase 44 — Command center runtime validation with real admin login.
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
    if (text.includes('[COMMAND_CENTER]') || text.includes('[COMMAND_CENTER_REFRESH]')) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);

assertRuntime(
    'production command center visible',
    await page.locator('[data-production-command-center]').isVisible(),
    stats
);
assertRuntime(
    'command center KPI readiness visible',
    await page.locator('[data-command-readiness]').isVisible(),
    stats
);
assertRuntime(
    'command center section tabs visible',
    (await page.locator('[data-command-dashboard-section]').count()) >= 6,
    stats
);

for (const sectionId of ['executive-overview', 'security', 'production', 'publishing', 'teams', 'revenue']) {
    await openCommandCenterSection(page, sectionId);
    assertRuntime(
        `command center section ${sectionId} renders`,
        await page.locator(`[data-command-dashboard-detail="${sectionId}"]`).isVisible(),
        stats
    );
}

assertRuntime(
    'command center diagnostics emitted',
    logs.some((line) => line.includes('[COMMAND_CENTER]')),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'COMMAND_CENTER_TRUTH_COMPLETE=true');
