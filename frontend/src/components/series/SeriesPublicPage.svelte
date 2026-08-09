<script>
  /**
   * Public series detail surface for /series/:slug.
   * Consumes seriesCatalog only — does not define catalog data.
   */
  import { onMount } from 'svelte';
  import { writable, get } from 'svelte/store';
  import SeasonAccordion from './SeasonAccordion.svelte';
  import SeriesBadge from './SeriesBadge.svelte';
  import {
    seriesCatalog,
    getEpisodeById,
    initSeriesMetadata,
    resolveSeriesContextForReel
  } from '../../lib/series/seriesStore.js';
  import { episodeIsPlayable } from '../../lib/series/seriesTypes.js';
  import { resolveReelForEpisode } from '../../lib/series/episodeBridge.js';
  import { configureEpisodeNavigation } from '../../lib/series/episodeNavigation.js';
  import {
    hydratePublicSeriesFromVault,
    resolvePublicSeriesBySlug
  } from '../../lib/series/publicSeriesHydration.js';
  import {
    theaterReelFromVaultResolve,
    logEpisodeVaultResolve
  } from '../../lib/series/episodeVaultResolver.js';
  import {
    resolveEpisodeMedia,
    episodeChipPresentation
  } from '../../lib/series/episodeVaultBindingResolver.js';
  import {
    openTheaterReel,
    configureTheaterExperience,
    activeReel,
    theaterManager
  } from '../theater/TheaterExperience.svelte';
  import TheaterExperience from '../theater/TheaterExperience.svelte';
  import { isVideoReel } from '../../lib/api/reelContract.js';
  import { resolveTheaterPlayback } from '../../lib/media/theaterPlayback.js';
  import ConsumerChrome from '../navigation/ConsumerChrome.svelte';

  /** URL slug segment (e.g. neon-vengeance) */
  export let slug = '';

  const personalVideos = writable(/** @type {Record<string, unknown>[]} */ ([]));
  /** @type {Record<string, unknown>[]} */
  let heroVaultAssets = [];

  let selectedEpisodeId = '';
  let playNotice = '';
  let bootstrapped = false;
  /** True while vault inference + binding restore runs on cold load. */
  let hydrating = true;

  /**
   * Resolve series from catalog by id convention, then title slug.
   * @param {string} rawSlug
   * @param {import('../../lib/series/seriesTypes.js').Series[]} catalog
   */
  function resolveSeriesFromSlug(rawSlug, catalog) {
    return resolvePublicSeriesBySlug(rawSlug, catalog);
  }

  /** Flatten feed shelves + vault into a media registry for resolveReelForEpisode. */
  function loadMediaRegistry() {
    /** @type {Record<string, unknown>[]} */
    const entries = [];
    /** @type {Set<string>} */
    const seen = new Set();

    /** @param {Record<string, unknown>} reel */
    const push = (reel) => {
      if (!reel || typeof reel !== 'object' || reel.id == null) return;
      const id = String(reel.id);
      if (seen.has(id)) return;
      seen.add(id);
      entries.push(reel);
    };

    try {
      const vaultRaw = localStorage.getItem('personal_video_vault');
      if (vaultRaw) {
        const vault = JSON.parse(vaultRaw);
        if (Array.isArray(vault)) vault.forEach(push);
      }
    } catch {
      /* ignore */
    }

    try {
      const feedRaw = localStorage.getItem('reelforge_feed');
      if (feedRaw) {
        const feed = JSON.parse(feedRaw);
        if (Array.isArray(feed)) {
          feed.forEach(push);
        } else if (feed && typeof feed === 'object') {
          for (const shelf of Object.values(feed)) {
            if (Array.isArray(shelf)) shelf.forEach(push);
          }
        }
      }
    } catch {
      /* ignore */
    }

    return entries;
  }

  $: series = resolveSeriesFromSlug(slug, $seriesCatalog);
  $: sortedSeasons = series
    ? [...(series.seasons || [])].sort((a, b) => a.seasonNumber - b.seasonNumber)
    : [];
  $: allEpisodes = sortedSeasons.flatMap((season) =>
    [...(season.episodes || [])]
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((episode) => ({ season, episode }))
  );
  $: firstPlayable =
    allEpisodes.find(({ episode }) => {
      const resolved = resolveEpisodeMedia({ episode, readyVaultAssets: heroVaultAssets });
      return resolved.matched;
    }) || null;
  $: playableCount = allEpisodes.filter(({ episode }) => {
    const resolved = resolveEpisodeMedia({ episode, readyVaultAssets: heroVaultAssets });
    return resolved.matched;
  }).length;

  function refreshHeroVaultAssets() {
    try {
      const live = get(personalVideos);
      const extra = Array.isArray(live) ? live : null;
      const result = hydratePublicSeriesFromVault({
        extraItems: extra,
        initMetadata: false,
        source: 'public-series-page-refresh'
      });
      heroVaultAssets = result.readyAssets;
    } catch {
      try {
        const live = get(personalVideos);
        const result = hydratePublicSeriesFromVault({
          items: Array.isArray(live) ? live : [],
          initMetadata: false,
          source: 'public-series-page-refresh-fallback'
        });
        heroVaultAssets = result.readyAssets;
      } catch {
        heroVaultAssets = [];
      }
    }
  }

  /** @param {string} reelId */
  function findReelInFeed(reelId) {
    if (!reelId) return null;
    const id = String(reelId);
    const live = loadMediaRegistry();
    return live.find((r) => String(r.id) === id) || null;
  }

  function getAllFeedReels() {
    return loadMediaRegistry();
  }

  /**
   * Open Theater for an episode without navigating away from /series/:slug.
   * Prefers Hero Vault mediaAssetId; falls back to legacy reelId resolve.
   * @param {string} episodeId
   * @param {'drawer' | 'manual'} source
   */
  function playEpisode(episodeId, source = 'drawer') {
    playNotice = '';
    if (!episodeId) return;

    const ctx = getEpisodeById(episodeId);
    if (!ctx) {
      playNotice = 'Episode not found.';
      return;
    }

    refreshHeroVaultAssets();
    // Manual binding override → keyword resolve (unchanged algorithm) → unavailable.
    const resolved = resolveEpisodeMedia({
      episode: ctx.episode,
      readyVaultAssets: heroVaultAssets
    });
    logEpisodeVaultResolve({
      episodeId,
      episodeTitle: ctx.episode.title,
      matched: resolved.matched,
      assetId: resolved.matched ? resolved.assetId : null,
      matchTier: resolved.matched ? resolved.matchTier : null,
      bindingMode: resolved.bindingMode,
      source
    });

    if (resolved.matched) {
      const reel = theaterReelFromVaultResolve(ctx.episode.title, resolved, {
        episodeId,
        seriesId: ctx.series.id,
        seasonNumber: ctx.season.seasonNumber,
        episodeNumber: ctx.episode.episodeNumber
      });
      if (reel) {
        selectedEpisodeId = episodeId;
        // Same series landscape — Theater overlay only (no route change).
        openTheaterReel(reel);
        return;
      }
    }

    // Legacy catalog reelId path for mock episodes without vault media.
    if (!episodeIsPlayable(ctx.episode)) {
      playNotice = 'Asset unavailable — no ready Hero Vault media matches this episode.';
      return;
    }

    const preview = resolveReelForEpisode(episodeId, findReelInFeed, getAllFeedReels);
    if (!preview) {
      playNotice = 'No playable reel is linked to that episode yet.';
      return;
    }

    selectedEpisodeId = episodeId;
    // Stay on series page — open Theater overlay with dynamic episode media only.
    openTheaterReel(preview);
  }

  /** @param {CustomEvent<{ episodeId: string }>} event */
  function handleEpisodeSelect(event) {
    playEpisode(event.detail.episodeId, 'drawer');
  }

  function playFirstAvailable() {
    if (!firstPlayable) {
      playNotice = 'No playable episodes in this series yet.';
      return;
    }
    playEpisode(firstPlayable.episode.episodeId, 'manual');
  }

  onMount(() => {
    initSeriesMetadata();
    hydrating = true;
    try {
      const vault = JSON.parse(localStorage.getItem('personal_video_vault') || '[]');
      personalVideos.set(Array.isArray(vault) ? vault : []);
    } catch {
      personalVideos.set([]);
    }

    // Cold load: same Hero Vault ready source → inference → bindings (id refs only).
    try {
      const live = get(personalVideos);
      const result = hydratePublicSeriesFromVault({
        extraItems: Array.isArray(live) ? live : null,
        initMetadata: false,
        source: 'public-series-page-mount'
      });
      heroVaultAssets = result.readyAssets;
    } catch (err) {
      console.warn('[SeriesPublicPage] vault hydration failed', err);
      refreshHeroVaultAssets();
    }
    hydrating = false;

    configureEpisodeNavigation({
      findReelInFeed,
      openTheaterReel,
      getAllFeedReels,
      getCurrentEpisodeId: () => {
        const reel = get(activeReel);
        if (!reel) return null;
        const ctx = resolveSeriesContextForReel(reel);
        return ctx?.episode?.episodeId || reel.episodeId || reel.episode_id || null;
      }
    });

    configureTheaterExperience({
      findReelInFeed,
      getPersonalVideos: () => get(personalVideos),
      resolveTheaterPlayback,
      isVideoReel,
      watchSessionStart: () => {}
    });

    bootstrapped = true;

    return () => {
      theaterManager.close();
    };
  });
</script>

<div class="series-page" data-series-public data-series-slug={slug || undefined}>
  <ConsumerChrome headerVariant="overlay" showFooter={true}>
  <div class="series-public">
  {#if hydrating && !series}
    <section class="series-public__missing" aria-live="polite" aria-busy="true">
      <h1>Loading series…</h1>
      <p>Resolving Hero Vault catalog for <code>/series/{slug}</code>.</p>
    </section>
  {:else if !series}
    <section class="series-public__missing" aria-live="polite">
      <h1>Series not found</h1>
      <p>We couldn't find a series for <code>/series/{slug}</code>.</p>
      <a class="series-public__cta series-public__cta--ghost" href="/">Back to home</a>
    </section>
  {:else}
    <section class="series-public__hero" aria-labelledby="series-public-title">
      {#if series.poster}
        <div class="series-public__poster-wrap" aria-hidden="true">
          <img class="series-public__poster" src={series.poster} alt="" />
        </div>
      {/if}
      <div class="series-public__hero-copy">
        {#if series.genre}
          <p class="series-public__eyebrow">{series.genre}</p>
        {/if}
        <h1 id="series-public-title" class="series-public__title">{series.title}</h1>
        {#if series.description}
          <p class="series-public__desc">{series.description}</p>
        {/if}
        <p class="series-public__meta">
          {sortedSeasons.length} season{sortedSeasons.length === 1 ? '' : 's'}
          · {allEpisodes.length} episode{allEpisodes.length === 1 ? '' : 's'}
          · {playableCount} playable
          {#if series.releaseYear}
            · {series.releaseYear}
          {/if}
        </p>
        <div class="series-public__actions">
          <button
            type="button"
            class="series-public__cta"
            data-series-play-cta
            disabled={!firstPlayable || !bootstrapped}
            on:click={playFirstAvailable}
          >
            {firstPlayable ? 'Play series' : 'No playable episodes'}
          </button>
          {#if firstPlayable}
            <SeriesBadge
              seriesTitle={series.title}
              seasonNumber={firstPlayable.season.seasonNumber}
              episodeNumber={firstPlayable.episode.episodeNumber}
              episodeId={firstPlayable.episode.episodeId}
            />
          {/if}
        </div>
        {#if playNotice}
          <p class="series-public__notice" role="status">{playNotice}</p>
        {/if}
      </div>
    </section>

    <section class="series-public__seasons" aria-label="Seasons and episodes">
      <h2 class="series-public__section-title">Episodes</h2>
      <div class="series-public__season-list">
        {#each sortedSeasons as season (season.seasonId || season.seasonNumber)}
          <SeasonAccordion
            seriesId={series.id}
            {season}
            heroVaultAssets={heroVaultAssets}
            defaultExpanded={season.seasonNumber === (sortedSeasons[0]?.seasonNumber ?? 1)}
            bind:selectedEpisodeId
            on:episodeSelect={handleEpisodeSelect}
          />
        {/each}
      </div>
    </section>

    <section class="series-public__status-board" aria-label="Episode guide">
      <h2 class="series-public__section-title">Episode guide</h2>
      <ul class="series-public__status-list">
        {#each allEpisodes as row (row.episode.episodeId)}
          {@const resolved = resolveEpisodeMedia({
            episode: row.episode,
            readyVaultAssets: heroVaultAssets
          })}
          {@const chip = episodeChipPresentation(row.episode, resolved)}
          <li
            class="series-public__status-row"
            class:playable={chip.playable}
            class:unavailable={!chip.playable}
            data-episode-id={row.episode.episodeId}
            data-media-asset-id={chip.mediaAssetId || undefined}
            data-binding-mode={chip.bindingMode || undefined}
          >
            <span class="series-public__status-code"
              >S{row.season.seasonNumber}:E{row.episode.episodeNumber}</span
            >
            <span class="series-public__status-title">{row.episode.title}</span>
            {#if chip.thumbnailUrl}
              <img class="series-public__status-thumb" src={chip.thumbnailUrl} alt="" />
            {/if}
            <span class="series-public__status-badge">{chip.bindingLabel}</span>
            {#if chip.playable}
              <button
                type="button"
                class="series-public__row-play"
                on:click={() => playEpisode(row.episode.episodeId, 'drawer')}
              >
                ▶ Enter Theater
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
  </div>
  </ConsumerChrome>
</div>

{#if bootstrapped}
  <TheaterExperience
    {personalVideos}
    UIAgent={{}}
    AI_IMAGE_GENERATOR={{ getFallbackImage: () => '' }}
    logVaultImageError={() => {}}
  />
{/if}

<style>
  .series-page {
    min-height: 100vh;
    min-height: 100dvh;
    color: var(--lz-ink, #f4f4f5);
    background: var(--lz-atmosphere-soft, #05060a);
    font-family: var(--lz-font-body, 'Segoe UI', ui-sans-serif, system-ui, sans-serif);
  }
  .series-public {
    max-width: 920px;
    margin: 0 auto;
    padding: 0.5rem var(--lz-page-pad-x, 1.25rem) var(--lz-space-6, 2rem);
    animation: lz-fade-rise var(--lz-duration-slow, 480ms) var(--lz-ease, ease) both;
  }

  .series-public__missing {
    padding: 3rem 0;
  }

  .series-public__missing h1 {
    margin: 0 0 0.5rem;
    font-size: 1.75rem;
  }

  .series-public__missing p {
    color: var(--lz-ink-muted, rgba(255, 255, 255, 0.55));
  }

  .series-public__missing code {
    color: var(--lz-cyan, #00f2ff);
  }

  .series-public__hero {
    display: grid;
    gap: var(--lz-space-4, 1.25rem);
    margin-bottom: var(--lz-space-6, 2rem);
  }

  @media (min-width: 720px) {
    .series-public__hero {
      grid-template-columns: 200px 1fr;
      align-items: start;
    }
  }

  .series-public__poster-wrap {
    border-radius: var(--lz-radius-lg, 12px);
    overflow: hidden;
    border: 1px solid var(--lz-border, rgba(255, 255, 255, 0.1));
    background: rgba(255, 255, 255, 0.04);
    aspect-ratio: 2 / 3;
    max-width: 220px;
    box-shadow: var(--lz-shadow-soft, 0 8px 28px rgba(0, 0, 0, 0.35));
  }

  .series-public__poster {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .series-public__eyebrow {
    margin: 0 0 0.35rem;
    font-size: var(--lz-size-caption, 0.75rem);
    letter-spacing: var(--lz-tracking-brand, 0.14em);
    text-transform: uppercase;
    color: var(--lz-cyan, var(--neon-cyan, #00f2ff));
  }

  .series-public__title {
    margin: 0 0 0.65rem;
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }

  .series-public__desc {
    margin: 0 0 0.85rem;
    color: var(--lz-ink-soft, rgba(255, 255, 255, 0.72));
    line-height: var(--lz-leading, 1.5);
    max-width: 42rem;
  }

  .series-public__meta {
    margin: 0 0 1.1rem;
    font-size: var(--lz-size-small, 0.85rem);
    color: var(--lz-ink-dim, rgba(255, 255, 255, 0.5));
  }

  .series-public__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.85rem;
  }

  .series-public__cta {
    appearance: none;
    border: 1px solid rgba(0, 242, 255, 0.55);
    background: linear-gradient(135deg, rgba(0, 242, 255, 0.28), rgba(0, 140, 255, 0.18));
    color: #fff;
    font-weight: 650;
    font-size: 0.95rem;
    padding: 0.7rem 1.25rem;
    border-radius: var(--lz-radius-md, 10px);
    cursor: pointer;
    letter-spacing: 0.02em;
    font-family: inherit;
    transition:
      border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      box-shadow var(--lz-duration-fast, 160ms) var(--lz-ease, ease),
      opacity var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }

  .series-public__cta:hover:not(:disabled) {
    border-color: var(--lz-cyan, #00f2ff);
    box-shadow: 0 0 20px var(--lz-cyan-glow, rgba(0, 242, 255, 0.25));
  }

  .series-public__cta:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
  }

  .series-public__cta:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .series-public__cta--ghost {
    display: inline-block;
    text-decoration: none;
    margin-top: 1rem;
  }

  .series-public__notice {
    margin: 0.85rem 0 0;
    color: #fbbf24;
    font-size: 0.88rem;
  }

  .series-public__section-title {
    margin: 0 0 0.85rem;
    font-size: 1.05rem;
    letter-spacing: var(--lz-tracking-label, 0.04em);
    text-transform: uppercase;
    color: var(--lz-ink-soft, rgba(255, 255, 255, 0.75));
  }

  .series-public__season-list {
    display: flex;
    flex-direction: column;
    gap: var(--lz-space-2, 0.65rem);
    margin-bottom: var(--lz-space-6, 2rem);
  }

  .series-public__status-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .series-public__status-row {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) 4.5rem auto auto;
    gap: 0.65rem;
    align-items: center;
    padding: 0.55rem 0.75rem;
    border-radius: var(--lz-radius-md, 10px);
    border: 1px solid var(--lz-border, rgba(255, 255, 255, 0.08));
    background: rgba(255, 255, 255, 0.03);
    font-size: 0.88rem;
    transition: border-color var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }

  .series-public__status-thumb {
    width: 4.25rem;
    height: 2.4rem;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.35);
  }

  .series-public__status-row.unavailable {
    opacity: 0.7;
  }

  .series-public__status-row.playable {
    border-color: rgba(0, 242, 255, 0.18);
  }

  .series-public__status-code {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--lz-cyan, var(--neon-cyan, #00f2ff));
  }

  .series-public__status-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .series-public__status-badge {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.4rem;
    border-radius: var(--lz-radius-sm, 4px);
    background: rgba(255, 255, 255, 0.08);
    color: var(--lz-ink-muted, rgba(255, 255, 255, 0.55));
  }

  .series-public__row-play {
    appearance: none;
    border: 1px solid rgba(0, 242, 255, 0.35);
    background: transparent;
    color: var(--lz-cyan, #00f2ff);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.25rem 0.5rem;
    border-radius: var(--lz-radius-sm, 4px);
    cursor: pointer;
    font-family: inherit;
    transition: background var(--lz-duration-fast, 160ms) var(--lz-ease, ease);
  }

  .series-public__row-play:hover {
    background: rgba(0, 242, 255, 0.1);
  }

  .series-public__row-play:focus-visible {
    outline: 2px solid var(--lz-focus, rgba(0, 242, 255, 0.65));
    outline-offset: 2px;
  }

  @media (max-width: 560px) {
    .series-public__status-row {
      grid-template-columns: 3.5rem 1fr;
      grid-template-rows: auto auto;
    }
    .series-public__status-badge,
    .series-public__row-play {
      grid-column: 2;
      justify-self: start;
    }
  }
</style>
