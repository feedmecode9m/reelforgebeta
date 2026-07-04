/**
 * Phase 58 — Dynamic Homepage Feed.
 * Living homepage intelligence across discovery, operations, security, and monetization domains.
 */

import { get } from 'svelte/store';
import { seriesCatalog, getEpisodeById, reelSeriesMetadata } from '../series/seriesStore.js';
import { searchMarketplaceListings, listOpenMarketplaceGigs } from '../marketplace/marketplaceEngine.js';
import { loadReleaseScheduleMap } from '../release/releaseCenter.js';
import { getNotifications } from '../notifications/notificationCenter.js';
import { getThreatSnapshot, loadSecurityEvents } from '../security/threatDetectionEngine.js';
import { masterAnalysis } from '../sentinel/sentinelAssistant.js';
import { masterMonetizationAnalysis } from '../revenue/monetizationAI.js';
import { TEAM_STORAGE_KEY } from '../teams/creatorTeams.js';
import { loadWatchProgressMap } from '../series/seriesWatchProgress.js';
import { indexPlatformData, searchPlatform } from './discoveryEngine.js';

export const HOMEPAGE_FEED_VERSION = '1.0.0';
export const HOMEPAGE_FEED_STORAGE_KEY = 'reelforge_homepage_discovery_feed';

/**
 * @param {'HOME_FEED' | 'HOME_FEED_REFRESH'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logHomeFeedDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {Record<string, unknown>[]} */
function loadFeedReelsFromStorage() {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem('reelforge_feed');
        const parsed = raw ? JSON.parse(raw) : {};
        const reels = [];
        for (const category of Object.keys(parsed || {})) {
            for (const reel of parsed[category] || []) {
                if (reel && reel.id) reels.push(reel);
            }
        }
        return reels;
    } catch {
        return [];
    }
}

/** @param {string} [seriesId] */
function resolveSeriesId(seriesId) {
    if (seriesId) return seriesId;
    const catalog = get(seriesCatalog);
    return catalog[0]?.id || 'series-neon-vengeance';
}

/** @param {string} key @param {number} percent */
function resolveContinueWatchingItem(key, percent) {
    const episodeCtx = getEpisodeById(key);
    if (episodeCtx?.episode) {
        const episode = episodeCtx.episode;
        return {
            id: `continue:${key}`,
            title: episode.title || key,
            detail: `Continue at ${percent}%`,
            percent,
            episodeId: episode.episodeId,
            reelId: episode.reelId || null
        };
    }

    const metadata = get(reelSeriesMetadata)?.[key];
    if (metadata) {
        return {
            id: `continue:${key}`,
            title: metadata.episodeTitle || metadata.seriesName || key,
            detail: `Continue at ${percent}%`,
            percent,
            episodeId: metadata.episodeId || null,
            reelId: key
        };
    }

    return {
        id: `continue:${key}`,
        title: key,
        detail: `Continue at ${percent}%`,
        percent,
        episodeId: null,
        reelId: null
    };
}

/** @param {number} limit */
function buildContinueWatching(limit = 8) {
    const map = loadWatchProgressMap();
    const entries = Object.entries(map)
        .map(([key, value]) => [key, Number(value)])
        .filter(([, percent]) => Number.isFinite(percent) && percent > 0 && percent < 100)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, percent]) => resolveContinueWatchingItem(key, percent));
    return entries;
}

/** @param {number} limit */
function buildTrending(limit = 8) {
    const response = searchPlatform('trending popular episodes marketplace security');
    return response.results.slice(0, limit).map((result) => ({
        id: `trending:${result.id}`,
        title: result.title,
        detail: `${result.source} · score ${Math.round(result.score)}`,
        source: result.source,
        score: result.score
    }));
}

/** @param {number} limit */
function buildRecentlyUploaded(limit = 8) {
    const indexed = indexPlatformData();
    return indexed.docs
        .filter((doc) => doc.source === 'vault' || doc.source === 'episode')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .map((doc) => ({
            id: `uploaded:${doc.id}`,
            title: doc.title,
            detail: doc.source === 'vault' ? 'Vault upload' : 'Episode media',
            updatedAt: doc.updatedAt
        }));
}

/** @param {number} limit */
function buildTeamActivity(limit = 8) {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(TEAM_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : { activity: {} };
        const activityRows = Object.values(parsed.activity || {}).flat();
        return activityRows
            .sort((a, b) => Number(b.createdAt || b.updatedAt || 0) - Number(a.createdAt || a.updatedAt || 0))
            .slice(0, limit)
            .map((row, index) => ({
                id: `team:${row.id || index}`,
                title: row.title || row.type || 'Team update',
                detail: row.message || row.detail || row.user || 'New team activity',
                createdAt: Number(row.createdAt || row.updatedAt || Date.now())
            }));
    } catch {
        return [];
    }
}

/** @param {number} limit */
function buildUpcomingReleases(limit = 8) {
    const now = Date.now();
    const releases = Object.values(loadReleaseScheduleMap())
        .filter((entry) => Number(entry.releaseAt) > now)
        .sort((a, b) => Number(a.releaseAt) - Number(b.releaseAt))
        .slice(0, limit);
    return releases.map((entry) => ({
        id: `release:${entry.episodeId}`,
        title: entry.episodeId,
        detail: `${entry.releaseTime || '00:00'} · ${new Date(entry.releaseAt).toLocaleDateString()}`,
        releaseAt: entry.releaseAt,
        seriesId: entry.seriesId
    }));
}

/** @param {number} limit */
function buildMarketplaceOpportunities(limit = 6) {
    const listingRows = searchMarketplaceListings({ activeOnly: true })
        .slice(0, Math.max(0, limit - 2))
        .map((listing) => ({
            id: `market:${listing.listingId}`,
            title: listing.service.title,
            detail: listing.categoryLabel || listing.service.category || 'Marketplace listing'
        }));
    const gigRows = listOpenMarketplaceGigs().slice(0, 2).map((gig) => ({
        id: `market-gig:${gig.gigId}`,
        title: gig.title,
        detail: `Open gig · ${gig.status}`
    }));
    return [...gigRows, ...listingRows].slice(0, limit);
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 * @param {number} limit
 */
function buildCreatorRecommendations(seriesId, feedReels, limit = 6) {
    const analysis = masterMonetizationAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    return analysis.recommendations.slice(0, limit).map((recommendation) => ({
        id: `creator:${recommendation.id}`,
        title: recommendation.title,
        detail: recommendation.detail,
        category: recommendation.category
    }));
}

/** @param {number} limit */
function buildSecurityAlerts(limit = 6) {
    const threat = getThreatSnapshot();
    const active = threat.activeThreats.slice(0, Math.max(0, limit - 2)).map((item) => ({
        id: `alert:${item.id}`,
        title: item.title,
        detail: `${item.level} · ${item.detail}`,
        level: item.level
    }));
    const events = loadSecurityEvents()
        .events.slice(-2)
        .reverse()
        .map((event) => ({
            id: `alert-event:${event.id}`,
            title: `${event.category} ${event.type}`,
            detail: `Detected ${new Date(event.timestamp).toLocaleTimeString()}`
        }));
    return [...active, ...events].slice(0, limit);
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 * @param {number} limit
 */
function buildSentinelRecommendations(seriesId, feedReels, limit = 6) {
    const sentinel = masterAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    return sentinel.recommendations.slice(0, limit).map((recommendation, index) => ({
        id: `sentinel:${seriesId}:${index}`,
        title: `Sentinel Recommendation ${index + 1}`,
        detail: recommendation
    }));
}

/** @returns {Record<string, unknown> | null} */
export function loadHomepageFeedStore() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(HOMEPAGE_FEED_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/** @param {Record<string, unknown>} state */
export function persistHomepageFeedStore(state) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(HOMEPAGE_FEED_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent('reelforge:home-feed-updated', { detail: state }));
}

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 */
export function buildHomepageFeed(options = {}) {
    const seriesId = resolveSeriesId(options.seriesId);
    const feedReels = Array.isArray(options.feedReels) ? options.feedReels : loadFeedReelsFromStorage();

    const state = {
        version: HOMEPAGE_FEED_VERSION,
        updatedAt: Date.now(),
        seriesId,
        sections: {
            continueWatching: buildContinueWatching(),
            trending: buildTrending(),
            recentlyUploaded: buildRecentlyUploaded(),
            newTeamActivity: buildTeamActivity(),
            upcomingReleases: buildUpcomingReleases(),
            marketplaceOpportunities: buildMarketplaceOpportunities(),
            creatorRecommendations: buildCreatorRecommendations(seriesId, feedReels),
            securityAlerts: buildSecurityAlerts(),
            sentinelRecommendations: buildSentinelRecommendations(seriesId, feedReels)
        }
    };

    persistHomepageFeedStore(state);
    logHomeFeedDiag('HOME_FEED', {
        reason: options.reason || 'build',
        seriesId,
        sectionSizes: Object.fromEntries(
            Object.entries(state.sections).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
        )
    });
    return state;
}

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 */
export function refreshHomepageFeed(options = {}) {
    const next = buildHomepageFeed({ ...options, reason: options.reason || 'refresh' });
    logHomeFeedDiag('HOME_FEED_REFRESH', {
        reason: options.reason || 'refresh',
        updatedAt: next.updatedAt
    });
    return next;
}

let homepageFeedInitialized = false;
let refreshTimer = null;

/** @param {{ seriesId?: string; feedReels?: Record<string, unknown>[] }} [options] */
export function initHomepageDiscoveryFeed(options = {}) {
    if (typeof window === 'undefined' || homepageFeedInitialized) return null;
    homepageFeedInitialized = true;

    const scheduleRefresh = (reason) => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            refreshHomepageFeed({ ...options, reason });
        }, 120);
    };

    const refreshEvents = [
        ['reelforge:upload-updated', 'new_upload'],
        ['reelforge:workflow-tasks-updated', 'workflow_completion'],
        ['reelforge:notifications-updated', 'notification'],
        ['reelforge:release-schedule-updated', 'release_schedule_change'],
        ['reelforge:marketplace-updated', 'marketplace_listing']
    ];

    for (const [eventName, reason] of refreshEvents) {
        window.addEventListener(eventName, () => scheduleRefresh(reason));
    }

    window.__reelforgeHomepageFeed = {
        HOMEPAGE_FEED_VERSION,
        HOMEPAGE_FEED_STORAGE_KEY,
        buildHomepageFeed,
        refreshHomepageFeed,
        getHomepageFeedState: loadHomepageFeedStore,
        logHomeFeedDiag
    };

    return refreshHomepageFeed({ ...options, reason: 'engine_initialized' });
}
