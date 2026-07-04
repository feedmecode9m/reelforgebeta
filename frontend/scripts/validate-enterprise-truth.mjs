#!/usr/bin/env node
/**
 * Phase 44 — Enterprise runtime validation.
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

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await openCommandCenterSection(page, 'enterprise');

assertRuntime(
    'enterprise control center visible',
    await page.locator('[data-enterprise-control-center]').isVisible(),
    stats
);
assertRuntime(
    'enterprise health score visible',
    await page.locator('[data-enterprise-health-score]').isVisible(),
    stats
);
assertRuntime(
    'enterprise hierarchy panel visible',
    await page.locator('[data-enterprise-hierarchy]').isVisible(),
    stats
);

const runtime = await page.evaluate(() => {
    const api = window.__reelforgeEnterprise;
    if (!api?.getOrganizationHealth) return { ok: false };
    const health = api.getOrganizationHealth('');
    return {
        ok: Boolean(health?.grade),
        grade: health?.grade || '',
        studioCount: health?.counts?.studios ?? 0
    };
});

assertRuntime('enterprise organization health computes at runtime', runtime.ok, stats, runtime);

await browser.close();
emitTruthSummary(stats, 'ENTERPRISE_TRUTH_COMPLETE=true');
