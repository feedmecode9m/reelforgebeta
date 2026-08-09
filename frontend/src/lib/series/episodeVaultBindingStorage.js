/**
 * Persist Episode ↔ Hero Vault bindings (id references only).
 * Source of truth key: episodeId (survives reload independent of reelId).
 */

export const EPISODE_VAULT_BINDING_STORAGE_KEY = 'reelforge_episode_vault_bindings';

/**
 * @typedef {{
 *   episodeId: string;
 *   heroVaultAssetId: string | null;
 *   mediaAssetId: string | null;
 *   heroVaultBindingMode: 'manual' | 'auto' | null;
 *   updatedAt?: number;
 * }} EpisodeVaultBindingRecord
 */

function hasBrowserStorage() {
    return typeof globalThis !== 'undefined' && globalThis.localStorage;
}

/**
 * @returns {Record<string, EpisodeVaultBindingRecord>}
 */
export function loadEpisodeVaultBindingMap() {
    if (!hasBrowserStorage()) return {};
    try {
        const raw = globalThis.localStorage.getItem(EPISODE_VAULT_BINDING_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        /** @type {Record<string, EpisodeVaultBindingRecord>} */
        const out = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (!value || typeof value !== 'object') continue;
            const episodeId = String(value.episodeId || key || '').trim();
            if (!episodeId) continue;
            const modeRaw = value.heroVaultBindingMode;
            const mode =
                modeRaw === 'manual' || modeRaw === 'auto' || modeRaw === null
                    ? modeRaw
                    : null;
            out[episodeId] = {
                episodeId,
                heroVaultAssetId:
                    value.heroVaultAssetId == null || value.heroVaultAssetId === ''
                        ? null
                        : String(value.heroVaultAssetId).trim() || null,
                mediaAssetId:
                    value.mediaAssetId == null || value.mediaAssetId === ''
                        ? null
                        : String(value.mediaAssetId).trim() || null,
                heroVaultBindingMode: mode,
                updatedAt: Number(value.updatedAt) || undefined
            };
        }
        return out;
    } catch {
        return {};
    }
}

/**
 * @param {Record<string, EpisodeVaultBindingRecord>} map
 * @returns {boolean}
 */
export function persistEpisodeVaultBindingMap(map) {
    if (!hasBrowserStorage()) return false;
    try {
        globalThis.localStorage.setItem(
            EPISODE_VAULT_BINDING_STORAGE_KEY,
            JSON.stringify(map && typeof map === 'object' ? map : {})
        );
        return true;
    } catch (err) {
        console.warn('[episodeVaultBinding] persist failed', err);
        return false;
    }
}

/**
 * @param {string} episodeId
 * @returns {EpisodeVaultBindingRecord | null}
 */
export function getStoredEpisodeVaultBinding(episodeId) {
    const id = String(episodeId || '').trim();
    if (!id) return null;
    return loadEpisodeVaultBindingMap()[id] || null;
}

/**
 * Upsert or remove binding for an episode.
 * Pass assetId null + mode auto|null to clear.
 *
 * @param {string} episodeId
 * @param {{
 *   heroVaultAssetId?: string | null;
 *   mediaAssetId?: string | null;
 *   heroVaultBindingMode?: 'manual' | 'auto' | null;
 * }} patch
 * @returns {EpisodeVaultBindingRecord | null}
 */
export function upsertStoredEpisodeVaultBinding(episodeId, patch = {}) {
    const id = String(episodeId || '').trim();
    if (!id) return null;

    const map = loadEpisodeVaultBindingMap();
    const prev = map[id] || {
        episodeId: id,
        heroVaultAssetId: null,
        mediaAssetId: null,
        heroVaultBindingMode: null
    };

    const heroVaultAssetId =
        'heroVaultAssetId' in patch
            ? patch.heroVaultAssetId == null || patch.heroVaultAssetId === ''
                ? null
                : String(patch.heroVaultAssetId).trim() || null
            : prev.heroVaultAssetId;

    const mediaAssetId =
        'mediaAssetId' in patch
            ? patch.mediaAssetId == null || patch.mediaAssetId === ''
                ? null
                : String(patch.mediaAssetId).trim() || null
            : prev.mediaAssetId;

    const heroVaultBindingMode =
        'heroVaultBindingMode' in patch
            ? patch.heroVaultBindingMode === 'manual' ||
              patch.heroVaultBindingMode === 'auto' ||
              patch.heroVaultBindingMode === null
                ? patch.heroVaultBindingMode
                : prev.heroVaultBindingMode
            : prev.heroVaultBindingMode;

    /** Cleared auto-only entries should not litter storage */
    if (!heroVaultAssetId && !mediaAssetId && heroVaultBindingMode !== 'manual') {
        delete map[id];
        persistEpisodeVaultBindingMap(map);
        return {
            episodeId: id,
            heroVaultAssetId: null,
            mediaAssetId: null,
            heroVaultBindingMode: heroVaultBindingMode || 'auto',
            updatedAt: Date.now()
        };
    }

    /** @type {EpisodeVaultBindingRecord} */
    const next = {
        episodeId: id,
        heroVaultAssetId,
        mediaAssetId: mediaAssetId || heroVaultAssetId,
        heroVaultBindingMode: heroVaultAssetId
            ? 'manual'
            : heroVaultBindingMode || 'auto',
        updatedAt: Date.now()
    };
    map[id] = next;
    persistEpisodeVaultBindingMap(map);
    return next;
}

/**
 * @param {string} episodeId
 * @returns {boolean}
 */
export function clearStoredEpisodeVaultBinding(episodeId) {
    const id = String(episodeId || '').trim();
    if (!id) return false;
    const map = loadEpisodeVaultBindingMap();
    if (!map[id]) {
        // still write explicit auto-clear snapshot for reload consumers
        upsertStoredEpisodeVaultBinding(id, {
            heroVaultAssetId: null,
            mediaAssetId: null,
            heroVaultBindingMode: 'auto'
        });
        return true;
    }
    delete map[id];
    persistEpisodeVaultBindingMap(map);
    return true;
}

/**
 * Merge stored vault bindings onto an episode object (pure).
 * @param {import('./seriesTypes.js').Episode} episode
 * @param {Record<string, EpisodeVaultBindingRecord>} [map]
 */
export function applyStoredBindingToEpisode(episode, map = loadEpisodeVaultBindingMap()) {
    if (!episode || typeof episode !== 'object') return episode;
    const id = String(episode.episodeId || '').trim();
    if (!id) return episode;
    const rec = map[id];
    if (!rec) return episode;
    return {
        ...episode,
        heroVaultAssetId: rec.heroVaultAssetId,
        mediaAssetId: rec.mediaAssetId,
        heroVaultBindingMode: rec.heroVaultBindingMode
    };
}

/**
 * Apply all stored bindings onto a catalog tree (pure).
 * @param {import('./seriesTypes.js').Series[]} catalog
 * @param {Record<string, EpisodeVaultBindingRecord>} [map]
 */
export function applyStoredBindingsToCatalog(catalog, map = loadEpisodeVaultBindingMap()) {
    if (!Array.isArray(catalog) || !Object.keys(map).length) return catalog;
    return catalog.map((series) => ({
        ...series,
        seasons: (series.seasons || []).map((season) => ({
            ...season,
            episodes: (season.episodes || []).map((episode) =>
                applyStoredBindingToEpisode(episode, map)
            )
        }))
    }));
}
