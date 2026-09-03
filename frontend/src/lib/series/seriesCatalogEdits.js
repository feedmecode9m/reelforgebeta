/**
 * Durable Creator Series Catalog authority (beyond Hero Vault seriesIdentity).
 *
 * Owns (after creator mutation):
 *   - series / season metadata (title, description, artwork, tags, genre)
 *   - displayOrder (via seasons[n].episodeOrder)
 *   - publishing status per episodeId (episodes[episodeId].status)
 *
 * Does NOT own media identity (mediaAssetId / seriesLabel / S/E labels) — Hero Vault does.
 *
 * Storage key: reelforge_series_catalog_edits
 * Survives API catalog hydrate + vault rebind when reapplied after those merges.
 */

export const SERIES_CATALOG_EDITS_KEY = 'reelforge_series_catalog_edits';

/**
 * @typedef {{
 *   status?: 'draft' | 'ready' | 'published' | 'archived';
 *   displayOrder?: number;
 *   title?: string;
 *   description?: string;
 *   thumbnailUrl?: string;
 *   posterAssignSource?: 'thumbnail-vault' | 'mp4-still';
 * }} EpisodeCatalogEdit
 */

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
 *   episodes?: Record<string, EpisodeCatalogEdit>;
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
    // Deep-merge season keys rather than replace whole seasons blob when patch.seasons is partial
    if (patch.seasons && typeof patch.seasons === 'object') {
        for (const [k, v] of Object.entries(patch.seasons)) {
            seasons[k] = {
                ...(prev.seasons && prev.seasons[k] ? prev.seasons[k] : {}),
                ...(v && typeof v === 'object' ? v : {})
            };
        }
    }
    const episodes = {
        ...(prev.episodes && typeof prev.episodes === 'object' ? prev.episodes : {}),
        ...(patch.episodes && typeof patch.episodes === 'object' ? patch.episodes : {})
    };
    if (patch.episodes && typeof patch.episodes === 'object') {
        for (const [k, v] of Object.entries(patch.episodes)) {
            episodes[k] = {
                ...(prev.episodes && prev.episodes[k] ? prev.episodes[k] : {}),
                ...(v && typeof v === 'object' ? v : {})
            };
        }
    }
    /** @type {SeriesCatalogEdit} */
    const next = {
        ...prev,
        ...patch,
        seasons,
        episodes,
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
 * Persist per-episode publishing / display annotations (creator authority).
 * @param {string} seriesId
 * @param {string} episodeId
 * @param {EpisodeCatalogEdit} patch
 */
export function upsertEpisodeCatalogEdit(seriesId, episodeId, patch = {}) {
    const sid = String(seriesId || '').trim();
    const eid = String(episodeId || '').trim();
    if (!sid || !eid || !patch || typeof patch !== 'object') return null;
    const map = loadSeriesCatalogEditsMap();
    const prev = map[sid] || {};
    const episodes = {
        ...(prev.episodes && typeof prev.episodes === 'object' ? prev.episodes : {})
    };
    episodes[eid] = {
        ...(episodes[eid] || {}),
        ...patch
    };
    return upsertSeriesCatalogEdit(sid, { episodes });
}

/**
 * @param {string} seriesId
 * @param {string} episodeId
 * @returns {EpisodeCatalogEdit | null}
 */
export function getEpisodeCatalogEdit(seriesId, episodeId) {
    const edit = getSeriesCatalogEdit(seriesId);
    if (!edit?.episodes) return null;
    const row = edit.episodes[String(episodeId || '').trim()];
    return row && typeof row === 'object' ? row : null;
}

/**
 * Resolve durable creator publishing status for an episode (if recorded).
 * @param {string} seriesId
 * @param {string} episodeId
 * @returns {'draft' | 'ready' | 'published' | 'archived' | null}
 */
export function getCreatorEpisodeStatus(seriesId, episodeId) {
    const row = getEpisodeCatalogEdit(seriesId, episodeId);
    const st = row?.status;
    if (st === 'draft' || st === 'ready' || st === 'published' || st === 'archived') {
        return st;
    }
    return null;
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
 * Stamp creator displayOrder + publishing status onto episodes (non-mutating).
 * Does not rewrite episodeNumber / reelId / mediaAssetId (vault identity).
 * @param {import('./seriesTypes.js').Episode[]} episodes
 * @param {SeriesCatalogEdit | null | undefined} edit
 * @param {{ episodeOrder?: string[] }} [seasonMeta]
 */
export function applyEpisodeAuthorityFromEdit(episodes, edit, seasonMeta = {}) {
    let list = Array.isArray(episodes) ? episodes.map((ep) => ({ ...ep })) : [];
    const order = Array.isArray(seasonMeta.episodeOrder) ? seasonMeta.episodeOrder : null;
    const epEdits = edit?.episodes && typeof edit.episodes === 'object' ? edit.episodes : {};

    if (order && order.length) {
        const byId = new Map(list.map((ep) => [ep.episodeId, ep]));
        /** @type {typeof list} */
        const ordered = [];
        let orderIdx = 0;
        for (const epId of order) {
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
        list = ordered;
    }

    list = list.map((ep) => {
        const row = epEdits[String(ep.episodeId || '')];
        if (!row || typeof row !== 'object') return ep;
        /** @type {typeof ep} */
        const next = { ...ep };
        if (
            row.status === 'draft' ||
            row.status === 'ready' ||
            row.status === 'published' ||
            row.status === 'archived'
        ) {
            next.status = row.status;
        }
        if (Number.isFinite(Number(row.displayOrder))) {
            next.displayOrder = Number(row.displayOrder);
        }
        if (row.title != null && String(row.title).trim()) {
            next.title = String(row.title).trim();
        }
        if (row.description != null) {
            next.description = String(row.description);
        }
        if (row.thumbnailUrl != null && String(row.thumbnailUrl).trim()) {
            next.thumbnailUrl = String(row.thumbnailUrl).trim();
        }
        return next;
    });

    return sortEpisodesForDisplay(list);
}

/**
 * Apply durable catalog edits onto a series object (non-mutating).
 * Creator authority layer for order + publishing + series/season meta.
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
            const episodes = applyEpisodeAuthorityFromEdit(season.episodes || [], e, sm);
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

/**
 * Materialize durable edits onto a full catalog list (store rehydrate after API/vault).
 * @param {import('./seriesTypes.js').Series[]} catalog
 * @returns {import('./seriesTypes.js').Series[]}
 */
export function reapplyCreatorCatalogAuthority(catalog) {
    const list = Array.isArray(catalog) ? catalog : [];
    return list.map((series) => {
        const applied = applySeriesCatalogEdit(series);
        return applied && typeof applied === 'object' ? applied : series;
    });
}
