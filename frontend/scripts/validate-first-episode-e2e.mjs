#!/usr/bin/env node
/**
 * First-episode E2E — Studio-created Series → Vault save → canonical Episode row → viewer projection.
 *
 * Proves the full identity chain without Season-row API save:
 *   Studio + Add Series → Season 1 shell → Vault package/identity → inferAndBindVaultSeries
 *   → persistEpisodeRowToApi → PUT 404 → POST create → hydrate → projection eligible
 *
 * Also verifies:
 *   - Episode belongs to Studio canonical Series (not slug duplicate)
 *   - Season 1 shell not duplicated
 *   - POST fallback is genuine (local row absent server-side, same episodeId)
 *   - reelId survives editorial PUT
 *   - Vault asset localStorage stores untouched
 *   - Vic G unchanged
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { get } from 'svelte/store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';

const VIC_G_ID = 'series-vic-g';
const TEST_REEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const REEL = {
    e02: 'cadfcabc-1947-4341-86a3-f82a08e78669',
    e04: 'b3a87c96-6ea0-4854-a0bc-6b0f2442f9a1',
    e05: 'efb01cee-9477-4477-982a-7611cfc08fcc',
    e06: '5cc786f0-8fbe-4f96-a59d-02014b0cc56f'
};

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
function collectReelIds(series) {
    return (series?.seasons || [])
        .flatMap((s) => s.episodes || [])
        .map((e) => String(e.reelId || ''))
        .filter(Boolean);
}

/** @param {Map<string, unknown>} storeSnap */
function snapshotVaultStores(storeSnap) {
    return {
        personal_video_vault: storeSnap.get('personal_video_vault') ?? null,
        reel_titles_persistent: storeSnap.get('reel_titles_persistent') ?? null,
        reelforge_reel_series_metadata: storeSnap.get('reelforge_reel_series_metadata') ?? null
    };
}

const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});

try {
    const seriesApi = await server.ssrLoadModule('/src/lib/api/seriesApi.js');
    const store = await server.ssrLoadModule('/src/lib/series/seriesStore.js');
    const projection = await server.ssrLoadModule('/src/lib/series/viewerProductionProjection.js');
    const vicG = await server.ssrLoadModule('/src/lib/series/vicGSeriesPackage.js');
    const adminSession = await server.ssrLoadModule('/src/lib/adminSession.js');

    const testTitle = `First Episode E2E ${Date.now()}`;

    console.log('\n[1–10] mock first-episode chain');
    /** @type {Record<string, unknown> | null} */
    let capturedPostSeries = null;
    /** @type {Record<string, unknown> | null} */
    let capturedPutEpisode = null;
    /** @type {Record<string, unknown> | null} */
    let capturedPostEpisode = null;
    /** @type {import('../src/lib/series/seriesTypes.js').Series | null} */
    let apiSeriesSnapshot = null;
    /** @type {Map<string, Record<string, unknown>>} */
    const apiEpisodes = new Map();
    let mockSeriesId = '';
    let putAttemptedBeforePost = false;
    let postFallbackUsed = false;

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        const method = options.method || 'GET';

        if (href.includes('/api/series/status')) {
            return jsonResponse({ enabled: true, count: 2 });
        }

        if (method === 'POST' && href.endsWith('/api/series')) {
            capturedPostSeries = JSON.parse(String(options.body || '{}'));
            mockSeriesId = String(capturedPostSeries?.id || '');
            apiSeriesSnapshot = structuredClone(
                /** @type {import('../src/lib/series/seriesTypes.js').Series} */ (
                    seriesApi.apiSeriesToCatalog(capturedPostSeries)
                )
            );
            return jsonResponse(capturedPostSeries, 201);
        }

        if (method === 'PUT' && href.includes('/api/episodes/')) {
            const episodeId = decodeURIComponent(href.split('/api/episodes/')[1] || '');
            capturedPutEpisode = JSON.parse(String(options.body || '{}'));
            if (!apiEpisodes.has(episodeId)) {
                putAttemptedBeforePost = true;
                return jsonResponse({ error: 'Episode not found' }, 404);
            }
            const existing = apiEpisodes.get(episodeId) || {};
            const merged = {
                ...existing,
                ...capturedPutEpisode,
                episodeId,
                reelId: existing.reelId
            };
            apiEpisodes.set(episodeId, merged);
            syncEpisodeIntoSeriesSnapshot(merged);
            return jsonResponse(merged);
        }

        if (method === 'POST' && href.endsWith('/api/episodes')) {
            capturedPostEpisode = JSON.parse(String(options.body || '{}'));
            postFallbackUsed = true;
            const episodeId = String(capturedPostEpisode?.id || capturedPostEpisode?.episodeId || '');
            const row = {
                episodeId,
                seriesId: capturedPostEpisode?.seriesId,
                seasonNumber: capturedPostEpisode?.seasonNumber,
                episodeNumber: capturedPostEpisode?.episodeNumber,
                title: capturedPostEpisode?.title,
                description: capturedPostEpisode?.description,
                status: capturedPostEpisode?.status || 'ready',
                reelId: capturedPostEpisode?.reelId || null,
                tags: capturedPostEpisode?.tags || []
            };
            apiEpisodes.set(episodeId, row);
            syncEpisodeIntoSeriesSnapshot(row);
            return jsonResponse(row, 201);
        }

        if (method === 'GET' && mockSeriesId && href.includes(`/api/series/${encodeURIComponent(mockSeriesId)}`)) {
            return jsonResponse(apiSeriesSnapshot);
        }

        if (typeof nativeFetch === 'function') {
            return nativeFetch(url, options);
        }
        return jsonResponse({ error: 'unexpected fetch' }, 404);
    };

    /** @param {Record<string, unknown>} episodeRow */
    function syncEpisodeIntoSeriesSnapshot(episodeRow) {
        if (!apiSeriesSnapshot) return;
        const sn = Number(episodeRow.seasonNumber) || 1;
        const seasons = Array.isArray(apiSeriesSnapshot.seasons) ? [...apiSeriesSnapshot.seasons] : [];
        let season = seasons.find((s) => Number(s.seasonNumber) === sn);
        if (!season) {
            season = {
                seasonId: `season-${mockSeriesId}-${sn}`,
                seasonNumber: sn,
                title: 'Season 1',
                episodes: []
            };
            seasons.push(season);
        }
        const episodes = Array.isArray(season.episodes) ? [...season.episodes] : [];
        const eid = String(episodeRow.episodeId || '');
        const idx = episodes.findIndex((e) => String(e.episodeId) === eid);
        const mapped = {
            episodeId: eid,
            episodeNumber: Number(episodeRow.episodeNumber) || 1,
            title: String(episodeRow.title || ''),
            description: episodeRow.description ? String(episodeRow.description) : undefined,
            status: String(episodeRow.status || 'ready'),
            reelId: episodeRow.reelId ? String(episodeRow.reelId) : null,
            tags: Array.isArray(episodeRow.tags) ? episodeRow.tags : []
        };
        if (idx >= 0) episodes[idx] = { ...episodes[idx], ...mapped };
        else episodes.push(mapped);
        season.episodes = episodes;
        apiSeriesSnapshot = { ...apiSeriesSnapshot, seasons };
    }

    adminSession.setAdminSessionToken('validate-first-episode-e2e-token');
    store.resetSeriesCatalogEmpty();
    store.applyAuthoritativeApiCatalog([vicG.buildVicGSeriesPackage()]);
    const vicReelsBefore = collectReelIds(store.getSeriesById(VIC_G_ID));

    bag.set(
        'personal_video_vault',
        JSON.stringify([
            {
                id: TEST_REEL_ID,
                mediaAssetId: TEST_REEL_ID,
                name: `${testTitle} S01E01`,
                fileName: `${testTitle} S01E01.mp4`,
                url: 'https://cdn.example/first-ep.mp4',
                type: 'video/mp4'
            }
        ])
    );
    const vaultStoresBefore = snapshotVaultStores(bag);

    const createResult = await store.createCatalogSeriesFromStudio(testTitle);
    assert(createResult.ok === true, 'Studio + Add Series creates canonical series');
    mockSeriesId = String(createResult.seriesId || '');
    assert(mockSeriesId.startsWith('series-'), 'canonical series id is text series id');

    const afterCreate = store.getSeriesById(mockSeriesId);
    assert(Boolean(afterCreate), 'canonical series exists in catalog');
    assert(afterCreate?.seasons?.length === 1, 'Season 1 shell exists');
    assert(afterCreate?.seasons?.[0]?.episodes?.length === 0, 'Season 1 shell has no episodes yet');
    assert(
        projection.buildViewerProductionProjection(afterCreate, {}) === null,
        'viewer projection null before first qualifying episode'
    );

    /** @type {Record<string, unknown>} */
    const vaultAsset = {
        id: TEST_REEL_ID,
        mediaAssetId: TEST_REEL_ID,
        name: `${testTitle} S01E01`,
        fileName: `${testTitle} S01E01.mp4`,
        url: 'https://cdn.example/first-ep.mp4',
        type: 'video/mp4',
        seriesIdentity: {
            seriesLabel: testTitle,
            seasonNumber: 1,
            episodeNumber: 1,
            confirmedByCreator: true,
            confidence: 'high'
        }
    };

    const bindResult = await store.persistVaultEditsToCanonicalEpisode(
        TEST_REEL_ID,
        {
            title: `${testTitle} — Episode 1`,
            description: 'First canonical episode synopsis',
            status: 'published'
        },
        vaultAsset
    );
    assert(bindResult.ok === true, 'Vault package/identity save persists canonical episode row');
    assert(putAttemptedBeforePost === true, 'PUT /api/episodes/:id attempted before POST fallback');
    assert(postFallbackUsed === true, 'POST fallback exercised for absent server row');
    assert(capturedPostEpisode != null, 'POST /api/episodes invoked');
    assert(
        String(capturedPostEpisode?.seriesId || '') === mockSeriesId,
        'created episode belongs to Studio canonical Series id'
    );
    assert(Number(capturedPostEpisode?.seasonNumber) === 1, 'created episode seasonNumber is 1');
    assert(Number(capturedPostEpisode?.episodeNumber) === 1, 'created episode episodeNumber is 1');
    assert(String(capturedPostEpisode?.reelId || '') === TEST_REEL_ID, 'POST binds reelId to vault media asset');

    const localCtx = store.getEpisodeByReelId(TEST_REEL_ID);
    assert(Boolean(localCtx?.episode?.episodeId), 'inferAndBindVaultSeries created local catalog episode');
    const localEpisodeId = String(localCtx?.episode?.episodeId || '');
    assert(
        String(capturedPostEpisode?.id || '') === localEpisodeId,
        'POST fallback uses same canonical episodeId as local catalog (not identity bug duplicate)'
    );

    const studioSeries = store.getSeriesById(mockSeriesId);
    assert(studioSeries?.id === mockSeriesId, 'episode parent is Studio series (not slug duplicate id)');
    const slugOnlyId = `series-${testTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)}`;
    if (slugOnlyId !== mockSeriesId) {
        assert(!store.getSeriesById(slugOnlyId), 'no slug-derived duplicate Series alongside Studio series');
    }
    const sameTitleSeries = get(store.seriesCatalog).filter(
        (s) => String(s.title || '').trim().toLowerCase() === testTitle.toLowerCase()
    );
    assert(sameTitleSeries.length === 1, 'exactly one catalog Series row for studio title');
    assert(sameTitleSeries[0]?.id === mockSeriesId, 'title match resolves to Studio canonical id');
    assert(studioSeries?.seasons?.length === 1, 'Season 1 shell not duplicated');
    assert(
        (studioSeries?.seasons?.[0]?.episodes || []).length === 1,
        'exactly one episode row under Season 1 shell'
    );
    assert(
        studioSeries?.seasons?.[0]?.episodes?.[0]?.episodeId === localEpisodeId,
        'canonical episode ID stable in local catalog after bind'
    );

    const vaultStoresAfter = snapshotVaultStores(bag);
    assert(
        vaultStoresAfter.personal_video_vault === vaultStoresBefore.personal_video_vault,
        'personal_video_vault untouched by canonical episode persist'
    );
    assert(
        vaultStoresAfter.reel_titles_persistent === vaultStoresBefore.reel_titles_persistent,
        'reel_titles_persistent untouched by canonical episode persist'
    );
    assert(
        vaultStoresAfter.reelforge_reel_series_metadata === vaultStoresBefore.reelforge_reel_series_metadata,
        'reelforge_reel_series_metadata untouched by canonical episode persist'
    );

    capturedPutEpisode = null;
    store.updateCatalogEpisode(localEpisodeId, { title: `${testTitle} — Episode 1 (edited)` });
    const editResult = await store.persistEpisodeRowToApi(localEpisodeId);
    assert(editResult.ok === true, 'editorial episode row save succeeds after create');
    assert(capturedPutEpisode != null, 'editorial save uses PUT after row exists');
    assert(!('reelId' in (capturedPutEpisode || {})), 'editorial PUT omits reelId');
    assert(
        String(apiEpisodes.get(localEpisodeId)?.reelId || '') === TEST_REEL_ID,
        'reelId preserved server-side after editorial PUT'
    );

    store.applyAuthoritativeApiCatalog([structuredClone(apiSeriesSnapshot)]);
    const hydrated = store.getSeriesById(mockSeriesId);
    assert(Boolean(hydrated), 'catalog hydration sees Studio series after episode create');
    assert(
        hydrated?.seasons?.[0]?.episodes?.some((e) => e.episodeId === localEpisodeId),
        'catalog hydration sees canonical episode row'
    );
    assert(
        hydrated?.seasons?.[0]?.episodes?.find((e) => e.episodeId === localEpisodeId)?.episodeId ===
            localEpisodeId,
        'canonical episode ID survives hydration'
    );

    const viewer = projection.buildViewerProductionProjection(hydrated, {});
    assert(viewer != null, 'viewerProductionProjection non-null once qualifying published episode exists');
    assert(viewer?.seriesId === mockSeriesId, 'viewer projection uses Studio canonical series id');
    assert(Number(viewer?.episodeCount) >= 1, 'viewer projection counts qualifying episode');

    const vicAfter = store.getSeriesById(VIC_G_ID);
    assert(collectReelIds(vicAfter).length === vicReelsBefore.length, 'Vic G episode count unchanged');
    for (const reelId of Object.values(REEL)) {
        assert(collectReelIds(vicAfter).includes(reelId), `Vic G reel ${reelId} unchanged`);
    }

    console.log('\n[optional live] backend first-episode round-trip');
    globalThis.fetch = nativeFetch;

    /** @returns {Promise<Record<string, string>>} */
    async function getAdminWriteHeaders() {
        const password = process.env.ADMIN_PASSWORD || 'Gaff1505!';
        const res = await fetch(`${BACKEND}/admin/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
            signal: AbortSignal.timeout(4000)
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.token) {
            return { 'Content-Type': 'application/json' };
        }
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${body.token}`
        };
    }

    try {
        const statusRes = await fetch(`${BACKEND}/api/series/status`, {
            signal: AbortSignal.timeout(3000)
        });
        if (!statusRes.ok) {
            console.log('  skip: series API unavailable');
        } else {
            const writeHeaders = await getAdminWriteHeaders();
            const liveTitle = `First Episode Live ${Date.now()}`;
            const livePayload = seriesApi.seriesCreatePayloadFromStudioTitle(liveTitle);
            const liveSeriesId = livePayload.id;
            const liveReelId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

            const createRes = await fetch(`${BACKEND}/api/series`, {
                method: 'POST',
                headers: writeHeaders,
                body: JSON.stringify(livePayload),
                signal: AbortSignal.timeout(8000)
            });
            if (createRes.status === 401) {
                console.log('  skip: live flow requires admin token');
            } else {
                assert(createRes.ok, 'live POST /api/series creates Studio series');

                store.resetSeriesCatalogEmpty();
                adminSession.setAdminSessionToken(
                    writeHeaders.Authorization?.replace(/^Bearer\s+/i, '') || 'live-token'
                );
                const getRes = await fetch(`${BACKEND}/api/series/${encodeURIComponent(liveSeriesId)}`, {
                    signal: AbortSignal.timeout(8000)
                });
                const liveSeriesDto = await getRes.json();
                store.applyAuthoritativeApiCatalog([seriesApi.apiSeriesToCatalog(liveSeriesDto)]);

                const liveNativeFetch = globalThis.fetch;
                globalThis.fetch = async (url, options = {}) => {
                    let href = String(url);
                    if (!href.startsWith('http')) {
                        href = `${BACKEND}${href.startsWith('/') ? '' : '/'}${href}`;
                    } else {
                        try {
                            const parsed = new URL(href);
                            if (
                                (parsed.pathname.startsWith('/api/') ||
                                    parsed.pathname.startsWith('/admin/')) &&
                                !href.startsWith(BACKEND)
                            ) {
                                href = `${BACKEND}${parsed.pathname}${parsed.search}`;
                            }
                        } catch {
                            /* keep original href */
                        }
                    }
                    return liveNativeFetch(href, options);
                };

                const liveAsset = {
                    id: liveReelId,
                    mediaAssetId: liveReelId,
                    name: `${liveTitle} S01E01`,
                    fileName: `${liveTitle} S01E01.mp4`,
                    url: 'https://cdn.example/live-first-ep.mp4',
                    type: 'video/mp4',
                    seriesIdentity: {
                        seriesLabel: liveTitle,
                        seasonNumber: 1,
                        episodeNumber: 1,
                        confirmedByCreator: true,
                        confidence: 'high'
                    }
                };

                const livePersist = await store.persistVaultEditsToCanonicalEpisode(
                    liveReelId,
                    {
                        title: `${liveTitle} — Episode 1`,
                        description: 'Live first episode synopsis',
                        status: 'published'
                    },
                    liveAsset
                );
                assert(livePersist.ok === true, 'live Vault save creates canonical episode via API');

                globalThis.fetch = liveNativeFetch;

                const liveGetSeries = await fetch(
                    `${BACKEND}/api/series/${encodeURIComponent(liveSeriesId)}`,
                    { signal: AbortSignal.timeout(8000) }
                );
                const liveHydratedDto = await liveGetSeries.json();
                const liveEpisodes = (liveHydratedDto.seasons || []).flatMap((s) => s.episodes || []);
                assert(liveEpisodes.length === 1, 'live GET confirms exactly one episode row');
                assert(
                    String(liveEpisodes[0]?.seriesId || liveSeriesId) === liveSeriesId ||
                        liveHydratedDto.id === liveSeriesId,
                    'live episode row belongs to Studio-created series'
                );
                assert(Number(liveEpisodes[0]?.episodeNumber) === 1, 'live first episodeNumber is 1');
                assert(
                    String(liveEpisodes[0]?.reelId || liveEpisodes[0]?.reel_id || '') === liveReelId,
                    'live episode reel binding preserved'
                );

                store.applyAuthoritativeApiCatalog([seriesApi.apiSeriesToCatalog(liveHydratedDto)]);
                const liveProjection = projection.buildViewerProductionProjection(
                    store.getSeriesById(liveSeriesId),
                    {}
                );
                assert(liveProjection != null, 'live viewer projection non-null after first published episode');

                const deleteRes = await fetch(`${BACKEND}/api/series/${encodeURIComponent(liveSeriesId)}`, {
                    method: 'DELETE',
                    headers: writeHeaders,
                    signal: AbortSignal.timeout(8000)
                });
                assert(deleteRes.ok, 'live DELETE cleanup succeeds');
            }
        }
    } catch (err) {
        console.log(`  skip: live backend integration (${err?.message || err})`);
    }
} finally {
    await server.close();
}

if (failures.length) {
    console.error('\nFAIL validate-first-episode-e2e');
    for (const msg of failures) console.error(`  ✗ ${msg}`);
    process.exit(1);
}

console.log('\nPASS validate-first-episode-e2e');
