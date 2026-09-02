#!/usr/bin/env node
import { chromium } from 'playwright';
import fs from 'node:fs';

const FRONTEND_BASE = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5173';
const API_BASE = process.env.API_BASE_URL || 'http://127.0.0.1:8080';

function ok(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
    process.stdout.write(`  ok: ${message}\n`);
}

async function jsonFetch(path, init = {}) {
    const response = await fetch(`${API_BASE}${path}`, init);
    const body = await response.json().catch(() => ({}));
    return { response, body };
}

async function createViewerSession() {
    const email = `stripe-e2e-viewer-context-${Date.now()}@reelforge.local`;
    const password = 'ViewerTest!2026';
    const { response, body } = await jsonFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    ok(response.status === 201 && body?.success === true, 'AUTH-1 register creates viewer test account');
    ok(String(body?.user?.role || '').toLowerCase() === 'viewer', 'test account role is viewer');
    ok(Boolean(body?.user?.id), 'test account has real user id');
    ok(String(body?.token || '').startsWith('rf_u_'), 'register returns AUTH-1 session token');
    return { email, password, token: String(body.token), userId: String(body.user.id) };
}

async function findPaidEpisodeId(token) {
    const envEpisodeId = String(process.env.STRIPE_TEST_EPISODE_ID || '').trim();
    if (envEpisodeId) {
        return envEpisodeId;
    }
    const tmpEpisodePath = '/tmp/stripe_test_episode_id.txt';
    if (fs.existsSync(tmpEpisodePath)) {
        const fileEpisodeId = String(fs.readFileSync(tmpEpisodePath, 'utf8') || '').trim();
        if (fileEpisodeId) {
            return fileEpisodeId;
        }
    }

    const { response, body } = await jsonFetch('/api/series', {
        headers: { Authorization: `Bearer ${token}` }
    });
    ok(response.ok && Array.isArray(body), 'series catalog is readable for viewer');
    const candidates = [];
    for (const series of body) {
        for (const season of series?.seasons || []) {
            for (const episode of season?.episodes || []) {
                const id = String(episode?.episodeId || episode?.id || '').trim();
                if (!id) continue;
                candidates.push(id);
            }
        }
    }
    ok(candidates.length > 0, 'series catalog exposes at least one episode id');

    for (const episodeId of candidates) {
        const checkout = await jsonFetch('/api/payments/checkout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ episodeId, accessMode: 'subscription' })
        });
        if (checkout.response.status === 200 && checkout.body?.ok === true) {
            return episodeId;
        }
    }
    throw new Error('Could not find a paid episode that produces checkout 200 in this local dataset');
}

async function runBrowserAssertions({ email, password, paidEpisodeId }) {
    const browser = await chromium.launch({ headless: true });
    const runScenario = async (handler, args) => {
        const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
        await page.goto(FRONTEND_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const result = await page.evaluate(handler, args);
        await page.close();
        return result;
    };

    const valid = await runScenario(
        async ({ email, password, paidEpisodeId }) => {
            localStorage.removeItem('reelforge_auth_token');
            localStorage.removeItem('reelforge_admin_session_token');
            const auth = await import('/src/lib/auth/index.js');
            const entitlement = await import('/src/lib/series/viewerAccessEntitlement.js');
            const login = await auth.login({ email, password });

            const checkoutCalls = [];
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init = {}) => {
                const url = typeof input === 'string' ? input : input?.url || '';
                const method = String(init?.method || 'GET').toUpperCase();
                const body = typeof init?.body === 'string' ? init.body : '';
                const response = await originalFetch(input, init);
                if (String(url).includes('/api/payments/checkout')) {
                    let parsed = {};
                    try {
                        parsed = await response.clone().json();
                    } catch {
                        parsed = {};
                    }
                    checkoutCalls.push({ url: String(url), method, status: response.status, body, parsed });
                }
                return response;
            };

            const opened = await entitlement.openViewerSubscriptionCheckout({
                episodeId: paidEpisodeId,
                mode: 'subscription'
            });

            return {
                loginOk: login?.ok === true,
                authenticated: auth.isAuthenticatedSync(),
                authTokenPresent: Boolean(localStorage.getItem('reelforge_auth_token')),
                adminTokenPresent: Boolean(localStorage.getItem('reelforge_admin_session_token')),
                opened,
                checkoutCalls
            };
        },
        { email, password, paidEpisodeId }
    );

    ok(valid.loginOk, 'viewer can login in browser runtime');
    ok(valid.authenticated, 'browser auth state is authenticated at checkout time');
    ok(valid.authTokenPresent, 'browser has reelforge_auth_token');
    ok(!valid.adminTokenPresent, 'browser does not rely on admin session token');
    ok(valid.opened === true, 'valid episode checkout path opens Stripe flow');
    ok(valid.checkoutCalls.length >= 1, 'checkout request is emitted for valid locked episode');
    ok(valid.checkoutCalls[0].method === 'POST', 'checkout request method is POST');
    ok(valid.checkoutCalls[0].status === 200, 'checkout request returns HTTP 200 with valid episode');
    const requestBody = JSON.parse(valid.checkoutCalls[0].body || '{}');
    ok(
        String(requestBody?.episodeId || '').trim() === paidEpisodeId,
        'checkout request body includes the locked episode id'
    );

    const missingEpisode = await runScenario(
        async ({ email, password }) => {
            localStorage.removeItem('reelforge_auth_token');
            localStorage.removeItem('reelforge_admin_session_token');
            const auth = await import('/src/lib/auth/index.js');
            const entitlement = await import('/src/lib/series/viewerAccessEntitlement.js');
            await auth.login({ email, password });

            const opened = await entitlement.openViewerSubscriptionCheckout({ mode: 'subscription' });
            const reason = entitlement.consumeViewerCheckoutFailureReason();
            return { opened, reason, authenticated: auth.isAuthenticatedSync() };
        },
        { email, password }
    );

    ok(missingEpisode.authenticated === true, 'authenticated viewer remains authenticated in missing-context case');
    ok(missingEpisode.opened === false, 'missing episode context fails safely');
    ok(
        missingEpisode.reason === 'missing_episode',
        'missing episode context maps to missing_episode (not sign-in guidance)'
    );

    const unauthenticated = await runScenario(
        async ({ paidEpisodeId }) => {
            localStorage.removeItem('reelforge_auth_token');
            localStorage.removeItem('reelforge_admin_session_token');
            const auth = await import('/src/lib/auth/index.js');
            const entitlement = await import('/src/lib/series/viewerAccessEntitlement.js');
            await auth.refreshSession();
            const opened = await entitlement.openViewerSubscriptionCheckout({
                episodeId: paidEpisodeId,
                mode: 'subscription'
            });
            const reason = entitlement.consumeViewerCheckoutFailureReason();
            return { opened, reason, authenticated: auth.isAuthenticatedSync() };
        },
        { paidEpisodeId }
    );

    ok(unauthenticated.authenticated === false, 'unauthenticated scenario has no AUTH-1 session');
    ok(unauthenticated.opened === false, 'unauthenticated checkout path is blocked');
    ok(
        unauthenticated.reason === 'unauthenticated',
        'unauthenticated checkout maps to sign-in guidance reason'
    );

    await browser.close();
}

async function main() {
    const viewer = await createViewerSession();
    const paidEpisodeId = await findPaidEpisodeId(viewer.token);
    ok(Boolean(paidEpisodeId), 'found a paid episode id for checkout validation');
    await runBrowserAssertions({ email: viewer.email, password: viewer.password, paidEpisodeId });
    process.stdout.write('PASS validate-stripe-checkout-episode-context\n');
}

main().catch((err) => {
    process.stderr.write(`FAIL validate-stripe-checkout-episode-context: ${err?.message || err}\n`);
    process.exit(1);
});
