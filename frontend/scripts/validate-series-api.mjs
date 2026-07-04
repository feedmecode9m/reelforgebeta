import { chromium } from 'playwright';
import { execSync } from 'node:child_process';

const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:4190';
const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';

try {
    execSync(
        'docker exec reelforge-db-1 psql -U user -d reelforge -c "TRUNCATE episodes, seasons, series CASCADE;"',
        { stdio: 'ignore' }
    );
    console.log('PASS: series tables cleared for migration test');
} catch {
    console.log('WARN: could not truncate series tables (migration test may be affected)');
}

let failed = false;
const checks = [];

function assert(name, ok) {
    checks.push({ name, ok });
    if (!ok) {
        failed = true;
        console.log(`FAIL: ${name}`);
    } else {
        console.log(`PASS: ${name}`);
    }
}

async function apiJson(path, options = {}) {
    const res = await fetch(`${BACKEND}${path}`, options);
    const body = await res.json().catch(() => ({}));
    return { res, body };
}

const testSeriesId = `series-validation-${Date.now()}`;
const testEpisodeId = `${testSeriesId}-e1`;

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

// --- Migration + fallback (Playwright) ---
const browser = await chromium.launch({
    headless: true,
    executablePath:
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'
});

const page = await browser.newPage();
const logs = [];

page.on('console', (msg) => {
    const text = msg.text();
    if (
        text.includes('[SERIES_API_READ]') ||
        text.includes('[SERIES_API_WRITE]') ||
        text.includes('[SERIES_API_SYNC]')
    ) {
        logs.push(text);
    }
});

await page.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.removeItem('reelforge_series_api_migrated');
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({
            'reel-migrate-001': {
                reelId: 'reel-migrate-001',
                episodeId: 'ep-migrate-001',
                seriesId: 'series-migrate-test',
                seasonNumber: 1,
                episodeNumber: 1,
                seriesName: 'Migrate Test Series',
                episodeTitle: 'Migration Episode',
                episodeStatus: 'published',
                genre: 'Drama',
                description: 'Migration fixture',
                runtime: 240,
                releaseYear: 2025,
                updatedAt: Date.now()
            }
        })
    );
});

await page.goto(`${FRONTEND}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

assert('series API hook initialized', await page.evaluate(() => Boolean(window.__reelforgeSeriesApi)));

const readLogs = parseDiagLogs(logs, 'SERIES_API_READ');
const syncLogs = parseDiagLogs(logs, 'SERIES_API_SYNC');
const migrated =
    syncLogs.some((e) => e.phase === 'migrate-complete' || e.source === 'migrated') ||
    readLogs.some((e) => e.source === 'api' || e.source === 'migrated');
assert('localStorage migration to API', migrated);
assert('SERIES_API_READ emitted', readLogs.length >= 1);
assert('SERIES_API_SYNC emitted', syncLogs.length >= 1);

const migratedFlag = await page.evaluate(() => localStorage.getItem('reelforge_series_api_migrated'));
assert('migration flag set', migratedFlag === 'true');

const localStillPresent = await page.evaluate(() =>
    Boolean(localStorage.getItem('reelforge_series_metadata'))
);
assert('localStorage preserved as offline cache', localStillPresent);

await page.click('.ghost-trigger');
await page.waitForSelector('[data-series-metadata-editor]', { timeout: 15000 });
assert('Studio series metadata editor still renders', true);

const fallbackPage = await browser.newPage();
const fallbackLogs = [];
fallbackPage.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[SERIES_API_READ]')) fallbackLogs.push(text);
});

await fallbackPage.route(/\/api\/series/, (route) => route.abort('failed'));
await fallbackPage.addInitScript(() => {
    localStorage.setItem('admin_mode', 'true');
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({
            'reel-fallback-001': {
                reelId: 'reel-fallback-001',
                seriesName: 'Fallback Series',
                seasonNumber: 1,
                episodeNumber: 1,
                episodeTitle: 'Fallback Episode',
                episodeStatus: 'draft',
                updatedAt: Date.now()
            }
        })
    );
});
await fallbackPage.goto(`${FRONTEND}/`, { waitUntil: 'networkidle' });
await fallbackPage.waitForTimeout(3500);

const parsedFallback = parseDiagLogs(fallbackLogs, 'SERIES_API_READ').filter(
    (e) => e.source === 'fallback'
);
assert('API unavailable falls back to localStorage', parsedFallback.length >= 1);

await browser.close();

// --- CRUD ---
const { res: statusRes, body: statusBody } = await apiJson('/api/series/status');
assert('series API status reachable', statusRes.ok && statusBody.enabled === true);

const createPayload = {
    id: testSeriesId,
    title: 'Validation Series',
    description: 'CRUD validation fixture',
    genre: 'Test',
    releaseYear: 2026,
    tags: ['validation'],
    seasons: [
        {
            seasonId: `${testSeriesId}-s1`,
            seasonNumber: 1,
            title: 'Season 1',
            episodes: [
                {
                    episodeId: testEpisodeId,
                    episodeNumber: 1,
                    title: 'Pilot',
                    status: 'published',
                    reelId: 'reel-validation-001',
                    runtimeSeconds: 312,
                    thumbnailUrl: '/thumbs/pilot.jpg',
                    releaseDate: '2026-06-01'
                }
            ]
        }
    ]
};

const { res: createRes, body: created } = await apiJson('/api/series', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createPayload)
});
assert('POST /api/series creates series', createRes.status === 201 && created?.id === testSeriesId);

const { res: listRes, body: listBody } = await apiJson('/api/series');
assert(
    'GET /api/series lists series',
    listRes.ok && Array.isArray(listBody) && listBody.some((s) => s.id === testSeriesId)
);

const { res: getRes, body: got } = await apiJson(`/api/series/${encodeURIComponent(testSeriesId)}`);
assert(
    'GET /api/series/:id returns tree',
    getRes.ok && got?.seasons?.[0]?.episodes?.[0]?.episodeId === testEpisodeId
);

const { res: seasonsRes, body: seasonsBody } = await apiJson(
    `/api/series/${encodeURIComponent(testSeriesId)}/seasons`
);
assert(
    'GET /api/series/:id/seasons',
    seasonsRes.ok && Array.isArray(seasonsBody) && seasonsBody[0]?.seasonNumber === 1
);

const { res: episodesRes, body: episodesBody } = await apiJson(
    `/api/series/${encodeURIComponent(testSeriesId)}/episodes`
);
assert(
    'GET /api/series/:id/episodes',
    episodesRes.ok &&
        Array.isArray(episodesBody) &&
        episodesBody[0]?.id === testEpisodeId &&
        episodesBody[0]?.runtimeSeconds === 312
);

const { res: seasonPostRes } = await apiJson(
    `/api/series/${encodeURIComponent(testSeriesId)}/seasons`,
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonNumber: 2, title: 'Season 2' })
    }
);
assert('POST /api/series/:id/seasons', seasonPostRes.status === 201);

const newEpisodeId = `${testSeriesId}-e2`;
const { res: episodePostRes, body: createdEpisode } = await apiJson('/api/episodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        id: newEpisodeId,
        seriesId: testSeriesId,
        seasonNumber: 2,
        episodeNumber: 1,
        title: 'Season 2 Premiere',
        runtimeSeconds: 280,
        status: 'ready'
    })
});
assert(
    'POST /api/episodes',
    episodePostRes.status === 201 && createdEpisode?.id === newEpisodeId
);

const { res: episodePutRes, body: updatedEpisode } = await apiJson(
    `/api/episodes/${encodeURIComponent(testEpisodeId)}`,
    {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Pilot Updated', runtimeSeconds: 330 })
    }
);
assert(
    'PUT /api/episodes/:id',
    episodePutRes.ok && updatedEpisode?.title === 'Pilot Updated' && updatedEpisode?.runtimeSeconds === 330
);

const { res: putRes, body: updated } = await apiJson(`/api/series/${encodeURIComponent(testSeriesId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        ...createPayload,
        title: 'Validation Series Updated'
    })
});
assert(
    'PUT /api/series/:id updates series',
    putRes.ok && updated?.title === 'Validation Series Updated'
);

const { res: deleteRes } = await apiJson(`/api/episodes/${encodeURIComponent(newEpisodeId)}`, {
    method: 'DELETE'
});
assert('DELETE /api/episodes/:id', deleteRes.ok);

console.log('\n=== Series Metadata API Validation ===\n');
for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
}

console.log('');
if (failed) {
    console.log('SERIES_METADATA_API_COMPLETE=false');
    process.exit(1);
}

console.log('SERIES_METADATA_API_COMPLETE=true');
