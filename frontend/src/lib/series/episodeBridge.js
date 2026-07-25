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

const PERSONAL_VIDEO_VAULT_KEY = 'personal_video_vault';
const FEED_STORAGE_KEY = 'reelforge_feed';

/**
 * @param {Record<string, unknown> | null | undefined} reel
 */
function resolveReelMediaUrl(reel) {
    return String(reel?.url || reel?.video_url || reel?.videoUrl || '').trim();
}

/** @param {Record<string, unknown> | null | undefined} reel */
function isPlayableReel(reel) {
    return Boolean(reel?.id && resolveReelMediaUrl(reel));
}

/**
 * @param {{
 *   episodeId?: string | null;
 *   attemptedSources?: string[];
 *   matchedSource?: string;
 *   matchedReelId?: string;
 *   matchedVideoUrl?: string;
 * }} payload
 */
function logHeroIdentityResolution(payload) {
    console.info('[HERO_IDENTITY_RESOLUTION]', {
        episodeId: payload.episodeId || null,
        attemptedSources: payload.attemptedSources || [],
        matchedSource: payload.matchedSource || '',
        matchedReelId: payload.matchedReelId || '',
        matchedVideoUrl: payload.matchedVideoUrl || ''
    });
}

/** @returns {Record<string, unknown>[]} */
function loadCanonicalUploadRegistry() {
    if (typeof window === 'undefined') return [];
    /** @type {Record<string, unknown>[]} */
    const entries = [];
    /** @type {Set<string>} */
    const seen = new Set();

    const pushEntry = (reel) => {
        if (!reel || typeof reel !== 'object' || !reel.id) return;
        const id = String(reel.id);
        if (seen.has(id)) return;
        seen.add(id);
        entries.push(reel);
    };

    try {
        const vaultRaw = localStorage.getItem(PERSONAL_VIDEO_VAULT_KEY);
        if (vaultRaw) {
            const vault = JSON.parse(vaultRaw);
            if (Array.isArray(vault)) vault.forEach(pushEntry);
        }
    } catch {
        /* ignore corrupt vault cache */
    }

    try {
        const feedRaw = localStorage.getItem(FEED_STORAGE_KEY);
        if (feedRaw) {
            const feed = JSON.parse(feedRaw);
            if (Array.isArray(feed)) feed.forEach(pushEntry);
            else if (feed && typeof feed === 'object') {
                for (const shelf of Object.values(feed)) {
                    if (Array.isArray(shelf)) shelf.forEach(pushEntry);
                }
            }
        }
    } catch {
        /* ignore corrupt feed cache */
    }

    return entries.filter(isPlayableReel);
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

    /** @type {string[]} */
    const attemptedSources = [];

    const finish = (reel, matchedSource) => {
        const matched = applyEpisodeFieldsToReel(reel, ctx);
        logHeroIdentityResolution({
            episodeId,
            attemptedSources,
            matchedSource,
            matchedReelId: String(matched?.id || ''),
            matchedVideoUrl: resolveReelMediaUrl(matched)
        });
        return matched;
    };

    const tryFeedReelId = (reelId, sourceLabel) => {
        if (!reelId) return null;
        attemptedSources.push(sourceLabel);
        const reel = findReelInFeed(reelId);
        return isPlayableReel(reel) ? reel : null;
    };

    /** @type {Set<string>} */
    const knownReelIds = new Set();
    if (ctx.episode.reelId) knownReelIds.add(String(ctx.episode.reelId));

    const metaMap = { ...loadReelSeriesMetadataMap(), ...get(reelSeriesMetadata) };
    /** @type {string[]} */
    const metaReelIds = [];
    for (const [reelId, meta] of Object.entries(metaMap)) {
        if (meta.episodeId === episodeId) {
            knownReelIds.add(reelId);
            metaReelIds.push(reelId);
        }
    }

    if (ctx.episode.reelId) {
        const reel = tryFeedReelId(String(ctx.episode.reelId), 'catalog.reelId');
        if (reel) return finish(reel, 'catalog.reelId');
    }

    for (const reelId of metaReelIds) {
        const reel = tryFeedReelId(reelId, `metadata.episodeId:${reelId}`);
        if (reel) return finish(reel, 'metadata.episodeId');
    }

    const feedReels = typeof getAllFeedReels === 'function' ? getAllFeedReels() : [];
    attemptedSources.push(`feed.episodeId:${episodeId}`);
    for (const reel of feedReels) {
        if (!isPlayableReel(reel)) continue;
        const linkedEpisodeId = reel.episodeId || reel.episode_id;
        if (linkedEpisodeId && String(linkedEpisodeId) === episodeId) {
            return finish(reel, 'feed.episodeId');
        }
    }

    const uploadRegistry = loadCanonicalUploadRegistry();
    attemptedSources.push('uploadRegistry.episodeId');
    for (const reel of uploadRegistry) {
        const linkedEpisodeId = reel.episodeId || reel.episode_id;
        if (linkedEpisodeId && String(linkedEpisodeId) === episodeId) {
            return finish(reel, 'uploadRegistry.episodeId');
        }
    }

    attemptedSources.push('uploadRegistry.reelId');
    for (const reelId of knownReelIds) {
        const registryReel = uploadRegistry.find(
            (reel) => String(reel.id) === reelId || String(reel.reelId || '') === reelId
        );
        if (isPlayableReel(registryReel)) {
            return finish(registryReel, 'uploadRegistry.reelId');
        }
    }

    const episodeTitle = ctx.episode.title;
    attemptedSources.push(`feed.title:${episodeTitle}`);
    for (const reel of feedReels) {
        if (!isPlayableReel(reel)) continue;
        if (titlesMatch(String(reel.name || reel.title || ''), episodeTitle)) {
            return finish(reel, 'feed.title');
        }
    }

    attemptedSources.push(`uploadRegistry.title:${episodeTitle}`);
    for (const reel of uploadRegistry) {
        if (!isPlayableReel(reel)) continue;
        if (titlesMatch(String(reel.name || reel.title || ''), episodeTitle)) {
            return finish(reel, 'uploadRegistry.title');
        }
    }

    logHeroIdentityResolution({
        episodeId,
        attemptedSources,
        matchedSource: '',
        matchedReelId: '',
        matchedVideoUrl: ''
    });
    return null;
}
