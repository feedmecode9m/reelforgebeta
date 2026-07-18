/** BG-7L — Canonical Feed Contract diagnostics (delegates eligibility to buildHomeFeed). */

import {
    buildHomeFeed,
    evaluateFeedEligibility,
    countRealFeedCards
} from '../feed/buildHomeFeed.js';
import { isVideoReel, isImageReel } from '../api/reelContract.js';

/** @type {Array<Record<string, unknown>>} */
let decisions = [];
let summaryEmitted = false;

export function resetBg7lFeedContract() {
    decisions = [];
    summaryEmitted = false;
}

/**
 * Evaluate and log every catalog reel through buildHomeFeed eligibility.
 * @param {Record<string, unknown>[]} catalog
 * @param {string} [source]
 */
export function traceCatalogFeedDecisions(catalog, source = 'syncFromVault') {
    resetBg7lFeedContract();
    const { decisions: built } = buildHomeFeed(catalog || [], { dedupeVideos: true });
    for (const decision of built) {
        logBg7lFeedDecision({ ...decision, gate: `${decision.gate} (${source})` });
    }
}

/** @param {Record<string, unknown>} decision */
export function logBg7lFeedDecision(decision) {
    decisions.push(decision);
    console.info('[BG7L_FEED_DECISION]', {
        reelId: decision.reelId,
        category: decision.category,
        mediaType: decision.mediaType,
        eligible: decision.eligible,
        rejectionReason: decision.rejectionReason,
        gate: decision.gate,
        timestamp: new Date().toISOString()
    });
}

/**
 * @param {{
 *   backendCatalogCount: number,
 *   finalFeed: Record<string, unknown[]>,
 *   pruneRemoved?: number,
 *   demoInjected?: boolean,
 *   source?: string,
 * }} ctx
 */
export function emitBg7lFeedSummary(ctx) {
    if (summaryEmitted) return;
    summaryEmitted = true;

    const heroVideoCount = decisions.filter(
        (d) => d.mediaType === 'video' && d.rejectionReason === 'hero_video_card' && d.eligible
    ).length;
    const imageCount = decisions.filter((d) => d.mediaType === 'image').length;
    const eligibleVideoCount = decisions.filter(
        (d) => d.mediaType === 'video' && d.eligible && d.rejectionReason !== 'hero_video_card'
    ).length;
    const eligibleHeroVideoCount = decisions.filter(
        (d) => d.mediaType === 'video' && d.eligible && d.rejectionReason === 'hero_video_card'
    ).length;
    const eligibleImageCount = decisions.filter((d) => d.mediaType === 'image' && d.eligible).length;
    const finalFeedCardCount = countRealFeedCards(ctx.finalFeed);
    const placeholderCount = Object.values(ctx.finalFeed || {})
        .flat()
        .filter((r) => r?.isPlaceholder).length;

    const firstRejected = decisions.find((d) => !d.eligible);

    console.info('[BG7L_FEED_SUMMARY]', {
        backendCatalogCount: ctx.backendCatalogCount,
        heroVideoCount: heroVideoCount + eligibleHeroVideoCount,
        imageCount,
        eligibleVideoCount: eligibleVideoCount + eligibleHeroVideoCount,
        eligibleImageCount,
        finalFeedCardCount,
        placeholderCount,
        pruneRemoved: ctx.pruneRemoved ?? 0,
        demoInjected: Boolean(ctx.demoInjected),
        firstExclusionGate: firstRejected?.gate ?? null,
        source: ctx.source ?? 'buildHomeFeed',
        timestamp: new Date().toISOString()
    });

    if (finalFeedCardCount === 0 && !ctx.demoInjected) {
        console.info('[BG7L_ROOT_CAUSE]', {
            rootCause: 'buildHomeFeed returned zero cards and placeholder fallback was disabled or skipped.',
            firstFunctionRemovingLastEligibleCard: firstRejected?.gate ?? 'buildHomeFeed',
            recommendedFix: 'Ensure catalog contains eligible reels or enable ALLOW_UI_PLACEHOLDERS.',
            timestamp: new Date().toISOString()
        });
    }
}

/** @returns {Array<Record<string, unknown>>} */
export function getBg7lFeedDecisions() {
    return [...decisions];
}

export { evaluateFeedEligibility };
