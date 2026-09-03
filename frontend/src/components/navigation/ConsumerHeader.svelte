<script>
  import { onMount } from 'svelte';
  import { isAuthenticated, currentUser, buildLoginPath, setStoredReturnPath } from '../../lib/auth/index.js';
  import { clientNavigate } from '../../lib/auth/clientNavigate.js';
  import AccountMenu from '../account/AccountMenu.svelte';
  import { fetchViewerProfile } from '../../lib/api/viewerAccount.js';

  /** LOOK@ZAKANDA PRESENTS consumer brand */
  export let brand = 'LOOK@ZAKANDA PRESENTS';
  /**
   * overlay — translucent sticky bar over cinematic content
   * solid — opaque bar for auth/account shells
   * @type {'overlay' | 'solid'}
   */
  export let variant = 'overlay';

  let menuOpen = false;
  let profileInitial = '';
  let profileLoadId = 0;
  let pathname = '/';

  function syncPathname() {
    if (typeof window === 'undefined') return;
    pathname = window.location.pathname || '/';
  }

  function goHome() {
    clientNavigate('/');
  }

  function goBack() {
    if (typeof window === 'undefined') return;
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    clientNavigate('/');
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  function signIn() {
    if (typeof window === 'undefined') {
      clientNavigate('/login');
      return;
    }
    const returnTo = `${window.location.pathname || '/'}${window.location.search || ''}`;
    setStoredReturnPath(returnTo);
    clientNavigate(buildLoginPath(returnTo));
  }

  /**
   * @param {string | null | undefined} placeholder
   * @param {string | null | undefined} displayName
   * @param {string | null | undefined} email
   */
  function deriveInitial(placeholder, displayName, email) {
    const fromAvatar = String(placeholder || '').trim();
    if (fromAvatar) return fromAvatar.charAt(0).toUpperCase();
    const fromName = String(displayName || '').trim();
    if (fromName) return fromName.charAt(0).toUpperCase();
    const fromEmail = String(email || '').trim();
    if (fromEmail) return fromEmail.charAt(0).toUpperCase();
    return '•';
  }

  async function refreshProfileAvatar(userId, email) {
    const loadId = ++profileLoadId;
    // Immediate truth from session while profile loads.
    profileInitial = deriveInitial(null, null, email);

    if (!userId && !email) return;
    try {
      const p = await fetchViewerProfile();
      if (loadId !== profileLoadId) return;
      if (!p) return;
      profileInitial = deriveInitial(p.avatarPlaceholder, p.displayName, p.email || email);
    } catch {
      /* keep email-derived initial */
    }
  }

  $: signedIn = $isAuthenticated && Boolean($currentUser);
  $: userId = $currentUser?.id != null ? String($currentUser.id) : '';
  $: userEmail = String($currentUser?.email || '').trim();
  $: onHomeRoute = pathname === '/';

  // Reactive: re-derive avatar whenever session user changes (login / restore / logout).
  $: if (signedIn) {
    void refreshProfileAvatar(userId, userEmail);
  } else {
    profileLoadId += 1;
    profileInitial = '';
    menuOpen = false;
  }

  $: initial = profileInitial || (userEmail ? userEmail.charAt(0).toUpperCase() : '•');

  onMount(() => {
    syncPathname();
    if (typeof window === 'undefined') return undefined;
    const handlePopState = () => syncPathname();
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  });
</script>

<header
  class="consumer-header"
  class:consumer-header--solid={variant === 'solid'}
  class:consumer-header--overlay={variant === 'overlay'}
  data-consumer-header
  data-header-variant={variant}
>
  <a class="consumer-header__brand" href="/" on:click|preventDefault={() => clientNavigate('/')}>
    <span class="consumer-header__brand-mark">{brand}</span>
  </a>

  <nav class="consumer-header__nav" aria-label="Page navigation">
    <button
      type="button"
      class="consumer-header__nav-btn"
      aria-label="Go back"
      on:click={goBack}
    >
      ← Back
    </button>
    <button
      type="button"
      class="consumer-header__nav-btn"
      class:is-active={onHomeRoute}
      aria-label="Go home"
      on:click={goHome}
    >
      Home
    </button>
  </nav>

  <div class="consumer-header__actions" data-account-menu-root>
    {#if signedIn}
      <button
        type="button"
        class="consumer-header__profile"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? 'consumer-account-menu' : undefined}
        aria-label="Account menu"
        on:click|stopPropagation={toggleMenu}
      >
        <span class="consumer-header__avatar" aria-hidden="true">{initial}</span>
        <span class="consumer-header__profile-label">Account</span>
      </button>
      <AccountMenu
        id="consumer-account-menu"
        bind:open={menuOpen}
        on:close={closeMenu}
      />
    {:else}
      <button type="button" class="consumer-header__sign-in" on:click={signIn}>Sign In</button>
    {/if}
  </div>
</header>

<style>
  .consumer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--lz-space-3, 1rem);
    padding: max(0.65rem, env(safe-area-inset-top, 0px)) max(1.25rem, env(safe-area-inset-right, 0px)) 0.85rem
      max(1.25rem, env(safe-area-inset-left, 0px));
    position: sticky;
    top: 0;
    z-index: 30;
    font-family: var(--lz-font-body, inherit);
  }
  .consumer-header--overlay {
    background: linear-gradient(
      180deg,
      rgba(5, 5, 8, 0.92) 0%,
      rgba(5, 5, 8, 0.55) 70%,
      transparent 100%
    );
    backdrop-filter: blur(8px);
  }
  .consumer-header--solid {
    background: rgba(5, 5, 8, 0.98);
    border-bottom: 1px solid var(--lz-border, rgba(255, 255, 255, 0.08));
    backdrop-filter: blur(10px);
  }
  .consumer-header__brand {
    text-decoration: none;
    color: inherit;
    min-width: 0;
    transition: opacity var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }
  .consumer-header__brand:hover {
    opacity: 0.92;
  }
  .consumer-header__brand:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 3px;
    border-radius: 2px;
  }
  .consumer-header__brand-mark {
    display: block;
    font-family: var(--lz-font-display, inherit);
    font-size: var(--lz-size-brand, clamp(0.68rem, 2.4vw, 0.78rem));
    letter-spacing: var(--lz-tracking-brand, 0.16em);
    text-transform: uppercase;
    color: var(--lz-cyan-soft, rgba(0, 242, 255, 0.92));
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .consumer-header__actions {
    position: relative;
    flex-shrink: 0;
  }
  .consumer-header__nav {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin-left: auto;
  }
  .consumer-header__nav-btn {
    border: 1px solid var(--lz-border, rgba(255, 255, 255, 0.18));
    background: rgba(255, 255, 255, 0.05);
    color: var(--lz-ink, #fff);
    border-radius: var(--lz-radius-pill, 999px);
    padding: 0.35rem 0.75rem;
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    cursor: pointer;
    font-family: inherit;
    transition:
      border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      background var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }
  .consumer-header__nav-btn:hover {
    border-color: rgba(0, 242, 255, 0.5);
    background: rgba(0, 242, 255, 0.1);
  }
  .consumer-header__nav-btn:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
  }
  .consumer-header__nav-btn.is-active {
    border-color: rgba(0, 242, 255, 0.55);
    background: rgba(0, 242, 255, 0.12);
  }
  .consumer-header__sign-in {
    border: 1px solid var(--lz-border-strong, rgba(255, 255, 255, 0.28));
    background: rgba(255, 255, 255, 0.06);
    color: var(--lz-ink, #fff);
    border-radius: var(--lz-radius-pill, 999px);
    padding: 0.45rem 0.95rem;
    font-size: 0.82rem;
    letter-spacing: var(--lz-tracking-label, 0.04em);
    cursor: pointer;
    font-family: inherit;
    transition:
      border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      background var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }
  .consumer-header__sign-in:hover {
    border-color: rgba(0, 242, 255, 0.55);
    background: rgba(0, 242, 255, 0.12);
  }
  .consumer-header__sign-in:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
  }
  .consumer-header__profile {
    display: inline-flex;
    align-items: center;
    gap: var(--lz-space-2, 0.45rem);
    border: 1px solid var(--lz-border, rgba(255, 255, 255, 0.18));
    background: rgba(255, 255, 255, 0.05);
    color: var(--lz-ink, #fff);
    border-radius: var(--lz-radius-pill, 999px);
    padding: 0.25rem 0.55rem 0.25rem 0.25rem;
    cursor: pointer;
    font-family: inherit;
    transition: border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }
  .consumer-header__profile:hover {
    border-color: rgba(0, 242, 255, 0.4);
  }
  .consumer-header__profile:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
  }
  .consumer-header__avatar {
    width: 1.85rem;
    height: 1.85rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.78rem;
    font-weight: 600;
    background: linear-gradient(135deg, rgba(0, 242, 255, 0.35), rgba(255, 0, 180, 0.28));
    border: 1px solid var(--lz-border-strong, rgba(255, 255, 255, 0.2));
  }
  .consumer-header__profile-label {
    font-size: 0.8rem;
    padding-right: 0.35rem;
  }

  @media (max-width: 640px) {
    .consumer-header {
      padding: max(0.5rem, env(safe-area-inset-top, 0px)) max(0.85rem, env(safe-area-inset-right, 0px)) 0.65rem
        max(0.85rem, env(safe-area-inset-left, 0px));
    }
    .consumer-header__nav {
      order: 3;
      width: 100%;
      margin-left: 0;
      justify-content: flex-start;
    }
    .consumer-header__profile-label {
      display: none;
    }
    .consumer-header__profile {
      padding: 0.2rem;
      border-radius: 50%;
    }
    .consumer-header__sign-in {
      padding: 0.4rem 0.75rem;
      font-size: 0.78rem;
    }
  }
</style>
