#!/usr/bin/env node
/**
 * API-hydrated catalog membership survives post-API Vault reconciliation.
 *
 * Proves:
 *   A) Published API episode + reelId binding survives after-api-catalog reconcile
 *   B) Low-confidence Vault inference does not detach established catalog bindings
 *   C) Synthetic / wrong-package vault memberships still reconcile (stale path)
 *   D) Poster thumbnailUrl edit survives reconcile + reapply
 *   E) Episode remains viewer-discoverable after full applyApiCatalogState path
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

const API_REEL = '8464625b-a76a-4a08-b111-5382e967e4f0';
const POSTER_URL = '/thumbs/8984efe4-15ff-445b-b3a2-136dd216b0a0.png';
const SERIES_ID = 'series-api-membership-survival';
const EPISODE_ID = 'ep-api-membership-survival-s01e01';

const GATE_REEL = '9a1251a2-d6a6-42e5-9fcd-4eca17dcd6ef';

function vaultRow(id, name) {
    return {
        id,
        mediaAssetId: id,
        name,
        title: name,
        url: `https://cdn.example/${id}.mp4`,
        type: 'video/mp4',
        status: 'ready'
    };
}

/** @returns {import('../src/lib/series/seriesTypes.js').Series[]} */
function apiCatalogFixture() {
    return [
        {
            id: SERIES_ID,
            title: 'API Membership Survival',
            description: 'Canonical API fixture',
            tags: ['validation'],
            seasons: [
                {
                    seasonId: `${SERIES_ID}-s1`,
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [
                        {
                            episodeId: EPISODE_ID,
                            episodeNumber: 1,
                            title: 'Validation Episode 1',
                            status: 'published',
                            reelId: API_REEL,
                            runtimeSeconds: 120
                        }
                    ]
                }
            ]
        }
    ];
}

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
    const life = await vite.ssrLoadModule('/src/lib/series/publishingLifecycle.js');
    const poster = await vite.ssrLoadModule('/src/lib/series/viewerEpisodePoster.js');

    bag.clear();
    store.resetSeriesCatalogEmpty?.();

    console.log('\n[A–B] API published binding survives after-api-catalog reconcile');
    store.applyAuthoritativeApiCatalog(apiCatalogFixture());

    const ready = [vaultRow(API_REEL, 'moving')];
    const membership = vaultInf.reconcileCatalogMembershipFromVault(ready, {
        source: 'after-api-catalog:membership'
    });

    const ctx = store.getEpisodeById(EPISODE_ID);
    assert(Boolean(ctx?.episode), 'fixture episode present in catalog');
    assert(ctx?.episode?.status === 'published', `status stays published (got ${ctx?.episode?.status})`);
    assert(
        ctx?.episode?.reelId === API_REEL,
        `reelId preserved (got ${ctx?.episode?.reelId})`
    );
    assert(
        membership.actions.some((a) => a.phase === 'preserved-established-catalog-membership'),
        'membership reconcile recorded established-catalog preservation'
    );
    assert(membership.detached === 0, `no detach for established API binding (detached=${membership.detached})`);

    console.log('\n[C] Synthetic wrong-package membership still detaches on weak NLP');
    bag.clear();
    store.resetSeriesCatalogEmpty?.();
    store.applyAuthoritativeApiCatalog([
        {
            id: 'series-journey-gate-v2',
            title: 'JOURNEY GATE V2',
            seasons: [
                {
                    seasonId: 'season-journey-gate-v2-1',
                    seasonNumber: 1,
                    episodes: [
                        {
                            episodeId: 'series-journey-gate-v2-s1e11',
                            episodeNumber: 11,
                            title: 'JV2_TITLE_A',
                            status: 'draft',
                            reelId: GATE_REEL,
                            mediaAssetId: GATE_REEL
                        }
                    ]
                }
            ]
        }
    ]);
    const stale = vaultInf.reconcileCatalogMembershipFromVault(
        [vaultRow(GATE_REEL, 'MICROS Motherland V1(1)')],
        { source: 'validate-stale-membership' }
    );
    assert(!store.getEpisodeByReelId(GATE_REEL), 'synthetic gate membership still unbound on weak NLP');
    assert(stale.detached >= 1, 'stale membership detach still occurs');

    console.log('\n[D–E] Poster edit + full after-api-catalog path + discoverability');
    bag.clear();
    store.resetSeriesCatalogEmpty?.();
    store.applyAuthoritativeApiCatalog(apiCatalogFixture());
    edits.upsertEpisodeCatalogEdit(SERIES_ID, EPISODE_ID, { thumbnailUrl: POSTER_URL });

    vaultInf.inferAndBindVaultSeries(ready, { source: 'after-api-catalog' });
    store.reapplyCreatorCatalogAuthorityToStore?.();

    const finalCtx = store.getEpisodeById(EPISODE_ID);
    assert(finalCtx?.episode?.thumbnailUrl === POSTER_URL, 'thumbnailUrl edit survives reconcile');
    assert(finalCtx?.episode?.status === 'published', 'published survives full path');
    assert(finalCtx?.episode?.reelId === API_REEL, 'reelId survives full path');

    assert(
        life.episodeIsViewerDiscoverable(finalCtx.episode),
        'episode remains viewer-discoverable after reconcile'
    );

    const resolved = poster.resolveViewerEpisodePosterUrl({
        episode: finalCtx.episode,
        readyVaultAssets: ready
    });
    assert(
        String(resolved || '').includes('8984efe4-15ff-445b-b3a2-136dd216b0a0'),
        'resolveViewerEpisodePosterUrl returns assigned poster'
    );

    if (failures.length) {
        console.error('\nFAIL validate-api-catalog-membership-survival');
        for (const f of failures) console.error('  -', f);
        process.exitCode = 1;
    } else {
        console.log('\nPASS validate-api-catalog-membership-survival');
    }
} finally {
    await vite.close();
}
