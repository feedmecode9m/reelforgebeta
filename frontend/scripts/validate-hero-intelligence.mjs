#!/usr/bin/env node
/**
 * Phase 51 — Hero intelligence runtime validation through UI settings flow.
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
        text.includes('[HERO_INTELLIGENCE]') ||
        text.includes('[HERO_SELECTION]') ||
        text.includes('[HERO_SCORE]') ||
        text.includes('[HERO_RECOMMENDATION]') ||
        text.includes('[HERO_ROTATION]') ||
        text.includes('[HERO_PRIORITY]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.removeItem('reelforge_hero_manager_config');
    localStorage.setItem('reelforge_studio_workspace_tab', 'system');
});

await page.goto(`${DEFAULT_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-hero-intelligence]', { timeout: 15000 });

const beforeMode = await page.locator('[data-hero-intelligence]').getAttribute('data-hero-mode');

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.click('[data-workspace-tab="system"], [data-command-section="system"]');
await page.waitForSelector('[data-hero-manager-panel]', { timeout: 15000 });

assertRuntime('hero manager panel visible', await page.locator('[data-hero-manager-panel]').isVisible(), stats);
assertRuntime('hero type control visible', await page.locator('[data-hero-manager-type]').isVisible(), stats);

await page.selectOption('[data-hero-manager-type] select', 'CONTINUE_WATCHING');
await page.click('[data-hero-manager-apply]');
await page.waitForTimeout(500);

// Return to hero surface and verify selected mode affects visible hero.
await page.click('[data-workspace-tab="overview"], [data-command-section="overview"]');
await page.waitForTimeout(350);

const afterMode = await page.locator('[data-hero-intelligence]').getAttribute('data-hero-mode');
const heroTitle = await page.locator('[data-hero-title]').innerText();
const heroInsight = await page.locator('[data-hero-insight]').innerText();

assertRuntime(
    'hero manager setting affects hero mode',
    beforeMode !== afterMode || afterMode === 'CONTINUE_WATCHING',
    stats,
    { beforeMode, afterMode }
);
assertRuntime('hero title visible', heroTitle.trim().length > 0, stats);
assertRuntime('hero insight visible', heroInsight.trim().length > 0, stats);
assertRuntime(
    'hero diagnostics emitted',
    logs.some((line) => line.includes('[HERO_INTELLIGENCE]')) &&
        logs.some((line) => line.includes('[HERO_SELECTION]')) &&
        logs.some((line) => line.includes('[HERO_PRIORITY]')),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'HERO_INTELLIGENCE_COMPLETE=true');
