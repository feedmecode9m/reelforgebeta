<script>
    import { createEventDispatcher } from 'svelte';
    import EpisodeChip from './EpisodeChip.svelte';

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

    $: sortedEpisodes = [...(season?.episodes || [])].sort((a, b) => a.episodeNumber - b.episodeNumber);
    $: seasonLabel = season?.title || `Season ${season?.seasonNumber ?? 1}`;
    $: episodeCount = sortedEpisodes.length;

    /** @param {string} episodeId */
    function toggleExpanded() {
        expanded = !expanded;
    }

    /** @param {CustomEvent<{ episodeId: string }>} event */
    function handleEpisodeSelect(event) {
        selectedEpisodeId = event.detail.episodeId;
        dispatch('episodeSelect', { seriesId, seasonNumber: season.seasonNumber, ...event.detail });
    }
</script>

<section class="season-accordion" class:expanded>
    <button
        type="button"
        class="season-accordion__header"
        aria-expanded={expanded}
        on:click={toggleExpanded}
    >
        <span class="season-accordion__chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span class="season-accordion__title">{seasonLabel}</span>
        <span class="season-accordion__count">{episodeCount} episode{episodeCount === 1 ? '' : 's'}</span>
    </button>

    {#if expanded}
        <div class="season-accordion__body" role="region" aria-label="{seasonLabel} episodes">
            {#each sortedEpisodes as episode (episode.episodeId)}
                <EpisodeChip
                    seasonNumber={season.seasonNumber}
                    episodeNumber={episode.episodeNumber}
                    title={episode.title}
                    episodeId={episode.episodeId}
                    status={episode.status}
                    playable={Boolean(episode.reelId) && (episode.status === 'published' || episode.status === 'ready')}
                    selected={selectedEpisodeId === episode.episodeId}
                    on:select={handleEpisodeSelect}
                />
            {/each}
        </div>
    {/if}
</section>

<style>
    .season-accordion {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.25);
    }
    .season-accordion.expanded {
        border-color: rgba(0, 242, 255, 0.2);
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
    .season-accordion__header:hover {
        background: rgba(0, 242, 255, 0.06);
    }
    .season-accordion__chevron {
        color: var(--neon-cyan, #00f2ff);
        font-size: 0.85rem;
        width: 1rem;
        flex-shrink: 0;
    }
    .season-accordion__title {
        flex: 1;
        font-size: 0.95rem;
        font-weight: 600;
    }
    .season-accordion__count {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.5);
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }
    .season-accordion__body {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        padding: 0.65rem;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
</style>
