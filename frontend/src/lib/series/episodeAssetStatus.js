/**
 * Episode asset status — Studio source of truth for reel attachment (Phase 7A).
 */

import { get } from 'svelte/store';
import { seriesCatalog, getReelSeriesMetadata } from './seriesStore.js';
import { episodeHasReel } from './seriesTypes.js';
import { logEpisodeAssetDiag } from './episodeAssetDiagnostics.js';

/** @typedef {'Draft' | 'Missing Asset' | 'Ready' | 'Scheduled' | 'Published'} EpisodeAssetDisplayStatus */

/**
 * @typedef {Object} EpisodeAssetRecord
 * @property {string} seriesId
 * @property {string} seasonId
 * @property {number} seasonNumber
 * @property {string} episodeId
 * @property {number} episodeNumber
 * @property {string} episodeTitle
 * @property {string | null} reelId
 * @property {string | null} reelUuid
 * @property {string | null} attachedReelTitle
 * @property {string | null} thumbnailUrl
 * @property {number | null} runtime
 * @property {EpisodeAssetDisplayStatus} status
 * @property {boolean} reelInFeed
 */

/**
 * @param {Record<string, unknown>[]} feedReels
 * @param {string | null | undefined} reelId
 */
function findFeedReel(feedReels, reelId) {
    if (!reelId) return null;
    return feedReels.find((r) => String(r.id) === String(reelId)) || null;
}

/**
 * @param {import('./seriesTypes.js').Episode} episode
 * @param {Record<string, unknown> | null} feedReel
 * @returns {EpisodeAssetDisplayStatus}
 */
export function resolveEpisodeAssetStatus(episode, feedReel) {
    const hasReel = episodeHasReel(episode);
    const reelResolved = Boolean(feedReel);

    if (!hasReel || !reelResolved) return 'Missing Asset';
    if (episode.status === 'published') return 'Published';
    if (episode.status === 'ready') return 'Ready';
    if (episode.status === 'draft') return 'Scheduled';
    return 'Draft';
}

/**
 * @param {Record<string, unknown>[]} [feedReels]
 * @returns {EpisodeAssetRecord[]}
 */
export function buildEpisodeAssetRecords(feedReels = []) {
    /** @type {EpisodeAssetRecord[]} */
    const records = [];

    for (const series of get(seriesCatalog)) {
        for (const season of series.seasons) {
            const seasonId = season.seasonId || `season-${series.id}-${season.seasonNumber}`;
            for (const episode of season.episodes) {
                const reelId = episode.reelId || null;
                const feedReel = findFeedReel(feedReels, reelId);
                const studio = reelId ? getReelSeriesMetadata(reelId) : null;
                const thumbnailUrl =
                    (feedReel && (feedReel.thumbnailUrl || feedReel.thumbnail_url)) ||
                    (series.poster ? String(series.poster) : null);

                records.push({
                    seriesId: series.id,
                    seasonId,
                    seasonNumber: season.seasonNumber,
                    episodeId: episode.episodeId,
                    episodeNumber: episode.episodeNumber,
                    episodeTitle: episode.title,
                    reelId,
                    reelUuid: reelId,
                    attachedReelTitle: feedReel
                        ? String(feedReel.title || feedReel.name || reelId)
                        : studio?.episodeTitle || null,
                    thumbnailUrl: thumbnailUrl ? String(thumbnailUrl) : null,
                    runtime: studio?.runtime ?? episode.runtime ?? null,
                    status: resolveEpisodeAssetStatus(episode, feedReel),
                    reelInFeed: Boolean(feedReel)
                });
            }
        }
    }

    return records;
}

/**
 * @param {Record<string, unknown>[]} [feedReels]
 */
export function computeEpisodeAssetCoverage(feedReels = [], seriesId) {
    const records = seriesId
        ? buildEpisodeAssetRecords(feedReels).filter((r) => r.seriesId === seriesId)
        : buildEpisodeAssetRecords(feedReels);
    const total = records.length;
    const withAssets = records.filter((r) => r.status !== 'Missing Asset' && r.reelInFeed).length;
    const missing = records.filter((r) => r.status === 'Missing Asset');
    const attached = records.filter((r) => r.reelId && r.reelInFeed);

    return {
        totalEpisodes: total,
        episodesWithAssets: withAssets,
        episodesMissingAssets: missing.length,
        coveragePercent: total ? Math.round((withAssets / total) * 100) : 0,
        records,
        missing,
        attached
    };
}

/**
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {boolean} [emitLogs]
 */
export function auditEpisodeAssets(feedReels = [], emitLogs = true) {
    const coverage = computeEpisodeAssetCoverage(feedReels);

    if (emitLogs) {
        for (const record of coverage.records) {
            logEpisodeAssetDiag('EPISODE_ASSET_AUDIT', {
                seriesId: record.seriesId,
                seasonId: record.seasonId,
                episodeId: record.episodeId,
                reelId: record.reelId,
                status: record.status
            });
        }
        logEpisodeAssetDiag('EPISODE_ASSET_AUDIT', {
            summary: true,
            totalEpisodes: coverage.totalEpisodes,
            episodesWithAssets: coverage.episodesWithAssets,
            episodesMissingAssets: coverage.episodesMissingAssets,
            coveragePercent: coverage.coveragePercent
        });
    }

    return coverage;
}
