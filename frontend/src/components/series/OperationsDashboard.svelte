<script>
    import { onDestroy, onMount } from 'svelte';
    import { getOperationsSnapshot } from '../../lib/observability/platformMetrics.js';

    /** @type {string} */
    export let seriesId = '';

    let snapshot = getOperationsSnapshot(seriesId);
    let refreshTimer = null;

    function refresh() {
        snapshot = getOperationsSnapshot(seriesId);
    }

    onMount(() => {
        refresh();
        refreshTimer = setInterval(refresh, 5000);
        const onMetrics = () => refresh();
        window.addEventListener('reelforge:metrics-updated', onMetrics);
        return () => window.removeEventListener('reelforge:metrics-updated', onMetrics);
    });

    onDestroy(() => {
        if (refreshTimer) clearInterval(refreshTimer);
    });

    $: seriesId, refresh();
</script>

<section class="operations-dashboard" data-operations-dashboard>
    <div class="operations-dashboard__header">
        <h4>Operations Dashboard</h4>
        <span class="operations-dashboard__hint">Platform observability</span>
    </div>

    <div class="operations-dashboard__grid">
        <article class="operations-dashboard__card" data-metric-dau>
            <span class="operations-dashboard__label">Daily Active Viewers</span>
            <strong class="operations-dashboard__value">{snapshot.dailyActiveViewers}</strong>
        </article>

        <article class="operations-dashboard__card" data-metric-completion-rate>
            <span class="operations-dashboard__label">Series Completion Rate</span>
            <strong class="operations-dashboard__value">{snapshot.seriesCompletionRate}%</strong>
        </article>

        <article class="operations-dashboard__card" data-metric-studio-productivity>
            <span class="operations-dashboard__label">Studio Productivity</span>
            <strong class="operations-dashboard__value">{snapshot.studioProductivity}</strong>
            <span class="operations-dashboard__sub">actions today</span>
        </article>

        <article class="operations-dashboard__card" data-metric-publishing-velocity>
            <span class="operations-dashboard__label">Publishing Velocity</span>
            <strong class="operations-dashboard__value">{snapshot.publishingVelocity}</strong>
            <span class="operations-dashboard__sub">schedules / 7d</span>
        </article>
    </div>

    <div class="operations-dashboard__watchlist" data-metric-most-watched>
        <h5>Most Watched Episodes</h5>
        {#if snapshot.mostWatchedEpisodes.length === 0}
            <p class="operations-dashboard__empty">No watch data yet — open theater to begin tracking.</p>
        {:else}
            <ol class="operations-dashboard__episodes">
                {#each snapshot.mostWatchedEpisodes as ep, index (ep.episodeId)}
                    <li>
                        <span class="operations-dashboard__rank">#{index + 1}</span>
                        <span class="operations-dashboard__episode-title">{ep.title}</span>
                        <span class="operations-dashboard__episode-views">{ep.views} views</span>
                    </li>
                {/each}
            </ol>
        {/if}
    </div>
</section>

<style>
    .operations-dashboard {
        margin-bottom: 0.75rem;
        padding: 0.85rem;
        border-radius: 10px;
        border: 1px solid rgba(0, 242, 255, 0.2);
        background: rgba(0, 0, 0, 0.28);
    }
    .operations-dashboard__header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.65rem;
    }
    .operations-dashboard__header h4 {
        margin: 0;
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #00f2ff;
    }
    .operations-dashboard__hint {
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.45);
        text-transform: uppercase;
    }
    .operations-dashboard__grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.55rem;
        margin-bottom: 0.75rem;
    }
    .operations-dashboard__card {
        padding: 0.55rem 0.65rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
    }
    .operations-dashboard__label {
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.55);
    }
    .operations-dashboard__value {
        font-size: 1.35rem;
        line-height: 1.1;
        color: #fff;
    }
    .operations-dashboard__sub {
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.4);
    }
    .operations-dashboard__watchlist h5 {
        margin: 0 0 0.45rem;
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.7);
    }
    .operations-dashboard__empty {
        margin: 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.45);
    }
    .operations-dashboard__episodes {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .operations-dashboard__episodes li {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 0.5rem;
        align-items: center;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.85);
    }
    .operations-dashboard__rank {
        color: #00f2ff;
        font-weight: 700;
        min-width: 1.5rem;
    }
    .operations-dashboard__episode-views {
        color: rgba(255, 255, 255, 0.5);
        font-size: 0.65rem;
    }
    @media (max-width: 900px) {
        .operations-dashboard__grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
</style>
