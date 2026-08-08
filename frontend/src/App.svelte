<script>
  import { onMount } from 'svelte';
  import Viewer from './Viewer.svelte';
  import SeriesPublicPage from './components/series/SeriesPublicPage.svelte';
  import AuthShell from './components/auth/AuthShell.svelte';
  import AccountShell from './components/auth/AccountShell.svelte';
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

  onMount(() => {
    refreshSession().finally(() => {
      authReady = true;
      enforceGate();
    });
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  $: if (authReady) {
    $userRole;
    $currentUser;
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

  // Phase 0: reactive role — after authReady only.
  $: studioOk = authReady && isAdminRole($userRole || $currentUser?.role);

  $: showUnavailable =
    Boolean(gate?.unavailable) ||
    (routeKind === 'studio' && !studioOk) ||
    routeKind === 'unavailable';
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
  {#if studioOk}
    <AccountShell view="studio" onNavigate={navigate} />
  {:else}
    <AreaUnavailable />
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
    gap: 0.65rem;
    padding: 2rem 1rem;
    background:
      radial-gradient(ellipse at 20% 0%, rgba(0, 242, 255, 0.1), transparent 55%),
      radial-gradient(ellipse at 80% 100%, rgba(255, 0, 180, 0.08), transparent 50%),
      #050508;
    color: rgba(255, 255, 255, 0.65);
    text-align: center;
  }
  .auth-boot__brand {
    margin: 0;
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(0, 242, 255, 0.9);
  }
  .auth-boot__msg {
    margin: 0;
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.58);
  }
</style>
