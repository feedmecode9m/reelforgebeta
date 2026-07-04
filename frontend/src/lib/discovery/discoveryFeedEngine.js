/**
 * Phase 69 — Discovery Feed engine.
 * Daily-return feed with ranked cards across platform domains.
 */

import { get } from 'svelte/store';
import { seriesCatalog } from '../series/seriesStore.js';
import { TEAM_STORAGE_KEY } from '../teams/creatorTeams.js';
import { searchMarketplaceListings, listOpenMarketplaceGigs } from '../marketplace/marketplaceEngine.js';
import { loadReleaseScheduleMap } from '../release/releaseCenter.js';
import { buildSeriesRevenueSnapshot, formatRevenueCurrency } from '../revenue/revenueCore.js';
import { masterAnalysis } from '../sentinel/sentinelAssistant.js';
import { buildCommandCenterSnapshot } from '../command/commandCenter.js';
import { syncWorkflowTasks } from '../workflow/workflowEngine.js';
import { getDailyEngagementState } from '../engagement/dailyEngagement.js';

export const DISCOVERY_FEED_VERSION = '69.0.0';
export const DISCOVERY_FEED_STORAGE_KEY = 'reelforge_discovery_feed_state';
export const DISCOVERY_FEED_SECTIONS = /** @type {const} */ ([
    'Trending Creators',
    'Marketplace Opportunities',
    'Upcoming Releases',
    'Revenue Milestones',
    'Sentinel Insights',
    'Team Highlights',
    'Production Wins',
    'Daily Recommendations'
]);

/**
 * @typedef {'trending_creators' | 'marketplace_opportunities' | 'upcoming_releases' | 'revenue_milestones' | 'sentinel_insights' | 'team_highlights' | 'production_wins' | 'daily_recommendations'} DiscoveryFeedSectionId
 */

/**
 * @typedef {Object} DiscoveryFeedCard
 * @property {string} id
 * @property {DiscoveryFeedSectionId} sectionId
 * @property {string} sectionTitle
 * @property {string} title
 * @property {string} detail
 * @property {number} score
 * @property {{ urgency: number; impact: number; freshness: number; engagement: number }} rank
 * @property {Record<string, unknown> | null} [target]
 * @property {Record<string, unknown>} [meta]
 */

/** @param {'DISCOVERY_FEED' | 'DISCOVERY_CARD' | 'DISCOVERY_REFRESH'} tag */
export function logDiscoveryFeedDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

/** @param {{ urgency?: number; impact?: number; freshness?: number; engagement?: number }} rank */
function scoreCard(rank = {}) {
    const urgency = clamp(rank.urgency);
    const impact = clamp(rank.impact);
    const freshness = clamp(rank.freshness);
    const engagement = clamp(rank.engagement);
    return Math.round(urgency * 0.4 + impact * 0.3 + freshness * 0.2 + engagement * 0.1);
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

/** @param {string | undefined} seriesId */
function resolveSeriesId(seriesId) {
    if (seriesId) return seriesId;
    const catalog = get(seriesCatalog);
    return catalog[0]?.id || 'series-neon-vengeance';
}

/**
 * @param {string} sectionId
 * @param {string} sectionTitle
 * @param {string} title
 * @param {string} detail
 * @param {{ urgency?: number; impact?: number; freshness?: number; engagement?: number }} rank
 * @param {Record<string, unknown> | null} [target]
 * @param {Record<string, unknown>} [meta]
 * @returns {DiscoveryFeedCard}
 */
function createCard(sectionId, sectionTitle, title, detail, rank, target = null, meta = {}) {
    const score = scoreCard(rank);
    return {
        id: `${sectionId}:${String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'card'}`,
        sectionId,
        sectionTitle,
        title,
        detail,
        score,
        rank: {
            urgency: clamp(rank.urgency),
            impact: clamp(rank.impact),
            freshness: clamp(rank.freshness),
            engagement: clamp(rank.engagement)
        },
        target,
        meta
    };
}

/**
 * @param {Record<string, unknown>[]} feedReels
 */
function buildTrendingCreators(feedReels) {
    if (typeof window === 'undefined') return [];
    let activityRows = [];
    try {
        const raw = localStorage.getItem(TEAM_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : { activity: {} };
        activityRows = Object.values(parsed.activity || {}).flat();
    } catch {
        activityRows = [];
    }

    const counts = new Map();
    for (const row of activityRows) {
        const name = String(row?.displayName || row?.display_name || row?.user || row?.owner || '').trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
    }
    const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
    if (!top.length) {
        return [
            createCard(
                'trending_creators',
                'Trending Creators',
                'Build creator momentum',
                'Invite collaborators or publish updates to populate creator trends.',
                { urgency: 38, impact: 55, freshness: 42, engagement: 35 },
                { type: 'studio_tab', tab: 'Teams', section: 'team-activity' },
                { contributorCount: 0 }
            )
        ];
    }
    return top.map(([name, events], index) =>
        createCard(
            'trending_creators',
            'Trending Creators',
            name,
            `${events} recent team events`,
            { urgency: 44 + index * 3, impact: 62, freshness: 78 - index * 7, engagement: 68 + events },
            { type: 'studio_tab', tab: 'Teams', section: 'team-activity' },
            { events }
        )
    );
}

function buildMarketplaceOpportunityCards() {
    const listings = searchMarketplaceListings({ activeOnly: true }).slice(0, 2);
    const gigs = listOpenMarketplaceGigs().slice(0, 2);
    const cards = [];
    for (const gig of gigs) {
        cards.push(
            createCard(
                'marketplace_opportunities',
                'Marketplace Opportunities',
                gig.title || 'Open gig',
                `Open gig · ${gig.status || 'active'}`,
                { urgency: 58, impact: 66, freshness: 74, engagement: 57 },
                { type: 'studio_tab', tab: 'Analytics', section: 'marketplace' },
                { gigId: gig.gigId || null }
            )
        );
    }
    for (const listing of listings) {
        cards.push(
            createCard(
                'marketplace_opportunities',
                'Marketplace Opportunities',
                listing.service?.title || 'Marketplace listing',
                listing.categoryLabel || listing.service?.category || 'Creator marketplace opportunity',
                { urgency: 46, impact: 72, freshness: 70, engagement: 60 },
                { type: 'marketplace_listing', listingId: listing.listingId },
                { listingId: listing.listingId }
            )
        );
    }
    return cards.length
        ? cards
        : [
              createCard(
                  'marketplace_opportunities',
                  'Marketplace Opportunities',
                  'No active opportunities',
                  'Publish a service listing to unlock discovery traffic.',
                  { urgency: 36, impact: 50, freshness: 40, engagement: 32 },
                  { type: 'studio_tab', tab: 'Analytics', section: 'marketplace' }
              )
          ];
}

function buildUpcomingReleaseCards() {
    const now = Date.now();
    const schedule = Object.values(loadReleaseScheduleMap())
        .filter((entry) => Number(entry.releaseAt) > now)
        .sort((a, b) => Number(a.releaseAt) - Number(b.releaseAt))
        .slice(0, 3);
    return schedule.length
        ? schedule.map((entry, index) => {
              const hours = Math.max(0, Math.round((Number(entry.releaseAt) - now) / 3_600_000));
              return createCard(
                  'upcoming_releases',
                  'Upcoming Releases',
                  entry.episodeId || `Release ${index + 1}`,
                  `${new Date(Number(entry.releaseAt)).toLocaleString()} · in ${hours}h`,
                  { urgency: 68 - index * 6, impact: 76, freshness: 82, engagement: 50 },
                  { type: 'studio_tab', tab: 'Content', section: 'release-center' },
                  { releaseAt: Number(entry.releaseAt), seriesId: entry.seriesId || null }
              );
          })
        : [
              createCard(
                  'upcoming_releases',
                  'Upcoming Releases',
                  'No scheduled release',
                  'Schedule the next premiere to keep audiences returning.',
                  { urgency: 62, impact: 70, freshness: 30, engagement: 40 },
                  { type: 'studio_tab', tab: 'Content', section: 'release-center' }
              )
          ];
}

function buildRevenueMilestoneCards(seriesId, feedReels) {
    const snapshot = buildSeriesRevenueSnapshot(seriesId, feedReels);
    const net = Number(snapshot?.estimate?.netCreatorCents || 0);
    const gross = Number(snapshot?.estimate?.grossMonthlyCents || 0);
    const currency = snapshot?.profile?.currency || 'USD';
    const label =
        net >= 500_000
            ? 'Net Revenue Breakout'
            : gross >= 1_500_000
              ? 'Gross Revenue Lift'
              : 'Revenue Pulse';
    return [
        createCard(
            'revenue_milestones',
            'Revenue Milestones',
            label,
            `Net ${formatRevenueCurrency(net, currency)} · Gross ${formatRevenueCurrency(gross, currency)}`,
            {
                urgency: net > 0 ? 58 : 42,
                impact: net > 0 ? 85 : 64,
                freshness: 66,
                engagement: net > 0 ? 72 : 48
            },
            { type: 'revenue_section', section: 'revenue', dashboardSection: 'revenue' },
            { netCreatorCents: net, grossMonthlyCents: gross, currency }
        )
    ];
}

function buildSentinelInsightCards(seriesId, feedReels) {
    const sentinel = masterAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    const recommendations = sentinel?.recommendations?.slice(0, 2) || [];
    return recommendations.length
        ? recommendations.map((rec, index) =>
              createCard(
                  'sentinel_insights',
                  'Sentinel Insights',
                  `Insight ${index + 1}`,
                  String(rec),
                  {
                      urgency: sentinel?.threatLevel === 'RED' ? 92 : sentinel?.threatLevel === 'ORANGE' ? 82 : 64,
                      impact: 80,
                      freshness: 70,
                      engagement: 56
                  },
                  { type: 'command_center_page', tab: 'System', dashboardSection: 'security' },
                  { threatLevel: sentinel?.threatLevel || null, riskLevel: sentinel?.riskLevel || null }
              )
          )
        : [
              createCard(
                  'sentinel_insights',
                  'Sentinel Insights',
                  'No critical sentinel insight',
                  'Sentinel has no high-priority recommendations right now.',
                  { urgency: 35, impact: 55, freshness: 50, engagement: 35 },
                  { type: 'command_center_page', tab: 'System', dashboardSection: 'security' }
              )
          ];
}

function buildTeamHighlightCards(seriesId, feedReels) {
    const snapshot = buildCommandCenterSnapshot(seriesId, feedReels);
    const recent = snapshot?.team?.recentActivity?.slice(0, 2) || [];
    return recent.length
        ? recent.map((row, index) =>
              createCard(
                  'team_highlights',
                  'Team Highlights',
                  row?.user || `Team update ${index + 1}`,
                  row?.type ? `${row.type} on ${row?.episodeId || 'series task'}` : 'Recent team movement',
                  { urgency: 46, impact: 62, freshness: 74 - index * 6, engagement: 61 },
                  { type: 'studio_tab', tab: 'Teams', section: 'team-activity' },
                  { user: row?.user || null, eventType: row?.type || null }
              )
          )
        : [
              createCard(
                  'team_highlights',
                  'Team Highlights',
                  'No recent team highlights',
                  'Assign tasks or review workflows to surface team highlights.',
                  { urgency: 30, impact: 52, freshness: 35, engagement: 36 },
                  { type: 'studio_tab', tab: 'Teams', section: 'team-activity' }
              )
          ];
}

function buildProductionWinCards(seriesId, feedReels) {
    const workflow = syncWorkflowTasks(seriesId, feedReels);
    const completed = workflow.tasks.filter((task) => task.status === 'COMPLETE').slice(-2).reverse();
    return completed.length
        ? completed.map((task, index) =>
              createCard(
                  'production_wins',
                  'Production Wins',
                  task.title || task.id || `Completed task ${index + 1}`,
                  `Completed in ${task.stage || 'workflow'} lane`,
                  { urgency: 40, impact: 70, freshness: 80 - index * 6, engagement: 66 },
                  { type: 'workflow', tab: 'Production', dashboardSection: 'production' },
                  { taskId: task.id || null, stage: task.stage || null }
              )
          )
        : [
              createCard(
                  'production_wins',
                  'Production Wins',
                  'No production wins yet today',
                  'Complete a blocked task to publish a production win card.',
                  { urgency: 48, impact: 68, freshness: 32, engagement: 44 },
                  { type: 'workflow', tab: 'Production', dashboardSection: 'production' }
              )
          ];
}

function buildDailyRecommendationCards(seriesId, feedReels) {
    const daily = getDailyEngagementState({ seriesId, feedReels, reason: 'discovery_feed' });
    const cards = Object.values(daily?.cards || {})
        .filter((card) => card && typeof card === 'object')
        .slice(0, 2);
    return cards.length
        ? cards.map((card, index) =>
              createCard(
                  'daily_recommendations',
                  'Daily Recommendations',
                  String(card.title || `Recommendation ${index + 1}`),
                  String(card.detail || 'Daily recommendation available'),
                  { urgency: 52, impact: 74, freshness: 79 - index * 7, engagement: 70 },
                  card.target || { type: 'studio_tab', tab: 'Overview', section: 'daily-engagement' },
                  { cardId: card.id || null, kind: card.kind || null }
              )
          )
        : [
              createCard(
                  'daily_recommendations',
                  'Daily Recommendations',
                  'Daily recommendation pending',
                  'Open Daily Engagement to generate today’s recommendation set.',
                  { urgency: 42, impact: 64, freshness: 40, engagement: 52 },
                  { type: 'studio_tab', tab: 'Overview', section: 'daily-engagement' }
              )
          ];
}

/** @returns {Record<string, unknown> | null} */
export function loadDiscoveryFeedStore() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(DISCOVERY_FEED_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/** @param {Record<string, unknown>} state */
export function persistDiscoveryFeedStore(state) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(DISCOVERY_FEED_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent('reelforge:discovery-feed-updated', { detail: state }));
}

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 */
export function buildDiscoveryFeed(options = {}) {
    const seriesId = resolveSeriesId(options.seriesId);
    const feedReels = Array.isArray(options.feedReels) ? options.feedReels : loadFeedReelsFromStorage();
    const sections = {
        trendingCreators: buildTrendingCreators(feedReels),
        marketplaceOpportunities: buildMarketplaceOpportunityCards(),
        upcomingReleases: buildUpcomingReleaseCards(),
        revenueMilestones: buildRevenueMilestoneCards(seriesId, feedReels),
        sentinelInsights: buildSentinelInsightCards(seriesId, feedReels),
        teamHighlights: buildTeamHighlightCards(seriesId, feedReels),
        productionWins: buildProductionWinCards(seriesId, feedReels),
        dailyRecommendations: buildDailyRecommendationCards(seriesId, feedReels)
    };
    const cards = Object.values(sections)
        .flat()
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    const state = {
        version: DISCOVERY_FEED_VERSION,
        updatedAt: Date.now(),
        seriesId,
        sections,
        cards
    };
    persistDiscoveryFeedStore(state);
    logDiscoveryFeedDiag('DISCOVERY_FEED', {
        reason: options.reason || 'build',
        seriesId,
        cardCount: cards.length,
        sectionSizes: Object.fromEntries(
            Object.entries(sections).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
        ),
        topCard: cards[0]?.sectionId || null
    });
    for (const card of cards.slice(0, 12)) {
        logDiscoveryFeedDiag('DISCOVERY_CARD', {
            id: card.id,
            sectionId: card.sectionId,
            title: card.title,
            score: card.score
        });
    }
    return state;
}

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 */
export function refreshDiscoveryFeed(options = {}) {
    const state = buildDiscoveryFeed({ ...options, reason: options.reason || 'refresh' });
    logDiscoveryFeedDiag('DISCOVERY_REFRESH', {
        reason: options.reason || 'refresh',
        updatedAt: state.updatedAt,
        cardCount: state.cards.length
    });
    return state;
}

let discoveryFeedInitialized = false;
let refreshTimer = null;
let heartbeatTimer = null;

/** @param {{ seriesId?: string; feedReels?: Record<string, unknown>[] }} [options] */
export function initDiscoveryFeedEngine(options = {}) {
    if (typeof window === 'undefined') return null;
    if (discoveryFeedInitialized) return window.__reelforgeDiscoveryFeed || null;
    discoveryFeedInitialized = true;

    const scheduleRefresh = (reason) => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            refreshDiscoveryFeed({ ...options, reason });
        }, 160);
    };

    const refreshEvents = [
        ['reelforge:upload-updated', 'upload_updated'],
        ['reelforge:workflow-tasks-updated', 'workflow_updated'],
        ['reelforge:notifications-updated', 'notifications_updated'],
        ['reelforge:release-schedule-updated', 'release_updated'],
        ['reelforge:marketplace-updated', 'marketplace_updated'],
        ['reelforge:teams-updated', 'teams_updated'],
        ['reelforge:daily-engagement-updated', 'daily_updated'],
        ['reelforge:threat-updated', 'security_updated'],
        ['reelforge:revenue-updated', 'revenue_updated']
    ];
    for (const [eventName, reason] of refreshEvents) {
        window.addEventListener(eventName, () => scheduleRefresh(reason));
    }

    heartbeatTimer = setInterval(() => {
        refreshDiscoveryFeed({ ...options, reason: 'auto_interval' });
    }, 60_000);

    window.__reelforgeDiscoveryFeed = {
        DISCOVERY_FEED_VERSION,
        DISCOVERY_FEED_STORAGE_KEY,
        DISCOVERY_FEED_SECTIONS,
        buildDiscoveryFeed,
        refreshDiscoveryFeed,
        loadDiscoveryFeedStore,
        logDiscoveryFeedDiag
    };

    const initial = refreshDiscoveryFeed({ ...options, reason: 'engine_initialized' });
    logDiscoveryFeedDiag('DISCOVERY_REFRESH', {
        reason: 'auto_interval_configured',
        intervalMs: 60_000
    });
    return initial;
}

