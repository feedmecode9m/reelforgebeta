#!/usr/bin/env node
/**
 * Phase 48 — Watch tracking hardening validation.
 * Verifies local-only and API-backed resolver paths + refresh/reopen restoration.
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
    assertRuntime,
    createTruthStats,
    emitTruthSummary,
    launchTruthBrowser,
    DEFAULT_BASE
} from './lib/validation-truth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COVERAGE_REPORT_PATH = join(ROOT, 'watch-progress-coverage-report.json');

const stats = createTruthStats();
const browser = await launchTruthBrowser();
const page = await browser.newPage();

/** @type {string[]} */
const watchProgressLogs = [];
/** @type {string[]} */
const watchSyncLogs = [];
/** @type {string[]} */
const watchRestoreLogs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[WATCH_PROGRESS]')) watchProgressLogs.push(text);
    if (text.includes('[WATCH_SYNC]')) watchSyncLogs.push(text);
    if (text.includes('[WATCH_RESTORE]')) watchRestoreLogs.push(text);
});

await page.addInitScript(() => {
    localStorage.setItem('reelforge_publishing_profile', 'netflix');
});

await page.goto(`${DEFAULT_BASE}/?publishing=netflix`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[data-reel-id]', { timeout: 15000 });
await page.evaluate(() => {
    localStorage.removeItem('reelforge_series_watch_progress');
    localStorage.removeItem('reelforge_series_watch_progress_meta');
});

const reelIds = await page.evaluate(() =>
    [...document.querySelectorAll('[data-reel-id]')]
        .map((el) => el.getAttribute('data-reel-id'))
        .filter(Boolean)
        .slice(0, 2)
);
const firstReelId = reelIds[0] || null;
const secondReelId = reelIds[1] || firstReelId;

assertRuntime('feed reels available for watch validation', Boolean(firstReelId), stats, {
    firstReelId,
    secondReelId
});

await page.evaluate(
    ({ reelOneId, reelTwoId }) => {
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
        window.dispatchEvent(new CustomEvent('reelforge:sync-applied', { detail: { seriesMetadata: map } }));
    },
    { reelOneId: firstReelId, reelTwoId: secondReelId }
);

await page.locator(`[data-reel-id="${firstReelId}"]`).click();
await page.waitForSelector('[data-theater-container]', { timeout: 15000 });
await page.waitForSelector('[data-theater-video]', { timeout: 15000 });

const watched = await page.evaluate(async ({ episodeId, reelId }) => {
    const api = window.__reelforgeWatchTracking;
    if (!api) return { ok: false, reason: 'missing-watch-api' };
    await api.watchSessionStart({ reelId, episodeId });
    const duration = 60;
    const watchedSeconds = 19.2;
    await api.watchOnPause({ currentTime: watchedSeconds, duration });
    const map = JSON.parse(localStorage.getItem('reelforge_series_watch_progress') || '{}');
    return {
        ok: true,
        watchedSeconds,
        duration,
        episodePercent: Number(map[episodeId] ?? 0),
        reelPercent: Number(map[reelId] ?? 0),
        mapSize: Object.keys(map).length
    };
}, { episodeId: 'ep-neon-s01e01', reelId: firstReelId });

assertRuntime('watch pause persists local progress', watched.ok && watched.episodePercent > 0, stats, {
    watchedSeconds: watched.watchedSeconds || 0,
    duration: watched.duration || 0,
    episodePercent: watched.episodePercent || 0,
    reelPercent: watched.reelPercent || 0,
    mapSize: watched.mapSize || 0,
    reason: watched.reason || null
});

const resolvedLocal = await page.evaluate(
    ({ episodeId, reelId }) =>
        window.__reelforgeWatchTracking.resolveWatchProgress(episodeId, reelId, {
            preferApi: false,
            restoreContext: 'manual'
        }),
    { episodeId: 'ep-neon-s01e01', reelId: firstReelId }
);

assertRuntime(
    'local-only resolver path returns persisted percent',
    resolvedLocal?.source === 'local' && Number(resolvedLocal.percent || 0) > 0 && !resolvedLocal.apiAttempted,
    stats,
    resolvedLocal || {}
);

const resolvedApi = await page.evaluate(
    ({ episodeId, reelId }) =>
        window.__reelforgeWatchTracking.resolveWatchProgress(episodeId, reelId, {
            preferApi: true,
            syncToLocal: true,
            restoreContext: 'background'
        }),
    { episodeId: 'ep-neon-s01e01', reelId: firstReelId }
);

assertRuntime(
    'API-backed resolver path executes with safe fallback',
    Boolean(resolvedApi && resolvedApi.apiAttempted === true && Number(resolvedApi.percent || 0) > 0),
    stats,
    resolvedApi || {}
);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-reel-id]', { timeout: 15000 });
await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem('reelforge_series_metadata') || '{}');
    window.dispatchEvent(new CustomEvent('reelforge:sync-applied', { detail: { seriesMetadata: map } }));
});
await page.locator(`[data-reel-id="${firstReelId}"]`).click();
await page.waitForSelector('[data-theater-container]', { timeout: 15000 });

const restored = await page.evaluate(() => {
    const badge = document.querySelector('[data-continue-watching]');
    const value = badge?.querySelector('.continue-watching__value')?.textContent || '';
    const percent = Number(String(value).replace('%', '').trim() || 0);
    const map = JSON.parse(localStorage.getItem('reelforge_series_watch_progress') || '{}');
    const stored = Number(map['ep-neon-s01e01'] ?? 0);
    return {
        badgeVisible: Boolean(badge),
        badgePercent: percent,
        storedPercent: stored
    };
});

assertRuntime(
    'progress restored after refresh and reopen',
    restored.badgeVisible && restored.badgePercent > 0 && Math.abs(restored.badgePercent - restored.storedPercent) <= 3,
    stats,
    restored
);

assertRuntime('WATCH_PROGRESS diagnostics emitted', watchProgressLogs.length >= 1, stats, {
    count: watchProgressLogs.length
});
assertRuntime('WATCH_SYNC diagnostics emitted', watchSyncLogs.length >= 1, stats, {
    count: watchSyncLogs.length
});
assertRuntime('WATCH_RESTORE diagnostics emitted', watchRestoreLogs.length >= 1, stats, {
    count: watchRestoreLogs.length
});

await browser.close();

const coverage = {
    generatedAt: new Date().toISOString(),
    phase: 48,
    objective: 'Watch tracking hardening without hidden toggles',
    auditedFiles: [
        'src/lib/watch/watchTracker.js',
        'src/lib/api/watch.js',
        'src/lib/series/seriesWatchProgress.js',
        'src/components/series/ContinueWatchingBadge.svelte'
    ],
    unifiedResolver: 'src/lib/series/seriesWatchProgress.js::resolveWatchProgress',
    validation: {
        runtimeChecks: stats.runtimeChecks,
        runtimePassed: stats.runtimePassed,
        failed: stats.failed
    },
    pathVerification: {
        localOnly: resolvedLocal,
        apiBacked: resolvedApi
    },
    restore: restored,
    diagnostics: {
        WATCH_PROGRESS: watchProgressLogs.length,
        WATCH_SYNC: watchSyncLogs.length,
        WATCH_RESTORE: watchRestoreLogs.length
    },
    watched: {
        success: watched.ok,
        watchedSeconds: watched.watchedSeconds || 0,
        episodePercent: watched.episodePercent || 0,
        reelPercent: watched.reelPercent || 0
    },
    successToken: stats.failed
        ? 'WATCH_TRACKING_HARDENING_COMPLETE=false'
        : 'WATCH_TRACKING_HARDENING_COMPLETE=true'
};

writeFileSync(COVERAGE_REPORT_PATH, JSON.stringify(coverage, null, 2));
console.log(
    `[WATCH_COVERAGE_REPORT] ${JSON.stringify({ path: COVERAGE_REPORT_PATH, failed: stats.failed })}`
);

emitTruthSummary(stats, 'WATCH_TRACKING_HARDENING_COMPLETE=true');
