<script>
  /**
   * Password-only Studio unlock (POST /admin/auth).
   * Separate from consumer /login email accounts.
   */
  import { onMount } from 'svelte';
  import ConsumerChrome from '../navigation/ConsumerChrome.svelte';
  import { authenticateAdmin, setAdminSessionToken } from '../../lib/api.js';
  import { hasStudioAdminSessionToken } from '../../lib/adminSession.js';
  import { canAccessStudio, isAdminRole, currentUser } from '../../lib/auth/index.js';
  import { requestOpenStudio } from '../../lib/auth/clientNavigate.js';

  /** @type {(path: string) => void} */
  export let onNavigate = () => {};

  let password = '';
  let busy = false;
  let localError = '';
  let showPassword = false;

  function enterStudio() {
    onNavigate('/');
    // Viewer mounts on next frame; open control center after canAccessStudio gates pass.
    requestAnimationFrame(() => {
      requestOpenStudio('studio_unlock');
      setTimeout(() => requestOpenStudio('studio_unlock'), 120);
    });
  }

  onMount(() => {
    // Already unlocked (password session or admin role) → proceed into Studio.
    if (canAccessStudio()) {
      enterStudio();
    }
  });

  async function submit() {
    localError = '';
    const pass = String(password || '');
    if (!pass) {
      localError = 'Password is required.';
      return;
    }

    busy = true;
    try {
      const result = await authenticateAdmin(pass);
      if (!result?.success) {
        localError = 'Authentication failed. Check the password and try again.';
        return;
      }
      const token = String(result.token || '').trim();
      if (!token || token === 'backend_token') {
        localError = 'Login succeeded but no session token was returned.';
        return;
      }
      setAdminSessionToken(token);
      password = '';
      enterStudio();
    } catch (err) {
      // Localhost-only offline bridge matches StudioExperience behavior.
      const host = typeof window !== 'undefined' ? String(window.location.hostname || '') : '';
      const isLocalHost =
        !host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
      if (!isLocalHost) {
        localError =
          'Cannot reach studio authentication. Check connectivity and try again.';
        return;
      }
      const localPasswords = ['Gaff1505!', 'SMART_PRODUCTION', 'admin123'];
      if (localPasswords.includes(pass)) {
        setAdminSessionToken('dev_local_session');
        password = '';
        enterStudio();
        return;
      }
      localError = err?.message || 'Authentication failed.';
    } finally {
      busy = false;
    }
  }

  function goConsumerLogin() {
    onNavigate('/login');
  }

  function goHome() {
    onNavigate('/');
  }
</script>

<ConsumerChrome brand="LOOK@ZAKANDA PRESENTS" headerVariant="solid" showFooter={true} fillViewport={true}>
  <section class="studio-unlock" aria-label="Studio access">
    <div class="studio-unlock__stage">
      <header class="studio-unlock__hero">
        <p class="studio-unlock__brand">LOOK@ZAKANDA PRESENTS</p>
        <p class="studio-unlock__line"></p>
      </header>

      <div class="studio-unlock__card">
        <h1 class="studio-unlock__title">Studio Access</h1>
        <p class="studio-unlock__copy">Password required to unlock Production Studio.</p>

        {#if hasStudioAdminSessionToken() || isAdminRole($currentUser?.role)}
          <p class="studio-unlock__copy">Session ready — opening Studio…</p>
          <button type="button" class="studio-unlock__btn studio-unlock__btn--primary" on:click={enterStudio}>
            Continue to Studio
          </button>
        {:else}
          <form class="studio-unlock__form" on:submit|preventDefault={submit} novalidate>
            <label class="studio-unlock__field">
              <span>Password</span>
              <div class="studio-unlock__password-row">
                {#if showPassword}
                  <input
                    type="text"
                    autocomplete="current-password"
                    bind:value={password}
                    disabled={busy}
                    aria-invalid={Boolean(localError)}
                  />
                {:else}
                  <input
                    type="password"
                    autocomplete="current-password"
                    bind:value={password}
                    disabled={busy}
                    aria-invalid={Boolean(localError)}
                  />
                {/if}
                <button
                  type="button"
                  class="studio-unlock__toggle"
                  on:click={() => (showPassword = !showPassword)}
                  disabled={busy}
                  aria-pressed={showPassword}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>

            {#if localError}
              <p class="studio-unlock__error" role="alert">{localError}</p>
            {/if}

            <button
              type="submit"
              class="studio-unlock__btn studio-unlock__btn--primary"
              disabled={busy || !String(password || '').trim()}
            >
              {busy ? 'Unlocking…' : 'Unlock Studio'}
            </button>
          </form>
        {/if}

        <div class="studio-unlock__footer">
          <button type="button" class="studio-unlock__link" on:click={goConsumerLogin}>
            Viewer sign in
          </button>
          <button type="button" class="studio-unlock__link" on:click={goHome}>Home</button>
        </div>
      </div>
    </div>
  </section>
</ConsumerChrome>

<style>
  .studio-unlock {
    min-height: calc(100vh - 5rem);
    min-height: calc(100dvh - 5rem);
    display: grid;
    place-items: center;
    padding: var(--lz-page-pad-y, 1.5rem) var(--lz-page-pad-x, 1.25rem) 2rem;
    background: var(--lz-atmosphere, transparent);
    color: var(--lz-ink, #f4f4f5);
    font-family: var(--lz-font-body, inherit);
  }
  .studio-unlock__stage {
    width: min(420px, 100%);
    display: grid;
    gap: var(--lz-space-5, 1.75rem);
    justify-items: center;
  }
  .studio-unlock__hero {
    text-align: center;
    width: 100%;
  }
  .studio-unlock__brand {
    margin: 0;
    font-size: var(--lz-size-brand-hero, 0.95rem);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--lz-cyan-soft, rgba(0, 242, 255, 0.9));
    font-weight: 600;
  }
  .studio-unlock__line {
    margin: 0.85rem auto 0;
    width: min(12rem, 48%);
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(0, 242, 255, 0.45), transparent);
  }
  .studio-unlock__card {
    width: 100%;
    border: 1px solid var(--lz-border, rgba(255, 255, 255, 0.12));
    border-radius: var(--lz-radius-lg, 12px);
    padding: 1.75rem 1.5rem;
    background: var(--lz-panel, rgba(16, 18, 28, 0.92));
    box-shadow: var(--lz-shadow-card, 0 20px 60px rgba(0, 0, 0, 0.45));
  }
  .studio-unlock__title {
    margin: 0 0 0.4rem;
    font-size: 1.45rem;
    font-weight: 650;
  }
  .studio-unlock__copy {
    margin: 0 0 1.15rem;
    color: var(--lz-ink-muted, rgba(255, 255, 255, 0.55));
    font-size: 0.92rem;
    line-height: 1.45;
  }
  .studio-unlock__form {
    display: grid;
    gap: 0.85rem;
  }
  .studio-unlock__field {
    display: grid;
    gap: 0.35rem;
    font-size: 0.8rem;
    color: var(--lz-ink-soft, rgba(255, 255, 255, 0.72));
  }
  .studio-unlock__password-row {
    display: flex;
    gap: 0.45rem;
  }
  .studio-unlock__password-row input {
    flex: 1;
    min-width: 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: var(--lz-radius-md, 10px);
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    padding: 0.7rem 0.8rem;
    font-size: 0.95rem;
    font-family: inherit;
  }
  .studio-unlock__password-row input:focus {
    outline: none;
    border-color: rgba(0, 242, 255, 0.5);
    box-shadow: 0 0 0 1px var(--lz-focus, rgba(0, 242, 255, 0.65));
  }
  .studio-unlock__toggle {
    flex-shrink: 0;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
    border-radius: var(--lz-radius-md, 10px);
    padding: 0 0.75rem;
    font-size: 0.78rem;
    cursor: pointer;
    font-family: inherit;
  }
  .studio-unlock__error {
    margin: 0;
    color: var(--lz-danger, #fda4af);
    font-size: 0.85rem;
  }
  .studio-unlock__btn {
    border: 1px solid var(--lz-border-strong, rgba(255, 255, 255, 0.2));
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    border-radius: var(--lz-radius-md, 10px);
    padding: 0.7rem 1rem;
    font-size: 0.9rem;
    cursor: pointer;
    font-family: inherit;
  }
  .studio-unlock__btn--primary {
    background: linear-gradient(135deg, rgba(0, 242, 255, 0.28), rgba(255, 0, 180, 0.18));
    border-color: rgba(0, 242, 255, 0.45);
    font-weight: 600;
  }
  .studio-unlock__btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .studio-unlock__footer {
    margin-top: 1.15rem;
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .studio-unlock__link {
    border: 0;
    background: none;
    color: var(--lz-cyan-soft, #67e8f9);
    cursor: pointer;
    padding: 0;
    font: inherit;
    font-size: 0.85rem;
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }
</style>
