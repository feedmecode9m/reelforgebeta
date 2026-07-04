#!/usr/bin/env node
/**
 * Phase 44 — Theater navigation runtime validation (drawer; no publishing profile edits).
 */
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const page = await browser.newPage();

await page.goto(`${DEFAULT_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-reel-id]', { timeout: 15000 });

await page.locator('[data-reel-id]').first().click();
await page.waitForSelector('[data-theater-container]', { timeout: 15000 });

assertRuntime(
    'theater container visible after card click',
    await page.locator('[data-theater-container]').isVisible(),
    stats
);
assertRuntime(
    'theater video element mounted',
    (await page.locator('[data-theater-video]').count()) >= 1,
    stats
);

const episodesBtn = page.locator('.theater-series-btn');
assertRuntime(
    'theater episodes control visible',
    await episodesBtn.isVisible(),
    stats
);

await episodesBtn.click();
await page.waitForSelector('.series-drawer', { timeout: 10000 });

assertRuntime(
    'series drawer opens from theater header',
    await page.locator('.series-drawer').isVisible(),
    stats
);

const episodeChips = await page.locator('.series-drawer [data-episode-id], .series-drawer .episode-chip').count();
assertRuntime('series drawer lists episodes', episodeChips >= 1, stats, { episodeChips });

await browser.close();
emitTruthSummary(stats, 'THEATER_NAVIGATION_TRUTH_COMPLETE=true');
