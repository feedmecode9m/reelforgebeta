#!/usr/bin/env node
/**
 * Phase 47 — Next episode card navigation validation.
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
const diagLogs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[NEXT_EPISODE_CLICK]') || text.includes('[NEXT_EPISODE_NAVIGATE]')) {
        diagLogs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('reelforge_publishing_profile', 'netflix');
});

await page.goto(`${DEFAULT_BASE}/?publishing=netflix`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-reel-id]', { timeout: 15000 });

const firstReelId = await page.locator('[data-reel-id]').first().getAttribute('data-reel-id');
const secondReelId =
    (await page.locator('[data-reel-id]').nth(1).getAttribute('data-reel-id').catch(() => null)) ||
    firstReelId;

await page.evaluate(({ reelOneId, reelTwoId }) => {
    const key = 'reelforge_series_metadata';
    const map = JSON.parse(localStorage.getItem(key) || '{}');
    map[reelOneId] = {
        reelId: reelOneId,
        seriesId: 'series-neon-vengeance',
        seriesName: 'Neon Vengeance',
        seasonNumber: 1,
        episodeNumber: 1,
        episodeId: 'ep-neon-s01e01',
        episodeTitle: 'Ghost in the Grid',
        episodeStatus: 'published'
    };
    map[reelTwoId] = {
        reelId: reelTwoId,
        seriesId: 'series-neon-vengeance',
        seriesName: 'Neon Vengeance',
        seasonNumber: 1,
        episodeNumber: 2,
        episodeId: 'ep-neon-s01e02',
        episodeTitle: 'Blood Protocol',
        episodeStatus: 'published'
    };
    localStorage.setItem(key, JSON.stringify(map));
}, { reelOneId: firstReelId, reelTwoId: secondReelId });

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-reel-id]', { timeout: 15000 });

await page.evaluate(({ reelOneId, reelTwoId }) => {
    const map = JSON.parse(localStorage.getItem('reelforge_series_metadata') || '{}');
    window.dispatchEvent(new CustomEvent('reelforge:sync-applied', { detail: { seriesMetadata: map } }));
    return { reelOneId, reelTwoId, episodeIds: Object.values(map).map((entry) => entry.episodeId) };
}, { reelOneId: firstReelId, reelTwoId: secondReelId });

await page.locator(`[data-reel-id="${firstReelId}"]`).click();
await page.waitForSelector('[data-theater-container]', { timeout: 15000 });
await page.waitForSelector('[data-next-episode-card]', { timeout: 15000 });

assertRuntime(
    'theater opened with next episode card available',
    (await page.locator('[data-next-episode-card]').isVisible()) &&
        (await page.locator('[data-theater-container]').isVisible()),
    stats,
    { reelId: firstReelId, nextEpisodeId: await page.locator('[data-next-episode-card]').getAttribute('data-next-episode-id') }
);

const beforeReel = await page.evaluate(() => {
    const title = document.querySelector('.theater-title')?.textContent?.trim() || '';
    const nowPlaying = document.querySelector('.theater-series-panel__episode-title')?.textContent?.trim() || '';
    const nextLabel = document.querySelector('.next-episode-card__title')?.textContent?.trim() || '';
    return { title, nowPlaying, nextLabel };
});

await page.locator('[data-next-episode-card]').click();

assertRuntime(
    'next episode click diagnostic emitted',
    diagLogs.some((line) => line.includes('[NEXT_EPISODE_CLICK]')),
    stats
);

await page.waitForTimeout(700);

assertRuntime(
    'next episode navigate diagnostic emitted',
    diagLogs.some((line) => line.includes('[NEXT_EPISODE_NAVIGATE]')),
    stats
);

assertRuntime(
    'theater remains open after next episode navigation',
    await page.locator('[data-theater-container]').isVisible(),
    stats
);

const afterReel = await page.evaluate(() => {
    const title = document.querySelector('.theater-title')?.textContent?.trim() || '';
    const nowPlaying = document.querySelector('.theater-series-panel__episode-title')?.textContent?.trim() || '';
    return { title, nowPlaying };
});

const reelChanged =
    (afterReel.nowPlaying && afterReel.nowPlaying !== beforeReel.nowPlaying) ||
    (afterReel.title && afterReel.title !== beforeReel.title) ||
    /E2/i.test(afterReel.nowPlaying || '') ||
    /Blood Protocol/i.test(afterReel.nowPlaying || afterReel.title || '');

assertRuntime('theater reel changed after next episode card click', reelChanged, stats, {
    before: beforeReel,
    after: afterReel
});

await browser.close();
emitTruthSummary(stats, 'NEXT_EPISODE_CARD_COMPLETE=true');
