#!/usr/bin/env node
/**
 * Thumbnail Vault → canonical episode poster assignment (URL-only V1).
 *
 * Proves:
 *   1) Thumbnail Vault entry resolves to /thumbs/{uuid}.ext
 *   2) assignEpisodePoster writes catalog episode.thumbnailUrl
 *   3) PUT /api/episodes/:id receives thumbnailUrl (no reelId drift)
 *   4) Viewer resolver prefers explicit episode.thumbnailUrl
 *   5) episodeId + reelId unchanged; Vic G bindings untouched
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { get } from 'svelte/store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const VIC_G_ID = 'series-vic-g';
const TEST_SERIES_ID = 'series-poster-assign-test';
const TEST_EPISODE_ID = 'ep-poster-assign-s01e01';
const TEST_REEL_ID = '11111111-1111-4111-8111-111111111111';
const POSTER_REEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const POSTER_URL = `/thumbs/${POSTER_REEL_ID}.jpg`;
const AUTO_STILL = `/thumbs/${TEST_REEL_ID}.jpg`;

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
function collectEpisodeBindings(series) {
    return (series?.seasons || []).flatMap((season) =>
        (season.episodes || []).map((episode) => ({
            episodeId: episode.episodeId,
            reelId: episode.reelId || null,
            thumbnailUrl: episode.thumbnailUrl || ''
        }))
    );
}

const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});

try {
    const posterAssignment = await server.ssrLoadModule('/src/lib/studio/episodePosterAssignment.js');
    const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
    const seriesApi = await server.ssrLoadModule('/src/lib/api/seriesApi.js');
    const posterResolver = await server.ssrLoadModule('/src/lib/series/viewerEpisodePoster.js');
    const vicG = await server.ssrLoadModule('/src/lib/series/vicGSeriesPackage.js');
    const adminSession = await server.ssrLoadModule('/src/lib/adminSession.js');

    console.log('\n[1] Thumbnail Vault poster URL resolution');
    {
        const url = posterAssignment.resolveThumbnailVaultPosterUrl({
            id: POSTER_REEL_ID,
            url: POSTER_URL,
            name: 'Poster A'
        });
        assert(url === POSTER_URL, `resolved poster URL is ${POSTER_URL}`);
    }

    console.log('\n[2] Catalog picker helpers');
    {
        /** @type {import('../src/lib/series/seriesTypes.js').Series[]} */
        const catalog = [
            {
                id: TEST_SERIES_ID,
                title: 'Poster Assign Test',
                seasons: [
                    {
                        seasonId: 'season-poster-assign-1',
                        seasonNumber: 1,
                        title: 'Season 1',
                        episodes: [
                            {
                                episodeId: TEST_EPISODE_ID,
                                episodeNumber: 1,
                                title: 'Episode 1',
                                status: 'draft',
                                reelId: TEST_REEL_ID
                            }
                        ]
                    }
                ]
            }
        ];
        const seriesOptions = posterAssignment.listCatalogSeriesOptions(catalog);
        assert(seriesOptions.some((row) => row.id === TEST_SERIES_ID), 'series picker lists test series');
        const seasonOptions = posterAssignment.listSeasonOptionsForSeries(catalog, TEST_SERIES_ID);
        assert(seasonOptions.length === 1 && seasonOptions[0].seasonNumber === 1, 'season picker lists Season 1');
        const episodeOptions = posterAssignment.listEpisodeOptionsForSeason(catalog, TEST_SERIES_ID, 1);
        assert(
            episodeOptions.some((row) => row.episodeId === TEST_EPISODE_ID && row.reelId === TEST_REEL_ID),
            'episode picker lists bound episode with reelId'
        );
    }

    console.log('\n[3–8] assignEpisodePoster + API + viewer resolution');
    /** @type {Record<string, unknown> | null} */
    let capturedPut = null;
    /** @type {import('../src/lib/series/seriesTypes.js').Series | null} */
    let apiSeriesSnapshot = null;

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        const method = options.method || 'GET';

        if (href.includes('/api/series/status')) {
            return jsonResponse({ enabled: true, count: 2 });
        }
        if (href.includes('/api/series') && method === 'GET' && !href.includes('/api/series/')) {
            return jsonResponse({ series: apiSeriesSnapshot ? [apiSeriesSnapshot] : [] });
        }
        if (href.includes(`/api/episodes/${encodeURIComponent(TEST_EPISODE_ID)}`) && method === 'PUT') {
            capturedPut = JSON.parse(String(options.body || '{}'));
            return jsonResponse({ ok: true });
        }
        if (href.includes('/api/episodes') && method === 'POST') {
            return jsonResponse({ ok: true });
        }
        return nativeFetch ? nativeFetch(url, options) : jsonResponse({}, 404);
    };

    adminSession.setAdminSessionToken('test-admin-token');

    const vicPackage = vicG.buildVicGSeriesPackage();
    const vicBefore = collectEpisodeBindings(vicPackage);

    /** @type {import('../src/lib/series/seriesTypes.js').Series} */
    const testSeries = {
        id: TEST_SERIES_ID,
        title: 'Poster Assign Test',
        seasons: [
            {
                seasonId: 'season-poster-assign-1',
                seasonNumber: 1,
                title: 'Season 1',
                episodes: [
                    {
                        episodeId: TEST_EPISODE_ID,
                        episodeNumber: 1,
                        title: 'Episode 1',
                        status: 'draft',
                        reelId: TEST_REEL_ID,
                        thumbnailUrl: AUTO_STILL
                    }
                ]
            }
        ]
    };

    store.seriesCatalog.set([testSeries, vicPackage]);
    apiSeriesSnapshot = structuredClone(testSeries);

    const assignResult = await store.assignEpisodePoster(TEST_EPISODE_ID, POSTER_URL);
    assert(assignResult.ok === true, 'assignEpisodePoster succeeds');
    assert(assignResult.reelId === TEST_REEL_ID, 'reelId unchanged after poster assign');
    assert(assignResult.thumbnailUrl === POSTER_URL, 'assign result returns poster URL');

    const ctx = store.getEpisodeById(TEST_EPISODE_ID);
    assert(ctx?.episode?.episodeId === TEST_EPISODE_ID, 'episodeId unchanged');
    assert(ctx?.episode?.reelId === TEST_REEL_ID, 'catalog reelId unchanged');
    assert(ctx?.episode?.thumbnailUrl === POSTER_URL, 'catalog episode.thumbnailUrl updated');

    assert(Boolean(capturedPut), 'PUT /api/episodes/:id was called');
    assert(!('reelId' in (capturedPut || {})), 'PUT payload omits reelId');
    assert(capturedPut?.thumbnailUrl === POSTER_URL, 'PUT payload includes thumbnailUrl');

    const payload = seriesApi.episodeToApiRowPayload(ctx);
    assert(payload.thumbnailUrl === POSTER_URL, 'episodeToApiRowPayload carries thumbnailUrl');

    const resolvedPoster = posterResolver.resolveViewerEpisodePosterUrl({
        episode: ctx.episode,
        chipThumbnailUrl: AUTO_STILL,
        readyVaultAssets: [
            {
                id: TEST_REEL_ID,
                mediaAssetId: TEST_REEL_ID,
                reelId: TEST_REEL_ID,
                url: `/videos/${TEST_REEL_ID}.mp4`,
                thumbnailUrl: AUTO_STILL
            }
        ]
    });
    assert(resolvedPoster.includes(POSTER_REEL_ID), 'viewer prefers explicit episode.thumbnailUrl over MP4 auto-still');

    const vicAfter = collectEpisodeBindings(store.getSeriesById(VIC_G_ID));
    assert(vicBefore.length === vicAfter.length, 'Vic G episode count unchanged');
    for (const before of vicBefore) {
        const after = vicAfter.find((row) => row.episodeId === before.episodeId);
        assert(Boolean(after), `Vic G episode ${before.episodeId} still present`);
        assert(after?.reelId === before.reelId, `Vic G reelId unchanged for ${before.episodeId}`);
    }

    const catalogIds = get(store.seriesCatalog).map((series) => series.id);
    assert(
        catalogIds.filter((id) => id === TEST_SERIES_ID).length === 1,
        'no duplicate test series created'
    );
    assert(
        collectEpisodeBindings(testSeries).filter((row) => row.episodeId === TEST_EPISODE_ID).length === 1,
        'no duplicate test episode in fixture'
    );

    if (failures.length) {
        console.error('\nFAILURES:');
        for (const msg of failures) console.error(`  ✗ ${msg}`);
        process.exit(1);
    }
    console.log('\nvalidate-thumbnail-vault-episode-poster: PASS');
} finally {
    await server.close();
}
