<script>
  /**
   * Studio panel — semantic production cards for real catalog videos.
   * Presentation/derivation only by default; Manual Apply uses existing persist path.
   */
  import { onMount } from 'svelte';
  import { fetchReadyReels } from '../../lib/api/media.js';
  import { buildSemanticCardProfiles } from '../../lib/feed/semanticCardProfile.js';
  import {
    PHASE4_EXACT_MEDIA_IDENTITY
  } from '../../lib/feed/identityBackedEditorialReview.js';
  import {
    persistCreatorCategoryChoice,
    CREATOR_SHELF_OPTIONS
  } from '../../lib/feed/categorySuggestionReview.js';
  import SemanticProductionCard from './SemanticProductionCard.svelte';

  export let authHeaders = () => ({});
  export let onCategoryPersisted = () => {};
  /** Safety: default false — panel may opt in after explicit creator action */
  export let allowPersist = false;

  let busy = false;
  let error = '';
  /** @type {any[]} */
  let profiles = [];
  /** @type {string[]} */
  let missingIdentityIds = [];
  let catalogVideoCount = 0;
  let lastMessage = '';

  async function load() {
    busy = true;
    error = '';
    lastMessage = '';
    try {
      const apiRows = await fetchReadyReels(authHeaders() || {});
      const list = Array.isArray(apiRows) ? apiRows : [];
      const videos = list.filter((row) => {
        const type = String(row?.type || '').toLowerCase();
        const url = String(row?.url || row?.video_url || '');
        const cat = String(row?.category || '').toUpperCase();
        if (cat === 'HERO') return false;
        return type === 'video' || /\.mp4($|\?)/i.test(url);
      });
      catalogVideoCount = videos.length;
      profiles = (await buildSemanticCardProfiles(videos)).filter((p) => p.canAppearAsCard);

      const present = new Set(profiles.map((p) => p.identity));
      missingIdentityIds = PHASE4_EXACT_MEDIA_IDENTITY.map((r) => r.productionId).filter(
        (id) => !present.has(id)
      );
    } catch (err) {
      error = err instanceof Error ? err.message : 'Semantic cards failed to load';
      profiles = [];
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void load();
  });

  /**
   * @param {Awaited<ReturnType<typeof buildSemanticCardProfile>>} profile
   * @param {string} category
   */
  function applyManual(profile, category) {
    if (!allowPersist) {
      lastMessage = 'Manual category queued for explicit persist path (persist disabled in prep)';
      return;
    }
    if (!profile?.identity || profile.creatorLocked) {
      lastMessage = 'Blocked · creator lock or missing identity';
      return;
    }
    const saved = persistCreatorCategoryChoice(
      profile.identity,
      {
        title: profile.canonicalTitle,
        description: profile.description,
        category
      },
      {
        patchCategory: true,
        asset: { id: profile.identity, isPlaceholder: profile.isPlaceholder }
      }
    );
    if (!saved) {
      lastMessage = 'Persist blocked';
      return;
    }
    lastMessage = `Applied ${category} · ${profile.canonicalTitle}`;
    try {
      onCategoryPersisted({ id: profile.identity, category });
    } catch {
      /* ignore */
    }
    void load();
  }
</script>

<section
  class="sem-panel"
  data-semantic-production-cards
  aria-label="Semantic production cards"
>
  <div class="sem-panel__header">
    <div>
      <p class="sem-panel__eyebrow">ReelForge intelligence</p>
      <h4 class="sem-panel__title">Semantic production cards</h4>
    </div>
    <button type="button" class="sem-panel__refresh" disabled={busy} on:click|stopPropagation={() => load()}>
      {busy ? 'Loading…' : 'Refresh'}
    </button>
  </div>
  <p class="sem-panel__note">
    NLP recommends. Human decides. Cards use ReelForge metadata only — no external platform branding,
    no invented titles, no automatic category writes.
  </p>

  {#if error}
    <p class="sem-panel__error">{error}</p>
  {/if}

  <p class="sem-panel__meta" data-sem-panel-meta>
    Catalog videos {catalogVideoCount} · Cards {profiles.length}
    {#if missingIdentityIds.length}
      · Identity registry gaps {missingIdentityIds.length}
    {/if}
  </p>

  {#if missingIdentityIds.length}
    <p class="sem-panel__gap" data-sem-catalog-gap>
      Exact identity matches not currently in /api/reels (no invented cards):
      {missingIdentityIds.map((id) => id.slice(0, 8)).join(', ')}…
    </p>
  {/if}

  <div class="sem-panel__grid" data-sem-card-grid>
    {#each profiles as profile (profile.identity)}
      <SemanticProductionCard
        {profile}
        shelfOptions={CREATOR_SHELF_OPTIONS}
        onManualCategory={(category) => applyManual(profile, category)}
      />
    {/each}
  </div>

  {#if !busy && profiles.length === 0}
    <p class="sem-panel__empty">No production video cards available from current catalog.</p>
  {/if}

  {#if lastMessage}
    <p class="sem-panel__meta" aria-live="polite">{lastMessage}</p>
  {/if}
</section>

<style>
  .sem-panel {
    margin: 0.85rem 0 1.25rem;
    padding: 0.9rem;
    border-radius: 14px;
    border: 1px solid rgba(196, 165, 116, 0.28);
    background:
      radial-gradient(120% 90% at 100% 0%, rgba(196, 165, 116, 0.08), transparent 50%),
      rgba(8, 10, 16, 0.55);
  }
  .sem-panel__header {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: center;
  }
  .sem-panel__eyebrow {
    margin: 0;
    font-size: 0.58rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(196, 165, 116, 0.9);
  }
  .sem-panel__title {
    margin: 0.15rem 0 0;
    font-size: 0.95rem;
    color: #f4f1ea;
  }
  .sem-panel__note,
  .sem-panel__meta,
  .sem-panel__gap,
  .sem-panel__empty,
  .sem-panel__error {
    font-size: 0.68rem;
    color: rgba(244, 241, 234, 0.68);
  }
  .sem-panel__error {
    color: #f5a8a8;
  }
  .sem-panel__gap {
    color: #e6c989;
  }
  .sem-panel__refresh {
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 0.68rem;
    padding: 0.35rem 0.55rem;
    cursor: pointer;
  }
  .sem-panel__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.85rem;
    margin-top: 0.75rem;
  }
</style>
