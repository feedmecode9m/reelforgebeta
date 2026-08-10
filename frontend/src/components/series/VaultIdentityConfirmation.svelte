<script>
  /**
   * Creator-facing Hero Vault identity card.
   * Viewer-safe copy only — no confidence / parser / validator language.
   */
  import { createEventDispatcher } from 'svelte';
  import { presentVaultIdentityForCreator } from '../../lib/series/vaultIdentityConfirmation.js';

  /** @type {Record<string, unknown> | null} */
  export let asset = null;
  /** When false, hide panel (upload states, ghosts). */
  export let active = true;

  const dispatch = createEventDispatcher();

  /** @type {boolean} */
  let editing = false;
  /** @type {string} */
  let draftSeries = '';
  /** @type {string} */
  let draftSeason = '1';
  /** @type {string} */
  let draftEpisode = '1';
  /** @type {string} */
  let formError = '';

  $: presentation = active && asset ? presentVaultIdentityForCreator(asset) : null;

  function stopDrag(event) {
    event?.stopPropagation?.();
  }

  function openEdit() {
    if (!presentation) return;
    draftSeries = presentation.seriesLabel || '';
    draftSeason = String(presentation.seasonNumber || 1);
    draftEpisode = String(presentation.episodeNumber || 1);
    formError = '';
    editing = true;
  }

  function cancelEdit() {
    editing = false;
    formError = '';
  }

  function submitConfirm() {
    formError = '';
    const seriesLabel = String(draftSeries || '').trim();
    const seasonNumber = Number(draftSeason);
    const episodeNumber = Number(draftEpisode);
    if (!seriesLabel) {
      formError = 'Enter a series title';
      return;
    }
    if (!Number.isFinite(seasonNumber) || seasonNumber < 1) {
      formError = 'Season must be 1 or higher';
      return;
    }
    if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
      formError = 'Episode must be 1 or higher';
      return;
    }
    dispatch('confirm', {
      seriesLabel,
      seasonNumber: Math.floor(seasonNumber),
      episodeNumber: Math.floor(episodeNumber),
      mediaAssetId: presentation?.mediaAssetId || ''
    });
    editing = false;
  }
</script>

{#if active && presentation}
  <div
    class="vault-identity-confirm"
    class:vault-identity-confirm--needs={presentation.needsConfirmation}
    class:vault-identity-confirm--editing={editing}
    role="region"
    aria-label="Episode identity"
    on:pointerdown={stopDrag}
    on:mousedown={stopDrag}
    on:touchstart={stopDrag}
    on:dragstart|stopPropagation|preventDefault
  >
    {#if !editing}
      <div class="vault-identity-confirm__row">
        <span class="vault-identity-confirm__key">Series</span>
        <span class="vault-identity-confirm__val">{presentation.seriesDisplay}</span>
      </div>
      <div class="vault-identity-confirm__row">
        <span class="vault-identity-confirm__key">Season</span>
        <span class="vault-identity-confirm__val">{presentation.seasonDisplay}</span>
      </div>
      <div class="vault-identity-confirm__row">
        <span class="vault-identity-confirm__key">Episode</span>
        <span class="vault-identity-confirm__val">{presentation.episodeDisplay}</span>
      </div>
      <div class="vault-identity-confirm__row vault-identity-confirm__row--status">
        <span class="vault-identity-confirm__key">Identity</span>
        <span class="vault-identity-confirm__val">{presentation.statusLabel}</span>
      </div>
      <button
        type="button"
        class="vault-identity-confirm__btn"
        on:click|stopPropagation|preventDefault={openEdit}
      >
        {presentation.needsConfirmation ? 'Confirm identity' : 'Edit identity'}
      </button>
    {:else}
      <p class="vault-identity-confirm__lead">This file belongs to:</p>
      <label class="vault-identity-confirm__field">
        <span>Series title</span>
        <input
          type="text"
          bind:value={draftSeries}
          autocomplete="off"
          spellcheck="false"
          on:pointerdown={stopDrag}
        />
      </label>
      <div class="vault-identity-confirm__pair">
        <label class="vault-identity-confirm__field">
          <span>Season</span>
          <input
            type="number"
            min="1"
            step="1"
            bind:value={draftSeason}
            on:pointerdown={stopDrag}
          />
        </label>
        <label class="vault-identity-confirm__field">
          <span>Episode</span>
          <input
            type="number"
            min="1"
            step="1"
            bind:value={draftEpisode}
            on:pointerdown={stopDrag}
          />
        </label>
      </div>
      {#if formError}
        <p class="vault-identity-confirm__error">{formError}</p>
      {/if}
      <div class="vault-identity-confirm__actions">
        <button
          type="button"
          class="vault-identity-confirm__btn vault-identity-confirm__btn--primary"
          on:click|stopPropagation|preventDefault={submitConfirm}
        >
          Save confirmation
        </button>
        <button
          type="button"
          class="vault-identity-confirm__btn vault-identity-confirm__btn--ghost"
          on:click|stopPropagation|preventDefault={cancelEdit}
        >
          Cancel
        </button>
      </div>
    {/if}
  </div>
{/if}
