/**
 * Contextual production warnings for Smart Production Studio.
 */

import { get } from 'svelte/store';
import { seriesCatalog } from '../series/seriesStore.js';

/**
 * @typedef {Object} ContextualWarning
 * @property {string} id
 * @property {string} problem
 * @property {string} whyItMatters
 * @property {string} howToFix
 */

/** Must match productionHealth.js weights — read-only reference for messaging only. */
const READINESS_LOW_THRESHOLD = 50;
const COVERAGE_FULL_THRESHOLD = 100;

/**
 * @param {import('../series/productionHealth.js').SeriesHealthSnapshot} health
 * @param {import('../series/productionHealth.js').ProductionReadinessSnapshot} readiness
 * @param {import('../series/productionHealth.js').EpisodeOperationRow[]} operationRows
 * @param {string} [seriesId]
 * @returns {ContextualWarning[]}
 */
export function generateContextualWarnings(health, readiness, operationRows = [], seriesId) {
    /** @type {ContextualWarning[]} */
    const warnings = [];

    if (readiness.weightedPercent < READINESS_LOW_THRESHOLD) {
        warnings.push({
            id: 'readiness-low',
            problem: 'Your series is missing important production assets.',
            whyItMatters: 'Viewers may see gaps, broken episode order, or empty slots.',
            howToFix: 'Attach videos to missing episodes and fill in episode details.'
        });
    }

    if (health.assetCoverage < COVERAGE_FULL_THRESHOLD) {
        warnings.push({
            id: 'coverage-incomplete',
            problem: 'Some episodes do not have videos attached.',
            whyItMatters: 'Those episodes cannot play in the theater until a video is linked.',
            howToFix: 'Use the Missing Asset Queue to attach a reel to each episode.'
        });
    }

    const catalog = get(seriesCatalog);
    const series = seriesId ? catalog.find((s) => s.id === seriesId) : null;
    if (series) {
        const hasUnpublished = series.seasons.some((season) =>
            season.episodes.some((ep) => ep.status !== 'published')
        );
        if (hasUnpublished) {
            warnings.push({
                id: 'unpublished-season',
                problem: 'This season has episodes that are not published yet.',
                whyItMatters: 'Viewers may not be able to continue watching the full season.',
                howToFix: 'Publish finished episodes or mark them as ready when videos are attached.'
            });
        }
    }

    const sorted = [...operationRows].sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        return a.episodeNumber - b.episodeNumber;
    });

    for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];
        if (current.seasonNumber !== next.seasonNumber) continue;
        if (current.status === 'Published' && current.reelInFeed && next.status === 'Missing Asset') {
            warnings.push({
                id: `next-episode-missing-${current.episodeId}`,
                problem: 'Auto-play may stop after this episode.',
                whyItMatters: `Episode S${current.seasonNumber}:E${current.episodeNumber} is live but the next episode has no video.`,
                howToFix: `Attach a reel to S${next.seasonNumber}:E${next.episodeNumber} in the Missing Asset Queue.`
            });
            break;
        }
    }

    return warnings;
}
