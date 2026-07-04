#!/usr/bin/env node
/**
 * Phase 44 — Studio appearance runtime validation with real admin login.
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

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.setItem('reelforge_studio_workspace_tab', 'System');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);

await page.click('[data-workspace-tab="system"], [data-command-section="system"]');
await page.waitForSelector('[data-studio-appearance-panel]', { timeout: 15000 });

assertRuntime(
    'appearance panel renders in system tab',
    await page.locator('[data-studio-appearance-panel]').isVisible(),
    stats
);

assertRuntime(
    'appearance profiles are rendered',
    (await page.locator('[data-studio-appearance-profile]').count()) >= 2,
    stats
);

await page.click('[data-studio-appearance-profile="neon-studio"]');
await page.waitForTimeout(350);

const applied = await page.evaluate(() =>
    document.querySelector('.control-center-container')?.getAttribute('data-studio-theme')
);

assertRuntime('appearance theme applies to studio shell', applied === 'neon-studio', stats, { applied });

const persisted = await page.evaluate(() => {
    try {
        return JSON.parse(localStorage.getItem('reelforge_studio_appearance') || '{}').theme;
    } catch {
        return null;
    }
});

assertRuntime('appearance theme persists locally', persisted === 'neon-studio', stats);

await browser.close();
emitTruthSummary(stats, 'STUDIO_APPEARANCE_TRUTH_COMPLETE=true');
