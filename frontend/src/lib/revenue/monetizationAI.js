/**
 * Phase 42 — Monetization Intelligence Engine.
 * Analyzes content, teams, publishing, engagement, marketplace, and revenue profiles.
 * Intelligence only — no payment processors or external ad networks.
 */

import { buildEpisodeAssetRecords } from '../series/episodeAssetStatus.js';
import { computeSeriesHealth } from '../series/productionHealth.js';
import { seriesCatalog } from '../series/seriesStore.js';
import { get } from 'svelte/store';
import { getOperationsSnapshot } from '../observability/platformMetrics.js';
import {
    MARKETPLACE_CATEGORIES,
    MARKETPLACE_CATEGORY_LABELS,
    loadMarketplaceStore
} from '../marketplace/marketplaceEngine.js';
import { formatRevenueCurrency, buildSeriesRevenueSnapshot, getRevenueTeamCount } from './revenueCore.js';
import { normalizeRevenueStream } from './revenueEngine.js';
import { logMonetizationDiag } from './monetizationDiagnostics.js';

export const MONETIZATION_AI_VERSION = '1.0.0';

export const MONETIZATION_RECOMMENDATION_CATEGORIES = [
    'Revenue Growth',
    'Sponsorship Opportunities',
    'Subscription Opportunities',
    'Premium Episode Opportunities',
    'Marketplace Opportunities',
    'Cross Promotion',
    'Series Expansion',
    'Team Expansion'
];

/**
 * @typedef {Object} MonetizationRecommendation
 * @property {string} id
 * @property {string} category
 * @property {string} title
 * @property {string} detail
 * @property {number} [impactPercent]
 * @property {number} [projectedMonthlyCents]
 */

/**
 * @typedef {Object} MonetizationOpportunity
 * @property {string} id
 * @property {string} category
 * @property {string} title
 * @property {string} detail
 * @property {number} score
 * @property {number} [projectedMonthlyCents]
 */

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
function resolveSeriesContext(seriesId, feedReels) {
    const health = computeSeriesHealth(feedReels, seriesId);
    const records = buildEpisodeAssetRecords(feedReels).filter((record) => record.seriesId === seriesId);
    const unpublishedReady = records.filter(
        (record) => record.status === 'Ready' || record.status === 'Draft' || record.status === 'Scheduled'
    );
    const catalogSeries = get(seriesCatalog).find((series) => series.id === seriesId);
    const seriesTitle =
        catalogSeries?.title ||
        seriesId.replace(/^series-/, '').replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) ||
        'Neon Vengeance';

    return {
        health,
        records,
        unpublishedReady,
        seriesTitle,
        operations: getOperationsSnapshot(seriesId)
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
export function analyzeRevenue(seriesId, feedReels = []) {
    const snapshot = buildSeriesRevenueSnapshot(seriesId, feedReels);
    const context = resolveSeriesContext(seriesId, feedReels);
    const estimate = snapshot.estimate;
    const profile = snapshot.profile;

    const enabledStreams = (profile.streams || []).filter((stream) => stream.enabled).length;
    const monetizationReadiness = Math.min(
        100,
        Math.round(
            estimate.netCreatorCents / 500 +
                enabledStreams * 8 +
                context.health.overallReadinessScore * 0.35 +
                context.health.publishedEpisodes * 4
        )
    );

    return {
        summary: `Net monthly revenue ${formatRevenueCurrency(estimate.netCreatorCents)} across ${enabledStreams} active streams.`,
        netMonthlyCents: estimate.netCreatorCents,
        grossMonthlyCents: estimate.grossMonthlyCents,
        monetizationReadiness,
        enabledStreams,
        streamEstimates: estimate.streamEstimates
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
export function analyzeSubscriptions(seriesId, feedReels = []) {
    const snapshot = buildSeriesRevenueSnapshot(seriesId, feedReels);
    const context = resolveSeriesContext(seriesId, feedReels);
    const profile = snapshot.profile;
    const subscription = (profile.streams || []).map(normalizeRevenueStream).find((stream) => stream.type === 'subscriptions');
    const enabled = subscription?.enabled ?? false;
    const cadenceScore = Math.min(100, context.health.publishedEpisodes * 12 + context.health.readyEpisodes * 8);
    const audienceScore = Math.min(100, Math.round(context.operations.seriesCompletionRate * 0.8));
    const subscriptionReadiness = Math.round(
        (enabled ? 35 : 10) + cadenceScore * 0.35 + audienceScore * 0.3 + context.health.overallReadinessScore * 0.2
    );

    const projectedLiftCents = enabled
        ? Math.round((subscription?.unitPriceCents || 999) * 40 * 0.05)
        : Math.round((subscription?.unitPriceCents || 999) * 120 * 0.05);

    return {
        summary: enabled
            ? `Subscriptions active with ${subscriptionReadiness}% readiness.`
            : `Subscriptions disabled — ${subscriptionReadiness}% readiness once enabled.`,
        enabled,
        subscriptionReadiness,
        cadenceScore,
        audienceScore,
        projectedLiftCents
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
export function analyzeSponsors(seriesId, feedReels = []) {
    const snapshot = buildSeriesRevenueSnapshot(seriesId, feedReels);
    const context = resolveSeriesContext(seriesId, feedReels);
    const profile = snapshot.profile;
    const sponsorship = (profile.streams || []).map(normalizeRevenueStream).find((stream) => stream.type === 'sponsorships');
    const engagementScore = Math.min(
        100,
        Math.round(context.operations.dailyActiveViewers / 10 + context.health.publishedEpisodes * 10)
    );
    const brandScore = Math.min(100, context.health.overallReadinessScore + context.health.assetCoverage * 0.25);
    const sponsorReadiness = Math.round(engagementScore * 0.45 + brandScore * 0.35 + (sponsorship?.enabled ? 20 : 8));

    return {
        summary: `Series ${context.seriesTitle} sponsor readiness at ${sponsorReadiness}%.`,
        sponsorReadiness,
        engagementScore,
        brandScore,
        strongestSeries: context.seriesTitle,
        projectedSponsorCents: sponsorship?.enabled
            ? Math.round((sponsorship.unitPriceCents || 250000) * (sponsorship.conversionRate || 0.03))
            : Math.round(250000 * 0.02)
    };
}

/**
 * @param {string} seriesId
 */
export function analyzeMarketplace() {
    const store = loadMarketplaceStore();
    const services = Object.values(store.services || {});
    const categoryCounts = MARKETPLACE_CATEGORIES.reduce((acc, category) => {
        acc[category] = services.filter((service) => service.category === category && service.active).length;
        return acc;
    }, /** @type {Record<string, number>} */ ({}));

    const demandWeights = {
        vfx: 1.4,
        editing: 1.2,
        thumbnail_design: 1.15,
        voice_over: 1.1,
        marketing: 1.05,
        music: 1.0,
        script_writing: 0.95
    };

    const opportunities = MARKETPLACE_CATEGORIES.map((category) => {
        const supply = categoryCounts[category] || 0;
        const demand = demandWeights[category] || 1;
        const score = Math.round(Math.max(0, demand * 100 - supply * 18));
        return {
            category,
            label: MARKETPLACE_CATEGORY_LABELS[category],
            supply,
            score
        };
    }).sort((a, b) => b.score - a.score);

    const topGap = opportunities[0];
    const marketplacePotential = Math.min(100, Math.round(opportunities.reduce((sum, item) => sum + item.score, 0) / MARKETPLACE_CATEGORIES.length));

    return {
        summary: topGap
            ? `${topGap.label} services are ${topGap.supply <= 1 ? 'under-supplied' : 'available'} in the local marketplace.`
            : 'Marketplace demand signals are balanced.',
        marketplacePotential,
        topGap,
        opportunities
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} feedReels
 */
export function analyzeSeriesPerformance(seriesId, feedReels = []) {
    const context = resolveSeriesContext(seriesId, feedReels);
    const nextEpisodes = context.unpublishedReady
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
        .slice(0, 2)
        .map((record) => ({
            episodeNumber: record.episodeNumber,
            title: record.episodeTitle
        }));

    const performanceScore = Math.min(
        100,
        Math.round(
            context.health.overallReadinessScore * 0.35 +
                context.health.publishedEpisodes * 8 +
                context.operations.seriesCompletionRate * 0.35 +
                context.health.assetCoverage * 0.2
        )
    );

    const releaseReadinessDelta =
        nextEpisodes.length >= 2 ? 22 : nextEpisodes.length === 1 ? 12 : context.health.readyEpisodes > 0 ? 8 : 4;

    return {
        summary: `${context.seriesTitle} performance score ${performanceScore}% with ${context.health.publishedEpisodes} published episodes.`,
        performanceScore,
        seriesTitle: context.seriesTitle,
        nextEpisodes,
        releaseReadinessDelta,
        publishedEpisodes: context.health.publishedEpisodes,
        readyEpisodes: context.health.readyEpisodes
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {{ emitDiagnostics?: boolean }} [options]
 */
export function masterMonetizationAnalysis(seriesId = 'series-neon-vengeance', feedReels = [], options = {}) {
    const emitDiagnostics = options.emitDiagnostics !== false;
    const revenue = analyzeRevenue(seriesId, feedReels);
    const subscriptions = analyzeSubscriptions(seriesId, feedReels);
    const sponsors = analyzeSponsors(seriesId, feedReels);
    const marketplace = analyzeMarketplace();
    const performance = analyzeSeriesPerformance(seriesId, feedReels);
    const context = resolveSeriesContext(seriesId, feedReels);
    const profile = buildSeriesRevenueSnapshot(seriesId, feedReels).profile;
    const premium = (profile.streams || []).map(normalizeRevenueStream).find((stream) => stream.type === 'premium_episodes');
    const premiumLiftCents = Math.round((premium?.unitPriceCents || 299) * 25 * 0.06);

    const revenueScore = Math.round(
        revenue.monetizationReadiness * 0.35 +
            subscriptions.subscriptionReadiness * 0.2 +
            sponsors.sponsorReadiness * 0.2 +
            marketplace.marketplacePotential * 0.1 +
            performance.performanceScore * 0.15
    );

    /** @type {MonetizationOpportunity[]} */
    const topOpportunities = [
        {
            id: 'opp-release-cadence',
            category: 'Series Expansion',
            title: 'Accelerate episode releases',
            detail:
                performance.nextEpisodes.length >= 2
                    ? `Release Episode ${performance.nextEpisodes[0].episodeNumber} and Episode ${performance.nextEpisodes[1].episodeNumber} to unlock projected readiness increase of ${performance.releaseReadinessDelta}%.`
                    : `Publish ${performance.readyEpisodes} ready episodes to improve monetization readiness.`,
            score: performance.performanceScore,
            projectedMonthlyCents: Math.round(revenue.netMonthlyCents * 0.18)
        },
        {
            id: 'opp-premium-access',
            category: 'Premium Episode Opportunities',
            title: 'Enable premium episode access',
            detail: `Premium access could increase monthly revenue by ${formatRevenueCurrency(premiumLiftCents)}.`,
            score: premium?.enabled ? 68 : 84,
            projectedMonthlyCents: premiumLiftCents
        },
        {
            id: 'opp-sponsorship',
            category: 'Sponsorship Opportunities',
            title: `${performance.seriesTitle} sponsorship potential`,
            detail: `Series ${performance.seriesTitle} has strongest sponsorship potential.`,
            score: sponsors.sponsorReadiness,
            projectedMonthlyCents: sponsors.projectedSponsorCents
        },
        {
            id: 'opp-marketplace-gap',
            category: 'Marketplace Opportunities',
            title: `${marketplace.topGap?.label || 'Marketplace'} demand gap`,
            detail: marketplace.topGap
                ? `Marketplace demand indicates ${marketplace.topGap.label} services are under-supplied.`
                : 'Marketplace categories are balanced — expand cross-promotion.',
            score: marketplace.topGap?.score || marketplace.marketplacePotential,
            projectedMonthlyCents: 15000
        }
    ].sort((a, b) => b.score - a.score);

    /** @type {MonetizationRecommendation[]} */
    const recommendations = [
        topOpportunities[0],
        topOpportunities[1],
        topOpportunities[2],
        {
            id: 'rec-subscription-pack',
            category: 'Subscription Opportunities',
            title: subscriptions.enabled ? 'Bundle subscription tiers' : 'Launch creator subscriptions',
            detail: subscriptions.enabled
                ? 'Add a premium tier with early access to increase recurring revenue.'
                : 'Enable subscriptions once two more episodes are published for stronger retention.',
            impactPercent: subscriptions.enabled ? 14 : 24,
            projectedMonthlyCents: subscriptions.projectedLiftCents
        },
        {
            id: 'rec-cross-promo',
            category: 'Cross Promotion',
            title: 'Cross-promote top episodes',
            detail: `Promote the most-watched episodes to lift completion rate above ${Math.max(Math.round(context.operations.seriesCompletionRate), 55)}%.`,
            impactPercent: 11,
            projectedMonthlyCents: Math.round(revenue.netMonthlyCents * 0.08)
        },
        {
            id: 'rec-team-expansion',
            category: 'Team Expansion',
            title: 'Expand monetization pod',
            detail: `Assign a producer and marketing collaborator to capture ${formatRevenueCurrency(Math.round(revenue.netMonthlyCents * 0.12))} in incremental revenue.`,
            impactPercent: 10,
            projectedMonthlyCents: Math.round(revenue.netMonthlyCents * 0.12)
        },
        {
            id: 'rec-revenue-growth',
            category: 'Revenue Growth',
            title: 'Fastest revenue path',
            detail: `Focus on publishing cadence + premium episodes for the fastest path to ${formatRevenueCurrency(revenue.netMonthlyCents + premiumLiftCents)} monthly.`,
            impactPercent: 18,
            projectedMonthlyCents: revenue.netMonthlyCents + premiumLiftCents
        }
    ].slice(0, 6);

    /** @type {{ id: string; title: string; detail: string; severity: string }[]} */
    const blockers = [];
    if (performance.readyEpisodes === 0 && performance.publishedEpisodes < 2) {
        blockers.push({
            id: 'blocker-episode-cadence',
            title: 'Insufficient published episodes',
            detail: 'Publish at least two episodes before scaling subscriptions or sponsorships.',
            severity: 'high'
        });
    }
    if (!subscriptions.enabled) {
        blockers.push({
            id: 'blocker-subscriptions-off',
            title: 'Subscriptions disabled',
            detail: 'Recurring revenue stream is inactive in the revenue profile.',
            severity: 'medium'
        });
    }
    if (marketplace.topGap && marketplace.topGap.supply <= 1) {
        blockers.push({
            id: 'blocker-marketplace-supply',
            title: `${marketplace.topGap.label} supply gap`,
            detail: 'Local marketplace lacks enough providers to support production velocity.',
            severity: 'medium'
        });
    }
    if (getRevenueTeamCount() <= 1) {
        blockers.push({
            id: 'blocker-team-capacity',
            title: 'Limited team capacity',
            detail: 'Monetization execution requires a broader production team.',
            severity: 'low'
        });
    }

    const projectedMonthlyRevenue = revenue.netMonthlyCents + Math.round(topOpportunities.slice(0, 2).reduce((sum, item) => sum + (item.projectedMonthlyCents || 0), 0) * 0.35);
    const projectedAnnualRevenue = projectedMonthlyRevenue * 12;

    const master = {
        revenueScore,
        monetizationReadiness: revenue.monetizationReadiness,
        sponsorReadiness: sponsors.sponsorReadiness,
        subscriptionReadiness: subscriptions.subscriptionReadiness,
        marketplacePotential: marketplace.marketplacePotential,
        topOpportunities,
        blockers,
        recommendations,
        projectedMonthlyRevenue,
        projectedAnnualRevenue,
        projectedMonthlyFormatted: formatRevenueCurrency(projectedMonthlyRevenue),
        projectedAnnualFormatted: formatRevenueCurrency(projectedAnnualRevenue),
        summary: `Monetization score ${revenueScore}% — fastest path adds ${formatRevenueCurrency(projectedMonthlyRevenue - revenue.netMonthlyCents)} monthly.`,
        revenue,
        subscriptions,
        sponsors,
        marketplace,
        performance
    };

    if (emitDiagnostics) {
        logMonetizationDiag('MONETIZATION_ANALYSIS', {
            seriesId,
            revenueScore: master.revenueScore,
            monetizationReadiness: master.monetizationReadiness,
            sponsorReadiness: master.sponsorReadiness,
            subscriptionReadiness: master.subscriptionReadiness,
            marketplacePotential: master.marketplacePotential,
            projectedMonthlyRevenue: master.projectedMonthlyRevenue,
            projectedAnnualRevenue: master.projectedAnnualRevenue
        });

        for (const opportunity of master.topOpportunities.slice(0, 4)) {
            logMonetizationDiag('MONETIZATION_OPPORTUNITY', {
                seriesId,
                id: opportunity.id,
                category: opportunity.category,
                title: opportunity.title,
                score: opportunity.score,
                projectedMonthlyCents: opportunity.projectedMonthlyCents || null
            });
        }

        for (const recommendation of master.recommendations.slice(0, 5)) {
            logMonetizationDiag('MONETIZATION_RECOMMENDATION', {
                seriesId,
                id: recommendation.id,
                category: recommendation.category,
                title: recommendation.title,
                impactPercent: recommendation.impactPercent || null
            });
        }

        logMonetizationDiag('MONETIZATION_FORECAST', {
            seriesId,
            projectedMonthlyRevenue: master.projectedMonthlyRevenue,
            projectedAnnualRevenue: master.projectedAnnualRevenue,
            horizonDays: 30,
            growthAssumption: 0.08
        });
    }

    return master;
}

/** @param {ReturnType<typeof masterMonetizationAnalysis>} master */
export function getMonetizationSentinelOverlay(master) {
    return {
        revenueScore: master.revenueScore,
        topOpportunity: master.topOpportunities[0]?.title || 'No ranked opportunities',
        topRecommendation: master.recommendations[0]?.detail || master.summary,
        projectedMonthlyRevenue: master.projectedMonthlyFormatted,
        blocker: master.blockers[0]?.title || null
    };
}

let monetizationAIInitialized = false;

export function initMonetizationAI() {
    if (typeof window === 'undefined' || monetizationAIInitialized) return;
    monetizationAIInitialized = true;

    window.__reelforgeMonetizationAI = {
        MONETIZATION_AI_VERSION,
        MONETIZATION_RECOMMENDATION_CATEGORIES,
        analyzeRevenue,
        analyzeSubscriptions,
        analyzeSponsors,
        analyzeMarketplace,
        analyzeSeriesPerformance,
        masterMonetizationAnalysis,
        getMonetizationSentinelOverlay,
        logMonetizationDiag
    };

    logMonetizationDiag('MONETIZATION_ANALYSIS', {
        phase: 'engine_initialized',
        version: MONETIZATION_AI_VERSION
    });
}
