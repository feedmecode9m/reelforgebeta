import { writable, derived, get } from 'svelte/store';
import { MOCK_SERIES_CATALOG } from './mockSeriesData.js';
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

/** @typedef {import('./seriesTypes.js').Series} Series */
/** @typedef {import('./seriesTypes.js').Season} Season */
/** @typedef {import('./seriesTypes.js').Episode} Episode */
/** @typedef {import('./seriesMetadataStorage.js').ReelSeriesMetadata} ReelSeriesMetadata */

const catalog = MOCK_SERIES_CATALOG.filter(isSeries);

/** Catalog seeded from mock data; runtime overrides applied from localStorage. */
export const seriesCatalog = writable(/** @type {Series[]} */ ([...catalog]));

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
    seriesCatalog.set(catalogItems);
    reelSeriesMetadata.set(map);
    applyAllMetadataToCatalog(map);
    seriesPersistenceMode.set('api');
}

/**
 * Push local catalog + reel metadata map to backend (migration).
 * @param {import('./seriesTypes.js').Series[]} catalogItems
 * @param {Record<string, ReelSeriesMetadata>} map
 */
async function migrateLocalCatalogToApi(catalogItems, map) {
    seriesPersistenceMode.set('migrating');
    logSeriesApiSync({ phase: 'migrate-start', seriesCount: catalogItems.length, reelCount: Object.keys(map).length });

    for (const series of catalogItems) {
        const payload = seriesToApiPayload(series);
        for (const [reelId, meta] of Object.entries(map)) {
            if (meta.seriesId === series.id || meta.seriesName === series.title) {
                applyReelPatchToCatalog(catalogItems, reelId, meta);
            }
        }
        const enriched = catalogItems.find((s) => s.id === series.id) || series;
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
    const map = loadReelSeriesMetadataMap();
    let changed = false;

    for (const series of get(seriesCatalog)) {
        for (const season of series.seasons) {
            for (const episode of season.episodes) {
                const reelId = episode.reelId;
                if (!reelId || map[reelId]) continue;

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
    const map = hydrateStudioMetadataFromCatalog();
    reelSeriesMetadata.set(map);
    applyAllMetadataToCatalog(map);

    if (!apiHydrationStarted) {
        apiHydrationStarted = true;
        void hydrateSeriesFromApi();
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('reelforge:sync-applied', (event) => {
            const detail = /** @type {CustomEvent} */ (event).detail;
            const map = detail?.seriesMetadata || loadReelSeriesMetadataMap();
            reelSeriesMetadata.set(map);
            applyAllMetadataToCatalog(map);
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
 * @param {string} reelId
 * @param {Partial<ReelSeriesMetadata>} patch
 */
export function saveReelSeriesMetadata(reelId, patch) {
    const saved = upsertStoredReelSeriesMetadata(reelId, patch);
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
                    return { ...episode, reelId: feedReelId };
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
        const saved = saveReelSeriesMetadata(id, {
            reelId: id,
            episodeTitle: title
        });
        return saved
            ? { episodeId: String(saved.episodeId || ''), title }
            : null;
    }

    const saved = saveReelSeriesMetadata(id, {
        ...(stored || {}),
        reelId: id,
        episodeId: episodeId || stored?.episodeId,
        episodeTitle: title
    });

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
 * Phase 1 reset — reload mock catalog (dev/testing only).
 */
export function resetSeriesCatalogToMock() {
    seriesCatalog.set([...catalog]);
    reelSeriesMetadata.set({});
    persistReelSeriesMetadataMap({});
}

export { normalizeTags };
