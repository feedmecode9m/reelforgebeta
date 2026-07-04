/**
 * Phase 56 — ReelForge Discovery Engine.
 * Global NLP-inspired search across platform domains.
 */

import { get } from 'svelte/store';
import { seriesCatalog, reelSeriesMetadata } from '../series/seriesStore.js';
import { getWorkflowTasksForSeries } from '../workflow/workflowEngine.js';
import { getNotifications } from '../notifications/notificationCenter.js';
import { TEAM_STORAGE_KEY, getCurrentTeamUserId } from '../teams/creatorTeams.js';
import { buildRevenueDashboardBrief } from '../revenue/revenueCore.js';
import { buildHeroCandidates, loadHeroManagerConfig } from '../hero/heroIntelligence.js';
import { listMarketplaceListings, getMarketplaceActivity } from '../marketplace/marketplaceEngine.js';
import { loadSecurityEvents } from '../security/threatDetectionEngine.js';
import { masterAnalysis } from '../sentinel/sentinelAssistant.js';
import { isHeroAsset } from '../hero/heroDomainGuard.js';

export const DISCOVERY_ENGINE_VERSION = '1.0.0';
export const DISCOVERY_INDEX_STORAGE_KEY = 'reelforge_discovery_index';

/**
 * @typedef {'vault' | 'series_metadata' | 'episode' | 'workflow' | 'notification' | 'team' | 'revenue' | 'hero_content' | 'marketplace' | 'security_event' | 'sentinel_recommendation'} DiscoverySource
 */

/**
 * @typedef {Object} DiscoveryDocument
 * @property {string} id
 * @property {DiscoverySource} source
 * @property {string} title
 * @property {string} text
 * @property {string[]} keywords
 * @property {string | null} seriesId
 * @property {string | null} creatorId
 * @property {number} updatedAt
 * @property {Record<string, unknown>} payload
 */

/**
 * @typedef {Object} DiscoveryResult
 * @property {string} id
 * @property {DiscoverySource} source
 * @property {string} title
 * @property {number} score
 * @property {string | null} seriesId
 * @property {string | null} creatorId
 * @property {number} updatedAt
 * @property {Record<string, unknown>} payload
 */

const STOP_WORDS = new Set([
    'the',
    'and',
    'or',
    'for',
    'with',
    'into',
    'from',
    'this',
    'that',
    'is',
    'are',
    'of',
    'to',
    'in',
    'on',
    'at',
    'by',
    'a',
    'an'
]);

const SOURCE_WEIGHTS = {
    vault: 1.1,
    series_metadata: 1.15,
    episode: 1.2,
    workflow: 1.2,
    notification: 1.05,
    team: 1.15,
    revenue: 1.1,
    hero_content: 1.1,
    marketplace: 1.1,
    security_event: 1.2,
    sentinel_recommendation: 1.25
};

/**
 * @param {'DISCOVERY_INDEX' | 'DISCOVERY_QUERY' | 'DISCOVERY_RESULT'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logDiscoveryDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {string} value */
function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9_\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** @param {string} value */
function tokenize(value) {
    return normalizeText(value)
        .split(' ')
        .filter((token) => token && !STOP_WORDS.has(token));
}

/** @param {string} a @param {string} b */
function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= a.length; j += 1) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i += 1) {
        for (let j = 1; j <= a.length; j += 1) {
            const cost = b[i - 1] === a[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }
    return matrix[b.length][a.length];
}

/**
 * @param {DiscoveryDocument[]} docs
 * @returns {{ version: string; updatedAt: number; totalDocuments: number; docs: DiscoveryDocument[] }}
 */
function persistDiscoveryIndex(docs) {
    const payload = {
        version: DISCOVERY_ENGINE_VERSION,
        updatedAt: Date.now(),
        totalDocuments: docs.length,
        docs
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem(DISCOVERY_INDEX_STORAGE_KEY, JSON.stringify(payload));
    }
    return payload;
}

/** @returns {{ version: string; updatedAt: number; totalDocuments: number; docs: DiscoveryDocument[] }} */
function loadDiscoveryIndexStore() {
    if (typeof window === 'undefined') {
        return { version: DISCOVERY_ENGINE_VERSION, updatedAt: Date.now(), totalDocuments: 0, docs: [] };
    }
    try {
        const raw = localStorage.getItem(DISCOVERY_INDEX_STORAGE_KEY);
        if (!raw) return { version: DISCOVERY_ENGINE_VERSION, updatedAt: Date.now(), totalDocuments: 0, docs: [] };
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.docs)) {
            return { version: DISCOVERY_ENGINE_VERSION, updatedAt: Date.now(), totalDocuments: 0, docs: [] };
        }
        return {
            version: parsed.version || DISCOVERY_ENGINE_VERSION,
            updatedAt: Number(parsed.updatedAt) || Date.now(),
            totalDocuments: parsed.docs.length,
            docs: parsed.docs
        };
    } catch {
        return { version: DISCOVERY_ENGINE_VERSION, updatedAt: Date.now(), totalDocuments: 0, docs: [] };
    }
}

/** @param {DiscoveryDocument[]} docs @param {DiscoveryDocument} doc */
function pushDoc(docs, doc) {
    if (!doc.title || !doc.text) return;
    docs.push(doc);
}

/** @returns {DiscoveryDocument[]} */
export function buildDiscoveryIndex() {
    const now = Date.now();
    /** @type {DiscoveryDocument[]} */
    const docs = [];
    const catalog = get(seriesCatalog);
    const metadataMap = get(reelSeriesMetadata);
    const seriesIds = catalog.map((series) => series.id);
    const teamUser = getCurrentTeamUserId();

    // Series + episodes
    for (const series of catalog) {
        pushDoc(docs, {
            id: `series:${series.id}`,
            source: 'series_metadata',
            title: series.title,
            text: `${series.title} ${series.description || ''} ${series.genre || ''} ${(series.tags || []).join(' ')}`,
            keywords: tokenize(
                `${series.title} ${series.description || ''} ${series.genre || ''} ${(series.tags || []).join(' ')}`
            ),
            seriesId: series.id,
            creatorId: null,
            updatedAt: now,
            payload: { genre: series.genre, releaseYear: series.releaseYear }
        });

        for (const season of series.seasons || []) {
            for (const episode of season.episodes || []) {
                pushDoc(docs, {
                    id: `episode:${episode.episodeId}`,
                    source: 'episode',
                    title: `${series.title} S${season.seasonNumber}E${episode.episodeNumber} ${episode.title}`,
                    text: `${episode.title} ${episode.description || ''} ${episode.status || ''} ${(episode.tags || []).join(' ')}`,
                    keywords: tokenize(
                        `${series.title} ${episode.title} ${episode.description || ''} ${episode.status || ''} ${(episode.tags || []).join(' ')}`
                    ),
                    seriesId: series.id,
                    creatorId: null,
                    updatedAt: now,
                    payload: {
                        episodeId: episode.episodeId,
                        seasonNumber: season.seasonNumber,
                        episodeNumber: episode.episodeNumber,
                        status: episode.status || null
                    }
                });
            }
        }
    }

    for (const [reelId, meta] of Object.entries(metadataMap || {})) {
        pushDoc(docs, {
            id: `series-meta:${reelId}`,
            source: 'series_metadata',
            title: `${meta.seriesName || 'Series'} · ${meta.episodeTitle || reelId}`,
            text: `${meta.seriesName || ''} ${meta.episodeTitle || ''} ${meta.description || ''} ${meta.genre || ''} ${(meta.tags || []).join(' ')}`,
            keywords: tokenize(
                `${meta.seriesName || ''} ${meta.episodeTitle || ''} ${meta.description || ''} ${meta.genre || ''} ${(meta.tags || []).join(' ')}`
            ),
            seriesId: meta.seriesId || null,
            creatorId: null,
            updatedAt: Number(meta.updatedAt || now),
            payload: {
                reelId,
                episodeId: meta.episodeId || null
            }
        });
    }

    // Workflows
    for (const seriesId of seriesIds) {
        for (const task of getWorkflowTasksForSeries(seriesId)) {
            pushDoc(docs, {
                id: `workflow:${task.id}`,
                source: 'workflow',
                title: task.title || task.taskType || 'Workflow Task',
                text: `${task.title || ''} ${task.taskType || ''} ${task.status || ''} ${task.episodeId || ''} ${task.assignedTo || ''}`,
                keywords: tokenize(
                    `${task.title || ''} ${task.taskType || ''} ${task.status || ''} ${task.episodeId || ''} ${task.assignedTo || ''}`
                ),
                seriesId,
                creatorId: task.assignedTo || null,
                updatedAt: Number(task.createdAt || now),
                payload: {
                    status: task.status,
                    priority: task.priority,
                    estimatedImpact: task.estimatedImpact
                }
            });
        }
    }

    // Notifications
    for (const item of getNotifications()) {
        pushDoc(docs, {
            id: `notification:${item.id}`,
            source: 'notification',
            title: item.type || 'Notification',
            text: `${item.message || ''} ${item.type || ''} ${JSON.stringify(item.payload || {})}`,
            keywords: tokenize(`${item.message || ''} ${item.type || ''}`),
            seriesId: String(item.payload?.seriesId || '') || null,
            creatorId: item.userId || null,
            updatedAt: Number(item.createdAt || now),
            payload: {
                read: item.read,
                notificationType: item.type
            }
        });
    }

    // Teams
    if (typeof window !== 'undefined') {
        try {
            const raw = localStorage.getItem(TEAM_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                for (const team of parsed.teams || []) {
                    const members = parsed.members?.[team.id] || [];
                    const activity = parsed.activity?.[team.id] || [];
                    pushDoc(docs, {
                        id: `team:${team.id}`,
                        source: 'team',
                        title: team.name || 'Production Team',
                        text: `${team.name || ''} ${team.seriesId || ''} ${members.map((m) => `${m.displayName || ''} ${m.role || ''}`).join(' ')} ${activity.map((a) => a.type || '').join(' ')}`,
                        keywords: tokenize(
                            `${team.name || ''} ${team.seriesId || ''} ${members.map((m) => `${m.displayName || ''} ${m.role || ''}`).join(' ')}`
                        ),
                        seriesId: team.seriesId || null,
                        creatorId: null,
                        updatedAt: Number(activity[0]?.createdAt || now),
                        payload: {
                            memberCount: members.length,
                            activityCount: activity.length
                        }
                    });
                }
            }
        } catch {
            /* ignore */
        }
    }

    // Revenue
    for (const seriesId of seriesIds.length ? seriesIds : ['series-neon-vengeance']) {
        const brief = buildRevenueDashboardBrief(seriesId, [], {});
        pushDoc(docs, {
            id: `revenue:${seriesId}`,
            source: 'revenue',
            title: `Revenue ${seriesId}`,
            text: `mrr ${brief.kpis.mrr.formatted} arr ${brief.kpis.arr.formatted} net ${brief.selectedEstimate.netCreatorCents} forecast ${brief.forecasts.map((f) => f.label).join(' ')}`,
            keywords: tokenize(
                `revenue mrr arr forecast ${brief.kpis.mrr.formatted} ${brief.kpis.arr.formatted}`
            ),
            seriesId,
            creatorId: null,
            updatedAt: now,
            payload: {
                mrrCents: brief.kpis.mrr.cents,
                arrCents: brief.kpis.arr.cents
            }
        });
    }

    // Hero content
    const heroConfig = loadHeroManagerConfig();
    const heroCandidates = buildHeroCandidates([], { seriesId: seriesIds[0] || 'series-neon-vengeance' });
    for (const candidate of heroCandidates.slice(0, 12)) {
        if (
            isHeroAsset({
                id: candidate?.id,
                assetId: candidate?.assetId,
                heroAssetId: heroConfig?.heroAssetId,
                name: candidate?.title,
                url: candidate?.videoUrl || candidate?.imageUrl || candidate?.backgroundVideo,
                thumbnail: candidate?.posterUrl || candidate?.thumbnailUrl
            })
        ) {
            continue;
        }
        pushDoc(docs, {
            id: `hero:${candidate.source}:${candidate.episodeId || candidate.seriesId || candidate.title}`,
            source: 'hero_content',
            title: candidate.title,
            text: `${candidate.title} ${candidate.subtitle || ''} ${candidate.insight || ''} ${candidate.source}`,
            keywords: tokenize(`${candidate.title} ${candidate.subtitle || ''} ${candidate.insight || ''}`),
            seriesId: candidate.seriesId || null,
            creatorId: String(candidate.meta?.creatorName || '') || null,
            updatedAt: now,
            payload: {
                source: candidate.source,
                score: candidate.score,
                heroType: heroConfig.heroType
            }
        });
    }

    // Marketplace
    for (const listing of listMarketplaceListings({ activeOnly: false })) {
        pushDoc(docs, {
            id: `marketplace:${listing.listingId}`,
            source: 'marketplace',
            title: listing.service.title,
            text: `${listing.service.title} ${listing.service.description || ''} ${listing.creator?.displayName || ''} ${listing.categoryLabel || ''}`,
            keywords: tokenize(
                `${listing.service.title} ${listing.service.description || ''} ${listing.creator?.displayName || ''} ${listing.categoryLabel || ''}`
            ),
            seriesId: null,
            creatorId: listing.creator?.creatorId || null,
            updatedAt: Number(listing.service.updatedAt || now),
            payload: {
                category: listing.service.category,
                active: listing.service.active
            }
        });
    }
    for (const entry of getMarketplaceActivity(30)) {
        pushDoc(docs, {
            id: `marketplace-activity:${entry.type}:${entry.id}`,
            source: 'marketplace',
            title: entry.title,
            text: `${entry.title} ${entry.type} ${entry.status || ''} ${entry.category || ''}`,
            keywords: tokenize(`${entry.title} ${entry.type} ${entry.status || ''} ${entry.category || ''}`),
            seriesId: null,
            creatorId: null,
            updatedAt: Number(entry.at || now),
            payload: entry
        });
    }

    // Security events
    const securityEvents = loadSecurityEvents().events.slice(-120);
    for (const event of securityEvents) {
        pushDoc(docs, {
            id: `security:${event.id}`,
            source: 'security_event',
            title: `${event.category} ${event.type}`,
            text: `${event.category} ${event.type} ${JSON.stringify(event.detail || {})}`,
            keywords: tokenize(`${event.category} ${event.type} ${JSON.stringify(event.detail || {})}`),
            seriesId: String(event.detail?.seriesId || '') || null,
            creatorId: null,
            updatedAt: Number(event.timestamp || now),
            payload: event
        });
    }

    // Sentinel recommendations
    for (const seriesId of seriesIds.length ? seriesIds : ['series-neon-vengeance']) {
        const analysis = masterAnalysis(seriesId, [], { emitDiagnostics: false });
        for (let i = 0; i < analysis.recommendations.length; i += 1) {
            const recommendation = analysis.recommendations[i];
            pushDoc(docs, {
                id: `sentinel:${seriesId}:recommendation:${i}`,
                source: 'sentinel_recommendation',
                title: `Sentinel Recommendation ${i + 1}`,
                text: `${recommendation} ${analysis.executiveSummary || ''}`,
                keywords: tokenize(`${recommendation} ${analysis.executiveSummary || ''}`),
                seriesId,
                creatorId: teamUser || null,
                updatedAt: now,
                payload: {
                    riskLevel: analysis.riskLevel,
                    threatLevel: analysis.threatLevel
                }
            });
        }
    }

    return docs;
}

/** @returns {{ version: string; updatedAt: number; totalDocuments: number; docs: DiscoveryDocument[] }} */
export function indexPlatformData() {
    const docs = buildDiscoveryIndex();
    const persisted = persistDiscoveryIndex(docs);
    const bySource = docs.reduce((acc, doc) => {
        acc[doc.source] = (acc[doc.source] || 0) + 1;
        return acc;
    }, {});
    logDiscoveryDiag('DISCOVERY_INDEX', {
        totalDocuments: persisted.totalDocuments,
        bySource
    });
    return persisted;
}

/**
 * @param {string} query
 * @param {DiscoveryDocument} doc
 * @param {string[]} queryTokens
 */
function scoreDocument(query, doc, queryTokens) {
    const haystack = normalizeText(`${doc.title} ${doc.text} ${(doc.keywords || []).join(' ')}`);
    if (!haystack) return 0;

    // keyword score
    let keywordScore = 0;
    for (const token of queryTokens) {
        if (haystack.includes(token)) keywordScore += 14;
    }

    // fuzzy score
    const candidateTokens = tokenize(`${doc.title} ${(doc.keywords || []).join(' ')}`).slice(0, 32);
    let fuzzyScore = 0;
    for (const token of queryTokens) {
        let best = 0;
        for (const candidate of candidateTokens) {
            const dist = levenshtein(token, candidate);
            const norm = 1 - dist / Math.max(token.length, candidate.length, 1);
            best = Math.max(best, norm);
        }
        fuzzyScore += Math.max(0, best) * 9;
    }

    // semantic-like score
    const semanticScore = (SOURCE_WEIGHTS[doc.source] || 1) * 11;

    // recent activity boost
    const ageHours = Math.max(0, (Date.now() - Number(doc.updatedAt || 0)) / 3_600_000);
    const recentBoost = ageHours <= 6 ? 12 : ageHours <= 24 ? 8 : ageHours <= 72 ? 4 : 0;

    // creator boost
    const currentCreator = getCurrentTeamUserId();
    const creatorBoost = doc.creatorId && String(doc.creatorId).includes(currentCreator) ? 6 : 0;

    // series boost
    const seriesBoost = doc.seriesId ? 4 : 0;

    // direct phrase hit
    const phraseBoost = haystack.includes(normalizeText(query)) ? 8 : 0;

    return keywordScore + fuzzyScore + semanticScore + recentBoost + creatorBoost + seriesBoost + phraseBoost;
}

/**
 * @param {string} query
 * @returns {{ query: string; total: number; results: DiscoveryResult[]; tookMs: number }}
 */
export function searchPlatform(query) {
    const started = Date.now();
    const safeQuery = String(query || '').trim();
    if (!safeQuery) {
        const empty = { query: safeQuery, total: 0, results: [], tookMs: 0 };
        logDiscoveryDiag('DISCOVERY_QUERY', empty);
        return empty;
    }

    const store = loadDiscoveryIndexStore();
    const docs = store.docs.length ? store.docs : indexPlatformData().docs;
    const queryTokens = tokenize(safeQuery);

    const scored = docs
        .map((doc) => ({ doc, score: scoreDocument(safeQuery, doc, queryTokens) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40);

    const results = scored.map((row) => ({
        id: row.doc.id,
        source: row.doc.source,
        title: row.doc.title,
        score: Math.round(row.score * 100) / 100,
        seriesId: row.doc.seriesId,
        creatorId: row.doc.creatorId,
        updatedAt: row.doc.updatedAt,
        payload: row.doc.payload
    }));

    const response = {
        query: safeQuery,
        total: results.length,
        results,
        tookMs: Date.now() - started
    };

    logDiscoveryDiag('DISCOVERY_QUERY', {
        query: safeQuery,
        tokenCount: queryTokens.length,
        total: response.total,
        tookMs: response.tookMs
    });
    for (const item of results.slice(0, 10)) {
        logDiscoveryDiag('DISCOVERY_RESULT', {
            query: safeQuery,
            id: item.id,
            source: item.source,
            score: item.score,
            title: item.title
        });
    }

    return response;
}

/**
 * @param {string} query
 * @returns {{ query: string; suggestions: string[] }}
 */
export function suggestQueries(query = '') {
    const store = loadDiscoveryIndexStore();
    const docs = store.docs.length ? store.docs : indexPlatformData().docs;
    const normalizedQuery = normalizeText(query);
    const terms = new Map();

    for (const doc of docs) {
        for (const token of doc.keywords || []) {
            if (token.length < 3) continue;
            if (normalizedQuery && !token.includes(normalizedQuery) && !normalizedQuery.includes(token)) continue;
            terms.set(token, (terms.get(token) || 0) + 1);
        }
    }

    const topTerms = Array.from(terms.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([term]) => term);

    const base = [
        'security alerts',
        'workflow blockers',
        'marketplace listings',
        'hero recommendations',
        'revenue forecast',
        'team assignments',
        'sentinel recommendations'
    ];

    const suggestions = [...new Set([...topTerms, ...base])]
        .filter((item) => !normalizedQuery || item.includes(normalizedQuery))
        .slice(0, 10);

    return { query: String(query || ''), suggestions };
}

let discoveryInitialized = false;

export function initDiscoveryEngine() {
    if (typeof window === 'undefined' || discoveryInitialized) return null;
    discoveryInitialized = true;

    const ensureIndexed = () => {
        const store = loadDiscoveryIndexStore();
        if (!store.docs.length) indexPlatformData();
    };

    ensureIndexed();
    window.addEventListener('reelforge:notifications-updated', ensureIndexed);
    window.addEventListener('reelforge:workflow-tasks-updated', ensureIndexed);
    window.addEventListener('reelforge:teams-updated', ensureIndexed);
    window.addEventListener('reelforge:marketplace-updated', ensureIndexed);
    window.addEventListener('reelforge:threat-updated', ensureIndexed);
    window.addEventListener('reelforge:hero-intelligence-updated', ensureIndexed);

    window.__reelforgeDiscovery = {
        DISCOVERY_ENGINE_VERSION,
        DISCOVERY_INDEX_STORAGE_KEY,
        indexPlatformData,
        buildDiscoveryIndex,
        searchPlatform,
        suggestQueries,
        logDiscoveryDiag
    };

    logDiscoveryDiag('DISCOVERY_INDEX', {
        phase: 'engine_initialized',
        version: DISCOVERY_ENGINE_VERSION
    });

    return window.__reelforgeDiscovery;
}
