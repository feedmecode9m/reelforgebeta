/**
 * LookAtZakanda Streamlined Pricing & Access Framework (PDF v1.0).
 * Phase 1: 2 free watches, then subscription paywall at $7.99/mo or $69.99/yr.
 * Stripe price IDs remain server-side; these are canonical UI/badge amounts.
 */

/**
 * Temporary kill-switch — all MP4 episodes play free when false (default until pricing review).
 * Set VITE_EPISODE_PAYWALL_ENABLED=true in build env to restore paid/subscription gating.
 *
 * @returns {boolean}
 */
export function isEpisodePaywallEnabled() {
    /** @type {Record<string, string | undefined>} */
    const env =
        typeof import.meta !== 'undefined' && import.meta.env
            ? import.meta.env
            : typeof process !== 'undefined' && process.env
              ? process.env
              : {};
    const raw = String(env.VITE_EPISODE_PAYWALL_ENABLED ?? '')
        .trim()
        .toLowerCase();
    return raw === 'true' || raw === '1';
}

/** @type {2} */
export const PLATFORM_FREE_WATCH_LIMIT = 2;

/** @type {'7.99'} */
export const PLATFORM_SUBSCRIPTION_MONTHLY_USD = '7.99';

/** @type {'69.99'} */
export const PLATFORM_SUBSCRIPTION_ANNUAL_USD = '69.99';

/** Default per-episode paid badge / Access & Price draft when subscription-gated. */
export const PLATFORM_DEFAULT_PAID_EPISODE_USD = PLATFORM_SUBSCRIPTION_MONTHLY_USD;

/** @type {readonly { id: 'monthly' | 'annual'; label: string; priceUsd: string; interval: 'month' | 'year' }[]} */
export const PLATFORM_SUBSCRIPTION_TIERS = Object.freeze([
    {
        id: 'monthly',
        label: 'Premium Monthly',
        priceUsd: PLATFORM_SUBSCRIPTION_MONTHLY_USD,
        interval: 'month'
    },
    {
        id: 'annual',
        label: 'Premium Annual',
        priceUsd: PLATFORM_SUBSCRIPTION_ANNUAL_USD,
        interval: 'year'
    }
]);

/** @returns {string} */
export function resolveDefaultPaidEpisodePrice() {
    return PLATFORM_DEFAULT_PAID_EPISODE_USD;
}

/** @param {'monthly' | 'annual'} [tier] @returns {string} */
export function resolveSubscriptionTierPriceUsd(tier = 'monthly') {
    if (tier === 'annual') return PLATFORM_SUBSCRIPTION_ANNUAL_USD;
    return PLATFORM_SUBSCRIPTION_MONTHLY_USD;
}

/** @returns {string} */
export function formatSubscriptionPriceLabel(tier = 'monthly') {
    const price = resolveSubscriptionTierPriceUsd(tier);
    return tier === 'annual' ? `$${price}/yr` : `$${price}/mo`;
}
