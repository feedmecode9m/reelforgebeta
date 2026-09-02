#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname, '..');

function read(rel) {
    return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function ok(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
    process.stdout.write(`  ok: ${message}\n`);
}

const paymentsApi = read('backend/src/api/payments_api.rs');
const paymentsDb = read('backend/src/db/payments.rs');
const auth = read('backend/src/auth.rs');
const viewerAccountApi = read('backend/src/api/viewer_account.rs');
const migration = read('backend/migrations/2026090201_payments_stripe_restoration.sql');
const entitlement = read('frontend/src/lib/series/viewerAccessEntitlement.js');

ok(
    auth.includes('"/api/payments/checkout"') && paymentsApi.includes('"unauthorized"'),
    'unauthenticated checkout is rejected by auth path + handler'
);
ok(
    paymentsApi.includes('pub async fn payments_status(') &&
        paymentsApi.includes('let user_id = match principal.user_id'),
    'payments status endpoint requires authenticated user session'
);
ok(
    paymentsApi.includes('create_stripe_checkout_session(') &&
        paymentsApi.includes('https://api.stripe.com/v1/checkout/sessions'),
    'valid checkout path creates Stripe Checkout session server-side'
);
ok(
    paymentsApi.includes('"invalid_product"') && paymentsApi.includes('"invalid_price"'),
    'invalid product/price paths are explicitly rejected'
);
ok(
    paymentsApi.includes('client_amount_ignored') &&
        !paymentsApi.includes('amount_cents).unwrap_or') &&
        paymentsApi.includes('resolve_price_from_server'),
    'client supplied amount cannot override server-selected pricing'
);
ok(
    paymentsApi.includes('verify_webhook_signature(') &&
        paymentsApi.includes('"invalid_webhook_signature"'),
    'invalid webhook signature is rejected'
);
ok(
    paymentsApi.includes('HttpResponse::Ok().json(json!({ "ok": true }))'),
    'valid webhook returns acceptance response'
);
ok(
    migration.includes('payment_webhook_events') &&
        paymentsDb.includes('pub async fn begin_webhook_event(') &&
        paymentsDb.includes("WHERE stripe_event_id = $1\n          AND status = 'failed'") &&
        paymentsApi.includes('"duplicate": true'),
    'duplicate and failed webhook deliveries are idempotent/retry-safe'
);
ok(
    paymentsDb.includes('update_checkout_state') &&
        paymentsDb.includes('set_user_paid_entitlement') &&
        paymentsApi.includes('process_checkout_event'),
    'payment state transitions persist checkout status and entitlement'
);
ok(
    paymentsApi.includes('checkout.session.expired') &&
        paymentsApi.includes('invoice.payment_failed'),
    'failed/expired checkout lifecycle is handled'
);
ok(
    entitlement.includes('checkoutRedirectInFlight') &&
        entitlement.includes('VIEWER_CHECKOUT_FAILURE_REASONS') &&
        entitlement.includes('if (!isAuthenticatedSync()) {') &&
        entitlement.includes('if (!episodeId) {') &&
        !entitlement.includes('window.location.assign(url);'),
    'frontend checkout requires auth + episode context with no client URL fallback'
);
ok(
    viewerAccountApi.includes('PROTECTED_SETTINGS_KEYS') &&
        viewerAccountApi.includes('sanitize_user_settings_patch'),
    'viewer profile updates cannot override server-managed billing entitlement fields'
);
ok(
    paymentsApi.includes('normalize_subscription_active') &&
        paymentsApi.includes('"active" | "trialing"'),
    'subscription access activation is limited to active/trialing statuses'
);

process.stdout.write('PASS validate-stripe-payments-restoration\n');
