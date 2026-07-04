<script>
    /** @type {string} */
    export let genre = '';

    /** @type {number | null} */
    export let releaseYear = null;

    /** @type {'New' | 'Released' | 'Upcoming' | null} */
    export let displayStatus = null;

    /** @type {number | null} */
    export let totalEpisodes = null;

    /** @type {number | null} */
    export let completionPercent = null;

    $: hasStats = Boolean(
        genre || releaseYear || displayStatus || totalEpisodes != null || completionPercent != null
    );
</script>

{#if hasStats}
    <div class="series-stats" data-series-stats>
        {#if genre}
            <span class="series-stats__pill series-stats__pill--genre">{genre}</span>
        {/if}
        {#if releaseYear}
            <span class="series-stats__pill">{releaseYear}</span>
        {/if}
        {#if displayStatus}
            <span
                class="series-stats__pill"
                class:series-stats__pill--new={displayStatus === 'New'}
                class:series-stats__pill--released={displayStatus === 'Released'}
                class:series-stats__pill--upcoming={displayStatus === 'Upcoming'}
            >{displayStatus}</span>
        {/if}
        {#if totalEpisodes != null}
            <span class="series-stats__meta">{totalEpisodes} episode{totalEpisodes === 1 ? '' : 's'}</span>
        {/if}
        {#if completionPercent != null}
            <span class="series-stats__completion" aria-label="Series completion {completionPercent} percent">
                <span class="series-stats__completion-label">Series</span>
                <span class="series-stats__completion-track">
                    <span class="series-stats__completion-fill" style="width: {completionPercent}%"></span>
                </span>
                <span class="series-stats__completion-value">{completionPercent}%</span>
            </span>
        {/if}
    </div>
{/if}

<style>
    .series-stats {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem 0.55rem;
    }

    .series-stats__pill {
        display: inline-flex;
        align-items: center;
        padding: 0.18rem 0.55rem;
        border-radius: 999px;
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.88);
    }

    .series-stats__pill--genre {
        border-color: rgba(255, 0, 255, 0.35);
        color: var(--neon-pink, #ff00ff);
        background: rgba(255, 0, 255, 0.1);
    }

    .series-stats__pill--new {
        border-color: rgba(0, 242, 255, 0.45);
        color: #00f2ff;
        background: rgba(0, 242, 255, 0.12);
    }

    .series-stats__pill--released {
        border-color: rgba(120, 220, 120, 0.35);
        color: #9dffb0;
        background: rgba(80, 200, 120, 0.12);
    }

    .series-stats__pill--upcoming {
        border-color: rgba(255, 193, 7, 0.4);
        color: #ffd76a;
        background: rgba(255, 193, 7, 0.1);
    }

    .series-stats__meta {
        font-size: 0.68rem;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
    }

    .series-stats__completion {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        min-width: 7.5rem;
        flex: 1 1 7.5rem;
    }

    .series-stats__completion-label {
        font-size: 0.58rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.42);
        flex-shrink: 0;
    }

    .series-stats__completion-track {
        flex: 1;
        height: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.12);
        overflow: hidden;
    }

    .series-stats__completion-fill {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--neon-cyan, #00f2ff), #7af7ff);
    }

    .series-stats__completion-value {
        font-size: 0.62rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.75);
        flex-shrink: 0;
    }
</style>
