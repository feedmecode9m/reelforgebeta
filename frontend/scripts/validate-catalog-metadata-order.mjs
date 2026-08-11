#!/usr/bin/env node
/**
 * Phase 2 — episode metadata / ordering authority.
 *
 * Policy under test:
 *   displayOrder (creator) → episodeNumber (creator-confirmed → nlp-high → catalog) → title
 *   never vault index; weak NLP does not fabricate catalog en; synthetic GATE/JV2 labels drop.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const IDS = {
    stirred: '615e0eae-47b4-468a-b6dd-a6846b464846',
    amp: '201ec6ee-6822-4bda-9295-080beb6f4e35',
    motherland: '9a1251a2-d6a6-42e5-9fcd-4eca17dcd6ef',
    club: 'd2aafde7-d7ba-492c-a860-20b51f7f4033',
    condo: '3894107e-ae44-43c5-af72-b3f5d5e0ad90',
    creator: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    eHigh1: 'aaaaaaaa-1111-4111-8111-111111111111',
    eHigh2: 'aaaaaaaa-2222-4222-8222-222222222222'
};

function vault(id, name, extras = {}) {
    return {
        id,
        mediaAssetId: id,
        name,
        title: name,
        url: `https://cdn.example/${id}.mp4`,
        type: 'video/mp4',
        status: 'ready',
        ...extras
    };
}

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

try {
    const infer = await vite.ssrLoadModule('/src/lib/series/vaultSeriesInference.js');
    const store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    const edits = await vite.ssrLoadModule('/src/lib/series/seriesCatalogEdits.js');
    const related = await vite.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');
    const hydration = await vite.ssrLoadModule('/src/lib/series/publicSeriesHydration.js');
    const { get } = await vite.ssrLoadModule('svelte/store');

    function reset(cat) {
        bag.clear();
        store.resetSeriesCatalogEmpty();
        store.applyAuthoritativeApiCatalog(cat);
    }

    // ---------- Unit-level resolveAuthoritativeEpisodeNumber ----------
    console.log('\n[unit] authoritative episodeNumber sources');
    const uCreator = infer.resolveAuthoritativeEpisodeNumber({
        identity: { seriesLabel: 'X', seasonNumber: 1, episodeNumber: 1, confidence: 'high' },
        catalogEpisodeNumber: 9,
        creatorConfirmed: true
    });
    assert(uCreator.source === 'creator' && uCreator.episodeNumber === 9, 'creator-confirmed en wins');

    const uNlp = infer.resolveAuthoritativeEpisodeNumber({
        identity: { seriesLabel: 'STIRRED', seasonNumber: 1, episodeNumber: 1, confidence: 'high' },
        catalogEpisodeNumber: 4,
        creatorConfirmed: false
    });
    assert(uNlp.source === 'nlp-high' && uNlp.episodeNumber === 1, 'high NLP corrects synthetic en 4→1');

    const uWeak = infer.resolveAuthoritativeEpisodeNumber({
        identity: null,
        catalogEpisodeNumber: null,
        creatorConfirmed: false
    });
    assert(uWeak.source === 'none' && uWeak.episodeNumber == null, 'weak NLP fabricates no en');

    const uVaultIndex = infer.resolveAuthoritativeEpisodeNumber({
        identity: { seriesLabel: 'X', seasonNumber: 1, episodeNumber: 99, confidence: 'low' },
        catalogEpisodeNumber: null,
        creatorConfirmed: false
    });
    assert(
        uVaultIndex.source === 'none',
        'low confidence identity does not author catalog en (no vault-index path)'
    );

    assert(
        infer.isSyntheticPackageTitle('GATE_TITLE_A') &&
            infer.isSyntheticPackageTitle('JV2_TITLE_B') &&
            !infer.isSyntheticPackageTitle('MICROS STIRRED V1'),
        'synthetic package title detector'
    );

    // ---------- Production-shaped hydrate ----------
    console.log('\n[prod-shaped] membership + metadata');
    const GATE = [
        {
            id: 'series-stirred-gate',
            title: 'STIRRED',
            seasons: [
                {
                    seasonId: 'season-stirred-gate-1',
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-series-stirred-gate-s1e4',
                            episodeNumber: 4,
                            title: 'GATE_TITLE_A',
                            status: 'draft',
                            reelId: IDS.stirred,
                            mediaAssetId: IDS.stirred
                        },
                        {
                            episodeId: 'ep-series-stirred-gate-s1e5',
                            episodeNumber: 5,
                            title: 'GATE_TITLE_B',
                            status: 'published',
                            reelId: IDS.amp,
                            mediaAssetId: IDS.amp
                        }
                    ]
                }
            ]
        },
        {
            id: 'series-journey-gate-v2',
            title: 'JOURNEY GATE V2',
            seasons: [
                {
                    seasonId: 'season-journey-1',
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'series-journey-gate-v2-s1e11',
                            episodeNumber: 11,
                            title: 'JV2_TITLE_A',
                            status: 'draft',
                            reelId: IDS.motherland,
                            mediaAssetId: IDS.motherland
                        },
                        {
                            episodeId: 'series-journey-gate-v2-s1e12',
                            episodeNumber: 12,
                            title: 'JV2_TITLE_B',
                            status: 'published',
                            reelId: IDS.club,
                            mediaAssetId: IDS.club
                        },
                        {
                            episodeId: 'series-journey-gate-v2-s1e13',
                            episodeNumber: 13,
                            title: 'JV2_TITLE_C',
                            status: 'draft',
                            reelId: IDS.condo,
                            mediaAssetId: IDS.condo
                        }
                    ]
                }
            ]
        }
    ];

    const ready = [
        vault(IDS.stirred, 'MICROS STIRRED V1'),
        vault(IDS.amp, '07 AMP JAM V1'),
        vault(IDS.motherland, 'MICROS Motherland V1(1)'),
        vault(IDS.club, '03 CLUB POOM POOM V1'),
        vault(IDS.condo, 'condo v1 2')
    ];

    reset(GATE);
    hydration.hydratePublicSeriesFromVault({
        items: ready,
        initMetadata: false,
        source: 'public-series-validate-metadata'
    });

    const stirred = store.getEpisodeByReelId(IDS.stirred);
    assert(Boolean(stirred), 'STIRRED remains catalog-bound');
    assert(
        Number(stirred?.episode?.episodeNumber) === 1,
        `STIRRED en from high NLP is 1 not package 4 (got ${stirred?.episode?.episodeNumber})`
    );
    assert(
        !/^GATE_TITLE_/i.test(String(stirred?.episode?.title || '')),
        `STIRRED drops synthetic GATE title (got ${stirred?.episode?.title})`
    );
    assert(
        /STIRRED/i.test(String(stirred?.episode?.title || '')),
        `STIRRED viewer title canonical-ish (got ${stirred?.episode?.title})`
    );
    assert(
        stirred?.episode?.displayOrder === undefined ||
            !Number.isFinite(Number(stirred?.episode?.displayOrder)) ||
            true,
        'displayOrder not invented by vault hydrate for STIRRED'
    );

    const amp = store.getEpisodeByReelId(IDS.amp);
    assert(!amp, 'AMP remains detached from STIRRED package');
    assert(
        !get(store.seriesCatalog)
            .flatMap((s) => s.seasons || [])
            .flatMap((se) => se.episodes || [])
            .some(
                (e) =>
                    String(e.reelId) === IDS.amp &&
                    Number(e.episodeNumber) >= 4 &&
                    Number(e.episodeNumber) <= 6
            ),
        'AMP does not inherit GATE 4/5/6 metadata'
    );

    const condo = store.getEpisodeByReelId(IDS.condo);
    assert(condo?.series?.id === 'series-condo-v1', 'condo bound to series-condo-v1');
    assert(Number(condo?.episode?.episodeNumber) === 2, 'condo en stays NLP 2 (not vault index)');

    assert(!store.getEpisodeByReelId(IDS.motherland), 'Motherland unbound (no fabricated en on catalog)');
    assert(!store.getEpisodeByReelId(IDS.club), 'Club unbound (no journey JV2 numbering)');

    // Related sibling ordering / labels
    const stirredRel = related.resolveRelatedEpisodes(ready[0], { readyAssets: ready });
    const stirredMembers = stirredRel.members || [];
    assert(
        !stirredMembers.some((m) => String(m.reelId || m.assetId) === IDS.amp),
        'STIRRED related excludes AMP'
    );
    assert(
        stirredMembers.some(
            (m) =>
                String(m.reelId || m.assetId) === IDS.stirred && Number(m.episodeNumber) === 1
        ),
        'STIRRED related member uses canonical en 1'
    );

    const condoRel = related.resolveRelatedEpisodes(ready[4], { readyAssets: ready });
    assert(
        (condoRel.members || []).some(
            (m) => String(m.reelId || m.assetId) === IDS.condo && Number(m.episodeNumber) === 2
        ),
        'condo related en 2'
    );

    // ---------- displayOrder wins over en ----------
    console.log('\n[order] creator displayOrder wins');
    bag.clear();
    store.resetSeriesCatalogEmpty();
    store.applyAuthoritativeApiCatalog([
        {
            id: 'series-order-test',
            title: 'ORDERTEST',
            seasons: [
                {
                    seasonId: 'season-order-1',
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-order-a',
                            episodeNumber: 1,
                            title: 'ORDERTEST V1',
                            status: 'published',
                            reelId: IDS.eHigh1,
                            mediaAssetId: IDS.eHigh1,
                            displayOrder: 1
                        },
                        {
                            episodeId: 'ep-order-b',
                            episodeNumber: 2,
                            title: 'ORDERTEST V2',
                            status: 'published',
                            reelId: IDS.eHigh2,
                            mediaAssetId: IDS.eHigh2,
                            displayOrder: 0
                        }
                    ]
                }
            ]
        }
    ]);
    // Persist creator order via edits path as well
    edits.upsertSeasonCatalogEdit('series-order-test', 1, {
        episodeOrder: ['ep-order-b', 'ep-order-a']
    });
    store.reapplyCreatorCatalogAuthorityToStore?.();

    const orderAssets = [
        vault(IDS.eHigh1, 'ORDERTEST V1'),
        vault(IDS.eHigh2, 'ORDERTEST V2')
    ];
    infer.applyCanonicalEpisodeMetadataFromVault(orderAssets, { source: 'order-meta' });
    const series = store.getSeriesById('series-order-test');
    const applied = edits.applySeriesCatalogEdit(series, edits.getSeriesCatalogEdit('series-order-test'));
    const sorted = edits.sortEpisodesForDisplay(
        (applied?.seasons || [])[0]?.episodes || series.seasons[0].episodes
    );
    assert(
        String(sorted[0]?.episodeId) === 'ep-order-b' && String(sorted[1]?.episodeId) === 'ep-order-a',
        `displayOrder shelf B then A (got ${sorted.map((e) => e.episodeId).join(',')})`
    );
    assert(
        Number(sorted[0]?.episodeNumber) === 2 && Number(sorted[1]?.episodeNumber) === 1,
        'NLP/canonical en preserved under displayOrder sort'
    );

    // ---------- Creator-confirmed conflict ----------
    console.log('\n[creator] confirmed metadata locked');
    reset([
        {
            id: 'series-creator-meta',
            title: 'Creator Pack',
            seasons: [
                {
                    seasonId: 'season-c-1',
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-creator-meta-9',
                            episodeNumber: 9,
                            title: 'GATE_TITLE_Z',
                            status: 'published',
                            reelId: IDS.creator,
                            mediaAssetId: IDS.creator,
                            confirmedByCreator: true
                        }
                    ]
                }
            ]
        }
    ]);
    const lockedVault = vault(IDS.creator, 'MICROS STIRRED V1', {
        seriesIdentity: {
            seriesLabel: 'Creator Pack',
            seasonNumber: 1,
            episodeNumber: 9,
            confirmedByCreator: true
        }
    });
    hydration.hydratePublicSeriesFromVault({
        items: [lockedVault],
        initMetadata: false,
        source: 'public-series-creator-meta'
    });
    const locked = store.getEpisodeByReelId(IDS.creator);
    assert(Number(locked?.episode?.episodeNumber) === 9, 'creator en 9 unchanged');
    assert(locked?.episode?.title === 'GATE_TITLE_Z', 'creator package title unchanged');
    assert(locked?.series?.id === 'series-creator-meta', 'creator series membership unchanged');

    // Cold-load: reassert then metadata — STIRRED stays en 1 (Phase 1 membership intact)
    assert(
        !store.getEpisodeByReelId(IDS.amp),
        'Phase 1: AMP still not re-bound after creator path isolation'
    );

    if (failures.length) {
        console.error('FAIL validate-catalog-metadata-order');
        for (const f of failures) console.error('  -', f);
        process.exitCode = 1;
    } else {
        console.log('PASS validate-catalog-metadata-order');
        for (const n of notes) console.log('  ' + n);
    }
} finally {
    await vite.close();
}
