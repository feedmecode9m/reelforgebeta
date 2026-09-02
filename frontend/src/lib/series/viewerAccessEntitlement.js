import { currentUser, isAdminRole, isAuthenticatedSync } from '../auth/index.js';
import { fetchViewerProfile } from '../api/viewerAccount.js';
import { createCheckoutSession } from '../api/payments.js';
import { get } from 'svelte/store';

const TRUTHY = new Set([
    '1',
    'true',
    'yes',
    'active',
    'paid',
    'pro',
    'premium',
    'subscriber',
    // Stripe lifecycle states treated as entitled by desktop production paths.
    'trialing'
]);
const FALSY = new Set([
    '0',
    'false',
    'no',
    'inactive',
    'free',
    'none',
    'cancelled',
    'canceled',
    'expired',
    'incomplete',
    'incomplete_expired',
    'unpaid',
    'paused'
]);

/** Canonical local flags accepted from Stripe/webhook/session bridges. */
export const VIEWER_ENTITLEMENT_STORAGE_KEYS = Object.freeze([
    'reelforge_subscription_active',
    'reelforge_has_subscription',
    'reelforge_subscription_status',
    'reelforge_stripe_subscription_status',
    'reelforge_paid_access',
    'reelforge_entitlement_paid',
    'stripe_subscription_active',
    'stripe_subscription',
    'stripe_subscription_status',
    'stripe_status',
    'stripe_checkout_status',
    'stripe_customer_subscription_status',
    'subscription_active',
    'subscription_status',
    'subscription_state',
    'has_subscription',
    'has_paid_access'
]);

/** Canonical profile/settings paths for entitlement state. */
export const VIEWER_ENTITLEMENT_PROFILE_PATHS = Object.freeze([
    ['hasPaidAccess'],
    ['hasSubscription'],
    ['subscriptionActive'],
    ['subscriptionStatus'],
    ['subscriptionState'],
    ['stripeStatus'],
    ['subscription', 'active'],
    ['subscription', 'status'],
    ['subscription', 'state'],
    ['stripe', 'active'],
    ['stripe', 'status'],
    ['billing', 'hasPaidAccess'],
    ['billing', 'subscriptionActive'],
    ['billing', 'subscriptionState'],
    ['billing', 'subscriptionStatus'],
    ['billing', 'subscription', 'active'],
    ['billing', 'subscription', 'status'],
    ['billing', 'subscription', 'state'],
    ['stripe', 'subscriptionActive'],
    ['stripe', 'subscriptionStatus'],
    ['stripe', 'subscription', 'active'],
    ['stripe', 'subscription', 'status'],
    ['stripe', 'subscription', 'state'],
    ['settings', 'hasPaidAccess'],
    ['settings', 'hasSubscription'],
    ['settings', 'subscriptionActive'],
    ['settings', 'subscriptionStatus'],
    ['settings', 'subscriptionState'],
    ['settings', 'subscription', 'active'],
    ['settings', 'subscription', 'status'],
    ['settings', 'subscription', 'state'],
    ['settings', 'billing', 'hasPaidAccess'],
    ['settings', 'billing', 'subscriptionActive'],
    ['settings', 'billing', 'subscriptionStatus'],
    ['settings', 'billing', 'subscriptionState'],
    ['settings', 'billing', 'subscription', 'active'],
    ['settings', 'billing', 'subscription', 'status'],
    ['settings', 'billing', 'subscription', 'state'],
    ['settings', 'stripe', 'subscriptionActive'],
    ['settings', 'stripe', 'subscriptionStatus'],
    ['settings', 'stripe', 'subscription', 'active'],
    ['settings', 'stripe', 'subscription', 'status'],
    ['settings', 'stripe', 'subscription', 'state']
]);

/** Events that notify subscription entitlement changes in-app. */
export const VIEWER_ENTITLEMENT_EVENTS = Object.freeze([
    'reelforge:subscription-updated',
    'reelforge:monetization-updated',
    'reelforge:billing-updated',
    'reelforge:stripe-checkout-complete'
]);

/** Canonical Stripe/subscription checkout URL keys shared across surfaces. */
export const VIEWER_SUBSCRIPTION_URL_STORAGE_KEYS = Object.freeze([
    'reelforge_subscription_checkout_url',
    'reelforge_stripe_checkout_url',
    'stripe_checkout_url',
    'subscription_checkout_url',
    'subscription_url',
    'billing_checkout_url',
    'billing_portal_url'
]);

/** Canonical profile/settings URL paths for checkout/portal handoff. */
export const VIEWER_SUBSCRIPTION_URL_PROFILE_PATHS = Object.freeze([
    ['subscriptionCheckoutUrl'],
    ['subscriptionUrl'],
    ['billingPortalUrl'],
    ['stripeCheckoutUrl'],
    ['stripe', 'checkoutUrl'],
    ['stripe', 'subscription', 'checkoutUrl'],
    ['stripe', 'billingPortalUrl'],
    ['billing', 'checkoutUrl'],
    ['billing', 'subscriptionUrl'],
    ['billing', 'portalUrl'],
    ['settings', 'subscriptionCheckoutUrl'],
    ['settings', 'subscriptionUrl'],
    ['settings', 'billingPortalUrl'],
    ['settings', 'stripeCheckoutUrl'],
    ['settings', 'stripe', 'checkoutUrl'],
    ['settings', 'stripe', 'subscription', 'checkoutUrl'],
    ['settings', 'stripe', 'billingPortalUrl'],
    ['settings', 'billing', 'checkoutUrl'],
    ['settings', 'billing', 'subscriptionUrl'],
    ['settings', 'billing', 'portalUrl']
]);

let checkoutRedirectInFlight = false;
let lastCheckoutFailureReason = '';

export const VIEWER_CHECKOUT_FAILURE_REASONS = Object.freeze({
    UNAUTHENTICATED: 'unauthenticated',
    MISSING_EPISODE: 'missing_episode',
    PAYMENT_UNAVAILABLE: 'payment_unavailable'
});

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function parseBoolish(value) {
    if (value == null) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'object') {
        const objectFlag =
            parseBoolish(readPath(value, ['active'])) ??
            parseBoolish(readPath(value, ['entitled'])) ??
            parseBoolish(readPath(value, ['status'])) ??
            parseBoolish(readPath(value, ['state'])) ??
            parseBoolish(readPath(value, ['subscription', 'status'])) ??
            parseBoolish(readPath(value, ['subscription', 'state']));
        if (objectFlag != null) return objectFlag;
    }
    const raw = String(value).trim().toLowerCase();
    if (!raw) return null;
    if (TRUTHY.has(raw)) return true;
    if (FALSY.has(raw)) return false;
    return null;
}

function syncStripeEntitlementFromUrl() {
    if (typeof window === 'undefined') return;
    try {
        const params = new URLSearchParams(window.location.search || '');
        if (!params.size) return;
        const stripeStatus =
            params.get('subscription_status') ||
            params.get('subscriptionStatus') ||
            params.get('stripe_status') ||
            params.get('stripeStatus') ||
            params.get('checkout_status') ||
            params.get('checkoutStatus') ||
            '';
        const checkoutStatus =
            params.get('checkout_status') ||
            params.get('checkoutStatus') ||
            params.get('session_status') ||
            params.get('sessionStatus') ||
            '';
        const explicitSuccess =
            params.get('checkout') === 'success' ||
            params.get('payment') === 'success' ||
            /^(complete|completed|success|succeeded|paid)$/i.test(String(checkoutStatus || '').trim());
        // Never grant paid entitlement from session_id presence alone.
        const resolved = parseBoolish(stripeStatus) ?? (explicitSuccess ? true : null);
        if (resolved == null) return;
        localStorage.setItem('stripe_subscription_active', resolved ? 'true' : 'false');
        if (stripeStatus) localStorage.setItem('stripe_subscription_status', String(stripeStatus));
    } catch {
        /* ignore */
    }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUrlish(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    return '';
}

/**
 * @param {unknown} obj
 * @param {readonly string[]} path
 * @returns {unknown}
 */
function readPath(obj, path) {
    let current = obj;
    for (const key of path) {
        if (!current || typeof current !== 'object') return undefined;
        current = /** @type {Record<string, unknown>} */ (current)[key];
    }
    return current;
}

/**
 * @param {Record<string, unknown> | null | undefined} payload
 * @returns {boolean | null}
 */
function extractPaidFlag(payload) {
    if (!payload || typeof payload !== 'object') return null;
    for (const path of VIEWER_ENTITLEMENT_PROFILE_PATHS) {
        const parsed = parseBoolish(readPath(payload, path));
        if (parsed != null) return parsed;
    }
    const directAliases =
        parseBoolish(payload.entitled) ??
        parseBoolish(payload.isSubscriber) ??
        parseBoolish(payload.paid) ??
        parseBoolish(payload.planStatus) ??
        parseBoolish(payload.plan_status);
    if (directAliases != null) return directAliases;
    return null;
}

/**
 * Returns whether viewer has paid entitlement.
 * Priority: admin role -> backend profile/settings signal -> false.
 *
 * @returns {Promise<boolean>}
 */
export async function resolveViewerPaidAccessEntitlement() {
    let authenticatedViewer = false;
    try {
        const viewer = /** @type {{ role?: string } | null} */ (get(currentUser));
        const currentRole = String(viewer?.role || '').trim().toLowerCase();
        authenticatedViewer = Boolean(
            (viewer && (String(viewer.id || '').trim() || String(viewer.email || '').trim())) ||
            isAuthenticatedSync()
        );
        if (isAdminRole(currentRole)) return true;
    } catch {
        /* ignore */
    }

    try {
        const profile = await fetchViewerProfile();
        const profileFlag = extractPaidFlag(profile);
        if (profileFlag != null) return profileFlag;
    } catch {
        /* network/profile failures should not crash gating */
    }

    // Production parity guard: anonymous sessions cannot self-grant paid entitlement
    // from stale local flags. Desktop and mobile both remain locked until account truth.
    if (!authenticatedViewer) return false;

    // Stripe webhooks + backend profile are authoritative for paid access.
    // Keep URL sync bridge for compatibility, but do not grant entitlement
    // directly from localStorage/user-controlled query params.
    if (typeof window !== 'undefined') syncStripeEntitlementFromUrl();
    return false;
}

/**
 * Resolve canonical Stripe/subscription checkout URL used by viewer lock CTAs.
 * Priority: URL query params -> localStorage aliases -> viewer profile/settings -> env.
 * @returns {Promise<string>}
 */
export async function resolveViewerSubscriptionUrl() {
    // Production hardening: checkout initiation is backend-authoritative.
    // Keep a non-empty value so existing UI renders the CTA.
    return '/api/payments/checkout';
}

/**
 * Open Stripe/subscription checkout for locked episodes.
 * @param {{ source?: string; episodeId?: string; episodeNumber?: number; mode?: string; price?: string }} [context]
 */
export async function openViewerSubscriptionCheckout(context = {}) {
    if (typeof window === 'undefined') return false;
    if (checkoutRedirectInFlight) return true;
    const episodeId = String(context.episodeId || '').trim();
    const reelId = String(context.reelId || '').trim();
    const accessMode = String(context.mode || '').trim();
    if (!isAuthenticatedSync()) {
        lastCheckoutFailureReason = VIEWER_CHECKOUT_FAILURE_REASONS.UNAUTHENTICATED;
        return false;
    }
    if (!episodeId) {
        lastCheckoutFailureReason = VIEWER_CHECKOUT_FAILURE_REASONS.MISSING_EPISODE;
        return false;
    }
    lastCheckoutFailureReason = '';
    checkoutRedirectInFlight = true;
    try {
        const checkout = await createCheckoutSession({
            episodeId,
            reelId: reelId || undefined,
            accessMode: accessMode || undefined
        });
        if (checkout.checkoutUrl) {
            window.location.assign(checkout.checkoutUrl);
            return true;
        }
        lastCheckoutFailureReason = VIEWER_CHECKOUT_FAILURE_REASONS.PAYMENT_UNAVAILABLE;
        checkoutRedirectInFlight = false;
        return false;
    } catch (err) {
        const status = Number(err?.status || 0);
        const code = String(err?.body?.error || '').trim().toLowerCase();
        if (
            status === 401 ||
            code === 'unauthorized' ||
            code === 'user_session_required' ||
            code === 'invalid_session' ||
            code === 'missing_authorization'
        ) {
            lastCheckoutFailureReason = VIEWER_CHECKOUT_FAILURE_REASONS.UNAUTHENTICATED;
        } else if (status === 400 && code === 'invalid_product') {
            lastCheckoutFailureReason = VIEWER_CHECKOUT_FAILURE_REASONS.MISSING_EPISODE;
        } else {
            lastCheckoutFailureReason = VIEWER_CHECKOUT_FAILURE_REASONS.PAYMENT_UNAVAILABLE;
        }
        checkoutRedirectInFlight = false;
        return false;
    }
}

export function consumeViewerCheckoutFailureReason() {
    const reason = String(lastCheckoutFailureReason || '').trim();
    lastCheckoutFailureReason = '';
    return reason;
}

/**
 * Broadcast canonical entitlement updates (Stripe webhook/session bridge can use this).
 * @param {Record<string, unknown>} detail
 */
export function dispatchViewerEntitlementUpdated(detail = {}) {
    if (typeof window === 'undefined') return;
    try {
        window.dispatchEvent(
            new CustomEvent('reelforge:subscription-updated', {
                detail: {
                    ...detail,
                    at: Date.now()
                }
            })
        );
    } catch {
        /* ignore */
    }
}

/**
 * @param {(hasEntitlement: boolean) => void} onChange
 * @returns {() => void}
 */
export function subscribeViewerPaidAccessEntitlement(onChange) {
    let stopped = false;

    const sync = () => {
        resolveViewerPaidAccessEntitlement()
            .then((value) => {
                if (!stopped) onChange(Boolean(value));
            })
            .catch(() => {
                if (!stopped) onChange(false);
            });
    };

    const unsubUser =
        currentUser && typeof currentUser.subscribe === 'function'
            ? currentUser.subscribe(() => sync())
            : () => {};

    const onStorage = () => sync();
    const onSubscriptionEvent = () => sync();

    if (typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
        for (const eventName of VIEWER_ENTITLEMENT_EVENTS) {
            window.addEventListener(eventName, onSubscriptionEvent);
        }
    }

    sync();

    return () => {
        stopped = true;
        unsubUser();
        if (typeof window !== 'undefined') {
            window.removeEventListener('storage', onStorage);
            for (const eventName of VIEWER_ENTITLEMENT_EVENTS) {
                window.removeEventListener(eventName, onSubscriptionEvent);
            }
        }
    };
}
