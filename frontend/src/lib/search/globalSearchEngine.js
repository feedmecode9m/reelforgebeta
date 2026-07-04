/**
 * Phase 72 — Advanced Search Engine (metadata intelligence).
 * Replaces command search with weighted metadata search.
 */

import { get } from 'svelte/store';
import { seriesCatalog } from '../series/seriesStore.js';
import { initDeepNavigation, navigateToTarget } from '../navigation/deepNavigation.js';

export const GLOBAL_SEARCH_VERSION = '72.0.0';
export const GLOBAL_SEARCH_STORAGE_KEY = 'reelforge_global_search_index';
export const GLOBAL_SEARCH_ANALYTICS_KEY = 'reelforge_global_search_analytics';

const DOMAIN_CATEGORIES = ['Metadata'];

const PRIORITY_FIELDS = /** @type {const} */ ([
    'title',
    'episodeTitle',
    'featuredPeople',
    'communityRepresented',
    'educationalThemes',
    'keywords',
    'description'
]);

const FIELD_WEIGHTS = {
    title: 14,
    episodeTitle: 12,
    featuredPeople: 10,
    communityRepresented: 9,
    educationalThemes: 8,
    location: 8,
    topics: 7,
    keywords: 6,
    description: 4
};

/** @typedef {{ title: string; category: string; destination: Record<string, unknown>; confidenceScore: number; matchType: 'metadata'; command: string; matchedField: string }} GlobalSearchResult */

/** @typedef {{ id: string; command: string; title: string; category: string; description: string; destination: Record<string, unknown>; fields: Record<string, string | string[]> }} SearchRecord */

/** @param {'GLOBAL_SEARCH' | 'SEARCH_RESULT' | 'SEARCH_NAVIGATION'} tag @param {Record<string, unknown>} [detail] */
export function logGlobalSearchDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @param {string} value */
function normalize(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** @param {string} value */
function tokenize(value) {
    return normalize(value)
        .split(' ')
        .filter(Boolean);
}

function loadContentIntelligenceDraft() {
    if (typeof window === 'undefined') {
        return {
            series: {},
            episode: {}
        };
    }
    try {
        const raw = localStorage.getItem('reelforge_content_intelligence_draft');
        const parsed = raw ? JSON.parse(raw) : {};
        return {
            series: parsed?.series || {},
            episode: parsed?.episode || {}
        };
    } catch {
        return {
            series: {},
            episode: {}
        };
    }
}

function joinValues(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || '')).join(' ');
    return String(value || '');
}

function buildMetadataRecords() {
    const catalog = get(seriesCatalog);
    const ci = loadContentIntelligenceDraft();
    /** @type {SearchRecord[]} */
    const records = [];

    for (const series of catalog || []) {
        for (const season of series.seasons || []) {
            for (const episode of season.episodes || []) {
                const seriesTitle = String(ci.series?.title || series.title || '').trim();
                const episodeTitle = String(ci.episode?.episodeTitle || episode.title || '').trim();
                const description = String(ci.episode?.description || episode.description || series.description || '').trim();
                const keywords = [
                    ...(Array.isArray(ci.episode?.keywords) ? ci.episode.keywords : []),
                    ...(Array.isArray(ci.series?.keywords) ? ci.series.keywords : []),
                    ...(Array.isArray(ci.episode?.topics) ? ci.episode.topics : []),
                    ...(Array.isArray(ci.series?.tags) ? ci.series.tags : []),
                    ...(Array.isArray(episode?.tags) ? episode.tags : []),
                    ...(Array.isArray(series?.tags) ? series.tags : [])
                ];
                records.push({
                    id: `episode:${episode.episodeId}`,
                    command: `${seriesTitle} ${episodeTitle}`.trim(),
                    title: `${series.title} — S${season.seasonNumber}E${episode.episodeNumber} ${episode.title}`,
                    category: 'Metadata',
                    description: description || 'Episode metadata',
                    destination: {
                        type: 'episode',
                        episodeId: episode.episodeId,
                        dashboardSection: 'content',
                        tab: 'Content'
                    },
                    fields: {
                        title: seriesTitle || series.title || '',
                        episodeTitle: episodeTitle || episode.title || '',
                        featuredPeople: Array.isArray(ci.episode?.featuredPeople) ? ci.episode.featuredPeople : [],
                        communityRepresented: ci.series?.communityRepresented || '',
                        educationalThemes: ci.series?.educationalThemes || '',
                        location: ci.episode?.location || '',
                        topics: Array.isArray(ci.episode?.topics) ? ci.episode.topics : [],
                        keywords,
                        description
                    }
                });
            }
        }
    }
    return records;
}

function scoreField(queryTokens, fieldValue, weight) {
    const text = normalize(joinValues(fieldValue));
    if (!text) return 0;
    const phrase = normalize(queryTokens.join(' '));
    const phraseMatch = phrase.length > 0 && text.includes(phrase);
    let tokenHits = 0;
    for (const token of queryTokens) {
        if (text.includes(token)) tokenHits += 1;
    }
    if (tokenHits === 0) return 0;
    const tokenCoverage = tokenHits / Math.max(1, queryTokens.length);
    return (phraseMatch ? 1.5 : 1) * weight * tokenCoverage;
}

function loadAnalytics() {
    if (typeof window === 'undefined') {
        return { totalQueries: 0, history: [], fieldHitCounts: {} };
    }
    try {
        const raw = localStorage.getItem(GLOBAL_SEARCH_ANALYTICS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') {
            return { totalQueries: 0, history: [], fieldHitCounts: {} };
        }
        return {
            totalQueries: Number(parsed.totalQueries || 0),
            history: Array.isArray(parsed.history) ? parsed.history : [],
            fieldHitCounts: parsed.fieldHitCounts && typeof parsed.fieldHitCounts === 'object' ? parsed.fieldHitCounts : {}
        };
    } catch {
        return { totalQueries: 0, history: [], fieldHitCounts: {} };
    }
}

function persistAnalytics(payload) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(GLOBAL_SEARCH_ANALYTICS_KEY, JSON.stringify(payload));
}

/** @returns {{ totalQueries: number; history: { query: string; resultCount: number; topField: string; timestamp: number }[]; fieldHitCounts: Record<string, number> }} */
export function getGlobalSearchAnalytics() {
    return loadAnalytics();
}

export function buildGlobalSearchIndex() {
    const records = buildMetadataRecords().map((entry) => ({
        ...entry,
        version: GLOBAL_SEARCH_VERSION
    }));

    if (typeof window !== 'undefined') {
        localStorage.setItem(
            GLOBAL_SEARCH_STORAGE_KEY,
            JSON.stringify({
                version: GLOBAL_SEARCH_VERSION,
                updatedAt: Date.now(),
                records
            })
        );
    }
    return records;
}

/** @param {string} query @param {{ limit?: number }} [options] */
export function searchGlobalCommands(query, options = {}) {
    const limit = Math.max(1, Number(options?.limit) || 20);
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) {
        return { query: '', total: 0, results: [] };
    }

    const commandRecords = buildGlobalSearchIndex();
    const queryTokens = tokenize(normalizedQuery);
    /** @type {GlobalSearchResult[]} */
    const ranked = [];

    for (const command of commandRecords) {
        let bestField = '';
        let bestFieldScore = 0;
        let totalScore = 0;
        for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
            const score = scoreField(queryTokens, command.fields?.[field], weight);
            totalScore += score;
            if (score > bestFieldScore) {
                bestFieldScore = score;
                bestField = field;
            }
        }
        if (totalScore <= 0.8) continue;
        ranked.push({
            command: command.command,
            title: command.title,
            category: command.category,
            destination: command.destination,
            confidenceScore: Number(Math.min(0.99, totalScore / 24).toFixed(3)),
            matchType: 'metadata',
            matchedField: bestField || 'description'
        });
    }

    const deduped = [];
    const seen = new Set();
    for (const item of ranked.sort((a, b) => b.confidenceScore - a.confidenceScore)) {
        const key = `${item.title}:${item.category}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }

    const results = deduped.slice(0, limit);

    const analytics = loadAnalytics();
    const fieldHitCounts = { ...analytics.fieldHitCounts };
    for (const result of results.slice(0, 10)) {
        const field = result.matchedField || 'description';
        fieldHitCounts[field] = Number(fieldHitCounts[field] || 0) + 1;
    }
    const topField = results[0]?.matchedField || '';
    const history = [
        {
            query: normalizedQuery,
            resultCount: results.length,
            topField,
            timestamp: Date.now()
        },
        ...(analytics.history || [])
    ].slice(0, 30);
    persistAnalytics({
        totalQueries: Number(analytics.totalQueries || 0) + 1,
        history,
        fieldHitCounts
    });

    logGlobalSearchDiag('GLOBAL_SEARCH', {
        query: normalizedQuery,
        domainsIndexed: DOMAIN_CATEGORIES,
        resultCount: results.length,
        topField
    });
    for (const result of results.slice(0, 8)) {
        logGlobalSearchDiag('SEARCH_RESULT', {
            title: result.title,
            category: result.category,
            destination: result.destination,
            confidenceScore: result.confidenceScore,
            matchType: result.matchType,
            matchedField: result.matchedField
        });
    }

    return {
        query: normalizedQuery,
        total: results.length,
        results
    };
}

/** @param {GlobalSearchResult | null | undefined} result */
export function navigateGlobalSearchResult(result) {
    if (!result || typeof window === 'undefined') return false;
    const destination = result.destination || {};
    let ok = false;
    try {
        ok = Boolean(navigateToTarget(/** @type {any} */ (destination)));
        window.dispatchEvent(new CustomEvent('reelforge:search-navigate', { detail: destination }));
    } catch {
        ok = false;
    }
    logGlobalSearchDiag('SEARCH_NAVIGATION', {
        title: result.title,
        category: result.category,
        destination,
        success: ok
    });
    return ok;
}

/** @param {string} query */
export function suggestGlobalCommands(query = '') {
    const normalizedQuery = normalize(query);
    const defaults = ['Black Farmers', 'Alabama', 'Gullah Geechee', 'Land Ownership', 'Food Justice'];
    if (!normalizedQuery) return { query: '', suggestions: defaults };
    const records = buildMetadataRecords();
    const terms = new Map();
    for (const record of records) {
        for (const key of PRIORITY_FIELDS) {
            for (const token of tokenize(joinValues(record.fields?.[key] || ''))) {
                if (token.length < 3) continue;
                if (!token.includes(normalizedQuery)) continue;
                terms.set(token, Number(terms.get(token) || 0) + 1);
            }
        }
    }
    const smart = Array.from(terms.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([token]) => token);
    const suggestions = [...new Set([...smart, ...defaults])];
    return { query: normalizedQuery, suggestions: suggestions.length ? suggestions.slice(0, 10) : defaults.slice(0, 6) };
}

let globalSearchInitialized = false;

export function initGlobalSearchEngine() {
    if (typeof window === 'undefined') return null;
    initDeepNavigation();
    if (globalSearchInitialized && window.__reelforgeGlobalSearchEngine) {
        return window.__reelforgeGlobalSearchEngine;
    }
    globalSearchInitialized = true;
    const records = buildGlobalSearchIndex();
    logGlobalSearchDiag('GLOBAL_SEARCH', {
        mode: 'init',
        domainsIndexed: DOMAIN_CATEGORIES,
        indexedRecords: records.length
    });

    window.__reelforgeGlobalSearchEngine = {
        GLOBAL_SEARCH_VERSION,
        GLOBAL_SEARCH_STORAGE_KEY,
        GLOBAL_SEARCH_ANALYTICS_KEY,
        DOMAIN_CATEGORIES,
        buildGlobalSearchIndex,
        searchGlobalCommands,
        suggestGlobalCommands,
        navigateGlobalSearchResult,
        getGlobalSearchAnalytics,
        logGlobalSearchDiag
    };
    return window.__reelforgeGlobalSearchEngine;
}
