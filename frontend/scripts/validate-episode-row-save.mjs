#!/usr/bin/env node
/**
 * Episode-row Save ownership repair — canonical episode metadata PUT/POST.
 *
 * Proves:
 *   1) episodeToApiRowPayload omits structural binding fields
 *   2) Creator Catalog episode Save persists via PUT /api/episodes/:id
 *   3) Vic G reel IDs unchanged after episode row save
 *   4) Empty series still yields null viewer projection
 *   5) API failure is not reported as successful canonical Save
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const VIC_G_ID = 'series-vic-g';
const EPISODE_ID = 'ep-vic-g-s01e02';
const REEL = {
    e02: 'cadfcabc-1947-4341-86a3-f82a08e78669',
    e04: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1'
};

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}

const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    location: { hostname: '127.0.0.1', href: 'http://127.0.0.1:5173/' },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

/** @param {unknown} body @param {number} status */
function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

/** @param {import('../src/lib/series/seriesTypes.js').Series | null | undefined} series */
function collectReelIds(series) {
    return (series?.seasons || [])
        .flatMap((s) => s.episodes || [])
        .map((e) => String(e.reelId || ''))
        .filter(Boolean);
}

const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});

try {
    const seriesApi = await server.ssrLoadModule('/src/lib/api/seriesApi.js');
    const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
    const vicG = await server.ssrLoadModule('/src/lib/series/vicGSeriesPackage.js');
    const projection = await server.ssrLoadModule('/src/lib/series/viewerProductionProjection.js');
    const adminSession = await server.ssrLoadModule('/src/lib/adminSession.js');

    console.log('\n[1] episodeToApiRowPayload shape');
    {
        const base = vicG.buildVicGSeriesPackage();
        const season = base.seasons?.[0];
        const episode = season?.episodes?.find((e) => e.episodeId === EPISODE_ID);
        assert(Boolean(episode), 'Vic G episode fixture available');
        const payload = seriesApi.episodeToApiRowPayload({
            series: base,
            season: season || { seasonNumber: 1, episodes: [] },
            episode: episode || { episodeId: EPISODE_ID, episodeNumber: 2, title: '', status: 'draft' }
        });
        assert(!('reelId' in payload), 'row payload omits reelId');
        assert(!('seriesId' in payload), 'row payload omits seriesId');
        assert(!('seasonNumber' in payload), 'row payload omits seasonNumber');
        assert(!('episodeNumber' in payload), 'row payload omits episodeNumber');
        assert(payload.title === episode?.title, 'payload carries episode title');
        assert('description' in payload, 'payload includes description');
        assert('status' in payload, 'payload includes status');

        const emptyShell = {
            ...base,
            seasons: [{ seasonId: 'season-empty', seasonNumber: 1, title: 'Season 1', episodes: [] }]
        };
        assert(
            projection.buildViewerProductionProjection(emptyShell, {}) === null,
            'empty series shell returns null viewer projection'
        );
    }

    console.log('\n[2–6] persistEpisodeRowToApi mock flow');
    /** @type {Record<string, unknown> | null} */
    let capturedPut = null;
    /** @type {import('../src/lib/series/seriesTypes.js').Series | null} */
    let apiSeriesSnapshot = null;

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        const method = options.method || 'GET';

        if (href.includes('/api/series/status')) {
            return jsonResponse({ enabled: true, count: 1 });
        }

        if (method === 'PUT' && href.includes(`/api/episodes/${encodeURIComponent(EPISODE_ID)}`)) {
            capturedPut = JSON.parse(String(options.body || '{}'));
            const episodes = (apiSeriesSnapshot?.seasons || []).flatMap((s) => s.episodes || []);
            const hit = episodes.find((e) => e.episodeId === EPISODE_ID);
            if (hit) {
                Object.assign(hit, capturedPut);
            }
            return jsonResponse({
                episodeId: EPISODE_ID,
                ...capturedPut,
                reelId: REEL.e02
            });
        }

        if (method === 'GET' && href.includes(`/api/series/${encodeURIComponent(VIC_G_ID)}`)) {
            return jsonResponse(apiSeriesSnapshot);
        }

        if (typeof nativeFetch === 'function') {
            return nativeFetch(url, options);
        }
        return jsonResponse({ error: 'unexpected fetch' }, 404);
    };

    adminSession.setAdminSessionToken('validate-episode-row-save-token');

    const vicBase = vicG.buildVicGSeriesPackage();
    apiSeriesSnapshot = structuredClone(vicBase);
    store.applyAuthoritativeApiCatalog([structuredClone(vicBase)]);

    const beforeReels = collectReelIds(store.getSeriesById(VIC_G_ID));

    store.updateCatalogEpisode(EPISODE_ID, {
        title: 'Episode 02 Canonical Save',
        description: 'Canonical episode synopsis'
    });
    const saveResult = await store.persistEpisodeRowToApi(EPISODE_ID);

    assert(saveResult.ok === true, 'episode row Save reports canonical API success');
    assert(capturedPut != null, 'PUT /api/episodes/:id was invoked');
    assert(capturedPut?.title === 'Episode 02 Canonical Save', 'PUT persists edited title');
    assert(
        capturedPut?.description === 'Canonical episode synopsis',
        'PUT persists edited description'
    );
    assert(!('reelId' in (capturedPut || {})), 'PUT payload does not include reelId');

    const afterLocal = store.getEpisodeById(EPISODE_ID);
    assert(afterLocal?.episode?.title === 'Episode 02 Canonical Save', 'local catalog carries saved title');
    assert(collectReelIds(store.getSeriesById(VIC_G_ID)).length === beforeReels.length, 'Vic G reel count unchanged');
    for (const reelId of Object.values(REEL)) {
        assert(collectReelIds(store.getSeriesById(VIC_G_ID)).includes(reelId), `Vic G reel ${reelId} unchanged`);
    }

    const hydratedSeries = structuredClone(apiSeriesSnapshot);
    store.applyAuthoritativeApiCatalog([hydratedSeries]);
    const hydratedCtx = store.getEpisodeById(EPISODE_ID);
    assert(
        hydratedCtx?.episode?.title === 'Episode 02 Canonical Save',
        'fresh hydrate returns edited canonical episode title'
    );

    const viewer = projection.buildViewerProductionProjection(store.getSeriesById(VIC_G_ID), {});
    assert(viewer != null, 'Vic G with episodes still projects for viewer');
    assert(viewer.title === store.getSeriesById(VIC_G_ID)?.title, 'viewer projection still uses series title');

    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        if (href.includes('/api/series/status')) {
            return jsonResponse({ enabled: true, count: 1 });
        }
        if (options.method === 'PUT' && href.includes(`/api/episodes/${encodeURIComponent(EPISODE_ID)}`)) {
            return jsonResponse({ error: 'forced failure' }, 500);
        }
        return jsonResponse({ error: 'unexpected fetch' }, 404);
    };

    store.updateCatalogEpisode(EPISODE_ID, { title: 'Should Not Promote' });
    const failResult = await store.persistEpisodeRowToApi(EPISODE_ID);
    assert(failResult.ok === false, 'API failure is not reported as successful canonical Save');
    assert(
        failResult.reason === 'api-save-failed' || Boolean(failResult.error),
        'API failure includes reason/error detail'
    );
} finally {
    await server.close();
}

if (failures.length) {
    console.error('\nFAIL validate-episode-row-save');
    for (const msg of failures) console.error(`  ✗ ${msg}`);
    process.exit(1);
}

console.log('\nPASS validate-episode-row-save');
