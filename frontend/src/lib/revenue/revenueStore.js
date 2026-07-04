/**
 * Phase 46 — Revenue persistence layer (store only, no calculations).
 */

export const REVENUE_ENGINE_VERSION = '1.0.0';
export const REVENUE_STORAGE_KEY = 'reelforge_revenue_profiles';

/** @typedef {'subscriptions' | 'sponsorships' | 'ad_revenue' | 'affiliate_campaigns' | 'premium_episodes' | 'pay_per_view' | 'team_revenue_splits'} RevenueStreamType */

/**
 * @typedef {Object} RevenueStreamConfig
 * @property {RevenueStreamType} type
 * @property {boolean} enabled
 * @property {string} label
 * @property {number} unitPriceCents
 * @property {number} expectedMonthlyUnits
 * @property {number} conversionRate
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} TeamRevenueSplit
 * @property {string} memberId
 * @property {string} role
 * @property {number} sharePercent
 */

/**
 * @typedef {Object} SeriesRevenueProfile
 * @property {string} seriesId
 * @property {string} currency
 * @property {RevenueStreamConfig[]} streams
 * @property {TeamRevenueSplit[]} teamSplits
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} CreatorRevenueProfile
 * @property {string} creatorId
 * @property {string} displayName
 * @property {string} currency
 * @property {RevenueStreamConfig[]} streams
 * @property {TeamRevenueSplit[]} teamSplits
 * @property {string[]} seriesIds
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} CampaignRevenueProfile
 * @property {string} campaignId
 * @property {string} name
 * @property {'sponsorships' | 'affiliate_campaigns' | 'ad_revenue'} campaignType
 * @property {string} [seriesId]
 * @property {string} currency
 * @property {number} budgetCents
 * @property {number} cpmCents
 * @property {number} expectedImpressions
 * @property {number} conversionRate
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} PlatformRevenueProfile
 * @property {string} platformId
 * @property {string} currency
 * @property {number} platformFeePercent
 * @property {RevenueStreamConfig[]} defaultStreams
 * @property {Record<RevenueStreamType, number>} streamWeights
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} RevenueStore
 * @property {string} version
 * @property {Record<string, SeriesRevenueProfile>} series
 * @property {Record<string, CreatorRevenueProfile>} creators
 * @property {Record<string, CampaignRevenueProfile>} campaigns
 * @property {PlatformRevenueProfile} platform
 * @property {number} updatedAt
 */

/** @returns {PlatformRevenueProfile} */
export function getDefaultPlatformRevenueProfile() {
    return {
        platformId: 'reelforge',
        currency: 'USD',
        platformFeePercent: 12,
        defaultStreams: [],
        streamWeights: {
            subscriptions: 0.28,
            sponsorships: 0.18,
            ad_revenue: 0.22,
            affiliate_campaigns: 0.1,
            premium_episodes: 0.12,
            pay_per_view: 0.08,
            team_revenue_splits: 0.02
        },
        updatedAt: Date.now()
    };
}

/** @returns {RevenueStore} */
export function getDefaultRevenueStore() {
    return {
        version: REVENUE_ENGINE_VERSION,
        series: {},
        creators: {},
        campaigns: {},
        platform: getDefaultPlatformRevenueProfile(),
        updatedAt: Date.now()
    };
}

/** @returns {RevenueStore} */
export function loadRevenueStore() {
    if (typeof window === 'undefined') return getDefaultRevenueStore();
    try {
        const raw = localStorage.getItem(REVENUE_STORAGE_KEY);
        if (!raw) return getDefaultRevenueStore();
        const parsed = JSON.parse(raw);
        return {
            ...getDefaultRevenueStore(),
            ...parsed,
            platform: {
                ...getDefaultPlatformRevenueProfile(),
                ...(parsed.platform || {})
            },
            series: parsed.series || {},
            creators: parsed.creators || {},
            campaigns: parsed.campaigns || {}
        };
    } catch {
        return getDefaultRevenueStore();
    }
}

/** @param {RevenueStore} store */
export function saveRevenueStore(store) {
    const payload = {
        ...store,
        version: REVENUE_ENGINE_VERSION,
        updatedAt: Date.now()
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem(REVENUE_STORAGE_KEY, JSON.stringify(payload));
    }
    return payload;
}
