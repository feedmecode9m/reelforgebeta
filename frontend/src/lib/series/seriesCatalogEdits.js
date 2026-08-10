/**
 * Durable Creator Series Editor edits (series/season metadata + episode display order).
 * Complements reel metadata; does not replace Hero Vault seriesIdentity.
 *
 * Storage key: reelforge_series_catalog_edits
 */

export const SERIES_CATALOG_EDITS_KEY = 'reelforge_series_catalog_edits';

/**
 * @typedef {{
 *   title?: string;
 *   description?: string;
 *   poster?: string;
 *   genre?: string;
 *   tags?: string[];
 *   seasons?: Record<string, {
 *     title?: string;
 *     description?: string;
 *     poster?: string;
 *     episodeOrder?: string[];
 *   }>;
 *   updatedAt?: number;
 * }} SeriesCatalogEdit
 */

/** @returns {Record<string, SeriesCatalogEdit>} */
export function loadSeriesCatalogEditsMap() {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(SERIES_CATALOG_EDITS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/** @param {Record<string, SeriesCatalogEdit>} map */
export function persistSeriesCatalogEditsMap(map) {
    if (typeof window === 'undefined') return false;
    try {
        localStorage.setItem(SERIES_CATALOG_EDITS_KEY, JSON.stringify(map || {}));
        return true;
    } catch (err) {
        console.warn('[seriesCatalogEdits] persist failed', err);
        return false;
    }
}

/** @param {string} seriesId */
export function getSeriesCatalogEdit(seriesId) {
    const id = String(seriesId || '').trim();
    if (!id) return null;
    return loadSeriesCatalogEditsMap()[id] || null;
}

/**
 * @param {string} seriesId
 * @param {Partial<SeriesCatalogEdit>} patch
 */
export function upsertSeriesCatalogEdit(seriesId, patch = {}) {
    const id = String(seriesId || '').trim();
    if (!id) return null;
    const map = loadSeriesCatalogEditsMap();
    const prev = map[id] || {};
    const seasons = {
        ...(prev.seasons && typeof prev.seasons === 'object' ? prev.seasons : {}),
        ...(patch.seasons && typeof patch.seasons === 'object' ? patch.seasons : {})
    };
    /** @type {SeriesCatalogEdit} */
    const next = {
        ...prev,
        ...patch,
        seasons,
        updatedAt: Date.now()
    };
    map[id] = next;
    persistSeriesCatalogEditsMap(map);
    return next;
}

/**
 * Merge season patch under series edit.
 * @param {string} seriesId
 * @param {number} seasonNumber
 * @param {{ title?: string; description?: string; poster?: string; episodeOrder?: string[] }} seasonPatch
 */
export function upsertSeasonCatalogEdit(seriesId, seasonNumber, seasonPatch = {}) {
    const id = String(seriesId || '').trim();
    const sn = Number(seasonNumber);
    if (!id || !Number.isFinite(sn) || sn < 1) return null;
    const map = loadSeriesCatalogEditsMap();
    const prev = map[id] || {};
    const seasons = { ...(prev.seasons && typeof prev.seasons === 'object' ? prev.seasons : {}) };
    const key = String(Math.floor(sn));
    seasons[key] = {
        ...(seasons[key] || {}),
        ...seasonPatch
    };
    return upsertSeriesCatalogEdit(id, { seasons });
}

/**
 * Sort episodes creator/viewer shelf order: displayOrder ASC, then episodeNumber, then title.
 * @param {Array<{ displayOrder?: number; episodeNumber?: number; title?: string; episodeId?: string }>} episodes
 */
export function sortEpisodesForDisplay(episodes) {
    return [...(Array.isArray(episodes) ? episodes : [])].sort((a, b) => {
        const da = Number(a?.displayOrder);
        const db = Number(b?.displayOrder);
        const aHas = Number.isFinite(da);
        const bHas = Number.isFinite(db);
        if (aHas && bHas && da !== db) return da - db;
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        const enA = Number(a?.episodeNumber) || 0;
        const enB = Number(b?.episodeNumber) || 0;
        if (enA !== enB) return enA - enB;
        return String(a?.title || '').localeCompare(String(b?.title || ''));
    });
}

/**
 * Apply durable catalog edits onto a series object (non-mutating).
 * @param {import('./seriesTypes.js').Series | null | undefined} series
 * @param {SeriesCatalogEdit | null | undefined} [edit]
 */
export function applySeriesCatalogEdit(series, edit = null) {
    if (!series || typeof series !== 'object') return series;
    const e = edit || getSeriesCatalogEdit(series.id);
    if (!e) {
        // Still apply displayOrder sort if present on episodes
        return {
            ...series,
            seasons: (series.seasons || []).map((season) => ({
                ...season,
                episodes: sortEpisodesForDisplay(season.episodes || [])
            }))
        };
    }

    const seasonsMeta = e.seasons && typeof e.seasons === 'object' ? e.seasons : {};
    return {
        ...series,
        title: String(e.title != null ? e.title : series.title || '').trim() || series.title,
        description:
            e.description != null ? String(e.description) : series.description || '',
        poster: e.poster != null ? String(e.poster) : series.poster || '',
        genre: e.genre != null ? String(e.genre) : series.genre || '',
        tags: Array.isArray(e.tags) ? e.tags : series.tags || [],
        seasons: (series.seasons || []).map((season) => {
            const sm = seasonsMeta[String(season.seasonNumber)] || {};
            let episodes = [...(season.episodes || [])];
            if (Array.isArray(sm.episodeOrder) && sm.episodeOrder.length) {
                const byId = new Map(episodes.map((ep) => [ep.episodeId, ep]));
                /** @type {typeof episodes} */
                const ordered = [];
                let orderIdx = 0;
                for (const epId of sm.episodeOrder) {
                    const id = String(epId || '').trim();
                    if (!id || !byId.has(id)) continue;
                    const prev = byId.get(id);
                    ordered.push({ ...prev, displayOrder: orderIdx });
                    byId.delete(id);
                    orderIdx += 1;
                }
                for (const rest of byId.values()) {
                    ordered.push({ ...rest, displayOrder: orderIdx });
                    orderIdx += 1;
                }
                episodes = ordered;
            } else {
                episodes = sortEpisodesForDisplay(episodes);
            }
            return {
                ...season,
                title: sm.title != null ? String(sm.title) : season.title,
                description: sm.description != null ? String(sm.description) : season.description,
                poster: sm.poster != null ? String(sm.poster) : /** @type {{ poster?: string }} */ (season).poster,
                episodes
            };
        })
    };
}
