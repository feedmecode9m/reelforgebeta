#!/usr/bin/env node
/**
 * Public-series hydrate must NOT overwrite Catalog API publish / S/E / package titles.
 *
 * Proves:
 *   API: A=draft E4, B=published E5, C=draft E6
 *   After polluted vault metadata + applyAuthoritativeApiCatalog + public vault hydrate:
 *     statuses + episodeNumbers + titles remain API-authoritative
 *   Viewer discoverability: only B
 */
import path from 'node:path';
import { fileURLToPath } from 'url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const failures = [];
const notes = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else notes.push(`ok: ${msg}`);
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
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

const A = '615e0eae-47b4-468a-b6dd-a6846b464846';
const B = '201ec6ee-6822-4bda-9295-080beb6f4e35';
const C = '9a5a243e-0a94-4166-b088-31cf717fa81c';

const API_CATALOG = [
    {
        id: 'series-stirred-gate',
        title: 'STIRRED',
        description: 'Card-targeting publish gate series',
        genre: 'Drama',
        releaseYear: 2026,
        seasons: [
            {
                seasonId: 'season-stirred-gate-1',
                seasonNumber: 1,
                title: 'Season 1',
                episodes: [
                    {
                        episodeId: 'ep-series-stirred-gate-s1e4',
                        episodeNumber: 4,
                        title: 'GATE_TITLE_A',
                        description: 'GATE_DESC_A',
                        status: 'draft',
                        reelId: A
                    },
                    {
                        episodeId: 'ep-series-stirred-gate-s1e5',
                        episodeNumber: 5,
                        title: 'GATE_TITLE_B',
                        description: 'GATE_DESC_B',
                        status: 'published',
                        reelId: B
                    },
                    {
                        episodeId: 'ep-series-stirred-gate-s1e6',
                        episodeNumber: 6,
                        title: 'GATE_TITLE_C',
                        description: 'GATE_DESC_C',
                        status: 'draft',
                        reelId: C
                    }
                ]
            }
        ]
    }
];

const POLLUTED_MAP = {
    [A]: {
        reelId: A,
        seriesId: 'series-stirred-gate',
        seriesName: 'STIRRED',
        seasonNumber: 1,
        episodeNumber: 1,
        episodeTitle: 'MICROS STIRRED V1',
        episodeId: 'ep-series-stirred-gate-s1e4',
        episodeStatus: 'ready'
    },
    [B]: {
        reelId: B,
        seriesId: 'series-stirred-gate',
        seriesName: 'STIRRED',
        seasonNumber: 1,
        episodeNumber: 1,
        episodeTitle: '07 AMP JAM V1',
        episodeId: 'ep-series-stirred-gate-s1e5',
        episodeStatus: 'ready'
    },
    [C]: {
        reelId: C,
        seriesId: 'series-stirred-gate',
        seriesName: 'STIRRED',
        seasonNumber: 1,
        episodeNumber: 6,
        episodeTitle: 'GATE_TITLE_C',
        episodeId: 'ep-series-stirred-gate-s1e6',
        episodeStatus: 'draft'
    }
};

const vault = [
    {
        id: A,
        mediaAssetId: A,
        name: 'MICROS STIRRED V1',
        title: 'GATE_TITLE_A',
        url: `https://cdn.example/${A}.mp4`,
        type: 'video/mp4',
        seriesLabel: 'STIRRED',
        seasonNumber: 1,
        episodeNumber: 4,
        seriesIdentity: {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 4,
            confirmedByCreator: true
        },
        episodeEnrichment: {
            title: 'GATE_TITLE_A',
            description: 'GATE_DESC_A',
            artworkUrl: `https://cdn.example/thumbs/${A}.jpg`
        }
    },
    {
        id: B,
        mediaAssetId: B,
        name: '07 AMP JAM V1',
        title: 'GATE_TITLE_B',
        url: `https://cdn.example/${B}.mp4`,
        type: 'video/mp4',
        seriesLabel: 'STIRRED',
        seasonNumber: 1,
        episodeNumber: 5,
        seriesIdentity: {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 5,
            confirmedByCreator: true
        },
        episodeEnrichment: {
            title: 'GATE_TITLE_B',
            description: 'GATE_DESC_B',
            artworkUrl: `https://cdn.example/thumbs/${B}.jpg`
        }
    },
    {
        id: C,
        mediaAssetId: C,
        name: 'RC Playback Accept',
        title: 'GATE_TITLE_C',
        url: `https://cdn.example/${C}.mp4`,
        type: 'video/mp4',
        seriesLabel: 'STIRRED',
        seasonNumber: 1,
        episodeNumber: 6,
        seriesIdentity: {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: 6,
            confirmedByCreator: true
        },
        episodeEnrichment: {
            title: 'GATE_TITLE_C',
            description: 'GATE_DESC_C',
            artworkUrl: `https://cdn.example/thumbs/${C}.jpg`
        }
    }
];

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const hydration = await vite.ssrLoadModule('/src/lib/series/publicSeriesHydration.js');
    const life = await vite.ssrLoadModule('/src/lib/series/publishingLifecycle.js');
    const { get } = await vite.ssrLoadModule('svelte/store');

    store.resetSeriesCatalogEmpty();
    bag.clear();

    // Plant vault + polluted sticky map (simulates prior broken hydrate writeback)
    localStorage.setItem('personal_video_vault', JSON.stringify(vault));
    localStorage.setItem(
        'reelforge_series_metadata',
        JSON.stringify({ map: POLLUTED_MAP, catalog: API_CATALOG, cachedAt: Date.now(), ...POLLUTED_MAP })
    );

    // Apply API catalog authority (merge must not let ready/E1 overwrite published/E5)
    store.applyAuthoritativeApiCatalog(API_CATALOG);

    let series = hydration.resolvePublicSeriesBySlug('stirred-gate', get(store.seriesCatalog));
    assert(Boolean(series), 'series-stirred-gate resolves');
    let eps = (series?.seasons || []).flatMap((s) => s.episodes || []);
    const byReel = Object.fromEntries(eps.map((e) => [String(e.reelId), e]));

    assert(byReel[A]?.status === 'draft', `A draft (got ${byReel[A]?.status})`);
    assert(byReel[B]?.status === 'published', `B published (got ${byReel[B]?.status})`);
    assert(byReel[C]?.status === 'draft', `C draft (got ${byReel[C]?.status})`);
    assert(Number(byReel[A]?.episodeNumber) === 4, `A E4 (got ${byReel[A]?.episodeNumber})`);
    assert(Number(byReel[B]?.episodeNumber) === 5, `B E5 (got ${byReel[B]?.episodeNumber})`);
    assert(Number(byReel[C]?.episodeNumber) === 6, `C E6 (got ${byReel[C]?.episodeNumber})`);
    assert(byReel[A]?.title === 'GATE_TITLE_A', `A title preserved (got ${byReel[A]?.title})`);
    assert(byReel[B]?.title === 'GATE_TITLE_B', `B title preserved (got ${byReel[B]?.title})`);
    assert(byReel[C]?.title === 'GATE_TITLE_C', `C title preserved (got ${byReel[C]?.title})`);

    // Public vault hydrate must not clobber authority
    hydration.hydratePublicSeriesFromVault({
        items: vault,
        initMetadata: false,
        source: 'validate-public-catalog-authority'
    });

    series = hydration.resolvePublicSeriesBySlug('stirred-gate', get(store.seriesCatalog));
    eps = (series?.seasons || []).flatMap((s) => s.episodes || []);
    const byId = Object.fromEntries(eps.map((e) => [String(e.episodeId), e]));
    const byReel2 = Object.fromEntries(eps.map((e) => [String(e.reelId), e]));

    assert(byReel2[A]?.status === 'draft', `post-hydrate A draft`);
    assert(byReel2[B]?.status === 'published', `post-hydrate B published`);
    assert(byReel2[C]?.status === 'draft', `post-hydrate C draft`);
    assert(Number(byReel2[B]?.episodeNumber) === 5, `post-hydrate B still E5`);
    assert(byReel2[B]?.title === 'GATE_TITLE_B', `post-hydrate B package title`);
    assert(byId['ep-series-stirred-gate-s1e5']?.status === 'published', 'episodeId B published');

    // Viewer filter: only B
    const discoverable = eps.filter((e) => life.episodeIsViewerDiscoverable(e));
    assert(discoverable.length === 1, `exactly 1 discoverable (got ${discoverable.length})`);
    assert(discoverable[0]?.reelId === B, `discoverable is B (got ${discoverable[0]?.reelId})`);
    assert(Number(discoverable[0]?.episodeNumber) === 5, 'discoverable shows E5 not display rank 1');
    assert(discoverable[0]?.title === 'GATE_TITLE_B', 'discoverable presentation GATE_TITLE_B');

    // Sticky map repaired
    const mapRaw = localStorage.getItem('reelforge_series_metadata');
    let mapParsed = {};
    try {
        mapParsed = JSON.parse(mapRaw || '{}');
    } catch {
        mapParsed = {};
    }
    // Map may be flat or nested under map
    const rowB = mapParsed[B] || mapParsed.map?.[B] || {};
    assert(
        rowB.episodeStatus === 'published' || byReel2[B]?.status === 'published',
        'map or catalog keeps B published after hydrate'
    );

    if (failures.length) {
        console.error('FAIL validate-public-catalog-authority');
        for (const f of failures) console.error('  -', f);
        process.exit(1);
    }
    console.log('PASS validate-public-catalog-authority');
    for (const n of notes) console.log('  ' + n);
} finally {
    await vite.close();
}
