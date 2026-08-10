<script>
    import { createEventDispatcher } from 'svelte';
    import EpisodeChip from './EpisodeChip.svelte';
    import {
        resolveEpisodeMedia,
        episodeChipPresentation
    } from '../../lib/series/episodeVaultBindingResolver.js';
    import { getReadyHeroVaultAssets } from '../../lib/series/heroVaultAssetSource.js';
    import { resolveViewerEpisodePosterUrl } from '../../lib/series/viewerEpisodePoster.js';

    const dispatch = createEventDispatcher();

    /** @type {string} */
    export let seriesId = '';

    /** @type {import('../../lib/series/seriesTypes.js').Season} */
    export let season;

    /** @type {boolean} */
    export let defaultExpanded = false;

    let expanded = defaultExpanded;

    /** @type {string} */
    export let selectedEpisodeId = '';

    /**
     * Ready Hero Vault assets (optional parent override; falls back to canonical source).
     * @type {Record<string, unknown>[]}
     */
    export let heroVaultAssets = [];

    /**
     * Viewer Theater list — no admin binding chrome on chips.
     * @type {boolean}
     */
    export let viewerMode = false;

    /**
     * Flat shelf: no accordion shell (single-season viewer lists).
     * @type {boolean}
     */
    export let flat = false;

    /** @type {string} */
    export let seriesLabel = '';

    $: readyVaultAssets =
        Array.isArray(heroVaultAssets) && heroVaultAssets.length
            ? heroVaultAssets
            : getReadyHeroVaultAssets();

    $: sortedEpisodes = [...(season?.episodes || [])]
        .filter(Boolean)
        .sort((a, b) => a.episodeNumber - b.episodeNumber);
    $: seasonLabel = season?.title || `Season ${season?.seasonNumber ?? 1}`;
    $: episodeCount = sortedEpisodes.length;
    $: effectiveSeriesLabel = String(seriesLabel || '').trim();
    $: showShell = !flat && viewerMode && episodeCount > 0;
    $: showViewerFlat = viewerMode && flat && episodeCount > 0;
    $: showAdmin = !viewerMode && episodeCount > 0;

    // Viewer multi-season: keep first pass open; flat is always open without shell
    $: if (viewerMode && flat) expanded = true;

    /**
     * @param {import('../../lib/series/seriesTypes.js').Episode} episode
     */
    function resolveForChip(episode) {
        return resolveEpisodeMedia({ episode, readyVaultAssets });
    }

    /**
     * Viewer poster: chip/vault first, then mediaAssetId-keyed product thumbs.
     * Does not change playable selection or media ownership.
     * @param {import('../../lib/series/seriesTypes.js').Episode} episode
     * @param {{ thumbnailUrl?: string }} chip
     */
    function posterForChip(episode, chip) {
        return resolveViewerEpisodePosterUrl({
            episode,
            chipThumbnailUrl: chip?.thumbnailUrl || '',
            readyVaultAssets
        });
    }

    function toggleExpanded() {
        if (flat) return;
        expanded = !expanded;
    }

    /** @param {CustomEvent<{ episodeId: string }>} event */
    function handleEpisodeSelect(event) {
        selectedEpisodeId = event.detail.episodeId;
        dispatch('episodeSelect', { seriesId, seasonNumber: season.seasonNumber, ...event.detail });
    }

    /**
     * Active rail state: selected id may be catalog episode id, vault media id, or reel id.
     * @param {import('../../lib/series/seriesTypes.js').Episode} episode
     */
    function isEpisodeSelected(episode) {
        const sel = String(selectedEpisodeId || '').trim();
        if (!sel) return false;
        const candidates = [episode.episodeId, episode.mediaAssetId, episode.reelId]
            .map((v) => String(v || '').trim())
            .filter(Boolean);
        return candidates.includes(sel);
    }
</script>

{#if showViewerFlat}
    <!-- Single-season shelf: no empty accordion chrome -->
    <div class="season-shelf" role="list" aria-label="{seasonLabel} episodes">
        {#each sortedEpisodes as episode (episode.episodeId)}
            {@const vault = resolveForChip(episode)}
            {@const chip = episodeChipPresentation(episode, vault)}
            <div role="listitem">
                <EpisodeChip
                    seasonNumber={season.seasonNumber}
                    episodeNumber={episode.episodeNumber}
                    title={episode.title}
                    seriesLabel={/** @type {{ seriesLabel?: string }} */ (episode).seriesLabel ||
                        effectiveSeriesLabel}
                    viewerMode={true}
                    episodeId={episode.episodeId}
                    status={episode.status}
                    mediaAssetId={chip.mediaAssetId || episode.mediaAssetId || episode.reelId || null}
                    thumbnailUrl={posterForChip(episode, chip)}
                    matchTier={null}
                    bindingLabel={''}
                    playable={chip.playable || Boolean(episode.mediaAssetId || episode.reelId)}
                    selected={isEpisodeSelected(episode)}
                    on:select={handleEpisodeSelect}
                />
            </div>
        {/each}
    </div>
{:else if showShell}
    <section class="season-accordion season-accordion--viewer" class:expanded>
        <button
            type="button"
            class="season-accordion__header season-accordion__header--viewer"
            aria-expanded={expanded}
            on:click={toggleExpanded}
        >
            <span class="season-accordion__chevron season-accordion__chevron--viewer" aria-hidden="true"
                >{expanded ? '▾' : '▸'}</span
            >
            <span class="season-accordion__title">{seasonLabel}</span>
            <span class="season-accordion__count">{episodeCount} ep{episodeCount === 1 ? '' : 's'}</span>
        </button>

        {#if expanded}
            <div
                class="season-accordion__body season-accordion__body--viewer"
                role="region"
                aria-label="{seasonLabel} episodes"
            >
                {#each sortedEpisodes as episode (episode.episodeId)}
                    {@const vault = resolveForChip(episode)}
                    {@const chip = episodeChipPresentation(episode, vault)}
                    <EpisodeChip
                        seasonNumber={season.seasonNumber}
                        episodeNumber={episode.episodeNumber}
                        title={episode.title}
                        seriesLabel={/** @type {{ seriesLabel?: string }} */ (episode).seriesLabel ||
                            effectiveSeriesLabel}
                        viewerMode={true}
                        episodeId={episode.episodeId}
                        status={episode.status}
                        mediaAssetId={chip.mediaAssetId || episode.mediaAssetId || episode.reelId || null}
                        thumbnailUrl={posterForChip(episode, chip)}
                        matchTier={null}
                        bindingLabel={''}
                        playable={chip.playable || Boolean(episode.mediaAssetId || episode.reelId)}
                        selected={isEpisodeSelected(episode)}
                        on:select={handleEpisodeSelect}
                    />
                {/each}
            </div>
        {/if}
    </section>
{:else if showAdmin}
    <section class="season-accordion" class:expanded>
        <button
            type="button"
            class="season-accordion__header"
            aria-expanded={expanded}
            on:click={toggleExpanded}
        >
            <span class="season-accordion__chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
            <span class="season-accordion__title">{seasonLabel}</span>
            <span class="season-accordion__count"
                >{episodeCount} episode{episodeCount === 1 ? '' : 's'}</span
            >
        </button>

        {#if expanded}
            <div class="season-accordion__body" role="region" aria-label="{seasonLabel} episodes">
                {#each sortedEpisodes as episode (episode.episodeId)}
                    {@const vault = resolveForChip(episode)}
                    {@const chip = episodeChipPresentation(episode, vault)}
                    <EpisodeChip
                        seasonNumber={season.seasonNumber}
                        episodeNumber={episode.episodeNumber}
                        title={episode.title}
                        seriesLabel={/** @type {{ seriesLabel?: string }} */ (episode).seriesLabel ||
                            effectiveSeriesLabel}
                        viewerMode={false}
                        episodeId={episode.episodeId}
                        status={episode.status}
                        mediaAssetId={chip.mediaAssetId || episode.mediaAssetId || episode.reelId || null}
                        thumbnailUrl={posterForChip(episode, chip)}
                        matchTier={chip.matchTier}
                        bindingLabel={chip.bindingLabel}
                        playable={chip.playable || Boolean(episode.mediaAssetId || episode.reelId)}
                        selected={isEpisodeSelected(episode)}
                        on:select={handleEpisodeSelect}
                    />
                {/each}
            </div>
        {/if}
    </section>
{/if}

<style>
    .season-shelf {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    .season-accordion {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.25);
    }
    .season-accordion.expanded {
        border-color: rgba(0, 242, 255, 0.2);
    }
    .season-accordion--viewer {
        border: none;
        background: transparent;
        border-radius: 0;
        overflow: visible;
    }
    .season-accordion--viewer.expanded {
        border-color: transparent;
    }
    .season-accordion__header {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.65rem;
        padding: 0.85rem 1rem;
        background: rgba(255, 255, 255, 0.03);
        border: none;
        color: #fff;
        cursor: pointer;
        text-align: left;
        transition: background 0.2s ease;
    }
    .season-accordion__header--viewer {
        padding: 0.35rem 0.15rem 0.5rem;
        background: transparent;
        gap: 0.5rem;
        cursor: pointer;
        pointer-events: auto;
    }
    .season-accordion__header:hover {
        background: rgba(0, 242, 255, 0.06);
    }
    .season-accordion__header--viewer:hover {
        background: rgba(255, 255, 255, 0.03);
    }
    .season-accordion__chevron {
        color: var(--neon-cyan, #00f2ff);
        font-size: 0.85rem;
        width: 1rem;
        flex-shrink: 0;
    }
    .season-accordion__chevron--viewer {
        color: rgba(255, 255, 255, 0.4);
        font-size: 0.7rem;
    }
    .season-accordion__title {
        flex: 1;
        font-size: 0.95rem;
        font-weight: 600;
    }
    .season-accordion--viewer .season-accordion__title {
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .season-accordion__count {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.5);
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }
    .season-accordion--viewer .season-accordion__count {
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.35);
    }
    .season-accordion__body {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        padding: 0.65rem;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .season-accordion__body--viewer {
        padding: 0;
        border-top: none;
        gap: 0.5rem;
    }
</style>
