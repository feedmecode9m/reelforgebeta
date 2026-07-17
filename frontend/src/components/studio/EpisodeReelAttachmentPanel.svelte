<script>
  import { get } from 'svelte/store';
  import { seriesCatalog } from '../../lib/series/seriesStore.js';
  import { isHeroAsset } from '../../lib/hero/heroDomainGuard.js';
  import { isVideoReel } from '../../lib/api/reelContract.js';
  import {
    flattenCatalogEpisodes,
    performEpisodeReelAttach,
    reelDisplayName,
    reelStatusLabel
  } from '../../lib/studio/episodeReelAttachment.js';
  import { emitCreatorProductionUpdated } from '../../lib/studio/creatorActionRouter.js';

  /** @type {import('svelte/store').Writable<string>} */
  export let uploadStatus;
  /** @type {import('svelte/store').Writable<string>} */
  export let studioAttachEpisodeId;
  /** @type {import('svelte/store').Writable<string>} */
  export let studioAttachReelId;
  /** @type {unknown[]} */
  export let personalVideos = [];
  /** @type {Record<string, unknown> | null} */
  export let studioProjectTree = null;
  /** @type {() => Promise<void>} */
  export let loadStudioHierarchy = async () => {};
  /** @type {() => void} */
  export let onAttached = () => {};

  let selectedEpisodeId = '';
  let selectedReelId = '';
  let pendingReplace = false;
  let attaching = false;
  let successMessage = '';
  let errorMessage = '';

  $: episodeOptions = flattenCatalogEpisodes($seriesCatalog);
  $: vaultReels = (personalVideos || []).filter(
    (reel) => isVideoReel(reel) && !isHeroAsset(reel)
  );
  $: selectedEpisode = episodeOptions.find((e) => e.episodeId === selectedEpisodeId) || null;
  $: selectedReel = vaultReels.find((r) => String(r?.id) === selectedReelId) || null;
  $: existingReelForEpisode = selectedEpisode?.reelId
    ? vaultReels.find((r) => String(r?.id) === selectedEpisode.reelId) ||
      { id: selectedEpisode.reelId, name: selectedEpisode.reelId }
    : null;

  $: if ($studioAttachEpisodeId && !selectedEpisodeId) {
    selectedEpisodeId = $studioAttachEpisodeId;
  }
  $: if ($studioAttachReelId && !selectedReelId) {
    selectedReelId = $studioAttachReelId;
  }

  function reelThumb(reel) {
    return (
      reel?.thumbnailUrl ||
      reel?.thumbnail_url ||
      reel?.normalized_thumbnail ||
      reel?.thumbnail ||
      ''
    );
  }

  async function handleAttach(replaceExisting = false) {
    errorMessage = '';
    successMessage = '';
    if (!selectedEpisodeId) {
      errorMessage = 'Choose an episode to attach media';
      return;
    }
    if (!selectedReelId) {
      errorMessage = 'Select a vault reel to attach';
      return;
    }

    attaching = true;
    try {
      const result = await performEpisodeReelAttach(
        selectedEpisodeId,
        selectedReelId,
        studioProjectTree,
        { replaceExisting: replaceExisting || pendingReplace }
      );

      if (result.needsReplaceConfirm) {
        pendingReplace = true;
        errorMessage = '';
        return;
      }

      pendingReplace = false;
      successMessage = 'Reel attached successfully';
      uploadStatus.set(`✅ Episode updated — reel attached (${result.episodeLabel})`);
      const attachedEpisodeId = selectedEpisodeId;
      studioAttachEpisodeId.set('');
      studioAttachReelId.set('');
      await loadStudioHierarchy();
      onAttached();
      emitCreatorProductionUpdated({
        episodeId: attachedEpisodeId,
        reelId: selectedReelId,
        actionType: 'missing-asset',
        source: 'production-attach-panel'
      });
    } catch (err) {
      errorMessage = err?.message || 'Attachment failed';
      uploadStatus.set(`❌ ${errorMessage}`);
    } finally {
      attaching = false;
    }
  }

  function cancelReplace() {
    pendingReplace = false;
    errorMessage = '';
  }
</script>

<section
  class="episode-reel-attach-panel"
  data-episode-reel-attach
  data-testid="episode-reel-attach-panel"
  aria-labelledby="episode-reel-attach-heading"
>
  <div class="smart-header">
    <div class="ai-badge">🔗 EPISODE ASSET LINK</div>
    <h3 id="episode-reel-attach-heading">Attach Vault Reel to Episode</h3>
    <p class="smart-subtitle">
      Connect uploaded media to a series episode — no new upload required
    </p>
  </div>

  <ol class="episode-reel-attach-steps">
    <li class="episode-reel-attach-step">
      <h4 class="episode-reel-attach-step-title">Step 1 — Select Episode</h4>
      {#if episodeOptions.length === 0}
        <p class="episode-reel-attach-empty">No episodes in catalog. Create a series and episodes first.</p>
      {:else}
        <label class="input-label-wrapper">
          Episode
          <select bind:value={selectedEpisodeId} data-episode-select data-testid="episode-reel-select">
            <option value="">Select episode…</option>
            {#each episodeOptions as ep (ep.episodeId)}
              <option value={ep.episodeId}>
                {ep.label}{#if ep.reelId} (has reel){/if}
              </option>
            {/each}
          </select>
        </label>
        {#if !selectedEpisodeId}
          <p class="episode-reel-attach-hint">No episode selected — choose an episode to attach media</p>
        {:else if selectedEpisode}
          <p class="episode-reel-attach-meta">
            {selectedEpisode.seriesTitle} · Season {selectedEpisode.seasonNumber}
          </p>
        {/if}
      {/if}
    </li>

    <li class="episode-reel-attach-step">
      <h4 class="episode-reel-attach-step-title">Step 2 — Select Vault Reel</h4>
      {#if vaultReels.length === 0}
        <p class="episode-reel-attach-empty">No reels available — upload media to your Vault first</p>
      {:else}
        <p class="episode-reel-attach-hint">Your Vault</p>
        <ul
          class="episode-reel-attach-reel-grid"
          role="listbox"
          aria-label="Vault reels"
          data-testid="vault-reel-select"
        >
          {#each vaultReels as reel (reel.id)}
            <li>
              <button
                type="button"
                class="episode-reel-attach-reel-card"
                class:episode-reel-attach-reel-card--selected={selectedReelId === String(reel.id)}
                data-reel-id={reel.id}
                data-testid="vault-reel-option"
                data-action="select-vault-reel"
                on:click={() => {
                  selectedReelId = String(reel.id);
                  pendingReplace = false;
                }}
              >
                <div class="episode-reel-attach-reel-thumb">
                  {#if reelThumb(reel)}
                    <img src={reelThumb(reel)} alt="" loading="lazy" />
                  {:else}
                    <span class="episode-reel-attach-reel-thumb-fallback">▶</span>
                  {/if}
                </div>
                <div class="episode-reel-attach-reel-meta">
                  <strong>{reelDisplayName(reel)}</strong>
                  <span>{reelStatusLabel(reel)}</span>
                </div>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </li>

    <li class="episode-reel-attach-step">
      <h4 class="episode-reel-attach-step-title">Step 3 — Attach</h4>

      {#if pendingReplace && existingReelForEpisode}
        <div class="episode-reel-attach-replace" role="alert">
          <p>
            Episode already contains:
            <strong>{reelDisplayName(existingReelForEpisode)}</strong>
          </p>
          <p>Replace attachment?</p>
          <div class="episode-reel-attach-replace-actions">
            <button
              type="button"
              class="batch-upload-btn episode-reel-attach-btn"
              data-testid="attach-reel-replace"
              data-action="replace-episode-reel"
              disabled={attaching}
              on:click={() => handleAttach(true)}
            >
              Replace attachment
            </button>
            <button type="button" class="quick-upload-btn" on:click={cancelReplace}>Cancel</button>
          </div>
        </div>
      {:else}
        {#if selectedEpisode?.reelId && selectedReelId && selectedEpisode.reelId !== selectedReelId}
          <p class="episode-reel-attach-warn">
            This episode already has a reel linked. Attach will prompt to replace.
          </p>
        {/if}
        <button
          type="button"
          class="batch-upload-btn episode-reel-attach-btn"
          data-testid="attach-reel-to-episode"
          data-action="attach-reel-to-episode"
          disabled={attaching || !selectedEpisodeId || !selectedReelId}
          on:click={() => handleAttach(false)}
        >
          {attaching ? 'Attaching…' : 'Attach Reel To Episode'}
        </button>
      {/if}

      {#if successMessage}
        <p class="episode-reel-attach-success" role="status" data-testid="attach-reel-success">
          {successMessage} — Episode updated
        </p>
      {/if}
      {#if errorMessage}
        <p class="episode-reel-attach-error" role="alert">{errorMessage}</p>
      {/if}
    </li>
  </ol>
</section>

<style>
  .episode-reel-attach-panel {
    margin-bottom: 1.75rem;
    padding: 1.25rem 1.35rem;
    border-radius: 12px;
    border: 1px solid rgba(0, 255, 200, 0.22);
    background: linear-gradient(145deg, rgba(8, 24, 32, 0.92), rgba(12, 18, 28, 0.88));
  }

  .episode-reel-attach-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .episode-reel-attach-step-title {
    margin: 0 0 0.65rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: rgba(0, 255, 200, 0.9);
  }

  .episode-reel-attach-hint,
  .episode-reel-attach-meta,
  .episode-reel-attach-empty,
  .episode-reel-attach-warn {
    margin: 0.35rem 0 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.62);
  }

  .episode-reel-attach-empty {
    color: rgba(255, 180, 100, 0.95);
  }

  .episode-reel-attach-reel-grid {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.65rem;
  }

  .episode-reel-attach-reel-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    padding: 0.5rem;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.35);
    cursor: pointer;
    text-align: left;
    color: inherit;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .episode-reel-attach-reel-card:hover,
  .episode-reel-attach-reel-card--selected {
    border-color: rgba(0, 255, 200, 0.55);
    box-shadow: 0 0 0 1px rgba(0, 255, 200, 0.25);
  }

  .episode-reel-attach-reel-thumb {
    aspect-ratio: 16 / 10;
    border-radius: 6px;
    overflow: hidden;
    background: #1a1a1a;
    display: grid;
    place-items: center;
  }

  .episode-reel-attach-reel-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .episode-reel-attach-reel-thumb-fallback {
    font-size: 1.5rem;
    opacity: 0.5;
  }

  .episode-reel-attach-reel-meta {
    margin-top: 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.75rem;
  }

  .episode-reel-attach-reel-meta strong {
    font-size: 0.8rem;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .episode-reel-attach-reel-meta span {
    color: rgba(255, 255, 255, 0.5);
    text-transform: capitalize;
  }

  .episode-reel-attach-btn {
    margin-top: 0.35rem;
  }

  .episode-reel-attach-success {
    margin: 0.65rem 0 0;
    color: rgba(100, 255, 160, 0.95);
    font-size: 0.85rem;
  }

  .episode-reel-attach-error {
    margin: 0.65rem 0 0;
    color: rgba(255, 120, 120, 0.95);
    font-size: 0.85rem;
  }

  .episode-reel-attach-replace {
    padding: 0.75rem;
    border-radius: 8px;
    background: rgba(255, 160, 60, 0.08);
    border: 1px solid rgba(255, 160, 60, 0.35);
  }

  .episode-reel-attach-replace-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
    flex-wrap: wrap;
  }
</style>
