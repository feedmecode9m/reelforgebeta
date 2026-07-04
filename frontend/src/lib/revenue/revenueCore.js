/**
 * Phase 46 — Unified revenue calculation core.
 * Single source for estimates, forecasts, KPIs, and dashboard briefs.
 */

import { computeSeriesHealth } from '../series/productionHealth.js';
import { getOperationsSnapshot } from '../observability/platformMetrics.js';
import { TEAM_STORAGE_KEY } from '../teams/creatorTeams.js';
import { logRevenueDiag } from './revenueDiagnostics.js';
import { loadRevenueStore } from './revenueStore.js';

export const REVENUE_CORE_VERSION = '1.0.0';
export const REVENUE_FORECAST_HORIZONS = [30, 90, 365];
export const REVENUE_DEFAULT_GROWTH_RATE = 0.08;
export const REVENUE_DEFAULT_PLATFORM_FEE_PERCENT = 12;

export const REVENUE_STREAM_TYPES = /** @type {import('./revenueStore.js').RevenueStreamType[]} */ ([
    'subscriptions',
    'sponsorships',
    'ad_revenue',
    'affiliate_campaigns',
    'premium_episodes',
    'pay_per_view',
    'team_revenue_splits'
]);

/** @type {Record<import('./revenueStore.js').RevenueStreamType, { label: string; defaultUnitPriceCents: number; defaultMonthlyUnits: number }>} */
export const REVENUE_STREAM_DEFAULTS = {
    subscriptions: { label: 'Subscriptions', defaultUnitPriceCents: 999, defaultMonthlyUnits: 120 },
    sponsorships: { label: 'Sponsorships', defaultUnitPriceCents: 250000, defaultMonthlyUnits: 1 },
    ad_revenue: { label: 'Ad Revenue', defaultUnitPriceCents: 350, defaultMonthlyUnits: 5000 },
    affiliate_campaigns: { label: 'Affiliate Campaigns', defaultUnitPriceCents: 1200, defaultMonthlyUnits: 45 },
    premium_episodes: { label: 'Premium Episodes', defaultUnitPriceCents: 299, defaultMonthlyUnits: 40 },
    pay_per_view: { label: 'Pay Per View', defaultUnitPriceCents: 199, defaultMonthlyUnits: 75 },
    team_revenue_splits: { label: 'Team Revenue Splits', defaultUnitPriceCents: 0, defaultMonthlyUnits: 0 }
};

const DEFAULT_TEAM_SPLITS = [
    { memberId: 'creator-owner', role: 'OWNER', sharePercent: 70 },
    { memberId: 'creator-editor', role: 'EDITOR', sharePercent: 20 },
    { memberId: 'platform-reserve', role: 'PLATFORM', sharePercent: 10 }
];

/**
 * @param {Partial<import('./revenueStore.js').RevenueStreamConfig> & Pick<import('./revenueStore.js').RevenueStreamConfig, 'type'>} stream
 * @returns {import('./revenueStore.js').RevenueStreamConfig}
 */
export function normalizeRevenueStream(stream) {
    const defaults = REVENUE_STREAM_DEFAULTS[stream.type];
    return {
        type: stream.type,
        enabled: stream.enabled ?? stream.type !== 'team_revenue_splits',
        label: stream.label || defaults.label,
        unitPriceCents: Number.isFinite(stream.unitPriceCents) ? stream.unitPriceCents : defaults.defaultUnitPriceCents,
        expectedMonthlyUnits: Number.isFinite(stream.expectedMonthlyUnits)
            ? stream.expectedMonthlyUnits
            : defaults.defaultMonthlyUnits,
        conversionRate: Number.isFinite(stream.conversionRate) ? stream.conversionRate : 0.05,
        metadata: stream.metadata || {}
    };
}

/** @returns {import('./revenueStore.js').RevenueStreamConfig[]} */
export function buildDefaultRevenueStreams(options = {}) {
    const { enabledTypes } = options;
    return REVENUE_STREAM_TYPES.filter((type) => type !== 'team_revenue_splits')
        .filter((type) => !enabledTypes || enabledTypes.includes(type))
        .map((type) =>
            normalizeRevenueStream({
                type,
                enabled: ['subscriptions', 'ad_revenue', 'premium_episodes'].includes(type)
            })
        );
}

/**
 * @param {import('./revenueStore.js').RevenueStore} store
 * @param {string} seriesId
 * @returns {import('./revenueStore.js').SeriesRevenueProfile}
 */
export function ensureSeriesRevenueProfile(store, seriesId) {
    if (store.series[seriesId]) return store.series[seriesId];
    return {
        seriesId,
        currency: store.platform?.currency || 'USD',
        streams: buildDefaultRevenueStreams(),
        teamSplits: DEFAULT_TEAM_SPLITS,
        updatedAt: Date.now()
    };
}

/**
 * @param {number} cents
 * @param {string} [currency]
 */
export function formatRevenueCurrency(cents, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0
    }).format(cents / 100);
}

/** @returns {number} */
export function getRevenueTeamCount() {
    if (typeof window === 'undefined') return 1;
    try {
        const raw = localStorage.getItem(TEAM_STORAGE_KEY);
        if (!raw) return 1;
        const parsed = JSON.parse(raw);
        const teams = Array.isArray(parsed.teams) ? parsed.teams : [];
        return Math.max(teams.length, 1);
    } catch {
        return 1;
    }
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {{ monthlyViewers?: number; operations?: ReturnType<typeof getOperationsSnapshot> }} [options]
 */
export function resolveRevenueContext(seriesId, feedReels = [], options = {}) {
    const health = computeSeriesHealth(feedReels, seriesId);
    const episodeCount = Math.max(health.totalEpisodes, 1);
    const operations = options.operations || getOperationsSnapshot(seriesId);
    const opsMonthlyViewers = operations?.dailyActiveViewers
        ? Math.round(operations.dailyActiveViewers * 30)
        : 0;
    const monthlyViewers =
        options.monthlyViewers ??
        Math.max(opsMonthlyViewers, episodeCount * 250, 1000);

    return {
        health,
        episodeCount,
        monthlyViewers,
        operations
    };
}

/**
 * @param {import('./revenueEngine.js').RevenueStreamConfig} stream
 * @returns {number}
 */
function estimateStreamMonthlyCents(stream) {
    if (!stream.enabled || stream.type === 'team_revenue_splits') return 0;
    return Math.round(stream.unitPriceCents * stream.expectedMonthlyUnits * stream.conversionRate);
}

/**
 * @param {import('./revenueEngine.js').TeamRevenueSplit[]} teamSplits
 * @param {number} grossCents
 */
function applyTeamSplits(teamSplits, grossCents) {
    if (!teamSplits.length) {
        return { grossCents, netCreatorCents: grossCents, splits: [] };
    }

    const totalShare = teamSplits.reduce((sum, split) => sum + split.sharePercent, 0);
    const normalized = totalShare > 0 ? totalShare : 100;
    const splits = teamSplits.map((split) => ({
        ...split,
        amountCents: Math.round((grossCents * split.sharePercent) / normalized)
    }));

    const creatorShare = splits
        .filter((split) => split.role !== 'PLATFORM')
        .reduce((sum, split) => sum + split.amountCents, 0);

    return {
        grossCents,
        netCreatorCents: creatorShare,
        splits
    };
}

/**
 * @param {{ streams?: import('./revenueEngine.js').RevenueStreamConfig[]; teamSplits?: import('./revenueEngine.js').TeamRevenueSplit[]; currency?: string; profileType?: string; profileId?: string; platformFeePercent?: number }} profile
 * @param {{ monthlyViewers?: number; episodes?: number }} [context]
 */
export function computeRevenueEstimate(profile, context = {}) {
    const streams = (profile.streams || []).map(normalizeRevenueStream);
    const viewerMultiplier = context.monthlyViewers ? Math.max(1, context.monthlyViewers / 1000) : 1;
    const episodeMultiplier = context.episodes ? Math.max(1, context.episodes / 10) : 1;

    const streamEstimates = streams.map((stream) => {
        const base = estimateStreamMonthlyCents(stream);
        const adjusted =
            stream.type === 'ad_revenue'
                ? Math.round(base * viewerMultiplier)
                : stream.type === 'premium_episodes' || stream.type === 'pay_per_view'
                  ? Math.round(base * episodeMultiplier)
                  : base;
        return {
            type: stream.type,
            label: stream.label,
            enabled: stream.enabled,
            monthlyCents: adjusted
        };
    });

    const grossMonthlyCents = streamEstimates.reduce((sum, item) => sum + item.monthlyCents, 0);
    const platformFeePercent = profile.platformFeePercent ?? REVENUE_DEFAULT_PLATFORM_FEE_PERCENT;
    const platformFeeCents = Math.round((grossMonthlyCents * platformFeePercent) / 100);
    const afterPlatformCents = grossMonthlyCents - platformFeeCents;
    const splitResult = applyTeamSplits(profile.teamSplits || [], afterPlatformCents);

    const estimate = {
        profileType: profile.profileType || 'generic',
        profileId: profile.profileId || 'unknown',
        currency: profile.currency || 'USD',
        grossMonthlyCents,
        platformFeeCents,
        netCreatorCents: splitResult.netCreatorCents,
        streamEstimates,
        teamSplits: splitResult.splits
    };

    logRevenueDiag('REVENUE_CORE', {
        operation: 'compute_estimate',
        profileType: estimate.profileType,
        profileId: estimate.profileId,
        grossMonthlyCents: estimate.grossMonthlyCents,
        netCreatorCents: estimate.netCreatorCents,
        monthlyViewers: context.monthlyViewers ?? null,
        episodes: context.episodes ?? null
    });

    return estimate;
}

/**
 * @param {{ streams?: import('./revenueEngine.js').RevenueStreamConfig[]; teamSplits?: import('./revenueEngine.js').TeamRevenueSplit[]; currency?: string; profileType?: string; profileId?: string; platformFeePercent?: number }} profile
 * @param {{ monthlyViewers?: number; episodes?: number }} [context]
 */
export function computeRevenueEstimateForProfile(profile, context = {}) {
    return computeRevenueEstimate(profile, context);
}

/**
 * @param {{ streams?: import('./revenueEngine.js').RevenueStreamConfig[]; teamSplits?: import('./revenueEngine.js').TeamRevenueSplit[]; currency?: string; profileType?: string; profileId?: string; platformFeePercent?: number }} profile
 * @param {{ monthlyViewers?: number; episodes?: number; growthRate?: number; horizons?: number[] }} [options]
 */
export function buildRevenueHorizonForecasts(profile, options = {}) {
    const growthRate = options.growthRate ?? REVENUE_DEFAULT_GROWTH_RATE;
    const horizons = options.horizons || REVENUE_FORECAST_HORIZONS;
    const base = computeRevenueEstimate(profile, {
        monthlyViewers: options.monthlyViewers ?? 1000,
        episodes: options.episodes ?? 10
    });
    const dailyNet = base.netCreatorCents / 30;
    const dailyGross = base.grossMonthlyCents / 30;

    const forecasts = horizons.map((horizonDays) => {
        const growthMultiplier = Math.pow(1 + growthRate, horizonDays / 30);
        return {
            horizonDays,
            label: horizonDays === 30 ? '30 day' : horizonDays === 90 ? '90 day' : `${horizonDays} day`,
            netCents: Math.round(dailyNet * horizonDays * growthMultiplier),
            grossCents: Math.round(dailyGross * horizonDays * growthMultiplier),
            growthRate
        };
    });

    logRevenueDiag('REVENUE_CORE', {
        operation: 'horizon_forecasts',
        profileId: profile.profileId || 'unknown',
        horizonCount: forecasts.length,
        growthRate
    });

    return forecasts;
}

/**
 * @param {{ streams?: import('./revenueEngine.js').RevenueStreamConfig[]; teamSplits?: import('./revenueEngine.js').TeamRevenueSplit[]; currency?: string; profileType?: string; profileId?: string; platformFeePercent?: number }} profile
 * @param {{ months?: number; growthRate?: number; monthlyViewers?: number; episodes?: number }} [options]
 */
export function forecastRevenue(profile, options = {}) {
    const months = options.months ?? 6;
    const growthRate = options.growthRate ?? REVENUE_DEFAULT_GROWTH_RATE;
    const points = [];

    for (let month = 1; month <= months; month += 1) {
        const growthMultiplier = Math.pow(1 + growthRate, month - 1);
        const estimate = computeRevenueEstimate(profile, {
            monthlyViewers: Math.round((options.monthlyViewers || 1000) * growthMultiplier),
            episodes: options.episodes || 10
        });
        points.push({
            month,
            grossMonthlyCents: estimate.grossMonthlyCents,
            netCreatorCents: estimate.netCreatorCents
        });
    }

    const totalGrossCents = points.reduce((sum, point) => sum + point.grossMonthlyCents, 0);
    const totalNetCreatorCents = points.reduce((sum, point) => sum + point.netCreatorCents, 0);

    const forecast = {
        profileType: profile.profileType || 'generic',
        profileId: profile.profileId || 'unknown',
        currency: profile.currency || 'USD',
        months,
        growthRate,
        points,
        totalGrossCents,
        totalNetCreatorCents,
        averageMonthlyNetCents: Math.round(totalNetCreatorCents / months)
    };

    logRevenueDiag('REVENUE_CORE', {
        operation: 'forecast',
        profileId: forecast.profileId,
        months: forecast.months,
        totalNetCreatorCents: forecast.totalNetCreatorCents
    });

    return forecast;
}

/**
 * @param {import('./revenueEngine.js').CampaignRevenueProfile} campaign
 */
export function computeCampaignRevenueEstimate(campaign) {
    const grossMonthlyCents =
        campaign.campaignType === 'ad_revenue'
            ? Math.round((campaign.expectedImpressions / 1000) * campaign.cpmCents)
            : Math.round(campaign.budgetCents * campaign.conversionRate);

    return {
        profileType: 'campaign',
        profileId: campaign.campaignId,
        currency: campaign.currency,
        grossMonthlyCents,
        platformFeeCents: 0,
        netCreatorCents: grossMonthlyCents,
        streamEstimates: [
            {
                type: campaign.campaignType,
                label: campaign.name,
                enabled: true,
                monthlyCents: grossMonthlyCents
            }
        ],
        teamSplits: []
    };
}

/**
 * @param {ReturnType<typeof computeRevenueEstimate>} selectedEstimate
 * @param {number} aggregateNetMonthlyCents
 * @param {number} episodeCount
 * @param {number} creatorCount
 * @param {number} teamCount
 * @param {string} currency
 */
export function buildRevenueKpis(selectedEstimate, aggregateNetMonthlyCents, episodeCount, creatorCount, teamCount, currency) {
    const mrrCents = aggregateNetMonthlyCents;
    const arrCents = mrrCents * 12;

    return {
        mrr: {
            id: 'mrr',
            label: 'MRR',
            cents: mrrCents,
            formatted: formatRevenueCurrency(mrrCents, currency)
        },
        arr: {
            id: 'arr',
            label: 'ARR',
            cents: arrCents,
            formatted: formatRevenueCurrency(arrCents, currency)
        },
        seriesRevenue: {
            id: 'series-revenue',
            label: 'Series Revenue',
            cents: selectedEstimate.grossMonthlyCents,
            formatted: formatRevenueCurrency(selectedEstimate.grossMonthlyCents, currency)
        },
        revenuePerEpisode: {
            id: 'revenue-per-episode',
            label: 'Revenue Per Episode',
            cents: Math.round(selectedEstimate.netCreatorCents / episodeCount),
            formatted: formatRevenueCurrency(
                Math.round(selectedEstimate.netCreatorCents / episodeCount),
                currency
            )
        },
        revenuePerCreator: {
            id: 'revenue-per-creator',
            label: 'Revenue Per Creator',
            cents: Math.round(aggregateNetMonthlyCents / creatorCount),
            formatted: formatRevenueCurrency(Math.round(aggregateNetMonthlyCents / creatorCount), currency)
        },
        revenuePerTeam: {
            id: 'revenue-per-team',
            label: 'Revenue Per Team',
            cents: Math.round(aggregateNetMonthlyCents / teamCount),
            formatted: formatRevenueCurrency(Math.round(aggregateNetMonthlyCents / teamCount), currency)
        }
    };
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {{ monthlyViewers?: number }} [options]
 */
export function buildRevenueDashboardBrief(seriesId, feedReels = [], options = {}) {
    const store = loadRevenueStore();
    const context = resolveRevenueContext(seriesId, feedReels, options);
    const creatorCount = Math.max(Object.keys(store.creators).length, 1);
    const teamCount = getRevenueTeamCount();
    const currency = store.platform?.currency || 'USD';

    const seriesProfiles = Object.keys(store.series).length
        ? Object.entries(store.series)
        : [[seriesId, ensureSeriesRevenueProfile(store, seriesId)]];

    const seriesEstimates = seriesProfiles.map(([profileSeriesId, profile]) => {
        const estimate = computeRevenueEstimateForProfile(
            {
                ...profile,
                profileType: 'series',
                profileId: profileSeriesId,
                platformFeePercent: store.platform.platformFeePercent
            },
            {
                monthlyViewers: context.monthlyViewers,
                episodes: profileSeriesId === seriesId ? context.episodeCount : Math.max(context.episodeCount, 1)
            }
        );
        return { seriesId: profileSeriesId, estimate };
    });

    const aggregateNetMonthlyCents = seriesEstimates.reduce(
        (sum, item) => sum + item.estimate.netCreatorCents,
        0
    );
    const aggregateGrossMonthlyCents = seriesEstimates.reduce(
        (sum, item) => sum + item.estimate.grossMonthlyCents,
        0
    );

    const selectedEstimate =
        seriesEstimates.find((item) => item.seriesId === seriesId)?.estimate ||
        computeRevenueEstimateForProfile(
            {
                ...(store.series[seriesId] || ensureSeriesRevenueProfile(store, seriesId)),
                profileType: 'series',
                profileId: seriesId,
                platformFeePercent: store.platform.platformFeePercent
            },
            { monthlyViewers: context.monthlyViewers, episodes: context.episodeCount }
        );

    const kpis = buildRevenueKpis(
        selectedEstimate,
        aggregateNetMonthlyCents,
        context.episodeCount,
        creatorCount,
        teamCount,
        currency
    );

    const forecasts = buildRevenueHorizonForecasts(
        {
            ...(store.series[seriesId] || ensureSeriesRevenueProfile(store, seriesId)),
            profileType: 'series',
            profileId: seriesId,
            platformFeePercent: store.platform.platformFeePercent
        },
        {
            monthlyViewers: context.monthlyViewers,
            episodes: context.episodeCount
        }
    ).map((forecast) => ({
        ...forecast,
        formattedNet: formatRevenueCurrency(forecast.netCents, currency),
        formattedGross: formatRevenueCurrency(forecast.grossCents, currency)
    }));

    const brief = {
        seriesId,
        currency,
        episodeCount: context.episodeCount,
        creatorCount,
        teamCount,
        monthlyViewers: context.monthlyViewers,
        aggregateGrossMonthlyCents,
        aggregateNetMonthlyCents,
        selectedEstimate,
        kpis,
        forecasts,
        seriesEstimates
    };

    logRevenueDiag('REVENUE_CORE', {
        operation: 'dashboard_brief',
        seriesId,
        aggregateNetMonthlyCents,
        mrrCents: kpis.mrr.cents,
        arrCents: kpis.arr.cents,
        forecastCount: forecasts.length
    });

    return brief;
}

/**
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {{ monthlyViewers?: number }} [options]
 */
export function buildSeriesRevenueSnapshot(seriesId, feedReels = [], options = {}) {
    const store = loadRevenueStore();
    const context = resolveRevenueContext(seriesId, feedReels, options);
    const profile = store.series[seriesId] || ensureSeriesRevenueProfile(store, seriesId);
    const estimate = computeRevenueEstimateForProfile(
        {
            ...profile,
            profileType: 'series',
            profileId: seriesId,
            platformFeePercent: store.platform.platformFeePercent
        },
        {
            monthlyViewers: context.monthlyViewers,
            episodes: context.episodeCount
        }
    );

    return {
        seriesId,
        context,
        estimate,
        profile
    };
}

/**
 * Compare dashboard brief vs series snapshot for consistency reporting.
 * @param {string} seriesId
 * @param {Record<string, unknown>[]} [feedReels]
 * @param {{ monthlyViewers?: number }} [options]
 */
export function syncRevenueConsistencyCheck(seriesId, feedReels = [], options = {}) {
    const brief = buildRevenueDashboardBrief(seriesId, feedReels, options);
    const snapshot = buildSeriesRevenueSnapshot(seriesId, feedReels, options);

    const checks = {
        netMonthlyAligned:
            brief.selectedEstimate.netCreatorCents === snapshot.estimate.netCreatorCents,
        grossMonthlyAligned:
            brief.selectedEstimate.grossMonthlyCents === snapshot.estimate.grossMonthlyCents,
        monthlyViewersAligned: brief.monthlyViewers === snapshot.context.monthlyViewers,
        mrrMatchesAggregateNet: brief.kpis.mrr.cents === brief.aggregateNetMonthlyCents,
        arrMatchesMrr: brief.kpis.arr.cents === brief.kpis.mrr.cents * 12
    };

    const consistent = Object.values(checks).every(Boolean);

    logRevenueDiag('REVENUE_SYNC', {
        seriesId,
        consistent,
        checks,
        dashboardNetCents: brief.selectedEstimate.netCreatorCents,
        snapshotNetCents: snapshot.estimate.netCreatorCents,
        mrrCents: brief.kpis.mrr.cents,
        aggregateNetMonthlyCents: brief.aggregateNetMonthlyCents
    });

    return {
        seriesId,
        consistent,
        checks,
        brief,
        snapshot
    };
}

let revenueCoreInitialized = false;

export function initRevenueCore() {
    if (typeof window === 'undefined' || revenueCoreInitialized) return;
    revenueCoreInitialized = true;

    window.__reelforgeRevenueCore = {
        REVENUE_CORE_VERSION,
        REVENUE_FORECAST_HORIZONS,
        formatRevenueCurrency,
        resolveRevenueContext,
        computeRevenueEstimate,
        computeRevenueEstimateForProfile,
        buildRevenueHorizonForecasts,
        forecastRevenue,
        computeCampaignRevenueEstimate,
        buildRevenueKpis,
        buildRevenueDashboardBrief,
        buildSeriesRevenueSnapshot,
        syncRevenueConsistencyCheck,
        getRevenueTeamCount
    };

    logRevenueDiag('REVENUE_CORE', {
        operation: 'initialized',
        version: REVENUE_CORE_VERSION
    });
}
