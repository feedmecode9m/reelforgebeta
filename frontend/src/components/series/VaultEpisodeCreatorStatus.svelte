<script>
  /**
   * Unified Hero Vault creator completeness card.
   * Clarity for identity + package + media + publish — no parser/confidence language.
   */
  import { createEventDispatcher } from 'svelte';
  import { presentVaultEpisodeCompleteness } from '../../lib/series/creatorExperiencePresentation.js';

  /** @type {Record<string, unknown> | null} */
  export let asset = null;
  export let active = true;

  const dispatch = createEventDispatcher();

  /** @type {null | 'identity' | 'package'} */
  let editing = null;
  let draftSeries = '';
  let draftSeason = '1';
  let draftEpisode = '1';
  let draftTitle = '';
  let draftDescription = '';
  let draftArtwork = '';
  let formError = '';

  $: model = active && asset ? presentVaultEpisodeCompleteness(asset) : null;

  function stopDrag(event) {
    event?.stopPropagation?.();
  }

  function openIdentity() {
    if (!model) return;
    draftSeries = model.series || '';
    draftSeason = String(model.season || 1);
    draftEpisode = String(model.episode || 1);
    formError = '';
    editing = 'identity';
  }

  function openPackage() {
    if (!model) return;
    draftTitle = model.presentation.title || '';
    draftDescription = model.presentation.description || '';
    draftArtwork = model.presentation.artworkUrl || '';
    formError = '';
    editing = 'package';
  }

  function cancelEdit() {
    editing = null;
    formError = '';
  }

  function submitIdentity() {
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
    dispatch('confirmIdentity', {
      seriesLabel,
      seasonNumber: Math.floor(seasonNumber),
      episodeNumber: Math.floor(episodeNumber),
      mediaAssetId: model?.mediaAssetId || ''
    });
    editing = null;
  }

  function submitPackage() {
    formError = '';
    dispatch('savePackage', {
      mediaAssetId: model?.mediaAssetId || '',
      title: String(draftTitle || '').trim(),
      description: String(draftDescription || '').trim(),
      artworkUrl: String(draftArtwork || '').trim()
    });
    editing = null;
  }

  /** @param {boolean} ok */
  function mark(ok) {
    return ok ? '✓' : '○';
  }
</script>

{#if active && model}
  <div
    class="vault-creator-card"
    class:vault-creator-card--incomplete={!model.complete}
    class:vault-creator-card--editing={Boolean(editing)}
    role="region"
    aria-label="Episode package status"
    data-vault-creator-completeness
    data-media-asset-id={model.mediaAssetId || undefined}
    data-identity-ready={model.identity.ready ? 'true' : 'false'}
    data-presentation-ready={model.presentation.ready ? 'true' : 'false'}
    data-media={model.media.state}
    data-publishing={model.publishing.status}
    on:pointerdown={stopDrag}
    on:mousedown={stopDrag}
    on:touchstart={stopDrag}
    on:dragstart|stopPropagation|preventDefault
  >
    {#if editing === 'identity'}
      <p class="vault-creator-card__lead">This file belongs to:</p>
      <label class="vault-creator-card__field">
        <span>Series</span>
        <input type="text" bind:value={draftSeries} autocomplete="off" spellcheck="false" />
      </label>
      <div class="vault-creator-card__pair">
        <label class="vault-creator-card__field">
          <span>Season</span>
          <input type="number" min="1" step="1" bind:value={draftSeason} />
        </label>
        <label class="vault-creator-card__field">
          <span>Episode</span>
          <input type="number" min="1" step="1" bind:value={draftEpisode} />
        </label>
      </div>
      {#if formError}<p class="vault-creator-card__error">{formError}</p>{/if}
      <div class="vault-creator-card__actions">
        <button type="button" class="vault-creator-card__btn vault-creator-card__btn--primary" on:click|stopPropagation|preventDefault={submitIdentity}
          >Save confirmation</button
        >
        <button type="button" class="vault-creator-card__btn vault-creator-card__btn--ghost" on:click|stopPropagation|preventDefault={cancelEdit}
          >Cancel</button
        >
      </div>
    {:else if editing === 'package'}
      {#if model.identityLine}
        <p class="vault-creator-card__identity-line" data-creator-identity-line>{model.identityLine}</p>
      {/if}
      <p class="vault-creator-card__lead">Complete this episode package:</p>
      <label class="vault-creator-card__field">
        <span>Title</span>
        <input type="text" bind:value={draftTitle} maxlength="200" placeholder="Episode title" />
      </label>
      <label class="vault-creator-card__field">
        <span>Description</span>
        <textarea rows="2" bind:value={draftDescription} maxlength="4000" placeholder="Short description"></textarea>
      </label>
      <label class="vault-creator-card__field">
        <span>Artwork</span>
        <input type="url" bind:value={draftArtwork} placeholder="Image URL or /thumbs/…" />
      </label>
      {#if formError}<p class="vault-creator-card__error">{formError}</p>{/if}
      <div class="vault-creator-card__actions">
        <button type="button" class="vault-creator-card__btn vault-creator-card__btn--primary" on:click|stopPropagation|preventDefault={submitPackage}
          >Save package</button
        >
        <button type="button" class="vault-creator-card__btn vault-creator-card__btn--ghost" on:click|stopPropagation|preventDefault={cancelEdit}
          >Cancel</button
        >
      </div>
    {:else}
      <!-- Identity: what this video is (Series / Season / Episode). -->
      <div class="vault-creator-card__section" data-section="identity">
        <div class="vault-creator-card__section-head">
          <span class="vault-creator-card__section-title">{model.identity.axisLabel || 'Identity'}</span>
          <span
            class="vault-creator-card__pill"
            class:ok={model.identity.ready}
            class:warn={!model.identity.ready}
            data-identity-status
          >
            {model.identity.statusLabel}
          </span>
        </div>
        <p class="vault-creator-card__axis-hint" data-identity-hint>What is this video?</p>
        <ul class="vault-creator-card__checks">
          <li class:missing={!model.identity.marks.series} data-check="series">
            <span class="vault-creator-card__mark">{mark(model.identity.marks.series)}</span>
            <span class="vault-creator-card__k">Series</span>
            <span class="vault-creator-card__v" data-series-value>{model.seriesDisplay}</span>
          </li>
          <li class:missing={!model.identity.marks.season} data-check="season">
            <span class="vault-creator-card__mark">{mark(model.identity.marks.season)}</span>
            <span class="vault-creator-card__k">Season</span>
            <span class="vault-creator-card__v" data-season-value>{model.seasonDisplay}</span>
          </li>
          <li class:missing={!model.identity.marks.episode} data-check="episode">
            <span class="vault-creator-card__mark">{mark(model.identity.marks.episode)}</span>
            <span class="vault-creator-card__k">Episode</span>
            <span class="vault-creator-card__v" data-episode-value>{model.episodeDisplay}</span>
          </li>
        </ul>
        <button
          type="button"
          class="vault-creator-card__btn"
          data-edit-identity
          on:click|stopPropagation|preventDefault={openIdentity}
        >
          {model.identity.ready ? 'Edit identity' : 'Confirm identity'}
        </button>
      </div>

      <!-- Media: playable file availability — separate from package / catalog status. -->
      <div class="vault-creator-card__section" data-section="media" data-media={model.media.state}>
        <div class="vault-creator-card__section-head">
          <span class="vault-creator-card__section-title">{model.media.axisLabel || 'Media'}</span>
          <span
            class="vault-creator-card__pill"
            class:ok={model.media.state === 'available'}
            class:warn={model.media.state !== 'available'}
            data-media-status
          >
            {model.media.state === 'available' ? '✓ Available' : '○ Missing'}
          </span>
        </div>
        <p class="vault-creator-card__axis-hint" data-media-hint>
          {model.media.hint || 'Playable file availability (not package or publication).'}
        </p>
      </div>

      <!-- Presentation: episode package fields only. Independent of published catalog status. -->
      <div class="vault-creator-card__section" data-section="presentation">
        <div class="vault-creator-card__section-head">
          <span class="vault-creator-card__section-title"
            >{model.presentation.axisLabel || 'Presentation'}</span
          >
          <span
            class="vault-creator-card__pill"
            class:ok={model.presentation.ready}
            class:warn={!model.presentation.ready}
            data-presentation-status
          >
            {model.presentation.statusLabel ||
              (model.presentation.ready ? 'Ready' : 'Incomplete')}
          </span>
        </div>
        <p class="vault-creator-card__axis-hint" data-presentation-hint>
          {model.presentation.hint ||
            'Package readiness for Title, Description, and Artwork.'}
        </p>
        <ul class="vault-creator-card__checks">
          <li class:missing={!model.presentation.marks.title} data-check="title">
            <span class="vault-creator-card__mark">{mark(model.presentation.marks.title)}</span>
            <span class="vault-creator-card__k">Title</span>
            <span class="vault-creator-card__v"
              >{model.presentation.title || 'Missing'}</span
            >
          </li>
          <li class:missing={!model.presentation.marks.description} data-check="description">
            <span class="vault-creator-card__mark">{mark(model.presentation.marks.description)}</span>
            <span class="vault-creator-card__k">Description</span>
            <span class="vault-creator-card__v"
              >{model.presentation.description
                ? model.presentation.description.length > 48
                  ? `${model.presentation.description.slice(0, 48)}…`
                  : model.presentation.description
                : 'Missing'}</span
            >
          </li>
          <li class:missing={!model.presentation.marks.artwork} data-check="artwork">
            <span class="vault-creator-card__mark">{mark(model.presentation.marks.artwork)}</span>
            <span class="vault-creator-card__k">Artwork</span>
            <span class="vault-creator-card__v"
              >{model.presentation.marks.artwork ? 'Set' : 'Missing'}</span
            >
          </li>
        </ul>
        {#if !model.presentation.ready && model.presentation.missing?.length}
          <p class="vault-creator-card__missing" data-presentation-missing>
            Missing: {model.presentation.missing.join(', ')}
          </p>
        {/if}
        {#if model.presentation.artworkUrl}
          <div class="vault-creator-card__art" aria-hidden="true">
            <img src={model.presentation.artworkUrl} alt="" loading="lazy" />
          </div>
        {/if}
        {#if model.identity.ready}
          <button
            type="button"
            class="vault-creator-card__btn"
            data-edit-package
            on:click|stopPropagation|preventDefault={openPackage}
          >
            {model.presentation.ready ? 'Edit package' : 'Add package'}
          </button>
        {/if}
      </div>

      <!-- Episode publication: catalog enum — not Hero PUBLIC APPROVED. -->
      <div
        class="vault-creator-card__section"
        data-section="publishing"
        data-section-axis="episode-publication"
        data-publishing={model.publishing.status}
      >
        <div class="vault-creator-card__section-head">
          <span class="vault-creator-card__section-title"
            >{model.publishing.axisLabel || 'Episode publication'}</span
          >
          <span
            class="vault-creator-card__pub"
            data-publishing-status
            data-episode-status={model.publishing.status}
          >
            {model.publishing.displayLabel || model.publishing.label}
          </span>
        </div>
        <p class="vault-creator-card__axis-hint" data-publishing-hint>
          {model.publishing.hint ||
            'Catalog Draft / Ready / Published / Archived. Not Hero approval.'}
        </p>
      </div>

      <!-- Hero: separate authority surface (not derived from episode status). -->
      <div class="vault-creator-card__section" data-section="hero" data-section-axis="hero-approval">
        <div class="vault-creator-card__section-head">
          <span class="vault-creator-card__section-title">{model.hero?.axisLabel || 'Hero'}</span>
          <span class="vault-creator-card__pill vault-creator-card__pill--neutral" data-hero-axis-status>
            {model.hero?.statusLabel || 'Managed in Hero Manager'}
          </span>
        </div>
        <p class="vault-creator-card__axis-hint" data-hero-hint>
          {model.hero?.hint ||
            'PUBLIC APPROVED is server-authoritative Hero grant — independent of episode publication.'}
        </p>
      </div>
    {/if}
  </div>
{/if}
