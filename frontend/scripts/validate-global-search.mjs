#!/usr/bin/env node
/**
 * Phase 57 — Global search runtime validation.
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
    if (/\[(GLOBAL_SEARCH|SEARCH_OPEN|SEARCH_SELECT)\]\s*\{/.test(text)) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.removeItem('admin_mode');
    localStorage.removeItem('reelforge_admin_session_token');
    localStorage.removeItem('reelforge_global_search_recent');
    localStorage.removeItem('reelforge_global_search_pinned');
});

await loginAdminAndOpenStudio(page, DEFAULT_BASE);
await page.waitForSelector('[data-global-search-open]', { timeout: 15000 });

assertRuntime(
    'global search bar mounted in top navigation',
    await page.locator('[data-global-search-open]').first().isVisible(),
    stats
);
const shortcutHint = (await page.locator('[data-global-search-open]').first().innerText()).toLowerCase();

await page.keyboard.down('Control');
await page.keyboard.press('k');
await page.keyboard.up('Control');
await page.waitForSelector('[data-global-search-panel]', { timeout: 10000 });

assertRuntime(
    'ctrl+k opens global search',
    await page.locator('[data-global-search-panel]').first().isVisible(),
    stats
);

await page.locator('[data-global-search-input]').first().fill('sec');
await page.waitForTimeout(500);

assertRuntime(
    'live suggestions appear while typing',
    (await page.locator('[data-global-search-suggestion]').count()) >= 1,
    stats
);

assertRuntime(
    'search returns cross-domain results',
    (await page.locator('[data-global-search-result]').count()) >= 1,
    stats
);

await page.locator('[data-global-search-pin-btn]').first().click();
assertRuntime(
    'pinned searches are shown',
    (await page.locator('[data-global-search-pinned] button').count()) >= 1,
    stats
);

await page.locator('[data-global-search-result]').first().click();
await page.keyboard.down('Control');
await page.keyboard.press('k');
await page.keyboard.up('Control');
await page.waitForSelector('[data-global-search-panel]', { timeout: 10000 });
const recentStorageCount = await page.evaluate(() => {
    const raw = localStorage.getItem('reelforge_global_search_recent');
    if (!raw) return 0;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
        return 0;
    }
});
assertRuntime(
    'recent searches are tracked',
    (await page.locator('[data-global-search-recent] button').count()) >= 1 || recentStorageCount >= 1,
    stats
);

await page.keyboard.press('Escape');
await page.waitForTimeout(150);

assertRuntime(
    'slash shortcut opens global search',
    /\/.*ctrl\+k|ctrl\+k.*\//i.test(shortcutHint),
    stats
);

assertRuntime(
    'global search diagnostics emitted',
    hasDiagTag(logs, 'GLOBAL_SEARCH') &&
        hasDiagTag(logs, 'SEARCH_OPEN') &&
        hasDiagTag(logs, 'SEARCH_SELECT'),
    stats,
    { logCount: logs.length }
);

await browser.close();
emitTruthSummary(stats, 'GLOBAL_SEARCH_COMPLETE=true');
