<script>
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { currentUser, isAdminRole, logout } from '../../lib/auth/index.js';
  import { clientNavigate, requestOpenStudio } from '../../lib/auth/clientNavigate.js';

  /** Controlled open state from parent when used as dropdown. */
  export let open = false;
  /**
   * Popover under header only (inline full-page menus removed — header is source of truth).
   * Kept for API compatibility; inline no longer rendered by AccountShell.
   */
  export let inline = false;
  /** Optional DOM id for aria-controls. */
  export let id = 'consumer-account-menu';

  const dispatch = createEventDispatcher();

  /** @type {HTMLDivElement | null} */
  let menuEl = null;

  function close() {
    if (!open && !inline) return;
    open = false;
    dispatch('close');
  }

  /** @param {string} path */
  function go(path) {
    close();
    clientNavigate(path);
  }

  async function signOut() {
    close();
    await logout();
    clientNavigate('/');
  }

  function openStudio(label) {
    close();
    clientNavigate('/');
    requestAnimationFrame(() => {
      requestOpenStudio(label);
    });
  }

  function onDocPointer(event) {
    if (!open || inline) return;
    const t = event.target;
    if (t instanceof Element && t.closest('[data-account-menu-root]')) return;
    close();
  }

  function onKeyDown(event) {
    if (!open || inline) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (!menuEl) return;
    const items = Array.from(
      menuEl.querySelectorAll('[role="menuitem"]:not([disabled])')
    ).filter((el) => el instanceof HTMLElement);

    if (items.length === 0) return;

    const active = document.activeElement;
    let idx = items.findIndex((el) => el === active);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      idx = idx < 0 ? 0 : (idx + 1) % items.length;
      items[idx].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      idx = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
      items[idx].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onDocPointer, true);
    window.addEventListener('keydown', onKeyDown, true);
  }
  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', onDocPointer, true);
      window.removeEventListener('keydown', onKeyDown, true);
    }
  });

  // Focus first item when popover opens.
  $: if (open && !inline) {
    tick().then(() => {
      if (!menuEl || !open) return;
      const first = menuEl.querySelector('[role="menuitem"]');
      if (first instanceof HTMLElement) first.focus();
    });
  }

  // Reactive role gate — never snapshot canAccessStudio() once at mount.
  $: studioAccess = isAdminRole($currentUser?.role);
  $: email = String($currentUser?.email || '').trim();
</script>

{#if open || inline}
  <div
    bind:this={menuEl}
    {id}
    class="account-menu"
    class:account-menu--inline={inline}
    class:account-menu--popover={!inline}
    data-account-menu-root
    role="menu"
    aria-label="Account"
    tabindex="-1"
  >
    {#if email}
      <p class="account-menu__email" role="presentation">{email}</p>
    {/if}

    <button type="button" class="account-menu__item" role="menuitem" on:click={() => go('/account')}>
      Account
    </button>
    <button
      type="button"
      class="account-menu__item"
      role="menuitem"
      on:click={() => go('/account#continue-watching')}
    >
      Continue Watching
    </button>
    <button type="button" class="account-menu__item" role="menuitem" on:click={() => go('/account#my-list')}>
      My List
    </button>
    <button type="button" class="account-menu__item" role="menuitem" on:click={() => go('/settings')}>
      Settings
    </button>

    {#if studioAccess}
      <div class="account-menu__divider" role="separator"></div>
      <button
        type="button"
        class="account-menu__item"
        role="menuitem"
        on:click={() => openStudio('smart_production_studio')}
      >
        Smart Production Studio
      </button>
      <button
        type="button"
        class="account-menu__item"
        role="menuitem"
        on:click={() => openStudio('content_management')}
      >
        Content Management
      </button>
    {/if}

    <div class="account-menu__divider" role="separator"></div>
    <button type="button" class="account-menu__item account-menu__item--muted" role="menuitem" on:click={signOut}>
      Sign Out
    </button>
  </div>
{/if}

<style>
  .account-menu {
    min-width: 12.5rem;
    max-width: min(20rem, calc(100vw - 1.5rem));
    padding: 0.4rem;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(12, 14, 22, 0.96);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .account-menu--popover {
    position: absolute;
    top: calc(100% + 0.45rem);
    right: 0;
    z-index: 40;
    max-height: min(
      70vh,
      calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 5rem)
    );
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .account-menu--inline {
    position: static;
    width: 100%;
    min-width: 0;
    max-height: none;
    box-shadow: none;
    background: transparent;
    border: 0;
    padding: 0;
  }
  .account-menu__email {
    margin: 0.15rem 0.5rem 0.45rem;
    font-size: 0.72rem;
    color: rgba(255, 255, 255, 0.45);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .account-menu--inline .account-menu__email {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    color: rgba(255, 255, 255, 0.65);
  }
  .account-menu__item {
    text-align: left;
    border: 0;
    background: transparent;
    color: #f4f4f5;
    border-radius: 6px;
    padding: 0.55rem 0.65rem;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .account-menu__item:hover,
  .account-menu__item:focus-visible {
    background: rgba(255, 255, 255, 0.08);
    outline: none;
  }
  .account-menu__item:focus-visible {
    box-shadow: inset 0 0 0 1px rgba(0, 242, 255, 0.45);
  }
  .account-menu--inline .account-menu__item {
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.05);
    margin-bottom: 0.35rem;
  }
  .account-menu__item--muted {
    color: rgba(255, 255, 255, 0.72);
  }
  .account-menu__divider {
    height: 1px;
    margin: 0.25rem 0.35rem;
    background: rgba(255, 255, 255, 0.1);
  }
  .account-menu--inline .account-menu__divider {
    margin: 0.55rem 0;
  }
</style>
