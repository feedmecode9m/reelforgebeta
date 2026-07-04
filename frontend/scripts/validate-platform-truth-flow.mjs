#!/usr/bin/env node
/**
 * Phase 44 — Required user-flow validation (real admin login path).
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

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
});

try {
    await loginAdminAndOpenStudio(page, DEFAULT_BASE);
    assertRuntime('admin login unlocks studio', true, stats, { flow: 'admin-login' });
    assertRuntime(
        'command center visible after login',
        await page.locator('[data-production-command-center]').isVisible(),
        stats
    );

    await openCommandCenterSection(page, 'security');
    assertRuntime(
        'security center dashboard visible',
        await page.locator('[data-security-operations-dashboard]').isVisible(),
        stats,
        { flow: 'security-center' }
    );
    assertRuntime(
        'SOC threat level rendered',
        await page.locator('[data-soc-threat-level]').isVisible(),
        stats
    );

    await openCommandCenterSection(page, 'revenue');
    assertRuntime(
        'revenue dashboard visible',
        await page.locator('[data-revenue-dashboard]').isVisible(),
        stats,
        { flow: 'revenue-dashboard' }
    );
    assertRuntime(
        'revenue MRR KPI visible',
        await page.locator('[data-revenue-kpi-mrr]').isVisible(),
        stats
    );
    assertRuntime(
        'revenue forecast panel visible',
        await page.locator('[data-revenue-forecast-panel]').isVisible(),
        stats
    );

    await openCommandCenterSection(page, 'marketplace');
    assertRuntime(
        'marketplace dashboard visible',
        await page.locator('[data-marketplace-dashboard]').isVisible(),
        stats,
        { flow: 'marketplace' }
    );
    assertRuntime(
        'marketplace browse results visible',
        await page.locator('[data-marketplace-browse-results]').isVisible(),
        stats
    );

    await openCommandCenterSection(page, 'enterprise');
    assertRuntime(
        'enterprise control center visible',
        await page.locator('[data-enterprise-control-center]').isVisible(),
        stats,
        { flow: 'enterprise' }
    );
} catch (error) {
    stats.failed = true;
    assertRuntime('platform truth user flow', false, stats, {
        error: String(error?.message || error)
    });
} finally {
    await browser.close();
}

emitTruthSummary(stats, 'PLATFORM_TRUTH_FLOW_COMPLETE=true');
