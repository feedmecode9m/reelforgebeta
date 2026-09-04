<script>
  import {
    authError,
    authStatus,
    currentUser,
    login,
    logout,
    register,
    isAuthenticated,
    buildAuthPath,
    mapAuthErrorMessage,
    resolvePostAuthDestination,
    setStoredReturnPath,
    readNextFromSearch
  } from '../../lib/auth/index.js';
  import { showStudioLinkOnViewerLogin } from '../../lib/auth/studioEntryPreferences.js';
  import ConsumerChrome from '../navigation/ConsumerChrome.svelte';

  /** @type {'login' | 'register'} */
  export let mode = 'login';
  /** @type {(path: string) => void} */
  export let onNavigate = () => {};

  let email = '';
  let password = '';
  let busy = false;
  let localError = '';
  let showPassword = false;
  let emailTouched = false;
  let passwordTouched = false;

  $: title = mode === 'register' ? 'Create account' : 'Sign in';
  $: brand = 'LOOK@ZAKANDA PRESENTS';
  $: submitting = busy || $authStatus === 'loading';
  $: emailError = emailTouched ? validateEmail(email) : '';
  $: passwordError = passwordTouched ? validatePassword(password, mode) : '';
  $: formBlocked = Boolean(validateEmail(email) || validatePassword(password, mode));

  /**
   * @param {string} value
   * @returns {string}
   */
  function validateEmail(value) {
    const e = String(value || '').trim();
    if (!e) return 'Email is required.';
    // Practical email check (not full RFC).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Enter a valid email address.';
    return '';
  }

  /**
   * @param {string} value
   * @param {'login' | 'register'} m
   * @returns {string}
   */
  function validatePassword(value, m) {
    const p = String(value || '');
    if (!p) return 'Password is required.';
    if (p.length < 8) return 'Password must be at least 8 characters.';
    if (m === 'register' && p.length > 128) return 'Password is too long.';
    return '';
  }

  function currentSearch() {
    if (typeof window === 'undefined') return '';
    return window.location.search || '';
  }

  function goAfterAuth() {
    const dest = resolvePostAuthDestination({
      search: currentSearch(),
      defaultPath: '/'
    });
    onNavigate(dest);
  }

  /** Preserve ?next when switching login ↔ register. */
  function switchMode(nextMode) {
    localError = '';
    const returnTo = readNextFromSearch(currentSearch());
    const base = nextMode === 'register' ? '/register' : '/login';
    onNavigate(buildAuthPath(base, returnTo));
  }

  async function submit() {
    localError = '';
    emailTouched = true;
    passwordTouched = true;
    const eErr = validateEmail(email);
    const pErr = validatePassword(password, mode);
    if (eErr || pErr) {
      localError = eErr || pErr;
      return;
    }

    busy = true;
    try {
      // Refresh storage from query so hard refresh / shareable login links still restore.
      const fromQuery = readNextFromSearch(currentSearch());
      if (fromQuery) setStoredReturnPath(fromQuery);

      const payload = { email: String(email).trim(), password };
      const result = mode === 'register' ? await register(payload) : await login(payload);
      if (!result.ok) {
        localError = mapAuthErrorMessage(
          {
            status: result.status,
            code: result.code,
            error: result.error,
            message: result.error
          },
          mode
        );
        return;
      }
      goAfterAuth();
    } finally {
      busy = false;
    }
  }

  async function handleLogout() {
    busy = true;
    try {
      await logout();
      onNavigate('/');
    } finally {
      busy = false;
    }
  }

  function goHome() {
    onNavigate('/');
  }
</script>

<ConsumerChrome brand={brand} headerVariant="solid" showFooter={true} fillViewport={true}>
  <section class="auth-shell" aria-label="Authentication">
    <div class="auth-stage">
      {#if !($isAuthenticated && $currentUser)}
        <header class="auth-hero" aria-hidden="false">
          <p class="auth-hero__brand">{brand}</p>
          <p class="auth-hero__line"></p>
        </header>
      {/if}

      <div class="auth-card">
        {#if $isAuthenticated && $currentUser}
          <h1 class="auth-title">Signed in</h1>
          <p class="auth-copy">{$currentUser.email || 'Signed in'}</p>
          <div class="auth-actions">
            <button type="button" class="auth-btn auth-btn--primary" on:click={goAfterAuth}>
              Continue
            </button>
            <button type="button" class="auth-btn" on:click={goHome}>Home</button>
            <button type="button" class="auth-btn" on:click={handleLogout} disabled={busy}>Sign Out</button>
          </div>
        {:else}
          <h1 class="auth-title">{title}</h1>
          <p class="auth-copy">Sign in to continue watching</p>
          <p class="auth-copy auth-copy--sub">Viewer account — email and password only</p>
          <form class="auth-form" on:submit|preventDefault={submit} novalidate>
            <label class="auth-field">
              <span>Email</span>
              <input
                type="email"
                autocomplete="email"
                inputmode="email"
                bind:value={email}
                disabled={submitting}
                on:blur={() => (emailTouched = true)}
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailError ? 'auth-email-hint' : undefined}
              />
              {#if emailError}
                <span id="auth-email-hint" class="auth-field-hint">{emailError}</span>
              {/if}
            </label>
            <label class="auth-field">
              <span>Password</span>
              <div class="auth-password-row">
                {#if showPassword}
                  <input
                    type="text"
                    autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
                    bind:value={password}
                    minlength="8"
                    disabled={submitting}
                    on:blur={() => (passwordTouched = true)}
                    aria-invalid={Boolean(passwordError)}
                    aria-describedby={passwordError ? 'auth-password-hint' : undefined}
                  />
                {:else}
                  <input
                    type="password"
                    autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
                    bind:value={password}
                    minlength="8"
                    disabled={submitting}
                    on:blur={() => (passwordTouched = true)}
                    aria-invalid={Boolean(passwordError)}
                    aria-describedby={passwordError ? 'auth-password-hint' : undefined}
                  />
                {/if}
                <button
                  type="button"
                  class="auth-password-toggle"
                  on:click={() => (showPassword = !showPassword)}
                  disabled={submitting}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {#if passwordError}
                <span id="auth-password-hint" class="auth-field-hint">{passwordError}</span>
              {/if}
            </label>
            {#if localError || ($authError && !localError)}
              <p class="auth-error" role="alert">
                {localError ||
                  mapAuthErrorMessage({ message: $authError, code: $authError }, mode)}
              </p>
            {/if}
            <button
              type="submit"
              class="auth-btn auth-btn--primary"
              disabled={submitting || formBlocked}
            >
              {#if submitting}
                {mode === 'register' ? 'Creating account…' : 'Signing in…'}
              {:else}
                {mode === 'register' ? 'Create account' : 'Sign in'}
              {/if}
            </button>
          </form>
          <p class="auth-switch">
            {#if mode === 'login'}
              New here?
              <button type="button" class="auth-link" on:click={() => switchMode('register')} disabled={submitting}>
                Create an account
              </button>
            {:else}
              Already have an account?
              <button type="button" class="auth-link" on:click={() => switchMode('login')} disabled={submitting}>
                Sign in
              </button>
            {/if}
          </p>
          {#if mode === 'login' && showStudioLinkOnViewerLogin()}
            <p class="auth-studio-entry">
              <button
                type="button"
                class="auth-link"
                on:click={() => onNavigate('/studio')}
                disabled={submitting}
              >
                Studio access
              </button>
              <span class="auth-studio-entry__hint"> (separate password)</span>
            </p>
          {/if}
        {/if}
      </div>
    </div>
  </section>
</ConsumerChrome>

<style>
  .auth-shell {
    min-height: calc(100vh - 5rem);
    min-height: calc(100dvh - 5rem);
    display: grid;
    place-items: center;
    padding: var(--lz-page-pad-y, 1.5rem) var(--lz-page-pad-x, 1.25rem) 2rem;
    background: var(--lz-atmosphere, transparent);
    color: var(--lz-ink, #f4f4f5);
    font-family: var(--lz-font-body, inherit);
  }

  .auth-stage {
    width: min(440px, 100%);
    display: grid;
    gap: var(--lz-space-5, 1.75rem);
    justify-items: center;
    animation: lz-fade-rise var(--lz-duration-slow, 480ms) var(--lz-ease, ease) both;
  }

  .auth-hero {
    text-align: center;
    width: 100%;
  }

  .auth-hero__brand {
    margin: 0;
    font-family: var(--lz-font-display, inherit);
    font-size: var(--lz-size-brand-hero, clamp(0.95rem, 3.2vw, 1.15rem));
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--lz-cyan-soft, rgba(0, 242, 255, 0.9));
    font-weight: 600;
    text-shadow: 0 0 32px var(--lz-cyan-glow, rgba(0, 242, 255, 0.28));
    animation: lz-brand-shimmer 5.5s var(--lz-ease, ease) infinite;
  }

  .auth-hero__line {
    margin: 0.85rem auto 0;
    width: min(12rem, 48%);
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--lz-cyan-glow, rgba(0, 242, 255, 0.45)),
      transparent
    );
    border: 0;
  }

  .auth-card {
    width: 100%;
    border: 1px solid var(--lz-border, rgba(255, 255, 255, 0.12));
    border-radius: var(--lz-radius-lg, 12px);
    padding: var(--lz-space-5, 1.75rem) var(--lz-space-4, 1.5rem);
    background: var(--lz-panel, rgba(16, 18, 28, 0.92));
    box-shadow: var(--lz-shadow-card, 0 20px 60px rgba(0, 0, 0, 0.45));
  }

  .auth-title {
    margin: 0 0 var(--lz-space-1, 0.4rem);
    font-size: var(--lz-size-title, 1.55rem);
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .auth-copy {
    margin: 0 0 0.35rem;
    color: var(--lz-ink-muted, rgba(255, 255, 255, 0.55));
    font-size: 0.92rem;
    line-height: var(--lz-leading, 1.5);
  }

  .auth-copy--sub {
    margin: 0 0 var(--lz-space-4, 1.25rem);
    color: var(--lz-ink-dim, rgba(255, 255, 255, 0.4));
    font-size: var(--lz-size-small, 0.85rem);
  }

  .auth-form {
    display: grid;
    gap: var(--lz-space-3, 0.85rem);
  }

  .auth-field {
    display: grid;
    gap: var(--lz-space-1, 0.35rem);
    font-size: 0.8rem;
    color: var(--lz-ink-soft, rgba(255, 255, 255, 0.72));
  }

  .auth-field input {
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: var(--lz-radius-md, 10px);
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    padding: 0.7rem 0.8rem;
    font-size: var(--lz-size-body, 0.95rem);
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    transition:
      border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      box-shadow var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }

  .auth-field input:focus {
    outline: none;
    border-color: rgba(0, 242, 255, 0.5);
    box-shadow: 0 0 0 1px var(--lz-focus, rgba(0, 242, 255, 0.65));
  }

  .auth-field input:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 1px;
  }

  .auth-field input[aria-invalid='true'] {
    border-color: var(--lz-danger-border, rgba(251, 113, 133, 0.65));
  }

  .auth-password-row {
    display: flex;
    gap: var(--lz-space-2, 0.45rem);
    align-items: stretch;
  }

  .auth-password-row input {
    flex: 1;
    min-width: 0;
  }

  .auth-password-toggle {
    flex-shrink: 0;
    border: 1px solid var(--lz-border-strong, rgba(255, 255, 255, 0.18));
    background: rgba(255, 255, 255, 0.06);
    color: var(--lz-ink-soft, rgba(255, 255, 255, 0.85));
    border-radius: var(--lz-radius-md, 10px);
    padding: 0 0.75rem;
    font-size: 0.78rem;
    cursor: pointer;
    font-family: inherit;
    transition: border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }

  .auth-password-toggle:hover:not(:disabled) {
    border-color: rgba(0, 242, 255, 0.4);
  }

  .auth-password-toggle:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
  }

  .auth-password-toggle:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .auth-field-hint {
    font-size: var(--lz-size-caption, 0.75rem);
    color: var(--lz-danger, #fda4af);
  }

  .auth-error {
    margin: 0;
    color: var(--lz-danger, #fda4af);
    font-size: var(--lz-size-small, 0.85rem);
  }

  .auth-actions {
    display: flex;
    gap: var(--lz-space-2, 0.65rem);
    flex-wrap: wrap;
  }

  .auth-btn {
    border: 1px solid var(--lz-border-strong, rgba(255, 255, 255, 0.2));
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    border-radius: var(--lz-radius-md, 10px);
    padding: 0.7rem 1rem;
    font-size: 0.9rem;
    cursor: pointer;
    font-family: inherit;
    transition:
      border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      background var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      box-shadow var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      opacity var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }

  .auth-btn:hover:not(:disabled) {
    border-color: rgba(0, 242, 255, 0.45);
    background: rgba(0, 242, 255, 0.1);
  }

  .auth-btn:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
  }

  .auth-btn--primary {
    background: linear-gradient(135deg, rgba(0, 242, 255, 0.28), rgba(255, 0, 180, 0.18));
    border-color: rgba(0, 242, 255, 0.45);
    font-weight: 600;
  }

  .auth-btn--primary:hover:not(:disabled) {
    box-shadow: 0 0 22px var(--lz-cyan-glow, rgba(0, 242, 255, 0.28));
    border-color: var(--lz-cyan, #00f2ff);
  }

  .auth-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .auth-switch {
    margin: var(--lz-space-4, 1.1rem) 0 0;
    font-size: var(--lz-size-small, 0.85rem);
    color: var(--lz-ink-muted, rgba(255, 255, 255, 0.55));
  }

  .auth-link {
    border: 0;
    background: none;
    color: var(--lz-cyan-soft, #67e8f9);
    cursor: pointer;
    padding: 0;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }

  .auth-link:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
    border-radius: 2px;
  }

  .auth-link:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .auth-studio-entry {
    margin-top: var(--lz-space-4, 1.1rem);
    padding-top: var(--lz-space-3, 0.85rem);
    border-top: 1px solid var(--lz-border, rgba(255, 255, 255, 0.08));
    font-size: var(--lz-size-small, 0.85rem);
    color: var(--lz-ink-muted, rgba(255, 255, 255, 0.45));
  }

  .auth-studio-entry__hint {
    color: var(--lz-ink-dim, rgba(255, 255, 255, 0.35));
  }
</style>
