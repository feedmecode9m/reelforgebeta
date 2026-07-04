import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, '../artifacts/analytics');

let failed = false;

function assert(name, ok) {
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

try {
    execSync(`docker exec reelforge-db-1 psql -U user -d reelforge -c "TRUNCATE analytics_events;"`, {
        stdio: 'ignore'
    });
    console.log('PASS: analytics_events cleared');
} catch {
    console.log('WARN: could not truncate analytics_events');
}

function parseDiagLogs(logs, tag) {
    return logs
        .map((line) => {
            const match = line.match(new RegExp(`\\[${tag}\\]\\s*(\\{.*\\})`));
            if (!match) return null;
            try {
                return JSON.parse(match[1]);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

async function apiJson(path, options = {}) {
    const res = await fetch(`${BACKEND}${path}`, options);
    const body = await res.json().catch(() => ({}));
    return { res, body };
}

const { res: statusRes, body: statusBody } = await apiJson('/api/analytics/status');
assert('analytics API status reachable', statusRes.ok && statusBody.enabled === true);

const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[ANALYTICS_EVENT]') || text.includes('[ANALYTICS_AGGREGATE]')) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_platform_metrics');
});

await page.goto(`${FRONTEND}/`, { waitUntil: 'networkidle' });
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
    window.dispatchEvent(new CustomEvent('reelforge:metrics-updated'));
});

await page.waitForTimeout(1500);

const eventLogs = parseDiagLogs(logs, 'ANALYTICS_EVENT');
const aggregateLogs = parseDiagLogs(logs, 'ANALYTICS_AGGREGATE');
assert('ANALYTICS_EVENT emitted', eventLogs.length >= 4);
assert('ANALYTICS_AGGREGATE emitted', aggregateLogs.length >= 1);

const localCache = await page.evaluate(() => {
    const raw = localStorage.getItem('reelforge_platform_metrics');
    return raw ? JSON.parse(raw) : null;
});
assert('local analytics cache written', Array.isArray(localCache?.events) && localCache.events.length >= 4);

const { body: dbCount } = await apiJson('/api/analytics/status');
assert('events persisted in PostgreSQL', Number(dbCount.count) >= 4);

const { res: ingestRes, body: ingestBody } = await apiJson('/api/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        eventType: 'workflow_completion',
        userId: 'validator-user',
        seriesId: 'series-neon-vengeance',
        payload: { value: 1, meta: { source: 'validation' } }
    })
});
assert('POST /api/analytics', ingestRes.status === 201 && Number(ingestBody.ingested) >= 1);

const { res: dashboardRes, body: dashboardBody } = await apiJson('/api/analytics/dashboard');
assert('GET /api/analytics/dashboard', dashboardRes.ok && dashboardBody.dailyActiveViewers >= 0);
assert(
    'dashboard aggregate schema valid',
    Array.isArray(dashboardBody.mostWatchedEpisodes) &&
        typeof dashboardBody.studioProductivity === 'number' &&
        typeof dashboardBody.publishingVelocity === 'number'
);

const { res: seriesRes, body: seriesBody } = await apiJson(
    '/api/analytics/series/series-neon-vengeance'
);
assert('GET /api/analytics/series/:id', seriesRes.ok && seriesBody.eventCount >= 4);
assert('series aggregate publishing velocity', Number(seriesBody.publishingVelocity) >= 3);

await page.evaluate(async () => {
    if (window.__reelforgeMetrics.refreshAnalyticsSnapshot) {
        await window.__reelforgeMetrics.refreshAnalyticsSnapshot('series-neon-vengeance');
    }
});
await page.waitForTimeout(500);

await page.click('.ghost-trigger');
await page.waitForSelector('[data-operations-dashboard]', { timeout: 15000 });
await page.waitForTimeout(800);

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

assert('operations dashboard updates DAU', Number(dashboard.dau) >= 1);
assert('operations dashboard updates completion rate', dashboard.completion?.includes('%'));
assert('operations dashboard updates studio productivity', Number(dashboard.productivity) >= 1);
assert('operations dashboard updates publishing velocity', Number(dashboard.velocity) >= 3);
assert('operations dashboard lists most watched episodes', dashboard.watched.length >= 1);

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
assert('aggregation publishing velocity correct', snapshot.ops.publishingVelocity >= 3);

mkdirSync(SCREENSHOT_DIR, { recursive: true });
await page.screenshot({
    path: join(SCREENSHOT_DIR, 'operations-dashboard.png'),
    fullPage: false
});
console.log(`PASS: dashboard screenshot saved to ${join(SCREENSHOT_DIR, 'operations-dashboard.png')}`);

await browser.close();

console.log('\n=== Analytics Backend Validation ===\n');
if (failed) {
    console.log('ANALYTICS_BACKEND_COMPLETE=false');
    process.exit(1);
}

console.log('ANALYTICS_BACKEND_COMPLETE=true');
