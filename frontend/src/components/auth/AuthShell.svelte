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
        <p class="auth-copy auth-copy--sub">Your personal cinema experience</p>
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
      {/if}
    </div>
  </section>
</ConsumerChrome>

<style>
  .auth-shell {
    min-height: calc(100vh - 5rem);
    min-height: calc(100dvh - 5rem);
    display: grid;
    place-items: center;
    padding: 1.5rem 1rem 2rem;
    background:
      radial-gradient(ellipse at 20% 0%, rgba(0, 242, 255, 0.12), transparent 55%),
      radial-gradient(ellipse at 80% 100%, rgba(255, 0, 180, 0.1), transparent 50%),
      transparent;
    color: #f4f4f5;
  }
  .auth-card {
    width: min(420px, 100%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 1.75rem 1.5rem;
    background: rgba(16, 18, 28, 0.92);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  }
  .auth-title {
    margin: 0 0 0.4rem;
    font-size: 1.55rem;
    font-weight: 650;
  }
  .auth-copy {
    margin: 0 0 0.35rem;
    color: rgba(255, 255, 255, 0.62);
    font-size: 0.92rem;
    line-height: 1.45;
  }
  .auth-copy--sub {
    margin: 0 0 1.25rem;
    color: rgba(255, 255, 255, 0.48);
    font-size: 0.85rem;
  }
  .auth-form {
    display: grid;
    gap: 0.85rem;
  }
  .auth-field {
    display: grid;
    gap: 0.35rem;
    font-size: 0.8rem;
    color: rgba(255, 255, 255, 0.7);
  }
  .auth-field input {
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    padding: 0.7rem 0.8rem;
    font-size: 0.95rem;
    width: 100%;
    box-sizing: border-box;
  }
  .auth-field input:focus {
    outline: 1px solid rgba(0, 242, 255, 0.65);
    border-color: rgba(0, 242, 255, 0.45);
  }
  .auth-field input[aria-invalid='true'] {
    border-color: rgba(251, 113, 133, 0.65);
  }
  .auth-password-row {
    display: flex;
    gap: 0.45rem;
    align-items: stretch;
  }
  .auth-password-row input {
    flex: 1;
    min-width: 0;
  }
  .auth-password-toggle {
    flex-shrink: 0;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
    border-radius: 8px;
    padding: 0 0.75rem;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .auth-password-toggle:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .auth-field-hint {
    font-size: 0.75rem;
    color: #fda4af;
  }
  .auth-error {
    margin: 0;
    color: #fda4af;
    font-size: 0.85rem;
  }
  .auth-actions {
    display: flex;
    gap: 0.65rem;
    flex-wrap: wrap;
  }
  .auth-btn {
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    border-radius: 8px;
    padding: 0.7rem 1rem;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .auth-btn--primary {
    background: linear-gradient(135deg, rgba(0, 242, 255, 0.25), rgba(255, 0, 180, 0.2));
    border-color: rgba(0, 242, 255, 0.45);
  }
  .auth-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .auth-switch {
    margin: 1.1rem 0 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.55);
  }
  .auth-link {
    border: 0;
    background: none;
    color: #67e8f9;
    cursor: pointer;
    padding: 0;
    font: inherit;
    text-decoration: underline;
  }
  .auth-link:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
