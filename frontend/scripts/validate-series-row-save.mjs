#!/usr/bin/env node
/**
 * Series-row Save ownership repair — Creator Catalog canonical metadata PUT.
 *
 * Proves:
 *   1) Creator Catalog series Save persists edited title via PUT /api/series/:id
 *   2) Description/poster/genre/tags are not nulled on title-only edit
 *   3) PUT payload contains no seasons
 *   4) Vic G episode count unchanged after row save
 *   5) Vic G reel IDs unchanged after row save
 *   6) Save → API → fresh hydrate returns edited canonical series value
 *   7) Viewer projection receives canonical saved value after hydrate
 *   8) API failure is not reported as successful canonical Save
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';

const VIC_G_ID = 'series-vic-g';
const REEL = {
    e02: 'cadfcabc-1947-4341-86a3-f82a08e78669',
    e04: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1',
    e05: 'efb01cee-9477-4477-982a-7611cfc08fcc',
    e06: '5cc786f0-8fbe-4f96-a59d-02014b0cc56f'
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

/** @param {import('../src/lib/series/seriesTypes.js').Series} base */
function enrichVicGForRowSave(base) {
    return {
        ...base,
        description: 'Vic G production synopsis',
        genre: 'Documentary',
        poster: '/posters/vic-g.jpg',
        releaseYear: 2025,
        tags: ['creator-package', 'creator-confirmed', 'production']
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

    console.log('\n[1] seriesToApiRowPayload shape');
    {
        const sample = enrichVicGForRowSave(vicG.buildVicGSeriesPackage());
        const payload = seriesApi.seriesToApiRowPayload(sample);
        assert(!('seasons' in payload), 'payload omits seasons');
        assert(payload.id === VIC_G_ID, 'payload includes id');
        assert(
            ['title', 'description', 'genre', 'poster', 'tags'].every((k) => k in payload),
            'payload includes series-row fields'
        );
        assert(payload.description === 'Vic G production synopsis', 'payload carries description');
        assert(payload.genre === 'Documentary', 'payload carries genre');
        assert(payload.poster === '/posters/vic-g.jpg', 'payload carries poster');
        assert(Array.isArray(payload.tags) && payload.tags.length === 3, 'payload carries tags');
        assert(payload.releaseYear === 2025, 'payload carries releaseYear when set');
    }

    console.log('\n[2] title-only edit preserves other series-row fields');
    {
        const payload = seriesApi.seriesToApiRowPayload({
            id: VIC_G_ID,
            title: 'Vic G Renamed',
            description: 'Keep this synopsis',
            genre: 'Drama',
            poster: '/keep-poster.jpg',
            tags: ['keep-tag'],
            seasons: [{ seasonNumber: 1, episodes: [{ reelId: REEL.e02 }] }]
        });
        assert(payload.title === 'Vic G Renamed', 'title-only edit updates title');
        assert(payload.description === 'Keep this synopsis', 'title-only edit keeps description');
        assert(payload.genre === 'Drama', 'title-only edit keeps genre');
        assert(payload.poster === '/keep-poster.jpg', 'title-only edit keeps poster');
        assert(payload.tags.includes('keep-tag'), 'title-only edit keeps tags');
        assert(!('seasons' in payload), 'title-only payload still omits seasons');
    }

    console.log('\n[3–8] persistSeriesRowToApi mock flow');
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

        if (method === 'PUT' && href.includes(`/api/series/${encodeURIComponent(VIC_G_ID)}`)) {
            capturedPut = JSON.parse(String(options.body || '{}'));
            const merged = {
                ...(apiSeriesSnapshot || {}),
                ...capturedPut,
                id: VIC_G_ID,
                seasons: apiSeriesSnapshot?.seasons || []
            };
            apiSeriesSnapshot = merged;
            return jsonResponse(merged);
        }

        if (method === 'GET' && href.includes(`/api/series/${encodeURIComponent(VIC_G_ID)}`)) {
            return jsonResponse(apiSeriesSnapshot);
        }

        if (typeof nativeFetch === 'function') {
            return nativeFetch(url, options);
        }
        return jsonResponse({ error: 'unexpected fetch' }, 404);
    };

    adminSession.setAdminSessionToken('validate-series-row-save-token');

    const vicBase = enrichVicGForRowSave(vicG.buildVicGSeriesPackage());
    apiSeriesSnapshot = structuredClone(vicBase);
    store.applyAuthoritativeApiCatalog([structuredClone(vicBase)]);

    const beforeReels = collectReelIds(store.getSeriesById(VIC_G_ID));
    const beforeCount = beforeReels.length;

    store.updateCatalogSeries(VIC_G_ID, { title: 'Vic G Canonical Save' });
    const saveResult = await store.persistSeriesRowToApi(VIC_G_ID);

    assert(saveResult.ok === true, 'Creator Catalog series Save reports canonical API success');
    assert(capturedPut != null, 'PUT /api/series/:id was invoked');
    assert(!('seasons' in (capturedPut || {})), 'PUT payload contains no seasons');
    assert(capturedPut?.title === 'Vic G Canonical Save', 'PUT persists edited title');
    assert(
        capturedPut?.description === 'Vic G production synopsis',
        'PUT keeps description on title-only local edit'
    );
    assert(capturedPut?.genre === 'Documentary', 'PUT keeps genre on title-only local edit');
    assert(capturedPut?.poster === '/posters/vic-g.jpg', 'PUT keeps poster on title-only local edit');
    assert(
        Array.isArray(capturedPut?.tags) && capturedPut.tags.includes('production'),
        'PUT keeps tags on title-only local edit'
    );

    const afterLocal = store.getSeriesById(VIC_G_ID);
    assert(collectReelIds(afterLocal).length === beforeCount, 'Vic G episode count unchanged locally');
    for (const reelId of Object.values(REEL)) {
        assert(collectReelIds(afterLocal).includes(reelId), `Vic G reel ${reelId} unchanged locally`);
    }

    store.applyAuthoritativeApiCatalog([structuredClone(apiSeriesSnapshot)]);
    const hydrated = store.getSeriesById(VIC_G_ID);
    assert(hydrated?.title === 'Vic G Canonical Save', 'fresh hydrate returns edited canonical title');

    const viewer = projection.buildViewerProductionProjection(hydrated, {});
    assert(viewer.title === 'Vic G Canonical Save', 'viewer projection receives canonical saved title');
    assert(
        viewer.description === 'Vic G production synopsis',
        'viewer projection keeps canonical description after hydrate'
    );

    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        if (href.includes('/api/series/status')) {
            return jsonResponse({ enabled: true, count: 1 });
        }
        if (options.method === 'PUT' && href.includes(`/api/series/${encodeURIComponent(VIC_G_ID)}`)) {
            return jsonResponse({ error: 'forced failure' }, 500);
        }
        return jsonResponse({ error: 'unexpected fetch' }, 404);
    };

    store.updateCatalogSeries(VIC_G_ID, { title: 'Vic G Should Not Promote' });
    const failResult = await store.persistSeriesRowToApi(VIC_G_ID);
    assert(failResult.ok === false, 'API failure is not reported as successful canonical Save');
    assert(
        failResult.reason === 'api-save-failed' || Boolean(failResult.error),
        'API failure includes reason/error detail'
    );

    console.log('\n[optional live] backend integration when available');
    globalThis.fetch = nativeFetch;
    try {
        const statusRes = await fetch(`${BACKEND}/api/series/status`, {
            signal: AbortSignal.timeout(3000)
        });
        if (!statusRes.ok) {
            console.log('  skip: series API unavailable');
        } else {
            const getRes = await fetch(`${BACKEND}/api/series/${encodeURIComponent(VIC_G_ID)}`, {
                signal: AbortSignal.timeout(5000)
            });
            if (getRes.status === 404) {
                console.log('  skip: series-vic-g not present in backend');
            } else if (!getRes.ok) {
                console.log(`  skip: could not load series-vic-g (${getRes.status})`);
            } else {
                /** @type {Record<string, unknown>} */
                const liveBefore = await getRes.json();
                const episodesBefore = Array.isArray(liveBefore.seasons)
                    ? liveBefore.seasons.flatMap((s) => s?.episodes || [])
                    : [];
                const reelsBefore = episodesBefore.map((e) => String(e?.reel_id || e?.reelId || '')).filter(Boolean);

                const tempTitle = `${String(liveBefore.title || 'Vic G')} RowSave ${Date.now()}`;
                const rowPayload = seriesApi.seriesToApiRowPayload({
                    id: VIC_G_ID,
                    title: tempTitle,
                    description: liveBefore.description ?? '',
                    genre: liveBefore.genre ?? '',
                    poster: liveBefore.poster ?? '',
                    tags: Array.isArray(liveBefore.tags) ? liveBefore.tags : [],
                    releaseYear: liveBefore.release_year ?? liveBefore.releaseYear
                });

                const putRes = await fetch(`${BACKEND}/api/series/${encodeURIComponent(VIC_G_ID)}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${process.env.REELFORGE_ADMIN_TOKEN || ''}`.trim()
                    },
                    body: JSON.stringify(rowPayload),
                    signal: AbortSignal.timeout(5000)
                });
                if (putRes.status === 401) {
                    console.log('  skip: live PUT requires admin token (set REELFORGE_ADMIN_TOKEN)');
                } else {
                    assert(putRes.ok, 'live PUT /api/series/:id succeeds for row payload');

                    const getAfter = await fetch(`${BACKEND}/api/series/${encodeURIComponent(VIC_G_ID)}`, {
                        signal: AbortSignal.timeout(5000)
                    });
                    const liveAfter = await getAfter.json();
                    assert(liveAfter.title === tempTitle, 'live hydrate returns edited canonical title');
                    const episodesAfter = Array.isArray(liveAfter.seasons)
                        ? liveAfter.seasons.flatMap((s) => s?.episodes || [])
                        : [];
                    assert(
                        episodesAfter.length === episodesBefore.length,
                        'live Vic G episode count unchanged after row save'
                    );
                    const reelsAfter = episodesAfter
                        .map((e) => String(e?.reel_id || e?.reelId || ''))
                        .filter(Boolean);
                    for (const reelId of Object.values(REEL)) {
                        if (reelsBefore.includes(reelId)) {
                            assert(reelsAfter.includes(reelId), `live Vic G reel ${reelId} unchanged`);
                        }
                    }

                    const revertPayload = seriesApi.seriesToApiRowPayload({
                        id: VIC_G_ID,
                        title: String(liveBefore.title || 'Vic G'),
                        description: liveBefore.description ?? '',
                        genre: liveBefore.genre ?? '',
                        poster: liveBefore.poster ?? '',
                        tags: Array.isArray(liveBefore.tags) ? liveBefore.tags : [],
                        releaseYear: liveBefore.release_year ?? liveBefore.releaseYear
                    });
                    await fetch(`${BACKEND}/api/series/${encodeURIComponent(VIC_G_ID)}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${process.env.REELFORGE_ADMIN_TOKEN || ''}`.trim()
                        },
                        body: JSON.stringify(revertPayload),
                        signal: AbortSignal.timeout(5000)
                    });
                }
            }
        }
    } catch (err) {
        console.log(`  skip: live backend integration (${err?.message || err})`);
    }
} finally {
    await server.close();
}

if (failures.length) {
    console.error('\nFAIL validate-series-row-save');
    for (const msg of failures) console.error(`  ✗ ${msg}`);
    process.exit(1);
}

console.log('\nPASS validate-series-row-save');
