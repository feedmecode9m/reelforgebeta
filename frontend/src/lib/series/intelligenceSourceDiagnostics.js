/**
 * Intelligence source audit — Studio must be sole content authority.
 * Emits [INTELLIGENCE_SOURCE] { field, source, value }
 */

import { getReelSeriesMetadata } from './seriesStore.js';
import {
    buildSeriesIntelligence,
    getNextEpisodePreview,
    getReleaseYear,
    getSeriesCompletionPercent,
    getSeriesEpisodeCounts,
    getContinueWatchingPercent,
    resolveDisplayEpisodeStatus,
    resolveGenreLabel
} from './seriesIntelligence.js';
import { getStoredWatchPercent } from './seriesWatchProgress.js';

/** @typedef {'STUDIO' | 'VIEWER_TELEMETRY' | 'MOCK' | 'FALLBACK'} IntelligenceSourceCategory */

/**
 * @param {string} field
 * @param {IntelligenceSourceCategory} source
 * @param {unknown} value
 */
export function logIntelligenceSource(field, source, value) {
    console.log(`[INTELLIGENCE_SOURCE] ${JSON.stringify({ field, source, value })}`);
}

/**
 * @param {string} reelId
 * @returns {boolean}
 */
function hasStudioRecord(reelId) {
    return Boolean(reelId && getReelSeriesMetadata(reelId));
}

/**
 * @param {string} reelId
 * @param {keyof import('./seriesMetadataStorage.js').ReelSeriesMetadata} key
 * @returns {boolean}
 */
function studioHasField(reelId, key) {
    const stored = reelId ? getReelSeriesMetadata(reelId) : null;
    if (!stored) return false;
    const value = stored[key];
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
}

/**
 * @param {string} field
 * @param {IntelligenceSourceCategory} source
 * @param {string} reelId
 * @param {boolean} studioFieldPresent
 */
function assertNoMockWhenStudio(field, source, reelId, studioFieldPresent) {
    if (studioFieldPresent && (source === 'MOCK' || source === 'FALLBACK')) {
        console.warn(
            `[INTELLIGENCE_SOURCE_VIOLATION] ${JSON.stringify({ field, source, reelId, reason: 'studio-data-exists' })}`
        );
    }
}

/**
 * @param {{
 *   series: { id?: string; title?: string; genre?: string; description?: string; releaseYear?: number };
 *   season: { seasonNumber: number };
 *   episode: {
 *     episodeId: string;
 *     episodeNumber: number;
 *     title: string;
 *     runtime?: number;
 *     genre?: string;
 *     description?: string;
 *     status?: string;
 *     reelId?: string | null;
 *   };
 * } | null | undefined} ctx
 * @returns {{
 *   entries: { field: string; source: IntelligenceSourceCategory; value: unknown }[];
 *   report: {
 *     total: number;
 *     studio: number;
 *     telemetry: number;
 *     mock: number;
 *     fallback: number;
 *     violations: number;
 *   };
 * }}
 */
export function auditIntelligenceSources(ctx) {
    if (!ctx) {
        logIntelligenceSource('context', 'FALLBACK', null);
        return {
            entries: [{ field: 'context', source: 'FALLBACK', value: null }],
            report: { total: 1, studio: 0, telemetry: 0, mock: 0, fallback: 1, violations: 0 }
        };
    }

    const reelId = ctx.episode.reelId || '';
    const feedReelId = /** @type {string} */ (ctx.episode.reelId || '');
    const studio = feedReelId ? getReelSeriesMetadata(feedReelId) : null;
    const studioPresent = hasStudioRecord(feedReelId);

    const intelligence = buildSeriesIntelligence(ctx);
    const counts = getSeriesEpisodeCounts(ctx.series?.id);
    const nextEpisode = getNextEpisodePreview(ctx.episode.episodeId);
    const description =
        (studio?.description || ctx.episode.description || ctx.series.description || '').trim() || null;

    const entries = [
        {
            field: 'Genre',
            source: /** @type {IntelligenceSourceCategory} */ (
                studioHasField(feedReelId, 'genre') ? 'STUDIO' : studioPresent ? 'STUDIO' : 'FALLBACK'
            ),
            value: resolveGenreLabel(ctx) || null
        },
        {
            field: 'Release Year',
            source: /** @type {IntelligenceSourceCategory} */ (
                studioHasField(feedReelId, 'releaseYear') ? 'STUDIO' : 'FALLBACK'
            ),
            value: getReleaseYear(ctx)
        },
        {
            field: 'Status',
            source: /** @type {IntelligenceSourceCategory} */ (
                studioHasField(feedReelId, 'episodeStatus') ? 'STUDIO' : studioPresent ? 'STUDIO' : 'FALLBACK'
            ),
            value: resolveDisplayEpisodeStatus(ctx.episode, feedReelId || undefined)
        },
        {
            field: 'Season',
            source: /** @type {IntelligenceSourceCategory} */ (
                studioHasField(feedReelId, 'seasonNumber') ? 'STUDIO' : studioPresent ? 'STUDIO' : 'FALLBACK'
            ),
            value: ctx.season.seasonNumber
        },
        {
            field: 'Episode',
            source: /** @type {IntelligenceSourceCategory} */ (
                studioHasField(feedReelId, 'episodeNumber') ? 'STUDIO' : studioPresent ? 'STUDIO' : 'FALLBACK'
            ),
            value: ctx.episode.episodeNumber
        },
        {
            field: 'Runtime',
            source: /** @type {IntelligenceSourceCategory} */ (
                studioHasField(feedReelId, 'runtime') ? 'STUDIO' : studioPresent ? 'STUDIO' : 'FALLBACK'
            ),
            value: ctx.episode.runtime ?? null
        },
        {
            field: 'Description',
            source: /** @type {IntelligenceSourceCategory} */ (
                studioHasField(feedReelId, 'description') ? 'STUDIO' : studioPresent ? 'STUDIO' : 'FALLBACK'
            ),
            value: description
        },
        {
            field: 'Continue Watching',
            source: /** @type {IntelligenceSourceCategory} */ ('VIEWER_TELEMETRY'),
            value: getContinueWatchingPercent(ctx.episode.episodeId, feedReelId || undefined)
        },
        {
            field: 'Series Completion',
            source: /** @type {IntelligenceSourceCategory} */ ('VIEWER_TELEMETRY'),
            value: intelligence.completionPercent
        },
        {
            field: 'Next Episode',
            source: /** @type {IntelligenceSourceCategory} */ (studioPresent ? 'STUDIO' : 'FALLBACK'),
            value: nextEpisode?.episode?.episodeId ?? null
        },
        {
            field: 'Total Episodes',
            source: /** @type {IntelligenceSourceCategory} */ (studioPresent ? 'STUDIO' : 'FALLBACK'),
            value: counts.totalEpisodes || null
        }
    ];

    let violations = 0;
    const report = { total: entries.length, studio: 0, telemetry: 0, mock: 0, fallback: 0, violations: 0 };

    for (const entry of entries) {
        logIntelligenceSource(entry.field, entry.source, entry.value);
        if (entry.source === 'STUDIO') report.studio += 1;
        else if (entry.source === 'VIEWER_TELEMETRY') report.telemetry += 1;
        else if (entry.source === 'MOCK') report.mock += 1;
        else if (entry.source === 'FALLBACK') report.fallback += 1;

        const studioFieldMap = {
            Genre: 'genre',
            'Release Year': 'releaseYear',
            Status: 'episodeStatus',
            Season: 'seasonNumber',
            Episode: 'episodeNumber',
            Runtime: 'runtime',
            Description: 'description'
        };
        const studioKey = /** @type {keyof import('./seriesMetadataStorage.js').ReelSeriesMetadata | undefined} */ (
            studioFieldMap[/** @type {keyof typeof studioFieldMap} */ (entry.field)]
        );
        if (studioKey && (entry.source === 'MOCK' || entry.source === 'FALLBACK')) {
            if (studioHasField(feedReelId, studioKey)) {
                violations += 1;
                assertNoMockWhenStudio(entry.field, entry.source, feedReelId, true);
            }
        }
    }

    report.violations = violations;
    console.log(`[INTELLIGENCE_SOURCE_REPORT] ${JSON.stringify(report)}`);
    return { entries, report };
}
