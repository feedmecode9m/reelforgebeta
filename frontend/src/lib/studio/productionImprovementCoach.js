/**
 * Production improvement coach — uses existing productionHealth outputs only.
 * Estimates readiness gains with the same pillar weights as productionHealth.js.
 */

import {
    computeProductionReadiness,
    buildEpisodeOperationRows,
    getMissingAssetQueue
} from '../series/productionHealth.js';

/** Mirrors productionHealth.js READINESS_WEIGHTS — do not change independently. */
const COACH_WEIGHTS = {
    metadata: 25,
    assets: 35,
    publishing: 25,
    releaseSchedule: 15
};

/**
 * @typedef {Object} ImprovementAction
 * @property {string} id
 * @property {string} label
 * @property {number} estimatedGain
 * @property {string} category
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
 * @param {Record<string, unknown>[]} feedReels
 * @param {string} seriesId
 * @returns {ImprovementAction[]}
 */
export function generateImprovementActions(feedReels = [], seriesId) {
    const readiness = computeProductionReadiness(feedReels, seriesId);
    const rows = buildEpisodeOperationRows(feedReels, seriesId);
    const missingQueue = getMissingAssetQueue(feedReels, seriesId);
    const total = rows.length || 1;

    const withAssets = rows.filter((r) => r.status !== 'Missing Asset' && r.reelInFeed).length;
    const metadataComplete = rows.filter((r) => r.metadataComplete).length;
    const published = rows.filter((r) => r.status === 'Published').length;
    const draftWithAssets = rows.filter(
        (r) => r.reelInFeed && r.publishingStatus === 'Draft'
    );
    const scheduledRecords = rows.filter(
        (r) => r.status === 'Scheduled' || r.publishingStatus === 'Draft'
    );
    const scheduledWithAssets = scheduledRecords.filter((r) => r.reelInFeed && r.reelId).length;

    /** @type {ImprovementAction[]} */
    const candidates = [];

    if (missingQueue.length > 0) {
        const attachCount = Math.min(missingQueue.length, 2);
        const labels = missingQueue
            .slice(0, attachCount)
            .map((r) => `E${String(r.episodeNumber).padStart(2, '0')}`);
        const newAssetsPct = Math.round(((withAssets + attachCount) / total) * 100);
        const gain = pillarGain(readiness.assets, newAssetsPct, COACH_WEIGHTS.assets);
        candidates.push({
            id: 'attach-missing',
            label: `Attach reels to ${labels.join(' and ')}`,
            estimatedGain: Math.max(gain, 1),
            category: 'assets'
        });
    }

    const unpublishedWithAsset = rows.find(
        (r) => r.reelInFeed && r.publishingStatus !== 'Published'
    );
    if (unpublishedWithAsset) {
        const newPublishingPct = Math.round(((published + 1) / total) * 100);
        const gain = pillarGain(readiness.publishing, newPublishingPct, COACH_WEIGHTS.publishing);
        candidates.push({
            id: 'publish-episode',
            label: `Publish S${unpublishedWithAsset.seasonNumber}E${String(unpublishedWithAsset.episodeNumber).padStart(2, '0')}`,
            estimatedGain: Math.max(gain, 1),
            category: 'publishing'
        });
    }

    const incompleteMeta = rows.filter((r) => !r.metadataComplete);
    if (incompleteMeta.length > 0) {
        const first = incompleteMeta[0];
        const newMetaPct = Math.round(((metadataComplete + 1) / total) * 100);
        const gain = pillarGain(readiness.metadata, newMetaPct, COACH_WEIGHTS.metadata);
        candidates.push({
            id: 'complete-metadata',
            label: `Complete metadata for S${first.seasonNumber}E${String(first.episodeNumber).padStart(2, '0')}`,
            estimatedGain: Math.max(gain, 1),
            category: 'metadata'
        });
    }

    if (draftWithAssets.length > 0 && scheduledRecords.length > 0) {
        const newSchedulePct = Math.round(
            ((scheduledWithAssets + 1) / scheduledRecords.length) * 100
        );
        const gain = pillarGain(readiness.releaseSchedule, newSchedulePct, COACH_WEIGHTS.releaseSchedule);
        candidates.push({
            id: 'schedule-releases',
            label: 'Schedule release dates',
            estimatedGain: Math.max(gain, 1),
            category: 'releaseSchedule'
        });
    }

    if (missingQueue.length > 2) {
        const allMissing = missingQueue.length;
        const newAssetsPct = Math.round(((withAssets + allMissing) / total) * 100);
        const gain = pillarGain(readiness.assets, newAssetsPct, COACH_WEIGHTS.assets);
        candidates.push({
            id: 'attach-all-missing',
            label: `Attach reels to all ${allMissing} missing episodes`,
            estimatedGain: Math.max(gain, 1),
            category: 'assets'
        });
    }

    return candidates
        .sort((a, b) => b.estimatedGain - a.estimatedGain)
        .slice(0, 3);
}
