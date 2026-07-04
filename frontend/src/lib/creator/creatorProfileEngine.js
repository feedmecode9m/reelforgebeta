/**
 * Phase 71 — Creator Profiles.
 * Professional creator identity pages powered by cross-domain platform signals.
 */

import { get } from 'svelte/store';
import { seriesCatalog } from '../series/seriesStore.js';
import { TEAM_STORAGE_KEY, CURRENT_TEAM_USER_KEY } from '../teams/creatorTeams.js';
import {
    getStudioCreatorId,
    ensureStudioCreator,
    loadMarketplaceStore,
    getMarketplaceActivity
} from '../marketplace/marketplaceEngine.js';
import { buildSeriesRevenueSnapshot, formatRevenueCurrency } from '../revenue/revenueCore.js';
import { getWorkflowTasksForSeries } from '../workflow/workflowEngine.js';

export const CREATOR_PROFILE_VERSION = '71.0.0';
export const CREATOR_PROFILE_STORAGE_KEY = 'reelforge_creator_profiles';

/**
 * @typedef {Object} CreatorProfile
 * @property {string} creatorId
 * @property {string} avatar
 * @property {string} displayName
 * @property {string} bio
 * @property {string[]} skills
 * @property {Array<{ id: string; title: string; summary: string; category: string }>} portfolio
 * @property {{ rating: number; reviewCount: number; activeListings: number; completedGigs: number }} marketplace
 * @property {{ currency: string; netFormatted: string; grossFormatted: string; mrrFormatted: string; arrFormatted: string }} revenue
 * @property {Array<{ teamId: string; teamName: string; role: string }>} teamMemberships
 * @property {Array<{ id: string; title: string; status: string; releaseYear?: number }>} publishedProjects
 * @property {Array<{ id: string; title: string; type: string; status: string; at: number }>} productionHistory
 * @property {number} updatedAt
 * @property {string} schemaVersion
 */

/**
 * @param {'CREATOR_PROFILE' | 'PROFILE_VIEW' | 'PROFILE_UPDATE'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logCreatorProfileDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {string} creatorId */
function creatorIdToUserId(creatorId) {
    const raw = String(creatorId || '').trim();
    if (!raw) return 'user-owner-1';
    if (raw.startsWith('creator-')) return raw.replace(/^creator-/, '');
    return raw;
}

/** @param {string} name */
function generateAvatar(name) {
    const label = encodeURIComponent(String(name || 'Creator').slice(0, 2).toUpperCase());
    return `https://ui-avatars.com/api/?name=${label}&background=111827&color=ffffff&size=128&bold=true`;
}

/** @returns {Record<string, CreatorProfile>} */
function loadProfileStore() {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(CREATOR_PROFILE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/** @param {Record<string, CreatorProfile>} store */
function persistProfileStore(store) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(CREATOR_PROFILE_STORAGE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent('reelforge:creator-profile-updated', { detail: store }));
}

/** @param {string | undefined} seriesId */
function resolveSeriesId(seriesId) {
    if (seriesId) return seriesId;
    const catalog = get(seriesCatalog);
    return catalog[0]?.id || 'series-neon-vengeance';
}

/** @param {string} userId */
function buildTeamMemberships(userId) {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(TEAM_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const teams = Array.isArray(parsed.teams) ? parsed.teams : [];
        const members = parsed.members || {};
        return teams
            .map((team) => {
                const teamMembers = Array.isArray(members[team.id]) ? members[team.id] : [];
                const member = teamMembers.find((item) => String(item?.userId || '') === userId);
                if (!member) return null;
                return {
                    teamId: String(team.id || ''),
                    teamName: String(team.name || 'Production Team'),
                    role: String(member.role || 'EDITOR')
                };
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

/** @param {string} seriesId */
function buildPublishedProjects(seriesId) {
    const catalog = get(seriesCatalog);
    const rows = [];
    for (const series of catalog) {
        if (seriesId && series.id !== seriesId) continue;
        const published = series.seasons
            .flatMap((season) => season.episodes)
            .filter((episode) => episode.status === 'published');
        if (published.length > 0) {
            rows.push({
                id: series.id,
                title: series.title,
                status: `${published.length} published episode${published.length === 1 ? '' : 's'}`,
                releaseYear: series.releaseYear
            });
        }
    }
    return rows.slice(0, 6);
}

/** @param {string} seriesId */
function buildProductionHistory(seriesId) {
    const workflow = getWorkflowTasksForSeries(seriesId);
    const workflowRows = workflow.slice(0, 10).map((task) => ({
        id: task.id,
        title: task.title || task.id,
        type: 'workflow',
        status: task.status || 'PENDING',
        at: Number(task.updatedAt || task.createdAt || Date.now())
    }));
    const marketplaceRows = getMarketplaceActivity(8).map((entry) => ({
        id: entry.id,
        title: entry.title,
        type: `marketplace_${entry.type}`,
        status: entry.status || 'active',
        at: Number(entry.at || Date.now())
    }));
    return [...workflowRows, ...marketplaceRows]
        .sort((a, b) => b.at - a.at)
        .slice(0, 10);
}

/**
 * @param {{ creatorId?: string; seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 * @returns {CreatorProfile}
 */
export function buildCreatorProfile(options = {}) {
    const creatorId = options.creatorId || getStudioCreatorId();
    const seriesId = resolveSeriesId(options.seriesId);
    const feedReels = Array.isArray(options.feedReels) ? options.feedReels : [];
    const userId =
        typeof window !== 'undefined'
            ? localStorage.getItem(CURRENT_TEAM_USER_KEY) || creatorIdToUserId(creatorId)
            : creatorIdToUserId(creatorId);

    const store = loadMarketplaceStore();
    const creator = store.creators[creatorId] || ensureStudioCreator('Studio Creator');
    const creatorServices = Object.values(store.services || {}).filter((service) => service.creatorId === creatorId);
    const creatorPortfolios = Object.values(store.portfolios || {}).filter((item) => item.creatorId === creatorId);
    const creatorReviews = Object.values(store.reviews || {}).filter((review) => review.creatorId === creatorId);
    const creatorGigs = Object.values(store.gigs || {}).filter((gig) => gig.creatorId === creatorId);

    const reviewAverage =
        creatorReviews.length > 0
            ? creatorReviews.reduce((sum, row) => sum + Number(row.rating || 0), 0) / creatorReviews.length
            : Number(creator.rating || 0);
    const rating = Number.isFinite(reviewAverage) ? Math.round(reviewAverage * 10) / 10 : 0;
    const reviewCount = creatorReviews.length || Number(creator.reviewCount || 0);
    const completedGigs = creatorGigs.filter((gig) => gig.status === 'completed').length;

    const revenue = buildSeriesRevenueSnapshot(seriesId, feedReels) || {};
    const revenueProfile = revenue.profile || {};
    const revenueEstimate = revenue.estimate || {};
    const revenueKpis = revenue.kpis || {};
    const memberships = buildTeamMemberships(userId);
    const publishedProjects = buildPublishedProjects(seriesId);
    const productionHistory = buildProductionHistory(seriesId);

    const profile = {
        creatorId,
        avatar: String(creator.avatar || generateAvatar(creator.displayName || 'Creator')),
        displayName: String(creator.displayName || 'Studio Creator'),
        bio: String(creator.bio || 'Creator profile for ReelForge production and marketplace operations.'),
        skills: Array.from(
            new Set([
                ...(Array.isArray(creator.categories) ? creator.categories.map((item) => String(item)) : []),
                ...creatorServices.map((service) => String(service.category || '')),
                ...memberships.map((row) => String(row.role || '').toLowerCase())
            ].filter(Boolean))
        ).slice(0, 16),
        portfolio: creatorPortfolios.slice(0, 6).map((item) => ({
            id: item.portfolioId,
            title: item.title,
            summary: item.summary || 'Portfolio sample',
            category: item.category
        })),
        marketplace: {
            rating,
            reviewCount,
            activeListings: creatorServices.filter((service) => service.active !== false).length,
            completedGigs
        },
        revenue: {
            currency: revenueProfile.currency || 'USD',
            netFormatted: formatRevenueCurrency(
                Number(revenueEstimate.netCreatorCents || 0),
                revenueProfile.currency || 'USD'
            ),
            grossFormatted: formatRevenueCurrency(
                Number(revenueEstimate.grossMonthlyCents || 0),
                revenueProfile.currency || 'USD'
            ),
            mrrFormatted: revenueKpis?.mrr?.formatted || '$0',
            arrFormatted: revenueKpis?.arr?.formatted || '$0'
        },
        teamMemberships: memberships,
        publishedProjects,
        productionHistory,
        updatedAt: Date.now(),
        schemaVersion: CREATOR_PROFILE_VERSION
    };

    const profiles = loadProfileStore();
    profiles[creatorId] = profile;
    persistProfileStore(profiles);

    logCreatorProfileDiag('CREATOR_PROFILE', {
        reason: options.reason || 'build',
        creatorId,
        skills: profile.skills.length,
        portfolioItems: profile.portfolio.length,
        productionHistoryItems: profile.productionHistory.length
    });

    return profile;
}

/**
 * @param {string} creatorId
 * @param {{ seriesId?: string; feedReels?: Record<string, unknown>[]; reason?: string }} [options]
 * @returns {CreatorProfile}
 */
export function viewCreatorProfile(creatorId, options = {}) {
    const profiles = loadProfileStore();
    const existing = profiles[creatorId];
    const profile =
        existing ||
        buildCreatorProfile({
            ...options,
            creatorId,
            reason: options.reason || 'view_build'
        });
    logCreatorProfileDiag('PROFILE_VIEW', {
        creatorId,
        reason: options.reason || 'view',
        hasPortfolio: profile.portfolio.length > 0
    });
    return profile;
}

/**
 * @param {string} creatorId
 * @param {Partial<CreatorProfile>} patch
 */
export function updateCreatorProfile(creatorId, patch = {}) {
    const profiles = loadProfileStore();
    const current = profiles[creatorId] || viewCreatorProfile(creatorId, { reason: 'update_hydrate' });
    const next = {
        ...current,
        ...patch,
        creatorId,
        updatedAt: Date.now(),
        schemaVersion: CREATOR_PROFILE_VERSION
    };
    profiles[creatorId] = next;
    persistProfileStore(profiles);
    logCreatorProfileDiag('PROFILE_UPDATE', {
        creatorId,
        patchedFields: Object.keys(patch || {}),
        updatedAt: next.updatedAt
    });
    return next;
}

/** @returns {Record<string, CreatorProfile>} */
export function loadCreatorProfileStore() {
    return loadProfileStore();
}

let creatorProfileInitialized = false;
let refreshTimer = null;

/** @param {{ creatorId?: string; seriesId?: string; feedReels?: Record<string, unknown>[] }} [options] */
export function initCreatorProfileEngine(options = {}) {
    if (typeof window === 'undefined') return null;
    if (creatorProfileInitialized) return window.__reelforgeCreatorProfiles || null;
    creatorProfileInitialized = true;

    const creatorId = options.creatorId || getStudioCreatorId();

    const scheduleRefresh = (reason) => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            buildCreatorProfile({ ...options, creatorId, reason });
        }, 150);
    };

    const events = [
        ['reelforge:marketplace-updated', 'marketplace_updated'],
        ['reelforge:teams-updated', 'teams_updated'],
        ['reelforge:workflow-tasks-updated', 'workflow_updated'],
        ['reelforge:revenue-updated', 'revenue_updated'],
        ['reelforge:release-schedule-updated', 'release_updated']
    ];
    for (const [eventName, reason] of events) {
        window.addEventListener(eventName, () => scheduleRefresh(reason));
    }

    window.__reelforgeCreatorProfiles = {
        CREATOR_PROFILE_VERSION,
        CREATOR_PROFILE_STORAGE_KEY,
        buildCreatorProfile,
        viewCreatorProfile,
        updateCreatorProfile,
        loadCreatorProfileStore,
        logCreatorProfileDiag
    };

    return buildCreatorProfile({ ...options, creatorId, reason: 'engine_initialized' });
}

