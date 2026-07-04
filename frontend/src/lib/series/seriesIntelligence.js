import { getNextEpisode, getReelSeriesMetadata, getSeriesById } from './seriesStore.js';
import { getStoredWatchPercent, hasWatchProgressData } from './seriesWatchProgress.js';

/** @typedef {'New' | 'Released' | 'Upcoming'} DisplayEpisodeStatus */

/**
 * @param {string} reelId
 * @returns {import('./seriesMetadataStorage.js').ReelSeriesMetadata | null}
 */
function studioForReel(reelId) {
    return reelId ? getReelSeriesMetadata(reelId) : null;
}

/**
 * @param {string} episodeId
 * @param {string} [reelId]
 * @returns {number | null} 0–100 or null when unavailable
 */
export function getContinueWatchingPercent(episodeId, reelId) {
    return getStoredWatchPercent(episodeId, reelId);
}

/**
 * @param {import('./seriesTypes.js').Episode | undefined} episode
 * @param {string} [reelId]
 * @returns {DisplayEpisodeStatus | null}
 */
export function resolveDisplayEpisodeStatus(episode, reelId) {
    if (!episode) return null;
    const stored = reelId ? studioForReel(reelId) : null;
    const status = stored?.episodeStatus || episode.status;
    if (status === 'draft') return 'Upcoming';
    if (status === 'ready') return 'New';
    return 'Released';
}

/**
 * @param {{ series?: { releaseYear?: number }; episode?: { reelId?: string | null } } | null | undefined} ctx
 * @returns {number | null}
 */
export function getReleaseYear(ctx) {
    if (!ctx) return null;
    const reelId = ctx.episode?.reelId || '';
    const stored = studioForReel(reelId);
    if (stored?.releaseYear != null) return stored.releaseYear;
    if (ctx.series?.releaseYear != null) return ctx.series.releaseYear;
    return null;
}

/**
 * @param {{ series?: { genre?: string }; episode?: { genre?: string; reelId?: string | null } } | null | undefined} ctx
 * @returns {string}
 */
export function resolveGenreLabel(ctx) {
    if (!ctx) return '';
    const reelId = ctx.episode?.reelId || '';
    const stored = studioForReel(reelId);
    return (stored?.genre || ctx.episode?.genre || ctx.series?.genre || '').trim();
}

/**
 * @param {string | undefined} seriesId
 * @returns {{ totalEpisodes: number; publishedEpisodes: number; playableEpisodes: number }}
 */
export function getSeriesEpisodeCounts(seriesId) {
    const series = seriesId ? getSeriesById(seriesId) : null;
    if (!series) return { totalEpisodes: 0, publishedEpisodes: 0, playableEpisodes: 0 };

    const episodes = series.seasons.flatMap((s) => s.episodes);
    return {
        totalEpisodes: episodes.length,
        publishedEpisodes: episodes.filter((e) => e.status === 'published' || e.status === 'ready').length,
        playableEpisodes: episodes.filter((e) => e.reelId && e.status !== 'draft' && e.status !== 'archived').length
    };
}

/**
 * @param {string | undefined} seriesId
 * @returns {number | null}
 */
export function getSeriesCompletionPercent(seriesId) {
    if (!seriesId || !hasWatchProgressData()) return null;
    const series = getSeriesById(seriesId);
    if (!series) return null;

    const episodes = series.seasons.flatMap((s) => s.episodes);
    if (!episodes.length) return null;

    let weighted = 0;
    let counted = 0;
    for (const ep of episodes) {
        const pct = getStoredWatchPercent(ep.episodeId, ep.reelId || undefined);
        if (pct != null) {
            weighted += pct;
            counted += 1;
        }
    }
    if (!counted) return null;
    return Math.round(weighted / episodes.length);
}

/**
 * @param {string | undefined} episodeId
 * @returns {{ series: import('./seriesTypes.js').Series; season: import('./seriesTypes.js').Season; episode: import('./seriesTypes.js').Episode } | null}
 */
export function getNextEpisodePreview(episodeId) {
    const next = episodeId ? getNextEpisode(episodeId) : undefined;
    return next ?? null;
}

/**
 * @param {{ series: { id?: string; releaseYear?: number }; episode: { episodeId: string; reelId?: string | null; status?: string } } | null | undefined} ctx
 */
export function buildSeriesIntelligence(ctx) {
    if (!ctx) {
        return {
            genre: '',
            releaseYear: null,
            displayStatus: null,
            continuePercent: null,
            completionPercent: null,
            totalEpisodes: null,
            publishedEpisodes: null,
            nextEpisode: null
        };
    }

    const reelId = ctx.episode.reelId || '';
    const seriesId = ctx.series?.id;
    const counts = getSeriesEpisodeCounts(seriesId);
    const nextEpisode = getNextEpisodePreview(ctx.episode.episodeId);

    return {
        genre: resolveGenreLabel(ctx),
        releaseYear: getReleaseYear(ctx),
        displayStatus: resolveDisplayEpisodeStatus(ctx.episode, reelId || undefined),
        continuePercent: getContinueWatchingPercent(ctx.episode.episodeId, reelId || undefined),
        completionPercent: getSeriesCompletionPercent(seriesId),
        totalEpisodes: counts.totalEpisodes || null,
        publishedEpisodes: counts.publishedEpisodes || null,
        nextEpisode
    };
}
