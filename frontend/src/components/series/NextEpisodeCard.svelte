<script>
    import { resolveDisplayEpisodeStatus } from '../../lib/series/seriesIntelligence.js';
    import { nextEpisodeCardController } from '../../lib/series/episodeNavigation.js';

    /**
     * @type {{
     *   series: { title: string };
     *   season: { seasonNumber: number };
     *   episode: {
     *     episodeId: string;
     *     episodeNumber: number;
     *     title: string;
     *     description?: string;
     *     runtime?: number;
     *     status?: string;
     *     reelId?: string | null;
     *   };
     * } | null}
     */
    export let nextEpisode = null;

    /** @param {number} seconds */
    function formatRuntime(seconds) {
        if (!seconds || seconds <= 0) return '';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs ? `${mins}m ${secs}s` : `${mins}m`;
    }

    $: displayStatus = nextEpisode
        ? resolveDisplayEpisodeStatus(nextEpisode.episode, nextEpisode.episode.reelId || undefined)
        : null;
    $: runtimeLabel = nextEpisode ? formatRuntime(nextEpisode.episode.runtime) : '';
    $: nextEpisodeId = nextEpisode?.episode?.episodeId || '';
</script>

{#if nextEpisode}
    <button
        type="button"
        class="next-episode-card"
        aria-label="Play next episode S{nextEpisode.season.seasonNumber}:E{nextEpisode.episode.episodeNumber} {nextEpisode.episode.title}"
        data-next-episode-card
        data-next-episode-id={nextEpisodeId}
        use:nextEpisodeCardController
    >
        <header class="next-episode-card__header">
            <p class="next-episode-card__eyebrow">Up Next</p>
            {#if displayStatus}
                <span
                    class="next-episode-card__status"
                    class:next-episode-card__status--new={displayStatus === 'New'}
                    class:next-episode-card__status--upcoming={displayStatus === 'Upcoming'}
                >{displayStatus}</span>
            {/if}
        </header>
        <h4 class="next-episode-card__title">
            S{nextEpisode.season.seasonNumber}:E{nextEpisode.episode.episodeNumber}
            <span class="next-episode-card__divider" aria-hidden="true">·</span>
            {nextEpisode.episode.title}
        </h4>
        {#if nextEpisode.episode.description}
            <p class="next-episode-card__description">{nextEpisode.episode.description}</p>
        {/if}
        {#if runtimeLabel}
            <p class="next-episode-card__runtime">{runtimeLabel}</p>
        {/if}
    </button>
{/if}

<style>
    .next-episode-card {
        display: block;
        width: 100%;
        text-align: left;
        padding: 0.75rem 0.85rem;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-left: 3px solid var(--neon-cyan, #00f2ff);
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
        color: inherit;
        font: inherit;
    }

    .next-episode-card:hover {
        background: rgba(0, 242, 255, 0.08);
        border-color: rgba(0, 242, 255, 0.35);
    }

    .next-episode-card:focus-visible {
        outline: 2px solid rgba(0, 242, 255, 0.65);
        outline-offset: 2px;
    }

    .next-episode-card:active {
        transform: scale(0.99);
    }

    .next-episode-card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.35rem;
    }

    .next-episode-card__eyebrow {
        margin: 0;
        font-size: 0.6rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }

    .next-episode-card__status {
        font-size: 0.58rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 0.12rem 0.4rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        color: rgba(255, 255, 255, 0.8);
    }

    .next-episode-card__status--new {
        border-color: rgba(0, 242, 255, 0.4);
        color: #00f2ff;
    }

    .next-episode-card__status--upcoming {
        border-color: rgba(255, 193, 7, 0.4);
        color: #ffd76a;
    }

    .next-episode-card__title {
        margin: 0;
        font-size: 0.84rem;
        font-weight: 600;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.92);
    }

    .next-episode-card__divider {
        opacity: 0.45;
        padding: 0 0.15rem;
    }

    .next-episode-card__description {
        margin: 0.4rem 0 0;
        font-size: 0.74rem;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.62);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .next-episode-card__runtime {
        margin: 0.35rem 0 0;
        font-size: 0.62rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
</style>
