import { writable, derived, get } from 'svelte/store';
import {
    episodeIsPlayable,
    isEpisodeStatus,
    isSeries
} from './seriesTypes.js';
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
    seriesToApiPayload,
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
    stripDemoSeriesFromCatalog
} from './seriesCatalogTruth.js';
import {
    guardIntelligenceMetadataWrite,
    PROVENANCE_SOURCE_TYPES
} from '../architecture/intelligenceProvenance.js';

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

/** @type {'local' | 'api' | 'migrating'} */
export const seriesPersistenceMode = writable('local');

/** @returns {Promise<boolean>} */
async function isSeriesApiAvailable() {
    const status = await fetchSeriesApiStatus();
    return !status.disabled && status.enabled !== false;
}

/**
 * @param {import('./seriesTypes.js').Series[]} catalogItems
 * @param {Record<string, ReelSeriesMetadata>} map
 */
function applyApiCatalogState(catalogItems, map) {
    // API rows may still contain previously migrated demo series — strip always.
    const clean = stripDemoSeriesFromCatalog(catalogItems);
    const cleanMap = stripDemoReelMetadata(map);
    seriesCatalog.set(clean);
    reelSeriesMetadata.set(cleanMap);
    applyAllMetadataToCatalog(cleanMap);
    // API replace is authoritative for studio rows, but must not erase vault-inferred
    // series needed for public /series/:slug cold loads (Hero Vault is source of truth).
    rebindVaultInferredSeries('after-api-catalog');
    rehydrateEpisodeVaultBindings();
    seriesPersistenceMode.set('api');
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
        if (!ready.length) return;
        inferAndBindVaultSeries(ready, { source: source || 'after-catalog-replace' });
    } catch (err) {
        console.warn('[seriesStore] vault rebind after catalog replace failed', err);
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

/** Load series catalog from API when available; fallback to localStorage. */
async function hydrateSeriesFromApi() {
    try {
        const available = await isSeriesApiAvailable();
        if (!available) {
            logSeriesApiRead({ source: 'fallback', reason: 'api-unavailable' });
            seriesPersistenceMode.set('local');
            return;
        }

        const response = await fetchAllSeries();
        if (response?.disabled) {
            logSeriesApiRead({ source: 'fallback', reason: response.error || 'api-disabled' });
            seriesPersistenceMode.set('local');
            return;
        }

        if (Array.isArray(response) && response.length > 0) {
            const catalogItems = response.map((row) => apiSeriesToCatalog(row)).filter(isSeries);
            const map = catalogToReelMetadataMap(catalogItems);
            applyApiCatalogState(catalogItems, map);
            persistReelSeriesMetadataMap(map);
            cacheSeriesCatalogOffline(catalogItems, map);
            markSeriesApiMigrated();
            logSeriesApiRead({ source: 'api', seriesCount: catalogItems.length });
            return;
        }

        const localMap = hydrateStudioMetadataFromCatalog();
        const localCatalog = get(seriesCatalog);
        if (!isSeriesApiMigrated() && (Object.keys(localMap).length > 0 || localCatalog.length > 0)) {
            await migrateLocalCatalogToApi(localCatalog, localMap);
            const refreshed = await fetchAllSeries();
            if (Array.isArray(refreshed) && refreshed.length > 0) {
                const catalogItems = refreshed.map((row) => apiSeriesToCatalog(row)).filter(isSeries);
                const map = catalogToReelMetadataMap(catalogItems);
                applyApiCatalogState(catalogItems, map);
                persistReelSeriesMetadataMap(map);
                cacheSeriesCatalogOffline(catalogItems, map);
                logSeriesApiSync({ source: 'migrated', seriesCount: catalogItems.length });
                return;
            }
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
            reelSeriesMetadata.set(syncMap);
            applyAllMetadataToCatalog(syncMap);
            rehydrateEpisodeVaultBindings();
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
 * Prose fields (title, description, genre, runtime, …) are stripped when
 * sourceType is AI/discovery/demo — use proposals instead of silent catalog writes.
 *
 * @param {string} reelId
 * @param {Partial<ReelSeriesMetadata> & { provenanceSource?: string; sourceType?: string }} patch
 * @param {{ sourceType?: string; context?: string }} [options]
 */
export function saveReelSeriesMetadata(reelId, patch, options = {}) {
    const sourceType =
        options.sourceType ||
        patch?.provenanceSource ||
        patch?.sourceType ||
        PROVENANCE_SOURCE_TYPES.CREATOR;
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
    if (saved.episodeId) {
        bindEpisodeToFeedReel(reelId, saved.episodeId, { ...saved });
    }
    void persistReelMetadataToApi(reelId, saved);
    scheduleSyncPush('seriesMetadata');
    return saved;
}

/** @param {string} reelId @param {ReelSeriesMetadata} saved */
async function persistReelMetadataToApi(reelId, saved) {
    try {
        const available = await isSeriesApiAvailable();
        if (!available) {
            logSeriesApiWrite({ source: 'fallback', reelId, reason: 'api-unavailable' });
            return;
        }

        // Clone current catalog for API payload only. Never re-set the live store from this
        // snapshot after `await` — a concurrent draft/status edit would be clobbered.
        const live = get(seriesCatalog);
        const catalogClone =
            typeof structuredClone === 'function'
                ? structuredClone(live)
                : /** @type {Series[]} */ (JSON.parse(JSON.stringify(live)));
        const target = applyReelPatchToCatalog(catalogClone, reelId, saved);
        if (!target) return;

        const payload = seriesToApiPayload(target);
        await updateSeries(target.id, payload);
        seriesPersistenceMode.set('api');
        const current = get(seriesCatalog);
        cacheSeriesCatalogOffline(current, catalogToReelMetadataMap(current));
        logSeriesApiWrite({ reelId, seriesId: target.id, source: 'api' });
    } catch (err) {
        logSeriesApiWrite({
            source: 'fallback',
            reelId,
            reason: err?.message || 'api-save-failed'
        });
    }
}

/**
 * Bind a feed reel UUID to a catalog episode and persist studio metadata.
 * @param {string} feedReelId
 * @param {string} episodeId
 * @param {Partial<ReelSeriesMetadata>} [metaPatch]
 */
export function bindEpisodeToFeedReel(feedReelId, episodeId, metaPatch = {}) {
    if (!feedReelId || !episodeId) return false;

    const ctx = getEpisodeById(episodeId);
    if (!ctx) return false;

    let changed = false;
    seriesCatalog.update((catalogItems) => {
        const next = catalogItems.map((series) => ({
            ...series,
            seasons: series.seasons.map((season) => ({
                ...season,
                episodes: season.episodes.map((episode) => {
                    if (episode.episodeId !== episodeId) return episode;
                    changed = true;
                    const aliases = Array.isArray(metaPatch.aliases)
                        ? metaPatch.aliases.map(String).filter(Boolean)
                        : Array.isArray(episode.aliases)
                          ? episode.aliases
                          : [];
                    return {
                        ...episode,
                        reelId: feedReelId,
                        // Hero Vault media bind — same ready vault asset id (no re-upload).
                        mediaAssetId:
                            metaPatch.mediaAssetId != null
                                ? metaPatch.mediaAssetId
                                : feedReelId,
                        thumbnailAssetId:
                            metaPatch.thumbnailAssetId !== undefined
                                ? metaPatch.thumbnailAssetId
                                : episode.thumbnailAssetId ?? null,
                        aliases
                    };
                })
            }))
        }));
        return changed ? next : catalogItems;
    });

    const saved = upsertStoredReelSeriesMetadata(feedReelId, {
        reelId: feedReelId,
        episodeId,
        seriesId: ctx.series.id,
        seasonNumber: ctx.season.seasonNumber,
        episodeNumber: ctx.episode.episodeNumber,
        episodeTitle: ctx.episode.title,
        seriesName: ctx.series.title,
        description: metaPatch.description ?? ctx.episode.description ?? ctx.series.description,
        genre: metaPatch.genre ?? ctx.episode.genre ?? ctx.series.genre,
        runtime: metaPatch.runtime ?? ctx.episode.runtime,
        releaseYear: metaPatch.releaseYear ?? ctx.series.releaseYear,
        episodeStatus: metaPatch.episodeStatus ?? ctx.episode.status,
        tags: metaPatch.tags ?? ctx.episode.tags ?? ctx.series.tags,
        ...metaPatch
    });

    if (saved) {
        reelSeriesMetadata.update((map) => ({ ...map, [feedReelId]: saved }));
    }

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
 * @param {string} episodeId
 */
export function detachEpisodeReel(episodeId) {
    const ctx = getEpisodeById(episodeId);
    if (!ctx) return false;

    const oldReelId = ctx.episode.reelId || null;
    let changed = false;

    seriesCatalog.update((catalogItems) => {
        const next = catalogItems.map((series) => ({
            ...series,
            seasons: series.seasons.map((season) => ({
                ...season,
                episodes: season.episodes.map((episode) => {
                    if (episode.episodeId !== episodeId) return episode;
                    changed = true;
                    return { ...episode, reelId: null };
                })
            }))
        }));
        return changed ? next : catalogItems;
    });

    if (oldReelId) {
        const map = loadReelSeriesMetadataMap();
        if (map[oldReelId]?.episodeId === episodeId) {
            delete map[oldReelId];
            persistReelSeriesMetadataMap(map);
            reelSeriesMetadata.update((current) => {
                const next = { ...current };
                delete next[oldReelId];
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
            status: 'Missing Asset'
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
                    changed = true;
                    return {
                        ...episode,
                        title: meta.episodeTitle || episode.title,
                        description: meta.description ?? episode.description,
                        episodeNumber: meta.episodeNumber ?? episode.episodeNumber,
                        genre: meta.genre,
                        tags: meta.tags,
                        runtime: meta.runtime ?? episode.runtime,
                        status: meta.episodeStatus ?? episode.status
                    };
                })
            })),
            title: seriesMatchesReel(series, reelId, meta) ? meta.seriesName || series.title : series.title,
            genre: seriesMatchesReel(series, reelId, meta) ? meta.genre ?? series.genre : series.genre,
            releaseYear: seriesMatchesReel(series, reelId, meta)
                ? meta.releaseYear ?? series.releaseYear
                : series.releaseYear,
            tags: seriesMatchesReel(series, reelId, meta) ? meta.tags ?? series.tags : series.tags
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
    return get(seriesCatalog).find((series) => series.id === seriesId);
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
    return { series, season };
}

/**
 * @param {string} episodeId
 * @returns {{ series: Series; season: Season; episode: Episode } | undefined}
 */
export function getEpisodeById(episodeId) {
    for (const series of get(seriesCatalog)) {
        for (const season of series.seasons) {
            const episode = season.episodes.find((e) => e.episodeId === episodeId);
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
    for (const series of get(seriesCatalog)) {
        for (const season of series.seasons) {
            const episode = season.episodes.find((e) => e.reelId === reelId);
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
 * Uses metadata persistence APIs; does not run vault title inference.
 * @param {{ series: Series; season: Season; episode: Episode }} ctx
 */
function syncReelMetadataFromCatalogEpisode(ctx) {
    const reelId = ctx?.episode?.reelId ? String(ctx.episode.reelId).trim() : '';
    if (!reelId) return null;

    const saved = upsertStoredReelSeriesMetadata(reelId, {
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
    });
    if (!saved) return null;

    reelSeriesMetadata.update((map) => ({ ...map, [reelId]: saved }));
    void persistReelMetadataToApi(reelId, saved);
    scheduleSyncPush('seriesMetadata');
    return saved;
}

/**
 * Episode-id primary catalog patch (Creator Catalog Control).
 * Updates title / description / status only; preserves episodeId, reelId, season membership.
 *
 * @param {string} episodeId
 * @param {{ title?: string; description?: string; status?: import('./seriesTypes.js').EpisodeStatus }} patch
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
 * Reorder episodes within a single season. Preserves episodeId and reelId; renumbers 1..n.
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
    if (!hit) return false;

    const { season } = hit;
    const byId = new Map(season.episodes.map((ep) => [ep.episodeId, ep]));
    const ordered = orderedEpisodeIds.map((id) => String(id || '').trim()).filter(Boolean);

    if (ordered.length !== season.episodes.length) return false;
    if (new Set(ordered).size !== ordered.length) return false;
    for (const epId of ordered) {
        if (!byId.has(epId)) return false;
    }

    /** @type {Episode[]} */
    const renumbered = ordered.map((epId, index) => {
        const prev = byId.get(epId);
        return {
            ...prev,
            episodeId: prev.episodeId,
            reelId: prev.reelId,
            episodeNumber: index + 1
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
                    return { ...s, episodes: renumbered };
                })
            };
        });
        return applied ? next : catalogItems;
    });

    if (!applied) return false;

    for (const episode of renumbered) {
        if (!episode.reelId) continue;
        const ctx = getEpisodeById(episode.episodeId);
        if (ctx) syncReelMetadataFromCatalogEpisode(ctx);
    }

    console.info('[CATALOG_EPISODE_REORDER]', {
        seriesId: sid,
        seasonNumber: sn,
        orderedEpisodeIds: ordered,
        ts: new Date().toISOString()
    });

    return true;
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
        .filter((episode) => episodeIsPlayable(episode))
        .sort((a, b) => a.episodeNumber - b.episodeNumber);
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
        ctx = {
            ...ctx,
            episode: { ...ctx.episode, reelId }
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
        seriesId: stored?.seriesId ?? ctx?.series.id
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
