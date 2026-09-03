#!/usr/bin/env node
/**
 * Phase 1 — catalog membership / binding authority correction.
 *
 * Proves:
 *   1) STIRRED vs 07 AMP JAM split out of series-stirred-gate
 *   2) Motherland vs CLUB POOM POOM vs condo split out of series-journey-gate-v2
 *   3) Already-bound conflicting reel re-homes when not creator-confirmed (high NLP)
 *   4) Creator-confirmed binding stays despite NLP title disagreement
 *   5) Pure-vault Vic G NLP related members still group
 *   6) Weak NLP (Motherland alone) does not invent a synthetic series
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
    location: { hostname: '127.0.0.1', href: 'http://127.0.0.1:5173/' },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

const REEL = {
    stirred: '615e0eae-47b4-468a-b6dd-a6846b464846',
    amp: '201ec6ee-6822-4bda-9295-080beb6f4e35',
    motherland: '9a1251a2-d6a6-42e5-9fcd-4eca17dcd6ef',
    club: 'd2aafde7-d7ba-492c-a860-20b51f7f4033',
    // Synthetic test UUID — must not collide with Vic G E03 (3894107e-…).
    condo: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
    creatorLocked: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    vic1: '11111111-1111-4111-8111-111111111111',
    vic2: '22222222-2222-4222-8222-222222222222'
};

const GATE_CATALOG = [
    {
        id: 'series-stirred-gate',
        title: 'STIRRED',
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
                        status: 'draft',
                        reelId: REEL.stirred,
                        mediaAssetId: REEL.stirred
                    },
                    {
                        episodeId: 'ep-series-stirred-gate-s1e5',
                        episodeNumber: 5,
                        title: 'GATE_TITLE_B',
                        status: 'published',
                        reelId: REEL.amp,
                        mediaAssetId: REEL.amp
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
                seasonId: 'season-journey-gate-v2-1',
                seasonNumber: 1,
                title: 'Season 1',
                episodes: [
                    {
                        episodeId: 'series-journey-gate-v2-s1e11',
                        episodeNumber: 11,
                        title: 'JV2_TITLE_A',
                        status: 'draft',
                        reelId: REEL.motherland,
                        mediaAssetId: REEL.motherland
                    },
                    {
                        episodeId: 'series-journey-gate-v2-s1e12',
                        episodeNumber: 12,
                        title: 'JV2_TITLE_B',
                        status: 'published',
                        reelId: REEL.club,
                        mediaAssetId: REEL.club
                    },
                    {
                        episodeId: 'series-journey-gate-v2-s1e13',
                        episodeNumber: 13,
                        title: 'JV2_TITLE_C',
                        status: 'draft',
                        reelId: REEL.condo,
                        mediaAssetId: REEL.condo
                    }
                ]
            }
        ]
    }
];

function vaultRow(id, name, extras = {}) {
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
    const relatedMod = await vite.ssrLoadModule('/src/lib/series/resolveRelatedEpisodes.js');
    const hydration = await vite.ssrLoadModule('/src/lib/series/publicSeriesHydration.js');

    // --- helpers ---
    function mediaSiblings(seriesId) {
        const s = store.getSeriesById(seriesId);
        if (!s) return [];
        return (s.seasons || [])
            .flatMap((se) => se.episodes || [])
            .map((e) => String(e.reelId || e.mediaAssetId || '').trim())
            .filter(Boolean);
    }

    function resetCatalog(cat) {
        bag.clear();
        store.resetSeriesCatalogEmpty();
        store.applyAuthoritativeApiCatalog(cat);
    }

    // ========== 1–2 + 6: production-shaped gate split + weak NLP no invent ==========
    console.log('\n[1–2] Production gate membership split');
    resetCatalog(GATE_CATALOG);

    const ready = [
        vaultRow(REEL.stirred, 'MICROS STIRRED V1'),
        vaultRow(REEL.amp, '07 AMP JAM V1'),
        vaultRow(REEL.motherland, 'MICROS Motherland V1(1)'),
        vaultRow(REEL.club, '03 CLUB POOM POOM V1'),
        vaultRow(REEL.condo, 'condo v1 2')
    ];

    const rec = infer.reconcileCatalogMembershipFromVault(ready, {
        source: 'validate-membership-split'
    });

    const stirredSiblings = mediaSiblings('series-stirred-gate');
    assert(
        stirredSiblings.includes(REEL.stirred),
        `STIRRED stays on stirred-gate (got ${stirredSiblings.join(',')})`
    );
    assert(
        !stirredSiblings.includes(REEL.amp),
        'AMP JAM is no longer a stirred-gate media sibling'
    );
    assert(
        !store.getEpisodeByReelId(REEL.amp),
        'AMP JAM unbound from catalog package (medium NLP, no create)'
    );

    const journeySiblings = mediaSiblings('series-journey-gate-v2');
    assert(
        !journeySiblings.includes(REEL.motherland),
        'Motherland not journey-gate sibling'
    );
    assert(!journeySiblings.includes(REEL.club), 'CLUB POOM not journey-gate sibling');
    assert(!journeySiblings.includes(REEL.condo), 'condo not journey-gate sibling');

    const condoCtx = store.getEpisodeByReelId(REEL.condo);
    assert(Boolean(condoCtx), 'condo re-homed (high NLP)');
    assert(
        /condo/i.test(String(condoCtx?.series?.title || condoCtx?.series?.id || '')),
        `condo series NLP franchise (got ${condoCtx?.series?.id} / ${condoCtx?.series?.title})`
    );
    assert(
        Number(condoCtx?.episode?.episodeNumber) === 2,
        `condo keeps NLP episode number 2 (got ${condoCtx?.episode?.episodeNumber})`
    );

    assert(!store.getEpisodeByReelId(REEL.motherland), 'Motherland unbound (weak NLP)');
    assert(!store.getEpisodeByReelId(REEL.club), 'Club unbound (medium; no create)');

    const motherlandSeries = store.getSeriesById('series-motherland');
    assert(
        !motherlandSeries ||
            !(motherlandSeries.seasons || []).some((s) =>
                (s.episodes || []).some((e) => e.reelId === REEL.motherland)
            ),
        'weak Motherland does not invent synthetic motherland membership'
    );

    // Theater spine: AMP seed must not list STIRRED as related member via catalog package
    const ampRelated = relatedMod.resolveRelatedEpisodes(
        ready.find((r) => r.id === REEL.amp),
        { readyAssets: ready }
    );
    const ampMemberIds = (ampRelated.members || [])
        .map((m) => String(m.reelId || m.assetId || ''))
        .filter(Boolean);
    assert(
        !ampMemberIds.includes(REEL.stirred),
        `AMP related members must not include STIRRED reel (${ampMemberIds.join(',')})`
    );

    const stirredRelated = relatedMod.resolveRelatedEpisodes(
        ready.find((r) => r.id === REEL.stirred),
        { readyAssets: ready }
    );
    const stirredMemberIds = (stirredRelated.members || [])
        .map((m) => String(m.reelId || m.assetId || ''))
        .filter(Boolean);
    assert(
        !stirredMemberIds.includes(REEL.amp),
        `STIRRED related members must not include AMP reel (${stirredMemberIds.join(',')})`
    );

    assert(rec.rehomed >= 1, `rehomed ≥ 1 (condo) got ${rec.rehomed}`);
    assert(rec.detached >= 2, `detached ≥ 2 (AMP/Club/Motherland) got ${rec.detached}`);

    // ========== 3: already-bound conflicting high NLP re-homes ==========
    console.log('\n[3] High-confidence re-home from wrong package');
    resetCatalog([
        {
            id: 'series-wrong-package',
            title: 'Wrong Package',
            seasons: [
                {
                    seasonId: 'season-wrong-1',
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-wrong-s01e01',
                            episodeNumber: 1,
                            title: 'Wrong Slot',
                            status: 'ready',
                            reelId: REEL.stirred,
                            mediaAssetId: REEL.stirred
                        }
                    ]
                }
            ]
        }
    ]);
    const rehomeReady = [vaultRow(REEL.stirred, 'MICROS STIRRED V1')];
    const rehome = infer.reconcileCatalogMembershipFromVault(rehomeReady, {
        source: 'validate-rehome'
    });
    assert(rehome.rehomed === 1, `rehomed exactly 1 (got ${rehome.rehomed})`);
    assert(
        !store.getEpisodeByReelId(REEL.stirred) ||
            !/wrong-package/i.test(String(store.getEpisodeByReelId(REEL.stirred)?.series?.id)),
        'no longer bound to wrong-package'
    );
    const afterWrong = store.getEpisodeByReelId(REEL.stirred);
    assert(Boolean(afterWrong), 'STIRRED bound after re-home');
    assert(
        /stirred/i.test(String(afterWrong?.series?.title || '')),
        `re-homed under STIRRED (got ${afterWrong?.series?.title})`
    );

    // ========== 4: creator-confirmed stays ==========
    console.log('\n[4] Creator-confirmed binding preserved');
    resetCatalog([
        {
            id: 'series-creator-pack',
            title: 'Creator Pack',
            seasons: [
                {
                    seasonId: 'season-creator-1',
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'ep-creator-s01e09',
                            episodeNumber: 9,
                            title: 'Creator Episode',
                            status: 'published',
                            reelId: REEL.creatorLocked,
                            mediaAssetId: REEL.creatorLocked,
                            confirmedByCreator: true
                        }
                    ]
                }
            ]
        }
    ]);
    const locked = vaultRow(REEL.creatorLocked, 'MICROS STIRRED V1', {
        seriesIdentity: {
            seriesLabel: 'Creator Pack',
            seasonNumber: 1,
            episodeNumber: 9,
            confirmedByCreator: true
        }
    });
    const lockRec = infer.reconcileCatalogMembershipFromVault([locked], {
        source: 'validate-creator-lock'
    });
    assert(lockRec.preserved >= 1, 'creator binding counted preserved');
    assert(
        store.getEpisodeByReelId(REEL.creatorLocked)?.series?.id === 'series-creator-pack',
        'creator-confirmed remains on Creator Pack despite STIRRED filename NLP'
    );
    assert(
        Number(store.getEpisodeByReelId(REEL.creatorLocked)?.episode?.episodeNumber) === 9,
        'creator episode number 9 preserved'
    );

    // ========== 5: Vic G pure vault ==========
    console.log('\n[5] Vic G pure-vault NLP');
    bag.clear();
    store.resetSeriesCatalogEmpty();
    const vicVault = [
        vaultRow(REEL.vic1, 'Vic G LA Story'),
        vaultRow(REEL.vic2, 'Vic G EPISODE 2 - POOM POOM TUESDAY')
    ];
    const fromPilot = relatedMod.resolveRelatedEpisodes(vicVault[0], { readyAssets: vicVault });
    const fromEp2 = relatedMod.resolveRelatedEpisodes(vicVault[1], { readyAssets: vicVault });
    assert(fromPilot.members.length >= 2, 'Vic G pilot family ≥ 2');
    assert(fromEp2.members.length >= 2, 'Vic G EP2 family ≥ 2');
    assert(
        fromPilot.members.some((m) => /la story/i.test(m.title)) &&
            fromPilot.members.some((m) => /episode 2|poom/i.test(m.title)),
        'Vic G both titles present'
    );

    // ========== public hydrate path still membership-reconciles ==========
    console.log('\n[hydrate] public path runs membership reconcile');
    resetCatalog(GATE_CATALOG);
    hydration.hydratePublicSeriesFromVault({
        items: ready,
        initMetadata: false,
        source: 'public-series-validate-membership'
    });
    assert(
        !mediaSiblings('series-stirred-gate').includes(REEL.amp),
        'public hydrate: AMP not stirred sibling'
    );
    assert(
        mediaSiblings('series-stirred-gate').includes(REEL.stirred),
        'public hydrate: STIRRED remains'
    );
    assert(
        mediaSiblings('series-journey-gate-v2').length === 0,
        'public hydrate: journey gate has no remaining wrong media siblings'
    );

    if (failures.length) {
        console.error('FAIL validate-catalog-membership-reconcile');
        for (const f of failures) console.error('  -', f);
        process.exitCode = 1;
    } else {
        console.log('PASS validate-catalog-membership-reconcile');
        for (const n of notes) console.log(' ', n);
        console.log('\nReconcile summary (split pass):', {
            rehomed: rec.rehomed,
            detached: rec.detached,
            preserved: rec.preserved
        });
    }
} finally {
    await vite.close();
}
