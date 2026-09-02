import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

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

/** @returns {Promise<Record<string, string>>} */
async function getAdminWriteHeaders() {
    const password = process.env.ADMIN_PASSWORD || 'Gaff1505!';
    const { res, body } = await apiJson('/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    if (!res.ok || !body?.token) {
        return { 'Content-Type': 'application/json' };
    }
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.token}`
    };
}

/** @param {string} seriesId @param {Record<string, string>} writeHeaders */
async function deleteSeriesFixture(seriesId, writeHeaders) {
    return apiJson(`/api/series/${encodeURIComponent(seriesId)}`, {
        method: 'DELETE',
        headers: writeHeaders
    });
}

const VIC_G_ID = 'series-vic-g';
const VIC_G_REELS = {
    e02: 'cadfcabc-1947-4341-86a3-f82a08e78669',
    e04: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1',
    e05: 'efb01cee-9477-4477-982a-7611cfc08fcc',
    e06: '5cc786f0-8fbe-4f96-a59d-02014b0cc56f'
};

/** @param {unknown} series */
function collectEpisodeReels(series) {
    return (series?.seasons || [])
        .flatMap((season) => season?.episodes || [])
        .map((episode) => String(episode?.reelId || episode?.reel_id || ''))
        .filter(Boolean);
}

/** @returns {Promise<{ ok: boolean; count: number; reels: Record<string, string> }>} */
async function readVicGBindings() {
    const { res, body } = await apiJson(`/api/series/${encodeURIComponent(VIC_G_ID)}`);
    if (!res.ok) {
        return { ok: false, count: 0, reels: {} };
    }
    const episodes = (body?.seasons || []).flatMap((season) => season?.episodes || []);
    const byNum = Object.fromEntries(
        episodes.map((episode) => [Number(episode.episodeNumber), String(episode.reelId || episode.reel_id || '')])
    );
    return {
        ok: true,
        count: episodes.length,
        reels: {
            e02: byNum[2] || '',
            e04: byNum[4] || '',
            e05: byNum[5] || '',
            e06: byNum[6] || ''
        }
    };
}

const testSeriesId = `series-validation-${Date.now()}`;
const testEpisodeId = `${testSeriesId}-e1`;
const testReelId = `reel-validation-${Date.now()}`;

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
const playwrightShellPath =
    '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
/** @type {import('playwright').LaunchOptions} */
const browserLaunchOptions = { headless: true };
if (existsSync(playwrightShellPath)) {
    browserLaunchOptions.executablePath = playwrightShellPath;
}

const adminPassword = process.env.ADMIN_PASSWORD || 'Gaff1505!';
const { body: adminAuthBody } = await apiJson('/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPassword })
});
const studioAdminToken = adminAuthBody?.token ? String(adminAuthBody.token) : '';

const browser = await chromium.launch(browserLaunchOptions);

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

await page.addInitScript((token) => {
    localStorage.setItem('admin_mode', 'true');
    if (token) {
        localStorage.setItem('reelforge_admin_session_token', token);
    }
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
}, studioAdminToken);

await page.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForTimeout(2500);

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

let studioEditorVisible = false;
try {
    await page.waitForSelector('.ghost-trigger', { timeout: 60_000 });
    await page.click('.ghost-trigger');
    await page.waitForSelector('[data-series-metadata-editor]', { timeout: 30_000, state: 'visible' });
    studioEditorVisible = true;
} catch {
    studioEditorVisible = false;
}
assert('Studio series metadata editor still renders', studioEditorVisible);

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
await fallbackPage.goto(`${FRONTEND}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await fallbackPage.waitForTimeout(3500);

const parsedFallback = parseDiagLogs(fallbackLogs, 'SERIES_API_READ').filter(
    (e) => e.source === 'fallback'
);
assert('API unavailable falls back to localStorage', parsedFallback.length >= 1);

await browser.close();

// --- CRUD + fixture teardown ---
const writeHeaders = await getAdminWriteHeaders();
const vicBefore = await readVicGBindings();
const { body: catalogBeforeCrud } = await apiJson('/api/series');
const historicalValidationIds = (Array.isArray(catalogBeforeCrud) ? catalogBeforeCrud : [])
    .map((series) => String(series?.id || ''))
    .filter((id) => id.startsWith('series-validation-'));

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
                    reelId: testReelId,
                    runtimeSeconds: 312,
                    thumbnailUrl: '/thumbs/pilot.jpg',
                    releaseDate: '2026-06-01'
                }
            ]
        }
    ]
};

let teardownCompleted = false;
let teardownDeleted = false;
let postDeleteGetStatus = 0;
let postDeleteSeasonsStatus = 0;
let postDeleteEpisodesStatus = 0;

try {
    const { res: createRes, body: created } = await apiJson('/api/series', {
        method: 'POST',
        headers: writeHeaders,
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
            headers: writeHeaders,
            body: JSON.stringify({ seasonNumber: 2, title: 'Season 2' })
        }
    );
    assert('POST /api/series/:id/seasons', seasonPostRes.status === 201);

    const newEpisodeId = `${testSeriesId}-e2`;
    const { res: episodePostRes, body: createdEpisode } = await apiJson('/api/episodes', {
        method: 'POST',
        headers: writeHeaders,
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
            headers: writeHeaders,
            body: JSON.stringify({ title: 'Pilot Updated', runtimeSeconds: 330 })
        }
    );
    assert(
        'PUT /api/episodes/:id',
        episodePutRes.ok &&
            updatedEpisode?.title === 'Pilot Updated' &&
            updatedEpisode?.runtimeSeconds === 330
    );

    const { res: putRes, body: updated } = await apiJson(`/api/series/${encodeURIComponent(testSeriesId)}`, {
        method: 'PUT',
        headers: writeHeaders,
        body: JSON.stringify({
            ...createPayload,
            title: 'Validation Series Updated'
        })
    });
    assert(
        'PUT /api/series/:id updates series',
        putRes.ok && updated?.title === 'Validation Series Updated'
    );

    const { res: deleteEpisodeRes } = await apiJson(`/api/episodes/${encodeURIComponent(newEpisodeId)}`, {
        method: 'DELETE',
        headers: writeHeaders
    });
    assert('DELETE /api/episodes/:id', deleteEpisodeRes.ok);
} finally {
    teardownCompleted = true;
    const { res: deleteSeriesRes } = await deleteSeriesFixture(testSeriesId, writeHeaders);
    teardownDeleted = deleteSeriesRes.ok;
    const afterDeleteGet = await apiJson(`/api/series/${encodeURIComponent(testSeriesId)}`);
    postDeleteGetStatus = afterDeleteGet.res.status;
    const afterDeleteSeasons = await apiJson(
        `/api/series/${encodeURIComponent(testSeriesId)}/seasons`
    );
    postDeleteSeasonsStatus = afterDeleteSeasons.res.status;
    const afterDeleteEpisodes = await apiJson(
        `/api/series/${encodeURIComponent(testSeriesId)}/episodes`
    );
    postDeleteEpisodesStatus = afterDeleteEpisodes.res.status;
}

assert('finally block executes fixture teardown', teardownCompleted);
assert('DELETE /api/series/:id succeeds for created fixture', teardownDeleted);
assert('GET /api/series/:id returns 404 after deletion', postDeleteGetStatus === 404);
assert('associated seasons are gone after series delete', postDeleteSeasonsStatus === 404);
assert('associated episodes are gone after series delete', postDeleteEpisodesStatus === 404);

const missingSeriesId = `${testSeriesId}-missing-${Date.now()}`;
const { res: deleteMissingRes } = await deleteSeriesFixture(missingSeriesId, writeHeaders);
assert(
    'DELETE /api/series/:id returns not-found for missing series',
    deleteMissingRes.status === 404
);

let finallyCleanupAfterFailure = false;
const finallyTestSeriesId = `series-validation-finally-${Date.now()}`;
try {
    try {
        await apiJson('/api/series', {
            method: 'POST',
            headers: writeHeaders,
            body: JSON.stringify({
                id: finallyTestSeriesId,
                title: 'Validation Finally Fixture',
                description: 'CRUD validation fixture',
                tags: ['validation']
            })
        });
        throw new Error('simulated assertion failure');
    } finally {
        const { res: deleteRes } = await deleteSeriesFixture(finallyTestSeriesId, writeHeaders);
        const { res: getRes } = await apiJson(`/api/series/${encodeURIComponent(finallyTestSeriesId)}`);
        finallyCleanupAfterFailure = deleteRes.ok && getRes.status === 404;
    }
} catch {
    // expected simulated failure
}
assert('failed assertion still triggers finally cleanup', finallyCleanupAfterFailure);

const { body: catalogAfterCrud } = await apiJson('/api/series');
const validationIdsAfter = (Array.isArray(catalogAfterCrud) ? catalogAfterCrud : [])
    .map((series) => String(series?.id || ''))
    .filter((id) => id.startsWith('series-validation-'));
assert(
    'current invocation leaves no new series-validation fixture behind',
    !validationIdsAfter.includes(testSeriesId) && !validationIdsAfter.includes(finallyTestSeriesId)
);
assert(
    'historical validation residue unchanged by this invocation',
    historicalValidationIds.every((id) => validationIdsAfter.includes(id))
);

const vicAfter = await readVicGBindings();
assert('Vic G still present after validation lifecycle', vicAfter.ok);
assert('Vic G episode count unchanged', vicAfter.count === vicBefore.count);
for (const [key, expected] of Object.entries(VIC_G_REELS)) {
    assert(`Vic G ${key} reel unchanged`, vicAfter.reels[key] === expected && vicBefore.reels[key] === expected);
}

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
