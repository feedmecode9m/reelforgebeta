#!/usr/bin/env node
/**
 * Studio entry auth boundary — consumer session vs Studio password session independence.
 *
 * Scenario A: valid Studio token + stale consumer token → reload preserves Studio affordance
 * Scenario B: hover/click never invokes auth; no controlCenterOpen && !adminMode
 * Scenario C: AUTH_SESSION_EXPIRED closes overlay without unrelated consumer destruction
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FRONTEND = process.env.REELFORGE_URL || 'http://127.0.0.1:5173';
const BACKEND = process.env.REELFORGE_BACKEND_URL || 'http://127.0.0.1:8080';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Gaff1505!';

const ADMIN_KEY = 'reelforge_admin_session_token';
const AUTH_KEY = 'reelforge_auth_token';

const failures = [];
function assert(cond, msg) {
    if (!cond) failures.push(msg);
    else console.log(`  ok: ${msg}`);
}

const bag = new Map();
globalThis.localStorage = {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(String(k), String(v)),
    removeItem: (k) => bag.delete(k),
    clear: () => bag.clear()
};
globalThis.window = {
    localStorage: globalThis.localStorage,
    location: { hostname: '127.0.0.1', href: `${FRONTEND}/` },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};

/** @param {unknown} body @param {number} status */
function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

console.log('\n[Scenario A — mock] consumer /me failure preserves Studio password session');
const server = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
});

try {
    const authStore = await server.ssrLoadModule('/src/lib/auth/authStore.js');
    const adminSession = await server.ssrLoadModule('/src/lib/adminSession.js');

    bag.clear();
    bag.set(AUTH_KEY, 'stale-consumer-token');
    bag.set(ADMIN_KEY, 'valid-studio-password-token');

    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
        const href = String(url);
        if (href.includes('/api/auth/me')) {
            return jsonResponse({ error: 'invalid_session' }, 401);
        }
        if (typeof nativeFetch === 'function') {
            return nativeFetch(url, options);
        }
        return jsonResponse({ error: 'unexpected' }, 404);
    };

    const result = await authStore.refreshSession();
    assert(result.ok === false, 'consumer refresh reports failure');
    assert(!bag.has(AUTH_KEY), 'stale consumer token cleared');
    assert(bag.get(ADMIN_KEY) === 'valid-studio-password-token', 'Studio admin token preserved after consumer /me failure');
    assert(adminSession.hasStudioAdminSessionToken(), 'hasStudioAdminSessionToken true after consumer failure');
    assert(authStore.canAccessStudio(), 'canAccessStudio true with preserved Studio token');

    globalThis.fetch = nativeFetch;

    console.log('\n[Scenario A — browser] reload with stale consumer + live Studio token');
    const playwrightShellPath =
        '/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell';
    /** @type {import('playwright').LaunchOptions} */
    const browserLaunchOptions = { headless: true };
    if (existsSync(playwrightShellPath)) {
        browserLaunchOptions.executablePath = playwrightShellPath;
    }

    let browser;
    try {
        browser = await chromium.launch(browserLaunchOptions);
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded', timeout: 120_000 });

        const studioTokenPrefix = await page.evaluate(async (pw) => {
            const res = await fetch('/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw })
            });
            if (!res.ok) return null;
            const body = await res.json();
            const t = String(body?.token || '').trim();
            if (!t || t === 'backend_token') return null;
            localStorage.setItem('reelforge_admin_session_token', t);
            return t.slice(0, 10);
        }, ADMIN_PASSWORD);

        if (!studioTokenPrefix) {
            console.log('  skip: live /admin/auth unavailable for browser Scenario A');
        } else {
            await page.evaluate(() => {
                localStorage.setItem('reelforge_auth_token', 'stale-consumer-token-probe');
            });
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
            await page.waitForTimeout(2500);

            const afterReload = await page.evaluate(() => ({
                ghost: document.querySelectorAll('.ghost-trigger').length,
                adminToken: Boolean(localStorage.getItem('reelforge_admin_session_token')),
                authToken: localStorage.getItem('reelforge_auth_token'),
                loginPath: location.pathname.startsWith('/login'),
                adminLoginPanel: Boolean(document.querySelector('.admin-login-panel')),
                studioUnlock: Boolean(document.querySelector('.studio-unlock'))
            }));

            assert(afterReload.adminToken, 'browser: Studio admin token survives reload');
            assert(!afterReload.authToken, 'browser: stale consumer token cleared on reload');
            assert(afterReload.ghost >= 1, 'browser: ghost trigger present after reload');
            assert(!afterReload.loginPath, 'browser: no redirect to consumer /login');
            assert(!afterReload.adminLoginPanel, 'browser: no in-overlay admin-login-panel after reload');

            await page.locator('.ghost-trigger').click();
            await page.waitForTimeout(700);

            const afterClick = await page.evaluate(() => ({
                overlay: Boolean(document.querySelector('.control-center-overlay')),
                adminLoginPanel: Boolean(document.querySelector('.admin-login-panel')),
                ghost: document.querySelectorAll('.ghost-trigger').length
            }));
            assert(afterClick.overlay, 'browser: click opens Studio overlay');
            assert(!afterClick.adminLoginPanel, 'browser: click does not land on admin-login-panel');
            assert(afterClick.ghost >= 1, 'browser: ghost remains after click');
        }

        console.log('\n[Scenario B] hover → leave → hover → click (no auth on hover)');
        await page.evaluate(async (pw) => {
            if (!localStorage.getItem('reelforge_admin_session_token')) {
                const res = await fetch('/admin/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pw })
                });
                const body = res.ok ? await res.json() : null;
                if (body?.token) localStorage.setItem('reelforge_admin_session_token', body.token);
            }
            localStorage.removeItem('reelforge_auth_token');
        }, ADMIN_PASSWORD);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForTimeout(1500);

        const authRequests = [];
        page.on('request', (req) => {
            const url = req.url();
            if (/\/admin\/auth|\/api\/auth\/(me|login)/.test(url)) {
                authRequests.push(url);
            }
        });

        const ghost = page.locator('.ghost-trigger');
        await ghost.waitFor({ state: 'attached', timeout: 30_000 });

        await ghost.hover();
        await page.waitForTimeout(250);
        await page.mouse.move(10, 10);
        await page.waitForTimeout(250);
        await ghost.hover();
        await page.waitForTimeout(250);

        const hoverAuthCount = authRequests.length;
        assert(hoverAuthCount === 0, 'hover sequence invokes no auth endpoints');

        await ghost.click();
        await page.waitForTimeout(600);

        const bState = await page.evaluate(() => ({
            overlay: Boolean(document.querySelector('.control-center-overlay')),
            adminLoginPanel: Boolean(document.querySelector('.admin-login-panel')),
            ghost: document.querySelectorAll('.ghost-trigger').length
        }));
        assert(bState.overlay, 'Scenario B: Studio opens on click');
        assert(!bState.adminLoginPanel, 'Scenario B: no admin-login-panel');
        assert(bState.ghost >= 1, 'Scenario B: ghost remains mounted');

        console.log('\n[Scenario C] AUTH_SESSION_EXPIRED while Studio open');
        await page.evaluate(() => {
            window.dispatchEvent(
                new CustomEvent('AUTH_SESSION_EXPIRED', { detail: { source: 'validate-studio-entry' } })
            );
        });
        await page.waitForTimeout(500);

        const cState = await page.evaluate(() => ({
            overlay: Boolean(document.querySelector('.control-center-overlay')),
            adminToken: Boolean(localStorage.getItem('reelforge_admin_session_token')),
            ghost: document.querySelectorAll('.ghost-trigger').length
        }));
        assert(!cState.overlay, 'Scenario C: overlay closes on AUTH_SESSION_EXPIRED');
        assert(cState.adminToken, 'Scenario C: Studio password token not cleared by AUTH_SESSION_EXPIRED alone');
        assert(cState.ghost >= 1, 'Scenario C: ghost remains when Studio token still valid');

        console.log('\n[Scenario D] studio authority lost while overlay open — no stuck main.blur');
        await page.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.evaluate(async (pw) => {
            const res = await fetch('/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw })
            });
            const body = res.ok ? await res.json() : null;
            if (body?.token) localStorage.setItem('reelforge_admin_session_token', body.token);
            localStorage.setItem('reelforge_auth_token', 'stale-consumer-stuck-probe');
        }, ADMIN_PASSWORD);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForTimeout(2000);

        await page.locator('.ghost-trigger').click();
        await page.waitForTimeout(600);
        const dOpen = await page.evaluate(() => ({
            overlay: Boolean(document.querySelector('.control-center-overlay')),
            mainBlur: document.querySelector('main')?.classList.contains('blur')
        }));
        assert(dOpen.overlay, 'Scenario D: overlay open before authority loss');

        await page.evaluate(async () => {
            const { clearAdminSession } = await import('/src/lib/adminSession.js');
            clearAdminSession({ source: 'validate-studio-entry-d' });
        });
        await page.waitForTimeout(500);

        const dStuck = await page.evaluate(() => {
            const signIn = document.querySelector('.consumer-header__sign-in');
            const main = document.querySelector('main');
            return {
                overlay: Boolean(document.querySelector('.control-center-overlay')),
                mainBlur: main?.classList.contains('blur'),
                signInPe: signIn ? getComputedStyle(signIn).pointerEvents : null,
                ghostDisabled: document.querySelector('.ghost-trigger')?.disabled ?? null,
                studioToken: Boolean(localStorage.getItem('reelforge_admin_session_token'))
            };
        });
        assert(!dStuck.overlay, 'Scenario D: overlay closes when Studio authority lost');
        assert(!dStuck.mainBlur, 'Scenario D: main.blur cleared — no invisible interaction lock');
        assert(dStuck.signInPe === 'auto', 'Scenario D: Sign In pointer-events restored');
        assert(!dStuck.studioToken, 'Scenario D: Studio token cleared for probe');

        await page.locator('.consumer-header__sign-in').click();
        await page.waitForTimeout(400);
        const dSignInPath = await page.evaluate(() => location.pathname);
        assert(dSignInPath.startsWith('/login'), 'Scenario D: Sign In navigates after stuck-state prevention');

        console.log('\n[Scenario D2] hydrating ghost disabled during in-session consumer refresh');
        await page.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.evaluate(() => {
            localStorage.removeItem('reelforge_admin_session_token');
            localStorage.setItem('reelforge_auth_token', 'consumer-hydrate-only');
        });

        let releaseMe;
        const meGate = new Promise((resolve) => {
            releaseMe = resolve;
        });
        await page.route('**/api/auth/me', async (route) => {
            await meGate;
            await route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'invalid_session' })
            });
        });

        await page.evaluate(() => {
            window.__rfRefreshPending = import('/src/lib/auth/index.js').then((m) => m.refreshSession());
        });
        await page.waitForTimeout(350);

        const d2Hydrate = await page.evaluate(() => ({
            ghost: document.querySelectorAll('.ghost-trigger').length,
            ghostDisabled: document.querySelector('.ghost-trigger')?.disabled ?? null,
            overlay: Boolean(document.querySelector('.control-center-overlay')),
            studioShell: Boolean(document.querySelector('[data-studio-theme-shell]'))
        }));
        assert(d2Hydrate.ghost >= 1, 'Scenario D2: affordance visible during consumer hydrate');
        assert(d2Hydrate.ghostDisabled === true, 'Scenario D2: ghost disabled until authority known');
        assert(!d2Hydrate.overlay, 'Scenario D2: no overlay mounted during hydrate-only');
        assert(!d2Hydrate.studioShell, 'Scenario D2: StudioExperience not mounted without authority');

        await page.locator('.ghost-trigger').click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
        const d2AfterTap = await page.evaluate(() => ({
            overlay: Boolean(document.querySelector('.control-center-overlay')),
            mainBlur: document.querySelector('main')?.classList.contains('blur')
        }));
        assert(!d2AfterTap.overlay, 'Scenario D2: hydrate-only tap does not open overlay');
        assert(!d2AfterTap.mainBlur, 'Scenario D2: hydrate-only tap does not lock main');

        releaseMe();
        await page.evaluate(async () => {
            await window.__rfRefreshPending;
        });
        await page.unroute('**/api/auth/me');
        await page.waitForTimeout(500);
    } finally {
        await browser?.close().catch(() => {});
    }
} finally {
    await server.close();
}

if (failures.length) {
    console.error('\nFAIL validate-studio-entry-auth-boundary');
    for (const msg of failures) console.error(`  ✗ ${msg}`);
    process.exit(1);
}

console.log('\nPASS validate-studio-entry-auth-boundary');
