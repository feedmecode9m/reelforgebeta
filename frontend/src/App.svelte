<script>
  import { onMount } from 'svelte';
  import Viewer from './Viewer.svelte';
  import SeriesPublicPage from './components/series/SeriesPublicPage.svelte';
  import AuthShell from './components/auth/AuthShell.svelte';
  import AccountShell from './components/auth/AccountShell.svelte';
  import AdminStudioUnlock from './components/auth/AdminStudioUnlock.svelte';
  import AreaUnavailable from './components/account/AreaUnavailable.svelte';
  import {
    evaluateRouteAccess,
    isAdminRole,
    isAuthenticatedSync,
    refreshSession,
    userRole,
    currentUser,
    buildLoginPath,
    sanitizeReturnPath,
    setStoredReturnPath
  } from './lib/auth/index.js';
  import { hasStudioAdminSessionToken } from './lib/adminSession.js';
  import { requestOpenStudio } from './lib/auth/clientNavigate.js';
  import './styles.css';

  function readPathname() {
    if (typeof window === 'undefined') return '/';
    return window.location.pathname || '/';
  }

  function readFullPath() {
    if (typeof window === 'undefined') return '/';
    return `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
  }

  function readSeriesSlug(pathname = readPathname()) {
    const match = String(pathname).match(/^\/series\/([^/]+)\/?$/i);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]).trim() || null;
    } catch {
      return match[1].trim() || null;
    }
  }

  let pathname = readPathname();
  let seriesSlug = readSeriesSlug(pathname);
  let authReady = false;
  /** Reactive nudge when password-only studio session is set/cleared. */
  let studioSessionTick = 0;
  let gate = evaluateRouteAccess({
    pathname,
    isAuthenticated: false,
    role: null
  });

  function recomputeGate() {
    pathname = readPathname();
    seriesSlug = readSeriesSlug(pathname);
    gate = evaluateRouteAccess({
      pathname,
      isAuthenticated: isAuthenticatedSync(),
      role: $userRole || $currentUser?.role || null
    });
  }

  /**
   * When an auth-required route is blocked, preserve return destination for login.
   * @param {string} intendedFullPath
   * @param {string} redirectTo
   * @returns {string}
   */
  function resolveGateRedirect(intendedFullPath, redirectTo) {
    const target = String(redirectTo || '/');
    if (target === '/login' || target.startsWith('/login')) {
      const intended = sanitizeReturnPath(intendedFullPath) || sanitizeReturnPath(pathname);
      if (intended && intended !== '/') {
        setStoredReturnPath(intended);
        return buildLoginPath(intended);
      }
      return '/login';
    }
    return target;
  }

  function enforceGate() {
    recomputeGate();
    if (!gate.allowed && gate.redirectTo) {
      const intended = readFullPath();
      const dest = resolveGateRedirect(intended, gate.redirectTo);
      const current = readFullPath();
      if (current !== dest) {
        window.history.replaceState({}, '', dest);
      }
      recomputeGate();
    }
  }

  /** @param {string} path */
  function navigate(path) {
    if (typeof window === 'undefined') return;
    const next = path.startsWith('/') ? path : `/${path}`;
    const current = readFullPath();
    if (current !== next) {
      window.history.pushState({}, '', next);
    }
    enforceGate();
  }

  function onPopState() {
    enforceGate();
  }

  function onAdminSessionChanged() {
    studioSessionTick += 1;
    enforceGate();
  }

  onMount(() => {
    refreshSession().finally(() => {
      authReady = true;
      enforceGate();
    });
    window.addEventListener('popstate', onPopState);
    window.addEventListener('reelforge:admin-session-changed', onAdminSessionChanged);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('reelforge:admin-session-changed', onAdminSessionChanged);
    };
  });

  $: if (authReady) {
    $userRole;
    $currentUser;
    studioSessionTick;
    enforceGate();
  }

  $: routeKind = (() => {
    const p = pathname.toLowerCase();
    if (seriesSlug) return 'series';
    if (p === '/login' || p.startsWith('/login/')) return 'login';
    if (p === '/register' || p.startsWith('/register/')) return 'register';
    if (p.startsWith('/settings')) return 'settings';
    if (p.startsWith('/account')) return 'account';
    if (
      p.startsWith('/creator') ||
      p.startsWith('/upload') ||
      p.startsWith('/content-management')
    ) {
      return 'unavailable';
    }
    if (p.startsWith('/admin') || p.startsWith('/studio')) return 'studio';
    return 'viewer';
  })();

  // Admin RBAC role or verified password session (re-read when session tick changes).
  $: studioSessionTick;
  $: studioUnlocked =
    authReady &&
    (isAdminRole($userRole || $currentUser?.role) || hasStudioAdminSessionToken());

  // Viewer accounts without admin role stay blocked on /studio (gate.unavailable).
  // Guests reach unlock; unlocked sessions enter Studio via Viewer.
  $: showUnavailable =
    Boolean(gate?.unavailable) || routeKind === 'unavailable';

  // When already unlocked and hitting /studio|/admin, land on Viewer + open Studio once.
  let studioAutoOpenDone = false;
  $: if (authReady && routeKind === 'studio' && studioUnlocked && !studioAutoOpenDone) {
    studioAutoOpenDone = true;
    requestAnimationFrame(() => {
      if (pathname === '/studio' || pathname === '/admin' || pathname.startsWith('/studio/') || pathname.startsWith('/admin/')) {
        // Stay on path but mount Viewer below; still open control center.
        requestOpenStudio('studio_route');
      }
    });
  }
  $: if (routeKind !== 'studio') {
    studioAutoOpenDone = false;
  }
</script>

{#if !authReady}
  <div class="auth-boot" aria-busy="true" aria-live="polite">
    <p class="auth-boot__brand">LOOK@ZAKANDA PRESENTS</p>
    <p class="auth-boot__msg">Loading your experience…</p>
  </div>
{:else if showUnavailable}
  <AreaUnavailable />
{:else if seriesSlug}
  <SeriesPublicPage slug={seriesSlug} />
{:else if routeKind === 'login'}
  <AuthShell mode="login" onNavigate={navigate} />
{:else if routeKind === 'register'}
  <AuthShell mode="register" onNavigate={navigate} />
{:else if routeKind === 'account'}
  <AccountShell view="account" onNavigate={navigate} />
{:else if routeKind === 'settings'}
  <AccountShell view="settings" onNavigate={navigate} />
{:else if routeKind === 'studio'}
  {#if studioUnlocked}
    <main>
      <Viewer />
    </main>
  {:else}
    <AdminStudioUnlock onNavigate={navigate} />
  {/if}
{:else}
  <main>
    <Viewer />
  </main>
{/if}

<style>
  main {
    margin: 0;
    padding: 0;
    width: 100%;
    min-height: 100vh;
    background: #000;
  }
  .auth-boot {
    min-height: 100vh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--lz-space-2, 0.65rem);
    padding: var(--lz-space-6, 2rem) var(--lz-page-pad-x, 1rem);
    background: var(--lz-atmosphere, #050508);
    color: var(--lz-ink-muted, rgba(255, 255, 255, 0.65));
    text-align: center;
    font-family: var(--lz-font-body, inherit);
  }
  .auth-boot__brand {
    margin: 0;
    font-family: var(--lz-font-display, inherit);
    font-size: var(--lz-size-brand, 0.72rem);
    letter-spacing: var(--lz-tracking-brand, 0.16em);
    text-transform: uppercase;
    color: var(--lz-cyan-soft, rgba(0, 242, 255, 0.9));
    font-weight: 600;
  }
  .auth-boot__msg {
    margin: 0;
    font-size: var(--lz-size-body, 0.95rem);
    color: var(--lz-ink-muted, rgba(255, 255, 255, 0.58));
  }
</style>
