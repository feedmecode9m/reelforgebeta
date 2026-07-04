#!/usr/bin/env node
/**
 * Phase 51 — Sentinel assistant runtime validation via UI only.
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
        text.includes('[SENTINEL_ANALYSIS]') ||
        text.includes('[SENTINEL_RECOMMENDATION]') ||
        text.includes('[SENTINEL_ALERT]') ||
        text.includes('[SENTINEL_SUMMARY]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.setItem('reelforge_studio_workspace_tab', 'system');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.click('[data-workspace-tab="system"], [data-command-section="system"]');
await page.waitForSelector('[data-sentinel-assistant-panel]', { timeout: 15000 });

assertRuntime('sentinel assistant panel visible', await page.locator('[data-sentinel-assistant-panel]').isVisible(), stats);
assertRuntime('executive summary visible', await page.locator('[data-sentinel-executive-summary]').isVisible(), stats);
assertRuntime('recommended actions visible', await page.locator('[data-sentinel-recommended-actions]').isVisible(), stats);
assertRuntime('top priorities visible', await page.locator('[data-sentinel-top-priorities]').isVisible(), stats);

await page.click('[data-sentinel-ask="fix-next"]');
await page.waitForSelector('[data-sentinel-answer]', { timeout: 10000 });
const answerText = await page.locator('[data-sentinel-answer]').innerText();
assertRuntime('ask sentinel returns recommendation', answerText.trim().length > 10, stats, { answerText });

assertRuntime(
    'sentinel diagnostics emitted',
    logs.some((line) => line.includes('[SENTINEL_ANALYSIS]')) &&
        logs.some((line) => line.includes('[SENTINEL_RECOMMENDATION]')) &&
        logs.some((line) => line.includes('[SENTINEL_SUMMARY]')),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'SENTINEL_ASSISTANT_COMPLETE=true');
