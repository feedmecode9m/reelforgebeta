import { writable, derived, get } from 'svelte/store';
import {
    episodeIsPlayable,
    isEpisodeStatus,
    isSeries
} from './seriesTypes.js';
import {
    lookupPersistentHeroTitle,
    resolveLinkedAssetDisplayTitle,
    UNTITLED_CREATOR_EXPERIENCE
} from '../hero/heroTitleIntelligence.js';
import {
    loadReelSeriesMetadataMap,
    persistReelSeriesMetadataMap,
    upsertStoredReelSeriesMetadata,
    normalizeTags
} from './seriesMetadataStorage.js';
import {
    fetchAllSeries,
    fetchSeriesApiStatus,
    updateSeries,
    createSeries,
    createEpisode,
    updateEpisode,
    seriesCreatePayloadFromStudioTitle,
    seriesToApiPayload,
    seriesToApiRowPayload,
    episodeToApiRowPayload,
    episodeToApiCreatePayload,
    apiSeriesToCatalog,
    catalogToReelMetadataMap,
    applyReelPatchToCatalog,
    isSeriesApiMigrated,
    markSeriesApiMigrated,
    logSeriesApiRead,
    logSeriesApiWrite,
    logSeriesApiSync,
    cacheSeriesCatalogOffline
} from '../api/seriesApi.js';
import { getAdminToken } from '../adminSession.js';
import { logEpisodeAssetDiag } from './episodeAssetDiagnostics.js';
import { scheduleSyncPush } from '../sync/syncManager.js';
import {
    applyStoredBindingsToCatalog,
    clearStoredEpisodeVaultBinding,
    loadEpisodeVaultBindingMap,
    upsertStoredEpisodeVaultBinding
} from './episodeVaultBindingStorage.js';
import { getReadyHeroVaultAssets } from './heroVaultAssetSource.js';
import { inferAndBindVaultSeries } from './vaultSeriesInference.js';
import {
    isDemoSeriesId,
    stripDemoSeriesFromCatalog,
    resolveEditorialProsePrecedence
} from './seriesCatalogTruth.js';
import {
    mergeVicGSeriesIntoCatalog,
    VIC_G_SERIES_ID
} from './vicGSeriesPackage.js';
import {
    guardIntelligenceMetadataWrite,
    PROVENANCE_SOURCE_TYPES
} from '../architecture/intelligenceProvenance.js';
import {
    applySeriesCatalogEdit,
    sortEpisodesForDisplay,
    upsertSeriesCatalogEdit,
    upsertSeasonCatalogEdit,
    upsertEpisodeCatalogEdit,
    reapplyCreatorCatalogAuthority,
    getCreatorEpisodeStatus,
    loadSeriesCatalogEditsMap
} from './seriesCatalogEdits.js';
import { episodeIsViewerDiscoverable } from './publishingLifecycle.js';

/** @typedef {import('./seriesTypes.js').Series} Series */
/** @typedef {import('./seriesTypes.js').Season} Season */
/** @typedef {import('./seriesTypes.js').Episode} Episode */
/** @typedef {import('./seriesMetadataStorage.js').ReelSeriesMetadata} ReelSeriesMetadata */

/**
 * When true, commitCatalog may keep mockSeriesData fixtures (tests/dev opt-in ONLY).
 * Never set by production hydration paths.
 */
let allowDemoCatalogSession = false;

/**
 * Commit catalog writes with hard demo boundary (unless test/demo session).
 * @param {Series[]} items
 * @returns {Series[]}
 */
function sanitizeCatalogWrite(items) {
    if (allowDemoCatalogSession) {
        return Array.isArray(items) ? items : [];
    }
    return stripDemoSeriesFromCatalog(items);
}

/**
 * Live catalog starts empty (creator truth only).
 * All set/update go through demo-strip unless allowDemoCatalogSession.
 * mockSeriesData is NOT imported at module load — only by resetSeriesCatalogToMock().
 */
function createCreatorTruthCatalogStore() {
    const { subscribe, set: rawSet, update: rawUpdate } = writable(/** @type {Series[]} */ ([]));
    return {
        subscribe,
        /**
         * @param {Series[]} value
         */
        set(value) {
            rawSet(sanitizeCatalogWrite(value));
        },
        /**
         * @param {(items: Series[]) => Series[]} fn
         */
        update(fn) {
            rawUpdate((current) => sanitizeCatalogWrite(fn(current)));
        }
    };
}

export const seriesCatalog = createCreatorTruthCatalogStore();

/** Reel-level metadata map (localStorage source of truth for edits). */
export const reelSeriesMetadata = writable(/** @type {Record<string, ReelSeriesMetadata>} */ ({}));

/** @type {import('svelte/store').Readable<number>} */
export const seriesCount = derived(seriesCatalog, ($catalog) => $catalog.length);

/** @type {import('svelte/store').Readable<number>} */
export const episodeCount = derived(seriesCatalog, ($catalog) =>
    $catalog.reduce(
        (total, series) => total + series.seasons.reduce((sum, season) => sum + season.episodes.length, 0),
        0
    )
);

/** @type {import('svelte/store').Readable<Episode[]>} */
export const playableEpisodes = derived(seriesCatalog, ($catalog) => {
    const episodes = [];
    for (const series of $catalog) {
        for (const season of series.seasons) {
            for (const episode of season.episodes) {
                if (episodeIsPlayable(episode)) episodes.push(episode);
            }
        }
    }
    return episodes;
});

let metadataInitialized = false;
let apiHydrationStarted = false;
const blockedApiMetadataReels = new Set();

/** @type {'local' | 'api' | 'migrating'} */
export const seriesPersistenceMode = writable('local');

/** @returns {Promise<boolean>} */
async function isSeriesApiAvailable() {
    const status = await fetchSeriesApiStatus();
    return !status.disabled && status.enabled !== false;
}

/**
 * Merge API reel metadata with local map after catalog hydrate.
 *
 * Authority (public viewer + API catalog):
 *   - episodeId / seasonNumber / episodeNumber / seriesId ← API catalog row wins
 *   - episodeTitle ← API catalog title wins (vault must not replace with filename)
 *   - episodeStatus ← durable series_catalog_edits, else API, else local
 *   - vault local map may only fill gaps when API omits a field
 *
 * Vault inference must never manufacture public publication state over API draft/published.
 *
 * @param {Record<string, ReelSeriesMetadata>} localMap
 * @param {Record<string, ReelSeriesMetadata>} apiMap
 * @returns {Record<string, ReelSeriesMetadata>}
 */
function mergeMetadataMapsPreservingCreator(localMap, apiMap) {
    /** @type {Record<string, ReelSeriesMetadata>} */
    const out = {};

    // 1) API catalog rows are the base for every bound reel.
    for (const [reelId, apiRow] of Object.entries(apiMap || {})) {
        if (!apiRow) continue;
        const local = localMap?.[reelId];
        if (!local) {
            out[reelId] = { ...apiRow };
            continue;
        }
        const seriesId = String(apiRow.seriesId || local.seriesId || '');
        const episodeId = String(apiRow.episodeId || local.episodeId || '');
        const editStatus = getCreatorEpisodeStatus(seriesId, episodeId);
        out[reelId] = {
            ...local,
            ...apiRow,
            // Structural identity: API catalog first
            seriesId: apiRow.seriesId || local.seriesId,
            episodeId: apiRow.episodeId || local.episodeId,
            seriesName: apiRow.seriesName || local.seriesName,
            seasonNumber:
                apiRow.seasonNumber != null ? apiRow.seasonNumber : local.seasonNumber,
            episodeNumber:
                apiRow.episodeNumber != null ? apiRow.episodeNumber : local.episodeNumber,
            // Master Edit (reel_titles_persistent) outranks stale API/package episode labels.
            // Otherwise catalog package fills, then local gaps — never invent a new title key.
            episodeTitle:
                lookupPersistentHeroTitle(reelId) ||
                apiRow.episodeTitle ||
                local.episodeTitle,
            description: resolveEditorialProsePrecedence(apiRow.description, local.description),
            // Publishing: catalog-edits → API → local (never local-ready over API draft/published)
            episodeStatus:
                editStatus || apiRow.episodeStatus || local.episodeStatus || 'draft'
        };
    }

    // 2) Keep local-only reels (vault-inferred offline series with no API row yet).
    for (const [reelId, local] of Object.entries(localMap || {})) {
        if (!local || out[reelId]) continue;
        out[reelId] = { ...local };
    }

    // 3) Overlay durable creator catalog-edit statuses by episodeId
    const editMap = loadSeriesCatalogEditsMap();
    for (const [seriesId, edit] of Object.entries(editMap || {})) {
        const episodes = edit?.episodes;
        if (!episodes || typeof episodes !== 'object') continue;
        for (const [episodeId, epEdit] of Object.entries(episodes)) {
            if (!epEdit?.status) continue;
            for (const [reelId, row] of Object.entries(out)) {
                if (
                    String(row.episodeId || '') === String(episodeId) ||
                    (String(row.seriesId || '') === String(seriesId) &&
                        String(row.episodeId || '') === String(episodeId))
                ) {
                    out[reelId] = { ...row, episodeStatus: epEdit.status };
                }
            }
        }
    }
    return out;
}

/**
 * Force reel metadata map fields to match live catalog episodes (status, S/E, title, ids).
 * Used after API catalog replace so vault inference writeback cannot stay sticky.
 *
 * @param {Record<string, ReelSeriesMetadata>} map
 * @param {import('./seriesTypes.js').Series[]} catalog
 * @returns {Record<string, ReelSeriesMetadata>}
 */
function alignReelMetadataMapToCatalog(map, catalog) {
    /** @type {Record<string, ReelSeriesMetadata>} */
    const out = { ...(map || {}) };
    const list = Array.isArray(catalog) ? catalog : [];
    for (const series of list) {
        for (const season of series.seasons || []) {
            for (const ep of season.episodes || []) {
                const reelId = ep.reelId ? String(ep.reelId).trim() : '';
                if (!reelId) continue;
                const prev = out[reelId] || { reelId };
                out[reelId] = {
                    ...prev,
                    reelId,
                    seriesId: series.id,
                    seriesName: series.title,
                    seasonNumber: season.seasonNumber,
                    episodeNumber: ep.episodeNumber,
                    episodeTitle: ep.title,
                    description: ep.description ?? prev.description,
                    episodeStatus: ep.status,
                    episodeId: ep.episodeId,
                    updatedAt: Date.now()
                };
            }
        }
    }
    return out;
}

/**
 * Stamp durable creator catalog edits (order + status + series/season meta)
 * onto the live seriesCatalog store after API/vault merges.
 */
export function reapplyCreatorCatalogAuthorityToStore() {
    seriesCatalog.update((items) => reapplyCreatorCatalogAuthority(items));
    // Keep reel map statuses aligned after authority reapply
    const catalog = get(seriesCatalog);
    /** @type {Record<string, ReelSeriesMetadata>} */
    const map = { ...get(reelSeriesMetadata) };
    let changed = false;
    for (const series of catalog) {
        for (const season of series.seasons || []) {
            for (const ep of season.episodes || []) {
                const reelId = ep.reelId ? String(ep.reelId) : '';
                if (!reelId) continue;
                const prev = map[reelId] || { reelId };
                if (prev.episodeStatus !== ep.status || prev.episodeId !== ep.episodeId) {
                    map[reelId] = {
                        ...prev,
                        reelId,
                        episodeId: ep.episodeId,
                        seriesId: series.id,
                        seriesName: series.title,
                        seasonNumber: season.seasonNumber,
                        episodeNumber: ep.episodeNumber,
                        episodeTitle: ep.title,
                        episodeStatus: ep.status
                    };
                    changed = true;
                }
            }
        }
    }
    if (changed) {
        reelSeriesMetadata.set(map);
        persistReelSeriesMetadataMap(map);
    }
}

/**
 * @param {import('./seriesTypes.js').Series[]} catalogItems
 * @param {Record<string, ReelSeriesMetadata>} map
 */
function applyApiCatalogState(catalogItems, map) {
    // API rows may still contain previously migrated demo series — strip always.
    const clean = stripDemoSeriesFromCatalog(catalogItems);
    // Creator package: Vic G reel bindings (structural; display titles remain persistent/canonical).
    const withPackages = mergeVicGSeriesIntoCatalog(clean);
    const packageMap = catalogToReelMetadataMap(withPackages);
    const cleanMap = stripDemoReelMetadata({
        ...(map && typeof map === 'object' ? map : {}),
        ...packageMap
    });
    const localMap = stripDemoReelMetadata(loadReelSeriesMetadataMap());
    // API catalog identity + publish status win over vault-local filename maps.
    let mergedMap = mergeMetadataMapsPreservingCreator(localMap, cleanMap);

    // Catalog episodes (with reelId) are authoritative — never re-apply vault rewrite
    // of status / S/E / titles onto the clean catalog tree.
    seriesCatalog.set(withPackages);
    mergedMap = alignReelMetadataMapToCatalog(mergedMap, withPackages);
    reelSeriesMetadata.set(mergedMap);

    // Vault may attach media for reels not yet in catalog, or fill heroVaultAssetId —
    // must not invent publication or renumber catalog episodes.
    rebindVaultInferredSeries('after-api-catalog');
    rehydrateEpisodeVaultBindings();

    // Re-align after optional vault bind (bindings only touch structural media ids).
    // Re-assert Vic G package after vault inference (must not invent titles).
    seriesCatalog.update((items) => mergeVicGSeriesIntoCatalog(items));
    const postBindCatalog = get(seriesCatalog);
    const realigned = alignReelMetadataMapToCatalog(get(reelSeriesMetadata), postBindCatalog);
    reelSeriesMetadata.set(realigned);

    // Creator Series Catalog edits (order + optional status overrides) final layer.
    reapplyCreatorCatalogAuthorityToStore();
    // Catalog won for status — keep map in sync with final store (including edits).
    seriesCatalog.update((items) => mergeVicGSeriesIntoCatalog(items));
    const afterEdits = alignReelMetadataMapToCatalog(get(reelSeriesMetadata), get(seriesCatalog));
    reelSeriesMetadata.set(afterEdits);
    persistReelSeriesMetadataMap(afterEdits);

    seriesPersistenceMode.set('api');
}

/**
 * Ensure Vic G package is present on the live catalog + reel metadata map.
 * Safe for tests and local init before/without API hydrate.
 */
export function ensureVicGSeriesPackage() {
    seriesCatalog.update((items) => mergeVicGSeriesIntoCatalog(items));
    const catalog = get(seriesCatalog);
    const packageMap = catalogToReelMetadataMap(
        catalog.filter((s) => s && s.id === VIC_G_SERIES_ID)
    );
    const localMap = stripDemoReelMetadata(get(reelSeriesMetadata));
    const merged = mergeMetadataMapsPreservingCreator(localMap, packageMap);
    const aligned = alignReelMetadataMapToCatalog(merged, catalog);
    reelSeriesMetadata.set(aligned);
    persistReelSeriesMetadataMap(aligned);
    return getSeriesById(VIC_G_SERIES_ID) || null;
}

/**
 * Test / tooling entry: apply API catalog authority onto the live store
 * (skips network — same merge path as hydrateCreatorAuthoredCatalogFromApi success).
 * @param {import('./seriesTypes.js').Series[]} catalogItems
 */
export function applyAuthoritativeApiCatalog(catalogItems) {
    const list = Array.isArray(catalogItems) ? catalogItems : [];
    applyApiCatalogState(list, catalogToReelMetadataMap(list));
}

/**
 * Drop reel metadata that points at demo series fixtures.
 * @param {Record<string, ReelSeriesMetadata>} map
 * @returns {Record<string, ReelSeriesMetadata>}
 */
function stripDemoReelMetadata(map) {
    /** @type {Record<string, ReelSeriesMetadata>} */
    const next = {};
    if (!map || typeof map !== 'object') return next;
    for (const [reelId, meta] of Object.entries(map)) {
        if (!meta) continue;
        if (isDemoSeriesId(meta.seriesId)) continue;
        if (/neon-vengeance/i.test(String(meta.seriesId || ''))) continue;
        if (/^Neon Vengeance$/i.test(String(meta.seriesName || '').trim())) continue;
        next[reelId] = meta;
    }
    return next;
}

/**
 * Re-attach high-confidence vault series after a full catalog replace.
 * Safe no-op when vault is empty; skips reels already catalog-bound.
 * @param {string} source
 */
function rebindVaultInferredSeries(source) {
    try {
        const ready = getReadyHeroVaultAssets();
        if (!ready.length) {
            reapplyCreatorCatalogAuthorityToStore();
            return;
        }
        inferAndBindVaultSeries(ready, { source: source || 'after-catalog-replace' });
        // Vault bind must never wipe creator order/status
        reapplyCreatorCatalogAuthorityToStore();
    } catch (err) {
        console.warn('[seriesStore] vault rebind after catalog replace failed', err);
        try {
            reapplyCreatorCatalogAuthorityToStore();
        } catch {
            /* non-fatal */
        }
    }
}

/**
 * Overlay persisted Hero Vault episode bindings onto the live catalog.
 * Safe to call after API hydrate or local init so reload keeps bindings.
 */
export function rehydrateEpisodeVaultBindings() {
    const map = loadEpisodeVaultBindingMap();
    if (!Object.keys(map).length) return;
    seriesCatalog.update((items) => applyStoredBindingsToCatalog(items, map));
}

/**
 * Push local catalog + reel metadata map to backend (migration).
 * @param {import('./seriesTypes.js').Series[]} catalogItems
 * @param {Record<string, ReelSeriesMetadata>} map
 */
async function migrateLocalCatalogToApi(catalogItems, map) {
    seriesPersistenceMode.set('migrating');
    // Never push demo fixtures into the backend catalog.
    const cleanCatalog = stripDemoSeriesFromCatalog(catalogItems);
    const cleanMap = stripDemoReelMetadata(map);
    logSeriesApiSync({
        phase: 'migrate-start',
        seriesCount: cleanCatalog.length,
        reelCount: Object.keys(cleanMap).length
    });

    for (const series of cleanCatalog) {
        const payload = seriesToApiPayload(series);
        for (const [reelId, meta] of Object.entries(cleanMap)) {
            if (meta.seriesId === series.id || meta.seriesName === series.title) {
                applyReelPatchToCatalog(cleanCatalog, reelId, meta);
            }
        }
        const enriched = cleanCatalog.find((s) => s.id === series.id) || series;
        await createSeries(seriesToApiPayload(enriched));
    }

    markSeriesApiMigrated();
    logSeriesApiSync({ phase: 'migrate-complete', status: 'complete' });
}

/**
 * Explicit API → hydrated catalog boundary.
 *
 * Ordering inside applyApiCatalogState:
 *   API catalog rows → metadata align → vault media rebind (bindings only)
 *   → reapplyCreatorCatalogAuthorityToStore (durable creator edits win last)
 *
 * Creator-confirmed vault seriesIdentity lives in personal_video_vault, not API rows.
 * It is overlaid at vault hydrate via overlayLocalCreatorVaultAuthority (separate boundary).
 *
 * @param {unknown} [prefetchedResponse] optional GET /api/series payload (tests/migration)
 * @returns {Promise<{ ok: true; seriesCount: number } | { ok: false; reason: string }>}
 */
export async function hydrateCreatorAuthoredCatalogFromApi(prefetchedResponse) {
    try {
        const available = await isSeriesApiAvailable();
        if (!available) {
            logSeriesApiRead({ source: 'fallback', reason: 'api-unavailable' });
            seriesPersistenceMode.set('local');
            return { ok: false, reason: 'api-unavailable' };
        }

        const response =
            prefetchedResponse !== undefined ? prefetchedResponse : await fetchAllSeries();
        if (response?.disabled) {
            logSeriesApiRead({
                source: 'fallback',
                reason: response.error || 'api-disabled'
            });
            seriesPersistenceMode.set('local');
            return { ok: false, reason: response.error || 'api-disabled' };
        }

        if (!Array.isArray(response) || response.length === 0) {
            logSeriesApiRead({ source: 'local-empty-api' });
            return { ok: false, reason: 'api-empty' };
        }

        const catalogItems = response.map((row) => apiSeriesToCatalog(row)).filter(isSeries);
        const map = catalogToReelMetadataMap(catalogItems);
        applyApiCatalogState(catalogItems, map);
        persistReelSeriesMetadataMap(get(reelSeriesMetadata));
        cacheSeriesCatalogOffline(get(seriesCatalog), get(reelSeriesMetadata));
        markSeriesApiMigrated();
        logSeriesApiRead({
            source: 'creator-authored-api-hydrate',
            seriesCount: catalogItems.length
        });
        return { ok: true, seriesCount: catalogItems.length };
    } catch (err) {
        const message = String(err?.message || err || 'api-error');
        logSeriesApiRead({ source: 'fallback', reason: message });
        seriesPersistenceMode.set('local');
        return { ok: false, reason: message };
    }
}

/** Load series catalog from API when available; fallback to localStorage. */
async function hydrateSeriesFromApi() {
    try {
        const hydrated = await hydrateCreatorAuthoredCatalogFromApi();
        if (hydrated.ok) {
            return;
        }

        if (hydrated.reason !== 'api-empty') {
            return;
        }

        const localMap = hydrateStudioMetadataFromCatalog();
        const localCatalog = get(seriesCatalog);
        if (!isSeriesApiMigrated() && (Object.keys(localMap).length > 0 || localCatalog.length > 0)) {
            await migrateLocalCatalogToApi(localCatalog, localMap);
            const refreshed = await fetchAllSeries();
            const remigrated = await hydrateCreatorAuthoredCatalogFromApi(refreshed);
            if (remigrated.ok) {
                logSeriesApiSync({
                    source: 'migrated',
                    seriesCount: remigrated.seriesCount
                });
            }
            return;
        }

        logSeriesApiRead({ source: 'local-empty-api' });
    } catch (err) {
        logSeriesApiRead({ source: 'fallback', reason: err?.message || 'api-error' });
        seriesPersistenceMode.set('local');
    }
}

/** Seed studio metadata from catalog for reels without saved studio entries. */
function hydrateStudioMetadataFromCatalog() {
    const map = stripDemoReelMetadata(loadReelSeriesMetadataMap());
    let changed = false;

    for (const series of get(seriesCatalog)) {
        if (isDemoSeriesId(series.id)) continue;
        for (const season of series.seasons) {
            for (const episode of season.episodes || []) {
                const reelId = episode.reelId;
                if (!reelId || map[reelId]) continue;
                // Demo fixture reel ids (reel-neon-*) are not creator bindings.
                if (
                    String(reelId).startsWith('reel-neon-') ||
                    String(reelId).startsWith('reel-vault-') ||
                    String(reelId).startsWith('reel-trending-')
                ) {
                    continue;
                }

                map[reelId] = {
                    reelId,
                    seriesName: series.title,
                    seasonNumber: season.seasonNumber,
                    episodeNumber: episode.episodeNumber,
                    episodeTitle: episode.title,
                    description: episode.description || series.description || '',
                    genre: episode.genre || series.genre || '',
                    tags: episode.tags?.length ? episode.tags : series.tags || [],
                    runtime: episode.runtime,
                    releaseYear: series.releaseYear,
                    episodeStatus: episode.status,
                    episodeId: episode.episodeId,
                    seriesId: series.id,
                    updatedAt: Date.now()
                };
                changed = true;
            }
        }
    }

    if (changed) {
        persistReelSeriesMetadataMap(map);
    }
    return map;
}

/** Load localStorage metadata and merge into catalog; hydrate API asynchronously. */
export function initSeriesMetadata() {
    if (metadataInitialized) return;
    metadataInitialized = true;
    allowDemoCatalogSession = false;
    // Persist a cleaned metadata map so demo Neon entries do not rehydrate later.
    const rawMap = loadReelSeriesMetadataMap();
    const map = stripDemoReelMetadata(rawMap);
    if (Object.keys(map).length !== Object.keys(rawMap).length) {
        persistReelSeriesMetadataMap(map);
    }
    // Ensure catalog store has no leftover demos in memory.
    seriesCatalog.update((items) => items);
    reelSeriesMetadata.set(map);
    applyAllMetadataToCatalog(map);
    rehydrateEpisodeVaultBindings();
    reapplyCreatorCatalogAuthorityToStore();
    // Structural Vic G package (real vault reelIds) — always available for Theater family.
    ensureVicGSeriesPackage();

    if (!apiHydrationStarted) {
        apiHydrationStarted = true;
        void hydrateSeriesFromApi();
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('reelforge:sync-applied', (event) => {
            const detail = /** @type {CustomEvent} */ (event).detail;
            const syncMap = stripDemoReelMetadata(
                detail?.seriesMetadata || loadReelSeriesMetadataMap()
            );
            const localMap = stripDemoReelMetadata(loadReelSeriesMetadataMap());
            const merged = mergeMetadataMapsPreservingCreator(localMap, syncMap);
            reelSeriesMetadata.set(merged);
            applyAllMetadataToCatalog(merged);
            rehydrateEpisodeVaultBindings();
            reapplyCreatorCatalogAuthorityToStore();
        });
    }
}

/**
 * @param {string} reelId
 * @returns {ReelSeriesMetadata | null}
 */
export function getReelSeriesMetadata(reelId) {
    if (!reelId) return null;
    return get(reelSeriesMetadata)[reelId] || null;
}

/**
 * Persist reel-level series metadata (Creator Truth write path).
 * Fail-closed: missing sourceType resolves to system and cannot write prose fields.
 * sourceType creator | vault | binding may author title/description/genre/runtime.
 * sourceType ai | discovery | demo | system cannot write creator prose.
 *
 * @param {string} reelId
 * @param {Partial<ReelSeriesMetadata> & { provenanceSource?: string; sourceType?: string }} patch
 * @param {{ sourceType?: string; context?: string; skipEpisodeBind?: boolean }} [options]
 */
export function saveReelSeriesMetadata(reelId, patch, options = {}) {
    const explicit =
        options.sourceType ??
        patch?.provenanceSource ??
        patch?.sourceType;
    // Never default missing provenance to creator.
    const sourceType =
        explicit === undefined || explicit === null || String(explicit).trim() === ''
            ? PROVENANCE_SOURCE_TYPES.SYSTEM
            : explicit;
    const { provenanceSource: _p, sourceType: _s, ...rest } = patch || {};
    const guarded = guardIntelligenceMetadataWrite(rest, {
        sourceType,
        context: options.context || 'saveReelSeriesMetadata'
    });
    if (!Object.keys(guarded.patch).length && guarded.blockedFields.length) {
        return getReelSeriesMetadata(reelId);
    }
    const saved = upsertStoredReelSeriesMetadata(reelId, guarded.patch);
    if (!saved) return null;
    reelSeriesMetadata.update((map) => ({ ...map, [reelId]: saved }));
    applyMetadataToCatalog(reelId, saved);
    // Structural catalog reels only — metadata already written via this function.
    if (saved.episodeId && !options.skipEpisodeBind) {
        bindEpisodeReelIdOnCatalog(reelId, saved.episodeId, {
            mediaAssetId: rest.mediaAssetId,
            thumbnailAssetId: rest.thumbnailAssetId,
            aliases: rest.aliases
        });
    }
    const allowApiPersist =
        sourceType === PROVENANCE_SOURCE_TYPES.CREATOR ||
        sourceType === PROVENANCE_SOURCE_TYPES.BINDING;
    if (allowApiPersist) {
        void persistReelMetadataToApi(reelId, saved);
    }
    scheduleSyncPush('seriesMetadata');
    return saved;
}

/** @param {string} reelId @param {ReelSeriesMetadata} saved */
async function persistReelMetadataToApi(reelId, saved) {
    if (blockedApiMetadataReels.has(String(reelId))) {
        return;
    }
    try {
        const available = await isSeriesApiAvailable();
        if (!available) {
            logSeriesApiWrite({ source: 'fallback', reelId, reason: 'api-unavailable' });
            return;
        }
        if (!getAdminToken()) {
            logSeriesApiWrite({ source: 'fallback', reelId, reason: 'missing_authorization' });
            return;
        }

        // Clone current catalog for API payload only. Never re-set the live store from this
        // snapshot after `await` — a concurrent draft/status edit would be clobbered.
        const live = get(seriesCatalog);
        const savedSeriesId = String(saved?.seriesId || '').trim();
        const hasExistingSavedSeries = savedSeriesId
            ? live.some((series) => String(series?.id || '') === savedSeriesId)
            : false;
        const canonicalBinding = live
            .flatMap((series) =>
                (series.seasons || []).flatMap((season) =>
                    (season.episodes || []).map((episode) => ({
                        seriesId: series.id,
                        seriesTitle: series.title,
                        seasonNumber: season.seasonNumber,
                        episodeId: episode.episodeId,
                        episodeNumber: episode.episodeNumber,
                        episodeTitle: episode.title,
                        episodeStatus: episode.status,
                        reelId: episode.reelId
                    }))
                )
            )
            .find((binding) => String(binding.reelId || '') === String(reelId));
        if (!canonicalBinding && !hasExistingSavedSeries) {
            logSeriesApiWrite({
                source: 'fallback',
                reelId,
                reason: 'unbound_series_metadata'
            });
            return;
        }
        const metadataForApi = canonicalBinding
            ? {
                  ...saved,
                  seriesId: canonicalBinding.seriesId,
                  seriesName: canonicalBinding.seriesTitle,
                  seasonNumber: canonicalBinding.seasonNumber,
                  episodeId: canonicalBinding.episodeId,
                  episodeNumber: canonicalBinding.episodeNumber,
                  episodeTitle:
                      String(saved?.episodeTitle || '').trim() || canonicalBinding.episodeTitle,
                  episodeStatus:
                      canonicalBinding.episodeStatus || saved?.episodeStatus || 'draft'
              }
            : saved;
        const catalogClone =
            typeof structuredClone === 'function'
                ? structuredClone(live)
                : /** @type {Series[]} */ (JSON.parse(JSON.stringify(live)));
        const target = applyReelPatchToCatalog(catalogClone, reelId, metadataForApi);
        if (!target) return;
        const targetTags = Array.isArray(target.tags) ? target.tags.map((tag) => String(tag)) : [];
        if (targetTags.includes('vault-inferred') || targetTags.includes('nlp-rehomed')) {
            logSeriesApiWrite({
                source: 'fallback',
                reelId,
                reason: 'inferred_series_not_persisted'
            });
            return;
        }

        // Secondary guard: do not demote established catalog publish state from stale client snapshots.
        if (
            canonicalBinding &&
            String(canonicalBinding.episodeStatus || '') === 'draft' &&
            String(saved?.episodeStatus || '') === 'published'
        ) {
            for (const season of target.seasons || []) {
                for (const episode of season.episodes || []) {
                    if (String(episode?.reelId || '') !== String(reelId)) continue;
                    if (episode.status === 'draft') {
                        episode.status = 'published';
                    }
                }
            }
        }

        const payload = seriesToApiPayload(target);
        const liveEpisodeByReel = new Map();
        for (const series of live) {
            for (const season of series.seasons || []) {
                for (const episode of season.episodes || []) {
                    const id = String(episode?.reelId || '').trim();
                    if (!id) continue;
                    liveEpisodeByReel.set(id, String(episode.episodeId || ''));
                }
            }
        }
        const duplicateConflict = (payload.seasons || [])
            .flatMap((season) => season.episodes || [])
            .find((episode) => {
                const reel = String(episode?.reelId || '').trim();
                if (!reel) return false;
                const existingEpisodeId = String(liveEpisodeByReel.get(reel) || '');
                const nextEpisodeId = String(episode?.episodeId || '');
                return existingEpisodeId && nextEpisodeId && existingEpisodeId !== nextEpisodeId;
            });
        if (duplicateConflict) {
            blockedApiMetadataReels.add(String(reelId));
            logSeriesApiWrite({
                source: 'fallback',
                reelId,
                reason: 'reel_conflict_existing_episode'
            });
            return;
        }
        await updateSeries(target.id, payload);
        seriesPersistenceMode.set('api');
        const current = get(seriesCatalog);
        cacheSeriesCatalogOffline(current, catalogToReelMetadataMap(current));
        logSeriesApiWrite({ reelId, seriesId: target.id, source: 'api' });
    } catch (err) {
        const message = String(err?.message || '');
        if (
            /idx_episodes_reel_unique/i.test(message) ||
            /duplicate key value violates unique constraint/i.test(message)
        ) {
            blockedApiMetadataReels.add(String(reelId));
        }
        logSeriesApiWrite({
            source: 'fallback',
            reelId,
            reason: message || 'api-save-failed'
        });
    }
}

/**
 * Catalog-only reel attachment (no metadata upsert).
 * @param {string} feedReelId
 * @param {string} episodeId
 * @param {{ mediaAssetId?: unknown; thumbnailAssetId?: unknown; aliases?: unknown }} [structural]
 */
function bindEpisodeReelIdOnCatalog(feedReelId, episodeId, structural = {}) {
    if (!feedReelId || !episodeId) return false;
    let changed = false;
    seriesCatalog.update((catalogItems) => {
        const next = catalogItems.map((series) => ({
            ...series,
            seasons: series.seasons.map((season) => ({
                ...season,
                episodes: season.episodes.map((episode) => {
                    if (episode.episodeId !== episodeId) return episode;
                    changed = true;
                    const aliases = Array.isArray(structural.aliases)
                        ? structural.aliases.map(String).filter(Boolean)
                        : Array.isArray(episode.aliases)
                          ? episode.aliases
                          : [];
                    return {
                        ...episode,
                        reelId: feedReelId,
                        mediaAssetId:
                            structural.mediaAssetId != null
                                ? structural.mediaAssetId
                                : feedReelId,
                        thumbnailAssetId:
                            structural.thumbnailAssetId !== undefined
                                ? structural.thumbnailAssetId
                                : episode.thumbnailAssetId ?? null,
                        aliases
                    };
                })
            }))
        }));
        return changed ? next : catalogItems;
    });
    return changed;
}

/**
 * Bind a feed reel UUID to a catalog episode and persist studio metadata
 * through the fail-closed saveReelSeriesMetadata path (sourceType: binding).
 *
 * @param {string} feedReelId
 * @param {string} episodeId
 * @param {Partial<ReelSeriesMetadata> & { sourceType?: string; provenanceSource?: string; source?: string }} [metaPatch]
 * @param {{ sourceType?: string; context?: string }} [options]
 */
export function bindEpisodeToFeedReel(feedReelId, episodeId, metaPatch = {}, options = {}) {
    if (!feedReelId || !episodeId) return false;

    const ctx = getEpisodeById(episodeId);
    if (!ctx) return false;

    const {
        sourceType: patchSourceType,
        provenanceSource,
        source: _legacySource,
        ...rest
    } = metaPatch || {};

    const sourceType =
        options.sourceType ||
        patchSourceType ||
        provenanceSource ||
        'binding';

    const changed = bindEpisodeReelIdOnCatalog(feedReelId, episodeId, {
        mediaAssetId: rest.mediaAssetId,
        thumbnailAssetId: rest.thumbnailAssetId,
        aliases: rest.aliases
    });

    const saved = saveReelSeriesMetadata(
        feedReelId,
        {
            reelId: feedReelId,
            episodeId,
            seriesId: ctx.series.id,
            seasonNumber: ctx.season.seasonNumber,
            episodeNumber: ctx.episode.episodeNumber,
            episodeTitle: rest.episodeTitle ?? ctx.episode.title,
            seriesName: rest.seriesName ?? ctx.series.title,
            description: rest.description ?? ctx.episode.description ?? ctx.series.description,
            genre: rest.genre ?? ctx.episode.genre ?? ctx.series.genre,
            runtime: rest.runtime ?? ctx.episode.runtime,
            releaseYear: rest.releaseYear ?? ctx.series.releaseYear,
            episodeStatus: rest.episodeStatus ?? ctx.episode.status,
            tags: rest.tags ?? ctx.episode.tags ?? ctx.series.tags,
            ...rest
        },
        {
            sourceType,
            context: options.context || 'bindEpisodeToFeedReel',
            skipEpisodeBind: true
        }
    );

    return changed || Boolean(saved);
}

/**
 * Attach a feed reel to a catalog episode (Studio asset pipeline).
 * @param {string} episodeId
 * @param {string} feedReelId
 */
export function attachEpisodeReel(episodeId, feedReelId) {
    const ctx = getEpisodeById(episodeId);
    if (!ctx || !feedReelId) return false;

    const bound = bindEpisodeToFeedReel(feedReelId, episodeId);
    if (bound) {
        logEpisodeAssetDiag('EPISODE_ATTACH', {
            seriesId: ctx.series.id,
            seasonId: ctx.season.seasonId || `season-${ctx.series.id}-${ctx.season.seasonNumber}`,
            episodeId,
            reelId: feedReelId,
            seasonNumber: ctx.season.seasonNumber,
            episodeNumber: ctx.episode.episodeNumber
        });
    }
    return bound;
}

/**
 * Detach reel from a catalog episode.
 * Clears reelId and any mediaAssetId that points at the same reel.
 * Optional demotePublished → draft so empty package shells do not stay viewer-discoverable.
 *
 * @param {string} episodeId
 * @param {{ demotePublished?: boolean; clearMatchingMediaAsset?: boolean }} [options]
 */
export function detachEpisodeReel(episodeId, options = {}) {
    const ctx = getEpisodeById(episodeId);
    if (!ctx) return false;

    const demotePublished = options.demotePublished === true;
    const clearMatchingMedia = options.clearMatchingMediaAsset !== false;
    const oldReelId = ctx.episode.reelId || null;
    const oldMedia =
        ctx.episode.mediaAssetId != null ? String(ctx.episode.mediaAssetId).trim() : '';
    let changed = false;

    seriesCatalog.update((catalogItems) => {
        const next = catalogItems.map((series) => ({
            ...series,
            seasons: series.seasons.map((season) => ({
                ...season,
                episodes: season.episodes.map((episode) => {
                    if (episode.episodeId !== episodeId) return episode;
                    changed = true;
                    const mediaId =
                        episode.mediaAssetId != null ? String(episode.mediaAssetId).trim() : '';
                    const dropMedia =
                        clearMatchingMedia &&
                        mediaId &&
                        (mediaId === String(oldReelId || '') ||
                            (oldMedia && mediaId === oldMedia));
                    return {
                        ...episode,
                        reelId: null,
                        mediaAssetId: dropMedia ? null : episode.mediaAssetId,
                        ...(demotePublished && episode.status === 'published'
                            ? { status: /** @type {const} */ ('draft') }
                            : {})
                    };
                })
            }))
        }));
        return changed ? next : catalogItems;
    });

    const metaKeys = [oldReelId, oldMedia].filter(Boolean);
    if (metaKeys.length) {
        const map = loadReelSeriesMetadataMap();
        let mapChanged = false;
        for (const key of metaKeys) {
            if (map[key]?.episodeId === episodeId) {
                delete map[key];
                mapChanged = true;
            }
        }
        if (mapChanged) {
            persistReelSeriesMetadataMap(map);
            reelSeriesMetadata.update((current) => {
                const next = { ...current };
                for (const key of metaKeys) delete next[key];
                return next;
            });
        }
    }

    if (changed) {
        logEpisodeAssetDiag('EPISODE_DETACH', {
            seriesId: ctx.series.id,
            seasonId: ctx.season.seasonId || `season-${ctx.series.id}-${ctx.season.seasonNumber}`,
            episodeId,
            reelId: oldReelId,
            status: demotePublished ? 'Missing Asset (demoted)' : 'Missing Asset'
        });
    }

    return changed;
}

/**
 * @param {Record<string, ReelSeriesMetadata>} map
 */
function applyAllMetadataToCatalog(map) {
    for (const [reelId, meta] of Object.entries(map)) {
        applyMetadataToCatalog(reelId, meta);
    }
}

/**
 * @param {string} reelId
 * @param {ReelSeriesMetadata} meta
 */
function applyMetadataToCatalog(reelId, meta) {
    seriesCatalog.update((catalogItems) => {
        let changed = false;
        const next = catalogItems.map((series) => ({
            ...series,
            seasons: series.seasons.map((season) => ({
                ...season,
                episodes: season.episodes.map((episode) => {
                    const linked =
                        episode.reelId === reelId ||
                        (meta.episodeId && episode.episodeId === meta.episodeId);
                    if (!linked) return episode;

                    const catalogHasNumber =
                        Number.isFinite(Number(episode.episodeNumber)) &&
                        Number(episode.episodeNumber) >= 1;
                    const metaEp = Number(meta.episodeNumber);
                    // Identity labels (S/E) are vault/catalog stable — never renumber solely because
                    // vault inference parsed a different display-order-like "E1" from a filename.
                    let episodeNumber = episode.episodeNumber;
                    if (!catalogHasNumber && Number.isFinite(metaEp) && metaEp >= 1) {
                        episodeNumber = Math.floor(metaEp);
                    }

                    // Publishing authority lives on the catalog episode (API / creator updateCatalogEpisode).
                    // Reel metadata writeback may fill a missing status only — never elevate draft→published
                    // or demote published→ready from sticky vault maps / filename inference.
                    let status = episode.status;
                    if (!isEpisodeStatus(status) && isEpisodeStatus(meta.episodeStatus)) {
                        status = meta.episodeStatus;
                    }

                    // Package title/description: catalog package wins; vault may only fill empty holes.
                    const catalogTitle = String(episode.title || '').trim();
                    const title = catalogTitle
                        ? episode.title
                        : meta.episodeTitle || episode.title;
                    const catalogDesc =
                        episode.description != null && String(episode.description).trim() !== '';
                    const description = catalogDesc
                        ? episode.description
                        : meta.description ?? episode.description;

                    changed = true;
                    return {
                        ...episode,
                        title,
                        description,
                        episodeNumber,
                        genre: meta.genre ?? episode.genre,
                        tags: meta.tags ?? episode.tags,
                        runtime: meta.runtime ?? episode.runtime,
                        status
                    };
                })
            })),
            // Do not rename an API/creator series from vault franchise inference on media bind
            title: series.title,
            genre: seriesMatchesReel(series, reelId, meta) ? meta.genre ?? series.genre : series.genre,
            releaseYear: seriesMatchesReel(series, reelId, meta)
                ? meta.releaseYear ?? series.releaseYear
                : series.releaseYear,
            tags: series.tags
        }));
        return changed ? next : catalogItems;
    });
}

/**
 * @param {Series} series
 * @param {string} reelId
 * @param {ReelSeriesMetadata} meta
 */
function seriesMatchesReel(series, reelId, meta) {
    if (meta.seriesId && series.id === meta.seriesId) return true;
    for (const season of series.seasons) {
        for (const episode of season.episodes) {
            if (episode.reelId === reelId || (meta.episodeId && episode.episodeId === meta.episodeId)) {
                return true;
            }
        }
    }
    return false;
}

/**
 * @param {string} reelId
 * @param {ReelSeriesMetadata} meta
 */
function buildContextFromStoredMetadata(reelId, meta) {
    const seriesId = meta.seriesId || `stored-series-${slugify(meta.seriesName || 'series')}`;
    const episodeId = meta.episodeId || `stored-episode-${reelId}`;
    return {
        series: {
            id: seriesId,
            title: meta.seriesName || 'Series',
            description: meta.description,
            genre: meta.genre,
            tags: meta.tags,
            seasons: []
        },
        season: {
            seasonNumber: meta.seasonNumber || 1,
            title: `Season ${meta.seasonNumber || 1}`,
            episodes: []
        },
        episode: {
            episodeId,
            episodeNumber: meta.episodeNumber || 1,
            title: meta.episodeTitle || 'Episode',
            description: meta.description,
            runtime: meta.runtime,
            status: meta.episodeStatus || 'published',
            reelId,
            genre: meta.genre,
            tags: meta.tags
        }
    };
}

/** @param {string} value */
function slugify(value) {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

/**
 * @param {{ series: Series; season: Season; episode: Episode }} base
 * @param {ReelSeriesMetadata} stored
 */
function mergeContextWithStored(base, stored) {
    return {
        series: {
            ...base.series,
            title: stored.seriesName || base.series.title,
            genre: stored.genre ?? base.series.genre,
            releaseYear: stored.releaseYear ?? base.series.releaseYear,
            tags: stored.tags?.length ? stored.tags : base.series.tags,
            description: stored.description ?? base.series.description
        },
        season: {
            ...base.season,
            seasonNumber: stored.seasonNumber ?? base.season.seasonNumber
        },
        episode: {
            ...base.episode,
            episodeNumber: stored.episodeNumber ?? base.episode.episodeNumber,
            title: stored.episodeTitle || base.episode.title,
            description: stored.description ?? base.episode.description,
            genre: stored.genre ?? base.episode.genre,
            tags: stored.tags?.length ? stored.tags : base.episode.tags,
            runtime: stored.runtime ?? base.episode.runtime,
            status: stored.episodeStatus ?? base.episode.status
        }
    };
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {{ series: Series; season: Season; episode: Episode } | undefined}
 */
function resolveCatalogContextForReel(reel) {
    if (!reel) return undefined;

    const reelId = reel.id == null ? '' : String(reel.id);
    if (reelId) {
        const byReel = getEpisodeByReelId(reelId);
        if (byReel) return byReel;
    }

    const episodeKey = reel.episode_id || reel.episodeId;
    if (episodeKey) {
        const byEpisode = getEpisodeById(String(episodeKey));
        if (byEpisode) return byEpisode;
    }

    if (reelId) {
        const stored = getReelSeriesMetadata(reelId);
        if (stored?.episodeId) {
            const byStored = getEpisodeById(stored.episodeId);
            if (byStored) return byStored;
        }
    }

    return undefined;
}

/**
 * @param {string} seriesId
 * @returns {Series | undefined}
 */
export function getSeriesById(seriesId) {
    if (!seriesId) return undefined;
    // Demo fixtures are invisible unless an explicit demo catalog session is open.
    if (isDemoSeriesId(seriesId) && !allowDemoCatalogSession) return undefined;
    const raw = get(seriesCatalog).find((series) => series.id === seriesId);
    if (!raw) return undefined;
    return /** @type {Series} */ (applySeriesCatalogEdit(raw));
}

/**
 * @param {string} seriesId
 * @param {number} seasonNumber
 * @returns {{ series: Series; season: Season } | undefined}
 */
export function getSeasonByNumber(seriesId, seasonNumber) {
    const series = getSeriesById(seriesId);
    if (!series) return undefined;
    const season = series.seasons.find((s) => s.seasonNumber === seasonNumber);
    if (!season) return undefined;
    return {
        series,
        season: {
            ...season,
            episodes: sortEpisodesForDisplay(season.episodes || [])
        }
    };
}

/**
 * @param {string} episodeId
 * @returns {{ series: Series; season: Season; episode: Episode } | undefined}
 */
export function getEpisodeById(episodeId) {
    const id = String(episodeId || '').trim();
    if (!id) return undefined;
    for (const raw of get(seriesCatalog)) {
        const series = /** @type {Series} */ (applySeriesCatalogEdit(raw));
        for (const season of series.seasons || []) {
            const episode = (season.episodes || []).find((e) => e.episodeId === id);
            if (episode) return { series, season, episode };
        }
    }
    return undefined;
}

/**
 * Resolve episode metadata from an existing reel id (feed/theater bridge).
 * @param {string} reelId
 * @returns {{ series: Series; season: Season; episode: Episode } | undefined}
 */
export function getEpisodeByReelId(reelId) {
    if (!reelId) return undefined;
    for (const raw of get(seriesCatalog)) {
        const series = /** @type {Series} */ (applySeriesCatalogEdit(raw));
        for (const season of series.seasons || []) {
            const episode = (season.episodes || []).find((e) => e.reelId === reelId);
            if (episode) return { series, season, episode };
        }
    }
    return undefined;
}

/**
 * Catalog episode for a vault/feed id: reelId, mediaAssetId, or heroVaultAssetId.
 * Video Vault cards often use a personal-video id that is stored on the episode
 * as mediaAssetId rather than reelId (Theater's active feed reel).
 * @param {string} mediaId
 * @returns {{ series: Series; season: Season; episode: Episode } | undefined}
 */
export function getEpisodeByMediaIdentity(mediaId) {
    const want = String(mediaId || '').trim();
    if (!want) return undefined;
    const byReel = getEpisodeByReelId(want);
    if (byReel) return byReel;
    const byEpisode = getEpisodeById(want);
    if (byEpisode) return byEpisode;
    for (const raw of get(seriesCatalog)) {
        const series = /** @type {Series} */ (applySeriesCatalogEdit(raw));
        for (const season of series.seasons || []) {
            const episode = (season.episodes || []).find((e) => {
                const media = e.mediaAssetId != null ? String(e.mediaAssetId).trim() : '';
                const hero = e.heroVaultAssetId != null ? String(e.heroVaultAssetId).trim() : '';
                return media === want || hero === want;
            });
            if (episode) return { series, season, episode };
        }
    }
    return undefined;
}

/**
 * Update the catalog + studio metadata episode title for a bound reel.
 * Keeps Episodes labeling / title-match ordering in sync after vault renames.
 * @param {string} reelId
 * @param {string} nextTitle
 * @returns {{ episodeId: string; title: string } | null}
 */
export function updateEpisodeTitleForReel(reelId, nextTitle) {
    const id = String(reelId || '').trim();
    const title = String(nextTitle || '').trim();
    if (!id || !title) return null;

    const byReel = getEpisodeByReelId(id);
    const stored = getReelSeriesMetadata(id);
    const episodeId = String(byReel?.episode?.episodeId || stored?.episodeId || '').trim();

    if (!episodeId && !stored) {
        // Soft metadata stub so later attach/title-match can pick this title up.
        const saved = saveReelSeriesMetadata(
            id,
            {
                reelId: id,
                episodeTitle: title
            },
            { sourceType: 'vault', context: 'updateEpisodeTitleForReel' }
        );
        return saved
            ? { episodeId: String(saved.episodeId || ''), title }
            : null;
    }

    const saved = saveReelSeriesMetadata(
        id,
        {
            ...(stored || {}),
            reelId: id,
            episodeId: episodeId || stored?.episodeId,
            episodeTitle: title
        },
        { sourceType: 'vault', context: 'updateEpisodeTitleForReel' }
    );

    // Force catalog episode.title even if bind skipped.
    if (episodeId) {
        seriesCatalog.update((catalogItems) => {
            let changed = false;
            const next = catalogItems.map((series) => ({
                ...series,
                seasons: series.seasons.map((season) => ({
                    ...season,
                    episodes: season.episodes.map((episode) => {
                        if (episode.episodeId !== episodeId && episode.reelId !== id) {
                            return episode;
                        }
                        changed = true;
                        return { ...episode, title };
                    })
                }))
            }));
            return changed ? next : catalogItems;
        });
    }

    console.info('[EPISODE_TITLE_UPDATE]', {
        reelId: id,
        episodeId: episodeId || null,
        title,
        ts: new Date().toISOString()
    });

    return { episodeId: episodeId || String(saved?.episodeId || ''), title };
}

/**
 * Sync reel-level metadata map from current catalog episode (no media rebinding logic).
 * Routes through fail-closed save with binding provenance (mirrors existing catalog truth).
 * @param {{ series: Series; season: Season; episode: Episode }} ctx
 */
function syncReelMetadataFromCatalogEpisode(ctx) {
    const reelId = ctx?.episode?.reelId ? String(ctx.episode.reelId).trim() : '';
    if (!reelId) return null;

    return saveReelSeriesMetadata(
        reelId,
        {
            reelId,
            episodeId: ctx.episode.episodeId,
            seriesId: ctx.series.id,
            seriesName: ctx.series.title,
            seasonNumber: ctx.season.seasonNumber,
            episodeNumber: ctx.episode.episodeNumber,
            episodeTitle: ctx.episode.title,
            description: ctx.episode.description,
            episodeStatus: ctx.episode.status,
            genre: ctx.episode.genre ?? ctx.series.genre,
            tags: ctx.episode.tags ?? ctx.series.tags,
            runtime: ctx.episode.runtime
        },
        {
            sourceType: 'binding',
            context: 'syncReelMetadataFromCatalogEpisode',
            skipEpisodeBind: true
        }
    );
}

/**
 * Episode-id primary catalog patch (Creator Catalog Control).
 * Updates title / description / status only; preserves episodeId, reelId, season membership.
 *
 * @param {string} episodeId
 * @param {{ title?: string; description?: string; status?: import('./seriesTypes.js').EpisodeStatus; thumbnailUrl?: string }} patch
 * @returns {{ series: Series; season: Season; episode: Episode } | null}
 */
export function updateCatalogEpisode(episodeId, patch = {}) {
    const id = String(episodeId || '').trim();
    if (!id || !patch || typeof patch !== 'object') return null;

    const existing = getEpisodeById(id);
    if (!existing) return null;

    /** @type {Partial<Episode>} */
    const fields = {};
    if ('title' in patch) {
        const title = String(patch.title ?? '').trim();
        if (!title) return null;
        fields.title = title;
    }
    if ('description' in patch) {
        fields.description = String(patch.description ?? '');
    }
    if ('status' in patch) {
        if (!isEpisodeStatus(patch.status)) return null;
        fields.status = /** @type {import('./seriesTypes.js').EpisodeStatus} */ (patch.status);
        if (fields.status === 'published') {
            fields.publishedAt = new Date().toISOString();
        }
    }
    if ('thumbnailUrl' in patch) {
        const thumbnailUrl = String(patch.thumbnailUrl ?? '').trim();
        if (!thumbnailUrl) return null;
        fields.thumbnailUrl = thumbnailUrl;
    }
    if (Object.keys(fields).length === 0) {
        return existing;
    }

    let applied = false;
    seriesCatalog.update((catalogItems) => {
        const next = catalogItems.map((series) => ({
            ...series,
            seasons: series.seasons.map((season) => ({
                ...season,
                episodes: season.episodes.map((episode) => {
                    if (episode.episodeId !== id) return episode;
                    applied = true;
                    return {
                        ...episode,
                        ...fields,
                        // Hard preserve identity + media link
                        episodeId: episode.episodeId,
                        reelId: episode.reelId
                    };
                })
            }))
        }));
        return applied ? next : catalogItems;
    });

    if (!applied) return null;

    const updated = getEpisodeById(id);
    if (!updated) return null;

    // Durable creator authority — survives API hydrate + vault rebind
    /** @type {import('./seriesCatalogEdits.js').EpisodeCatalogEdit} */
    const durable = {};
    if (fields.status) durable.status = fields.status;
    if (fields.title) durable.title = fields.title;
    if ('description' in fields) durable.description = fields.description;
    if (fields.thumbnailUrl) durable.thumbnailUrl = fields.thumbnailUrl;
    if (Object.keys(durable).length) {
        upsertEpisodeCatalogEdit(updated.series.id, id, durable);
    }

    if (updated.episode.reelId) {
        syncReelMetadataFromCatalogEpisode(updated);
    }

    console.info('[CATALOG_EPISODE_UPDATE]', {
        episodeId: id,
        seriesId: updated.series.id,
        seasonNumber: updated.season.seasonNumber,
        reelId: updated.episode.reelId || null,
        fields: Object.keys(fields),
        ts: new Date().toISOString()
    });

    return updated;
}

/**
 * Assign a Thumbnail Vault poster URL to a canonical episode and persist via API.
 * Preserves episodeId and reelId; writes editorial thumbnailUrl only.
 *
 * @param {string} episodeId
 * @param {string} thumbnailUrl
 * @param {{ source?: 'thumbnail-vault' | 'mp4-still' }} [options]
 */
export async function assignEpisodePoster(episodeId, thumbnailUrl, options = {}) {
    const eid = String(episodeId || '').trim();
    const url = String(thumbnailUrl || '').trim();
    if (!eid || !url) {
        return { ok: false, reason: 'missing-episode-or-poster-url' };
    }

    const before = getEpisodeById(eid);
    if (!before?.episode) {
        return { ok: false, reason: 'episode-not-found' };
    }

    const updated = updateCatalogEpisode(eid, { thumbnailUrl: url });
    if (!updated?.episode) {
        return { ok: false, reason: 'catalog-update-failed' };
    }

    if (options.source === 'thumbnail-vault' || options.source === 'mp4-still') {
        upsertEpisodeCatalogEdit(updated.series.id, eid, { posterAssignSource: options.source });
    }

    const persist = await persistEpisodeRowToApi(eid);
    if (!persist.ok) {
        console.warn('[EPISODE_POSTER_ASSIGN]', {
            episodeId: eid,
            thumbnailUrl: url,
            reason: persist.reason || 'api-save-failed',
            localCatalogUpdated: true,
            ts: new Date().toISOString()
        });
        if (options.source === 'thumbnail-vault' || options.source === 'mp4-still') {
            cacheSeriesCatalogOffline(get(seriesCatalog), get(reelSeriesMetadata));
            return {
                ok: true,
                localOnly: true,
                warning: persist.reason || 'api-save-failed',
                episodeId: eid,
                reelId: before.episode.reelId || null,
                thumbnailUrl: updated.episode.thumbnailUrl || url
            };
        }
        return { ok: false, reason: persist.reason || 'api-save-failed' };
    }

    console.info('[EPISODE_POSTER_ASSIGN]', {
        episodeId: eid,
        seriesId: updated.series.id,
        seasonNumber: updated.season.seasonNumber,
        reelId: updated.episode.reelId || null,
        thumbnailUrl: updated.episode.thumbnailUrl || url,
        ts: new Date().toISOString()
    });

    return {
        ok: true,
        episodeId: eid,
        reelId: before.episode.reelId || null,
        thumbnailUrl: updated.episode.thumbnailUrl || url
    };
}

/**
 * @param {string} episodeId
 * @param {import('./seriesTypes.js').EpisodeStatus} status
 * @returns {{ series: Series; season: Season; episode: Episode } | null}
 */
export function setEpisodeStatus(episodeId, status) {
    return updateCatalogEpisode(episodeId, { status });
}

/**
 * Manually bind an episode to a ready Hero Vault asset id (reference only — no upload).
 * Persists heroVaultAssetId / mediaAssetId / heroVaultBindingMode for reload.
 * @param {{ episodeId: string; assetId: string }} input
 * @returns {{ series: Series; season: Season; episode: Episode } | null}
 */
export function setEpisodeVaultBinding({ episodeId, assetId } = {}) {
    const id = String(episodeId || '').trim();
    const vaultId = String(assetId || '').trim();
    if (!id || !vaultId) return null;

    const existing = getEpisodeById(id);
    if (!existing) return null;

    let applied = false;
    seriesCatalog.update((catalogItems) => {
        const next = catalogItems.map((series) => ({
            ...series,
            seasons: series.seasons.map((season) => ({
                ...season,
                episodes: season.episodes.map((episode) => {
                    if (episode.episodeId !== id) return episode;
                    applied = true;
                    return {
                        ...episode,
                        heroVaultAssetId: vaultId,
                        heroVaultBindingMode: /** @type {'manual'} */ ('manual'),
                        mediaAssetId: vaultId,
                        episodeId: episode.episodeId,
                        reelId: episode.reelId
                    };
                })
            }))
        }));
        return applied ? next : catalogItems;
    });

    if (!applied) return null;

    upsertStoredEpisodeVaultBinding(id, {
        heroVaultAssetId: vaultId,
        mediaAssetId: vaultId,
        heroVaultBindingMode: 'manual'
    });

    const updated = getEpisodeById(id);
    console.info('[EPISODE_VAULT_BINDING_SET]', {
        episodeId: id,
        assetId: vaultId,
        seriesId: updated?.series?.id || null,
        persisted: true,
        ts: new Date().toISOString()
    });
    return updated;
}

/**
 * Clear manual Hero Vault binding; episode returns to automatic keyword resolve.
 * Clears persisted mediaAssetId so presentation cannot keep a stale id.
 * @param {{ episodeId: string }} input
 * @returns {{ series: Series; season: Season; episode: Episode } | null}
 */
export function clearEpisodeVaultBinding({ episodeId } = {}) {
    const id = String(episodeId || '').trim();
    if (!id) return null;

    const existing = getEpisodeById(id);
    if (!existing) return null;

    let applied = false;
    seriesCatalog.update((catalogItems) => {
        const next = catalogItems.map((series) => ({
            ...series,
            seasons: series.seasons.map((season) => ({
                ...season,
                episodes: season.episodes.map((episode) => {
                    if (episode.episodeId !== id) return episode;
                    applied = true;
                    return {
                        ...episode,
                        heroVaultAssetId: null,
                        mediaAssetId: null,
                        heroVaultBindingMode: /** @type {'auto'} */ ('auto'),
                        episodeId: episode.episodeId,
                        reelId: episode.reelId
                    };
                })
            }))
        }));
        return applied ? next : catalogItems;
    });

    if (!applied) return null;

    clearStoredEpisodeVaultBinding(id);

    const updated = getEpisodeById(id);
    console.info('[EPISODE_VAULT_BINDING_CLEAR]', {
        episodeId: id,
        seriesId: updated?.series?.id || null,
        persisted: true,
        ts: new Date().toISOString()
    });
    return updated;
}

/**
 * Reorder episodes within a single season.
 * Preserves episodeId, reelId, and episodeNumber labels; stamps displayOrder 0..n-1.
 * Order persists via series catalog edits (and reel meta when bound).
 *
 * @param {string} seriesId
 * @param {number} seasonNumber
 * @param {string[]} orderedEpisodeIds
 * @returns {boolean}
 */
export function reorderEpisodesInSeason(seriesId, seasonNumber, orderedEpisodeIds) {
    const sid = String(seriesId || '').trim();
    const sn = Number(seasonNumber);
    if (!sid || !Number.isFinite(sn) || sn < 1) return false;
    if (!Array.isArray(orderedEpisodeIds) || orderedEpisodeIds.length === 0) return false;

    const hit = getSeasonByNumber(sid, sn);
    // Read raw season lengths (edits apply may re-sort)
    const raw = get(seriesCatalog).find((s) => s.id === sid);
    const rawSeason = raw?.seasons?.find((s) => s.seasonNumber === sn);
    if (!hit || !rawSeason) return false;

    const byId = new Map(rawSeason.episodes.map((ep) => [ep.episodeId, ep]));
    const ordered = orderedEpisodeIds.map((id) => String(id || '').trim()).filter(Boolean);

    if (ordered.length !== rawSeason.episodes.length) return false;
    if (new Set(ordered).size !== ordered.length) return false;
    for (const epId of ordered) {
        if (!byId.has(epId)) return false;
    }

    /** @type {Episode[]} */
    const reordered = ordered.map((epId, index) => {
        const prev = byId.get(epId);
        return {
            ...prev,
            episodeId: prev.episodeId,
            reelId: prev.reelId,
            episodeNumber: prev.episodeNumber, // preserve creator / vault labels
            displayOrder: index
        };
    });

    let applied = false;
    seriesCatalog.update((catalogItems) => {
        const next = catalogItems.map((series) => {
            if (series.id !== sid) return series;
            return {
                ...series,
                seasons: series.seasons.map((s) => {
                    if (s.seasonNumber !== sn) return s;
                    applied = true;
                    return { ...s, episodes: reordered };
                })
            };
        });
        return applied ? next : catalogItems;
    });

    if (!applied) return false;

    // Durable order for reload + viewer parity
    upsertSeasonCatalogEdit(sid, sn, { episodeOrder: ordered });
    ordered.forEach((epId, index) => {
        upsertEpisodeCatalogEdit(sid, epId, { displayOrder: index });
    });

    for (const episode of reordered) {
        if (!episode.reelId) continue;
        const ctx = getEpisodeById(episode.episodeId);
        if (ctx) syncReelMetadataFromCatalogEpisode(ctx);
    }

    console.info('[CATALOG_EPISODE_REORDER]', {
        seriesId: sid,
        seasonNumber: sn,
        orderedEpisodeIds: ordered,
        preserveEpisodeNumbers: true,
        ts: new Date().toISOString()
    });

    return true;
}

/**
 * Patch series-level metadata (title, description, poster, genre, tags).
 * @param {string} seriesId
 * @param {{ title?: string; description?: string; poster?: string; genre?: string; tags?: string[] }} patch
 * @returns {Series | null}
 */
export function updateCatalogSeries(seriesId, patch = {}) {
    const sid = String(seriesId || '').trim();
    if (!sid || !patch || typeof patch !== 'object') return null;
    const existing = get(seriesCatalog).find((s) => s.id === sid);
    if (!existing) return null;

    /** @type {Partial<Series>} */
    const fields = {};
    if ('title' in patch) {
        const title = String(patch.title ?? '').trim();
        if (!title) return null;
        fields.title = title;
    }
    if ('description' in patch) fields.description = String(patch.description ?? '');
    if ('poster' in patch) fields.poster = String(patch.poster ?? '').trim();
    if ('genre' in patch) fields.genre = String(patch.genre ?? '').trim();
    if ('tags' in patch) fields.tags = normalizeTags(patch.tags);

    if (Object.keys(fields).length === 0) return getSeriesById(sid) || null;

    seriesCatalog.update((items) =>
        items.map((s) => (s.id === sid ? { ...s, ...fields } : s))
    );

    upsertSeriesCatalogEdit(sid, {
        title: fields.title,
        description: fields.description,
        poster: fields.poster,
        genre: fields.genre,
        tags: fields.tags
    });

    console.info('[CATALOG_SERIES_UPDATE]', {
        seriesId: sid,
        fields: Object.keys(fields),
        ts: new Date().toISOString()
    });
    return getSeriesById(sid) || null;
}

/**
 * Persist canonical series-row metadata to the Series API (no seasons / episodes).
 * Creator Catalog series Save promotion boundary — does not touch reel bindings.
 *
 * @param {string} seriesId
 * @returns {Promise<{ ok: boolean; reason?: string; error?: string }>}
 */
/**
 * Create a canonical Series from Studio "+ Add series" (POST /api/series).
 * Does not write to studio_series — catalog hydration is the downstream authority.
 *
 * @param {string} title
 * @returns {Promise<{ ok: boolean; reason?: string; error?: string; seriesId?: string; title?: string; series?: import('./seriesTypes.js').Series }>}
 */
export async function createCatalogSeriesFromStudio(title) {
    const trimmed = String(title || '').trim();
    if (!trimmed) {
        return { ok: false, reason: 'empty-title' };
    }

    try {
        const available = await isSeriesApiAvailable();
        if (!available) {
            logSeriesApiWrite({ source: 'fallback', reason: 'api-unavailable', phase: 'studio-create' });
            return { ok: false, reason: 'api-unavailable' };
        }
        if (!getAdminToken()) {
            logSeriesApiWrite({ source: 'fallback', reason: 'missing_authorization', phase: 'studio-create' });
            return { ok: false, reason: 'missing_authorization' };
        }

        const payload = seriesCreatePayloadFromStudioTitle(trimmed);
        const created = await createSeries(payload);
        if (created?.disabled) {
            return { ok: false, reason: created.error || 'api-disabled' };
        }

        const catalogSeries = apiSeriesToCatalog(/** @type {Record<string, unknown>} */ (created));
        if (!catalogSeries?.id) {
            return { ok: false, reason: 'invalid-api-response' };
        }

        seriesCatalog.update((items) => {
            const rest = items.filter((s) => s.id !== catalogSeries.id);
            return [...rest, catalogSeries];
        });
        seriesPersistenceMode.set('api');
        cacheSeriesCatalogOffline(get(seriesCatalog), get(reelSeriesMetadata));
        logSeriesApiWrite({
            seriesId: catalogSeries.id,
            source: 'studio-series-create',
            seasonCount: catalogSeries.seasons?.length || 0
        });

        return {
            ok: true,
            seriesId: catalogSeries.id,
            title: catalogSeries.title,
            series: getSeriesById(catalogSeries.id) || catalogSeries
        };
    } catch (err) {
        const message = String(err?.message || err || 'api-create-failed');
        logSeriesApiWrite({ source: 'fallback', reason: message, phase: 'studio-create' });
        return { ok: false, reason: 'api-create-failed', error: message };
    }
}

export async function persistSeriesRowToApi(seriesId) {
    const sid = String(seriesId || '').trim();
    if (!sid) {
        return { ok: false, reason: 'missing-series-id' };
    }

    try {
        const available = await isSeriesApiAvailable();
        if (!available) {
            logSeriesApiWrite({ source: 'fallback', seriesId: sid, reason: 'api-unavailable' });
            return { ok: false, reason: 'api-unavailable' };
        }
        if (!getAdminToken()) {
            logSeriesApiWrite({ source: 'fallback', seriesId: sid, reason: 'missing_authorization' });
            return { ok: false, reason: 'missing_authorization' };
        }

        const series = getSeriesById(sid);
        if (!series) {
            return { ok: false, reason: 'series-not-found' };
        }

        const payload = seriesToApiRowPayload(series);
        if (!String(payload.title || '').trim()) {
            return { ok: false, reason: 'empty-title' };
        }

        await updateSeries(sid, payload);
        seriesPersistenceMode.set('api');
        cacheSeriesCatalogOffline(get(seriesCatalog), get(reelSeriesMetadata));
        logSeriesApiWrite({ seriesId: sid, source: 'series-row-save' });
        return { ok: true };
    } catch (err) {
        const message = String(err?.message || err || 'api-save-failed');
        logSeriesApiWrite({ source: 'fallback', seriesId: sid, reason: message });
        return { ok: false, reason: 'api-save-failed', error: message };
    }
}

export async function persistEpisodeRowToApi(episodeId, options = {}) {
    const eid = String(episodeId || '').trim();
    if (!eid) {
        return { ok: false, reason: 'missing-episode-id' };
    }

    const applyCatalogStatus = options.applyCatalogStatus
        ? String(options.applyCatalogStatus).trim()
        : '';

    try {
        const available = await isSeriesApiAvailable();
        if (!available) {
            logSeriesApiWrite({ source: 'fallback', episodeId: eid, reason: 'api-unavailable' });
            return { ok: false, reason: 'api-unavailable' };
        }
        if (!getAdminToken()) {
            logSeriesApiWrite({ source: 'fallback', episodeId: eid, reason: 'missing_authorization' });
            return { ok: false, reason: 'missing_authorization' };
        }

        const ctx = getEpisodeById(eid);
        if (!ctx) {
            return { ok: false, reason: 'episode-not-found' };
        }

        const payload = episodeToApiRowPayload(ctx);
        if (applyCatalogStatus) {
            payload.status = applyCatalogStatus;
        }
        if (!String(payload.title || '').trim()) {
            return { ok: false, reason: 'empty-title' };
        }

        let result = await updateEpisode(eid, payload);
        if (result?.disabled && String(result.error || '').toLowerCase().includes('episode not found')) {
            const createBody = episodeToApiCreatePayload(ctx);
            if (!createBody) {
                return { ok: false, reason: 'invalid-create-payload' };
            }
            if (applyCatalogStatus) {
                createBody.status = applyCatalogStatus;
            }
            result = await createEpisode(createBody);
        }
        if (result?.disabled) {
            return { ok: false, reason: result.error || 'api-disabled' };
        }

        if (applyCatalogStatus) {
            updateCatalogEpisode(eid, { status: /** @type {import('./seriesTypes.js').EpisodeStatus} */ (applyCatalogStatus) });
        }

        seriesPersistenceMode.set('api');
        cacheSeriesCatalogOffline(get(seriesCatalog), get(reelSeriesMetadata));
        logSeriesApiWrite({ episodeId: eid, source: 'episode-row-save' });
        return { ok: true };
    } catch (err) {
        const message = String(err?.message || err || 'api-save-failed');
        logSeriesApiWrite({ source: 'fallback', episodeId: eid, reason: message });
        return { ok: false, reason: 'api-save-failed', error: message };
    }
}

/**
 * Persist creator-authored episode row including durable reel binding.
 * Catalog → API boundary for vault materialization (series shell persisted separately).
 *
 * @param {string} episodeId
 */
export async function persistCreatorAuthoredEpisodeRowToApi(episodeId) {
    const eid = String(episodeId || '').trim();
    if (!eid) {
        return { ok: false, reason: 'missing-episode-id' };
    }

    try {
        const available = await isSeriesApiAvailable();
        if (!available) {
            logSeriesApiWrite({ source: 'fallback', episodeId: eid, reason: 'api-unavailable' });
            return { ok: false, reason: 'api-unavailable' };
        }
        if (!getAdminToken()) {
            logSeriesApiWrite({ source: 'fallback', episodeId: eid, reason: 'missing_authorization' });
            return { ok: false, reason: 'missing_authorization' };
        }

        const ctx = getEpisodeById(eid);
        if (!ctx?.episode?.episodeId) {
            return { ok: false, reason: 'episode-not-found' };
        }

        const payload = episodeToApiRowPayload(ctx);
        const reelId = String(ctx.episode.reelId || ctx.episode.mediaAssetId || '').trim();
        if (reelId) {
            payload.reelId = reelId;
        }
        if (!String(payload.title || '').trim()) {
            return { ok: false, reason: 'empty-title' };
        }

        let result = await updateEpisode(eid, payload);
        if (result?.disabled && String(result.error || '').toLowerCase().includes('episode not found')) {
            const createBody = episodeToApiCreatePayload(ctx);
            if (!createBody) {
                return { ok: false, reason: 'invalid-create-payload' };
            }
            result = await createEpisode(createBody);
        }
        if (result?.disabled) {
            return { ok: false, reason: result.error || 'api-disabled' };
        }

        seriesPersistenceMode.set('api');
        cacheSeriesCatalogOffline(get(seriesCatalog), get(reelSeriesMetadata));
        logSeriesApiWrite({ episodeId: eid, source: 'creator-authored-episode-persist', reelId: reelId || null });
        return { ok: true, episodeId: eid, reelId: reelId || null };
    } catch (err) {
        const message = String(err?.message || err || 'api-save-failed');
        logSeriesApiWrite({ source: 'fallback', episodeId: eid, reason: message });
        return { ok: false, reason: 'api-save-failed', error: message };
    }
}

/**
 * Persist an authored series shell to the Series API (PUT with POST create fallback).
 * Creates season scaffolding only — episodes are persisted separately.
 *
 * @param {string} seriesId
 */
export async function persistAuthoredSeriesToApi(seriesId) {
    const sid = String(seriesId || '').trim();
    if (!sid) {
        return { ok: false, reason: 'missing-series-id' };
    }

    try {
        const available = await isSeriesApiAvailable();
        if (!available) {
            logSeriesApiWrite({ source: 'fallback', seriesId: sid, reason: 'api-unavailable' });
            return { ok: false, reason: 'api-unavailable' };
        }
        if (!getAdminToken()) {
            logSeriesApiWrite({ source: 'fallback', seriesId: sid, reason: 'missing_authorization' });
            return { ok: false, reason: 'missing_authorization' };
        }

        const series = getSeriesById(sid);
        if (!series) {
            return { ok: false, reason: 'series-not-found' };
        }

        const rowPayload = seriesToApiRowPayload(series);
        if (!String(rowPayload.title || '').trim()) {
            return { ok: false, reason: 'empty-title' };
        }

        let result = await updateSeries(sid, rowPayload);
        if (result?.disabled && String(result.error || '').toLowerCase().includes('not found')) {
            /** @type {Record<string, unknown>} */
            const createPayload = {
                ...rowPayload,
                seasons: (series.seasons || []).map((season) => ({
                    seasonId: season.seasonId || `season-${sid}-${season.seasonNumber}`,
                    seasonNumber: season.seasonNumber,
                    title: season.title,
                    description: season.description,
                    episodes: []
                }))
            };
            result = await createSeries(createPayload);
            if (result?.disabled) {
                return { ok: false, reason: result.error || 'api-disabled' };
            }
            const catalogSeries = apiSeriesToCatalog(/** @type {Record<string, unknown>} */ (result));
            if (catalogSeries?.id) {
                seriesCatalog.update((items) => {
                    const rest = items.filter((s) => s.id !== catalogSeries.id);
                    const local = getSeriesById(sid);
                    return [...rest, local || catalogSeries];
                });
            }
        }

        seriesPersistenceMode.set('api');
        cacheSeriesCatalogOffline(get(seriesCatalog), get(reelSeriesMetadata));
        logSeriesApiWrite({ seriesId: sid, source: 'authored-series-persist' });
        return { ok: true, seriesId: sid };
    } catch (err) {
        const message = String(err?.message || err || 'api-save-failed');
        logSeriesApiWrite({ source: 'fallback', seriesId: sid, reason: message });
        return { ok: false, reason: 'api-save-failed', error: message };
    }
}

/**
 * Vault → Catalog → API: materialize creator-confirmed production and persist durably.
 *
 * Ordering: identity materialization → series shell → episode + reel binding.
 * Does not transition publication status — callers publish only after this succeeds.
 *
 * @param {Record<string, unknown> | null | undefined} vaultAsset
 */
export async function persistCreatorAuthoredCatalogProduction(vaultAsset) {
    const { materializeCreatorAuthoredCatalogProduction } = await import('./authoredCatalogMaterialization.js');
    const materialized = materializeCreatorAuthoredCatalogProduction(vaultAsset);
    if (!materialized.ok) {
        return materialized;
    }

    const ctx = materialized.ctx;
    if (!ctx?.series?.id || !ctx?.episode?.episodeId) {
        return { ok: false, reason: 'episode-materialization-failed' };
    }

    const seriesPersist = await persistAuthoredSeriesToApi(ctx.series.id);
    if (!seriesPersist.ok) {
        return seriesPersist;
    }

    const episodePersist = await persistCreatorAuthoredEpisodeRowToApi(ctx.episode.episodeId);
    if (!episodePersist.ok) {
        return episodePersist;
    }

    return {
        ok: true,
        ctx: getEpisodeById(ctx.episode.episodeId) || ctx,
        mediaAssetId: materialized.mediaAssetId,
        seriesId: ctx.series.id,
        episodeId: ctx.episode.episodeId,
        reelId: episodePersist.reelId || String(ctx.episode.reelId || materialized.mediaAssetId || '').trim() || null
    };
}

/**
 * Bind a vault asset into the catalog (when possible), patch episode fields, persist row to API.
 *
 * @param {string} mediaAssetId
 * @param {{ title?: string; description?: string; status?: import('./seriesTypes.js').EpisodeStatus }} [patch]
 * @param {Record<string, unknown> | null} [vaultAsset]
 */
export async function persistVaultEditsToCanonicalEpisode(mediaAssetId, patch = {}, vaultAsset = null) {
    const id = String(mediaAssetId || '').trim();
    if (!id) {
        return { ok: false, reason: 'missing-media-asset-id' };
    }

    const asset =
        vaultAsset && typeof vaultAsset === 'object'
            ? { ...vaultAsset, id: String(vaultAsset.id || id).trim() || id }
            : { id };
    inferAndBindVaultSeries([asset], { source: 'vault-canonical-episode-save' });

    const ctx = getEpisodeByReelId(id);
    if (!ctx?.episode?.episodeId) {
        return { ok: false, reason: 'no-catalog-episode' };
    }

    if (patch && typeof patch === 'object' && Object.keys(patch).length) {
        updateCatalogEpisode(ctx.episode.episodeId, patch);
    }

    return persistEpisodeRowToApi(ctx.episode.episodeId);
}

/**
 * Patch season-level metadata (name, description, artwork). Not filename-derived.
 * @param {string} seriesId
 * @param {number} seasonNumber
 * @param {{ title?: string; description?: string; poster?: string }} patch
 * @returns {{ series: Series; season: Season } | null}
 */
export function updateCatalogSeason(seriesId, seasonNumber, patch = {}) {
    const sid = String(seriesId || '').trim();
    const sn = Number(seasonNumber);
    if (!sid || !Number.isFinite(sn) || sn < 1 || !patch || typeof patch !== 'object') return null;

    /** @type {Record<string, string>} */
    const fields = {};
    if ('title' in patch) fields.title = String(patch.title ?? '').trim();
    if ('description' in patch) fields.description = String(patch.description ?? '');
    if ('poster' in patch) fields.poster = String(patch.poster ?? '').trim();
    if (Object.keys(fields).length === 0) return getSeasonByNumber(sid, sn) || null;

    let applied = false;
    seriesCatalog.update((items) =>
        items.map((series) => {
            if (series.id !== sid) return series;
            return {
                ...series,
                seasons: series.seasons.map((season) => {
                    if (season.seasonNumber !== sn) return season;
                    applied = true;
                    return { ...season, ...fields };
                })
            };
        })
    );
    if (!applied) return null;

    upsertSeasonCatalogEdit(sid, sn, fields);

    console.info('[CATALOG_SEASON_UPDATE]', {
        seriesId: sid,
        seasonNumber: sn,
        fields: Object.keys(fields),
        ts: new Date().toISOString()
    });
    return getSeasonByNumber(sid, sn) || null;
}

/**
 * Next *playable* episode in series order (skips draft/archived / missing reel).
 * Uses the same episodeIsPlayable predicate as resolveReelForEpisode.
 * @param {string} episodeId
 * @returns {{ series: Series; season: Season; episode: Episode } | undefined}
 */
export function getNextEpisode(episodeId) {
    const current = getEpisodeById(episodeId);
    if (!current) return undefined;

    const { series, season, episode } = current;
    const seasons = [...series.seasons].sort((a, b) => a.seasonNumber - b.seasonNumber);
    const seasonIdx = seasons.findIndex((s) => s.seasonNumber === season.seasonNumber);
    if (seasonIdx < 0) return undefined;

    for (let si = seasonIdx; si < seasons.length; si += 1) {
        const s = seasons[si];
        const sorted = [...s.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
        const startIdx =
            si === seasonIdx
                ? sorted.findIndex((e) => e.episodeId === episode.episodeId) + 1
                : 0;
        if (startIdx < 0) continue;
        for (let ei = startIdx; ei < sorted.length; ei += 1) {
            const candidate = sorted[ei];
            if (episodeIsPlayable(candidate)) {
                return { series, season: s, episode: candidate };
            }
        }
    }

    return undefined;
}

/**
 * @param {string} seriesId
 * @returns {Episode[]}
 */
export function getPublishedEpisodesForSeries(seriesId) {
    const series = getSeriesById(seriesId);
    if (!series) return [];
    return series.seasons
        .flatMap((season) => season.episodes)
        .filter((episode) => episodeIsViewerDiscoverable(episode) && episodeIsPlayable(episode));
}

/**
 * Resolve series metadata for a theater reel (localStorage + catalog + bridge).
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {{ series: Series; season: Season; episode: Episode } | undefined}
 */
export function resolveSeriesContextForReel(reel) {
    if (!reel) return undefined;

    const reelId = reel.id == null ? '' : String(reel.id);
    let stored = reelId ? getReelSeriesMetadata(reelId) : null;
    const catalogCtx = resolveCatalogContextForReel(reel);

    if (!stored && catalogCtx?.episode?.reelId) {
        stored = getReelSeriesMetadata(catalogCtx.episode.reelId);
    }

    let ctx;
    if (stored && catalogCtx) ctx = mergeContextWithStored(catalogCtx, stored);
    else if (stored) ctx = buildContextFromStoredMetadata(reelId, stored);
    else ctx = catalogCtx;

    if (ctx && reelId) {
        // Bound episode display title follows the linked reel's canonical title.
        // Episode package fields stay for structure; title is media-projection when reel-bound.
        const displayTitle = resolveLinkedAssetDisplayTitle(reelId, {
            episodeTitle: ctx.episode?.title || stored?.episodeTitle || '',
            assetTitle: String(reel?.title || reel?.name || ''),
            fileName: String(reel?.fileName || reel?.file_name || '')
        });
        const nextEpisodeTitle =
            displayTitle && displayTitle !== UNTITLED_CREATOR_EXPERIENCE
                ? displayTitle
                : String(ctx.episode?.title || '').trim();
        ctx = {
            ...ctx,
            episode: {
                ...ctx.episode,
                reelId,
                title: nextEpisodeTitle || ctx.episode.title
            }
        };
    }
    return ctx;
}

/**
 * Build editable draft from reel context (catalog, bridge, or stored).
 * @param {string} reelId
 * @returns {ReelSeriesMetadata}
 */
export function buildMetadataDraftForReel(reelId) {
    const stored = getReelSeriesMetadata(reelId);
    const ctx = resolveSeriesContextForReel({ id: reelId });
    return {
        reelId,
        seriesName: stored?.seriesName ?? ctx?.series.title ?? '',
        seasonNumber: stored?.seasonNumber ?? ctx?.season.seasonNumber ?? 1,
        episodeNumber: stored?.episodeNumber ?? ctx?.episode.episodeNumber ?? 1,
        episodeTitle: stored?.episodeTitle ?? ctx?.episode.title ?? '',
        description: stored?.description ?? ctx?.episode.description ?? ctx?.series.description ?? '',
        genre: stored?.genre ?? ctx?.series.genre ?? ctx?.episode.genre ?? '',
        tags: stored?.tags ?? ctx?.episode.tags ?? ctx?.series.tags ?? [],
        runtime: stored?.runtime ?? ctx?.episode.runtime,
        releaseYear: stored?.releaseYear ?? ctx?.series.releaseYear,
        episodeStatus: stored?.episodeStatus ?? ctx?.episode.status,
        episodeId: stored?.episodeId ?? ctx?.episode.episodeId,
        seriesId: stored?.seriesId ?? ctx?.series.id,
        accessMode: stored?.accessMode || 'free',
        price: stored?.price || ''
    };
}

/**
 * Load demo fixture catalog (tests / explicit demos ONLY).
 * Production hydration never calls this.
 *
 * mockSeriesData is loaded only here via import.meta.glob — not as a module-level
 * `import` used by creator-truth hydration.
 */
export function resetSeriesCatalogToMock() {
    allowDemoCatalogSession = true;
    /** @type {Series[]} */
    let demo = [];
    try {
        // Eager glob keeps reset sync (validators). Only this opt-in path touches mocks.
        const modules = import.meta.glob('./mockSeriesData.js', { eager: true });
        const mod = /** @type {{ MOCK_SERIES_CATALOG?: Series[] } | undefined} */ (
            modules['./mockSeriesData.js']
        );
        demo = (mod?.MOCK_SERIES_CATALOG || []).filter(isSeries);
    } catch (err) {
        console.warn('[seriesStore] demo catalog unavailable', err);
        demo = [];
    }
    seriesCatalog.set(
        typeof structuredClone === 'function'
            ? structuredClone(demo)
            : /** @type {Series[]} */ (JSON.parse(JSON.stringify(demo)))
    );
    reelSeriesMetadata.set({});
    persistReelSeriesMetadataMap({});
    rehydrateEpisodeVaultBindings();
}

/** Clear catalog to empty creator-truth baseline. */
export function resetSeriesCatalogEmpty() {
    allowDemoCatalogSession = false;
    seriesCatalog.set([]);
    reelSeriesMetadata.set({});
    persistReelSeriesMetadataMap({});
}

/** @returns {boolean} */
export function isDemoCatalogSessionActive() {
    return allowDemoCatalogSession;
}

export { normalizeTags };
