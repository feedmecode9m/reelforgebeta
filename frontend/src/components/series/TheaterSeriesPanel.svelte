<script>
    import { createEventDispatcher } from 'svelte';
    import SeriesBadge from './SeriesBadge.svelte';
    import EpisodeChip from './EpisodeChip.svelte';
    import SeriesStats from './SeriesStats.svelte';
    import ContinueWatchingBadge from './ContinueWatchingBadge.svelte';
    import NextEpisodeCard from './NextEpisodeCard.svelte';
    import { buildSeriesIntelligence } from '../../lib/series/seriesIntelligence.js';
    import { auditIntelligenceSources } from '../../lib/series/intelligenceSourceDiagnostics.js';

    const dispatch = createEventDispatcher();

    /**
     * @type {{
     *   series: { id?: string; title: string; genre?: string; description?: string };
     *   season: { seasonNumber: number };
     *   episode: {
     *     episodeId: string;
     *     episodeNumber: number;
     *     title: string;
     *     runtime?: number;
     *     genre?: string;
     *     description?: string;
     *     status?: string;
     *     reelId?: string | null;
     *     tags?: string[];
     *   };
     * } | null}
     */
    export let seriesContext = null;

    /** @type {boolean} */
    export let showEpisodeList = false;

    /** @param {number} seconds */
    function formatRuntime(seconds) {
        if (!seconds || seconds <= 0) return '';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs ? `${mins}m ${secs}s` : `${mins}m`;
    }

    $: intelligence = buildSeriesIntelligence(seriesContext);
    $: if (seriesContext) auditIntelligenceSources(seriesContext);
    $: seriesTitle = seriesContext?.series?.title?.trim() || '';
    $: seasonNumber = seriesContext?.season?.seasonNumber;
    $: episodeNumber = seriesContext?.episode?.episodeNumber;
    $: episodeTitle = seriesContext?.episode?.title?.trim() || '';
    $: runtimeLabel = formatRuntime(seriesContext?.episode?.runtime);
    $: description =
        (seriesContext?.episode?.description || seriesContext?.series?.description || '').trim();
    $: hasSeasonEpisode = seasonNumber != null && episodeNumber != null;
</script>

{#if seriesContext}
    <section class="theater-series-panel" aria-label="Series information" data-theater-series-panel>
        <header class="theater-series-panel__header">
            <p class="theater-series-panel__eyebrow">Series</p>
            {#if seriesTitle}
                <h2 class="theater-series-panel__series-title">{seriesTitle}</h2>
            {/if}
            {#if hasSeasonEpisode}
                <div class="theater-series-panel__badge-row">
                    <SeriesBadge
                        seriesTitle={seriesTitle}
                        seasonNumber={seasonNumber}
                        episodeNumber={episodeNumber}
                        episodeId={seriesContext.episode.episodeId}
                    />
                </div>
            {/if}
        </header>

        <SeriesStats
            genre={intelligence.genre}
            releaseYear={intelligence.releaseYear}
            displayStatus={intelligence.displayStatus}
            totalEpisodes={intelligence.totalEpisodes}
            completionPercent={intelligence.completionPercent}
        />

        <ContinueWatchingBadge percent={intelligence.continuePercent} />

        <div class="theater-series-panel__episode">
            {#if episodeTitle}
                <h3 class="theater-series-panel__episode-title">{episodeTitle}</h3>
            {/if}

            {#if runtimeLabel}
                <p class="theater-series-panel__runtime" aria-label="Episode runtime">{runtimeLabel}</p>
            {/if}

            <div class="theater-series-panel__now-playing" aria-label="Now playing">
                <span class="theater-series-panel__now-label">Now playing</span>
                <EpisodeChip
                    seasonNumber={seasonNumber ?? 1}
                    episodeNumber={episodeNumber ?? 1}
                    title={episodeTitle || 'Episode'}
                    episodeId={seriesContext.episode.episodeId}
                    status={seriesContext.episode.status || 'published'}
                    selected={true}
                    playable={true}
                />
            </div>
        </div>

        {#if description}
            <p class="theater-series-panel__description">{description}</p>
        {/if}

        <NextEpisodeCard nextEpisode={intelligence.nextEpisode} />

        {#if showEpisodeList}
            <div class="theater-series-panel__actions">
                <button
                    type="button"
                    class="theater-series-panel__episodes-btn"
                    aria-label="Open episode list for {seriesTitle || 'series'}"
                    on:click|stopPropagation={() => dispatch('episodes')}
                >
                    <span class="theater-series-panel__episodes-icon" aria-hidden="true">☰</span>
                    Episode List
                </button>
            </div>
        {/if}
    </section>
{/if}

<style>
    .theater-series-panel {
        margin-top: 1rem;
        padding: 1rem 1.1rem 1.15rem;
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.03) 100%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        position: relative;
        z-index: 1;
    }

    .theater-series-panel__eyebrow {
        margin: 0 0 0.2rem;
        font-size: 0.62rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }

    .theater-series-panel__series-title {
        margin: 0;
        font-size: clamp(1.15rem, 4.5vw, 1.55rem);
        font-weight: 700;
        line-height: 1.2;
        letter-spacing: -0.02em;
        color: #fff;
        text-shadow: 0 1px 18px rgba(0, 0, 0, 0.45);
    }

    .theater-series-panel__badge-row {
        margin-top: 0.45rem;
    }

    .theater-series-panel__episode-title {
        margin: 0;
        font-size: clamp(0.95rem, 3.8vw, 1.15rem);
        font-weight: 600;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.92);
    }

    .theater-series-panel__runtime {
        margin: 0.25rem 0 0;
        font-size: 0.68rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
    }

    .theater-series-panel__now-playing {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.4rem;
        margin-top: 0.55rem;
    }

    .theater-series-panel__now-playing :global(.episode-chip) {
        pointer-events: none;
        max-width: 100%;
    }

    .theater-series-panel__now-label {
        font-size: 0.62rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--neon-cyan, #00f2ff);
    }

    .theater-series-panel__description {
        margin: 0;
        font-size: 0.82rem;
        line-height: 1.55;
        color: rgba(255, 255, 255, 0.72);
        display: -webkit-box;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .theater-series-panel__actions {
        display: flex;
        gap: 0.5rem;
        padding-top: 0.15rem;
    }

    .theater-series-panel__episodes-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        width: 100%;
        min-height: 2.75rem;
        padding: 0.65rem 1rem;
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
    }

    .theater-series-panel__episodes-btn:hover {
        background: rgba(0, 242, 255, 0.14);
        border-color: rgba(0, 242, 255, 0.45);
    }

    .theater-series-panel__episodes-btn:active {
        transform: scale(0.98);
    }

    .theater-series-panel__episodes-icon {
        font-size: 1rem;
        line-height: 1;
    }

    @media (min-width: 520px) {
        .theater-series-panel {
            padding: 1.15rem 1.25rem 1.25rem;
            gap: 0.85rem;
        }

        .theater-series-panel__description {
            -webkit-line-clamp: 5;
        }

        .theater-series-panel__episodes-btn {
            width: auto;
            min-width: 11rem;
        }
    }
</style>
