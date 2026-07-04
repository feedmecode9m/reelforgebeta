/**
 * Studio action engine — orchestrates readiness recommendations (Phase 9).
 * Uses productionHealth outputs only; does not alter readiness calculations.
 */

import { get } from 'svelte/store';
import {
    computeProductionReadiness,
    buildEpisodeOperationRows
} from './productionHealth.js';
import { seriesCatalog, getEpisodeById, getReelSeriesMetadata } from './seriesStore.js';

/** Mirrors productionHealth.js READINESS_WEIGHTS — do not change independently. */
const ACTION_WEIGHTS = {
    metadata: 25,
    assets: 35,
    publishing: 25,
    releaseSchedule: 15
};

/** @typedef {'missing-asset' | 'missing-metadata' | 'unpublished-episode' | 'unscheduled-episode' | 'missing-runtime' | 'missing-description' | 'missing-thumbnail' | 'missing-season-structure'} ActionType */

/**
 * @typedef {Object} StudioRecommendation
 * @property {string} id
 * @property {number} priority
 * @property {string} title
 * @property {string} description
 * @property {number} impact
 * @property {ActionType} actionType
 * @property {string | null} [episodeId]
 */

/**
 * @typedef {Object} StudioActionPlan
 * @property {number} readinessScore
 * @property {StudioRecommendation[]} blockers
 * @property {StudioRecommendation[]} recommendations
 * @property {StudioRecommendation[]} quickWins
 * @property {number} estimatedImpact
 */

/**
 * @param {number} currentPct
 * @param {number} newPct
 * @param {number} weight
 */
function pillarGain(currentPct, newPct, weight) {
    return Math.round(((newPct - currentPct) * weight) / 100);
}

/**
 * @param {import('./productionHealth.js').EpisodeOperationRow} row
 */
function episodeLabel(row) {
    return `E${String(row.episodeNumber).padStart(2, '0')}`;
}

/**
 * @param {import('./productionHealth.js').EpisodeOperationRow} row
 */
function metadataGaps(row) {
    const ctx = getEpisodeById(row.episodeId);
    const studio = row.reelId ? getReelSeriesMetadata(row.reelId) : null;
    const episode = ctx?.episode;
    const series = ctx?.series;

    return {
        missingRuntime: !(row.runtime != null && row.runtime > 0),
        missingDescription: !Boolean(
            studio?.description?.trim() || episode?.description?.trim() || series?.description?.trim()
        ),
        missingGenre: !Boolean(studio?.genre?.trim() || episode?.genre?.trim() || series?.genre?.trim()),
        missingTitle: !Boolean(row.episodeTitle?.trim())
    };
}

/**
 * @param {import('./seriesTypes.js').Series} series
 * @returns {{ seasonNumber: number, issue: string }[]}
 */
function detectSeasonStructureIssues(series) {
    /** @type {{ seasonNumber: number, issue: string }[]} */
    const issues = [];

    for (const season of series.seasons) {
        if (season.episodes.length === 0) {
            issues.push({
                seasonNumber: season.seasonNumber,
                issue: `Season ${season.seasonNumber} has no episodes`
            });
            continue;
        }

        const numbers = season.episodes.map((ep) => ep.episodeNumber).sort((a, b) => a - b);
        for (let i = 1; i < numbers.length; i++) {
            if (numbers[i] !== numbers[i - 1] + 1) {
                issues.push({
                    seasonNumber: season.seasonNumber,
                    issue: `Season ${season.seasonNumber} has a gap after episode ${numbers[i - 1]}`
                });
                break;
            }
        }
    }

    return issues;
}

/**
 * @param {Record<string, unknown>[]} feedReels
 * @param {string} seriesId
 * @param {import('./productionHealth.js').ProductionReadinessSnapshot} readiness
 * @param {import('./productionHealth.js').EpisodeOperationRow[]} rows
 * @returns {Omit<StudioRecommendation, 'priority'>[]}
 */
function buildRecommendationCandidates(feedReels, seriesId, readiness, rows) {
    const total = rows.length || 1;
    const withAssets = rows.filter((r) => r.status !== 'Missing Asset' && r.reelInFeed).length;
    const metadataComplete = rows.filter((r) => r.metadataComplete).length;
    const published = rows.filter((r) => r.status === 'Published').length;
    const scheduledRecords = rows.filter(
        (r) => r.status === 'Scheduled' || r.publishingStatus === 'Draft'
    );
    const scheduledWithAssets = scheduledRecords.filter((r) => r.reelInFeed && r.reelId).length;

    /** @type {Omit<StudioRecommendation, 'priority'>[]} */
    const candidates = [];
    const seenEpisodes = new Set();

    for (const row of rows) {
        if (row.status === 'Missing Asset') {
            const newAssetsPct = Math.round(((withAssets + 1) / total) * 100);
            const impact = Math.max(pillarGain(readiness.assets, newAssetsPct, ACTION_WEIGHTS.assets), 1);
            candidates.push({
                id: `missing-asset-${row.episodeId}`,
                title: `Attach reel to ${episodeLabel(row)}`,
                description: `${row.episodeTitle || 'Episode'} cannot play until a video is linked.`,
                impact,
                actionType: 'missing-asset',
                episodeId: row.episodeId
            });
            seenEpisodes.add(row.episodeId);
        }
    }

    const series = get(seriesCatalog).find((s) => s.id === seriesId);
    if (series) {
        for (const issue of detectSeasonStructureIssues(series)) {
            candidates.push({
                id: `missing-season-structure-s${issue.seasonNumber}`,
                title: `Fix season ${issue.seasonNumber} structure`,
                description: issue.issue,
                impact: 1,
                actionType: 'missing-season-structure',
                episodeId: null
            });
        }
    }

    for (const row of rows) {
        if (seenEpisodes.has(row.episodeId)) continue;
        if (!row.reelInFeed || !row.reelId) continue;

        if (row.status === 'Ready' || (row.publishingStatus !== 'Published' && row.status !== 'Missing Asset')) {
            if (row.status === 'Ready' || row.publishingStatus === 'Ready') {
                const newPublishingPct = Math.round(((published + 1) / total) * 100);
                const impact = Math.max(
                    pillarGain(readiness.publishing, newPublishingPct, ACTION_WEIGHTS.publishing),
                    1
                );
                candidates.push({
                    id: `unpublished-${row.episodeId}`,
                    title: `Publish ${episodeLabel(row)}`,
                    description: `${row.episodeTitle || 'Episode'} is ready but not live for viewers.`,
                    impact,
                    actionType: 'unpublished-episode',
                    episodeId: row.episodeId
                });
                seenEpisodes.add(row.episodeId);
                continue;
            }
        }

        if (row.publishingStatus === 'Draft' && row.reelInFeed && scheduledRecords.length > 0) {
            const newSchedulePct = Math.round(((scheduledWithAssets + 1) / scheduledRecords.length) * 100);
            const impact = Math.max(
                pillarGain(readiness.releaseSchedule, newSchedulePct, ACTION_WEIGHTS.releaseSchedule),
                1
            );
            candidates.push({
                id: `unscheduled-${row.episodeId}`,
                title: `Schedule ${episodeLabel(row)}`,
                description: `${row.episodeTitle || 'Episode'} has a video but no release plan.`,
                impact,
                actionType: 'unscheduled-episode',
                episodeId: row.episodeId
            });
            seenEpisodes.add(row.episodeId);
            continue;
        }

        const gaps = metadataGaps(row);

        if (gaps.missingRuntime) {
            const newMetaPct = Math.round(((metadataComplete + 1) / total) * 100);
            const impact = Math.max(
                pillarGain(readiness.metadata, newMetaPct, ACTION_WEIGHTS.metadata),
                1
            );
            candidates.push({
                id: `missing-runtime-${row.episodeId}`,
                title: `Add runtime to ${episodeLabel(row)}`,
                description: 'Runtime helps viewers know length and improves catalog completeness.',
                impact,
                actionType: 'missing-runtime',
                episodeId: row.episodeId
            });
            seenEpisodes.add(row.episodeId);
            continue;
        }

        if (gaps.missingDescription) {
            const newMetaPct = Math.round(((metadataComplete + 1) / total) * 100);
            const impact = Math.max(
                pillarGain(readiness.metadata, newMetaPct, ACTION_WEIGHTS.metadata),
                1
            );
            candidates.push({
                id: `missing-description-${row.episodeId}`,
                title: `Add description to ${episodeLabel(row)}`,
                description: 'Descriptions improve discoverability and viewer context.',
                impact,
                actionType: 'missing-description',
                episodeId: row.episodeId
            });
            seenEpisodes.add(row.episodeId);
            continue;
        }

        if (!row.metadataComplete && (gaps.missingGenre || gaps.missingTitle)) {
            const newMetaPct = Math.round(((metadataComplete + 1) / total) * 100);
            const impact = Math.max(
                pillarGain(readiness.metadata, newMetaPct, ACTION_WEIGHTS.metadata),
                1
            );
            candidates.push({
                id: `missing-metadata-${row.episodeId}`,
                title: `Complete metadata for ${episodeLabel(row)}`,
                description: 'Fill in title, genre, and other episode details.',
                impact,
                actionType: 'missing-metadata',
                episodeId: row.episodeId
            });
            seenEpisodes.add(row.episodeId);
            continue;
        }

        if (!row.thumbnailUrl && row.reelInFeed) {
            candidates.push({
                id: `missing-thumbnail-${row.episodeId}`,
                title: `Add thumbnail to ${episodeLabel(row)}`,
                description: 'Thumbnails improve presentation in feeds and episode lists.',
                impact: 1,
                actionType: 'missing-thumbnail',
                episodeId: row.episodeId
            });
            seenEpisodes.add(row.episodeId);
        }
    }

    return candidates.sort((a, b) => b.impact - a.impact);
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>} [feedReels]
 * @returns {StudioActionPlan}
 */
export function buildStudioActionPlan(seriesId, feedReels = []) {
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const rows = buildEpisodeOperationRows(feedReels, seriesId);
    const candidates = buildRecommendationCandidates(feedReels, seriesId, readiness, rows);

    /** @type {StudioRecommendation[]} */
    const recommendations = candidates.map((candidate, index) => ({
        ...candidate,
        priority: index + 1
    }));

    const blockerTypes = new Set(['missing-asset', 'missing-season-structure']);
    const blockers = recommendations.filter((r) => blockerTypes.has(r.actionType));

    const topPriority = recommendations[0] || null;
    const nextBest = recommendations[1] || null;
    const quickWins = recommendations.slice(2, 4).filter((r) => r.impact >= 1);

    const estimatedImpact =
        (topPriority?.impact || 0) +
        (nextBest?.impact || 0) +
        quickWins.reduce((sum, r) => sum + r.impact, 0);

    return {
        readinessScore: readiness.weightedPercent,
        blockers,
        recommendations,
        quickWins,
        estimatedImpact
    };
}

/**
 * @param {StudioActionPlan} plan
 * @returns {{ readinessBefore: number, readinessAfter: number, recommendations: StudioRecommendation[] }}
 */
export function projectReadinessFromPlan(plan) {
    const readinessBefore = plan.readinessScore;
    const readinessAfter = Math.min(100, readinessBefore + plan.estimatedImpact);
    return {
        readinessBefore,
        readinessAfter,
        recommendations: plan.recommendations
    };
}
