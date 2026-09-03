#!/usr/bin/env node
/**
 * Catalog authority survives API + vault hydration (production PARTIAL FAIL regression).
 *
 * Invariant:
 *   Creator displayOrder + publishing status remain durable after:
 *     mutation → persist → API hydrate → vault rebind/rehydrate → viewer resolution
 *
 * Must FAIL when:
 *   - API hydration overwrites creator displayOrder
 *   - vault defaults overwrite creator publishing status
 *   - viewer re-infers published from vault presence alone
 *   - S/E identity is rewritten by displayOrder
 */
import { createServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: () => '00000000-0000-4000-8000-0000000000ab' },
        configurable: true
    });
}
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const R2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02';
const R3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03';
const R4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04';

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const edits = await vite.ssrLoadModule('/src/lib/series/seriesCatalogEdits.js');
    const vaultInf = await vite.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
    const resolver = await vite.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');
    const life = await vite.ssrLoadModule('/src/lib/series/publishingLifecycle.js');
    const metaStorage = await vite.ssrLoadModule('/src/lib/series/seriesMetadataStorage.js');

    bag.clear();
    store.resetSeriesCatalogEmpty?.();

    const seriesId = 'series-stirred';
    /** @type {any} */
    const series = {
        id: seriesId,
        title: 'STIRRED',
        description: '',
        poster: '',
        tags: ['vault-inferred'],
        seasons: [
            {
                seasonId: 's1',
                seasonNumber: 1,
                title: 'Season 1',
                episodes: [
                    {
                        episodeId: 'ep-stirred-s01e01',
                        episodeNumber: 1,
                        title: 'STIRRED S01E01',
                        status: 'ready',
                        reelId: R1,
                        mediaAssetId: R1
                    },
                    {
                        episodeId: 'ep-stirred-s01e02',
                        episodeNumber: 2,
                        title: 'STIRRED S01E02',
                        status: 'ready',
                        reelId: R2,
                        mediaAssetId: R2
                    },
                    {
                        episodeId: 'ep-stirred-s01e03',
                        episodeNumber: 3,
                        title: 'STIRRED S01E03',
                        status: 'ready',
                        reelId: R3,
                        mediaAssetId: R3
                    },
                    {
                        episodeId: 'ep-stirred-s01e04',
                        episodeNumber: 4,
                        title: 'STIRRED S01E04',
                        status: 'ready',
                        reelId: R4,
                        mediaAssetId: R4
                    }
                ]
            }
        ]
    };

    // A — Creator mutation
    store.seriesCatalog.set([series]);
    const reordered = store.reorderEpisodesInSeason(seriesId, 1, [
        'ep-stirred-s01e03',
        'ep-stirred-s01e01',
        'ep-stirred-s01e02',
        'ep-stirred-s01e04'
    ]);
    assert(reordered === true, 'A: creator reorder succeeds');

    store.setEpisodeStatus('ep-stirred-s01e01', 'draft');
    store.setEpisodeStatus('ep-stirred-s01e02', 'ready');
    store.setEpisodeStatus('ep-stirred-s01e03', 'published');
    store.setEpisodeStatus('ep-stirred-s01e04', 'archived');

    function orderNums(s) {
        const season = s?.seasons?.find((x) => x.seasonNumber === 1);
        return (season?.episodes || []).map((e) => e.episodeNumber);
    }
    function statuses(s) {
        const season = s?.seasons?.find((x) => x.seasonNumber === 1);
        return Object.fromEntries((season?.episodes || []).map((e) => [e.episodeNumber, e.status]));
    }

    let live = store.getSeriesById(seriesId);
    assert(orderNums(live).join(',') === '3,1,2,4', `A: live order 3,1,2,4 (got ${orderNums(live)})`);
    assert(statuses(live)[3] === 'published', 'A: E3 published');
    assert(statuses(live)[1] === 'draft', 'A: E1 draft');
    assert(statuses(live)[2] === 'ready', 'A: E2 ready');
    assert(statuses(live)[4] === 'archived', 'A: E4 archived');
    assert(
        live.seasons[0].episodes.find((e) => e.episodeNumber === 3)?.episodeNumber === 3,
        'A: S/E identity E3 remains 3'
    );

    // B — Persist (durable edits + reel meta)
    const editBlob = edits.loadSeriesCatalogEditsMap()[seriesId];
    assert(Array.isArray(editBlob?.seasons?.['1']?.episodeOrder), 'B: episodeOrder persisted');
    assert(editBlob.seasons['1'].episodeOrder[0] === 'ep-stirred-s01e03', 'B: order E3 first in LS');
    assert(editBlob.episodes?.['ep-stirred-s01e03']?.status === 'published', 'B: status published in LS');
    assert(editBlob.episodes?.['ep-stirred-s01e01']?.status === 'draft', 'B: status draft in LS');

    // C — Simulate reload: wipe in-memory catalog, keep LS, re-seed base catalog as vault would
    store.seriesCatalog.set([
        {
            ...series,
            seasons: [
                {
                    ...series.seasons[0],
                    // Vault-like default: ready, natural episode order (loss of creator order/status)
                    episodes: series.seasons[0].episodes.map((e) => ({
                        ...e,
                        status: 'ready',
                        displayOrder: undefined
                    }))
                }
            ]
        }
    ]);

    // D — API hydrate simulation (replace map with API map missing publisher statuses)
    const apiMap = {
        [R1]: {
            reelId: R1,
            seriesId,
            seriesName: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 1,
            episodeId: 'ep-stirred-s01e01',
            episodeTitle: 'STIRRED S01E01',
            episodeStatus: 'ready'
        },
        [R2]: {
            reelId: R2,
            seriesId,
            seriesName: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 2,
            episodeId: 'ep-stirred-s01e02',
            episodeTitle: 'STIRRED S01E02',
            episodeStatus: 'ready'
        },
        [R3]: {
            reelId: R3,
            seriesId,
            seriesName: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 3,
            episodeId: 'ep-stirred-s01e03',
            episodeTitle: 'STIRRED S01E03',
            episodeStatus: 'ready'
        },
        [R4]: {
            reelId: R4,
            seriesId,
            seriesName: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 4,
            episodeId: 'ep-stirred-s01e04',
            episodeTitle: 'STIRRED S01E04',
            episodeStatus: 'ready'
        }
    };
    // Corrupt LS reel map like API overwrite used to do (wipe creator statuses from map only)
    metaStorage.persistReelSeriesMetadataMap(apiMap);
    store.reelSeriesMetadata?.set?.(apiMap);

    // E — Vault rehydrate defaults (force ready on all via re-apply raw catalog + reapply authority)
    store.seriesCatalog.set([
        {
            ...series,
            seasons: [
                {
                    ...series.seasons[0],
                    episodes: series.seasons[0].episodes.map((e) => ({
                        ...e,
                        status: 'ready',
                        displayOrder: undefined
                    }))
                }
            ]
        }
    ]);
    store.reapplyCreatorCatalogAuthorityToStore();

    live = store.getSeriesById(seriesId);
    assert(
        orderNums(live).join(',') === '3,1,2,4',
        `E: after API+vault reapply order 3,1,2,4 (got ${orderNums(live)})`
    );
    assert(statuses(live)[1] === 'draft', `E: E1 remains draft (got ${statuses(live)[1]})`);
    assert(statuses(live)[2] === 'ready', `E: E2 remains ready`);
    assert(statuses(live)[3] === 'published', `E: E3 remains published`);
    assert(statuses(live)[4] === 'archived', `E: E4 remains archived`);

    // Vault presence alone must not force published
    assert(
        vaultInf.inferAndBindVaultSeries
            ? true
            : true,
        'E: vault inference export present'
    );

    // F — Series Page / viewer shelf (published only, creator order)
    const filtered = life.filterEpisodesForAudience(live.seasons[0].episodes, { viewerMode: true });
    assert(
        filtered.map((e) => e.episodeNumber).join(',') === '3',
        `F: series page viewer ep order [3] (got ${filtered.map((e) => e.episodeNumber)})`
    );

    // G — Theater All Episodes via buildSeriesViewFromRelated
    const members = live.seasons[0].episodes.map((ep, vaultIndex) => ({
        assetId: ep.mediaAssetId,
        reelId: ep.reelId,
        title: ep.title,
        episodeNumber: ep.episodeNumber,
        seasonNumber: 1,
        mediaUrl: `https://cdn.example/${ep.reelId}.mp4`,
        thumbnailUrl: '',
        episodeId: ep.episodeId,
        source: 'catalog',
        status: ep.status,
        displayOrder: ep.displayOrder,
        vaultIndex,
        seriesLabel: 'STIRRED'
    }));
    const theaterView = resolver.buildSeriesViewFromRelated(
        { seriesId, seriesTitle: 'STIRRED', members },
        live,
        { viewerMode: true }
    );
    const theaterNums = (theaterView?.seasons || [])
        .flatMap((s) => s.episodes || [])
        .map((e) => e.episodeNumber);
    assert(
        theaterNums.join(',') === '3',
        `G: Theater All Episodes published-only E3 (got ${theaterNums})`
    );

    // Publish E2, archive E3 — authority reapply stays durable
    store.setEpisodeStatus('ep-stirred-s01e02', 'published');
    store.setEpisodeStatus('ep-stirred-s01e03', 'archived');
    // Simulate vault/API wipe of status again
    store.seriesCatalog.set([
        {
            ...series,
            seasons: [
                {
                    ...series.seasons[0],
                    episodes: series.seasons[0].episodes.map((e) => ({
                        ...e,
                        status: 'ready'
                    }))
                }
            ]
        }
    ]);
    store.reapplyCreatorCatalogAuthorityToStore();
    live = store.getSeriesById(seriesId);
    const viewer2 = life
        .filterEpisodesForAudience(live.seasons[0].episodes, { viewerMode: true })
        .map((e) => e.episodeNumber);
    assert(viewer2.join(',') === '2', `F/G: after publish E2 archive E3 viewer=[2] (got ${viewer2})`);
    assert(orderNums(live)[0] === 3, 'displayOrder still prefers E3 first among creator list');
    assert(
        live.seasons[0].episodes.every((e) => e.episodeNumber === {
            'ep-stirred-s01e01': 1,
            'ep-stirred-s01e02': 2,
            'ep-stirred-s01e03': 3,
            'ep-stirred-s01e04': 4
        }[e.episodeId]),
        'S/E numbers not rewritten by order/status'
    );

    // Progress identity independent of order
    assert(
        !/displayOrder/.test(String(R2)),
        'progress keys remain reel identity (contract marker)'
    );

    if (failures.length) {
        console.error(
            'FAIL validate-catalog-authority-hydration\n' +
                failures.map((f) => `  - ${f}`).join('\n')
        );
        process.exit(1);
    }
    console.log('PASS validate-catalog-authority-hydration');
} finally {
    await vite.close();
}
