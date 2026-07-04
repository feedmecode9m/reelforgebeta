/**
 * Phase 39/46 — Revenue profiles and persistence facade.
 * Calculations live in revenueCore.js.
 */

import { logRevenueDiag } from './revenueDiagnostics.js';
import {
    REVENUE_STREAM_TYPES,
    REVENUE_STREAM_DEFAULTS,
    normalizeRevenueStream,
    buildDefaultRevenueStreams,
    computeRevenueEstimate,
    computeRevenueEstimateForProfile,
    buildRevenueHorizonForecasts,
    forecastRevenue as coreForecastRevenue,
    computeCampaignRevenueEstimate
} from './revenueCore.js';
import {
    REVENUE_ENGINE_VERSION,
    REVENUE_STORAGE_KEY,
    getDefaultPlatformRevenueProfile,
    getDefaultRevenueStore,
    loadRevenueStore,
    saveRevenueStore
} from './revenueStore.js';

export {
    REVENUE_ENGINE_VERSION,
    REVENUE_STORAGE_KEY,
    REVENUE_STREAM_TYPES,
    REVENUE_STREAM_DEFAULTS,
    normalizeRevenueStream,
    buildDefaultRevenueStreams,
    getDefaultRevenueStore,
    loadRevenueStore,
    saveRevenueStore,
    computeRevenueEstimateForProfile,
    buildRevenueHorizonForecasts
};

/** @typedef {import('./revenueStore.js').RevenueStreamType} RevenueStreamType */
/** @typedef {import('./revenueStore.js').RevenueStreamConfig} RevenueStreamConfig */
/** @typedef {import('./revenueStore.js').TeamRevenueSplit} TeamRevenueSplit */
/** @typedef {import('./revenueStore.js').SeriesRevenueProfile} SeriesRevenueProfile */
/** @typedef {import('./revenueStore.js').CreatorRevenueProfile} CreatorRevenueProfile */
/** @typedef {import('./revenueStore.js').CampaignRevenueProfile} CampaignRevenueProfile */
/** @typedef {import('./revenueStore.js').PlatformRevenueProfile} PlatformRevenueProfile */
/** @typedef {import('./revenueStore.js').RevenueStore} RevenueStore */

export { getDefaultPlatformRevenueProfile };

/**
 * @param {string} seriesId
 * @param {Partial<SeriesRevenueProfile>} [patch]
 * @returns {SeriesRevenueProfile}
 */
export function buildSeriesRevenueProfile(seriesId, patch = {}) {
    const profile = {
        seriesId,
        currency: patch.currency || 'USD',
        streams: (patch.streams || buildDefaultRevenueStreams()).map(normalizeRevenueStream),
        teamSplits: patch.teamSplits || [
            { memberId: 'creator-owner', role: 'OWNER', sharePercent: 70 },
            { memberId: 'creator-editor', role: 'EDITOR', sharePercent: 20 },
            { memberId: 'platform-reserve', role: 'PLATFORM', sharePercent: 10 }
        ],
        updatedAt: Date.now()
    };

    logRevenueDiag('REVENUE_PROFILE', {
        profileType: 'series',
        seriesId: profile.seriesId,
        streamCount: profile.streams.length,
        enabledStreams: profile.streams.filter((stream) => stream.enabled).map((stream) => stream.type),
        teamSplitCount: profile.teamSplits.length
    });

    return profile;
}

/**
 * @param {string} creatorId
 * @param {Partial<CreatorRevenueProfile>} [patch]
 * @returns {CreatorRevenueProfile}
 */
export function buildCreatorRevenueProfile(creatorId, patch = {}) {
    const profile = {
        creatorId,
        displayName: patch.displayName || 'Creator',
        currency: patch.currency || 'USD',
        streams: (patch.streams || buildDefaultRevenueStreams()).map(normalizeRevenueStream),
        teamSplits: patch.teamSplits || [],
        seriesIds: patch.seriesIds || [],
        updatedAt: Date.now()
    };

    logRevenueDiag('REVENUE_PROFILE', {
        profileType: 'creator',
        creatorId: profile.creatorId,
        seriesCount: profile.seriesIds.length,
        streamCount: profile.streams.length
    });

    return profile;
}

/**
 * @param {string} campaignId
 * @param {Partial<CampaignRevenueProfile>} [patch]
 * @returns {CampaignRevenueProfile}
 */
export function buildCampaignRevenueProfile(campaignId, patch = {}) {
    const profile = {
        campaignId,
        name: patch.name || 'Campaign',
        campaignType: patch.campaignType || 'sponsorships',
        seriesId: patch.seriesId,
        currency: patch.currency || 'USD',
        budgetCents: patch.budgetCents ?? 500000,
        cpmCents: patch.cpmCents ?? 1200,
        expectedImpressions: patch.expectedImpressions ?? 250000,
        conversionRate: patch.conversionRate ?? 0.03,
        updatedAt: Date.now()
    };

    logRevenueDiag('REVENUE_PROFILE', {
        profileType: 'campaign',
        campaignId: profile.campaignId,
        campaignType: profile.campaignType,
        budgetCents: profile.budgetCents
    });

    return profile;
}

/**
 * @param {string} seriesId
 * @param {Partial<SeriesRevenueProfile>} patch
 */
export function saveSeriesRevenueProfile(seriesId, patch = {}) {
    const store = loadRevenueStore();
    store.series[seriesId] = buildSeriesRevenueProfile(seriesId, {
        ...store.series[seriesId],
        ...patch
    });
    return saveRevenueStore(store).series[seriesId];
}

/**
 * @param {string} creatorId
 * @param {Partial<CreatorRevenueProfile>} patch
 */
export function saveCreatorRevenueProfile(creatorId, patch = {}) {
    const store = loadRevenueStore();
    store.creators[creatorId] = buildCreatorRevenueProfile(creatorId, {
        ...store.creators[creatorId],
        ...patch
    });
    return saveRevenueStore(store).creators[creatorId];
}

/**
 * @param {string} campaignId
 * @param {Partial<CampaignRevenueProfile>} patch
 */
export function saveCampaignRevenueProfile(campaignId, patch = {}) {
    const store = loadRevenueStore();
    store.campaigns[campaignId] = buildCampaignRevenueProfile(campaignId, {
        ...store.campaigns[campaignId],
        ...patch
    });
    return saveRevenueStore(store).campaigns[campaignId];
}

/** @param {Partial<PlatformRevenueProfile>} patch */
export function savePlatformRevenueProfile(patch = {}) {
    const store = loadRevenueStore();
    store.platform = {
        ...getDefaultPlatformRevenueProfile(),
        ...store.platform,
        ...patch,
        defaultStreams: (patch.defaultStreams || store.platform?.defaultStreams || buildDefaultRevenueStreams()).map(
            normalizeRevenueStream
        ),
        updatedAt: Date.now()
    };
    logRevenueDiag('REVENUE_PROFILE', {
        profileType: 'platform',
        platformId: store.platform.platformId,
        platformFeePercent: store.platform.platformFeePercent
    });
    return saveRevenueStore(store).platform;
}

/**
 * @param {{ streams?: RevenueStreamConfig[]; teamSplits?: TeamRevenueSplit[]; currency?: string; profileType?: string; profileId?: string; platformFeePercent?: number }} profile
 * @param {{ monthlyViewers?: number; episodes?: number }} [context]
 */
export function estimateRevenue(profile, context = {}) {
    const estimate = computeRevenueEstimate(profile, context);

    logRevenueDiag('REVENUE_ESTIMATE', {
        ...estimate,
        monthlyViewers: context.monthlyViewers ?? null,
        episodes: context.episodes ?? null
    });

    return estimate;
}

/**
 * @param {{ streams?: RevenueStreamConfig[]; teamSplits?: TeamRevenueSplit[]; currency?: string; profileType?: string; profileId?: string; platformFeePercent?: number }} profile
 * @param {{ months?: number; growthRate?: number; monthlyViewers?: number; episodes?: number }} [options]
 */
export function forecastRevenue(profile, options = {}) {
    const forecast = coreForecastRevenue(profile, options);
    logRevenueDiag('REVENUE_FORECAST', forecast);
    return forecast;
}

/**
 * @param {string} seriesId
 * @param {{ monthlyViewers?: number; episodes?: number }} [context]
 */
export function estimateSeriesRevenue(seriesId, context = {}) {
    const store = loadRevenueStore();
    const profile = store.series[seriesId] || buildSeriesRevenueProfile(seriesId);
    return estimateRevenue(
        {
            ...profile,
            profileType: 'series',
            profileId: seriesId,
            platformFeePercent: store.platform.platformFeePercent
        },
        context
    );
}

/**
 * @param {string} campaignId
 */
export function estimateCampaignRevenue(campaignId) {
    const store = loadRevenueStore();
    const campaign = store.campaigns[campaignId] || buildCampaignRevenueProfile(campaignId);
    const estimate = computeCampaignRevenueEstimate(campaign);
    logRevenueDiag('REVENUE_ESTIMATE', estimate);
    return estimate;
}

let revenueEngineInitialized = false;

export function initRevenueEngine() {
    if (typeof window === 'undefined' || revenueEngineInitialized) return;
    revenueEngineInitialized = true;

    const store = loadRevenueStore();
    if (!store.platform?.platformId) {
        savePlatformRevenueProfile(getDefaultPlatformRevenueProfile());
    }

    window.__reelforgeRevenue = {
        REVENUE_ENGINE_VERSION,
        REVENUE_STORAGE_KEY,
        REVENUE_STREAM_TYPES,
        REVENUE_STREAM_DEFAULTS,
        loadRevenueStore,
        saveRevenueStore,
        buildSeriesRevenueProfile,
        buildCreatorRevenueProfile,
        buildCampaignRevenueProfile,
        getDefaultPlatformRevenueProfile,
        saveSeriesRevenueProfile,
        saveCreatorRevenueProfile,
        saveCampaignRevenueProfile,
        savePlatformRevenueProfile,
        estimateRevenue,
        estimateSeriesRevenue,
        estimateCampaignRevenue,
        forecastRevenue,
        computeRevenueEstimateForProfile,
        buildRevenueHorizonForecasts,
        logRevenueDiag
    };

    logRevenueDiag('REVENUE_PROFILE', {
        phase: 'engine_initialized',
        version: REVENUE_ENGINE_VERSION,
        storageKey: REVENUE_STORAGE_KEY,
        streamTypes: REVENUE_STREAM_TYPES
    });
}
