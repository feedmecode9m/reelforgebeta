/**
 * Feed ↔ episode binding and reel resolution (Phase 6).
 */

import { get } from 'svelte/store';
import {
    bindEpisodeToFeedReel,
    getEpisodeById,
    getReelSeriesMetadata,
    reelSeriesMetadata,
    seriesCatalog
} from './seriesStore.js';
import { loadReelSeriesMetadataMap } from './seriesMetadataStorage.js';
import { logEpisodeBridgeDiag } from './episodeBridgeDiagnostics.js';

/**
 * @param {Record<string, unknown>} reel
 * @param {{ series: { id?: string }; season: { seasonNumber: number; seasonId?: string }; episode: { episodeId: string; episodeNumber: number } }} ctx
 * @returns {Record<string, unknown>}
 */
export function applyEpisodeFieldsToReel(reel, ctx) {
    if (!reel || !ctx) return reel;
    return {
        ...reel,
        episodeId: ctx.episode.episodeId,
        episode_id: ctx.episode.episodeId,
        seriesId: ctx.series.id,
        series_id: ctx.series.id,
        seasonNumber: ctx.season.seasonNumber,
        season_number: ctx.season.seasonNumber,
        seasonId: ctx.season.seasonId || `season-${ctx.series.id}-${ctx.season.seasonNumber}`,
        episodeNumber: ctx.episode.episodeNumber,
        episode_number: ctx.episode.episodeNumber
    };
}

/**
 * @param {string} a
 * @param {string} b
 */
function titlesMatch(a, b) {
    const norm = (s) =>
        String(s || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * @param {Record<string, unknown>} feedReel
 * @returns {{ series: import('./seriesTypes.js').Series; season: import('./seriesTypes.js').Season; episode: import('./seriesTypes.js').Episode } | undefined}
 */
function findEpisodeCandidateForFeedReel(feedReel) {
    const reelName = String(feedReel.name || feedReel.title || '').trim();
    const reelId = feedReel.id == null ? '' : String(feedReel.id);

    for (const series of get(seriesCatalog)) {
        for (const season of series.seasons) {
            for (const episode of season.episodes) {
                if (episode.reelId === reelId) {
                    return { series, season, episode };
                }
                if (titlesMatch(reelName, episode.title)) {
                    return { series, season, episode };
                }
            }
        }
    }
    return undefined;
}

/**
 * @param {string} feedReelId
 * @param {string} episodeId
 * @param {string} source
 */
export function bridgeReelToEpisode(feedReelId, episodeId, source = 'bridge') {
    const bound = bindEpisodeToFeedReel(feedReelId, episodeId);
    const ctx = getEpisodeById(episodeId);
    logEpisodeBridgeDiag('EPISODE_BRIDGE', {
        source,
        reelId: feedReelId,
        episodeId,
        seriesId: ctx?.series?.id ?? null,
        seasonNumber: ctx?.season?.seasonNumber ?? null,
        episodeNumber: ctx?.episode?.episodeNumber ?? null,
        bound
    });
    return bound;
}

/**
 * @param {Record<string, unknown>[]} feedReels
 * @returns {{ bound: number; unresolved: string[]; coveragePercent: number }}
 */
export function bridgeFeedReelsToCatalog(feedReels = []) {
    const map = loadReelSeriesMetadataMap();
    let bound = 0;
    /** @type {string[]} */
    const unresolved = [];

    for (const reel of feedReels) {
        if (!reel?.id) continue;
        const reelId = String(reel.id);
        const existingEpisodeId = reel.episodeId || reel.episode_id;

        if (existingEpisodeId) {
            if (bridgeReelToEpisode(reelId, String(existingEpisodeId), 'feed-episode-field')) {
                bound += 1;
            } else {
                unresolved.push(reelId);
            }
            continue;
        }

        const meta = map[reelId] || get(reelSeriesMetadata)[reelId];
        if (meta?.episodeId) {
            if (bridgeReelToEpisode(reelId, meta.episodeId, 'studio-metadata')) {
                bound += 1;
            } else {
                unresolved.push(reelId);
            }
            continue;
        }

        const candidate = findEpisodeCandidateForFeedReel(reel);
        if (candidate && bridgeReelToEpisode(reelId, candidate.episode.episodeId, 'title-match')) {
            bound += 1;
            continue;
        }

        unresolved.push(reelId);
        logEpisodeBridgeDiag('EPISODE_BRIDGE', {
            source: 'unresolved',
            reelId,
            episodeId: null,
            reelTitle: reel.name || reel.title || null
        });
    }

    const total = feedReels.filter((r) => r?.id).length;
    const coveragePercent = total ? Math.round((bound / total) * 100) : 0;

    return { bound, unresolved, coveragePercent };
}

/**
 * @param {Record<string, unknown>[]} feedReels
 */
export function auditEpisodeBridgeCoverage(feedReels = []) {
    const total = feedReels.filter((r) => r?.id).length;
    let linked = 0;
    /** @type {string[]} */
    const unresolved = [];

    for (const reel of feedReels) {
        if (!reel?.id) continue;
        const reelId = String(reel.id);
        const meta = getReelSeriesMetadata(reelId);
        const episodeId = reel.episodeId || reel.episode_id || meta?.episodeId;

        if (episodeId && getEpisodeById(String(episodeId))) {
            linked += 1;
        } else {
            unresolved.push(reelId);
        }
    }

    return {
        total,
        linked,
        unresolved,
        coveragePercent: total ? Math.round((linked / total) * 100) : 0
    };
}

/**
 * @param {string} episodeId
 * @param {(reelId: string) => Record<string, unknown> | null | undefined} findReelInFeed
 * @param {() => Record<string, unknown>[]} [getAllFeedReels]
 * @returns {Record<string, unknown> | null}
 */
export function resolveReelForEpisode(episodeId, findReelInFeed, getAllFeedReels) {
    if (!episodeId) return null;
    const ctx = getEpisodeById(episodeId);
    if (!ctx) return null;

    const tryIds = new Set();
    if (ctx.episode.reelId) tryIds.add(String(ctx.episode.reelId));

    const metaMap = { ...loadReelSeriesMetadataMap(), ...get(reelSeriesMetadata) };
    for (const [reelId, meta] of Object.entries(metaMap)) {
        if (meta.episodeId === episodeId) tryIds.add(reelId);
    }

    for (const reelId of tryIds) {
        const reel = findReelInFeed(reelId);
        if (reel) return applyEpisodeFieldsToReel(reel, ctx);
    }

    const feedReels = typeof getAllFeedReels === 'function' ? getAllFeedReels() : [];
    for (const reel of feedReels) {
        if (!reel?.id) continue;
        const linkedEpisodeId = reel.episodeId || reel.episode_id;
        if (linkedEpisodeId && String(linkedEpisodeId) === episodeId) {
            return applyEpisodeFieldsToReel(reel, ctx);
        }
    }

    const episodeTitle = ctx.episode.title;
    for (const reel of feedReels) {
        if (!reel?.id) continue;
        if (titlesMatch(String(reel.name || reel.title || ''), episodeTitle)) {
            return applyEpisodeFieldsToReel(reel, ctx);
        }
    }

    return null;
}
