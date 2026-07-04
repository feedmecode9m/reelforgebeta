<script>
    import SeriesBadge from '../series/SeriesBadge.svelte';
    import { metadataDisplayFlags } from '../../lib/publishing/publishingProfileStore.js';

    /** @type {{ series: { title: string; genre?: string }; season: { seasonNumber: number }; episode: { episodeNumber: number; title: string; runtime?: number; genre?: string; tags?: string[] } } | null} */
    export let seriesContext = null;

    /** @param {number} seconds */
    function formatRuntime(seconds) {
        if (!seconds || seconds <= 0) return '';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs ? `${mins}m ${secs}s` : `${mins}m`;
    }
</script>

{#if seriesContext}
    <div
        class="theater-series-metadata"
        class:layout-compact={$metadataDisplayFlags.layout === 'compact'}
        class:layout-rich={$metadataDisplayFlags.layout === 'rich'}
        data-theater-series-metadata
    >
        {#if $metadataDisplayFlags.showBadge}
            <SeriesBadge
                seriesTitle={seriesContext.series.title}
                seasonNumber={seriesContext.season.seasonNumber}
                episodeNumber={seriesContext.episode.episodeNumber}
            />
        {/if}

        {#if $metadataDisplayFlags.showEpisodeTitle || $metadataDisplayFlags.showRuntime || $metadataDisplayFlags.showGenre}
            <div class="theater-series-meta">
                {#if $metadataDisplayFlags.showEpisodeTitle}
                    <span class="theater-series-episode-title">{seriesContext.episode.title}</span>
                {/if}
                {#if $metadataDisplayFlags.showRuntime && seriesContext.episode.runtime}
                    <span class="theater-series-runtime">{formatRuntime(seriesContext.episode.runtime)}</span>
                {/if}
                {#if $metadataDisplayFlags.showGenre && (seriesContext.series.genre || seriesContext.episode.genre)}
                    <span class="theater-series-genre">{seriesContext.series.genre || seriesContext.episode.genre}</span>
                {/if}
            </div>
        {/if}

        {#if $metadataDisplayFlags.showTags && seriesContext.episode.tags?.length}
            <div class="theater-series-tags" aria-label="Episode tags">
                {#each seriesContext.episode.tags as tag}
                    <span class="theater-series-tag">{tag}</span>
                {/each}
            </div>
        {/if}
    </div>
{/if}

<style>
    .theater-series-metadata {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
    }
    .theater-series-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem 0.75rem;
    }
    .theater-series-episode-title {
        font-size: 0.82rem;
        color: rgba(255, 255, 255, 0.82);
        font-weight: 500;
    }
    .theater-series-runtime {
        font-size: 0.68rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
        padding: 0.15rem 0.45rem;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
    }
    .theater-series-genre {
        font-size: 0.68rem;
        letter-spacing: 0.05em;
        color: var(--neon-pink, #ff00ff);
        text-transform: uppercase;
    }
    .theater-series-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .theater-series-tag {
        font-size: 0.62rem;
        padding: 0.12rem 0.4rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.7);
    }
    .layout-rich .theater-series-episode-title {
        font-size: 0.95rem;
        font-weight: 600;
    }
    .layout-rich .theater-series-tag {
        background: rgba(255, 0, 0, 0.12);
        border-color: rgba(255, 0, 0, 0.35);
    }
    .layout-compact .theater-series-meta {
        gap: 0.35rem 0.5rem;
    }
</style>
