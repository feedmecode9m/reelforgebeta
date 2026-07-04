<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        getDailyEngagementState,
        initDailyEngagementSystem
    } from '../../lib/engagement/dailyEngagement.js';

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';
    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    let state = getDailyEngagementState({ seriesId, feedReels });
    let cards = state?.cards || {};
    let removeListener = null;

    $: state = getDailyEngagementState({ seriesId, feedReels });
    $: cards = state?.cards || {};

    onMount(() => {
        initDailyEngagementSystem({ seriesId, feedReels });
        const onUpdated = (event) => {
            state = event.detail || getDailyEngagementState({ seriesId, feedReels });
            cards = state?.cards || {};
        };
        window.addEventListener('reelforge:daily-engagement-updated', onUpdated);
        removeListener = () => window.removeEventListener('reelforge:daily-engagement-updated', onUpdated);
    });

    onDestroy(() => {
        removeListener?.();
        removeListener = null;
    });
</script>

<section class="daily-engagement" data-daily-engagement>
    <header class="daily-engagement__header">
        <h4>Daily Engagement</h4>
        <span data-daily-engagement-day>{state?.dayKey || ''}</span>
    </header>
    <div class="daily-engagement__grid">
        {#each [
            ['dailyStudioTip', cards.dailyStudioTip],
            ['dailyCreatorChallenge', cards.dailyCreatorChallenge],
            ['todaysRelease', cards.todaysRelease],
            ['trendingCreator', cards.trendingCreator],
            ['sentinelInsightOfDay', cards.sentinelInsightOfDay],
            ['revenueInsightOfDay', cards.revenueInsightOfDay],
            ['marketplaceOpportunityOfDay', cards.marketplaceOpportunityOfDay]
        ] as [id, item]}
            <article class="daily-engagement__card" data-daily-engagement-card={id}>
                <h5>{item?.title || id}</h5>
                <p>{item?.detail || 'No insight available yet.'}</p>
            </article>
        {/each}
    </div>
</section>

<style>
    .daily-engagement {
        padding: 0.85rem;
        border-radius: 10px;
        border: 1px solid rgba(0, 242, 255, 0.2);
        background: rgba(0, 242, 255, 0.04);
        margin-bottom: 0.8rem;
    }
    .daily-engagement__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.55rem;
    }
    .daily-engagement__header h4 {
        margin: 0;
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--neon-cyan, #00f2ff);
    }
    .daily-engagement__header span {
        font-size: 0.56rem;
        color: rgba(255, 255, 255, 0.5);
    }
    .daily-engagement__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.5rem;
    }
    .daily-engagement__card {
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.24);
        padding: 0.55rem;
    }
    .daily-engagement__card h5 {
        margin: 0 0 0.25rem;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.88);
    }
    .daily-engagement__card p {
        margin: 0;
        font-size: 0.6rem;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.64);
    }
    @media (max-width: 900px) {
        .daily-engagement__grid {
            grid-template-columns: 1fr;
        }
    }
</style>
