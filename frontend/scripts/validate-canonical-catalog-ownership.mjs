#!/usr/bin/env node
/**
 * Canonical catalog ownership > Vault/NLP inference.
 *
 * Proves:
 *   1) E04/E05/E06 stay bound to Vic G through membership reconcile + bridge inference
 *   2) No competing published singleton ownership for those reels
 *   3) E02 (cadfcabc…) stays protected after UUID rotation
 *   4) E03 remains on Vic G (unresolved editorial state unchanged)
 *   5) Unowned vault reels can still infer provisional series shells
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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

const REEL = {
    e01: '03ef898a-989f-42c3-bdbb-67f37338df65',
    e02: 'cadfcabc-1947-4341-86a3-f82a08e78669',
    e03: '3894107e-ae44-43c5-af72-b3f5d5e0ad90',
    e04: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1',
    e05: 'efb01cee-9477-4477-982a-7611cfc08fcc',
    e06: '5cc786f0-8fbe-4f96-a59d-02014b0cc56f',
    unowned: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'
};

/** @returns {import('../src/lib/series/seriesTypes.js').Series[]} */
function buildVicGCatalog() {
    return [
        {
            id: 'series-vic-g',
            title: 'Vic G',
            tags: ['vault-inferred', 'nlp-rehomed'],
            seasons: [
                {
                    seasonId: 'season-vic-g-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [
                        {
                            episodeId: 'ep-vic-g-s01e01',
                            episodeNumber: 1,
                            title: 'ep-vic-g-s01e01',
                            status: 'draft',
                            reelId: REEL.e01,
                            tags: ['vault-inferred']
                        },
                        {
                            episodeId: 'ep-vic-g-s01e02',
                            episodeNumber: 2,
                            title: '',
                            status: 'published',
                            reelId: REEL.e02,
                            tags: ['creator-package', 'creator-confirmed']
                        },
                        {
                            episodeId: 'ep-vic-g-s01e03',
                            episodeNumber: 3,
                            title: '',
                            status: 'published',
                            reelId: REEL.e03,
                            tags: ['vault-inferred']
                        },
                        {
                            episodeId: 'ep-vic-g-s01e04',
                            episodeNumber: 4,
                            title: 'Set Shooting Pt 1',
                            status: 'published',
                            reelId: REEL.e04,
                            tags: ['vault-inferred']
                        },
                        {
                            episodeId: 'ep-vic-g-s01e05',
                            episodeNumber: 5,
                            title: 'Set Shooting Pt 2',
                            status: 'published',
                            reelId: REEL.e05,
                            tags: ['vault-inferred']
                        },
                        {
                            episodeId: 'ep-vic-g-s01e06',
                            episodeNumber: 6,
                            title: 'Condo High Rise',
                            status: 'published',
                            reelId: REEL.e06,
                            tags: ['vault-inferred']
                        }
                    ]
                }
            ]
        },
        {
            id: 'series-04-set-shooting-pt-1',
            title: '04 SET SHOOTING PT 1',
            tags: ['vault-inferred'],
            seasons: [
                {
                    seasonId: 'season-04-set-shooting-pt-1-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: []
                }
            ]
        },
        {
            id: 'series-05-set-shooting-pt-2',
            title: '05 SET SHOOTING PT 2',
            tags: ['vault-inferred'],
            seasons: [
                {
                    seasonId: 'season-05-set-shooting-pt-2-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: []
                }
            ]
        },
        {
            id: 'series-06-condo-high-rise',
            title: '06 CONDO HIGH RISE',
            tags: ['vault-inferred'],
            seasons: [
                {
                    seasonId: 'season-06-condo-high-rise-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: []
                }
            ]
        }
    ];
}

/** @param {Record<string, unknown>} reel */
function vaultReel(reel) {
    return {
        id: reel.id,
        name: reel.name,
        title: reel.name,
        url: 'http://127.0.0.1:8080/videos/sample.mp4',
        video_url: 'http://127.0.0.1:8080/videos/sample.mp4',
        status: 'ready',
        validated: true
    };
}

const VAULT_REELS = [
    vaultReel({ id: REEL.e04, name: '04 SET SHOOTING PT 1 V1' }),
    vaultReel({ id: REEL.e05, name: '05 SET SHOOTING PT 2 V1' }),
    vaultReel({ id: REEL.e06, name: '06 CONDO HIGH RISE V1' }),
    vaultReel({ id: REEL.e02, name: '02 ARRIVAL THE PROJECT INTRO v1' }),
    vaultReel({ id: REEL.unowned, name: '99 UNRELATED PRODUCTION V1' })
];

const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});

try {
    const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
    const infer = await server.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
    const bridge = await server.ssrLoadModule('/src/lib/series/episodeBridge.js');
    const ownership = await server.ssrLoadModule('/src/lib/series/canonicalCatalogOwnership.js');
    const vicG = await server.ssrLoadModule('/src/lib/series/vicGSeriesPackage.js');
    const browse = await server.ssrLoadModule('/src/lib/series/viewerSeriesBrowseCatalog.js');

    store.applyAuthoritativeApiCatalog(buildVicGCatalog());

    assert(
        ownership.isAuthoritativeCatalogBinding(store.getEpisodeByReelId(REEL.e04)),
        'E04 Vic G binding is authoritative before inference'
    );
    assert(
        ownership.isAuthoritativeCatalogBinding(store.getEpisodeByReelId(REEL.e02)),
        'E02 Vic G binding is authoritative before inference'
    );
    assert(
        ownership.isAuthoritativeCatalogBinding(store.getEpisodeByReelId(REEL.e03)),
        'E03 remains bound on Vic G (unresolved editorial unchanged)'
    );

    const membership = infer.reconcileCatalogMembershipFromVault(VAULT_REELS, {
        source: 'validate-canonical-ownership'
    });
    assert(membership.rehomed === 0, 'membership reconcile does not rehome canonical Vic G reels');
    assert(membership.detached === 0, 'membership reconcile does not detach canonical Vic G reels');

    for (const reelId of [REEL.e02, REEL.e04, REEL.e05, REEL.e06, REEL.e03]) {
        const ctx = store.getEpisodeByReelId(reelId);
        assert(ctx?.series?.id === 'series-vic-g', `${reelId} remains on series-vic-g after reconcile`);
    }

    bridge.bridgeFeedReelsToCatalog(VAULT_REELS);

    for (const reelId of [REEL.e02, REEL.e04, REEL.e05, REEL.e06]) {
        const ctx = store.getEpisodeByReelId(reelId);
        assert(ctx?.series?.id === 'series-vic-g', `${reelId} remains on Vic G after bridgeFeedReelsToCatalog`);
    }

    const singletonIds = [
        'series-04-set-shooting-pt-1',
        'series-05-set-shooting-pt-2',
        'series-06-condo-high-rise'
    ];
    for (const seriesId of singletonIds) {
        const series = store.getSeriesById(seriesId);
        const published = (series?.seasons || [])
            .flatMap((s) => s.episodes || [])
            .filter((e) => e.status === 'published');
        assert(published.length === 0, `${seriesId} has no published competing episodes`);
    }

    const { get } = await server.ssrLoadModule('svelte/store');
    const merged = vicG.mergeVicGSeriesIntoCatalog(get(store.seriesCatalog));
    store.seriesCatalog.set(merged);
    for (const reelId of [REEL.e04, REEL.e05, REEL.e06]) {
        for (const seriesId of singletonIds) {
            const series = store.getSeriesById(seriesId);
            const hit = (series?.seasons || [])
                .flatMap((s) => s.episodes || [])
                .some((ep) => String(ep.reelId || '') === reelId);
            assert(!hit, `mergeVicGSeriesIntoCatalog strips ${reelId} from ${seriesId}`);
        }
    }

    let catalogSnapshot = [];
    const unsub = store.seriesCatalog.subscribe((items) => {
        catalogSnapshot = items;
    });
    unsub();

    const browseResult = browse.buildViewerSeriesBrowseCatalog(catalogSnapshot, { sectionLimit: 12 });
    const originalIds = browseResult.sections.original.map((item) => item.seriesId);
    assert(!originalIds.includes('series-04-set-shooting-pt-1'), 'Browse does not promote E04 singleton');
    assert(!originalIds.includes('series-05-set-shooting-pt-2'), 'Browse does not promote E05 singleton');
    assert(!originalIds.includes('series-06-condo-high-rise'), 'Browse does not promote E06 singleton');
    assert(originalIds.includes('series-vic-g'), 'Browse keeps Vic G as production representative');

    store.seriesCatalog.set([]);
    store.applyAuthoritativeApiCatalog([
        {
            id: 'series-neon-vengeance',
            title: 'Neon Vengeance',
            seasons: [{ seasonNumber: 1, title: 'Season 1', episodes: [] }]
        }
    ]);

    infer.inferAndBindVaultSeries([vaultReel({ id: REEL.unowned, name: '99 UNRELATED PRODUCTION V1' })], {
        source: 'validate-canonical-ownership-unowned'
    });
    const inferred = store.getEpisodeByReelId(REEL.unowned);
    assert(Boolean(inferred?.series?.id), 'unowned vault reel can still infer provisional catalog binding');
    assert(inferred?.series?.id !== 'series-vic-g', 'unowned reel is not forced onto Vic G');
} finally {
    await server.close();
}

if (failures.length) {
    console.error('\nFAIL validate-canonical-catalog-ownership');
    for (const msg of failures) console.error(`  ✗ ${msg}`);
    process.exit(1);
}

console.log('\nPASS validate-canonical-catalog-ownership');
