/**
 * Production health and readiness calculations (Phase 7B).
 */

import { get } from 'svelte/store';
import { seriesCatalog, getReelSeriesMetadata, getEpisodeById } from './seriesStore.js';
import {
    buildEpisodeAssetRecords,
    computeEpisodeAssetCoverage
} from './episodeAssetStatus.js';
import { logProductionDiag } from './productionHealthDiagnostics.js';

/** Readiness pillar weights (sum = 100). */
const READINESS_WEIGHTS = {
    metadata: 25,
    assets: 35,
    publishing: 25,
    releaseSchedule: 15
};

/**
 * @typedef {Object} SeriesHealthSnapshot
 * @property {string} [seriesId]
 * @property {number} totalEpisodes
 * @property {number} assetCoverage
 * @property {number} missingAssets
 * @property {number} publishedEpisodes
 * @property {number} scheduledEpisodes
 * @property {number} draftEpisodes
 * @property {number} readyEpisodes
 * @property {number} overallReadinessScore
 */

/**
 * @typedef {Object} ProductionReadinessSnapshot
 * @property {number} metadata
 * @property {number} assets
 * @property {number} publishing
 * @property {number} releaseSchedule
 * @property {number} weightedPercent
 */

/**
 * @typedef {import('./episodeAssetStatus.js').EpisodeAssetRecord & {
 *   publishingStatus: string;
 *   releaseStatus: string;
 *   metadataComplete: boolean;
 * }} EpisodeOperationRow
 */

/**
 * @param {import('./episodeAssetStatus.js').EpisodeAssetRecord} record
 */
function metadataCompleteForRecord(record) {
    const ctx = getEpisodeById(record.episodeId);
    const studio = record.reelId ? getReelSeriesMetadata(record.reelId) : null;
    const episode = ctx?.episode;
    const series = ctx?.series;
    const hasTitle = Boolean(record.episodeTitle?.trim());
    const hasDescription = Boolean(
        studio?.description?.trim() || episode?.description?.trim() || series?.description?.trim()
    );
    const hasGenre = Boolean(studio?.genre?.trim() || episode?.genre?.trim() || series?.genre?.trim());
    const hasRuntime = record.runtime != null && record.runtime > 0;
    return hasTitle && hasDescription && hasGenre && hasRuntime;
}

/**
 * @param {import('./episodeAssetStatus.js').EpisodeAssetRecord} record
 * @returns {string}
 */
function resolvePublishingStatus(record) {
    const ctx = getEpisodeById(record.episodeId);
    const status = ctx?.episode?.status || 'draft';
    if (status === 'published') return 'Published';
    if (status === 'ready') return 'Ready';
    if (status === 'archived') return 'Archived';
    return 'Draft';
}

/**
 * @param {string | undefined} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
function filterBySeries(records, seriesId) {
    if (!seriesId) return records;
    return records.filter((r) => r.seriesId === seriesId);
}

/**
 * @param {string | undefined} seriesId
 * @param {Record<string, unknown>[]} feedReels
 * @returns {SeriesHealthSnapshot}
 */
export function computeSeriesHealth(feedReels = [], seriesId) {
    const allRecords = buildEpisodeAssetRecords(feedReels);
    const records = filterBySeries(allRecords, seriesId);
    const total = records.length;
    const withAssets = records.filter((r) => r.status !== 'Missing Asset' && r.reelInFeed).length;
    const missing = records.filter((r) => r.status === 'Missing Asset').length;
    const published = records.filter((r) => r.status === 'Published').length;
    const scheduled = records.filter((r) => r.status === 'Scheduled').length;
    const draft = records.filter((r) => r.status === 'Draft').length;
    const ready = records.filter((r) => r.status === 'Ready').length;
    const assetCoverage = total ? Math.round((withAssets / total) * 100) : 0;
    const readiness = computeProductionReadiness(feedReels, seriesId);

    return {
        seriesId,
        totalEpisodes: total,
        assetCoverage,
        missingAssets: missing,
        publishedEpisodes: published,
        scheduledEpisodes: scheduled,
        draftEpisodes: draft,
        readyEpisodes: ready,
        overallReadinessScore: readiness.weightedPercent
    };
}

/**
 * @param {string | undefined} seriesId
 * @param {Record<string, unknown>[]} feedReels
 * @returns {ProductionReadinessSnapshot}
 */
export function computeProductionReadiness(feedReels = [], seriesId) {
    const records = filterBySeries(buildEpisodeAssetRecords(feedReels), seriesId);
    const total = records.length || 1;

    const metadataComplete = records.filter((r) => metadataCompleteForRecord(r)).length;
    const metadata = Math.round((metadataComplete / total) * 100);

    const withAssets = records.filter((r) => r.status !== 'Missing Asset' && r.reelInFeed).length;
    const assets = Math.round((withAssets / total) * 100);

    const published = records.filter((r) => r.status === 'Published').length;
    const publishing = Math.round((published / total) * 100);

    const scheduledRecords = records.filter((r) => r.status === 'Scheduled' || resolvePublishingStatus(r) === 'Draft');
    const scheduledWithAssets = scheduledRecords.filter((r) => r.reelInFeed && r.reelId).length;
    const releaseSchedule = scheduledRecords.length
        ? Math.round((scheduledWithAssets / scheduledRecords.length) * 100)
        : published > 0
          ? 100
          : 0;

    const weightedPercent = Math.round(
        (metadata * READINESS_WEIGHTS.metadata +
            assets * READINESS_WEIGHTS.assets +
            publishing * READINESS_WEIGHTS.publishing +
            releaseSchedule * READINESS_WEIGHTS.releaseSchedule) /
            100
    );

    return { metadata, assets, publishing, releaseSchedule, weightedPercent };
}

/**
 * @param {string | undefined} seriesId
 * @param {Record<string, unknown>[]} feedReels
 * @returns {EpisodeOperationRow[]}
 */
export function buildEpisodeOperationRows(feedReels = [], seriesId) {
    const records = filterBySeries(buildEpisodeAssetRecords(feedReels), seriesId);
    return records.map((record) => ({
        ...record,
        publishingStatus: resolvePublishingStatus(record),
        releaseStatus: record.status,
        metadataComplete: metadataCompleteForRecord(record)
    }));
}

/**
 * @param {string | undefined} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
export function getMissingAssetQueue(feedReels = [], seriesId) {
    return buildEpisodeOperationRows(feedReels, seriesId).filter((r) => r.status === 'Missing Asset');
}

/**
 * @param {Record<string, unknown>[]} feedReels
 * @param {string} [seriesId]
 * @param {boolean} [emitLogs]
 */
export function auditProductionOperations(feedReels = [], seriesId = 'series-neon-vengeance', emitLogs = true) {
    const health = computeSeriesHealth(feedReels, seriesId);
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const queue = getMissingAssetQueue(feedReels, seriesId);
    const assetAudit = computeEpisodeAssetCoverage(feedReels);
    const seriesAssetAudit = computeEpisodeAssetCoverage(feedReels, seriesId);

    if (emitLogs) {
        logProductionDiag('PRODUCTION_HEALTH', {
            seriesId: health.seriesId,
            totalEpisodes: health.totalEpisodes,
            assetCoverage: health.assetCoverage,
            seriesAssetCoverage: seriesAssetAudit.coveragePercent,
            globalAssetCoverage: assetAudit.coveragePercent,
            coverageMatchesAudit: health.assetCoverage === seriesAssetAudit.coveragePercent,
            missingAssets: health.missingAssets,
            publishedEpisodes: health.publishedEpisodes,
            scheduledEpisodes: health.scheduledEpisodes,
            draftEpisodes: health.draftEpisodes,
            overallReadinessScore: health.overallReadinessScore
        });

        logProductionDiag('SERIES_READINESS', {
            seriesId,
            metadata: readiness.metadata,
            assets: readiness.assets,
            publishing: readiness.publishing,
            releaseSchedule: readiness.releaseSchedule,
            weightedPercent: readiness.weightedPercent,
            weights: READINESS_WEIGHTS
        });

        logProductionDiag('MISSING_ASSET_QUEUE', {
            seriesId,
            queueSize: queue.length,
            episodeIds: queue.map((r) => r.episodeId)
        });
    }

    return {
        health,
        readiness,
        queue,
        assetAudit,
        seriesList: get(seriesCatalog).map((s) => ({ id: s.id, title: s.title }))
    };
}
