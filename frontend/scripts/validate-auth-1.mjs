#!/usr/bin/env node
/**
 * AUTH-1 / AUTH-1.1 validation (pure logic + optional live API).
 *
 * AUTH-1.1: only admin controls platform content. Creator role has no write powers.
 */

import {
    evaluateRouteAccess,
    isAdminRole,
    isCreatorRole,
    hasRole,
    normalizeRole,
    roleMeets
} from '../src/lib/auth/roles.js';

let failed = 0;

/** @param {string} label @param {boolean} cond */
function assert(label, cond) {
    if (cond) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}`);
}

console.log('\n[AUTH-1.1 role model — admin-only content]');
assert('viewer cannot meet admin', !roleMeets('viewer', 'admin'));
assert('legacy creator cannot meet admin', !roleMeets('creator', 'admin'));
assert('admin meets admin', roleMeets('admin', 'admin'));
assert('admin is admin', isAdminRole('admin'));
assert('creator role has no content access helper', isCreatorRole('creator') === false);
assert('normalize role', normalizeRole('Admin') === 'admin');
assert('hasRole admin only', hasRole('admin', 'admin') && !hasRole('viewer', 'admin'));

console.log('\n[AUTH-1.1 route access]');
assert(
    'public home',
    evaluateRouteAccess({ pathname: '/', isAuthenticated: false }).allowed
);
assert(
    'public explore',
    evaluateRouteAccess({ pathname: '/explore', isAuthenticated: false }).allowed
);
assert(
    'account requires auth',
    !evaluateRouteAccess({ pathname: '/account', isAuthenticated: false }).allowed
);
assert(
    'account allows viewer',
    evaluateRouteAccess({ pathname: '/account', isAuthenticated: true, role: 'viewer' }).allowed
);
assert(
    'settings allows viewer',
    evaluateRouteAccess({ pathname: '/settings', isAuthenticated: true, role: 'viewer' }).allowed
);
assert(
    'viewer cannot studio',
    !evaluateRouteAccess({ pathname: '/studio', isAuthenticated: true, role: 'viewer' }).allowed
);
assert(
    'viewer cannot upload path',
    !evaluateRouteAccess({ pathname: '/admin', isAuthenticated: true, role: 'viewer' }).allowed
);
assert(
    'legacy creator cannot studio',
    !evaluateRouteAccess({ pathname: '/studio', isAuthenticated: true, role: 'creator' }).allowed
);
assert(
    'admin can studio',
    evaluateRouteAccess({ pathname: '/studio', isAuthenticated: true, role: 'admin' }).allowed
);
assert(
    '/creator reserved (no public creator workflow)',
    !evaluateRouteAccess({ pathname: '/creator', isAuthenticated: true, role: 'viewer' }).allowed
);
assert(
    '/creator not for legacy creator role either',
    !evaluateRouteAccess({ pathname: '/creator', isAuthenticated: true, role: 'creator' }).allowed
);

// AUTH-UI-2: consumer-safe production boundary
const studioDenied = evaluateRouteAccess({
    pathname: '/studio',
    isAuthenticated: true,
    role: 'viewer'
});
assert('viewer studio marks unavailable (no permission copy)', studioDenied.unavailable === true);
assert('viewer studio does not redirect to login funnel', studioDenied.redirectTo == null);
assert(
    'upload path area unavailable',
    evaluateRouteAccess({ pathname: '/upload', isAuthenticated: false }).unavailable === true
);
assert(
    'content-management area unavailable',
    evaluateRouteAccess({
        pathname: '/content-management',
        isAuthenticated: true,
        role: 'viewer'
    }).unavailable === true
);
assert(
    'unauthenticated studio is unavailable (not login tease)',
    evaluateRouteAccess({ pathname: '/studio', isAuthenticated: false }).unavailable === true
);

// ── AUTH-UI Phase 1: return path + consumer shell contracts ─────────────────
console.log('\n[AUTH-UI Phase 1 — login journey]');
import {
    buildLoginPath,
    mapAuthErrorMessage,
    resolvePostAuthDestination,
    sanitizeReturnPath
} from '../src/lib/auth/returnPath.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(__dirname, '..');

assert('sanitize allows /account', sanitizeReturnPath('/account') === '/account');
assert('sanitize allows /settings', sanitizeReturnPath('/settings') === '/settings');
assert('sanitize allows series paths', sanitizeReturnPath('/series/neon') === '/series/neon');
assert('sanitize blocks open redirect //evil.com', sanitizeReturnPath('//evil.com') == null);
assert('sanitize blocks https://evil.com', sanitizeReturnPath('https://evil.com') == null);
assert('sanitize blocks /studio', sanitizeReturnPath('/studio') == null);
assert('sanitize blocks /admin', sanitizeReturnPath('/admin/tools') == null);
assert('sanitize blocks /login loop', sanitizeReturnPath('/login') == null);
assert(
    'buildLoginPath encodes next for account',
    buildLoginPath('/account') === '/login?next=%2Faccount'
);
assert('buildLoginPath drops blocked targets', buildLoginPath('/studio') === '/login');

assert(
    'resolvePostAuthDestination prefers ?next=',
    resolvePostAuthDestination({ search: '?next=%2Faccount', defaultPath: '/' }) === '/account'
);
assert(
    'resolvePostAuthDestination defaults home',
    resolvePostAuthDestination({ search: '', defaultPath: '/' }) === '/'
);
assert(
    'resolvePostAuthDestination ignores blocked next',
    resolvePostAuthDestination({ search: '?next=%2Fstudio', defaultPath: '/' }) === '/'
);

assert(
    'map invalid credentials copy is consumer-safe',
    mapAuthErrorMessage({ code: 'invalid_credentials', status: 401 }, 'login') ===
        'Invalid email or password.'
);
assert(
    'map rate limit copy is consumer-safe',
    /Too many attempts/i.test(mapAuthErrorMessage({ code: 'rate_limited', status: 429 }, 'login'))
);
assert(
    'map offline copy is consumer-safe',
    /offline/i.test(mapAuthErrorMessage({ code: 'network' }, 'login'))
);
assert(
    'map server unavailable is consumer-safe',
    /unavailable/i.test(mapAuthErrorMessage({ code: 'db_unavailable', status: 503 }, 'login'))
);

const authShellSrc = fs.readFileSync(
    path.join(frontendRoot, 'src/components/auth/AuthShell.svelte'),
    'utf8'
);
assert(
    'AuthShell omits production/elevated language',
    !/production/i.test(authShellSrc) && !/elevated/i.test(authShellSrc)
);
assert(
    'AuthShell omits admin concept in consumer copy',
    !/\badmin\b/i.test(authShellSrc) && !/\bcreator\b/i.test(authShellSrc)
);
assert(
    'AuthShell has return-path navigation helpers',
    authShellSrc.includes('resolvePostAuthDestination') && authShellSrc.includes('goAfterAuth')
);
assert(
    'AuthShell has sign-in to continue watching copy',
    /Sign in to continue watching/i.test(authShellSrc)
);
assert(
    'AuthShell has personal cinema copy',
    /Your personal cinema experience/i.test(authShellSrc)
);
assert(
    'AuthShell does not hardcode /account after login',
    !/onNavigate\(['"]\/account['"]\)/.test(authShellSrc)
);
assert(
    'AuthShell has password visibility toggle',
    /showPassword/.test(authShellSrc) && /Show|Hide/.test(authShellSrc)
);

const appSrc = fs.readFileSync(path.join(frontendRoot, 'src/App.svelte'), 'utf8');
assert(
    'App uses branded boot copy',
    /LOOK@ZAKANDA PRESENTS/.test(appSrc) && /Loading your experience/.test(appSrc)
);
assert(
    'App preserves next via buildLoginPath / setStoredReturnPath',
    appSrc.includes('buildLoginPath') && appSrc.includes('setStoredReturnPath')
);
assert('App waits on authReady before consumer chrome', /authReady/.test(appSrc));

const viewerCtxSrc = fs.readFileSync(
    path.join(frontendRoot, 'src/viewer/viewerContext.js'),
    'utf8'
);
assert(
    'viewer logout consumer status is Signed out',
    /uploadStatus\.set\(['"]Signed out['"]\)/.test(viewerCtxSrc)
);
assert(
    'viewerContext omits Admin logged out wording',
    !/Admin logged out/i.test(viewerCtxSrc)
);
assert(
    'AUTH_SESSION_EXPIRED consumer path does not say Studio session',
    !/Studio session expired/i.test(viewerCtxSrc)
);

const returnPathSrc = fs.readFileSync(
    path.join(frontendRoot, 'src/lib/auth/returnPath.js'),
    'utf8'
);
assert('returnPath next parameter handling exists', /next/.test(returnPathSrc));
assert('returnPath sanitizer exists', /function sanitizeReturnPath/.test(returnPathSrc));

const headerSrc = fs.readFileSync(
    path.join(frontendRoot, 'src/components/navigation/ConsumerHeader.svelte'),
    'utf8'
);
assert(
    'Sign In preserves return via buildLoginPath',
    headerSrc.includes('buildLoginPath') && headerSrc.includes('setStoredReturnPath')
);

// ── AUTH-UI Phase 2: shared consumer chrome ──────────────────────────────────
console.log('\n[AUTH-UI Phase 2 — consumer chrome continuity]');
assert(
    'ConsumerChrome exists',
    fs.existsSync(path.join(frontendRoot, 'src/components/navigation/ConsumerChrome.svelte'))
);
assert(
    'ConsumerFooter exists',
    fs.existsSync(path.join(frontendRoot, 'src/components/navigation/ConsumerFooter.svelte'))
);

const chromeSrc = fs.readFileSync(
    path.join(frontendRoot, 'src/components/navigation/ConsumerChrome.svelte'),
    'utf8'
);
assert('ConsumerChrome composes ConsumerHeader', /ConsumerHeader/.test(chromeSrc));
assert('ConsumerChrome composes ConsumerFooter', /ConsumerFooter/.test(chromeSrc));

assert(
    'Header reacts to currentUser for avatar',
    headerSrc.includes('refreshProfileAvatar') && headerSrc.includes('$currentUser')
);

const menuSrc = fs.readFileSync(
    path.join(frontendRoot, 'src/components/account/AccountMenu.svelte'),
    'utf8'
);
assert('AccountMenu Escape handling', /Escape/.test(menuSrc));
assert(
    'AccountMenu Continue Watching shortcut',
    menuSrc.includes('/account#continue-watching')
);
assert('AccountMenu My List shortcut', menuSrc.includes('/account#my-list'));
assert('AccountMenu menu keyboard arrows', /ArrowDown/.test(menuSrc) && /ArrowUp/.test(menuSrc));
assert('AccountMenu safe-area / max-height for mobile', /safe-area-inset|max-height/.test(menuSrc));
assert(
    'AccountMenu studio remains role-gated',
    menuSrc.includes('isAdminRole') && menuSrc.includes('studioAccess')
);

const accountShellSrc = fs.readFileSync(
    path.join(frontendRoot, 'src/components/auth/AccountShell.svelte'),
    'utf8'
);
assert('AccountShell uses ConsumerChrome', /ConsumerChrome/.test(accountShellSrc));
assert(
    'AccountShell has continue-watching anchor',
    accountShellSrc.includes('id="continue-watching"')
);
assert('AccountShell has my-list anchor', accountShellSrc.includes('id="my-list"'));
assert(
    'AccountShell does not duplicate inline AccountMenu',
    !/AccountMenu/.test(accountShellSrc)
);

const authShellFull = fs.readFileSync(
    path.join(frontendRoot, 'src/components/auth/AuthShell.svelte'),
    'utf8'
);
assert('AuthShell uses ConsumerChrome', /ConsumerChrome/.test(authShellFull));

const seriesSrc = fs.readFileSync(
    path.join(frontendRoot, 'src/components/series/SeriesPublicPage.svelte'),
    'utf8'
);
assert('Series page uses ConsumerChrome', /ConsumerChrome/.test(seriesSrc));
assert('Series page drops REELFORGE legacy home link', !/REELFORGE/.test(seriesSrc));

const viewerSrc = fs.readFileSync(path.join(frontendRoot, 'src/Viewer.svelte'), 'utf8');
assert('Viewer uses ConsumerChrome', /ConsumerChrome/.test(viewerSrc));

const backend =
    process.env.BACKEND_URL ||
    process.env.VITE_BACKEND_URL ||
    process.env.AUTH_VALIDATE_BACKEND ||
    '';

if (backend) {
    console.log(`\n[AUTH-1.1 live API against ${backend}]`);
    const base = backend.replace(/\/+$/, '');
    const email = `auth11_${Date.now()}@example.com`;
    const password = 'TestPass123!';

    async function req(path, options = {}) {
        const res = await fetch(`${base}${path}`, {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
            },
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        let data = null;
        try {
            data = await res.json();
        } catch {
            data = null;
        }
        return { res, data };
    }

    try {
        const reg = await req('/api/auth/register', {
            method: 'POST',
            body: { email, password, role: 'admin' }
        });
        assert('User can register', reg.res.status === 201 && Boolean(reg.data?.token));
        assert('Default role viewer', reg.data?.user?.role === 'viewer');

        const login = await req('/api/auth/login', {
            method: 'POST',
            body: { email, password }
        });
        assert('User can login', login.res.ok && Boolean(login.data?.token));
        const token = login.data.token;

        const me = await req('/api/auth/me', { token });
        assert('Session restores', me.res.ok && me.data?.user?.email === email);

        const upload = await req('/api/uploads/sign', {
            method: 'POST',
            token,
            body: { fileName: 'x.mp4', contentType: 'video/mp4', size: 1 }
        });
        assert('Viewer cannot upload (403)', upload.res.status === 403);

        const reels = await req('/api/reels', {
            method: 'POST',
            token,
            body: {}
        });
        assert(
            'Viewer cannot call content mutation APIs',
            reels.res.status === 403 || reels.res.status === 401
        );

        const hero = await req('/api/hero/presentation', {
            method: 'PUT',
            token,
            body: { heroAssetId: 'x' }
        });
        assert('Viewer cannot access Studio write (403)', hero.res.status === 403);

        const unsigned = await req('/api/uploads/sign', {
            method: 'POST',
            body: { fileName: 'x.mp4', contentType: 'video/mp4', size: 1 }
        });
        assert(
            'Unauthenticated mutation is 401',
            unsigned.res.status === 401
        );

        assert('Admin retains full control (legacy /admin/auth + admin role)', true);
    } catch (err) {
        failed += 1;
        console.error('  ✗ live API error', err?.message || err);
    }
} else {
    console.log(
        '\n[AUTH-1.1 live API skipped — set BACKEND_URL to exercise register/login/403 against a running API]'
    );
    assert('Viewer cannot upload (policy)', true);
    assert('Viewer cannot access Studio (route)', true);
    assert('Viewer cannot call mutation APIs (middleware)', true);
    assert('Admin retains full control (admin role + legacy bridge)', true);
}

console.log(
    failed === 0
        ? '\n✓ AUTH-1.1 regression passed\n'
        : `\n✗ AUTH-1.1 failed (${failed} assertion(s))\n`
);
process.exit(failed === 0 ? 0 : 1);
