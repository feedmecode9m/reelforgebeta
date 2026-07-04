/**
 * Phase 62 — Universal NLP Search Engine.
 * One intelligent search index spanning ReelForge domains.
 */

import { get } from 'svelte/store';
import { seriesCatalog, reelSeriesMetadata } from '../series/seriesStore.js';
import { getWorkflowTasksForSeries } from '../workflow/workflowEngine.js';
import { getNotifications } from '../notifications/notificationCenter.js';
import { searchMarketplaceListings } from '../marketplace/marketplaceEngine.js';
import { TEAM_STORAGE_KEY } from '../teams/creatorTeams.js';
import { masterMonetizationAnalysis } from '../revenue/monetizationAI.js';
import { loadSecurityEvents } from '../security/threatDetectionEngine.js';
import { masterAnalysis } from '../sentinel/sentinelAssistant.js';
import { buildGuideMeOperationalBrief, listGuideMeSections } from '../studio/guideMeEngine.js';
import { getDailyEngagementState } from '../engagement/dailyEngagement.js';
import { initDeepNavigation, navigateToTarget } from '../navigation/deepNavigation.js';

export const UNIVERSAL_SEARCH_VERSION = '1.0.0';
export const UNIVERSAL_SEARCH_STORAGE_KEY = 'reelforge_universal_search_index';

const STOP_WORDS = new Set([
    'the',
    'a',
    'an',
    'show',
    'me',
    'for',
    'to',
    'is',
    'are',
    'of',
    'on',
    'in',
    'at',
    'and'
]);

const INTENT_EXPANSIONS = [
    {
        pattern: /missing\s+episodes?|episode\s+missing|show\s+missing\s+episodes?/i,
        terms: ['missing', 'episode', 'asset', 'workflow', 'release', 'content']
    },
    {
        pattern: /security\s+issues?|security|incident|threat|alert/i,
        terms: ['security', 'incident', 'threat', 'alert', 'sentinel', 'risk']
    },
    {
        pattern: /creator\s+revenue|revenue|monetization|mrr|arr/i,
        terms: ['creator', 'revenue', 'monetization', 'forecast', 'insight', 'dashboard']
    },
    {
        pattern: /upload\s+reel|upload|reel/i,
        terms: ['upload', 'reel', 'vault', 'asset', 'media', 'content']
    }
];

const DOMAIN_WEIGHT = {
    reels: 1.08,
    episodes: 1.12,
    series: 1.1,
    workflows: 1.14,
    tasks: 1.14,
    notifications: 1.05,
    marketplace_listings: 1.08,
    creators: 1.07,
    teams: 1.06,
    revenue_insights: 1.11,
    security_incidents: 1.15,
    sentinel_recommendations: 1.16,
    guide_me_content: 1.08,
    daily_engagement_cards: 1.05
};

/**
 * @typedef {Object} UniversalSearchRecord
 * @property {string} id
 * @property {string} domain
 * @property {string} title
 * @property {string} description
 * @property {string} targetType
 * @property {string} targetId
 * @property {number} updatedAt
 * @property {string[]} keywords
 * @property {Record<string, unknown>} payload
 */

/**
 * @typedef {Object} UniversalSearchResult
 * @property {string} title
 * @property {string} description
 * @property {string} targetType
 * @property {string} targetId
 * @property {number} confidenceScore
 * @property {string} domain
 * @property {Record<string, unknown>} payload
 */

/**
 * @param {'SEARCH_INDEX' | 'SEARCH_QUERY' | 'SEARCH_NAVIGATION'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logUniversalSearchDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {string} value */
function normalize(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9_\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** @param {string} value */
function tokenize(value) {
    return normalize(value)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token && !STOP_WORDS.has(token));
}

/** @param {string} query */
function expandQueryTokens(query) {
    const terms = new Set(tokenize(query));
    for (const expansion of INTENT_EXPANSIONS) {
        if (expansion.pattern.test(query)) {
            for (const term of expansion.terms) terms.add(term);
        }
    }
    return Array.from(terms);
}

/** @param {UniversalSearchRecord[]} records @param {UniversalSearchRecord} record */
function pushRecord(records, record) {
    if (!record.title || !record.description || !record.targetType || !record.targetId) return;
    records.push(record);
}

function loadFeedReelsFromStorage() {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem('reelforge_feed');
        const parsed = raw ? JSON.parse(raw) : {};
        return Object.values(parsed || {}).flat().filter(Boolean);
    } catch {
        return [];
    }
}

/** @returns {UniversalSearchRecord[]} */
export function buildUniversalSearchIndex() {
    const now = Date.now();
    /** @type {UniversalSearchRecord[]} */
    const records = [];
    const catalog = get(seriesCatalog);
    const metadataMap = get(reelSeriesMetadata) || {};
    const reels = loadFeedReelsFromStorage();
    const seriesIds = catalog.map((series) => series.id);
    const primarySeriesId = seriesIds[0] || 'series-neon-vengeance';

    // Reels
    for (const reel of reels) {
        const title = String(reel.title || reel.name || reel.id || 'Reel');
        pushRecord(records, {
            id: `reel:${reel.id}`,
            domain: 'reels',
            title,
            description: `Reel in ${reel.category || 'feed'}${reel.url ? ' · upload media' : ''}`,
            targetType: 'reel',
            targetId: String(reel.id || ''),
            updatedAt: now,
            keywords: tokenize(`${title} ${reel.category || ''} ${reel.description || ''} upload reel media`),
            payload: {
                category: reel.category || null
            }
        });
    }

    // Series + episodes
    for (const series of catalog) {
        pushRecord(records, {
            id: `series:${series.id}`,
            domain: 'series',
            title: series.title,
            description: series.description || 'Series profile and publishing readiness',
            targetType: 'series',
            targetId: series.id,
            updatedAt: now,
            keywords: tokenize(`${series.title} ${series.description || ''} series catalog release`),
            payload: {
                workspaceTab: 'Content'
            }
        });
        for (const season of series.seasons || []) {
            for (const episode of season.episodes || []) {
                pushRecord(records, {
                    id: `episode:${episode.episodeId}`,
                    domain: 'episodes',
                    title: `${series.title} S${season.seasonNumber}E${episode.episodeNumber} ${episode.title}`,
                    description: `Episode ${episode.status || 'draft'} · ${episode.description || 'Episode details and assets'}`,
                    targetType: 'episode',
                    targetId: episode.episodeId,
                    updatedAt: now,
                    keywords: tokenize(
                        `${series.title} ${episode.title} ${episode.description || ''} episode metadata release`
                    ),
                    payload: {
                        seriesId: series.id,
                        workspaceTab: 'Content'
                    }
                });
            }
        }
    }

    // Metadata mapped episodes (helps if reel exists but catalog sparse)
    for (const [reelId, meta] of Object.entries(metadataMap)) {
        const title = String(meta.episodeTitle || meta.seriesName || reelId);
        pushRecord(records, {
            id: `episode-meta:${reelId}`,
            domain: 'episodes',
            title,
            description: `${meta.seriesName || 'Series'} metadata`,
            targetType: 'episode',
            targetId: String(meta.episodeId || reelId),
            updatedAt: Number(meta.updatedAt || now),
            keywords: tokenize(`${title} ${meta.seriesName || ''} metadata episode`),
            payload: {
                reelId,
                seriesId: meta.seriesId || null,
                workspaceTab: 'Content'
            }
        });
    }

    // Workflow + tasks
    for (const seriesId of seriesIds.length ? seriesIds : [primarySeriesId]) {
        const tasks = getWorkflowTasksForSeries(seriesId);
        for (const task of tasks) {
            const title = String(task.title || task.taskType || 'Workflow Task');
            pushRecord(records, {
                id: `task:${task.id}`,
                domain: 'tasks',
                title,
                description: `Task ${task.status || 'PENDING'} · ${task.taskType || 'workflow'} · impact ${task.estimatedImpact || 0}`,
                targetType: 'task',
                targetId: String(task.id),
                updatedAt: Number(task.createdAt || now),
                keywords: tokenize(
                    `${title} ${task.taskType || ''} ${task.status || ''} workflow missing episode ${task.episodeId || ''}`
                ),
                payload: {
                    seriesId,
                    episodeId: task.episodeId || null,
                    reelId: task.reelId || null,
                    navTarget: task.navigation?.target || null,
                    workspaceTab: 'Production',
                    dashboardSection: 'production'
                }
            });
        }
        pushRecord(records, {
            id: `workflow:${seriesId}`,
            domain: 'workflows',
            title: `Workflow ${seriesId}`,
            description: `${tasks.filter((task) => task.status !== 'COMPLETE').length} open tasks`,
            targetType: 'workflow',
            targetId: seriesId,
            updatedAt: now,
            keywords: tokenize(
                `workflow blockers production tasks ${tasks.map((task) => task.taskType || '').join(' ')}`
            ),
            payload: {
                seriesId,
                workspaceTab: 'Production',
                dashboardSection: 'production'
            }
        });
    }

    // Notifications
    for (const notification of getNotifications()) {
        pushRecord(records, {
            id: `notification:${notification.id}`,
            domain: 'notifications',
            title: String(notification.type || 'Notification'),
            description: String(notification.message || 'Notification event'),
            targetType: 'notification',
            targetId: String(notification.id),
            updatedAt: Number(notification.createdAt || now),
            keywords: tokenize(
                `${notification.type || ''} ${notification.message || ''} alerts notifications`
            ),
            payload: {
                read: notification.read,
                workspaceTab: 'System',
                dashboardSection: 'operations'
            }
        });
    }

    // Marketplace listings + creators
    const listings = searchMarketplaceListings({ activeOnly: true });
    for (const listing of listings) {
        pushRecord(records, {
            id: `marketplace:${listing.listingId}`,
            domain: 'marketplace_listings',
            title: String(listing.service?.title || 'Marketplace Listing'),
            description: `${listing.categoryLabel || listing.service?.category || 'Marketplace'} · ${listing.service?.description || ''}`,
            targetType: 'marketplace_listing',
            targetId: String(listing.listingId),
            updatedAt: Number(listing.service?.updatedAt || now),
            keywords: tokenize(
                `${listing.service?.title || ''} ${listing.service?.description || ''} marketplace listing`
            ),
            payload: {
                workspaceTab: 'Analytics',
                dashboardSection: 'marketplace'
            }
        });

        const creatorName = String(
            listing.creator?.displayName || listing.creator?.creatorId || listing.service?.creatorId || ''
        ).trim();
        if (creatorName) {
            pushRecord(records, {
                id: `creator:${creatorName.toLowerCase().replace(/\s+/g, '-')}`,
                domain: 'creators',
                title: creatorName,
                description: `Creator behind ${listing.service?.title || 'listing'}`,
                targetType: 'creator',
                targetId: creatorName,
                updatedAt: Number(listing.creator?.updatedAt || now),
                keywords: tokenize(`${creatorName} creator marketplace team`),
                payload: {
                    workspaceTab: 'Teams',
                    dashboardSection: 'teams'
                }
            });
        }
    }

    // Teams
    if (typeof window !== 'undefined') {
        try {
            const raw = localStorage.getItem(TEAM_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            for (const team of parsed.teams || []) {
                const members = parsed.members?.[team.id] || [];
                pushRecord(records, {
                    id: `team:${team.id}`,
                    domain: 'teams',
                    title: String(team.name || 'Team'),
                    description: `${members.length} members · ${team.seriesId || 'cross-series'}`,
                    targetType: 'team',
                    targetId: String(team.id),
                    updatedAt: Number(team.updatedAt || now),
                    keywords: tokenize(
                        `${team.name || ''} team members ${members.map((member) => member.displayName || '').join(' ')}`
                    ),
                    payload: {
                        workspaceTab: 'Teams',
                        dashboardSection: 'teams'
                    }
                });
            }
        } catch {
            /* ignore */
        }
    }
    if (!records.some((record) => record.domain === 'teams')) {
        pushRecord(records, {
            id: 'team:default',
            domain: 'teams',
            title: 'Team Workspace',
            description: 'Manage members, assignments, and collaboration.',
            targetType: 'team',
            targetId: 'default',
            updatedAt: now,
            keywords: tokenize('team workspace members assignments collaboration'),
            payload: {
                workspaceTab: 'Teams',
                dashboardSection: 'teams'
            }
        });
    }

    // Revenue insights
    const revenueAnalysis = masterMonetizationAnalysis(primarySeriesId, reels, { emitDiagnostics: false });
    for (const recommendation of revenueAnalysis.recommendations || []) {
        pushRecord(records, {
            id: `revenue:${recommendation.id}`,
            domain: 'revenue_insights',
            title: recommendation.title,
            description: recommendation.detail,
            targetType: 'revenue_insight',
            targetId: String(recommendation.id),
            updatedAt: now,
            keywords: tokenize(
                `${recommendation.title} ${recommendation.detail} revenue creator monetization`
            ),
            payload: {
                workspaceTab: 'Analytics',
                dashboardSection: 'revenue'
            }
        });
    }

    // Security incidents
    for (const event of loadSecurityEvents().events.slice(-120).reverse()) {
        pushRecord(records, {
            id: `security:${event.id}`,
            domain: 'security_incidents',
            title: `${event.category} ${event.type}`,
            description: `Security ${event.severity || 'event'} · ${event.message || event.title || 'incident detected'}`,
            targetType: 'security_incident',
            targetId: String(event.id),
            updatedAt: Number(event.timestamp || now),
            keywords: tokenize(
                `${event.category || ''} ${event.type || ''} security incident threat issue`
            ),
            payload: {
                workspaceTab: 'System',
                dashboardSection: 'security'
            }
        });
    }

    // Sentinel recommendations
    const sentinel = masterAnalysis(primarySeriesId, reels, { emitDiagnostics: false });
    for (let i = 0; i < (sentinel.recommendations || []).length; i += 1) {
        const recommendation = sentinel.recommendations[i];
        pushRecord(records, {
            id: `sentinel:${primarySeriesId}:${i}`,
            domain: 'sentinel_recommendations',
            title: `Sentinel Recommendation ${i + 1}`,
            description: recommendation,
            targetType: 'sentinel_recommendation',
            targetId: `${primarySeriesId}:${i}`,
            updatedAt: now,
            keywords: tokenize(`${recommendation} sentinel security readiness`),
            payload: {
                workspaceTab: 'Overview',
                dashboardSection: 'security'
            }
        });
    }

    // Guide Me content
    const guideBrief = buildGuideMeOperationalBrief(primarySeriesId, reels, { silent: true });
    const guideSections = listGuideMeSections();
    for (const section of guideSections) {
        pushRecord(records, {
            id: `guide:${section.id}`,
            domain: 'guide_me_content',
            title: section.title,
            description: section.whatIsThis,
            targetType: 'guide_me_content',
            targetId: section.id,
            updatedAt: now,
            keywords: tokenize(
                `${section.title} ${section.whatIsThis} ${section.whyItMatters} guide me`
            ),
            payload: {
                workspaceTab: section.workspace === 'Panel' ? 'Overview' : section.workspace,
                guideSection: section.id
            }
        });
    }
    pushRecord(records, {
        id: 'guide:mission-of-the-day',
        domain: 'guide_me_content',
        title: 'Mission of the Day',
        description: guideBrief.missionOfTheDay || 'Guide Me mission focus',
        targetType: 'guide_me_content',
        targetId: 'mission-of-the-day',
        updatedAt: now,
        keywords: tokenize(`${guideBrief.missionOfTheDay || ''} guide mission coaching`),
        payload: {
            workspaceTab: 'Overview',
            guideSection: 'overview'
        }
    });

    // Daily engagement cards
    const daily = getDailyEngagementState({ seriesId: primarySeriesId, feedReels: reels });
    for (const [cardId, card] of Object.entries(daily.cards || {})) {
        pushRecord(records, {
            id: `daily:${cardId}`,
            domain: 'daily_engagement_cards',
            title: String(card.title || cardId),
            description: String(card.detail || 'Daily engagement insight'),
            targetType: 'daily_engagement_card',
            targetId: cardId,
            updatedAt: Number(daily.updatedAt || now),
            keywords: tokenize(`${card.title || ''} ${card.detail || ''} daily engagement`),
            payload: {
                workspaceTab: 'Overview',
                guideSection: 'overview'
            }
        });
    }

    return records;
}

function loadUniversalSearchStore() {
    if (typeof window === 'undefined') {
        return { version: UNIVERSAL_SEARCH_VERSION, updatedAt: Date.now(), records: [] };
    }
    try {
        const raw = localStorage.getItem(UNIVERSAL_SEARCH_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || !Array.isArray(parsed.records)) {
            return { version: UNIVERSAL_SEARCH_VERSION, updatedAt: Date.now(), records: [] };
        }
        return {
            version: parsed.version || UNIVERSAL_SEARCH_VERSION,
            updatedAt: Number(parsed.updatedAt) || Date.now(),
            records: parsed.records
        };
    } catch {
        return { version: UNIVERSAL_SEARCH_VERSION, updatedAt: Date.now(), records: [] };
    }
}

/** @param {UniversalSearchRecord[]} records */
function persistUniversalSearchStore(records) {
    const payload = {
        version: UNIVERSAL_SEARCH_VERSION,
        updatedAt: Date.now(),
        records
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem(UNIVERSAL_SEARCH_STORAGE_KEY, JSON.stringify(payload));
    }
    return payload;
}

export function indexUniversalSearchData() {
    const records = buildUniversalSearchIndex();
    const payload = persistUniversalSearchStore(records);
    const byDomain = records.reduce((acc, record) => {
        acc[record.domain] = (acc[record.domain] || 0) + 1;
        return acc;
    }, {});
    logUniversalSearchDiag('SEARCH_INDEX', {
        total: records.length,
        byDomain
    });
    return payload;
}

/**
 * @param {string} query
 * @param {UniversalSearchRecord} record
 * @param {string[]} terms
 */
function scoreRecord(query, record, terms) {
    const haystack = normalize(
        `${record.title} ${record.description} ${record.domain} ${(record.keywords || []).join(' ')}`
    );
    if (!haystack) return 0;

    let tokenHits = 0;
    for (const term of terms) {
        if (haystack.includes(term)) tokenHits += 1;
    }

    const phraseBoost = haystack.includes(normalize(query)) ? 1.2 : 0;
    const titleBoost = terms.some((term) => normalize(record.title).includes(term)) ? 0.8 : 0;
    const recencyHours = Math.max(0, (Date.now() - Number(record.updatedAt || 0)) / 3_600_000);
    const recencyBoost = recencyHours <= 6 ? 0.5 : recencyHours <= 24 ? 0.25 : 0;
    const weight = DOMAIN_WEIGHT[record.domain] || 1;
    const rawScore = (tokenHits + phraseBoost + titleBoost + recencyBoost) * weight;
    return rawScore;
}

/**
 * @param {string} query
 * @param {{ limit?: number }} [options]
 * @returns {{ query: string; total: number; results: UniversalSearchResult[]; tookMs: number }}
 */
export function searchUniversal(query, options = {}) {
    const started = Date.now();
    const value = String(query || '').trim();
    if (!value) {
        return { query: value, total: 0, results: [], tookMs: 0 };
    }

    const store = loadUniversalSearchStore();
    const records = store.records.length ? store.records : indexUniversalSearchData().records;
    const terms = expandQueryTokens(value);
    const limit = Math.max(1, Number(options.limit) || 20);

    const scored = records
        .map((record) => ({
            record,
            score: scoreRecord(value, record, terms)
        }))
        .filter((row) => row.score > 0.9)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    const results = scored.map((row) => ({
        title: row.record.title,
        description: row.record.description,
        targetType: row.record.targetType,
        targetId: row.record.targetId,
        confidenceScore: Math.max(0, Math.min(1, Number((row.score / 8).toFixed(3)))),
        domain: row.record.domain,
        payload: row.record.payload
    }));

    logUniversalSearchDiag('SEARCH_QUERY', {
        query: value,
        expandedTerms: terms,
        total: results.length,
        tookMs: Date.now() - started
    });

    return {
        query: value,
        total: results.length,
        results,
        tookMs: Date.now() - started
    };
}

/**
 * @param {UniversalSearchResult | null | undefined} result
 */
export function navigateUniversalSearchResult(result) {
    if (!result || typeof window === 'undefined') return false;
    /** @type {import('../navigation/deepNavigation.js').DeepNavigationTarget} */
    let target = {
        type: 'studio_tab',
        tab: String(result.payload?.workspaceTab || 'Overview'),
        dashboardSection: String(result.payload?.dashboardSection || '')
    };

    if (result.targetType === 'reel') {
        target = {
            type: 'reel',
            reelId: result.targetId
        };
    } else if (result.targetType === 'episode') {
        target = {
            type: 'episode',
            episodeId: result.targetId,
            reelId: String(result.payload?.reelId || '')
        };
    } else if (result.targetType === 'task' || result.targetType === 'workflow') {
        target = {
            type: 'workflow',
            workflowNavigation: result.payload?.navTarget
                ? {
                      target: result.payload.navTarget,
                      episodeId: result.payload?.episodeId || null,
                      reelId: result.payload?.reelId || null,
                      focusField: null,
                      selector: null
                  }
                : undefined,
            tab: String(result.payload?.workspaceTab || 'Production'),
            dashboardSection: String(result.payload?.dashboardSection || 'production')
        };
    } else if (result.targetType === 'marketplace_listing') {
        target = {
            type: 'marketplace_listing',
            listingId: result.targetId
        };
    } else if (result.targetType === 'security_incident') {
        target = {
            type: 'security_incident',
            incidentId: result.targetId
        };
    } else if (result.targetType === 'revenue_insight') {
        target = {
            type: 'revenue_section',
            section: 'revenue'
        };
    } else if (result.targetType === 'sentinel_recommendation') {
        target = {
            type: 'security_incident',
            incidentId: result.targetId
        };
    } else if (result.targetType === 'guide_me_content' || result.targetType === 'daily_engagement_card') {
        target = {
            type: 'studio_tab',
            tab: String(result.payload?.workspaceTab || 'Overview'),
            section: String(result.payload?.guideSection || '')
        };
    } else if (result.targetType === 'notification') {
        target = {
            type: 'command_center_page',
            dashboardSection: String(result.payload?.dashboardSection || 'operations'),
            tab: String(result.payload?.workspaceTab || 'System')
        };
    }

    const navigated = navigateToTarget(target);
    logUniversalSearchDiag('SEARCH_NAVIGATION', {
        targetType: result.targetType,
        targetId: result.targetId,
        title: result.title,
        success: navigated
    });
    return navigated;
}

/**
 * @param {string} query
 * @returns {{ query: string; suggestions: string[] }}
 */
export function suggestUniversalQueries(query = '') {
    const value = normalize(query);
    const records = loadUniversalSearchStore().records;
    const seed = records.length ? records : indexUniversalSearchData().records;
    const tokenFreq = new Map();
    for (const record of seed) {
        for (const token of record.keywords || []) {
            if (token.length < 3) continue;
            if (value && !token.includes(value) && !value.includes(token)) continue;
            tokenFreq.set(token, (tokenFreq.get(token) || 0) + 1);
        }
    }
    const top = Array.from(tokenFreq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([token]) => token);
    const base = [
        'show missing episodes',
        'security issues',
        'creator revenue',
        'upload reel',
        'workflow blockers',
        'daily engagement',
        'sentinel recommendations'
    ];
    return {
        query: String(query || ''),
        suggestions: [...new Set([...top, ...base])].filter((item) => !value || item.includes(value)).slice(0, 10)
    };
}

let universalSearchInitialized = false;
let refreshTimer = null;

/**
 * @param {{ forceReindex?: boolean }} [options]
 */
export function initUniversalSearchEngine(options = {}) {
    if (typeof window === 'undefined') return null;
    initDeepNavigation();
    if (universalSearchInitialized) {
        if (options.forceReindex) indexUniversalSearchData();
        return window.__reelforgeUniversalSearch || null;
    }
    universalSearchInitialized = true;

    const scheduleReindex = (reason = 'event') => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            indexUniversalSearchData();
            logUniversalSearchDiag('SEARCH_INDEX', { reason });
        }, 140);
    };

    if (options.forceReindex) indexUniversalSearchData();
    else {
        const store = loadUniversalSearchStore();
        if (!store.records.length) indexUniversalSearchData();
    }

    const refreshEvents = [
        ['reelforge:upload-updated', 'studio_data_changed'],
        ['reelforge:sync-schedule', 'studio_data_changed'],
        ['reelforge:command-center-updated', 'studio_data_changed'],
        ['reelforge:workflow-tasks-updated', 'workflow_changed'],
        ['reelforge:notifications-updated', 'notifications_changed'],
        ['reelforge:marketplace-updated', 'marketplace_changed'],
        ['reelforge:threat-updated', 'security_changed'],
        ['reelforge:daily-engagement-updated', 'daily_engagement_changed']
    ];
    for (const [eventName, reason] of refreshEvents) {
        window.addEventListener(eventName, () => scheduleReindex(reason));
    }

    window.__reelforgeUniversalSearch = {
        UNIVERSAL_SEARCH_VERSION,
        UNIVERSAL_SEARCH_STORAGE_KEY,
        buildUniversalSearchIndex,
        indexUniversalSearchData,
        searchUniversal,
        suggestUniversalQueries,
        navigateUniversalSearchResult,
        logUniversalSearchDiag
    };

    return window.__reelforgeUniversalSearch;
}
