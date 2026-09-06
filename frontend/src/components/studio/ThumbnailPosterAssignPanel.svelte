<script>
  import { seriesCatalog } from '../../lib/series/seriesStore.js';
  import { assignEpisodePoster } from '../../lib/series/seriesStore.js';
  import {
    listCatalogSeriesOptions,
    listSeasonOptionsForSeries,
    listEpisodeOptionsForSeason,
    resolveEpisodeCatalogSelection,
    resolvePosterAssignmentTarget,
    resolveThumbnailVaultPosterUrl
  } from '../../lib/studio/episodePosterAssignment.js';
  import { emitCreatorProductionUpdated } from '../../lib/studio/creatorActionRouter.js';
  import MediaThumbnail from '../media/MediaThumbnail.svelte';

  /** Thumbnail Vault entry being assigned. */
  export let thumbnailEntry = null;
  /** Ready Video Vault assets for title / linked-reel target resolution. */
  export let videoAssets = [];
  /** Optional workflow episode prefill (higher priority than resolver). */
  export let prefillEpisodeId = '';
  /** @type {import('svelte/store').Writable<string>} */
  export let uploadStatus;
  /** @type {() => void} */
  export let onClose = () => {};
  /** @type {() => void} */
  export let onAssigned = () => {};

  let selectedSeriesId = '';
  let selectedSeasonNumber = '';
  let selectedEpisodeId = '';
  let assigning = false;
  let errorMessage = '';
  let successMessage = '';
  let userTouchedSelection = false;
  let openedEntryKey = '';

  /** @param {unknown} entry */
  function entryPreselectKey(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const row = /** @type {Record<string, unknown>} */ (entry);
    return [
      row.id,
      row.url,
      row.personal_video_id,
      row.name,
      row.title,
      row.fileName
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join('|');
  }

  $: if (!thumbnailEntry) {
    openedEntryKey = '';
    userTouchedSelection = false;
    selectedSeriesId = '';
    selectedSeasonNumber = '';
    selectedEpisodeId = '';
  } else {
    const nextKey = entryPreselectKey(thumbnailEntry);
    if (nextKey !== openedEntryKey) {
      openedEntryKey = nextKey;
      userTouchedSelection = false;
      selectedSeriesId = '';
      selectedSeasonNumber = '';
      selectedEpisodeId = '';
    }
  }

  $: if (thumbnailEntry && !userTouchedSelection) {
    const prefill = resolveEpisodeCatalogSelection(prefillEpisodeId, $seriesCatalog);
    if (prefill) {
      selectedSeriesId = prefill.seriesId;
      selectedSeasonNumber = String(prefill.seasonNumber);
      selectedEpisodeId = prefill.episodeId;
    } else {
      const target = resolvePosterAssignmentTarget(thumbnailEntry, { videoAssets });
      if (target) {
        selectedSeriesId = target.seriesId;
        selectedSeasonNumber = String(target.seasonNumber);
        selectedEpisodeId = target.episodeId;
      }
    }
  }

  $: posterUrl = resolveThumbnailVaultPosterUrl(thumbnailEntry);
  $: posterLabel =
    String(thumbnailEntry?.name || thumbnailEntry?.title || thumbnailEntry?.fileName || 'Poster').trim() ||
    'Poster';
  $: seriesOptions = listCatalogSeriesOptions($seriesCatalog);
  $: seasonOptions = selectedSeriesId
    ? listSeasonOptionsForSeries($seriesCatalog, selectedSeriesId)
    : [];
  $: episodeOptions =
    selectedSeriesId && selectedSeasonNumber !== ''
      ? listEpisodeOptionsForSeason($seriesCatalog, selectedSeriesId, Number(selectedSeasonNumber))
      : [];
  $: selectedEpisode =
    episodeOptions.find((row) => row.episodeId === selectedEpisodeId) || null;
  $: episodeSelectValue =
    selectedEpisodeId &&
    episodeOptions.some((row) => row.episodeId === selectedEpisodeId)
      ? selectedEpisodeId
      : '';

  $: if (selectedSeriesId && seasonOptions.length && selectedSeasonNumber === '') {
    selectedSeasonNumber = String(seasonOptions[0].seasonNumber);
  }

  function resetSeasonEpisode() {
    selectedSeasonNumber = '';
    selectedEpisodeId = '';
  }

  function markUserTouchedSelection() {
    userTouchedSelection = true;
  }

  function handleSeriesChange() {
    markUserTouchedSelection();
    resetSeasonEpisode();
  }

  function handleSeasonChange() {
    markUserTouchedSelection();
    selectedEpisodeId = '';
  }

  function handleEpisodeChange() {
    markUserTouchedSelection();
  }

  function closePanel() {
    errorMessage = '';
    successMessage = '';
    onClose();
  }

  async function handleAssign() {
    errorMessage = '';
    successMessage = '';
    if (!posterUrl) {
      errorMessage = 'Selected poster has no usable thumbnail URL';
      return;
    }
    if (!selectedEpisodeId) {
      errorMessage = 'Choose an episode to assign this poster';
      return;
    }

    assigning = true;
    try {
      const result = await assignEpisodePoster(selectedEpisodeId, posterUrl, {
        source: 'thumbnail-vault'
      });
      if (!result.ok) {
        errorMessage = result.reason || 'Poster assignment failed';
        uploadStatus?.set?.(`❌ ${errorMessage}`);
        return;
      }
      successMessage = result.localOnly
        ? `Poster assigned locally to ${selectedEpisode?.label || selectedEpisodeId} (server sync pending)`
        : `Poster assigned to ${selectedEpisode?.label || selectedEpisodeId}`;
      uploadStatus?.set?.(`✅ ${successMessage}`);
      emitCreatorProductionUpdated({
        episodeId: selectedEpisodeId,
        actionType: 'missing-thumbnail',
        source: 'thumbnail-poster-assign'
      });
      onAssigned();
      closePanel();
    } catch (err) {
      errorMessage = err?.message || 'Poster assignment failed';
      uploadStatus?.set?.(`❌ ${errorMessage}`);
    } finally {
      assigning = false;
    }
  }
</script>

{#if thumbnailEntry}
  <div
    class="thumbnail-poster-assign-backdrop"
    role="presentation"
    on:click|self={closePanel}
    data-thumbnail-poster-assign
    data-testid="thumbnail-poster-assign-panel"
  >
    <section class="thumbnail-poster-assign-panel" aria-labelledby="thumbnail-poster-assign-heading">
      <header class="thumbnail-poster-assign-header">
        <div class="ai-badge">🖼️ ASSIGN POSTER</div>
        <h3 id="thumbnail-poster-assign-heading">Assign Thumbnail Vault Poster to Episode</h3>
        <p class="thumbnail-poster-assign-subtitle">
          Sets canonical episode thumbnailUrl — playback reelId is unchanged
        </p>
        <button type="button" class="thumbnail-poster-assign-close" on:click={closePanel} aria-label="Close">
          ✕
        </button>
      </header>

      <div class="thumbnail-poster-assign-preview">
        {#if posterUrl}
          <MediaThumbnail url={posterUrl} alt={posterLabel} className="thumbnail-poster-assign-thumb" />
        {/if}
        <div>
          <strong>{posterLabel}</strong>
          <span class="thumbnail-poster-assign-url">{posterUrl || 'No URL'}</span>
        </div>
      </div>

      {#if seriesOptions.length === 0}
        <p class="thumbnail-poster-assign-empty">No series in catalog. Create a series and episodes first.</p>
      {:else}
        <label class="input-label-wrapper">
          Series
          <select
            bind:value={selectedSeriesId}
            on:change={handleSeriesChange}
            data-thumbnail-poster-series
            data-testid="thumbnail-poster-series-select"
          >
            <option value="">Select series…</option>
            {#each seriesOptions as series (series.id)}
              <option value={series.id}>{series.title}</option>
            {/each}
          </select>
        </label>

        <label class="input-label-wrapper">
          Season
          <select
            bind:value={selectedSeasonNumber}
            on:change={handleSeasonChange}
            disabled={!selectedSeriesId || seasonOptions.length === 0}
            data-thumbnail-poster-season
            data-testid="thumbnail-poster-season-select"
          >
            <option value="">Select season…</option>
            {#each seasonOptions as season (season.seasonNumber)}
              <option value={String(season.seasonNumber)}>{season.label}</option>
            {/each}
          </select>
        </label>

        <label class="input-label-wrapper">
          Episode
          <select
            value={episodeSelectValue}
            on:change={(event) => {
              selectedEpisodeId = event.currentTarget.value;
              handleEpisodeChange();
            }}
            disabled={!selectedSeriesId || selectedSeasonNumber === '' || episodeOptions.length === 0}
            data-thumbnail-poster-episode
            data-testid="thumbnail-poster-episode-select"
            data-poster-assign-episode-id={selectedEpisodeId || ''}
          >
            <option value="">Select episode…</option>
            {#each episodeOptions as episode (episode.episodeId)}
              <option value={episode.episodeId}>
                {episode.label}{#if episode.reelId} · has MP4{/if}
              </option>
            {/each}
          </select>
        </label>
      {/if}

      <div class="thumbnail-poster-assign-actions">
        <button type="button" class="quick-upload-btn" on:click={closePanel} disabled={assigning}>Cancel</button>
        <button
          type="button"
          class="batch-upload-btn"
          disabled={assigning || !posterUrl || !selectedEpisodeId}
          on:click={handleAssign}
          data-action="assign-thumbnail-poster"
          data-testid="thumbnail-poster-assign-btn"
        >
          {assigning ? 'Assigning…' : 'Assign Poster'}
        </button>
      </div>

      {#if successMessage}
        <p class="thumbnail-poster-assign-success" role="status">{successMessage}</p>
      {/if}
      {#if errorMessage}
        <p class="thumbnail-poster-assign-error" role="alert">{errorMessage}</p>
      {/if}
    </section>
  </div>
{/if}

<style>
  .thumbnail-poster-assign-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.72);
  }

  .thumbnail-poster-assign-panel {
    width: min(100%, 28rem);
    max-height: min(92vh, 40rem);
    overflow: auto;
    padding: 1.1rem 1.2rem 1.25rem;
    border-radius: 12px;
    border: 1px solid rgba(0, 255, 200, 0.28);
    background: linear-gradient(145deg, rgba(8, 24, 32, 0.96), rgba(12, 18, 28, 0.94));
    color: #fff;
  }

  .thumbnail-poster-assign-header {
    position: relative;
    margin-bottom: 1rem;
  }

  .thumbnail-poster-assign-subtitle {
    margin: 0.35rem 0 0;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.62);
  }

  .thumbnail-poster-assign-close {
    position: absolute;
    top: 0;
    right: 0;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 1.1rem;
    cursor: pointer;
  }

  .thumbnail-poster-assign-preview {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 1rem;
    padding: 0.65rem;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.28);
  }

  .thumbnail-poster-assign-preview :global(.thumbnail-poster-assign-thumb) {
    width: 4.5rem;
    height: 4.5rem;
    object-fit: cover;
    border-radius: 6px;
  }

  .thumbnail-poster-assign-url {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.55);
    word-break: break-all;
  }

  .thumbnail-poster-assign-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }

  .thumbnail-poster-assign-empty,
  .thumbnail-poster-assign-success,
  .thumbnail-poster-assign-error {
    margin: 0.75rem 0 0;
    font-size: 0.85rem;
  }

  .thumbnail-poster-assign-empty {
    color: rgba(255, 180, 100, 0.95);
  }

  .thumbnail-poster-assign-success {
    color: rgba(100, 255, 160, 0.95);
  }

  .thumbnail-poster-assign-error {
    color: rgba(255, 120, 120, 0.95);
  }
</style>
