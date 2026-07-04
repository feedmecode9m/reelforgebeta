/**
 * Phase 61 — Daily Engagement System.
 */

import { loadReleaseScheduleMap } from '../release/releaseCenter.js';
import { searchMarketplaceListings } from '../marketplace/marketplaceEngine.js';
import { masterAnalysis } from '../sentinel/sentinelAssistant.js';
import { masterMonetizationAnalysis } from '../revenue/monetizationAI.js';

export const DAILY_ENGAGEMENT_STORAGE_KEY = 'daily_engagement_state';

const DAILY_TIPS = [
    'Audit one episode metadata card before opening new tasks.',
    'Clear one bottleneck before noon to keep publishing velocity high.',
    'Review team activity and acknowledge one update to improve alignment.',
    'Open release schedule first and validate the next drop time.',
    'Run a quick security sweep before starting uploads.'
];

const DAILY_CHALLENGES = [
    'Ship one workflow task from IN_PROGRESS to COMPLETE.',
    'Schedule one upcoming release with a confirmed time.',
    'Attach missing assets to at least one episode.',
    'Create one marketplace listing for a production gap.',
    'Reduce unread notifications to fewer than three.'
];

/**
 * @param {Record<string, unknown>} [detail]
 */
export function logDailyEngagementDiag(detail = {}) {
    console.log(`[DAILY_ENGAGEMENT] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

export function getDailyKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function hashDay(dayKey) {
    let hash = 0;
    for (let i = 0; i < dayKey.length; i += 1) {
        hash = (hash * 31 + dayKey.charCodeAt(i)) >>> 0;
    }
    return hash;
}

/**
 * @param {string} dayKey
 * @param {string[]} values
 */
function pickDaily(dayKey, values) {
    if (!values.length) return '';
    const idx = hashDay(dayKey) % values.length;
    return values[idx];
}

function buildTodaysReleaseCard(dayKey) {
    const schedule = Object.values(loadReleaseScheduleMap() || {});
    const now = Date.now();
    const start = new Date(`${dayKey}T00:00:00`).getTime();
    const end = new Date(`${dayKey}T23:59:59`).getTime();
    const today = schedule
        .filter((row) => Number(row.releaseAt) >= start && Number(row.releaseAt) <= end)
        .sort((a, b) => Number(a.releaseAt) - Number(b.releaseAt));
    const nearest = today[0] || schedule.filter((row) => Number(row.releaseAt) > now).sort((a, b) => Number(a.releaseAt) - Number(b.releaseAt))[0] || null;
    if (!nearest) {
        return {
            title: "Today's Release",
            detail: 'No scheduled release today — plan your next drop.'
        };
    }
    return {
        title: "Today's Release",
        detail: `${nearest.episodeId} at ${nearest.releaseTime || '00:00'}`
    };
}

function buildTrendingCreatorCard() {
    const listings = searchMarketplaceListings({ activeOnly: true });
    const top = listings[0] || null;
    const creatorName =
        top?.creator?.displayName ||
        top?.creator?.creatorId ||
        top?.service?.creatorId ||
        'Creator Spotlight';
    return {
        title: 'Trending Creator',
        detail: top
            ? `${creatorName} · ${top.service?.title || 'Active listing'}`
            : 'No trending creator yet — publish or list to start momentum.'
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
function buildSentinelInsightCard(seriesId, feedReels) {
    const analysis = masterAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    return {
        title: 'Sentinel Insight of the Day',
        detail:
            analysis.topIssues?.[0]?.title ||
            analysis.recommendations?.[0] ||
            analysis.executiveSummary ||
            'Sentinel reports stable operations today.'
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
function buildRevenueInsightCard(seriesId, feedReels) {
    const analysis = masterMonetizationAnalysis(seriesId, feedReels, { emitDiagnostics: false });
    return {
        title: 'Revenue Insight of the Day',
        detail:
            analysis.recommendations?.[0]?.detail ||
            analysis.summary ||
            'Revenue intelligence is waiting for more signals.'
    };
}

function buildMarketplaceOpportunityCard() {
    const top = searchMarketplaceListings({ activeOnly: true })[0] || null;
    return {
        title: 'Marketplace Opportunity of the Day',
        detail: top
            ? `${top.categoryLabel || top.service?.category || 'Marketplace'} · ${top.service?.title || 'Top listing'}`
            : 'No active opportunity — create a listing to seed demand.'
    };
}

export function loadDailyEngagementState() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(DAILY_ENGAGEMENT_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/**
 * @param {Record<string, unknown>} state
 */
export function persistDailyEngagementState(state) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(DAILY_ENGAGEMENT_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent('reelforge:daily-engagement-updated', { detail: state }));
}

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 */
export function buildDailyEngagementState(options = {}) {
    const dayKey = getDailyKey();
    const seriesId = options.seriesId || 'series-neon-vengeance';
    const feedReels = Array.isArray(options.feedReels) ? options.feedReels : [];

    const state = {
        dayKey,
        seriesId,
        updatedAt: Date.now(),
        cards: {
            dailyStudioTip: {
                title: 'Daily Studio Tip',
                detail: pickDaily(dayKey, DAILY_TIPS)
            },
            dailyCreatorChallenge: {
                title: 'Daily Creator Challenge',
                detail: pickDaily(dayKey, DAILY_CHALLENGES)
            },
            todaysRelease: buildTodaysReleaseCard(dayKey),
            trendingCreator: buildTrendingCreatorCard(),
            sentinelInsightOfDay: buildSentinelInsightCard(seriesId, feedReels),
            revenueInsightOfDay: buildRevenueInsightCard(seriesId, feedReels),
            marketplaceOpportunityOfDay: buildMarketplaceOpportunityCard()
        }
    };

    persistDailyEngagementState(state);
    logDailyEngagementDiag({
        reason: options.reason || 'build',
        dayKey,
        cardKeys: Object.keys(state.cards)
    });
    return state;
}

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 */
export function getDailyEngagementState(options = {}) {
    const cached = loadDailyEngagementState();
    const dayKey = getDailyKey();
    if (cached?.dayKey === dayKey && cached?.cards) {
        return cached;
    }
    return buildDailyEngagementState({ ...options, reason: options.reason || 'daily_rollover' });
}

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 */
export function refreshDailyEngagementState(options = {}) {
    return buildDailyEngagementState({ ...options, reason: options.reason || 'refresh' });
}

let dailyEngagementInitialized = false;

/**
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[] }} [options]
 */
export function initDailyEngagementSystem(options = {}) {
    if (typeof window === 'undefined' || dailyEngagementInitialized) return null;
    dailyEngagementInitialized = true;
    window.__reelforgeDailyEngagement = {
        DAILY_ENGAGEMENT_STORAGE_KEY,
        getDailyKey,
        loadDailyEngagementState,
        persistDailyEngagementState,
        buildDailyEngagementState,
        getDailyEngagementState,
        refreshDailyEngagementState,
        logDailyEngagementDiag
    };
    return getDailyEngagementState({ ...options, reason: 'engine_initialized' });
}
