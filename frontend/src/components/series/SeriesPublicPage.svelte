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
  import { episodeIsPubliclyPlayable } from '../../lib/series/seriesTypes.js';
  import { episodeIsViewerDiscoverable } from '../../lib/series/publishingLifecycle.js';
  import { sortEpisodesForDisplay } from '../../lib/series/seriesCatalogEdits.js';
  import {
    listContinueWatching,
    formatRemainingLabel,
    getStoredWatchPercent
  } from '../../lib/series/seriesWatchProgress.js';
  import { recommendSeries } from '../../lib/series/seriesRecommendations.js';
  import { resolveReelForEpisode } from '../../lib/series/episodeBridge.js';
  import { configureEpisodeNavigation } from '../../lib/series/episodeNavigation.js';
  import {
    hydratePublicSeriesFromVault,
    resolvePublicSeriesBySlug,
    publicSeriesPath
  } from '../../lib/series/publicSeriesHydration.js';
  import {
    seriesCatalogCounts,
    creatorFacingDescription,
    creatorFacingGenre,
    resolveSeriesPosterSrc
  } from '../../lib/series/seriesCatalogTruth.js';
  import { resolvePublicGenreDisplay } from '../../lib/architecture/intelligenceProvenance.js';
  import { buildViewerIntelligencePresentation } from '../../lib/viewer/viewerIntelligencePresentation.js';
  import { DEFAULT_MEDIA_PLACEHOLDER } from '../../lib/config.js';
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
  import {
    watchSessionStart,
    watchOnProgress,
    watchOnPlay,
    watchOnPause,
    watchOnComplete,
    watchOnExit,
    watchApplyResume
  } from '../../lib/watch/watchTracker.js';
  import ConsumerChrome from '../navigation/ConsumerChrome.svelte';
  import ContinueWatchingBadge from './ContinueWatchingBadge.svelte';

  /** URL slug segment (e.g. neon-vengeance) */
  export let slug = '';

  const personalVideos = writable(/** @type {Record<string, unknown>[]} */ ([]));
  /** @type {Record<string, unknown>[]} */
  let heroVaultAssets = [];
  /**
   * Public /api/reels rows flattened for bound-id resolve on cold viewers
   * (empty personal vault). Not passed into vault membership inference —
   * presentation / playback registry only.
   * @type {Record<string, unknown>[]}
   */
  let publicApiReadyAssets = [];

  let selectedEpisodeId = '';
  let playNotice = '';
  let bootstrapped = false;
  /** True while vault inference + binding restore runs on cold load. */
  let hydrating = true;

  /**
   * Vault ready rows ∪ public API reels (deduped by id).
   * Lets resolveEpisodeMedia honor catalog reelId without requiring Hero Vault LS.
   * @returns {Record<string, unknown>[]}
   */
  function mergeReadyMediaAssets() {
    /** @type {Map<string, Record<string, unknown>>} */
    const byId = new Map();
    for (const item of [...heroVaultAssets, ...publicApiReadyAssets]) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || item.mediaAssetId || item.assetId || '').trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, item);
    }
    return [...byId.values()];
  }

  $: effectiveReadyAssets = mergeReadyMediaAssets();

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

    // Catalog-bound reels on public pages (cold vault) for resolveReelForEpisode.
    for (const reel of publicApiReadyAssets) {
      push(reel);
    }

    return entries;
  }

  /**
   * Map GET /api/reels rows into the vault-shaped ready asset shape expected by
   * resolveEpisodeMedia / isReadyVaultAsset (id + url + ready status).
   * @param {unknown} reels
   * @returns {Record<string, unknown>[]}
   */
  function mapApiReelsToReadyAssets(reels) {
    if (!Array.isArray(reels)) return [];
    /** @type {Record<string, unknown>[]} */
    const out = [];
    for (const r of reels) {
      if (!r || typeof r !== 'object') continue;
      const id = String(/** @type {Record<string, unknown>} */ (r).id || '').trim();
      if (!id) continue;
      const row = /** @type {Record<string, unknown>} */ (r);
      const url = String(row.url || row.videoUrl || row.video_url || row.mediaUrl || '').trim();
      if (!url) continue;
      // Pass through derivative fields so Theater prefers ready playbackUrl (master stays on `url`).
      const playbackUrl = String(row.playbackUrl || row.playback_url || '').trim();
      const playbackStatus = String(row.playbackStatus || row.playback_status || '')
        .trim()
        .toLowerCase();
      out.push({
        id,
        mediaAssetId: id,
        assetId: id,
        name: row.name || row.title || id,
        title: row.name || row.title || id,
        fileName: row.fileName || row.filename || '',
        url,
        videoUrl: url,
        thumbnailUrl: row.thumbnailUrl || row.thumbnail_url || '',
        status: row.status || 'ready',
        type: row.type || 'video',
        validated: row.validated,
        ...(playbackUrl ? { playbackUrl } : {}),
        ...(playbackStatus ? { playbackStatus } : {})
      });
    }
    return out;
  }

  $: series = resolveSeriesFromSlug(slug, $seriesCatalog);
  $: sortedSeasons = series
    ? [...(series.seasons || [])]
        .map((s) => ({
          ...s,
          episodes: sortEpisodesForDisplay(
            (s.episodes || []).filter((ep) => episodeIsViewerDiscoverable(ep))
          )
        }))
        .filter((s) => Array.isArray(s.episodes) && s.episodes.length > 0)
        .sort((a, b) => a.seasonNumber - b.seasonNumber)
    : [];
  $: allEpisodes = sortedSeasons.flatMap((season) =>
    (season.episodes || []).map((episode) => ({ season, episode }))
  );
  $: firstPlayable =
    allEpisodes.find(({ episode }) => {
      if (!episodeIsPubliclyPlayable(episode) && !episode.mediaAssetId && !episode.reelId) {
        return false;
      }
      // Viewer: published discovery only; still require media match
      if (!episodeIsViewerDiscoverable(episode)) return false;
      const resolved = resolveEpisodeMedia({
        episode,
        readyVaultAssets: effectiveReadyAssets
      });
      return resolved.matched || episodeIsPubliclyPlayable(episode);
    }) || null;
  $: playableCount = allEpisodes.filter(({ episode }) => {
    if (!episodeIsViewerDiscoverable(episode)) return false;
    const resolved = resolveEpisodeMedia({
      episode,
      readyVaultAssets: effectiveReadyAssets
    });
    return resolved.matched || episodeIsPubliclyPlayable(episode);
  }).length;
  // Counts only from series.seasons[].episodes[] (+ real vault playability).
  $: catalogCounts = series
    ? seriesCatalogCounts(
        {
          ...series,
          seasons: sortedSeasons
        },
        (episode) => {
          if (!episodeIsViewerDiscoverable(episode)) return false;
          const resolved = resolveEpisodeMedia({
            episode,
            readyVaultAssets: effectiveReadyAssets
          });
          return resolved.matched || episodeIsPubliclyPlayable(episode);
        }
      )
    : { seasonCount: 0, episodeCount: 0, playableCount: 0 };
  $: continueRows = (() => {
    if (!series) return [];
    const ids = new Set(
      allEpisodes
        .flatMap(({ episode }) => [episode.reelId, episode.mediaAssetId, episode.episodeId])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    );
    return listContinueWatching({ limit: 8 }).filter((row) => ids.has(String(row.reelId)));
  })();
  $: recommendations = series
    ? recommendSeries({ seedSeriesId: series.id, seedSeriesLabel: series.title, limit: 6 })
    : [];
  // Official Genre only when creator assigned it — never discovery shelf labels.
  $: publicGenre = (() => {
    const raw = creatorFacingGenre(series?.genre);
    const resolved = resolvePublicGenreDisplay(raw, 'creator');
    return resolved.official ? resolved.display : '';
  })();
  $: publicDescription = creatorFacingDescription(series?.description);
  // Intelligence is viewer-explaining only — never replaces series.title / genre / description.
  $: viewerPresentation = series
    ? buildViewerIntelligencePresentation({
        title: series.title,
        description: publicDescription,
        genre: publicGenre,
        identityTerms: Array.isArray(series.tags) ? series.tags : [],
        themes: Array.isArray(series.tags) ? series.tags : [],
        discoveryKeywords: Array.isArray(series.tags) ? series.tags : []
      })
    : null;
  $: seriesPosterSrc = resolveSeriesPosterSrc({
    seriesPoster: series?.poster,
    episodeThumbnails: allEpisodes.map(({ episode }) => {
      const resolved = resolveEpisodeMedia({
        episode,
        readyVaultAssets: effectiveReadyAssets
      });
      if (!resolved.matched) return null;
      return resolved.thumbnail || resolved.mediaUrl || null;
    }),
    placeholder: DEFAULT_MEDIA_PLACEHOLDER
  });

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

    // Viewer series page: published-only (ready/draft/archived cannot open Theater)
    if (!episodeIsViewerDiscoverable(ctx.episode)) {
      playNotice = 'This episode is not available to viewers yet.';
      return;
    }

    refreshHeroVaultAssets();
    // Manual binding override → keyword resolve (unchanged algorithm) → unavailable.
    // Uses vault ∪ public API reels so cold viewers resolve catalog reelId binds.
    const resolved = resolveEpisodeMedia({
      episode: ctx.episode,
      readyVaultAssets: mergeReadyMediaAssets()
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

    if (!episodeIsPubliclyPlayable(ctx.episode)) {
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
    // Do not feed public /api/reels into inference — catalog membership stays API-authoritative.
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

    // Public reel registry for bound catalog reelId → guide/playback resolve without personal vault.
    (async () => {
      try {
        const res = await fetch('/api/reels');
        if (!res.ok) return;
        const reels = await res.json();
        publicApiReadyAssets = mapApiReelsToReadyAssets(reels);
      } catch (err) {
        console.warn('[SeriesPublicPage] public /api/reels load failed', err);
      }
    })();

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
      watchSessionStart,
      watchOnProgress,
      watchOnPlay,
      watchOnPause,
      watchOnComplete,
      watchOnExit,
      watchApplyResume
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
    <section class="series-public__missing" aria-live="polite" data-series-not-found>
      <h1>Series not found</h1>
      <p>No creator series is available for <code>/series/{slug}</code>.</p>
      <p class="series-public__empty-hint">
        Series pages only render content that exists in the creator catalog
        (Hero Vault uploads, title edits, and explicit episode bindings).
      </p>
      <a class="series-public__cta series-public__cta--ghost" href="/">Back to home</a>
    </section>
  {:else}
    <section class="series-public__hero" aria-labelledby="series-public-title">
      {#if seriesPosterSrc}
        <div class="series-public__poster-wrap" aria-hidden="true">
          <img class="series-public__poster" src={seriesPosterSrc} alt="" />
        </div>
      {/if}
      <div class="series-public__hero-copy">
        {#if publicGenre}
          <p class="series-public__eyebrow">{publicGenre}</p>
        {/if}
        <h1 id="series-public-title" class="series-public__title" data-creator-title>
          {viewerPresentation?.display.primaryTitle || series.title}
        </h1>
        {#if publicDescription}
          <p class="series-public__desc" data-creator-description>{publicDescription}</p>
        {/if}
        {#if viewerPresentation?.display.showIntelligence}
          <div class="series-public__intelligence" data-intelligence-explanation>
            {#each viewerPresentation.display.intelligenceLines as line (line)}
              <p class="series-public__intel-line">{line}</p>
            {/each}
          </div>
        {/if}
        <p class="series-public__meta" data-series-catalog-counts>
          {catalogCounts.seasonCount} season{catalogCounts.seasonCount === 1 ? '' : 's'}
          · {catalogCounts.episodeCount} episode{catalogCounts.episodeCount === 1 ? '' : 's'}
          · {catalogCounts.playableCount} playable
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
      {#if sortedSeasons.length === 0}
        <p class="series-public__empty-episodes" data-series-empty-episodes>
          No creator episodes yet. Upload and bind media in Hero Vault to populate this series.
        </p>
      {:else}
        <div class="series-public__season-list">
          {#each sortedSeasons as season (season.seasonId || season.seasonNumber)}
            <SeasonAccordion
              seriesId={series.id}
              {season}
              heroVaultAssets={effectiveReadyAssets}
              seriesLabel={series.title || ''}
              viewerMode={true}
              flat={sortedSeasons.length === 1}
              defaultExpanded={season.seasonNumber === (sortedSeasons[0]?.seasonNumber ?? 1)}
              bind:selectedEpisodeId
              on:episodeSelect={handleEpisodeSelect}
            />
          {/each}
        </div>
      {/if}
    </section>

    {#if continueRows.length}
      <section class="series-public__continue" aria-label="Continue watching" data-series-continue-watching>
        <h2 class="series-public__section-title">Continue Watching</h2>
        <ul class="series-public__continue-list">
          {#each continueRows as row (row.reelId)}
            {@const epMatch =
              allEpisodes.find(
                ({ episode }) =>
                  String(episode.reelId || '') === String(row.reelId) ||
                  String(episode.mediaAssetId || '') === String(row.reelId)
              ) || null}
            <li class="series-public__continue-row">
              <div class="series-public__continue-copy">
                <span class="series-public__continue-title"
                  >{epMatch?.episode?.title || row.reelId}</span
                >
                <span class="series-public__continue-meta"
                  >{formatRemainingLabel(row.position, row.duration)}</span
                >
                <ContinueWatchingBadge percent={row.percent} />
              </div>
              {#if epMatch}
                <button
                  type="button"
                  class="series-public__row-play"
                  data-continue-resume={row.reelId}
                  on:click={() => playEpisode(epMatch.episode.episodeId, 'manual')}
                >
                  Resume
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if recommendations.length}
      <section class="series-public__recs" aria-label="Recommended series" data-series-recommendations>
        <h2 class="series-public__section-title">More like this</h2>
        <ul class="series-public__recs-list">
          {#each recommendations as rec (rec.seriesId)}
            {@const path =
              publicSeriesPath({ id: rec.seriesId, title: rec.title }) ||
              `/series/${String(rec.seriesId).replace(/^series-/, '')}`}
            <li class="series-public__rec-row">
              <a class="series-public__rec-link" href={path} data-recommendation-series={rec.seriesId}>
                {#if rec.poster}
                  <img class="series-public__rec-poster" src={rec.poster} alt="" loading="lazy" />
                {/if}
                <span class="series-public__rec-title">{rec.title}</span>
                <span class="series-public__rec-reason">{rec.reason}</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="series-public__status-board" aria-label="Episode guide">
      <h2 class="series-public__section-title">Episode guide</h2>
      {#if allEpisodes.length === 0}
        <p class="series-public__empty-episodes" data-series-empty-guide>
          No episode guide entries — the guide only lists catalog episodes bound by the creator.
        </p>
      {:else}
        <ul class="series-public__status-list">
          {#each allEpisodes as row (row.episode.episodeId)}
            {@const resolved = resolveEpisodeMedia({
              episode: row.episode,
              readyVaultAssets: effectiveReadyAssets
            })}
            {@const chip = episodeChipPresentation(row.episode, resolved)}
            {@const catalogPublic = episodeIsPubliclyPlayable(row.episode)}
            {@const guidePlayable = Boolean(chip.playable || catalogPublic)}
            {@const guideMediaId =
              chip.mediaAssetId || row.episode.mediaAssetId || row.episode.reelId || null}
            {@const guideLabel = chip.playable
              ? chip.bindingLabel
              : catalogPublic
                ? ''
                : chip.bindingLabel}
            {@const progressPct = getStoredWatchPercent(
              row.episode.episodeId,
              row.episode.reelId || row.episode.mediaAssetId
            )}
            <li
              class="series-public__status-row"
              class:playable={guidePlayable && catalogPublic}
              class:unavailable={!guidePlayable || !catalogPublic}
              data-episode-id={row.episode.episodeId}
              data-media-asset-id={guideMediaId || undefined}
              data-binding-mode={chip.bindingMode || undefined}
              data-display-order={row.episode.displayOrder ?? undefined}
            >
              <span class="series-public__status-code"
                >S{row.season.seasonNumber}:E{row.episode.episodeNumber}</span
              >
              <span class="series-public__status-title">{row.episode.title}</span>
              {#if chip.thumbnailUrl}
                <img class="series-public__status-thumb" src={chip.thumbnailUrl} alt="" />
              {/if}
              {#if guideLabel}
                <span class="series-public__status-badge">{guideLabel}</span>
              {/if}
              {#if progressPct != null && progressPct > 0 && progressPct < 100}
                <ContinueWatchingBadge percent={progressPct} />
              {/if}
              {#if guidePlayable && catalogPublic}
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
      {/if}
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

  .series-public__intelligence {
    margin: 0 0 0.9rem;
    max-width: 42rem;
    padding: 0.55rem 0.7rem;
    border-left: 2px solid rgba(250, 204, 21, 0.45);
    background: rgba(250, 204, 21, 0.05);
  }

  .series-public__intel-line {
    margin: 0.2rem 0 0;
    font-size: var(--lz-size-small, 0.85rem);
    color: rgba(255, 255, 255, 0.72);
    font-style: italic;
    line-height: 1.4;
  }

  .series-public__intel-line:first-child {
    margin-top: 0;
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

  .series-public__empty-hint,
  .series-public__empty-episodes {
    margin: 0.5rem 0 0;
    color: var(--lz-ink-muted, rgba(255, 255, 255, 0.55));
    font-size: 0.9rem;
    line-height: 1.45;
    max-width: 36rem;
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

  .series-public__continue,
  .series-public__recs {
    margin-bottom: var(--lz-space-6, 2rem);
  }

  .series-public__continue-list,
  .series-public__recs-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.65rem;
  }

  .series-public__continue-row,
  .series-public__rec-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: var(--lz-radius-md, 10px);
    background: rgba(255, 255, 255, 0.03);
  }

  .series-public__continue-copy {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
    flex: 1;
  }

  .series-public__continue-title,
  .series-public__rec-title {
    font-weight: 650;
    color: var(--lz-ink, #f4f4f5);
  }

  .series-public__continue-meta,
  .series-public__rec-reason {
    font-size: 0.75rem;
    color: var(--lz-ink-dim, rgba(255, 255, 255, 0.5));
  }

  .series-public__rec-link {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }

  .series-public__rec-poster {
    width: 2.5rem;
    height: 3.5rem;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
    background: rgba(0, 0, 0, 0.3);
  }

  .series-public__rec-title {
    display: block;
  }

  .series-public__rec-reason {
    display: block;
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
