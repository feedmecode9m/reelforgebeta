/**
 * Push creator Hero identity into reel-level series metadata (Theater consumers).
 *
 * Does not invent catalog episodes — only patches metadata for an existing reelId.
 * All persistence goes through saveReelSeriesMetadata (fail-closed provenance).
 */

import { get } from 'svelte/store';
import {
    getStoredReelSeriesMetadata,
    normalizeTags
} from './seriesMetadataStorage.js';
import {
    getEpisodeByReelId,
    getReelSeriesMetadata,
    saveReelSeriesMetadata
} from './seriesStore.js';
import { logHeroEpisodeSync } from '../diagnostics/heroEpisodeSyncDiagnostics.js';
import {
    formatIntelligenceExplanation,
    isExplicitTruthSourceToken,
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
 * Creator / vault / binding may set official title/description/genre.
 * AI / discovery / system may only attach suggestedGenre + intelligenceExplanation.
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
 *   suggestedGenre?: string;
 *   intelligenceExplanation?: string;
 *   source?: string;
 * }} identity
 * @returns {import('./seriesMetadataStorage.js').ReelSeriesMetadata | null}
 */
export function syncHeroIdentityToEpisodeMetadata(reelId, identity = {}) {
    const id = text(reelId);
    const rawSource = identity.source;
    // Fail closed: default missing source to system (no silent creator elevation).
    const sourceType = isExplicitTruthSourceToken(rawSource)
        ? normalizeProvenanceSource(rawSource)
        : rawSource
          ? normalizeProvenanceSource(rawSource)
          : 'system';
    const truthSource = isTruthProvenanceSource(sourceType);

    if (!id) {
        logHeroEpisodeSync({
            reelId: '',
            oldTitle: '',
            newTitle: '',
            source: sourceType,
            updated: false
        });
        return null;
    }

    const existing = getStoredReelSeriesMetadata(id) || getReelSeriesMetadata(id) || null;
    const oldTitle = text(existing?.episodeTitle);
    const newTitle = text(identity.episodeTitle || identity.title);

    // Intelligence may propose genre; never promote keywords[0] to official genre.
    const keywordHint =
        Array.isArray(identity.keywords) && identity.keywords.length
            ? text(identity.keywords[0])
            : '';
    const suggestedGenre =
        text(identity.suggestedGenre) || (!truthSource ? keywordHint : '') || '';
    const intelligenceExplanation =
        text(identity.intelligenceExplanation) ||
        (suggestedGenre
            ? formatIntelligenceExplanation(suggestedGenre, { fromTitle: true })
            : '');

    if (!newTitle && !suggestedGenre && truthSource === false) {
        logHeroEpisodeSync({
            reelId: id,
            oldTitle,
            newTitle: '',
            source: sourceType,
            episodeId: existing?.episodeId || null,
            seriesId: existing?.seriesId || null,
            updated: false
        });
        return existing;
    }

    if (!newTitle && truthSource) {
        // Allow storing suggested side-channel without title change when only suggestions arrive.
        if (suggestedGenre || intelligenceExplanation) {
            return saveReelSeriesMetadata(
                id,
                {
                    reelId: id,
                    suggestedGenre: suggestedGenre || existing?.suggestedGenre || '',
                    intelligenceExplanation:
                        intelligenceExplanation || existing?.intelligenceExplanation || ''
                },
                { sourceType: 'ai', context: 'syncHeroIdentity-suggestions', skipEpisodeBind: true }
            );
        }
        logHeroEpisodeSync({
            reelId: id,
            oldTitle,
            newTitle: '',
            source: sourceType,
            episodeId: existing?.episodeId || null,
            seriesId: existing?.seriesId || null,
            updated: false
        });
        return existing;
    }

    /** @type {Record<string, unknown>} */
    const patch = {
        reelId: id
    };

    if (truthSource && newTitle) {
        patch.episodeTitle = newTitle;
        patch.tags = normalizeTags([
            ...(Array.isArray(identity.tags) ? identity.tags : []),
            ...(existing?.tags || [])
        ]);
        // Official description only from creator/vault/binding identity — never keywords as genre.
        patch.description = text(identity.description) || existing?.description || '';
        // Official genre only when creator explicitly provided genre (never keywords[0]).
        if (text(identity.genre)) {
            patch.genre = text(identity.genre);
        } else if (existing?.genre) {
            patch.genre = existing.genre;
        }
        if (existing?.seriesName) {
            patch.seriesName = existing.seriesName;
        } else if (text(identity.seriesName)) {
            patch.seriesName = text(identity.seriesName);
        }
    }

    // Suggestions always use non-truth fields (persist even under creator writes).
    if (suggestedGenre || keywordHint) {
        patch.suggestedGenre = suggestedGenre || keywordHint;
        patch.intelligenceExplanation =
            intelligenceExplanation ||
            formatIntelligenceExplanation(suggestedGenre || keywordHint, { fromTitle: true });
    }

    // Preserve bind keys from existing / catalog.
    if (existing?.episodeId) patch.episodeId = existing.episodeId;
    if (existing?.seriesId) patch.seriesId = existing.seriesId;
    if (existing?.seasonNumber != null) patch.seasonNumber = existing.seasonNumber;
    if (existing?.episodeNumber != null) patch.episodeNumber = existing.episodeNumber;
    if (existing?.episodeStatus) patch.episodeStatus = existing.episodeStatus;
    if (existing?.runtime != null) patch.runtime = existing.runtime;
    if (existing?.releaseYear != null) patch.releaseYear = existing.releaseYear;

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

    // Interpretation sources: only suggestions + structural ids, no prose titles.
    const writeSource = truthSource
        ? sourceType
        : suggestedGenre || intelligenceExplanation
          ? 'ai'
          : 'system';

    if (!truthSource && newTitle) {
        console.info('[INTELLIGENCE_PROVENANCE_GUARD]', {
            phase: 'hero-episode-sync-skip-title',
            sourceType,
            reelId: id,
            ts: new Date().toISOString()
        });
        // Drop official title when not a truth source.
        delete patch.episodeTitle;
        delete patch.description;
        delete patch.genre;
        delete patch.seriesName;
    }

    const saved = saveReelSeriesMetadata(id, patch, {
        sourceType: writeSource,
        context: 'syncHeroIdentityToEpisodeMetadata',
        skipEpisodeBind: true
    });

    if (!saved) {
        logHeroEpisodeSync({
            reelId: id,
            oldTitle,
            newTitle,
            source: sourceType,
            episodeId: patch.episodeId || null,
            seriesId: patch.seriesId || null,
            updated: false
        });
        return null;
    }

    logHeroEpisodeSync({
        reelId: id,
        oldTitle,
        newTitle: truthSource ? newTitle : oldTitle,
        source: sourceType,
        episodeId: saved.episodeId || null,
        seriesId: saved.seriesId || null,
        updated: true
    });

    return saved;
}
