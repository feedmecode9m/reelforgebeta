#!/usr/bin/env node
/**
 * Studio Series Creation ownership — canonical POST /api/series from Studio path.
 *
 * Proves:
 *   1) seriesCreatePayloadFromStudioTitle uses text series id (never studio UUID)
 *   2) createCatalogSeriesFromStudio POSTs canonical row + Season 1 shell
 *   3) Catalog hydration exposes created series by canonical id
 *   4) Viewer projection pipeline receives same canonical id (browse after episodes)
 *   5) Live backend round-trip + DELETE cleanup when available
 *   6) Vic G bindings unchanged
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

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const projection = await server.ssrLoadModule('/src/lib/series/viewerProductionProjection.js');
    const publicHydration = await server.ssrLoadModule('/src/lib/series/publicSeriesHydration.js');
    const adminSession = await server.ssrLoadModule('/src/lib/adminSession.js');

    const testTitle = `Studio Create ${Date.now()}`;
    const testIdSuffix = Date.now();

    console.log('\n[1] payload identity boundary');
    {
        const payload = seriesApi.seriesCreatePayloadFromStudioTitle(testTitle, {
            idSuffix: testIdSuffix
        });
        assert(payload.id.startsWith('series-'), 'payload id is canonical text series id');
        assert(!UUID_RE.test(payload.id), 'payload id is not a studio_series UUID');
        assert(payload.title === testTitle, 'payload carries studio title');
        assert(Array.isArray(payload.seasons) && payload.seasons.length === 1, 'payload includes Season 1 shell');
        assert(payload.seasons[0]?.seasonNumber === 1, 'Season 1 shell has seasonNumber 1');
        assert(Array.isArray(payload.seasons[0]?.episodes) && payload.seasons[0].episodes.length === 0, 'Season 1 shell has no episodes');
        assert(payload.tags?.includes('studio-created'), 'payload tagged studio-created');
    }

    console.log('\n[2–4] createCatalogSeriesFromStudio mock flow');
    /** @type {Record<string, unknown> | null} */
    let capturedPost = null;
    /** @type {Record<string, unknown> | null} */
    let apiSeriesSnapshot = null;
    let mockSeriesId = '';

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        const method = options.method || 'GET';

        if (href.includes('/api/series/status')) {
            return jsonResponse({ enabled: true, count: 1 });
        }

        if (method === 'POST' && href.endsWith('/api/series')) {
            capturedPost = JSON.parse(String(options.body || '{}'));
            mockSeriesId = String(capturedPost?.id || '');
            apiSeriesSnapshot = {
                ...capturedPost,
                id: mockSeriesId,
                seasons: capturedPost?.seasons || []
            };
            return jsonResponse(apiSeriesSnapshot, 201);
        }

        if (method === 'GET' && href.includes(`/api/series/${encodeURIComponent(mockSeriesId)}`)) {
            return jsonResponse(apiSeriesSnapshot);
        }

        if (typeof nativeFetch === 'function') {
            return nativeFetch(url, options);
        }
        return jsonResponse({ error: 'unexpected fetch' }, 404);
    };

    adminSession.setAdminSessionToken('validate-studio-series-create-token');
    store.resetSeriesCatalogEmpty();

    const createResult = await store.createCatalogSeriesFromStudio(testTitle);
    assert(createResult.ok === true, 'Studio create reports canonical API success');
    assert(capturedPost != null, 'POST /api/series was invoked');
    assert(!UUID_RE.test(String(createResult.seriesId || '')), 'downstream seriesId is not a studio UUID');
    assert(String(createResult.seriesId || '').startsWith('series-'), 'downstream seriesId is canonical text id');
    assert(createResult.seriesId === mockSeriesId, 'downstream id matches POST payload id');

    const hydrated = store.getSeriesById(createResult.seriesId);
    assert(Boolean(hydrated), 'catalog hydration exposes created series');
    assert(hydrated?.title === testTitle, 'hydrated title matches studio input');
    assert(hydrated?.seasons?.[0]?.seasonNumber === 1, 'hydrated catalog includes Season 1 shell');

    const viewerPath = publicHydration.publicSeriesPath(hydrated);
    assert(typeof viewerPath === 'string' && viewerPath.startsWith('/series/'), 'public series path derivable from canonical id');

    const viewerProjection = projection.buildViewerProductionProjection(hydrated, {});
    assert(viewerProjection === null, 'viewer projection null until discoverable episodes (creation boundary)');

    console.log('\n[optional live] backend Studio create round-trip');
    globalThis.fetch = nativeFetch;

    /** @returns {Promise<Record<string, string>>} */
    async function getAdminWriteHeaders() {
        const password = process.env.ADMIN_PASSWORD || 'Gaff1505!';
        const res = await fetch(`${BACKEND}/admin/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
            signal: AbortSignal.timeout(4000)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.token) {
            return { 'Content-Type': 'application/json' };
        }
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${body.token}`
        };
    }

    try {
        const statusRes = await fetch(`${BACKEND}/api/series/status`, {
            signal: AbortSignal.timeout(3000)
        });
        if (!statusRes.ok) {
            console.log('  skip: series API unavailable');
        } else {
            const writeHeaders = await getAdminWriteHeaders();
            const liveTitle = `Studio Create Live ${Date.now()}`;
            const livePayload = seriesApi.seriesCreatePayloadFromStudioTitle(liveTitle);
            const liveId = livePayload.id;

            const vicBefore = await fetch(`${BACKEND}/api/series/${encodeURIComponent(VIC_G_ID)}`, {
                signal: AbortSignal.timeout(5000)
            });
            const vicBeforeBody = vicBefore.ok ? await vicBefore.json() : null;
            const vicReelsBefore = vicBeforeBody
                ? (vicBeforeBody.seasons || [])
                      .flatMap((s) => s?.episodes || [])
                      .map((e) => String(e?.reelId || e?.reel_id || ''))
                      .filter(Boolean)
                : [];

            const createRes = await fetch(`${BACKEND}/api/series`, {
                method: 'POST',
                headers: writeHeaders,
                body: JSON.stringify(livePayload),
                signal: AbortSignal.timeout(5000)
            });
            if (createRes.status === 401) {
                console.log('  skip: live POST requires admin token');
            } else {
                const created = await createRes.json();
                assert(createRes.status === 201, 'live POST /api/series creates series');
                assert(created?.id === liveId, 'live response id matches canonical payload id');
                assert(!UUID_RE.test(liveId), 'live canonical id is not studio UUID');

                const getRes = await fetch(`${BACKEND}/api/series/${encodeURIComponent(liveId)}`, {
                    signal: AbortSignal.timeout(5000)
                });
                assert(getRes.status === 200, 'live GET /api/series/:id -> 200');

                const seasonsRes = await fetch(`${BACKEND}/api/series/${encodeURIComponent(liveId)}/seasons`, {
                    signal: AbortSignal.timeout(5000)
                });
                const seasonsBody = seasonsRes.ok ? await seasonsRes.json() : [];
                assert(
                    seasonsRes.status === 200 &&
                        Array.isArray(seasonsBody) &&
                        seasonsBody.some((s) => Number(s?.seasonNumber) === 1),
                    'live GET /api/series/:id/seasons includes Season 1 shell'
                );

                store.resetSeriesCatalogEmpty();
                adminSession.setAdminSessionToken(
                    writeHeaders.Authorization?.replace(/^Bearer\s+/i, '') || 'live-token'
                );
                store.applyAuthoritativeApiCatalog([seriesApi.apiSeriesToCatalog(await getRes.json())]);
                const liveHydrated = store.getSeriesById(liveId);
                assert(Boolean(liveHydrated), 'live catalog hydration exposes created series');
                assert(liveHydrated?.id === liveId, 'live hydrated id matches canonical POST id');

                const liveProjection = projection.buildViewerProductionProjection(liveHydrated, {});
                assert(liveProjection === null, 'live viewer projection null until episodes exist');

                const deleteRes = await fetch(`${BACKEND}/api/series/${encodeURIComponent(liveId)}`, {
                    method: 'DELETE',
                    headers: writeHeaders,
                    signal: AbortSignal.timeout(5000)
                });
                assert(deleteRes.ok, 'live DELETE cleanup succeeds');
                const afterDelete = await fetch(`${BACKEND}/api/series/${encodeURIComponent(liveId)}`, {
                    signal: AbortSignal.timeout(5000)
                });
                assert(afterDelete.status === 404, 'live cleanup -> GET series 404');

                if (vicBefore.ok) {
                    const vicAfter = await fetch(`${BACKEND}/api/series/${encodeURIComponent(VIC_G_ID)}`, {
                        signal: AbortSignal.timeout(5000)
                    });
                    const vicAfterBody = vicAfter.ok ? await vicAfter.json() : null;
                    const vicReelsAfter = vicAfterBody
                        ? (vicAfterBody.seasons || [])
                              .flatMap((s) => s?.episodes || [])
                              .map((e) => String(e?.reelId || e?.reel_id || ''))
                              .filter(Boolean)
                        : [];
                    assert(
                        vicReelsAfter.length === vicReelsBefore.length,
                        'live Vic G episode count unchanged after studio create cleanup'
                    );
                    for (const reelId of Object.values(REEL)) {
                        if (vicReelsBefore.includes(reelId)) {
                            assert(vicReelsAfter.includes(reelId), `live Vic G reel ${reelId} unchanged`);
                        }
                    }
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
    console.error('\nFAIL validate-studio-series-create');
    for (const msg of failures) console.error(`  ✗ ${msg}`);
    process.exit(1);
}

console.log('\nPASS validate-studio-series-create');
