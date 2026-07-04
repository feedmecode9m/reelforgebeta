/**
 * Phase 64 — Creator Home Feed.
 * Dynamic, prioritized homepage cards for the Studio Overview.
 */

import { get } from 'svelte/store';
import { seriesCatalog } from '../series/seriesStore.js';
import { buildCommandCenterSnapshot } from '../command/commandCenter.js';
import { getDailyEngagementState } from '../engagement/dailyEngagement.js';
import { searchMarketplaceListings } from '../marketplace/marketplaceEngine.js';
import { buildSeriesRevenueSnapshot, formatRevenueCurrency } from '../revenue/revenueCore.js';
import { buildReleaseCenterSnapshot } from '../release/releaseCenter.js';
import { getThreatSnapshot } from '../security/threatDetectionEngine.js';
import { syncWorkflowTasks } from '../workflow/workflowEngine.js';
import { computeSeriesHealth } from '../series/productionHealth.js';

export const CREATOR_FEED_STORAGE_KEY = 'reelforge_creator_home_feed';
export const CREATOR_FEED_VERSION = '1.0.0';

/**
 * @param {Record<string, unknown>} [detail]
 */
export function logCreatorFeedDiag(detail = {}) {
    console.log(`[CREATOR_FEED] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/**
 * @typedef {'daily_engagement' | 'today_tasks' | 'marketplace_opportunities' | 'revenue_snapshot' | 'team_activity' | 'security_alerts' | 'trending_series' | 'upcoming_releases'} CreatorFeedCardKind
 */

/**
 * @typedef {Object} CreatorFeedCard
 * @property {string} id
 * @property {CreatorFeedCardKind} kind
 * @property {string} title
 * @property {string} detail
 * @property {number} importance
 * @property {Record<string, unknown> | null} [target]
 * @property {Record<string, unknown>} [meta]
 */

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

/**
 * @param {string | undefined} seriesId
 */
function resolveSeriesId(seriesId) {
    if (seriesId) return seriesId;
    const catalog = get(seriesCatalog);
    return catalog[0]?.id || 'series-neon-vengeance';
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 * @returns {CreatorFeedCard}
 */
function buildDailyEngagementCard(seriesId, feedReels) {
    const daily = getDailyEngagementState({ seriesId, feedReels, reason: 'creator_feed' });
    const tip = daily?.cards?.dailyStudioTip?.detail || 'Open Daily Engagement to get today\'s guidance.';
    return {
        id: 'creator-feed:daily-engagement',
        kind: 'daily_engagement',
        title: 'Daily Engagement',
        detail: tip,
        importance: 52,
        target: { type: 'studio_tab', tab: 'Overview', section: 'daily-engagement' },
        meta: { dayKey: daily?.dayKey || null }
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 * @returns {CreatorFeedCard}
 */
function buildTodayTasksCard(seriesId, feedReels) {
    const sync = syncWorkflowTasks(seriesId, feedReels);
    const openTasks = sync.tasks.filter((task) => task.status !== 'COMPLETE');
    const topTask = openTasks[0] || null;
    return {
        id: 'creator-feed:today-tasks',
        kind: 'today_tasks',
        title: "Today's Tasks",
        detail: topTask
            ? `${openTasks.length} open · top: ${topTask.title || topTask.id}`
            : 'No open tasks — production lane is clear.',
        importance: Math.min(98, 60 + openTasks.length * 5),
        target: {
            type: 'workflow',
            tab: 'Production',
            dashboardSection: 'production'
        },
        meta: {
            openTaskCount: openTasks.length,
            topTaskId: topTask?.id || null
        }
    };
}

/**
 * @returns {CreatorFeedCard}
 */
function buildMarketplaceCard() {
    const listings = searchMarketplaceListings({ activeOnly: true });
    const top = listings[0] || null;
    return {
        id: 'creator-feed:marketplace',
        kind: 'marketplace_opportunities',
        title: 'Marketplace Opportunities',
        detail: top
            ? `${listings.length} active · ${top.service?.title || 'Top listing'}`
            : 'No active listings — publish services to attract collaborators.',
        importance: top ? 58 : 42,
        target: top
            ? { type: 'marketplace_listing', listingId: top.listingId }
            : { type: 'studio_tab', tab: 'Analytics', section: 'marketplace' },
        meta: {
            activeListings: listings.length,
            topListingId: top?.listingId || null
        }
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 * @returns {CreatorFeedCard}
 */
function buildRevenueSnapshotCard(seriesId, feedReels) {
    const snapshot = buildSeriesRevenueSnapshot(seriesId, feedReels);
    const net = snapshot?.estimate?.netCreatorCents || 0;
    const gross = snapshot?.estimate?.grossMonthlyCents || 0;
    const currency = snapshot?.profile?.currency || 'USD';
    return {
        id: 'creator-feed:revenue',
        kind: 'revenue_snapshot',
        title: 'Revenue Snapshot',
        detail: `Net ${formatRevenueCurrency(net, currency)} · Gross ${formatRevenueCurrency(gross, currency)}`,
        importance: net > 0 ? 63 : 48,
        target: { type: 'revenue_section', section: 'revenue' },
        meta: { netCreatorCents: net, grossMonthlyCents: gross, currency }
    };
}

/**
 * @param {ReturnType<typeof buildCommandCenterSnapshot>} snapshot
 * @returns {CreatorFeedCard}
 */
function buildTeamActivityCard(snapshot) {
    const latest = snapshot.team.recentActivity[0] || null;
    return {
        id: 'creator-feed:team',
        kind: 'team_activity',
        title: 'Team Activity',
        detail: latest
            ? `${snapshot.team.activityCount} events · ${latest.user} ${latest.type}`
            : 'No recent team activity — assign or review a task to kick off momentum.',
        importance: latest ? 56 : 40,
        target: { type: 'studio_tab', tab: 'Teams', section: 'team-activity' },
        meta: {
            activityCount: snapshot.team.activityCount
        }
    };
}

/**
 * @returns {CreatorFeedCard}
 */
function buildSecurityAlertsCard() {
    const threat = getThreatSnapshot();
    const top = threat.activeThreats[0] || null;
    const base = threat.level === 'RED' ? 96 : threat.level === 'ORANGE' ? 86 : threat.level === 'YELLOW' ? 74 : 44;
    return {
        id: 'creator-feed:security',
        kind: 'security_alerts',
        title: 'Security Alerts',
        detail: top
            ? `${threat.level} · ${top.title}`
            : `${threat.level} · No active security incidents.`,
        importance: Math.min(99, base + threat.activeThreats.length * 3),
        target: top
            ? { type: 'security_incident', incidentId: top.id }
            : { type: 'command_center_page', tab: 'System', dashboardSection: 'security' },
        meta: {
            threatLevel: threat.level,
            activeThreatCount: threat.activeThreats.length,
            score: threat.score
        }
    };
}

/**
 * @param {Record<string, unknown>[]} feedReels
 * @returns {CreatorFeedCard}
 */
function buildTrendingSeriesCard(feedReels) {
    const catalog = get(seriesCatalog);
    const ranked = catalog
        .map((series) => {
            const health = computeSeriesHealth(feedReels, series.id);
            const score =
                Number(health.overallReadinessScore || 0) +
                Number(health.publishedEpisodes || 0) * 3 +
                Number(health.assetCoverage || 0) * 0.2;
            return {
                id: series.id,
                title: series.title || series.id,
                score: Math.round(score)
            };
        })
        .sort((a, b) => b.score - a.score);
    const top = ranked[0] || null;
    return {
        id: 'creator-feed:trending-series',
        kind: 'trending_series',
        title: 'Trending Series',
        detail: top ? `${top.title} · trend score ${top.score}` : 'No trending series data yet.',
        importance: top ? 50 : 35,
        target: { type: 'studio_tab', tab: 'Overview', section: 'trending-series' },
        meta: {
            topSeriesId: top?.id || null,
            trendScore: top?.score || 0
        }
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 * @returns {CreatorFeedCard}
 */
function buildUpcomingReleasesCard(seriesId, feedReels) {
    const release = buildReleaseCenterSnapshot(seriesId, feedReels);
    const next = release.calendar.find((entry) => entry.status === 'scheduled') || null;
    return {
        id: 'creator-feed:upcoming-releases',
        kind: 'upcoming_releases',
        title: 'Upcoming Releases',
        detail: next
            ? `${release.launchReadiness.scheduledEpisodes} scheduled · next ${next.episodeLabel} ${next.releaseDate || ''} ${next.releaseTime || ''}`.trim()
            : 'No scheduled releases — open Release Center to schedule the next drop.',
        importance: next ? 68 : 46,
        target: { type: 'studio_tab', tab: 'Content', section: 'release-center' },
        meta: {
            scheduledEpisodes: release.launchReadiness.scheduledEpisodes,
            nextEpisodeId: next?.episodeId || null
        }
    };
}

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 * @returns {{ version: string; updatedAt: number; seriesId: string; cards: CreatorFeedCard[] }}
 */
export function buildCreatorHomeFeed(options = {}) {
    const seriesId = resolveSeriesId(options.seriesId);
    const feedReels = Array.isArray(options.feedReels) ? options.feedReels : loadFeedReelsFromStorage();
    const snapshot = buildCommandCenterSnapshot(seriesId, feedReels);

    const cards = [
        buildDailyEngagementCard(seriesId, feedReels),
        buildTodayTasksCard(seriesId, feedReels),
        buildMarketplaceCard(),
        buildRevenueSnapshotCard(seriesId, feedReels),
        buildTeamActivityCard(snapshot),
        buildSecurityAlertsCard(),
        buildTrendingSeriesCard(feedReels),
        buildUpcomingReleasesCard(seriesId, feedReels)
    ].sort((a, b) => b.importance - a.importance || a.title.localeCompare(b.title));

    const state = {
        version: CREATOR_FEED_VERSION,
        updatedAt: Date.now(),
        seriesId,
        cards
    };

    if (typeof window !== 'undefined') {
        localStorage.setItem(CREATOR_FEED_STORAGE_KEY, JSON.stringify(state));
        window.dispatchEvent(new CustomEvent('reelforge:creator-feed-updated', { detail: state }));
    }

    logCreatorFeedDiag({
        reason: options.reason || 'build',
        seriesId,
        cardCount: cards.length,
        cardKinds: cards.map((card) => card.kind),
        topCard: cards[0]?.kind || null
    });

    return state;
}

/** @returns {{ version: string; updatedAt: number; seriesId: string; cards: CreatorFeedCard[] } | null} */
export function loadCreatorHomeFeed() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(CREATOR_FEED_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 */
export function refreshCreatorHomeFeed(options = {}) {
    return buildCreatorHomeFeed({ ...options, reason: options.reason || 'refresh' });
}

let creatorFeedInitialized = false;
let refreshTimer = null;

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[] }} [options]
 */
export function initCreatorHomeFeed(options = {}) {
    if (typeof window === 'undefined') return null;
    if (creatorFeedInitialized) return window.__reelforgeCreatorFeed || null;
    creatorFeedInitialized = true;

    const scheduleRefresh = (reason) => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            refreshCreatorHomeFeed({ ...options, reason });
        }, 150);
    };

    const refreshEvents = [
        ['reelforge:workflow-tasks-updated', 'tasks_updated'],
        ['reelforge:notifications-updated', 'notifications_updated'],
        ['reelforge:marketplace-updated', 'marketplace_updated'],
        ['reelforge:threat-updated', 'security_updated'],
        ['reelforge:release-schedule-updated', 'release_updated'],
        ['reelforge:teams-updated', 'teams_updated'],
        ['reelforge:daily-engagement-updated', 'daily_engagement_updated']
    ];
    for (const [eventName, reason] of refreshEvents) {
        window.addEventListener(eventName, () => scheduleRefresh(reason));
    }

    window.__reelforgeCreatorFeed = {
        CREATOR_FEED_VERSION,
        CREATOR_FEED_STORAGE_KEY,
        buildCreatorHomeFeed,
        refreshCreatorHomeFeed,
        loadCreatorHomeFeed,
        logCreatorFeedDiag
    };

    return refreshCreatorHomeFeed({ ...options, reason: 'engine_initialized' });
}
