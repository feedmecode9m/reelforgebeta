<script>
  import { onMount, tick } from 'svelte';
  import ConsumerChrome from '../navigation/ConsumerChrome.svelte';
  import { currentUser, isAdminRole, logout } from '../../lib/auth/index.js';
  import { requestOpenStudio } from '../../lib/auth/clientNavigate.js';
  import {
    addToWatchlist,
    fetchViewerHistory,
    fetchViewerProfile,
    fetchWatchlist,
    removeFromWatchlist,
    updateViewerProfile
  } from '../../lib/api/viewerAccount.js';
  import { queueAccountPlay } from '../../lib/viewer/pendingPlay.js';

  /** @type {(path: string) => void} */
  export let onNavigate = () => {};
  /** @type {'account' | 'settings' | 'studio'} */
  export let view = 'account';

  /** @typedef {'idle' | 'loading' | 'ready' | 'error'} SectionStatus */

  /** @type {SectionStatus} */
  let profileStatus = 'idle';
  let profileError = '';
  let profile = null;
  let displayName = '';
  let avatarPlaceholder = '';
  let profileSaveNote = '';
  let profileSaveError = false;
  let profileSaving = false;

  /** @type {SectionStatus} */
  let historyStatus = 'idle';
  let historyError = '';
  /** @type {Array<Record<string, unknown>>} */
  let historyItems = [];
  let historyBusyId = '';

  /** @type {SectionStatus} */
  let listStatus = 'idle';
  let listError = '';
  /** @type {Array<Record<string, unknown>>} */
  let watchlistItems = [];
  let listBusyId = '';

  // Role gate: studio section only for admin role holders.
  $: showStudioLinks = isAdminRole($currentUser?.role);
  $: title =
    view === 'studio' ? 'Studio' : view === 'settings' ? 'Settings' : 'Your account';
  $: accountEmail = String($currentUser?.email || profile?.email || '').trim();

  async function loadProfile() {
    profileStatus = 'loading';
    profileError = '';
    try {
      const p = await fetchViewerProfile();
      profile = p;
      displayName = p?.displayName || '';
      avatarPlaceholder =
        p?.avatarPlaceholder || (p?.email || accountEmail || 'V').charAt(0).toUpperCase();
      profileStatus = 'ready';
    } catch (err) {
      profileError = err?.message || 'Could not load your profile';
      profileStatus = 'error';
    }
  }

  async function loadHistory() {
    historyStatus = 'loading';
    historyError = '';
    try {
      // Backend already filters completed when includeCompleted is false.
      const hist = await fetchViewerHistory({ includeCompleted: false, limit: 24 });
      const items = Array.isArray(hist.items) ? hist.items : [];
      historyItems = items.filter((it) => it && !it.completed && it.reelId);
      historyStatus = 'ready';
    } catch (err) {
      historyError = err?.message || 'Could not load Continue Watching';
      historyStatus = 'error';
    }
  }

  async function loadWatchlist() {
    listStatus = 'loading';
    listError = '';
    try {
      const list = await fetchWatchlist();
      watchlistItems = Array.isArray(list.items) ? list.items : [];
      listStatus = 'ready';
    } catch (err) {
      listError = err?.message || 'Could not load My List';
      listStatus = 'error';
    }
  }

  function loadAllSections() {
    const tasks = [];
    if (view === 'account' || view === 'settings') tasks.push(loadProfile());
    if (view === 'account') {
      tasks.push(loadHistory());
      tasks.push(loadWatchlist());
    }
    return Promise.allSettled(tasks);
  }

  function scrollToHashTarget() {
    if (typeof window === 'undefined') return;
    const hash = String(window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  onMount(() => {
    loadAllSections().then(async () => {
      await tick();
      scrollToHashTarget();
    });
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('hashchange', scrollToHashTarget);
    window.addEventListener('popstate', scrollToHashTarget);
    return () => {
      window.removeEventListener('hashchange', scrollToHashTarget);
      window.removeEventListener('popstate', scrollToHashTarget);
    };
  });

  async function saveProfile() {
    profileSaveNote = '';
    profileSaveError = false;
    const name = String(displayName || '').trim();
    const av = String(avatarPlaceholder || '').trim().slice(0, 4) || (accountEmail || 'V').charAt(0);
    if (name.length > 64) {
      profileSaveNote = 'Display name must be 64 characters or fewer.';
      profileSaveError = true;
      return;
    }
    profileSaving = true;
    try {
      const res = await updateViewerProfile({
        displayName: name,
        avatarPlaceholder: av
      });
      profile = res.profile || profile;
      displayName = profile?.displayName || name;
      avatarPlaceholder = profile?.avatarPlaceholder || av;
      profileSaveNote = 'Saved';
      profileSaveError = false;
    } catch (err) {
      profileSaveNote = err?.message || 'Could not save profile';
      profileSaveError = true;
    } finally {
      profileSaving = false;
    }
  }

  /**
   * @param {Record<string, unknown>} item
   * @param {{ resume?: boolean }} [opts]
   */
  function playTitle(item, opts = {}) {
    const reelId = item?.reelId != null ? String(item.reelId) : '';
    if (!reelId) return;
    const resume = opts.resume !== false;
    queueAccountPlay({
      reelId,
      title: item.title != null ? String(item.title) : null,
      thumbnailUrl: item.thumbnailUrl != null ? String(item.thumbnailUrl) : null,
      positionSeconds: resume ? Number(item.positionSeconds) : null,
      durationSeconds:
        item.durationSeconds != null && Number.isFinite(Number(item.durationSeconds))
          ? Number(item.durationSeconds)
          : null,
      completed: item.completed === true,
      resume,
      source: resume ? 'continue_watching' : 'my_list'
    });
    onNavigate('/');
  }

  /** @param {string} reelId */
  async function removeList(reelId) {
    listBusyId = String(reelId);
    listError = '';
    try {
      await removeFromWatchlist(reelId);
      watchlistItems = watchlistItems.filter((it) => String(it.reelId) !== String(reelId));
    } catch (err) {
      listError = err?.message || 'Could not update My List';
    } finally {
      listBusyId = '';
    }
  }

  /** @param {string} reelId */
  async function addFromHistory(reelId) {
    historyBusyId = String(reelId);
    listError = '';
    try {
      await addToWatchlist(reelId);
      await loadWatchlist();
    } catch (err) {
      listError = err?.message || 'Could not update My List';
    } finally {
      historyBusyId = '';
    }
  }

  function formatTime(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n < 0) return '—';
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function progressLabel(item) {
    const pos = Number(item?.positionSeconds);
    const dur = Number(item?.durationSeconds);
    if (!Number.isFinite(pos) || pos < 0) return '';
    if (Number.isFinite(dur) && dur > 0) {
      const pct = Math.min(99, Math.max(1, Math.round((pos / dur) * 100)));
      return `${formatTime(pos)} / ${formatTime(dur)} · ${pct}%`;
    }
    return `At ${formatTime(pos)}`;
  }

  function inWatchlist(reelId) {
    return watchlistItems.some((it) => String(it.reelId) === String(reelId));
  }

  async function handleSignOut() {
    await logout();
    onNavigate('/');
  }

  function goBrowse() {
    onNavigate('/');
  }

  function formatMemberSince(value) {
    if (!value) return '';
    try {
      return new Date(value).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return '';
    }
  }
</script>

<ConsumerChrome headerVariant="solid" showFooter={true} fillViewport={true}>
  <section class="acct-shell" aria-label="Account">
    <div class="acct-card">
      <p class="acct-kicker">LOOK@ZAKANDA PRESENTS</p>
      <h1>{title}</h1>
      {#if accountEmail}
        <p class="acct-meta">{accountEmail}</p>
      {/if}

      {#if view === 'settings' || view === 'account'}
        <section class="acct-section" aria-labelledby="profile-heading">
          <h2 id="profile-heading">{view === 'settings' ? 'Your profile' : 'Profile'}</h2>

          {#if profileStatus === 'loading'}
            <p class="acct-note">Loading your profile…</p>
          {:else if profileStatus === 'error'}
            <p class="acct-error" role="alert">{profileError}</p>
            <button type="button" class="acct-btn" on:click={loadProfile}>Try again</button>
          {:else}
            {#if view === 'settings'}
              <p class="acct-note">Private to you — manage how you appear while you watch.</p>
              <dl class="acct-identity">
                <div>
                  <dt>Email</dt>
                  <dd>{accountEmail || '—'}</dd>
                </div>
                {#if profile?.createdAt}
                  <div>
                    <dt>Member since</dt>
                    <dd>{formatMemberSince(profile.createdAt)}</dd>
                  </div>
                {/if}
              </dl>
            {:else}
              <p class="acct-note">Private to your account — not a public page.</p>
            {/if}

            <label class="acct-field">
              <span>Display name</span>
              <input
                type="text"
                bind:value={displayName}
                maxlength="64"
                autocomplete="nickname"
                disabled={profileSaving}
              />
            </label>
            <label class="acct-field">
              <span>Avatar initial</span>
              <input
                type="text"
                bind:value={avatarPlaceholder}
                maxlength="4"
                disabled={profileSaving}
                aria-label="Avatar initial"
              />
            </label>
            {#if view === 'account' && profile?.createdAt}
              <p class="acct-meta">Member since {formatMemberSince(profile.createdAt)}</p>
            {/if}
            <button type="button" class="acct-btn" on:click={saveProfile} disabled={profileSaving}>
              {profileSaving ? 'Saving…' : 'Save profile'}
            </button>
            {#if profileSaveNote}
              <p class="acct-save" class:acct-save--error={profileSaveError} role="status">
                {profileSaveNote}
              </p>
            {/if}
          {/if}
        </section>
      {/if}

      {#if view === 'account'}
        <section class="acct-section" id="continue-watching" aria-labelledby="cw-heading">
          <h2 id="cw-heading">Continue Watching</h2>

          {#if historyStatus === 'loading'}
            <p class="acct-note">Loading titles you’ve started…</p>
          {:else if historyStatus === 'error'}
            <p class="acct-error" role="alert">{historyError}</p>
            <button type="button" class="acct-btn" on:click={loadHistory}>Try again</button>
          {:else if historyItems.length === 0}
            <div class="acct-empty">
              <p class="acct-note">
                Titles you start watching will appear here so you can pick up where you left off.
              </p>
              <button type="button" class="acct-btn acct-btn--primary" on:click={goBrowse}>
                Browse titles
              </button>
            </div>
          {:else}
            <ul class="acct-list">
              {#each historyItems as item (item.reelId)}
                <li class="acct-list__row">
                  {#if item.thumbnailUrl}
                    <button
                      type="button"
                      class="acct-list__thumb"
                      on:click={() => playTitle(item, { resume: true })}
                      aria-label="Resume {item.title || 'title'}"
                    >
                      <img src={item.thumbnailUrl} alt="" loading="lazy" />
                    </button>
                  {/if}
                  <div class="acct-list__body">
                    <p class="acct-list__title">{item.title || 'Untitled'}</p>
                    <p class="acct-list__sub">{progressLabel(item)}</p>
                  </div>
                  <div class="acct-list__actions">
                    <button
                      type="button"
                      class="acct-btn acct-btn--primary acct-btn--compact"
                      on:click={() => playTitle(item, { resume: true })}
                    >
                      Resume
                    </button>
                    {#if !inWatchlist(item.reelId)}
                      <button
                        type="button"
                        class="acct-link-btn"
                        disabled={historyBusyId === String(item.reelId)}
                        on:click={() => addFromHistory(item.reelId)}
                      >
                        {historyBusyId === String(item.reelId) ? 'Saving…' : 'Add to My List'}
                      </button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="acct-section" id="my-list" aria-labelledby="list-heading">
          <h2 id="list-heading">My List</h2>

          {#if listStatus === 'loading'}
            <p class="acct-note">Loading your list…</p>
          {:else if listStatus === 'error'}
            <p class="acct-error" role="alert">{listError}</p>
            <button type="button" class="acct-btn" on:click={loadWatchlist}>Try again</button>
          {:else if watchlistItems.length === 0}
            <div class="acct-empty">
              <p class="acct-note">Save titles to watch later. Nothing here yet.</p>
              <button type="button" class="acct-btn acct-btn--primary" on:click={goBrowse}>
                Browse titles
              </button>
            </div>
          {:else}
            {#if listError}
              <p class="acct-error" role="alert">{listError}</p>
            {/if}
            <ul class="acct-list">
              {#each watchlistItems as item (item.reelId)}
                <li class="acct-list__row">
                  {#if item.thumbnailUrl}
                    <button
                      type="button"
                      class="acct-list__thumb"
                      on:click={() => playTitle(item, { resume: true })}
                      aria-label="Play {item.title || 'title'}"
                    >
                      <img src={item.thumbnailUrl} alt="" loading="lazy" />
                    </button>
                  {/if}
                  <div class="acct-list__body">
                    <p class="acct-list__title">{item.title || 'Untitled'}</p>
                  </div>
                  <div class="acct-list__actions">
                    <button
                      type="button"
                      class="acct-btn acct-btn--primary acct-btn--compact"
                      on:click={() => playTitle(item, { resume: true })}
                    >
                      Play
                    </button>
                    <button
                      type="button"
                      class="acct-link-btn"
                      disabled={listBusyId === String(item.reelId)}
                      on:click={() => removeList(item.reelId)}
                    >
                      {listBusyId === String(item.reelId) ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      {#if view === 'settings'}
        <section class="acct-section" aria-labelledby="settings-session-heading">
          <h2 id="settings-session-heading">Session</h2>
          <p class="acct-note">
            You’re signed in on this device. Sign out when you’re done watching on a shared screen.
          </p>
          <button type="button" class="acct-btn" on:click={handleSignOut}>Sign Out</button>
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
            Open Studio
          </button>
        </section>
      {/if}
    </div>
  </section>
</ConsumerChrome>

<style>
  .acct-shell {
    display: grid;
    place-items: center;
    padding: var(--lz-page-pad-y, 1.5rem) var(--lz-page-pad-x, 1.25rem) 2rem;
    color: var(--lz-ink, #f4f4f5);
    background: var(--lz-atmosphere-soft, transparent);
    font-family: var(--lz-font-body, inherit);
    animation: lz-fade-rise var(--lz-duration-slow, 480ms) var(--lz-ease, ease) both;
  }
  .acct-card {
    width: min(600px, 100%);
    border: 1px solid var(--lz-border, rgba(255, 255, 255, 0.12));
    border-radius: var(--lz-radius-lg, 12px);
    padding: var(--lz-space-5, 1.75rem) var(--lz-space-4, 1.5rem);
    background: var(--lz-panel, rgba(16, 18, 28, 0.92));
    box-shadow: var(--lz-shadow-card, 0 20px 60px rgba(0, 0, 0, 0.45));
  }
  .acct-kicker {
    margin: 0 0 var(--lz-space-2, 0.5rem);
    font-family: var(--lz-font-display, inherit);
    font-size: var(--lz-size-brand, 0.68rem);
    letter-spacing: var(--lz-tracking-brand, 0.16em);
    text-transform: uppercase;
    color: var(--lz-cyan-soft, rgba(0, 242, 255, 0.88));
    font-weight: 600;
  }
  h1 {
    margin: 0 0 0.35rem;
    font-size: var(--lz-size-title, 1.5rem);
    letter-spacing: -0.01em;
  }
  h2 {
    margin: 0 0 0.45rem;
    font-size: 1.05rem;
  }
  .acct-meta {
    margin: 0 0 var(--lz-space-3, 1rem);
    color: var(--lz-ink-soft, rgba(255, 255, 255, 0.65));
    font-size: 0.9rem;
  }
  .acct-section {
    margin-bottom: var(--lz-space-5, 1.5rem);
    padding-top: var(--lz-space-3, 0.85rem);
    border-top: 1px solid var(--lz-border, rgba(255, 255, 255, 0.08));
    scroll-margin-top: 5.5rem;
  }
  .acct-identity {
    margin: 0 0 var(--lz-space-3, 1rem);
    display: grid;
    gap: var(--lz-space-2, 0.65rem);
  }
  .acct-identity dt {
    margin: 0;
    font-size: 0.72rem;
    letter-spacing: var(--lz-tracking-label, 0.04em);
    text-transform: uppercase;
    color: var(--lz-ink-dim, rgba(255, 255, 255, 0.45));
  }
  .acct-identity dd {
    margin: 0.15rem 0 0;
    font-size: 0.92rem;
    color: var(--lz-ink-soft, rgba(255, 255, 255, 0.85));
  }
  .acct-field {
    display: grid;
    gap: var(--lz-space-1, 0.35rem);
    margin-bottom: 0.75rem;
    font-size: var(--lz-size-small, 0.85rem);
    color: var(--lz-ink-soft, rgba(255, 255, 255, 0.72));
  }
  .acct-field input {
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(0, 0, 0, 0.35);
    color: #fff;
    border-radius: var(--lz-radius-md, 10px);
    padding: 0.55rem 0.7rem;
    font-family: inherit;
    font-size: var(--lz-size-body, 0.95rem);
    transition:
      border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      box-shadow var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }
  .acct-field input:focus {
    outline: none;
    border-color: rgba(0, 242, 255, 0.5);
    box-shadow: 0 0 0 1px var(--lz-focus, rgba(0, 242, 255, 0.65));
  }
  .acct-field input:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 1px;
  }
  .acct-btn {
    border: 1px solid var(--lz-border, rgba(255, 255, 255, 0.18));
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    border-radius: var(--lz-radius-md, 10px);
    padding: 0.55rem 0.8rem;
    cursor: pointer;
    font-size: var(--lz-size-small, 0.85rem);
    margin: 0.25rem 0.35rem 0.25rem 0;
    font-family: inherit;
    transition:
      border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      background var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      box-shadow var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }
  .acct-btn:hover:not(:disabled) {
    border-color: rgba(0, 242, 255, 0.45);
    background: rgba(0, 242, 255, 0.1);
  }
  .acct-btn:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
  }
  .acct-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .acct-btn--primary {
    border-color: rgba(0, 242, 255, 0.4);
    background: linear-gradient(135deg, rgba(0, 242, 255, 0.22), rgba(255, 0, 180, 0.12));
    font-weight: 600;
  }
  .acct-btn--compact {
    padding: 0.4rem 0.65rem;
    font-size: 0.8rem;
    margin: 0;
  }
  .acct-btn--accent {
    border-color: rgba(0, 242, 255, 0.4);
    background: rgba(0, 242, 255, 0.1);
  }
  .acct-empty {
    display: grid;
    gap: 0.75rem;
    justify-items: start;
  }
  .acct-note {
    margin: 0 0 0.65rem;
    color: var(--lz-ink-muted, rgba(255, 255, 255, 0.55));
    font-size: 0.9rem;
    line-height: var(--lz-leading, 1.45);
  }
  .acct-error {
    margin: 0 0 0.5rem;
    color: var(--lz-danger, #fca5a5);
    font-size: 0.9rem;
  }
  .acct-save {
    margin: 0.4rem 0 0;
    font-size: var(--lz-size-small, 0.85rem);
    color: var(--lz-cyan-soft, rgba(0, 242, 255, 0.85));
  }
  .acct-save--error {
    color: var(--lz-danger, #fca5a5);
  }
  .acct-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--lz-space-2, 0.55rem);
  }
  .acct-list__row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.65rem;
    border-radius: var(--lz-radius-md, 10px);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--lz-border, rgba(255, 255, 255, 0.08));
    transition: border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }
  .acct-list__row:hover {
    border-color: rgba(0, 242, 255, 0.2);
  }
  .acct-list__thumb {
    flex-shrink: 0;
    width: 3.4rem;
    height: 3.4rem;
    border: 0;
    padding: 0;
    border-radius: var(--lz-radius-sm, 6px);
    overflow: hidden;
    background: rgba(0, 0, 0, 0.35);
    cursor: pointer;
  }
  .acct-list__thumb:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
  }
  .acct-list__thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .acct-list__body {
    flex: 1 1 auto;
    min-width: 0;
  }
  .acct-list__title {
    margin: 0;
    font-size: 0.9rem;
  }
  .acct-list__sub {
    margin: 0.15rem 0 0;
    font-size: var(--lz-size-caption, 0.75rem);
    color: var(--lz-ink-dim, rgba(255, 255, 255, 0.5));
  }
  .acct-list__actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .acct-link-btn {
    border: 0;
    background: transparent;
    color: var(--lz-cyan-soft, rgba(0, 242, 255, 0.9));
    cursor: pointer;
    font-size: 0.78rem;
    white-space: nowrap;
    padding: 0.15rem 0;
    font-family: inherit;
  }
  .acct-link-btn:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
    border-radius: 2px;
  }
  .acct-link-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (max-width: 520px) {
    .acct-list__row {
      flex-wrap: wrap;
    }
    .acct-list__actions {
      width: 100%;
      flex-direction: row;
      justify-content: flex-end;
      align-items: center;
      gap: 0.55rem;
    }
  }
</style>
