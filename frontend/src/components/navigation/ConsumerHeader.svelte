<script>
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

  // Reactive: re-derive avatar whenever session user changes (login / restore / logout).
  $: if (signedIn) {
    void refreshProfileAvatar(userId, userEmail);
  } else {
    profileLoadId += 1;
    profileInitial = '';
    menuOpen = false;
  }

  $: initial = profileInitial || (userEmail ? userEmail.charAt(0).toUpperCase() : '•');
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
    gap: 1rem;
    padding: max(0.65rem, env(safe-area-inset-top, 0px)) max(1.25rem, env(safe-area-inset-right, 0px)) 0.85rem
      max(1.25rem, env(safe-area-inset-left, 0px));
    position: sticky;
    top: 0;
    z-index: 30;
  }
  .consumer-header--overlay {
    background: linear-gradient(180deg, rgba(5, 5, 8, 0.92) 0%, rgba(5, 5, 8, 0.55) 70%, transparent 100%);
    backdrop-filter: blur(8px);
  }
  .consumer-header--solid {
    background: rgba(5, 5, 8, 0.98);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(10px);
  }
  .consumer-header__brand {
    text-decoration: none;
    color: inherit;
    min-width: 0;
  }
  .consumer-header__brand-mark {
    display: block;
    font-size: clamp(0.68rem, 2.4vw, 0.78rem);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(0, 242, 255, 0.92);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .consumer-header__actions {
    position: relative;
    flex-shrink: 0;
  }
  .consumer-header__sign-in {
    border: 1px solid rgba(255, 255, 255, 0.28);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    border-radius: 999px;
    padding: 0.45rem 0.95rem;
    font-size: 0.82rem;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .consumer-header__sign-in:hover,
  .consumer-header__sign-in:focus-visible {
    border-color: rgba(0, 242, 255, 0.55);
    background: rgba(0, 242, 255, 0.12);
    outline: none;
  }
  .consumer-header__profile {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    border-radius: 999px;
    padding: 0.25rem 0.55rem 0.25rem 0.25rem;
    cursor: pointer;
  }
  .consumer-header__profile:focus-visible {
    outline: 1px solid rgba(0, 242, 255, 0.65);
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
    border: 1px solid rgba(255, 255, 255, 0.2);
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
