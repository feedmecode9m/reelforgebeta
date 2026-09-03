import { API_BASE_URL, fetchWithRetry } from '../api.js';
import {
    getAdminAuthHeaders,
    getAdminToken,
    maybeHandleInvalidAdminSession
} from '../adminSession.js';

export const SERIES_API_MIGRATION_KEY = 'reelforge_series_api_migrated';
/** Offline API catalog snapshot only — must NOT share the reel metadata map key. */
export const SERIES_API_CACHE_KEY = 'reelforge_series_api_offline_cache';

/**
 * @typedef {import('../series/seriesTypes.js').Series} Series
 * @typedef {import('../series/seriesMetadataStorage.js').ReelSeriesMetadata} ReelSeriesMetadata
 */

/**
 * @typedef {{ enabled?: boolean; count?: number; disabled?: boolean; error?: string }} SeriesApiStatus
 */

/**
 * @param {string} tag
 * @param {Record<string, unknown>} detail
 */
function logSeriesDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {Record<string, unknown>} detail */
export function logSeriesApiRead(detail = {}) {
    logSeriesDiag('SERIES_API_READ', detail);
}

/** @param {Record<string, unknown>} detail */
export function logSeriesApiWrite(detail = {}) {
    logSeriesDiag('SERIES_API_WRITE', detail);
}

/** @param {Record<string, unknown>} detail */
export function logSeriesApiSync(detail = {}) {
    logSeriesDiag('SERIES_API_SYNC', detail);
}

/**
 * @param {'init' | 'save' | 'migrate' | 'fallback'} phase
 * @param {Record<string, unknown>} detail
 * @deprecated Use logSeriesApiRead/Write/Sync
 */
export function logSeriesApiDiag(phase, detail = {}) {
    if (phase === 'save') {
        logSeriesApiWrite({ phase, ...detail });
        return;
    }
    if (phase === 'migrate') {
        logSeriesApiSync({ phase, ...detail });
        return;
    }
    logSeriesApiRead({ phase, ...detail });
}

async function seriesFetch(path, options = {}, meta = {}) {
    const method = options.method || 'GET';
    const isWrite = method !== 'GET' && method !== 'HEAD';
    /** @type {Record<string, string>} */
    const headers = {
        ...(options.headers && typeof options.headers === 'object' && !(options.headers instanceof Headers)
            ? /** @type {Record<string, string>} */ (options.headers)
            : {})
    };

    if (isWrite) {
        Object.assign(headers, getAdminAuthHeaders());
        if (!headers.Authorization && !getAdminToken()) {
            throw new Error('missing_authorization');
        }
    }

    const res = await fetchWithRetry(`${API_BASE_URL}${path}`, { ...options, method, headers }, {
        retries: isWrite ? 0 : 1,
        notifyReconnectOnFailure: false
    });
    if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        return { disabled: true, error: body.error || 'Series API disabled' };
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (isWrite && res.status === 401) {
            maybeHandleInvalidAdminSession(res, body, 'seriesApi');
        }
        throw new Error(body.error || `Series API failed (${res.status})`);
    }

    const body = await res.json();
    if (isWrite) {
        logSeriesApiWrite({ path, method, ...meta });
    } else {
        logSeriesApiRead({ path, method, ...meta });
    }
    return body;
}

/** @returns {Promise<SeriesApiStatus>} */
export async function fetchSeriesApiStatus() {
    try {
        const res = await fetchWithRetry(
            `${API_BASE_URL}/api/series/status`,
            { signal: AbortSignal.timeout(4000) },
            { retries: 0, retryDelayMs: 250, notifyReconnectOnFailure: false }
        );
        if (res.status === 404) {
            const body = await res.json().catch(() => ({}));
            return { disabled: true, error: body.error || 'Series API disabled' };
        }
        if (!res.ok) {
            return { disabled: true, error: `Series API failed (${res.status})` };
        }
        const body = await res.json();
        logSeriesApiRead({ path: '/api/series/status', source: 'status' });
        return body;
    } catch (err) {
        return { disabled: true, error: err?.message || 'Series API unavailable' };
    }
}

/** @returns {Promise<Series[] | { disabled: true; error: string }>} */
export async function fetchAllSeries() {
    try {
        return await seriesFetch('/api/series', {}, { source: 'catalog' });
    } catch (err) {
        return { disabled: true, error: err?.message || 'Series API unavailable' };
    }
}

/** @param {string} seriesId @returns {Promise<Series | { disabled: true; error: string } | null>} */
export async function fetchSeriesById(seriesId) {
    try {
        return await seriesFetch(
            `/api/series/${encodeURIComponent(seriesId)}`,
            {},
            { seriesId, source: 'series' }
        );
    } catch (err) {
        if (String(err?.message || '').includes('404')) return null;
        return { disabled: true, error: err?.message || 'Series API unavailable' };
    }
}

/** @param {string} seriesId */
export async function fetchSeriesSeasons(seriesId) {
    return seriesFetch(
        `/api/series/${encodeURIComponent(seriesId)}/seasons`,
        {},
        { seriesId, source: 'seasons' }
    );
}

/** @param {string} seriesId */
export async function fetchSeriesEpisodes(seriesId) {
    return seriesFetch(
        `/api/series/${encodeURIComponent(seriesId)}/episodes`,
        {},
        { seriesId, source: 'episodes' }
    );
}

/** @param {Partial<Series>} body */
export async function createSeries(body) {
    return seriesFetch(
        '/api/series',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        },
        { seriesId: body.id, source: 'create-series' }
    );
}

/** @param {string} seriesId @param {Partial<Series>} body */
export async function updateSeries(seriesId, body) {
    return seriesFetch(
        `/api/series/${encodeURIComponent(seriesId)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...body, id: seriesId })
        },
        { seriesId, source: 'update-series' }
    );
}

/** @param {string} seriesId @param {Record<string, unknown>} body */
export async function createSeason(seriesId, body) {
    return seriesFetch(
        `/api/series/${encodeURIComponent(seriesId)}/seasons`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        },
        { seriesId, source: 'create-season' }
    );
}

/** @param {Record<string, unknown>} body */
export async function createEpisode(body) {
    return seriesFetch(
        '/api/episodes',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        },
        { seriesId: body.seriesId, source: 'create-episode' }
    );
}

/** @param {string} episodeId @param {Record<string, unknown>} body */
export async function updateEpisode(episodeId, body) {
    return seriesFetch(
        `/api/episodes/${encodeURIComponent(episodeId)}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        },
        { episodeId, source: 'update-episode' }
    );
}

/** @param {string} episodeId */
export async function deleteEpisode(episodeId) {
    return seriesFetch(
        `/api/episodes/${encodeURIComponent(episodeId)}`,
        { method: 'DELETE' },
        { episodeId, source: 'delete-episode' }
    );
}

/**
 * Canonical POST /api/series payload for Studio "+ Add series".
 * Uses a text series id (never a studio_series UUID) and a Season 1 structural shell.
 *
 * @param {string} title
 * @param {{ id?: string; idSuffix?: number | string }} [options]
 */
export function seriesCreatePayloadFromStudioTitle(title, options = {}) {
    const trimmed = String(title || '').trim();
    const stamp = options.idSuffix ?? Date.now();
    const slug = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
    const id = options.id || `series-studio-${slug || 'untitled'}-${stamp}`;
    const seasonId = `season-${id}-1`;
    return {
        id,
        title: trimmed,
        tags: ['studio-created'],
        seasons: [
            {
                seasonId,
                seasonNumber: 1,
                title: 'Season 1',
                episodes: []
            }
        ]
    };
}

/**
 * Convert frontend Series catalog to API upsert payload.
 * @param {Series} series
 */
export function seriesToApiPayload(series) {
    return {
        id: series.id,
        title: series.title,
        description: series.description,
        genre: series.genre,
        releaseYear: series.releaseYear,
        poster: series.poster,
        tags: series.tags || [],
        seasons: (series.seasons || []).map((season) => ({
            seasonId: season.seasonId || `season-${series.id}-${season.seasonNumber}`,
            seasonNumber: season.seasonNumber,
            title: season.title,
            description: season.description,
            episodes: (season.episodes || []).map((episode) => {
                /** @type {Record<string, unknown>} */
                const row = {
                    episodeId: episode.episodeId,
                    episodeNumber: episode.episodeNumber,
                    title: episode.title,
                    description: episode.description,
                    runtime: episode.runtime ?? episode.runtimeSeconds,
                    runtimeSeconds: episode.runtimeSeconds ?? episode.runtime,
                    status: episode.status,
                    reelId: episode.reelId || undefined,
                    releaseDate: episode.releaseDate,
                    genre: episode.genre,
                    tags: episode.tags || []
                };
                // Editorial poster authority: episode row PUT only — never via series upsert/reel bind.
                return row;
            })
        }))
    };
}

/**
 * Series-row payload for PUT /api/series/:id when editing catalog metadata only.
 * Omits seasons so episode rows and reel bindings are never touched.
 *
 * @param {Series | null | undefined} series
 */
export function seriesToApiRowPayload(series) {
    if (!series || !series.id) {
        return { id: '', title: '' };
    }
    /** @type {Record<string, unknown>} */
    const payload = {
        id: String(series.id),
        title: String(series.title || '').trim(),
        description: String(series.description ?? ''),
        genre: String(series.genre ?? ''),
        poster: String(series.poster ?? ''),
        tags: Array.isArray(series.tags) ? series.tags.map(String) : []
    };
    const releaseYear = Number(series.releaseYear);
    if (Number.isFinite(releaseYear)) {
        payload.releaseYear = releaseYear;
    }
    return payload;
}

/**
 * Episode-row payload for PUT /api/episodes/:id — editorial metadata only.
 * Omits reelId, seriesId, seasonNumber, and episodeNumber so bindings never drift.
 *
 * @param {{ series: Series; season: Season; episode: import('../series/seriesTypes.js').Episode } | null | undefined} ctx
 */
export function episodeToApiRowPayload(ctx) {
    if (!ctx?.episode?.episodeId) {
        return { title: '' };
    }
    const { episode } = ctx;
    /** @type {Record<string, unknown>} */
    const payload = {
        title: String(episode.title || '').trim(),
        description: String(episode.description ?? ''),
        status: String(episode.status || 'draft')
    };
    if (episode.thumbnailUrl) {
        payload.thumbnailUrl = String(episode.thumbnailUrl);
    }
    if (episode.genre) {
        payload.genre = String(episode.genre);
    }
    if (Array.isArray(episode.tags) && episode.tags.length) {
        payload.tags = episode.tags.map(String);
    }
    const runtimeSeconds = Number(episode.runtimeSeconds ?? episode.runtime);
    if (Number.isFinite(runtimeSeconds)) {
        payload.runtimeSeconds = runtimeSeconds;
    }
    return payload;
}

/**
 * Create payload for POST /api/episodes when a local catalog row is not yet in Postgres.
 *
 * @param {{ series: Series; season: Season; episode: import('../series/seriesTypes.js').Episode } | null | undefined} ctx
 */
export function episodeToApiCreatePayload(ctx) {
    if (!ctx?.episode?.episodeId || !ctx?.series?.id) {
        return null;
    }
    const { series, season, episode } = ctx;
    /** @type {Record<string, unknown>} */
    const payload = {
        id: String(episode.episodeId),
        seriesId: String(series.id),
        seasonNumber: Number(season.seasonNumber) || 1,
        episodeNumber: Number(episode.episodeNumber) || 1,
        title: String(episode.title || '').trim(),
        status: String(episode.status || 'draft')
    };
    if (episode.description) {
        payload.description = String(episode.description);
    }
    if (episode.reelId) {
        payload.reelId = String(episode.reelId);
    }
    if (episode.thumbnailUrl) {
        payload.thumbnailUrl = String(episode.thumbnailUrl);
    }
    if (episode.genre) {
        payload.genre = String(episode.genre);
    }
    if (Array.isArray(episode.tags) && episode.tags.length) {
        payload.tags = episode.tags.map(String);
    }
    const runtimeSeconds = Number(episode.runtimeSeconds ?? episode.runtime);
    if (Number.isFinite(runtimeSeconds)) {
        payload.runtimeSeconds = runtimeSeconds;
    }
    return payload;
}

/**
 * Convert API series DTO to frontend catalog shape.
 * @param {Record<string, unknown>} apiSeries
 * @returns {Series}
 */
export function apiSeriesToCatalog(apiSeries) {
    return {
        id: String(apiSeries.id),
        title: String(apiSeries.title || ''),
        description: apiSeries.description ? String(apiSeries.description) : undefined,
        genre: apiSeries.genre ? String(apiSeries.genre) : undefined,
        releaseYear:
            apiSeries.releaseYear != null ? Number(apiSeries.releaseYear) : undefined,
        poster: apiSeries.poster ? String(apiSeries.poster) : undefined,
        tags: Array.isArray(apiSeries.tags) ? apiSeries.tags.map(String) : [],
        seasons: Array.isArray(apiSeries.seasons)
            ? apiSeries.seasons.map((season) => ({
                  seasonId:
                      season.seasonId ||
                      `season-${apiSeries.id}-${season.seasonNumber}`,
                  seasonNumber: Number(season.seasonNumber) || 1,
                  title: season.title ? String(season.title) : undefined,
                  description: season.description
                      ? String(season.description)
                      : undefined,
                  episodes: Array.isArray(season.episodes)
                      ? season.episodes.map((episode) => mapApiEpisode(episode))
                      : []
              }))
            : []
    };
}

/** @param {Record<string, unknown>} episode */
function mapApiEpisode(episode) {
    const runtimeSeconds =
        episode.runtimeSeconds != null
            ? Number(episode.runtimeSeconds)
            : episode.runtime != null
              ? Number(episode.runtime)
              : undefined;
    return {
        episodeId: String(episode.episodeId || episode.id),
        episodeNumber: Number(episode.episodeNumber) || 1,
        title: String(episode.title || ''),
        description: episode.description ? String(episode.description) : undefined,
        runtime: runtimeSeconds,
        runtimeSeconds,
        status: episode.status || 'draft',
        reelId: episode.reelId ? String(episode.reelId) : null,
        thumbnailUrl: episode.thumbnailUrl ? String(episode.thumbnailUrl) : undefined,
        releaseDate: episode.releaseDate ? String(episode.releaseDate) : undefined,
        genre: episode.genre ? String(episode.genre) : undefined,
        tags: Array.isArray(episode.tags) ? episode.tags.map(String) : []
    };
}

/**
 * Build reel metadata map from API catalog.
 * @param {Series[]} catalog
 * @returns {Record<string, ReelSeriesMetadata>}
 */
export function catalogToReelMetadataMap(catalog) {
    /** @type {Record<string, ReelSeriesMetadata>} */
    const map = {};
    for (const series of catalog) {
        for (const season of series.seasons || []) {
            for (const episode of season.episodes || []) {
                if (!episode.reelId) continue;
                map[episode.reelId] = {
                    reelId: episode.reelId,
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
            }
        }
    }
    return map;
}

/**
 * Apply reel-level metadata patch onto catalog series for API upsert.
 * @param {Series[]} catalog
 * @param {string} reelId
 * @param {Partial<ReelSeriesMetadata>} patch
 * @returns {Series | null}
 */
export function applyReelPatchToCatalog(catalog, reelId, patch) {
    const seriesId = patch.seriesId;
    const episodeId = patch.episodeId;
    let targetSeries = seriesId ? catalog.find((s) => s.id === seriesId) : null;

    if (!targetSeries && patch.seriesName) {
        targetSeries = catalog.find(
            (s) => s.title.toLowerCase() === String(patch.seriesName).toLowerCase()
        );
    }

    if (!targetSeries) {
        const newId =
            seriesId || `series-${String(patch.seriesName || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`;
        targetSeries = {
            id: newId,
            title: patch.seriesName || 'Untitled Series',
            description: patch.description,
            genre: patch.genre,
            releaseYear: patch.releaseYear,
            tags: patch.tags || [],
            seasons: []
        };
        catalog.push(targetSeries);
    }

    const seasonNumber = Number(patch.seasonNumber) || 1;
    let season = targetSeries.seasons.find((s) => s.seasonNumber === seasonNumber);
    if (!season) {
        season = {
            seasonId: `season-${targetSeries.id}-${seasonNumber}`,
            seasonNumber,
            title: `Season ${seasonNumber}`,
            episodes: []
        };
        targetSeries.seasons.push(season);
    }

    const episodeNumber = Number(patch.episodeNumber) || 1;
    let episode = season.episodes.find(
        (e) => e.reelId === reelId || (episodeId && e.episodeId === episodeId)
    );
    if (!episode) {
        episode = {
            episodeId: episodeId || `ep-${targetSeries.id}-s${seasonNumber}e${episodeNumber}`,
            episodeNumber,
            title: patch.episodeTitle || `Episode ${episodeNumber}`,
            status: patch.episodeStatus || 'draft',
            reelId
        };
        season.episodes.push(episode);
    }

    episode.title = patch.episodeTitle || episode.title;
    episode.description = patch.description ?? episode.description;
    episode.episodeNumber = episodeNumber;
    episode.runtime = patch.runtime ?? episode.runtime;
    episode.status = patch.episodeStatus ?? episode.status;
    episode.genre = patch.genre ?? episode.genre;
    episode.tags = patch.tags ?? episode.tags;
    episode.reelId = reelId;

    if (patch.seriesName) targetSeries.title = patch.seriesName;
    if (patch.description) targetSeries.description = patch.description;
    if (patch.genre) targetSeries.genre = patch.genre;
    if (patch.releaseYear != null) targetSeries.releaseYear = patch.releaseYear;
    if (patch.tags?.length) targetSeries.tags = patch.tags;

    return targetSeries;
}

/** @returns {boolean} */
export function isSeriesApiMigrated() {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SERIES_API_MIGRATION_KEY) === 'true';
}

export function markSeriesApiMigrated() {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SERIES_API_MIGRATION_KEY, 'true');
}

/** Cache API catalog locally for offline fallback. */
export function cacheSeriesCatalogOffline(catalog, map) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(
            SERIES_API_CACHE_KEY,
            JSON.stringify({
                catalog,
                map,
                cachedAt: Date.now()
            })
        );
        logSeriesApiSync({ source: 'offline-cache', seriesCount: catalog.length });
    } catch {
        // ignore quota errors
    }
}

export function initSeriesApi() {
    if (typeof window === 'undefined') return;
    window.__reelforgeSeriesApi = {
        fetchAllSeries,
        fetchSeriesById,
        fetchSeriesSeasons,
        fetchSeriesEpisodes,
        createSeries,
        updateSeries,
        createSeason,
        createEpisode,
        updateEpisode,
        deleteEpisode,
        seriesToApiPayload,
        seriesToApiRowPayload,
        episodeToApiRowPayload,
        episodeToApiCreatePayload,
        apiSeriesToCatalog
    };
}
