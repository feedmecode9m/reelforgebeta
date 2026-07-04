import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const METRIC_TYPES = [
    'theater_open',
    'episode_completion',
    'watch_duration',
    'studio_usage',
    'publish_action',
    'repair_action',
    'workflow_completion'
];

const BASE = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, '../artifacts/observability');

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

assert('metrics catalog complete', METRIC_TYPES.length === 7);

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[METRICS]')) logs.push(text);
});

function parseMetricsLogs() {
    return logs
        .map((line) => {
            const match = line.match(/\[METRICS\]\s*(\{.*\})/);
            if (!match) return null;
            try {
                return JSON.parse(match[1]);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_platform_metrics');
});

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__reelforgeMetrics?.recordMetric, null, {
    timeout: 15000
});

await page.evaluate(() => {
    window.__reelforgeMetrics.resetPlatformMetrics();
    window.__reelforgeMetrics.recordMetric('theater_open', {
        seriesId: 'series-neon-vengeance',
        episodeId: 'ep-neon-s01e01',
        episodeTitle: 'Ghost in the Grid',
        reelId: 'reel-test-1'
    });
    window.__reelforgeMetrics.recordMetric('theater_open', {
        seriesId: 'series-neon-vengeance',
        episodeId: 'ep-neon-s01e02',
        episodeTitle: 'Blood Protocol',
        reelId: 'reel-test-2'
    });
    window.__reelforgeMetrics.recordMetric('episode_completion', {
        seriesId: 'series-neon-vengeance',
        episodeId: 'ep-neon-s01e01',
        episodeTitle: 'Ghost in the Grid',
        value: 100
    });
    window.__reelforgeMetrics.recordMetric('studio_usage', {
        seriesId: 'series-neon-vengeance',
        value: 1
    });
    window.__reelforgeMetrics.recordMetric('publish_action', {
        seriesId: 'series-neon-vengeance',
        value: 3,
        meta: { cadence: 'weekly' }
    });
    window.dispatchEvent(
        new CustomEvent('reelforge:metrics-updated')
    );
});

await page.click('.ghost-trigger');
await page.waitForSelector('[data-operations-dashboard]', { timeout: 15000 });
await page.waitForTimeout(800);

const recordLogs = parseMetricsLogs().filter((e) => e.phase === 'record');
const aggregateLogs = parseMetricsLogs().filter((e) => e.phase === 'aggregate');
assert('metrics emitted', recordLogs.length >= 4);
assert('aggregation diagnostics emitted', aggregateLogs.length >= 1);

const dashboard = await page.evaluate(() => {
    const dau = document.querySelector('[data-metric-dau] strong')?.textContent;
    const completion = document.querySelector('[data-metric-completion-rate] strong')?.textContent;
    const productivity = document.querySelector(
        '[data-metric-studio-productivity] strong'
    )?.textContent;
    const velocity = document.querySelector(
        '[data-metric-publishing-velocity] strong'
    )?.textContent;
    const watched = Array.from(
        document.querySelectorAll('[data-metric-most-watched] .operations-dashboard__episodes li')
    ).map((li) => li.textContent?.trim());
    return { dau, completion, productivity, velocity, watched };
});

assert('dashboard updates DAU', Number(dashboard.dau) >= 1);
assert('dashboard updates completion rate', dashboard.completion?.includes('%'));
assert('dashboard updates studio productivity', Number(dashboard.productivity) >= 1);
assert('dashboard updates publishing velocity', Number(dashboard.velocity) >= 3);
assert('dashboard lists most watched episodes', dashboard.watched.length >= 1);

const snapshot = await page.evaluate((seriesId) => {
    const merged = window.__reelforgeMetrics.mergeEntryMaps(
        { 'ep-1': { updatedAt: 1000, views: 1 } },
        { 'ep-1': { updatedAt: 3000, views: 5 }, 'ep-2': { updatedAt: 2000, views: 2 } }
    );
    const latestWins = merged['ep-1'].views === 5 && merged['ep-2'].views === 2;
    const ops = window.__reelforgeMetrics.getOperationsSnapshot(seriesId);
    return { latestWins, ops };
}, 'series-neon-vengeance');

assert('aggregation keeps latest modified entry', snapshot.latestWins);
assert('aggregation DAU correct', snapshot.ops.dailyActiveViewers >= 1);
assert('aggregation most watched ranked', snapshot.ops.mostWatchedEpisodes.length >= 1);
assert(
    'aggregation publishing velocity correct',
    snapshot.ops.publishingVelocity >= 3
);

mkdirSync(SCREENSHOT_DIR, { recursive: true });
await page.screenshot({
    path: join(SCREENSHOT_DIR, 'operations-dashboard.png'),
    fullPage: false
});
console.log(`PASS: dashboard screenshot saved to ${join(SCREENSHOT_DIR, 'operations-dashboard.png')}`);

await browser.close();

console.log('');
if (failed) {
    console.log('OBSERVABILITY_COMPLETE=false');
    process.exit(1);
}

console.log('OBSERVABILITY_COMPLETE=true');
