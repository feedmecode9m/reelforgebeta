<script>
  /**
   * Creator episode presentation package (title / description / artwork).
   * Shown after Hero Vault identity is complete — never exposes parser internals.
   */
  import { createEventDispatcher } from 'svelte';
  import { presentVaultEpisodeEnrichmentForCreator } from '../../lib/series/vaultEpisodeEnrichment.js';

  /** @type {Record<string, unknown> | null} */
  export let asset = null;
  /** When false, hide panel. */
  export let active = true;

  const dispatch = createEventDispatcher();

  /** @type {boolean} */
  let editing = false;
  /** @type {string} */
  let draftTitle = '';
  /** @type {string} */
  let draftDescription = '';
  /** @type {string} */
  let draftArtwork = '';
  /** @type {string} */
  let formError = '';

  $: presentation = active && asset ? presentVaultEpisodeEnrichmentForCreator(asset) : null;
  $: show = Boolean(presentation?.identityConfirmed);

  function stopDrag(event) {
    event?.stopPropagation?.();
  }

  function openEdit() {
    if (!presentation) return;
    draftTitle = presentation.title || '';
    draftDescription = presentation.description || '';
    draftArtwork = presentation.artworkUrl || '';
    formError = '';
    editing = true;
  }

  function cancelEdit() {
    editing = false;
    formError = '';
  }

  function submitSave() {
    formError = '';
    dispatch('save', {
      mediaAssetId: presentation?.mediaAssetId || '',
      title: String(draftTitle || '').trim(),
      description: String(draftDescription || '').trim(),
      artworkUrl: String(draftArtwork || '').trim()
    });
    editing = false;
  }
</script>

{#if active && show && presentation}
  <div
    class="vault-episode-enrich"
    class:vault-episode-enrich--editing={editing}
    class:vault-episode-enrich--filled={presentation.hasEnrichment}
    role="region"
    aria-label="Episode package"
    on:pointerdown={stopDrag}
    on:mousedown={stopDrag}
    on:touchstart={stopDrag}
    on:dragstart|stopPropagation|preventDefault
  >
    <div class="vault-episode-enrich__episode">
      <span class="vault-episode-enrich__key">Episode</span>
      <span class="vault-episode-enrich__line">{presentation.episodeLine}</span>
    </div>

    {#if !editing}
      <div class="vault-episode-enrich__row">
        <span class="vault-episode-enrich__key">Title</span>
        <span class="vault-episode-enrich__val"
          >{presentation.title || '—'}</span
        >
      </div>
      <div class="vault-episode-enrich__row vault-episode-enrich__row--desc">
        <span class="vault-episode-enrich__key">Description</span>
        <span class="vault-episode-enrich__val"
          >{presentation.description
            ? presentation.description.length > 72
              ? `${presentation.description.slice(0, 72)}…`
              : presentation.description
            : '—'}</span
        >
      </div>
      <div class="vault-episode-enrich__row">
        <span class="vault-episode-enrich__key">Artwork</span>
        <span class="vault-episode-enrich__val"
          >{presentation.artworkUrl ? 'Set' : '—'}</span
        >
      </div>
      {#if presentation.artworkUrl}
        <div class="vault-episode-enrich__art-preview" aria-hidden="true">
          <img src={presentation.artworkUrl} alt="" loading="lazy" />
        </div>
      {/if}
      <button
        type="button"
        class="vault-episode-enrich__btn"
        on:click|stopPropagation|preventDefault={openEdit}
      >
        {presentation.hasEnrichment ? 'Edit episode package' : 'Add episode package'}
      </button>
    {:else}
      <p class="vault-episode-enrich__lead">Complete this episode package:</p>
      <label class="vault-episode-enrich__field">
        <span>Title</span>
        <input
          type="text"
          bind:value={draftTitle}
          maxlength="200"
          autocomplete="off"
          placeholder="Episode title"
          on:pointerdown={stopDrag}
        />
      </label>
      <label class="vault-episode-enrich__field">
        <span>Description</span>
        <textarea
          rows="3"
          bind:value={draftDescription}
          maxlength="4000"
          placeholder="Short description"
          on:pointerdown={stopDrag}
        ></textarea>
      </label>
      <label class="vault-episode-enrich__field">
        <span>Artwork</span>
        <input
          type="url"
          bind:value={draftArtwork}
          autocomplete="off"
          placeholder="Image URL or /thumbs/…"
          on:pointerdown={stopDrag}
        />
      </label>
      {#if formError}
        <p class="vault-episode-enrich__error">{formError}</p>
      {/if}
      <div class="vault-episode-enrich__actions">
        <button
          type="button"
          class="vault-episode-enrich__btn vault-episode-enrich__btn--primary"
          on:click|stopPropagation|preventDefault={submitSave}
        >
          Save package
        </button>
        <button
          type="button"
          class="vault-episode-enrich__btn vault-episode-enrich__btn--ghost"
          on:click|stopPropagation|preventDefault={cancelEdit}
        >
          Cancel
        </button>
      </div>
    {/if}
  </div>
{/if}
