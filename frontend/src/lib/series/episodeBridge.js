/**
 * Feed ↔ episode binding and reel resolution (Phase 6).
 */

import { get } from 'svelte/store';
import {
    bindEpisodeToFeedReel,
    getEpisodeById,
    getEpisodeByReelId,
    getReelSeriesMetadata,
    reelSeriesMetadata,
    rehydrateEpisodeVaultBindings,
    seriesCatalog
} from './seriesStore.js';
import { episodeIsPlayable } from './seriesTypes.js';
import { loadReelSeriesMetadataMap } from './seriesMetadataStorage.js';
import { logEpisodeBridgeDiag } from './episodeBridgeDiagnostics.js';
import { inferAndBindVaultSeries } from './vaultSeriesInference.js';
import { resolveContentIdentity } from '../content/contentIdentityResolver.js';

/** Permanent bind weights — AI-only matches must never bind. */
export const MATCH_WEIGHTS = Object.freeze({
    exactTitle: 100,
    reelId: 100,
    creatorKeywords: 80,
    aiTags: 40
});

/** Minimum score for permanent catalog bind (creator keywords and above). */
export const MIN_PERMANENT_BIND_SCORE = 80;

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
 * @param {string} value
 */
function tokenizeIdentity(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2);
}

/**
 * Weighted identity score between a reel/creator identity and an episode.
 * exact title = 100 · reelId = 100 · creator keywords = 80 · AI tags = 40
 *
 * @param {Record<string, unknown>} feedReel
 * @param {import('./seriesTypes.js').Episode} episode
 * @returns {{ score: number; reason: string }}
 */
export function scoreEpisodeIdentityMatch(feedReel, episode) {
    const reelId = feedReel?.id == null ? '' : String(feedReel.id);
    if (reelId && episode?.reelId && String(episode.reelId) === reelId) {
        return { score: MATCH_WEIGHTS.reelId, reason: 'reelId' };
    }

    const identity = reelId
        ? resolveContentIdentity(reelId, { reel: feedReel })
        : {
              title: String(feedReel?.name || feedReel?.title || ''),
              episodeTitle: String(feedReel?.name || feedReel?.title || ''),
              keywords: [],
              tags: []
          };

    const reelTitle = String(
        identity.episodeTitle || identity.title || feedReel?.name || feedReel?.title || ''
    ).trim();
    const episodeTitle = String(episode?.title || '').trim();

    if (reelTitle && episodeTitle) {
        const norm = (s) =>
            s
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
                .trim();
        if (norm(reelTitle) === norm(episodeTitle)) {
            return { score: MATCH_WEIGHTS.exactTitle, reason: 'exactTitle' };
        }
        if (titlesMatch(reelTitle, episodeTitle)) {
            // Soft title overlap treated as creator-keyword strength (not permanent auto AI)
            return { score: MATCH_WEIGHTS.creatorKeywords, reason: 'titleOverlap' };
        }
    }

    const creatorTokens = new Set([
        ...tokenizeIdentity(identity.title),
        ...tokenizeIdentity(identity.episodeTitle),
        ...((identity.keywords || []).filter(Boolean).map((k) => String(k).toLowerCase()))
    ]);
    // Keywords explicitly marked as AI enrichment only (lower weight)
    const aiTokens = new Set(
        (Array.isArray(feedReel?.aiTags) ? feedReel.aiTags : [])
            .map((t) => String(t).toLowerCase())
            .filter(Boolean)
    );

    const episodeTokens = new Set(tokenizeIdentity(episodeTitle));
    if (!episodeTokens.size) return { score: 0, reason: 'none' };

    let creatorHits = 0;
    for (const token of episodeTokens) {
        if (creatorTokens.has(token)) creatorHits += 1;
    }
    if (creatorHits >= 2 || (creatorHits === 1 && creatorTokens.size <= 3 && episodeTokens.size <= 4)) {
        return { score: MATCH_WEIGHTS.creatorKeywords, reason: 'creatorKeywords' };
    }

    let aiHits = 0;
    for (const token of episodeTokens) {
        if (aiTokens.has(token)) aiHits += 1;
    }
    if (aiHits > 0) {
        return { score: MATCH_WEIGHTS.aiTags, reason: 'aiTags' };
    }

    return { score: 0, reason: 'none' };
}

/**
 * @param {Record<string, unknown>} feedReel
 * @returns {{ series: import('./seriesTypes.js').Series; season: import('./seriesTypes.js').Season; episode: import('./seriesTypes.js').Episode; score: number; reason: string } | undefined}
 */
function findEpisodeCandidateForFeedReel(feedReel) {
    const reelId = feedReel.id == null ? '' : String(feedReel.id);

    /** @type {{ series: import('./seriesTypes.js').Series; season: import('./seriesTypes.js').Season; episode: import('./seriesTypes.js').Episode; score: number; reason: string } | null} */
    let best = null;

    for (const series of get(seriesCatalog)) {
        for (const season of series.seasons) {
            for (const episode of season.episodes) {
                const { score, reason } = scoreEpisodeIdentityMatch(feedReel, episode);
                if (score <= 0) continue;
                if (!best || score > best.score) {
                    best = { series, season, episode, score, reason };
                }
                // Perfect reelId / exact title — stop early
                if (score >= MATCH_WEIGHTS.reelId) {
                    return best;
                }
            }
        }
    }

    // Never permanently bind on AI-only weight (40)
    if (!best || best.score < MIN_PERMANENT_BIND_SCORE) {
        if (best && best.score > 0) {
            logEpisodeBridgeDiag('EPISODE_BRIDGE', {
                source: 'identity-match-skipped',
                reelId,
                episodeId: best.episode.episodeId,
                score: best.score,
                reason: best.reason,
                note: 'AI-only or weak match — not permanently bound'
            });
        }
        return undefined;
    }

    logEpisodeBridgeDiag('EPISODE_BRIDGE', {
        source: 'identity-match',
        reelId,
        episodeId: best.episode.episodeId,
        score: best.score,
        reason: best.reason
    });
    return best;
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
        if (
            candidate &&
            bridgeReelToEpisode(
                reelId,
                candidate.episode.episodeId,
                candidate.reason === 'creatorKeywords' || candidate.reason === 'titleOverlap'
                    ? 'creator-identity-match'
                    : 'title-match'
            )
        ) {
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

    // High-confidence vault title groups → canonical catalog bindings (no mock edits).
    const inference = inferAndBindVaultSeries(feedReels, { source: 'bridgeFeedReelsToCatalog' });
    // Restore any persisted Hero Vault manual overrides after inference mutates catalog.
    rehydrateEpisodeVaultBindings();

    // Recount after inference wrote reelId + metadata via seriesStore APIs.
    bound = 0;
    unresolved.length = 0;
    for (const reel of feedReels) {
        if (!reel?.id) continue;
        const reelId = String(reel.id);
        const meta = map[reelId] || get(reelSeriesMetadata)[reelId] || getReelSeriesMetadata(reelId);
        if (getEpisodeByReelId(reelId) || meta?.episodeId || reel.episodeId || reel.episode_id) {
            bound += 1;
        } else {
            unresolved.push(reelId);
        }
    }

    const total = feedReels.filter((r) => r?.id).length;
    const coveragePercent = total ? Math.round((bound / total) * 100) : 0;

    return {
        bound,
        unresolved,
        coveragePercent,
        inferred: inference.bound,
        inferredSeriesIds: inference.seriesIds
    };
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
 * Catalog playability gate — single authority for Theater media resolve.
 * draft / archived (or missing reelId) must not return playable media.
 * @param {import('./seriesTypes.js').Episode | null | undefined} episode
 * @param {string} episodeId
 * @param {string | null | undefined} [seriesId]
 * @returns {boolean} true when resolve may proceed
 */
export function assertEpisodePlayableForResolve(episode, episodeId, seriesId = null) {
    if (episodeIsPlayable(episode)) return true;
    const status = episode?.status;
    if (status === 'draft' || status === 'archived') {
        console.info('[EPISODE_PLAYABILITY_BLOCKED]', {
            episodeId,
            seriesId: seriesId || null,
            reason: status,
            reelId: episode?.reelId || null,
            ts: new Date().toISOString()
        });
    }
    return false;
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

    // Status + reelId gate (draft/archived never return media even if forced through nav)
    if (!assertEpisodePlayableForResolve(ctx.episode, episodeId, ctx.series?.id)) {
        return null;
    }

    /** @type {string[]} */
    const attemptedSources = [];

    const finish = (reel, matchedSource) => {
        const matched = applyEpisodeFieldsToReel(reel, ctx);
        const mediaId = String(matched?.id || '');
        const mediaUrl = resolveReelMediaUrl(matched);
        console.info('[SERIES_MEDIA_MATCH]', {
            seriesId: ctx.series?.id || null,
            episodeId,
            mediaId,
            matchedSource,
            source: 'resolveReelForEpisode',
            ts: new Date().toISOString()
        });
        logHeroIdentityResolution({
            episodeId,
            attemptedSources,
            matchedSource,
            matchedReelId: mediaId,
            matchedVideoUrl: mediaUrl
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

    // Creator identity keyword match (score >= 80). Never bind permanently on AI-only (40).
    attemptedSources.push('creator.identity:keywords');
    /** @type {{ reel: Record<string, unknown>; score: number; reason: string } | null} */
    let bestIdentity = null;
    const considerIdentity = (reel) => {
        if (!isPlayableReel(reel)) return;
        const { score, reason } = scoreEpisodeIdentityMatch(reel, ctx.episode);
        if (score < MIN_PERMANENT_BIND_SCORE) return;
        if (!bestIdentity || score > bestIdentity.score) {
            bestIdentity = { reel, score, reason };
        }
    };
    for (const reel of feedReels) considerIdentity(reel);
    for (const reel of uploadRegistry) considerIdentity(reel);
    if (bestIdentity) {
        return finish(bestIdentity.reel, `creator.identity:${bestIdentity.reason}`);
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
