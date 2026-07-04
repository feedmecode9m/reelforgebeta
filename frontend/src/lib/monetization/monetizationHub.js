/**
 * Phase 72 — Monetization Expansion foundation.
 * Sustainable revenue architecture with support channels + SaaS tier roadmap.
 */

export const MONETIZATION_HUB_VERSION = '72.0.0';
export const MONETIZATION_HUB_STORAGE_KEY = 'reelforge_monetization_hub';

export const DONATION_METHOD_IDS = /** @type {const} */ ([
    'patreon',
    'kofi',
    'stripe_donation',
    'sponsor_reelforge'
]);

export const PLAN_IDS = /** @type {const} */ ([
    'creator_plans',
    'team_plans',
    'enterprise_plans',
    'storage_plans',
    'ai_plans',
    'marketplace_fees'
]);

/**
 * @param {'MONETIZATION' | 'DONATION_CLICK' | 'PLAN_VIEW'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logMonetizationDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {Record<string, unknown>} */
export function getDefaultMonetizationHubState() {
    return {
        version: MONETIZATION_HUB_VERSION,
        message: 'Built with love for creators. Support the future of ReelForge.',
        supportMethods: {
            patreon: {
                enabled: true,
                label: 'Patreon',
                url: 'https://www.patreon.com/reelforge'
            },
            kofi: {
                enabled: true,
                label: 'Ko-fi',
                url: 'https://ko-fi.com/reelforge'
            },
            stripe_donation: {
                enabled: true,
                label: 'Stripe Donation',
                url: 'https://buy.stripe.com/test_reelforge'
            },
            sponsor_reelforge: {
                enabled: true,
                label: 'Sponsor ReelForge',
                url: 'https://reelforge.example.com/sponsor'
            }
        },
        plans: {
            creator_plans: {
                title: 'Creator Plans',
                stage: 'foundation',
                description: 'Individual monetization toolkit with release, analytics, and payout insights.',
                targetUsers: 'solo creators'
            },
            team_plans: {
                title: 'Team Plans',
                stage: 'roadmap',
                description: 'Collaborative workflow, approvals, role controls, and shared monetization dashboards.',
                targetUsers: 'production teams'
            },
            enterprise_plans: {
                title: 'Enterprise Plans',
                stage: 'roadmap',
                description: 'Security, compliance, auditability, and enterprise-scale controls.',
                targetUsers: 'studio organizations'
            },
            storage_plans: {
                title: 'Storage Plans',
                stage: 'roadmap',
                description: 'Tiered media storage, archival, and optimized delivery.',
                targetUsers: 'all creators'
            },
            ai_plans: {
                title: 'AI Plans',
                stage: 'roadmap',
                description: 'Advanced AI copilots, automation quotas, and inference bundles.',
                targetUsers: 'growth + pro creators'
            },
            marketplace_fees: {
                title: 'Marketplace Fees',
                stage: 'foundation',
                description: 'Transparent transaction fee model for creator-service marketplace activity.',
                targetUsers: 'marketplace participants'
            }
        },
        updatedAt: Date.now()
    };
}

/** @returns {Record<string, unknown>} */
export function loadMonetizationHubState() {
    if (typeof window === 'undefined') return getDefaultMonetizationHubState();
    try {
        const raw = localStorage.getItem(MONETIZATION_HUB_STORAGE_KEY);
        if (!raw) return getDefaultMonetizationHubState();
        const parsed = JSON.parse(raw);
        const defaults = getDefaultMonetizationHubState();
        return {
            ...defaults,
            ...parsed,
            supportMethods: {
                ...defaults.supportMethods,
                ...(parsed.supportMethods || {})
            },
            plans: {
                ...defaults.plans,
                ...(parsed.plans || {})
            }
        };
    } catch {
        return getDefaultMonetizationHubState();
    }
}

/** @param {Partial<Record<string, unknown>>} patch */
export function saveMonetizationHubState(patch = {}) {
    const current = loadMonetizationHubState();
    const next = {
        ...current,
        ...patch,
        supportMethods: {
            ...current.supportMethods,
            ...(patch.supportMethods || {})
        },
        plans: {
            ...current.plans,
            ...(patch.plans || {})
        },
        updatedAt: Date.now(),
        version: MONETIZATION_HUB_VERSION
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem(MONETIZATION_HUB_STORAGE_KEY, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('reelforge:monetization-updated', { detail: next }));
    }
    logMonetizationDiag('MONETIZATION', {
        phase: 'state_saved',
        methodCount: Object.keys(next.supportMethods || {}).length
    });
    return next;
}

/** @param {Record<string, unknown>} [state] */
export function getEnabledDonationMethods(state = loadMonetizationHubState()) {
    return DONATION_METHOD_IDS.map((id) => ({
        id,
        ...(state.supportMethods?.[id] || {})
    })).filter((method) => method.enabled && String(method.url || '').trim());
}

/**
 * @param {string} methodId
 * @param {string} url
 * @param {Record<string, unknown>} [detail]
 */
export function trackDonationClick(methodId, url, detail = {}) {
    logMonetizationDiag('DONATION_CLICK', {
        methodId,
        url,
        ...detail
    });
}

/**
 * @param {string} planId
 * @param {Record<string, unknown>} [detail]
 */
export function viewPlan(planId, detail = {}) {
    const state = loadMonetizationHubState();
    const plan = state.plans?.[planId] || null;
    logMonetizationDiag('PLAN_VIEW', {
        planId,
        title: plan?.title || null,
        stage: plan?.stage || null,
        ...detail
    });
    return plan;
}

let monetizationHubInitialized = false;

export function initMonetizationHub() {
    if (typeof window === 'undefined' || monetizationHubInitialized) return null;
    monetizationHubInitialized = true;

    const state = loadMonetizationHubState();
    if (!localStorage.getItem(MONETIZATION_HUB_STORAGE_KEY)) {
        saveMonetizationHubState(state);
    }

    window.__reelforgeMonetizationHub = {
        MONETIZATION_HUB_VERSION,
        MONETIZATION_HUB_STORAGE_KEY,
        DONATION_METHOD_IDS,
        PLAN_IDS,
        getDefaultMonetizationHubState,
        loadMonetizationHubState,
        saveMonetizationHubState,
        getEnabledDonationMethods,
        trackDonationClick,
        viewPlan,
        logMonetizationDiag
    };

    logMonetizationDiag('MONETIZATION', {
        phase: 'engine_initialized',
        version: MONETIZATION_HUB_VERSION,
        plans: PLAN_IDS
    });

    return state;
}

