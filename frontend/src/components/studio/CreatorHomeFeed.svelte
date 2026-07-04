<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        buildCreatorHomeFeed,
        initCreatorHomeFeed,
        loadCreatorHomeFeed
    } from '../../lib/discovery/creatorHomeFeed.js';
    import { navigateToTarget } from '../../lib/navigation/deepNavigation.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];
    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    let state = loadCreatorHomeFeed() || { cards: [], updatedAt: Date.now() };
    let cards = state.cards || [];

    function refresh(reason = 'component_refresh') {
        state = buildCreatorHomeFeed({ seriesId, feedReels, reason });
        cards = state?.cards || [];
    }

    /**
     * @param {Record<string, unknown> | null | undefined} target
     */
    function openTarget(target) {
        if (!target) return;
        navigateToTarget(/** @type {import('../../lib/navigation/deepNavigation.js').DeepNavigationTarget} */ (target));
    }

    function handleFeedUpdated(event) {
        const next = event?.detail;
        if (next?.cards) {
            state = next;
            cards = next.cards;
            return;
        }
        refresh('event_update');
    }

    onMount(() => {
        initCreatorHomeFeed({ seriesId, feedReels });
        refresh('mount');
        window.addEventListener('reelforge:creator-feed-updated', handleFeedUpdated);
        return () => window.removeEventListener('reelforge:creator-feed-updated', handleFeedUpdated);
    });

    onDestroy(() => {});

    $: seriesId, feedReels, refresh('props_update');
</script>

<section class="creator-home-feed" data-creator-feed>
    <header class="creator-home-feed__header">
        <div>
            <h4>Creator Home Feed</h4>
            <p>Dynamic homepage cards sorted by operational importance.</p>
        </div>
        <span class="creator-home-feed__updated">
            Updated {new Date(state?.updatedAt || Date.now()).toLocaleTimeString()}
        </span>
    </header>

    <div class="creator-home-feed__grid">
        {#each cards as card (card.id)}
            <article
                class="creator-home-feed__card"
                data-creator-feed-card
                data-creator-feed-kind={card.kind}
                data-creator-feed-importance={card.importance}
            >
                <div class="creator-home-feed__card-head">
                    <span class="creator-home-feed__kind">{card.kind.replace(/_/g, ' ')}</span>
                    <strong class="creator-home-feed__importance">{card.importance}</strong>
                </div>
                <h5>{card.title}</h5>
                <p>{card.detail}</p>
                {#if card.target}
                    <button type="button" data-creator-feed-open on:click={() => openTarget(card.target)}>
                        Open
                    </button>
                {/if}
            </article>
        {/each}
    </div>
</section>

<style>
    .creator-home-feed {
        margin-bottom: 0.85rem;
        padding: 0.85rem;
        border-radius: 10px;
        border: 1px solid rgba(0, 242, 255, 0.2);
        background: rgba(0, 242, 255, 0.04);
    }
    .creator-home-feed__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
        margin-bottom: 0.65rem;
    }
    .creator-home-feed__header h4 {
        margin: 0;
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--neon-cyan, #00f2ff);
    }
    .creator-home-feed__header p {
        margin: 0.2rem 0 0;
        font-size: 0.66rem;
        color: rgba(255, 255, 255, 0.58);
    }
    .creator-home-feed__updated {
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.45);
        white-space: nowrap;
    }
    .creator-home-feed__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.55rem;
    }
    .creator-home-feed__card {
        padding: 0.6rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.24);
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .creator-home-feed__card-head {
        display: flex;
        justify-content: space-between;
        gap: 0.4rem;
        align-items: center;
    }
    .creator-home-feed__kind {
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.48);
    }
    .creator-home-feed__importance {
        font-size: 0.62rem;
        color: #ffd36e;
    }
    .creator-home-feed__card h5 {
        margin: 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.92);
    }
    .creator-home-feed__card p {
        margin: 0;
        font-size: 0.66rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.62);
    }
    .creator-home-feed__card button {
        align-self: flex-start;
        border: 1px solid rgba(0, 242, 255, 0.4);
        background: rgba(0, 242, 255, 0.08);
        color: var(--neon-cyan, #00f2ff);
        border-radius: 6px;
        padding: 0.28rem 0.5rem;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        cursor: pointer;
    }
    @media (max-width: 900px) {
        .creator-home-feed__grid {
            grid-template-columns: 1fr;
        }
    }
</style>
