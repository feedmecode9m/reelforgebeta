#!/usr/bin/env node
/**
 * Poster preservation invariant — reel bind must not wipe episode.thumbnailUrl.
 *
 * Proves:
 *   A) assign poster → stale hydrate strips catalog thumb → attach + bridge → poster survives
 *   B) implicit attach cannot clear poster; empty thumbnailUrl patch is rejected
 *   C) replace MP4 reelId while poster remains unchanged
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const SERIES = 'series-vic-g';
const EP = 'ep-vic-g-s01e02';
const REEL = 'cadfcabc-1947-4341-86a3-f82a08e78669';
const NEW_REEL = '11111111-1111-4111-8111-111111111111';
const POSTER = '/thumbs/poster-survives-reel-bind.jpeg';

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

/** @param {import('../src/lib/series/seriesTypes.js').Series[]} catalog */
function apiSeriesFixture(catalog) {
    return catalog;
}

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const seriesApi = await vite.ssrLoadModule('/src/lib/api/seriesApi.js');
    const bridge = await vite.ssrLoadModule('/src/lib/series/episodeBridge.js');
    const posterResolver = await vite.ssrLoadModule('/src/lib/series/viewerEpisodePoster.js');
    const adminSession = await vite.ssrLoadModule('/src/lib/adminSession.js');

    /** @type {Record<string, unknown>} */
    let dbEpisode = {
        episodeId: EP,
        episodeNumber: 2,
        title: '03 CLUB POOM POOM V1',
        status: 'published',
        reelId: REEL,
        thumbnailUrl: null
    };

    /** @type {Array<{ method: string; href: string; body: Record<string, unknown> | null }>} */
    const apiCalls = [];

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(String(options.body)) : null;
        if (href.includes('/api/')) {
            apiCalls.push({ method, href, body });
        }
        if (href.includes('/api/series/status')) {
            return jsonResponse({ enabled: true, count: 1 });
        }
        if (href.includes('/api/series') && method === 'GET' && !href.includes('/api/series/')) {
            return jsonResponse(
                apiSeriesFixture([
                    {
                        id: SERIES,
                        title: 'Vic G',
                        tags: ['creator-package'],
                        seasons: [
                            {
                                seasonId: 'season-vic-g-1',
                                seasonNumber: 1,
                                title: 'Season 1',
                                episodes: [{ ...dbEpisode }]
                            }
                        ]
                    }
                ])
            );
        }
        if (href.includes('/api/series/') && method === 'PUT') {
            for (const season of body?.seasons || []) {
                for (const ep of season.episodes || []) {
                    if (String(ep.episodeId) !== EP) continue;
                    dbEpisode = {
                        ...dbEpisode,
                        reelId: ep.reelId ?? dbEpisode.reelId,
                        title: ep.title ?? dbEpisode.title,
                        status: ep.status ?? dbEpisode.status,
                        thumbnailUrl:
                            'thumbnailUrl' in ep
                                ? ep.thumbnailUrl ?? null
                                : dbEpisode.thumbnailUrl ?? null
                    };
                }
            }
            return jsonResponse({ ok: true });
        }
        if (href.includes(`/api/episodes/${encodeURIComponent(EP)}`) && method === 'PUT') {
            dbEpisode = { ...dbEpisode, ...body, episodeId: EP };
            return jsonResponse({ ok: true });
        }
        return nativeFetch ? nativeFetch(url, options) : jsonResponse({}, 404);
    };

    adminSession.setAdminSessionToken('validate-poster-survives-reel-bind');

    const catalogFixture = [
        {
            id: SERIES,
            title: 'Vic G',
            tags: ['creator-package'],
            seasons: [
                {
                    seasonId: 'season-vic-g-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [
                        {
                            episodeId: EP,
                            episodeNumber: 2,
                            title: '03 CLUB POOM POOM V1',
                            status: 'published',
                            reelId: REEL
                        }
                    ]
                }
            ]
        }
    ];

    console.log('\n[0] seriesToApiPayload omits thumbnailUrl (reel bind path)');
    store.resetSeriesCatalogEmpty?.();
    store.applyAuthoritativeApiCatalog(catalogFixture);
    store.updateCatalogEpisode(EP, { thumbnailUrl: POSTER });
    const ctx = store.getEpisodeById(EP);
    const seriesPayload = seriesApi.seriesToApiPayload(ctx.series);
    const payloadEp = seriesPayload.seasons?.[0]?.episodes?.find((row) => row.episodeId === EP);
    assert(payloadEp && !('thumbnailUrl' in payloadEp), 'series upsert payload omits thumbnailUrl');

    console.log('\n[A] poster survives attach + bridge after stale hydrate');
    store.resetSeriesCatalogEmpty?.();
    store.applyAuthoritativeApiCatalog(catalogFixture);
    const assign = await store.assignEpisodePoster(EP, POSTER);
    assert(assign.ok === true, 'assignEpisodePoster succeeds');
    assert(String(dbEpisode.thumbnailUrl || '') === POSTER, 'episode PUT persisted poster to db');

    bag.delete('reelforge_series_catalog_edits');
    store.applyAuthoritativeApiCatalog(catalogFixture);
    assert(!store.getEpisodeById(EP)?.episode?.thumbnailUrl, 'stale hydrate strips catalog thumbnailUrl');

    apiCalls.length = 0;
    store.attachEpisodeReel(EP, REEL);
    bridge.bridgeFeedReelsToCatalog([
        {
            id: REEL,
            name: '03 CLUB POOM POOM V1',
            title: '03 CLUB POOM POOM V1',
            url: `/videos/${REEL}.mp4`,
            episodeId: EP
        }
    ]);
    await new Promise((r) => setTimeout(r, 60));

    const seriesPuts = apiCalls.filter(
        (call) => call.method === 'PUT' && call.href.includes('/api/series/')
    );
    for (const put of seriesPuts) {
        const ep = put.body?.seasons
            ?.flatMap((season) => season.episodes || [])
            ?.find((row) => row.episodeId === EP);
        assert(!ep || !('thumbnailUrl' in ep), 'series PUT never carries thumbnailUrl');
    }

    assert(String(dbEpisode.thumbnailUrl || '') === POSTER, 'db thumbnailUrl survives reel attach');

    store.applyAuthoritativeApiCatalog([
        {
            id: SERIES,
            title: 'Vic G',
            tags: ['creator-package'],
            seasons: [
                {
                    seasonId: 'season-vic-g-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [{ ...dbEpisode }]
                }
            ]
        }
    ]);
    const afterHydrateFromDb = store.getEpisodeById(EP)?.episode;
    assert(afterHydrateFromDb?.thumbnailUrl === POSTER, 'catalog poster restored after hydrate from db');

    store.reapplyCreatorCatalogAuthorityToStore?.();
    const hydrated = store.getEpisodeById(EP)?.episode;
    const viewerPoster = posterResolver.resolveViewerEpisodePosterUrl({
        episode: hydrated,
        readyVaultAssets: [{ id: REEL, name: '03 CLUB POOM POOM V1', url: `/videos/${REEL}.mp4` }]
    });
    assert(hydrated?.thumbnailUrl === POSTER, 'hydrated catalog keeps assigned poster');
    assert(String(viewerPoster || '').includes('poster-survives-reel-bind'), 'viewer resolver returns assigned poster');

    console.log('\n[B] implicit attach cannot clear; empty patch rejected');
    const rejected = store.updateCatalogEpisode(EP, { thumbnailUrl: '' });
    assert(rejected === null, 'updateCatalogEpisode rejects empty thumbnailUrl clear');
    assert(store.getEpisodeById(EP)?.episode?.thumbnailUrl === POSTER, 'poster unchanged after rejected clear');

    console.log('\n[C] replace MP4 — reelId changes, poster unchanged');
    apiCalls.length = 0;
    store.attachEpisodeReel(EP, NEW_REEL);
    bridge.bridgeFeedReelsToCatalog([
        {
            id: NEW_REEL,
            name: '03 CLUB POOM POOM V1',
            title: '03 CLUB POOM POOM V1',
            url: `/videos/${NEW_REEL}.mp4`,
            episodeId: EP
        }
    ]);
    await new Promise((r) => setTimeout(r, 60));
    const replaced = store.getEpisodeById(EP)?.episode;
    assert(replaced?.reelId === NEW_REEL, 'reelId updated to replacement MP4');
    assert(replaced?.thumbnailUrl === POSTER, 'poster unchanged after MP4 replace');
    assert(String(dbEpisode.thumbnailUrl || '') === POSTER, 'db poster unchanged after MP4 replace');

    globalThis.fetch = nativeFetch;

    if (failures.length) {
        console.error('\nFAIL validate-episode-poster-survives-reel-bind');
        for (const f of failures) console.error('  -', f);
        process.exitCode = 1;
    } else {
        console.log('\nPASS validate-episode-poster-survives-reel-bind');
    }
} finally {
    await vite.close();
}
