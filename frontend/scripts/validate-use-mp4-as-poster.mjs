#!/usr/bin/env node
/**
 * Video Vault → Use MP4 as Poster — explicit editorial still assignment.
 *
 * A) No poster → assign from ingest still → API persist → browse projection
 * B) Existing Thumbnail Vault poster → action blocked
 * C) MP4 replace → reelId changes, thumbnailUrl preserved (preservation repair)
 * E) Additive Original Productions — separate Series A + B, A unchanged
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const REEL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REEL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REEL_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STILL_A = `/thumbs/${REEL_A}.jpg`;
const STILL_B = `/thumbs/${REEL_B}.jpg`;
const VAULT_POSTER = '/thumbs/explicit-vault-poster.jpeg';

const SERIES_A = 'series-mp4-poster-test-a';
const SERIES_B = 'series-mp4-poster-test-b';
const EP_A = 'ep-mp4-poster-test-a-s01e01';
const EP_B = 'ep-mp4-poster-test-b-s01e01';

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

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const poster = await vite.ssrLoadModule('/src/lib/studio/episodePosterAssignment.js');
    const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const browse = await vite.ssrLoadModule('/src/lib/series/viewerSeriesBrowseCatalog.js');
    const projection = await vite.ssrLoadModule('/src/lib/series/viewerProductionProjection.js');
    const adminSession = await vite.ssrLoadModule('/src/lib/adminSession.js');
    const catalogEdits = await vite.ssrLoadModule('/src/lib/series/seriesCatalogEdits.js');

    /** @type {Record<string, import('../src/lib/series/seriesTypes.js').Episode>} */
    const dbEpisodes = {
        [EP_A]: {
            episodeId: EP_A,
            episodeNumber: 1,
            title: 'Production A E01',
            status: 'published',
            reelId: REEL_A,
            thumbnailUrl: '/thumbs/production-a-original.jpg'
        },
        [EP_B]: {
            episodeId: EP_B,
            episodeNumber: 1,
            title: 'Production B E01',
            status: 'published',
            reelId: REEL_B,
            thumbnailUrl: null
        }
    };

    /** @type {Array<{ method: string; href: string; body: Record<string, unknown> | null }>} */
    const apiCalls = [];

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(String(options.body)) : null;
        if (href.includes('/api/')) apiCalls.push({ method, href, body });

        if (href.includes('/api/series/status')) {
            return jsonResponse({ enabled: true, count: 2 });
        }
        if (href.includes('/api/series') && method === 'GET' && !href.includes('/api/series/')) {
            return jsonResponse(
                catalogFixture().map((series) => ({
                    ...series,
                    seasons: series.seasons.map((season) => ({
                        ...season,
                        episodes: season.episodes.map((ep) => ({
                            ...ep,
                            thumbnailUrl: dbEpisodes[ep.episodeId]?.thumbnailUrl ?? ep.thumbnailUrl
                        }))
                    }))
                }))
            );
        }
        if (href.includes('/api/series/') && method === 'PUT') {
            for (const season of body?.seasons || []) {
                for (const ep of season.episodes || []) {
                    const id = String(ep.episodeId || '');
                    if (!id || !dbEpisodes[id]) continue;
                    dbEpisodes[id] = {
                        ...dbEpisodes[id],
                        reelId: ep.reelId ?? dbEpisodes[id].reelId,
                        thumbnailUrl:
                            'thumbnailUrl' in ep
                                ? ep.thumbnailUrl ?? null
                                : dbEpisodes[id].thumbnailUrl ?? null
                    };
                }
            }
            return jsonResponse({ ok: true });
        }
        if (href.includes('/api/episodes/') && method === 'PUT') {
            const id = decodeURIComponent(href.split('/api/episodes/')[1] || '');
            if (dbEpisodes[id]) {
                dbEpisodes[id] = { ...dbEpisodes[id], ...body, episodeId: id };
            }
            return jsonResponse({ ok: true });
        }
        return nativeFetch ? nativeFetch(url, options) : jsonResponse({}, 404);
    };

    adminSession.setAdminSessionToken('validate-use-mp4-as-poster');

    /** @returns {import('../src/lib/series/seriesTypes.js').Series[]} */
    function catalogFixture() {
        return [
            {
                id: SERIES_A,
                title: 'Production A',
                tags: ['studio-created'],
                seasons: [
                    {
                        seasonId: 'season-a-1',
                        seasonNumber: 1,
                        title: 'Season 1',
                        episodes: [{ ...dbEpisodes[EP_A] }]
                    }
                ]
            },
            {
                id: SERIES_B,
                title: 'Production B',
                tags: ['studio-created'],
                seasons: [
                    {
                        seasonId: 'season-b-1',
                        seasonNumber: 1,
                        title: 'Season 1',
                        episodes: [{ ...dbEpisodes[EP_B] }]
                    }
                ]
            }
        ];
    }

    /** @type {Record<string, unknown>} */
    const vaultAssetB = {
        id: REEL_B,
        name: 'Production B MP4',
        title: 'Production B MP4',
        type: 'video/mp4',
        url: `/videos/${REEL_B}.mp4`,
        thumbnailUrl: STILL_B,
        status: 'ready'
    };

    console.log('\n[still] resolveMp4PosterStillUrl uses ingest still');
    const still = poster.resolveMp4PosterStillUrl(vaultAssetB);
    assert(still.ok === true, 'MP4 still resolves from vault asset');
    assert(still.stillUrl === STILL_B, `stillUrl is ${STILL_B}`);

    console.log('\n[A] MP4 bound → Use MP4 as Poster → persist → browse');
    store.resetSeriesCatalogEmpty?.();
    dbEpisodes[EP_B].thumbnailUrl = null;
    dbEpisodes[EP_B].reelId = REEL_B;
    store.applyAuthoritativeApiCatalog(catalogFixture());
    apiCalls.length = 0;

    const assignA = await poster.useMp4AsEpisodePoster(REEL_B, vaultAssetB);
    assert(assignA.ok === true, 'useMp4AsEpisodePoster succeeds on Series B');
    assert(String(dbEpisodes[EP_B].thumbnailUrl || '') === STILL_B, 'episode PUT persisted MP4 still');
    assert(
        !apiCalls.some(
            (call) =>
                call.method === 'PUT' &&
                call.href.includes('/api/series/') &&
                call.body?.seasons?.some((season) =>
                    season.episodes?.some((ep) => 'thumbnailUrl' in (ep || {}))
                )
        ),
        'no series upsert carried thumbnailUrl'
    );

    store.applyAuthoritativeApiCatalog(catalogFixture());
    const hydratedB = store.getEpisodeById(EP_B)?.episode;
    assert(hydratedB?.thumbnailUrl === STILL_B, 'hydrated catalog keeps assigned still');

    const browseAfter = browse.buildViewerSeriesBrowseCatalog(catalogFixture(), {
        readyVaultAssets: []
    });
    const originalIds = browseAfter.sections.original.map((row) => row.seriesId);
    assert(originalIds.includes(SERIES_A), 'Original Productions includes Series A');
    assert(originalIds.includes(SERIES_B), 'Original Productions includes Series B');
    const cardA = browseAfter.sections.original.find((row) => row.seriesId === SERIES_A);
    const cardB = browseAfter.sections.original.find((row) => row.seriesId === SERIES_B);
    assert(
        String(cardA?.posterSrc || '').includes('production-a-original'),
        'Series A poster unchanged'
    );
    assert(String(cardB?.posterSrc || '') === STILL_B, 'Series B poster uses MP4 still');

    console.log('\n[B] existing editorial poster blocks MP4 assign');
    dbEpisodes[EP_A].thumbnailUrl = VAULT_POSTER;
    store.applyAuthoritativeApiCatalog(catalogFixture());
    const blocked = await poster.useMp4AsEpisodePoster(REEL_A, {
        id: REEL_A,
        thumbnailUrl: STILL_A,
        url: `/videos/${REEL_A}.mp4`
    });
    assert(blocked.ok === false, 'useMp4AsEpisodePoster blocked when poster exists');
    assert(blocked.reason === 'poster-already-set', 'blocked with poster-already-set');
    assert(dbEpisodes[EP_A].thumbnailUrl === VAULT_POSTER, 'existing poster unchanged in db');

    console.log('\n[C] MP4 replace preserves editorial poster');
    dbEpisodes[EP_B].thumbnailUrl = STILL_B;
    store.applyAuthoritativeApiCatalog(catalogFixture());
    apiCalls.length = 0;
    store.attachEpisodeReel(EP_B, REEL_C);
    await new Promise((r) => setTimeout(r, 60));
    assert(store.getEpisodeById(EP_B)?.episode?.reelId === REEL_C, 'reelId updated to MP4 C');
    assert(
        String(dbEpisodes[EP_B].thumbnailUrl || '') === STILL_B,
        'db thumbnailUrl survives reel replace'
    );
    assert(
        store.getEpisodeById(EP_B)?.episode?.thumbnailUrl === STILL_B,
        'catalog thumbnailUrl survives reel replace'
    );

    console.log('\n[E] additive Original Productions — A unchanged, B assigned');
    dbEpisodes[EP_A].thumbnailUrl = '/thumbs/production-a-original.jpg';
    dbEpisodes[EP_B].thumbnailUrl = STILL_B;
    dbEpisodes[EP_B].reelId = REEL_C;
    const catalogE = catalogFixture();
    const projA = projection.buildViewerProductionProjection(
        catalogE.find((s) => s.id === SERIES_A),
        { readyVaultAssets: [] }
    );
    const projB = projection.buildViewerProductionProjection(
        catalogE.find((s) => s.id === SERIES_B),
        { readyVaultAssets: [] }
    );
    assert(String(projA?.posterSrc || '').includes('production-a-original'), 'projection A unchanged');
    assert(projB?.posterSrc === STILL_B, 'projection B uses assigned still');

    console.log('\n[F] ingest still on catalog without assign source is not editorial');
    bag.delete(catalogEdits.SERIES_CATALOG_EDITS_KEY);
    const ingestOnlyState = poster.resolveVaultEditorialPosterState(
        { episodeId: EP_B, reelId: REEL_B, thumbnailUrl: STILL_B, status: 'published' },
        vaultAssetB,
        { seriesId: SERIES_B }
    );
    assert(ingestOnlyState.assigned === false, 'ingest-only catalog still is unassigned in vault UI');
    assert(ingestOnlyState.canUseMp4AsPoster === true, 'Use MP4 still remains available');
    assert(ingestOnlyState.stillPreviewUrl === STILL_B, 'still preview URL preserved');

    console.log('\n[G] featureEpisodeOnOriginalProductions assigns + publishes');
    bag.delete(catalogEdits.SERIES_CATALOG_EDITS_KEY);
    dbEpisodes[EP_B].reelId = REEL_B;
    dbEpisodes[EP_B].thumbnailUrl = null;
    dbEpisodes[EP_B].status = 'ready';
    store.applyAuthoritativeApiCatalog(catalogFixture());
    const feature = await poster.featureEpisodeOnOriginalProductions(REEL_B, vaultAssetB);
    assert(feature.ok === true, 'featureEpisodeOnOriginalProductions succeeds');
    assert(dbEpisodes[EP_B].status === 'published', 'episode published for Original Productions');
    assert(String(dbEpisodes[EP_B].thumbnailUrl || '') === STILL_B, 'poster assigned during feature');
    const browseFeatured = browse.buildViewerSeriesBrowseCatalog(catalogFixture(), {
        readyVaultAssets: [vaultAssetB]
    });
    assert(
        browseFeatured.sections.original.some((row) => row.seriesId === SERIES_B),
        'Series B appears in Original Productions after feature'
    );

    console.log('\n[H] Hero Vault STIRRED → Make poster (no publish, identity preserved)');
    const STIRRED_SERIES = 'series-stirred';
    const STIRRED_EP = 'ep-stirred-s01e01';
    const STIRRED_REEL = '35a78285-5611-47b1-a279-9ffaaa64315b';
    const STIRRED_STILL = `/thumbs/${STIRRED_REEL}.jpg`;
    bag.delete(catalogEdits.SERIES_CATALOG_EDITS_KEY);
    dbEpisodes[STIRRED_EP] = {
        episodeId: STIRRED_EP,
        episodeNumber: 1,
        title: 'STIRRED S01E01',
        status: 'ready',
        reelId: STIRRED_REEL,
        thumbnailUrl: null
    };
    const stirredCatalog = [
        ...catalogFixture(),
        {
            id: STIRRED_SERIES,
            title: 'STIRRED',
            tags: ['creator-confirmed'],
            seasons: [
                {
                    seasonId: 'season-stirred-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [{ ...dbEpisodes[STIRRED_EP] }]
                }
            ]
        }
    ];
    store.applyAuthoritativeApiCatalog(stirredCatalog);
    /** @type {Record<string, unknown>} */
    const stirredHeroAsset = {
        id: STIRRED_REEL,
        name: 'MICROS STIRRED V1',
        title: 'MICROS STIRRED V1',
        type: 'video/mp4',
        url: `/videos/${STIRRED_REEL}.mp4`,
        thumbnailUrl: STIRRED_STILL,
        status: 'ready',
        heroVaultAsset: true
    };
    const beforeStatus = dbEpisodes[STIRRED_EP].status;
    const beforeReel = dbEpisodes[STIRRED_EP].reelId;
    const make = await poster.useMp4AsEpisodePoster(STIRRED_REEL, stirredHeroAsset);
    assert(make.ok === true, 'Make poster succeeds for Hero Vault STIRRED asset');
    assert(dbEpisodes[STIRRED_EP].thumbnailUrl === STIRRED_STILL, 'STIRRED thumbnailUrl assigned');
    assert(dbEpisodes[STIRRED_EP].reelId === beforeReel, 'STIRRED reelId unchanged');
    assert(dbEpisodes[STIRRED_EP].status === beforeStatus, 'Make poster does not publish');
    const ctx = store.getEpisodeByMediaIdentity(STIRRED_REEL);
    assert(ctx?.series?.id === STIRRED_SERIES, 'canonical episode remains series-stirred');

    globalThis.fetch = nativeFetch;

    if (failures.length) {
        console.error('\nFAIL validate-use-mp4-as-poster');
        for (const f of failures) console.error('  -', f);
        process.exitCode = 1;
    } else {
        console.log('\nPASS validate-use-mp4-as-poster');
    }
} finally {
    await vite.close();
}
