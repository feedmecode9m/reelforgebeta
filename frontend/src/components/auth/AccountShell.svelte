<script>
  import { onMount, tick } from 'svelte';
  import ConsumerChrome from '../navigation/ConsumerChrome.svelte';
  import {
    currentUser,
    isAdminRole,
    logout
  } from '../../lib/auth/index.js';
  import { requestOpenStudio } from '../../lib/auth/clientNavigate.js';
  import {
    addToWatchlist,
    fetchViewerHistory,
    fetchViewerProfile,
    fetchWatchlist,
    removeFromWatchlist,
    updateViewerProfile
  } from '../../lib/api/viewerAccount.js';

  /** @type {(path: string) => void} */
  export let onNavigate = () => {};
  /** @type {'account' | 'settings' | 'studio'} */
  export let view = 'account';

  let loading = true;
  let error = '';
  let saveNote = '';
  let profile = null;
  let historyItems = [];
  let watchlistItems = [];
  let displayName = '';
  let avatarPlaceholder = '';

  // Reactive role gate (admin-only studio affordances).
  $: showStudioLinks = isAdminRole($currentUser?.role);
  $: title =
    view === 'studio'
      ? 'Studio'
      : view === 'settings'
        ? 'Settings'
        : 'Your account';

  async function loadAll() {
    loading = true;
    error = '';
    try {
      const [p, hist, list] = await Promise.all([
        fetchViewerProfile(),
        fetchViewerHistory({ includeCompleted: false, limit: 24 }),
        fetchWatchlist()
      ]);
      profile = p;
      displayName = p?.displayName || '';
      avatarPlaceholder = p?.avatarPlaceholder || (p?.email || 'V').charAt(0).toUpperCase();
      historyItems = hist.items || [];
      watchlistItems = list.items || [];
    } catch (err) {
      error = err?.message || 'Could not load account';
    } finally {
      loading = false;
    }
  }

  function scrollToHashTarget() {
    if (typeof window === 'undefined') return;
    const hash = String(window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  onMount(() => {
    loadAll().then(async () => {
      await tick();
      scrollToHashTarget();
    });
    if (typeof window === 'undefined') return undefined;
    // pushState does not fire hashchange — listen to popstate from clientNavigate too.
    window.addEventListener('hashchange', scrollToHashTarget);
    window.addEventListener('popstate', scrollToHashTarget);
    return () => {
      window.removeEventListener('hashchange', scrollToHashTarget);
      window.removeEventListener('popstate', scrollToHashTarget);
    };
  });

  async function saveProfile() {
    saveNote = '';
    try {
      const res = await updateViewerProfile({
        displayName,
        avatarPlaceholder
      });
      profile = res.profile || profile;
      saveNote = 'Saved';
    } catch (err) {
      saveNote = err?.message || 'Save failed';
    }
  }

  /** @param {string} reelId */
  async function removeList(reelId) {
    try {
      await removeFromWatchlist(reelId);
      watchlistItems = watchlistItems.filter((it) => String(it.reelId) !== String(reelId));
    } catch (err) {
      error = err?.message || 'Could not update My List';
    }
  }

  /** @param {string} reelId */
  async function addFromHistory(reelId) {
    try {
      await addToWatchlist(reelId);
      await loadAll();
    } catch (err) {
      error = err?.message || 'Could not update My List';
    }
  }

  function formatTime(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n < 0) return '—';
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function inWatchlist(reelId) {
    return watchlistItems.some((it) => String(it.reelId) === String(reelId));
  }

  async function handleSignOut() {
    await logout();
    onNavigate('/');
  }
</script>

<ConsumerChrome headerVariant="solid" showFooter={true} fillViewport={true}>
  <section class="acct-shell" aria-label="Account">
    <div class="acct-card">
      <h1>{title}</h1>
      {#if $currentUser?.email}
        <p class="acct-meta">{$currentUser.email}</p>
      {/if}

      {#if loading}
        <p class="acct-note">Loading your account…</p>
      {:else if error}
        <p class="acct-error">{error}</p>
        <button type="button" class="acct-btn" on:click={loadAll}>Try again</button>
      {:else}
        {#if view === 'settings' || view === 'account'}
          <section class="acct-section" aria-labelledby="profile-heading">
            <h2 id="profile-heading">Profile</h2>
            <p class="acct-note">Private to your account — not a public page.</p>
            <label class="acct-field">
              <span>Display name</span>
              <input type="text" bind:value={displayName} maxlength="64" autocomplete="nickname" />
            </label>
            <label class="acct-field">
              <span>Avatar initial</span>
              <input type="text" bind:value={avatarPlaceholder} maxlength="4" />
            </label>
            {#if profile?.createdAt}
              <p class="acct-meta">Member since {new Date(profile.createdAt).toLocaleDateString()}</p>
            {/if}
            <button type="button" class="acct-btn" on:click={saveProfile}>Save profile</button>
            {#if saveNote}
              <p class="acct-save">{saveNote}</p>
            {/if}
          </section>
        {/if}

        {#if view === 'account'}
          <section
            class="acct-section"
            id="continue-watching"
            aria-labelledby="cw-heading"
          >
            <h2 id="cw-heading">Continue Watching</h2>
            {#if historyItems.length === 0}
              <p class="acct-note">Titles you start watching will appear here so you can pick up where you left off.</p>
            {:else}
              <ul class="acct-list">
                {#each historyItems as item (item.reelId)}
                  <li class="acct-list__row">
                    <div>
                      <p class="acct-list__title">{item.title || 'Untitled'}</p>
                      <p class="acct-list__sub">
                        {formatTime(item.positionSeconds)}
                        {#if item.durationSeconds}
                          / {formatTime(item.durationSeconds)}
                        {/if}
                      </p>
                    </div>
                    {#if !inWatchlist(item.reelId)}
                      <button type="button" class="acct-link-btn" on:click={() => addFromHistory(item.reelId)}>
                        Add to My List
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

          <section class="acct-section" id="my-list" aria-labelledby="list-heading">
            <h2 id="list-heading">My List</h2>
            {#if watchlistItems.length === 0}
              <p class="acct-note">Save titles to watch later. Nothing here yet.</p>
            {:else}
              <ul class="acct-list">
                {#each watchlistItems as item (item.reelId)}
                  <li class="acct-list__row">
                    <p class="acct-list__title">{item.title || 'Untitled'}</p>
                    <button type="button" class="acct-link-btn" on:click={() => removeList(item.reelId)}>
                      Remove
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}

        {#if view === 'settings'}
          <section class="acct-section">
            <h2>Settings</h2>
            <p class="acct-note">
              Manage how you sign in and watch on LOOK@ZAKANDA PRESENTS. Content is curated for you.
            </p>
            <button type="button" class="acct-btn acct-home--muted" on:click={handleSignOut}>Sign Out</button>
          </section>
        {/if}

        {#if view === 'studio' && showStudioLinks}
          <section class="acct-section">
            <h2>Studio</h2>
            <p class="acct-note">Open tools from your account menu when signed in.</p>
            <button
              type="button"
              class="acct-btn acct-btn--accent"
              on:click={() => {
                onNavigate('/');
                requestAnimationFrame(() => requestOpenStudio('account_shell'));
              }}
            >
              Open Smart Production Studio
            </button>
          </section>
        {/if}
      {/if}
    </div>
  </section>
</ConsumerChrome>

<style>
  .acct-shell {
    display: grid;
    place-items: center;
    padding: 1.5rem 1rem 2rem;
    color: #f4f4f5;
  }
  .acct-card {
    width: min(560px, 100%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 1.75rem 1.5rem;
    background: rgba(16, 18, 28, 0.92);
  }
  h1 {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
  }
  h2 {
    margin: 0 0 0.45rem;
    font-size: 1.05rem;
  }
  .acct-meta {
    margin: 0 0 1rem;
    color: rgba(255, 255, 255, 0.65);
    font-size: 0.9rem;
  }
  .acct-section {
    margin-bottom: 1.5rem;
    padding-top: 0.25rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    scroll-margin-top: 5.5rem;
  }
  .acct-field {
    display: grid;
    gap: 0.35rem;
    margin-bottom: 0.75rem;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.72);
  }
  .acct-field input {
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    border-radius: 8px;
    padding: 0.55rem 0.7rem;
  }
  .acct-btn {
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    border-radius: 8px;
    padding: 0.55rem 0.8rem;
    cursor: pointer;
    font-size: 0.85rem;
    margin: 0.35rem 0.35rem 0.35rem 0;
  }
  .acct-btn--accent {
    border-color: rgba(0, 242, 255, 0.4);
    background: rgba(0, 242, 255, 0.1);
  }
  .acct-home--muted {
    color: rgba(255, 255, 255, 0.72);
  }
  .acct-note {
    margin: 0 0 0.65rem;
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .acct-error {
    color: #fca5a5;
    font-size: 0.9rem;
  }
  .acct-save {
    margin: 0.4rem 0 0;
    font-size: 0.85rem;
    color: rgba(0, 242, 255, 0.85);
  }
  .acct-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .acct-list__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.55rem 0.65rem;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .acct-list__title {
    margin: 0;
    font-size: 0.9rem;
  }
  .acct-list__sub {
    margin: 0.15rem 0 0;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.5);
  }
  .acct-link-btn {
    border: 0;
    background: transparent;
    color: rgba(0, 242, 255, 0.9);
    cursor: pointer;
    font-size: 0.78rem;
    white-space: nowrap;
  }
</style>
