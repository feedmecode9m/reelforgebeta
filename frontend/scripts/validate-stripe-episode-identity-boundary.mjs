#!/usr/bin/env node

const API_BASE = process.env.API_BASE_URL || 'http://127.0.0.1:8080';
const TEST_PASSWORD = process.env.STRIPE_VIEWER_PASSWORD || 'ViewerTest!2026';
const TEST_EMAIL = process.env.STRIPE_VIEWER_EMAIL || 'stripe-e2e-viewer-1788317005@reelforge.local';
const SEMANTIC_EPISODE_ID =
    process.env.STRIPE_TEST_SEMANTIC_EPISODE_ID || 'ep-03-club-poom-poom-s01e01-v1';
const MEDIA_ASSET_ID =
    process.env.STRIPE_TEST_MEDIA_ASSET_ID || 'cadfcabc-1947-4341-86a3-f82a08e78669';

function ok(condition, message) {
    if (!condition) throw new Error(message);
    process.stdout.write(`  ok: ${message}\n`);
}

async function api(path, init = {}) {
    const response = await fetch(`${API_BASE}${path}`, init);
    const body = await response.json().catch(() => ({}));
    return { response, body };
}

function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value || '').trim()
    );
}

async function createViewerSession() {
    const login = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
    });
    if (login.response.status === 200 && login.body?.success === true) {
        ok(String(login.body?.user?.role || '').toLowerCase() === 'viewer', 'viewer login role is viewer');
        ok(Boolean(login.body?.user?.id), 'viewer login returns canonical user id');
        ok(String(login.body?.token || '').startsWith('rf_u_'), 'viewer login returns AUTH-1 token');
        return String(login.body.token);
    }

    const email = `stripe-e2e-identity-${Date.now()}@reelforge.local`;
    const register = await api('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: TEST_PASSWORD })
    });
    ok(register.response.status === 201 && register.body?.success === true, 'viewer register succeeds');
    ok(String(register.body?.user?.role || '').toLowerCase() === 'viewer', 'viewer register role is viewer');
    ok(Boolean(register.body?.user?.id), 'viewer register returns canonical user id');
    ok(String(register.body?.token || '').startsWith('rf_u_'), 'viewer register returns AUTH-1 token');
    return String(register.body.token);
}

async function main() {
    const token = await createViewerSession();
    const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
    };

    // Primary regression: semantic episode id + media asset id resolves to canonical studio episode id.
    const resolved = await api('/api/payments/checkout', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            episodeId: SEMANTIC_EPISODE_ID,
            reelId: MEDIA_ASSET_ID,
            accessMode: 'paid'
        })
    });
    ok(resolved.response.status === 200, 'semantic + media identity checkout succeeds');
    ok(resolved.body?.ok === true, 'checkout response is ok=true');
    const canonicalEpisodeId = String(resolved.body?.product?.episodeId || '').trim();
    ok(isUuid(canonicalEpisodeId), 'checkout response includes canonical studio episode id');
    ok(
        canonicalEpisodeId !== SEMANTIC_EPISODE_ID,
        'canonical studio episode id differs from semantic frontend episode id'
    );
    ok(
        canonicalEpisodeId !== MEDIA_ASSET_ID,
        'canonical studio episode id differs from media asset id'
    );
    ok(
        String(resolved.body?.product?.requestedEpisodeId || '').trim() === SEMANTIC_EPISODE_ID,
        'checkout response preserves requested semantic episode id for traceability'
    );
    ok(
        Boolean(String(resolved.body?.checkout?.checkoutUrl || '').trim()),
        'checkout response includes Stripe hosted checkout URL'
    );

    // Canonical identity stays stable as a first-class checkout input.
    const canonicalRoundTrip = await api('/api/payments/checkout', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            episodeId: canonicalEpisodeId,
            accessMode: 'paid'
        })
    });
    ok(canonicalRoundTrip.response.status === 200, 'canonical studio episode id checkout succeeds');
    ok(
        String(canonicalRoundTrip.body?.product?.episodeId || '').trim() === canonicalEpisodeId,
        'canonical checkout preserves canonical studio episode id'
    );

    // Guardrail: media asset id alone is not accepted as payment product identity.
    const mediaAsProduct = await api('/api/payments/checkout', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            episodeId: MEDIA_ASSET_ID,
            accessMode: 'paid'
        })
    });
    ok(mediaAsProduct.response.status === 400, 'media asset id alone is rejected as invalid product');
    ok(mediaAsProduct.body?.error === 'invalid_product', 'media asset id rejection uses invalid_product');

    // Guardrail: unknown semantic id still fails closed.
    const unknown = await api('/api/payments/checkout', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
            episodeId: `ep-unknown-${Date.now()}`,
            accessMode: 'paid'
        })
    });
    ok(unknown.response.status === 400, 'unknown semantic episode id still fails closed');
    ok(unknown.body?.error === 'invalid_product', 'unknown semantic rejection uses invalid_product');

    process.stdout.write('PASS validate-stripe-episode-identity-boundary\n');
}

main().catch((err) => {
    process.stderr.write(`FAIL validate-stripe-episode-identity-boundary: ${err?.message || err}\n`);
    process.exit(1);
});
