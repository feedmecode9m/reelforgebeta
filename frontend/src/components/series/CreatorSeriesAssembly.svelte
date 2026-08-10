<script>
  /**
   * Creator Series Assembly — overview, completeness, Ready gate, preview.
   * Creator-only workspace; does not publish automatically.
   */
  import { createEventDispatcher } from 'svelte';
  import {
    seriesCatalog,
    getSeriesById
  } from '../../lib/series/seriesStore.js';
  import { getReadyHeroVaultAssets } from '../../lib/series/heroVaultAssetSource.js';
  import {
    buildSeriesAssemblyOverview,
    buildCreatorSeriesPreview,
    attemptMarkEpisodeReady
  } from '../../lib/series/seriesAssemblyWorkflow.js';
  import { polishAssemblyRowMarks } from '../../lib/series/creatorExperiencePresentation.js';

  const dispatch = createEventDispatcher();

  /** @type {Record<string, unknown>[]} */
  export let feedReels = [];
  /** Optional preferred series id from Studio */
  export let preferredSeriesId = '';

  let selectedSeriesId = '';
  let previewMode = false;
  let gateMessage = '';

  /**
   * @param {import('../../lib/series/seriesTypes.js').Series[]} catalog
   * @param {string} preferred
   */
  function resolveDefaultSeriesId(catalog, preferred) {
    const list = Array.isArray(catalog) ? catalog : [];
    if (!list.length) return '';
    const pref = String(preferred || '').trim();
    if (pref && list.some((s) => s.id === pref)) return pref;
    const tagged = list.find((s) => Array.isArray(s.tags) && s.tags.includes('vault-inferred'));
    if (tagged) return tagged.id;
    const stirred = list.find((s) => /stirred/i.test(String(s.id || s.title || '')));
    if (stirred) return stirred.id;
    return list[0].id;
  }

  $: catalogList = $seriesCatalog || [];
  $: seriesOptions = [...catalogList].sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || ''))
  );
  $: if (seriesOptions.length) {
    const stillValid = seriesOptions.some((s) => s.id === selectedSeriesId);
    if (!stillValid) {
      selectedSeriesId = resolveDefaultSeriesId(seriesOptions, preferredSeriesId);
    }
  } else {
    selectedSeriesId = '';
  }

  $: series = selectedSeriesId ? getSeriesById(selectedSeriesId) : null;
  $: vaultAssets = getReadyHeroVaultAssets({
    extraItems: Array.isArray(feedReels) ? feedReels : null
  });
  $: overview = buildSeriesAssemblyOverview(series, vaultAssets);
  $: preview = previewMode ? buildCreatorSeriesPreview(series, vaultAssets) : null;

  function handleSeriesChange() {
    gateMessage = '';
    previewMode = false;
    dispatch('seriesSelect', { seriesId: selectedSeriesId });
  }

  /** @param {string} episodeId */
  function markReady(episodeId) {
    gateMessage = '';
    const result = attemptMarkEpisodeReady(episodeId, { vaultAssets });
    gateMessage = result.message;
    if (result.ok) {
      dispatch('changed', {
        type: 'status',
        episodeId,
        seriesId: selectedSeriesId,
        status: 'ready'
      });
    }
  }

  function togglePreview() {
    previewMode = !previewMode;
    gateMessage = '';
  }

  /**
   * @param {'confirmed'|'missing'|'complete'|'incomplete'|'available'|'missing'} state
   */
  function stateClass(state) {
    if (state === 'confirmed' || state === 'complete' || state === 'available') return 'ok';
    return 'warn';
  }
</script>

<section
  class="series-assembly"
  data-testid="creator-series-assembly"
  data-series-assembly
  aria-labelledby="series-assembly-heading"
>
  <header class="series-assembly__header">
    <div>
      <div class="series-assembly__badge">SERIES ASSEMBLY</div>
      <h3 id="series-assembly-heading">Creator Series Overview</h3>
      <p class="series-assembly__sub">
        Assemble episode packages into a series — identity, presentation, and media before Ready
      </p>
    </div>
    <div class="series-assembly__tools">
      <label class="series-assembly__select-label">
        Series
        <select bind:value={selectedSeriesId} on:change={handleSeriesChange} data-assembly-series>
          {#if !seriesOptions.length}
            <option value="">No series</option>
          {:else}
            {#each seriesOptions as s (s.id)}
              <option value={s.id}>{s.title || s.id}</option>
            {/each}
          {/if}
        </select>
      </label>
      <button
        type="button"
        class="series-assembly__btn"
        class:active={previewMode}
        data-assembly-preview-toggle
        on:click={togglePreview}
        disabled={!series}
      >
        {previewMode ? 'Exit preview' : 'Creator preview'}
      </button>
    </div>
  </header>

  {#if !series}
    <p class="series-assembly__empty">Select or create a series in the catalog to assemble episodes.</p>
  {:else if previewMode && preview}
    <div class="series-assembly__preview" data-assembly-preview data-creator-preview>
      <p class="series-assembly__preview-banner">
        Creator preview — not public. Unpublished episodes stay hidden from viewers.
      </p>
      <div class="series-assembly__preview-hero">
        {#if preview.poster}
          <img src={preview.poster} alt="" class="series-assembly__preview-poster" />
        {/if}
        <div>
          <h4 class="series-assembly__preview-title">{preview.title}</h4>
          {#if preview.description}
            <p class="series-assembly__preview-desc">{preview.description}</p>
          {/if}
        </div>
      </div>
      {#each preview.seasons as season (season.seasonNumber)}
        <div class="series-assembly__preview-season">
          <h5>{season.title || `Season ${season.seasonNumber}`}</h5>
          <ol class="series-assembly__preview-list">
            {#each season.episodes as ep (ep.episodeId)}
              <li class="series-assembly__preview-ep" data-status={ep.status}>
                {#if ep.artworkUrl}
                  <img src={ep.artworkUrl} alt="" class="series-assembly__preview-thumb" />
                {:else}
                  <div class="series-assembly__preview-thumb series-assembly__preview-thumb--empty"></div>
                {/if}
                <div class="series-assembly__preview-ep-body">
                  <span class="series-assembly__preview-identity">{ep.identityLine}</span>
                  <span class="series-assembly__preview-ep-title">{ep.title || 'Untitled'}</span>
                  {#if ep.description}
                    <span class="series-assembly__preview-ep-desc">{ep.description}</span>
                  {/if}
                  <span class="series-assembly__preview-status">{ep.status}</span>
                </div>
              </li>
            {/each}
          </ol>
        </div>
      {/each}
    </div>
  {:else}
    <div class="series-assembly__overview" data-assembly-overview>
      <div class="series-assembly__series-card">
        {#if overview.poster}
          <img src={overview.poster} alt="" class="series-assembly__series-art" />
        {:else}
          <div class="series-assembly__series-art series-assembly__series-art--empty" aria-hidden="true"
            >Art</div
          >
        {/if}
        <div class="series-assembly__series-meta">
          <h4 data-assembly-series-title>{overview.title || 'Untitled series'}</h4>
          <p data-assembly-series-desc>
            {overview.description || 'No series description yet.'}
          </p>
          <p class="series-assembly__counts">
            {overview.episodeCount} episodes · {overview.publishedCount} published
          </p>
        </div>
      </div>

      {#if gateMessage}
        <p class="series-assembly__gate" data-assembly-gate-message>{gateMessage}</p>
      {/if}

      {#each overview.seasons as season (season.seasonNumber)}
        <div class="series-assembly__season" data-assembly-season={season.seasonNumber}>
          <h5 class="series-assembly__season-title">
            Season {season.seasonNumber}
            <span class="series-assembly__season-label">{season.title}</span>
          </h5>
          <ul class="series-assembly__episodes">
            {#each season.episodes as ep (ep.episodeId)}
              {@const polish = polishAssemblyRowMarks(ep)}
              <li
                class="series-assembly__episode"
                class:series-assembly__episode--incomplete={!ep.canMarkReady && ep.publishing.status !== 'published' && ep.publishing.status !== 'ready'}
                data-episode-id={ep.episodeId}
                data-display-order={ep.displayOrder}
                data-episode-number={ep.episodeNumber}
              >
                <div class="series-assembly__ep-head">
                  <span class="series-assembly__ep-code">
                    {#if ep.identity.state === 'confirmed' && ep.identity.seriesLabel}
                      {ep.identity.seriesLabel} • S{ep.identity.seasonNumber} • E{ep.identity
                        .episodeNumber}
                    {:else}
                      S{ep.seasonNumber} • E{ep.episodeNumber}
                    {/if}
                  </span>
                  <span class="series-assembly__ep-order" title="Catalog display order">
                    Order {Number.isFinite(ep.displayOrder) ? ep.displayOrder : '—'}
                  </span>
                </div>
                <div class="series-assembly__status-grid">
                  <div class="series-assembly__stat" data-identity={ep.identity.state}>
                    <span class="series-assembly__stat-key">Identity</span>
                    <span class="series-assembly__stat-val {stateClass(ep.identity.state)}"
                      >{polish.identityMark ? '✓ ' : '○ '}{ep.identity.state}</span
                    >
                  </div>
                  <div class="series-assembly__stat" data-presentation={ep.presentation.state}>
                    <span class="series-assembly__stat-key">Presentation</span>
                    <span class="series-assembly__stat-val {stateClass(ep.presentation.state)}"
                      >{ep.presentation.state === 'complete' ? '✓ complete' : '○ incomplete'}</span
                    >
                  </div>
                  <div class="series-assembly__stat" data-media={ep.media.state}>
                    <span class="series-assembly__stat-key">Media</span>
                    <span class="series-assembly__stat-val {stateClass(ep.media.state)}"
                      >{polish.mediaMark ? '✓ available' : '○ missing'}</span
                    >
                  </div>
                  <div class="series-assembly__stat" data-publishing={ep.publishing.status}>
                    <span class="series-assembly__stat-key">Publishing</span>
                    <span class="series-assembly__stat-val">{ep.publishing.status}</span>
                  </div>
                </div>
                <ul class="series-assembly__package-checks" data-package-checks>
                  <li class:missing={!polish.presentationMarks.title}
                    >{polish.presentationMarks.title ? '✓' : '○'} Title</li
                  >
                  <li class:missing={!polish.presentationMarks.description}
                    >{polish.presentationMarks.description ? '✓' : '○'} Description</li
                  >
                  <li class:missing={!polish.presentationMarks.artwork}
                    >{polish.presentationMarks.artwork ? '✓' : '○'} Artwork</li
                  >
                </ul>
                {#if ep.presentation.title || ep.presentation.description}
                  <div class="series-assembly__ep-package">
                    <strong>{ep.presentation.title || 'No title'}</strong>
                    {#if ep.presentation.description}
                      <span>{ep.presentation.description}</span>
                    {/if}
                  </div>
                {/if}
                {#if !ep.canMarkReady && ep.publishing.status !== 'ready' && ep.publishing.status !== 'published'}
                  <p class="series-assembly__blockers">
                    Ready requires: {(ep.readyRequirements.missing || []).join(', ') || 'package complete'}
                  </p>
                {/if}
                {#if ep.publishing.status !== 'ready' && ep.publishing.status !== 'published'}
                  <button
                    type="button"
                    class="series-assembly__btn series-assembly__btn--ready"
                    data-assembly-mark-ready
                    disabled={!ep.canMarkReady}
                    on:click={() => markReady(ep.episodeId)}
                  >
                    Mark Ready
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .series-assembly {
    --sa-bg: linear-gradient(165deg, rgba(12, 18, 28, 0.96), rgba(18, 26, 38, 0.94));
    --sa-border: rgba(148, 163, 184, 0.22);
    --sa-ok: #6ee7b7;
    --sa-warn: #fcd34d;
    --sa-text: #e2e8f0;
    --sa-muted: #94a3b8;
    background: var(--sa-bg);
    border: 1px solid var(--sa-border);
    border-radius: 12px;
    padding: 1rem 1.1rem 1.25rem;
    color: var(--sa-text);
    margin-bottom: 1.25rem;
  }
  .series-assembly__header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1rem;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1rem;
  }
  .series-assembly__badge {
    font-size: 0.65rem;
    letter-spacing: 0.08em;
    color: #7dd3fc;
    font-weight: 700;
  }
  .series-assembly__header h3 {
    margin: 0.2rem 0 0.25rem;
    font-size: 1.05rem;
  }
  .series-assembly__sub {
    margin: 0;
    color: var(--sa-muted);
    font-size: 0.82rem;
    max-width: 36rem;
  }
  .series-assembly__tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: flex-end;
  }
  .series-assembly__select-label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sa-muted);
  }
  .series-assembly__select-label select {
    min-width: 12rem;
    background: rgba(2, 6, 12, 0.7);
    border: 1px solid var(--sa-border);
    color: var(--sa-text);
    border-radius: 6px;
    padding: 0.35rem 0.5rem;
    font-size: 0.85rem;
  }
  .series-assembly__btn {
    border: 1px solid var(--sa-border);
    background: rgba(30, 41, 59, 0.9);
    color: var(--sa-text);
    border-radius: 6px;
    padding: 0.4rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }
  .series-assembly__btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .series-assembly__btn.active,
  .series-assembly__btn--ready {
    border-color: rgba(0, 242, 255, 0.45);
    background: rgba(0, 70, 85, 0.85);
  }
  .series-assembly__btn--ready:not(:disabled):hover {
    border-color: rgba(0, 242, 255, 0.7);
  }
  .series-assembly__empty {
    color: var(--sa-muted);
    font-size: 0.9rem;
  }
  .series-assembly__series-card {
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: 0.85rem;
    margin-bottom: 1rem;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  }
  .series-assembly__series-art {
    width: 88px;
    height: 88px;
    object-fit: cover;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.35);
  }
  .series-assembly__series-art--empty {
    display: grid;
    place-items: center;
    color: var(--sa-muted);
    font-size: 0.7rem;
    border: 1px dashed var(--sa-border);
  }
  .series-assembly__series-meta h4 {
    margin: 0 0 0.35rem;
    font-size: 1rem;
  }
  .series-assembly__series-meta p {
    margin: 0;
    color: var(--sa-muted);
    font-size: 0.85rem;
  }
  .series-assembly__counts {
    margin-top: 0.45rem !important;
    font-size: 0.75rem !important;
  }
  .series-assembly__gate {
    margin: 0 0 0.75rem;
    padding: 0.45rem 0.6rem;
    border-radius: 6px;
    background: rgba(251, 191, 36, 0.12);
    border: 1px solid rgba(251, 191, 36, 0.35);
    color: #fde68a;
    font-size: 0.78rem;
  }
  .series-assembly__season {
    margin-bottom: 1rem;
  }
  .series-assembly__season-title {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  .series-assembly__season-label {
    color: var(--sa-muted);
    font-weight: 500;
    font-size: 0.8rem;
  }
  .series-assembly__episodes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .series-assembly__episode {
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    padding: 0.6rem 0.7rem;
    background: rgba(2, 8, 16, 0.45);
  }
  .series-assembly__episode--incomplete {
    border-color: rgba(251, 191, 36, 0.4);
  }
  .series-assembly__package-checks {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.75rem;
    font-size: 0.72rem;
    color: #6ee7b7;
  }
  .series-assembly__package-checks li.missing {
    color: #fbbf24;
  }
  .series-assembly__ep-head {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.45rem;
    font-size: 0.82rem;
    font-weight: 700;
  }
  .series-assembly__ep-order {
    color: var(--sa-muted);
    font-weight: 500;
    font-size: 0.72rem;
  }
  .series-assembly__status-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.35rem;
  }
  @media (max-width: 720px) {
    .series-assembly__status-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .series-assembly__stat {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.3rem 0.35rem;
    border-radius: 5px;
    background: rgba(15, 23, 42, 0.65);
  }
  .series-assembly__stat-key {
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sa-muted);
  }
  .series-assembly__stat-val {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: capitalize;
  }
  .series-assembly__stat-val.ok {
    color: var(--sa-ok);
  }
  .series-assembly__stat-val.warn {
    color: var(--sa-warn);
  }
  .series-assembly__ep-package {
    margin-top: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.78rem;
    color: #cbd5e1;
  }
  .series-assembly__ep-package strong {
    color: #f8fafc;
  }
  .series-assembly__blockers {
    margin: 0.4rem 0 0;
    font-size: 0.72rem;
    color: var(--sa-warn);
  }
  .series-assembly__episode .series-assembly__btn--ready {
    margin-top: 0.45rem;
  }
  .series-assembly__preview-banner {
    margin: 0 0 0.85rem;
    padding: 0.45rem 0.6rem;
    border-radius: 6px;
    background: rgba(56, 189, 248, 0.1);
    border: 1px solid rgba(56, 189, 248, 0.3);
    color: #bae6fd;
    font-size: 0.8rem;
  }
  .series-assembly__preview-hero {
    display: grid;
    grid-template-columns: 100px 1fr;
    gap: 0.85rem;
    margin-bottom: 1rem;
  }
  .series-assembly__preview-poster {
    width: 100px;
    height: 100px;
    object-fit: cover;
    border-radius: 8px;
  }
  .series-assembly__preview-title {
    margin: 0 0 0.35rem;
    font-size: 1.15rem;
  }
  .series-assembly__preview-desc {
    margin: 0;
    color: var(--sa-muted);
    font-size: 0.88rem;
  }
  .series-assembly__preview-season h5 {
    margin: 0 0 0.45rem;
    font-size: 0.9rem;
  }
  .series-assembly__preview-list {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .series-assembly__preview-ep {
    display: grid;
    grid-template-columns: 56px 1fr;
    gap: 0.55rem;
    padding: 0.45rem;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.14);
    background: rgba(2, 8, 16, 0.4);
  }
  .series-assembly__preview-thumb {
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: 6px;
  }
  .series-assembly__preview-thumb--empty {
    background: rgba(148, 163, 184, 0.12);
  }
  .series-assembly__preview-ep-body {
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
    min-width: 0;
  }
  .series-assembly__preview-identity {
    font-size: 0.68rem;
    color: #7dd3fc;
    font-weight: 600;
  }
  .series-assembly__preview-ep-title {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .series-assembly__preview-ep-desc {
    font-size: 0.75rem;
    color: var(--sa-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .series-assembly__preview-status {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sa-muted);
  }
</style>
