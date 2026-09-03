#!/usr/bin/env node
/**
 * Pass 5 — Creator catalog authority acceptance proof.
 *
 * Checklist (guardrail):
 *   rename → Vault → Feature → API → hydrate → viewer
 *   duplicate → remains distinct
 *   wrong bind → creator corrects it
 *   publish → survives reload
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { get } from 'svelte/store';

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
globalThis.CustomEvent = class CustomEvent {
    /** @param {string} type @param {{ detail?: unknown }} [init] */
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
    }
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    location: { hostname: '127.0.0.1', href: 'http://127.0.0.1:5173/' },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};
bag.set('reelforge_admin_session_token', 'validate-creator-catalog-authority-pass5');

/** @param {unknown} body @param {number} status */
function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

const R5 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05';
const R6 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06';
const R7 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb007';
const WRONG_REEL = 'cccccccc-cccc-4ccc-8ccc-cccccccccc99';
const STIRRED_SERIES = 'series-stirred';
const STILL = `/thumbs/${R5}.jpg`;

const vite = await createServer({
    root,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom'
});

/** @type {import('../src/lib/series/seriesStore.js')} */
let store;
/** @type {import('../src/lib/series/authoredCatalogMaterialization.js')} */
let materialization;

try {
    store = await vite.ssrLoadModule('/src/lib/series/seriesStore.js');
    materialization = await vite.ssrLoadModule('/src/lib/series/authoredCatalogMaterialization.js');
    const poster = await vite.ssrLoadModule('/src/lib/studio/episodePosterAssignment.js');
    const browse = await vite.ssrLoadModule('/src/lib/series/viewerSeriesBrowseCatalog.js');
    const projection = await vite.ssrLoadModule('/src/lib/series/viewerProductionProjection.js');
    const idConf = await vite.ssrLoadModule('/src/lib/series/vaultIdentityConfirmation.js');
    const enrichMod = await vite.ssrLoadModule('/src/lib/series/vaultEpisodeEnrichment.js');
    const adminSession = await vite.ssrLoadModule('/src/lib/adminSession.js');

    adminSession.setAdminSessionToken('validate-creator-catalog-authority-pass5');
    assert(adminSession.getAdminToken() !== null, 'admin session token available for API writes');

    /** @type {import('../src/lib/series/seriesTypes.js').Series[]} */
    let apiCatalog = [];
    /** @type {Map<string, Record<string, unknown>>} */
    const apiEpisodes = new Map();

    function refreshApiCatalogFromStore() {
        apiCatalog = structuredClone(get(store.seriesCatalog));
        apiEpisodes.clear();
        for (const series of apiCatalog) {
            for (const season of series.seasons || []) {
                for (const ep of season.episodes || []) {
                    apiEpisodes.set(ep.episodeId, { ...ep });
                }
            }
        }
    }

    function syncEpisodeIntoCatalog(ep) {
        const episodeId = String(ep.episodeId || '');
        if (!episodeId) return;
        apiEpisodes.set(episodeId, { ...ep, episodeId });
        refreshApiCatalogFromStore();
        const stored = apiEpisodes.get(episodeId) || ep;
        apiCatalog = apiCatalog.map((series) => ({
            ...series,
            seasons: (series.seasons || []).map((season) => ({
                ...season,
                episodes: (season.episodes || []).map((row) =>
                    row.episodeId === episodeId ? { ...row, ...stored, episodeId } : row
                )
            }))
        }));
    }

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(String(options.body)) : null;

        if (href.includes('/api/series/status')) {
            return jsonResponse({ enabled: true, count: apiCatalog.length });
        }
        if (method === 'GET' && href.includes('/api/series') && !href.includes('/api/series/')) {
            return jsonResponse(apiCatalog);
        }
        if (method === 'POST' && href.endsWith('/api/series')) {
            refreshApiCatalogFromStore();
            return jsonResponse(body, 201);
        }
        if (method === 'PUT' && href.includes('/api/series/')) {
            refreshApiCatalogFromStore();
            return jsonResponse({ ok: true });
        }
        if (method === 'PUT' && href.includes('/api/episodes/')) {
            const episodeId = decodeURIComponent(href.split('/api/episodes/')[1]?.split('?')[0] || '');
            if (!apiEpisodes.has(episodeId)) {
                return jsonResponse({ error: 'Episode not found' }, 404);
            }
            syncEpisodeIntoCatalog({ ...apiEpisodes.get(episodeId), ...body, episodeId });
            return jsonResponse(apiEpisodes.get(episodeId));
        }
        if (method === 'POST' && href.endsWith('/api/episodes')) {
            syncEpisodeIntoCatalog({ ...body, episodeId: String(body?.episodeId || '') });
            return jsonResponse(body, 201);
        }
        return nativeFetch ? nativeFetch(url, options) : jsonResponse({}, 404);
    };

    /** @type {import('../src/lib/series/seriesTypes.js').Series} */
    const stirredShell = { id: STIRRED_SERIES, title: 'STIRRED', seasons: [] };

    /** @param {Record<string, unknown>} base @param {{ episodeNumber?: number; title?: string; description?: string }} [overrides] */
    function buildConfirmedVault(base, overrides = {}) {
        let asset = idConf.applyCreatorVaultIdentityConfirmation(base, {
            seriesLabel: 'STIRRED',
            seasonNumber: 1,
            episodeNumber: overrides.episodeNumber ?? 5
        });
        asset = enrichMod.applyCreatorVaultEpisodeEnrichment(asset, {
            title: overrides.title ?? 'The Beginning',
            description: overrides.description ?? 'Creator-authored description',
            artworkUrl: String(base.thumbnailUrl || STILL)
        });
        return asset;
    }

    console.log('\n[A] rename → Vault → Feature → API → hydrate → viewer');
    bag.set('reelforge_admin_session_token', 'validate-creator-catalog-authority-pass5');
    store.resetSeriesCatalogEmpty?.();
    apiCatalog = [];
    apiEpisodes.clear();

    /** @type {Record<string, unknown>} */
    let vaultAsset = buildConfirmedVault({
        id: R5,
        name: '07 AMP JAM V1',
        fileName: '07_AMP_JAM_V1.mp4',
        type: 'video/mp4',
        url: `https://cdn.example/videos/${R5}.mp4`,
        thumbnailUrl: STILL,
        status: 'ready'
    });
    vaultAsset = enrichMod.applyCreatorVaultEpisodeEnrichment(vaultAsset, {
        title: 'The Stirring',
        description: 'Renamed by creator',
        artworkUrl: STILL
    });

    const epRenamed = materialization.buildAuthoredEpisodeId(stirredShell, 1, 5, 'The Stirring');
    assert(
        materialization.resolveCreatorConfirmedVaultIdentity(vaultAsset).creatorCatalogMetadata?.title ===
            'The Stirring',
        'vault rename visible in identity resolver'
    );

    const featured = await poster.featureEpisodeOnOriginalProductions(R5, vaultAsset);
    assert(featured.ok === true, 'Feature succeeds after vault rename');
    assert(featured.seriesId === STIRRED_SERIES, `featured series is ${STIRRED_SERIES}`);
    assert(featured.published === true, 'feature reports published after API write');
    assert(store.getEpisodeById(epRenamed)?.episode?.title === 'The Stirring', 'store carries renamed title after feature');
    assert(store.getEpisodeById(epRenamed)?.episode?.status === 'published', 'store published after feature (API-first)');

    store.resetSeriesCatalogEmpty?.();
    const hydrated = await store.hydrateCreatorAuthoredCatalogFromApi();
    assert(hydrated.ok === true, 'hydrateCreatorAuthoredCatalogFromApi succeeds');
    const afterHydrate = store.getEpisodeById(epRenamed);
    assert(afterHydrate?.episode?.title === 'The Stirring', 'hydrated catalog keeps renamed title');
    assert(afterHydrate?.episode?.status === 'published', 'hydrated catalog keeps published status');
    assert(String(afterHydrate?.episode?.reelId || '') === R5, 'hydrated catalog keeps reel binding');

    const liveCatalog = get(store.seriesCatalog);
    const browseCatalog = browse.buildViewerSeriesBrowseCatalog(liveCatalog, {
        readyVaultAssets: [vaultAsset]
    });
    assert(
        browseCatalog.sections.original.some((row) => row.seriesId === STIRRED_SERIES),
        'viewer browse Original Productions includes STIRRED after hydrate'
    );
    const viewerSeries = liveCatalog.find((s) => s.id === STIRRED_SERIES);
    const viewerProj = projection.buildViewerProductionProjection(viewerSeries, {
        readyVaultAssets: [vaultAsset]
    });
    assert(viewerProj?.seriesId === STIRRED_SERIES, 'viewer projection built for STIRRED');
    assert((viewerProj?.playableCount ?? 0) >= 1, 'viewer projection includes published playable episode');

    console.log('\n[B] duplicate → remains distinct');
    store.resetSeriesCatalogEmpty?.();
    apiCatalog = [];
    apiEpisodes.clear();

    const vaultE5 = buildConfirmedVault({
        id: R5,
        name: 'MICROS STIRRED V1',
        fileName: 'MICROS_STIRRED_V1.mp4',
        type: 'video/mp4',
        url: `https://cdn.example/videos/${R5}.mp4`,
        thumbnailUrl: STILL,
        status: 'ready'
    });
    const vaultE6 = buildConfirmedVault(
        {
            id: R6,
            name: 'MICROS STIRRED V2',
            fileName: 'MICROS_STIRRED_V2.mp4',
            type: 'video/mp4',
            url: `https://cdn.example/videos/${R6}.mp4`,
            thumbnailUrl: `/thumbs/${R6}.jpg`,
            status: 'ready'
        },
        { episodeNumber: 6, title: 'The Next Stir' }
    );
    const vaultSimilarFilename = buildConfirmedVault(
        {
            id: R7,
            name: '07 AMP JAM V1',
            fileName: '07_AMP_JAM_V1.mp4',
            type: 'video/mp4',
            url: `https://cdn.example/videos/${R7}.mp4`,
            thumbnailUrl: `/thumbs/${R7}.jpg`,
            status: 'ready'
        },
        { episodeNumber: 7, title: 'Similar Filename Upload' }
    );

    const matE5 = materialization.materializeCreatorAuthoredCatalogProduction(vaultE5);
    const matE6 = materialization.materializeCreatorAuthoredCatalogProduction(vaultE6);
    const matSimilar = materialization.materializeCreatorAuthoredCatalogProduction(vaultSimilarFilename);
    assert(matE5.ok === true && matE6.ok === true && matSimilar.ok === true, 'all uploads materialize');

    const ep5Id = materialization.buildAuthoredEpisodeId(stirredShell, 1, 5, 'The Beginning');
    const ep6Id = materialization.buildAuthoredEpisodeId(stirredShell, 1, 6, 'The Next Stir');
    const ep7Id = materialization.buildAuthoredEpisodeId(stirredShell, 1, 7, 'Similar Filename Upload');

    assert(matE5.ctx?.episode?.episodeId === ep5Id, 'E5 deterministic episode id');
    assert(matE6.ctx?.episode?.episodeId === ep6Id, 'E6 distinct episode id');
    assert(matE5.ctx?.episode?.episodeId !== matE6.ctx?.episode?.episodeId, 'duplicate title ≠ same episode');
    assert(String(matE5.ctx?.episode?.reelId) === R5, 'E5 bound to R5');
    assert(String(matE6.ctx?.episode?.reelId) === R6, 'E6 bound to R6');
    assert(String(matSimilar.ctx?.episode?.reelId) === R7, 'similar filename upload keeps independent identity');
    assert(
        store.getSeriesById(STIRRED_SERIES)?.seasons?.[0]?.episodes?.length === 3,
        'three distinct episode rows — no title/filename merge'
    );
    assert(matSimilar.ctx?.episode?.episodeId === ep7Id, 'similar filename maps to its own episode shell');

    console.log('\n[C] wrong bind → creator corrects it');
    store.resetSeriesCatalogEmpty?.();
    apiCatalog = [];
    apiEpisodes.clear();

    store.seriesCatalog.set([
        {
            id: STIRRED_SERIES,
            title: 'STIRRED',
            tags: ['vault-inferred'],
            seasons: [
                {
                    seasonId: 'season-stirred-1',
                    seasonNumber: 1,
                    title: 'Season 1',
                    episodes: [
                        {
                            episodeId: ep5Id,
                            episodeNumber: 5,
                            title: 'Wrong Bind Row',
                            status: 'ready',
                            reelId: WRONG_REEL,
                            tags: ['vault-inferred']
                        }
                    ]
                }
            ]
        }
    ]);
    refreshApiCatalogFromStore();

    const corrected = await store.persistCreatorAuthoredCatalogProduction(vaultE5);
    assert(corrected.ok === true, 'creator persist corrects wrong bind');
    assert(String(corrected.reelId) === R5, 'persist returns canonical reelId');
    const fixed = store.getEpisodeById(ep5Id);
    assert(String(fixed?.episode?.reelId) === R5, 'catalog episode rebound to creator mediaAssetId');
    assert(fixed?.episode?.title === 'The Beginning', 'creator vault title replaces stale row title');
    assert(
        !store
            .getSeriesById(STIRRED_SERIES)
            ?.seasons?.[0]?.episodes?.some((ep) => String(ep.reelId) === WRONG_REEL),
        'wrong reel no longer bound anywhere in series'
    );
    assert(apiEpisodes.get(ep5Id)?.reelId === R5, 'API row updated with corrected reelId');

    console.log('\n[D] publish → survives reload');
    store.resetSeriesCatalogEmpty?.();
    apiCatalog = [];
    apiEpisodes.clear();

    const publishVault = buildConfirmedVault({
        id: R5,
        name: 'MICROS STIRRED V1',
        fileName: 'MICROS_STIRRED_V1.mp4',
        type: 'video/mp4',
        url: `https://cdn.example/videos/${R5}.mp4`,
        thumbnailUrl: STILL,
        status: 'ready'
    });
    const publishResult = await poster.featureEpisodeOnOriginalProductions(R5, publishVault);
    assert(publishResult.ok === true && publishResult.published === true, 'feature publishes to API first');
    refreshApiCatalogFromStore();

    store.resetSeriesCatalogEmpty?.();
    const reload = await store.hydrateCreatorAuthoredCatalogFromApi();
    assert(reload.ok === true, 'reload hydrate succeeds');
    const reloaded = store.getEpisodeById(ep5Id);
    assert(reloaded?.episode?.status === 'published', 'published status survives reload');
    assert(String(reloaded?.episode?.reelId) === R5, 'reel binding survives reload');

    globalThis.fetch = nativeFetch;

    if (failures.length) {
        console.error('\nFAIL validate-creator-catalog-authority-pass5');
        for (const f of failures) console.error('  -', f);
        process.exitCode = 1;
    } else {
        console.log('\nPASS validate-creator-catalog-authority-pass5');
    }
} finally {
    await vite.close();
}
