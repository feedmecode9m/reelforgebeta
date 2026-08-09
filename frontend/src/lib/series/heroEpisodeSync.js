/**
 * Push creator Hero identity into reel-level series metadata (Theater consumers).
 *
 * Does not invent catalog episodes — only patches metadata for an existing reelId.
 * Uses upsertStoredReelSeriesMetadata (localStorage reelforge_series_metadata).
 */

import { get } from 'svelte/store';
import {
    getStoredReelSeriesMetadata,
    upsertStoredReelSeriesMetadata,
    normalizeTags
} from './seriesMetadataStorage.js';
import { reelSeriesMetadata, seriesCatalog, getEpisodeByReelId } from './seriesStore.js';
import { logHeroEpisodeSync } from '../diagnostics/heroEpisodeSyncDiagnostics.js';
import {
    isTruthProvenanceSource,
    normalizeProvenanceSource
} from '../architecture/intelligenceProvenance.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Sync hero creator identity onto series episode metadata for Theater menus.
 *
 * Creator Truth only: description/genre prose from AI/discovery sources is not written.
 * Preserves episodeId / seriesId / seasonNumber / episodeNumber when present.
 *
 * @param {string} reelId
 * @param {{
 *   title?: string;
 *   episodeTitle?: string;
 *   description?: string;
 *   tags?: string[];
 *   keywords?: string[];
 *   seriesName?: string;
 *   genre?: string;
 *   source?: string;
 * }} identity
 * @returns {import('./seriesMetadataStorage.js').ReelSeriesMetadata | null}
 */
export function syncHeroIdentityToEpisodeMetadata(reelId, identity = {}) {
    const id = text(reelId);
    if (!id) {
        logHeroEpisodeSync({
            reelId: '',
            oldTitle: '',
            newTitle: '',
            source: identity.source || 'creator',
            updated: false
        });
        return null;
    }

    const existing = getStoredReelSeriesMetadata(id) || get(reelSeriesMetadata)[id] || null;
    const oldTitle = text(existing?.episodeTitle);

    const newTitle = text(identity.episodeTitle || identity.title);
    if (!newTitle) {
        logHeroEpisodeSync({
            reelId: id,
            oldTitle,
            newTitle: '',
            source: identity.source || 'creator',
            episodeId: existing?.episodeId || null,
            seriesId: existing?.seriesId || null,
            updated: false
        });
        return existing;
    }

    const truthSource = isTruthProvenanceSource(identity.source || 'creator');
    const sourceType = normalizeProvenanceSource(identity.source || 'creator');

    /** @type {Partial<import('./seriesMetadataStorage.js').ReelSeriesMetadata>} */
    const patch = {
        reelId: id,
        episodeTitle: newTitle,
        tags: normalizeTags([
            ...(Array.isArray(identity.tags) ? identity.tags : []),
            ...(Array.isArray(identity.keywords) && truthSource ? identity.keywords : []),
            ...(existing?.tags || [])
        ]),
        updatedAt: Date.now()
    };

    // Prose stays empty unless source is creator/vault/binding (or already stored).
    if (truthSource) {
        patch.description = text(identity.description) || existing?.description || '';
        patch.genre = text(identity.genre) || existing?.genre || '';
    } else {
        patch.description = existing?.description || '';
        patch.genre = existing?.genre || '';
        if (text(identity.description) || text(identity.genre)) {
            console.info('[INTELLIGENCE_PROVENANCE_GUARD]', {
                phase: 'hero-episode-sync-skip-prose',
                sourceType,
                reelId: id,
                ts: new Date().toISOString()
            });
        }
    }

    // Preserve bind keys — never invent episode / series ids without a catalog bind.
    if (existing?.episodeId) patch.episodeId = existing.episodeId;
    if (existing?.seriesId) patch.seriesId = existing.seriesId;
    if (existing?.seasonNumber != null) patch.seasonNumber = existing.seasonNumber;
    if (existing?.episodeNumber != null) patch.episodeNumber = existing.episodeNumber;
    if (existing?.episodeStatus) patch.episodeStatus = existing.episodeStatus;
    if (existing?.runtime != null) patch.runtime = existing.runtime;
    if (existing?.releaseYear != null) patch.releaseYear = existing.releaseYear;

    if (existing?.seriesName) {
        patch.seriesName = existing.seriesName;
    } else if (text(identity.seriesName)) {
        patch.seriesName = text(identity.seriesName);
    }

    // Fill bind fields from catalog when this reel is already attached.
    if (patch.seasonNumber == null || patch.episodeNumber == null || !patch.episodeId) {
        const bound = getEpisodeByReelId(id);
        if (bound) {
            if (!patch.episodeId) patch.episodeId = bound.episode.episodeId;
            if (!patch.seriesId) patch.seriesId = bound.series.id;
            if (patch.seasonNumber == null) patch.seasonNumber = bound.season.seasonNumber;
            if (patch.episodeNumber == null) patch.episodeNumber = bound.episode.episodeNumber;
            if (!patch.seriesName) patch.seriesName = bound.series.title;
        }
    }

    const saved = upsertStoredReelSeriesMetadata(id, patch);
    if (!saved) {
        logHeroEpisodeSync({
            reelId: id,
            oldTitle,
            newTitle,
            source: identity.source || 'creator',
            episodeId: patch.episodeId || null,
            seriesId: patch.seriesId || null,
            updated: false
        });
        return null;
    }

    // Mirror localStorage → live store so Theater menus update without reload.
    reelSeriesMetadata.update((map) => ({
        ...map,
        [id]: saved
    }));

    // When episode is already bound, update catalog display fields only (no new episodes).
    if (saved.episodeId) {
        seriesCatalog.update((catalogItems) => {
            let changed = false;
            const next = catalogItems.map((series) => ({
                ...series,
                seasons: series.seasons.map((season) => ({
                    ...season,
                    episodes: season.episodes.map((episode) => {
                        const linked =
                            episode.episodeId === saved.episodeId || episode.reelId === id;
                        if (!linked) return episode;
                        changed = true;
                        return {
                            ...episode,
                            title: newTitle,
                            description: saved.description ?? episode.description,
                            tags: saved.tags?.length ? saved.tags : episode.tags,
                            genre: saved.genre ?? episode.genre
                        };
                    })
                }))
            }));
            return changed ? next : catalogItems;
        });
    }

    logHeroEpisodeSync({
        reelId: id,
        oldTitle,
        newTitle,
        source: identity.source || 'creator',
        episodeId: saved.episodeId || null,
        seriesId: saved.seriesId || null,
        updated: true
    });

    return saved;
}
