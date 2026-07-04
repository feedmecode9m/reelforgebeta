<script>
    import { onMount } from 'svelte';
    import {
        buildDiscoveryFeed,
        initDiscoveryFeedEngine,
        loadDiscoveryFeedStore
    } from '../../lib/discovery/discoveryFeedEngine.js';
    import { navigateToTarget } from '../../lib/navigation/deepNavigation.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];
    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    const SECTION_ORDER = [
        'trendingCreators',
        'marketplaceOpportunities',
        'upcomingReleases',
        'revenueMilestones',
        'sentinelInsights',
        'teamHighlights',
        'productionWins',
        'dailyRecommendations'
    ];

    const SECTION_LABELS = {
        trendingCreators: 'Trending Creators',
        marketplaceOpportunities: 'Marketplace Opportunities',
        upcomingReleases: 'Upcoming Releases',
        revenueMilestones: 'Revenue Milestones',
        sentinelInsights: 'Sentinel Insights',
        teamHighlights: 'Team Highlights',
        productionWins: 'Production Wins',
        dailyRecommendations: 'Daily Recommendations'
    };

    let state = loadDiscoveryFeedStore() || {
        updatedAt: Date.now(),
        cards: [],
        sections: {}
    };
    let cards = state.cards || [];
    let sections = state.sections || {};

    function refresh(reason = 'panel_refresh') {
        state = buildDiscoveryFeed({ seriesId, feedReels, reason });
        cards = state?.cards || [];
        sections = state?.sections || {};
    }

    function openCardTarget(target) {
        if (!target) return;
        navigateToTarget(/** @type {import('../../lib/navigation/deepNavigation.js').DeepNavigationTarget} */ (target));
    }

    function handleFeedUpdated(event) {
        const next = event?.detail;
        if (!next?.cards || !next?.sections) {
            refresh('event_fallback_refresh');
            return;
        }
        state = next;
        cards = next.cards;
        sections = next.sections;
    }

    onMount(() => {
        initDiscoveryFeedEngine({ seriesId, feedReels });
        refresh('mount');
        window.addEventListener('reelforge:discovery-feed-updated', handleFeedUpdated);
        return () => {
            window.removeEventListener('reelforge:discovery-feed-updated', handleFeedUpdated);
        };
    });

    $: seriesId, feedReels, refresh('props_update');
</script>

<section class="discovery-feed" data-discovery-feed>
    <header class="discovery-feed__header">
        <div>
            <h4>Discovery Feed</h4>
            <p>Daily return feed powered by platform activity.</p>
        </div>
        <span class="discovery-feed__updated">
            Updated {new Date(state?.updatedAt || Date.now()).toLocaleTimeString()}
        </span>
    </header>

    <div class="discovery-feed__section-grid">
        {#each SECTION_ORDER as sectionKey (sectionKey)}
            {@const sectionCards = sections?.[sectionKey] || []}
            <article class="discovery-feed__section" data-discovery-feed-section={sectionKey}>
                <h5>{SECTION_LABELS[sectionKey]}</h5>
                {#if sectionCards.length}
                    {@const topCard = sectionCards[0]}
                    <strong>{topCard.title}</strong>
                    <p>{topCard.detail}</p>
                    <span class="discovery-feed__score">Score {topCard.score}</span>
                    {#if topCard.target}
                        <button type="button" on:click={() => openCardTarget(topCard.target)}>
                            Open
                        </button>
                    {/if}
                {:else}
                    <p>No cards available yet.</p>
                {/if}
            </article>
        {/each}
    </div>

    <div class="discovery-feed__ranked" data-discovery-feed-ranked>
        <h5>Top Recommendations</h5>
        <ul>
            {#each cards.slice(0, 6) as card (card.id)}
                <li data-discovery-feed-card={card.sectionId}>
                    <span>{card.sectionTitle}</span>
                    <strong>{card.title}</strong>
                    <em>{card.score}</em>
                </li>
            {/each}
        </ul>
    </div>
</section>

<style>
    .discovery-feed {
        margin: 0.7rem 0 1rem;
        padding: 0.9rem;
        border-radius: 10px;
        border: 1px solid rgba(0, 242, 255, 0.2);
        background: rgba(0, 242, 255, 0.04);
    }
    .discovery-feed__header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.75rem;
        margin-bottom: 0.7rem;
    }
    .discovery-feed__header h4 {
        margin: 0;
        font-size: 0.75rem;
        color: #00f2ff;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .discovery-feed__header p {
        margin: 0.2rem 0 0;
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.62);
    }
    .discovery-feed__updated {
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.5);
        white-space: nowrap;
    }
    .discovery-feed__section-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.5rem;
    }
    .discovery-feed__section {
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.25);
        padding: 0.52rem;
        display: grid;
        gap: 0.22rem;
        min-height: 7.2rem;
    }
    .discovery-feed__section h5 {
        margin: 0;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.48);
    }
    .discovery-feed__section strong {
        font-size: 0.67rem;
        color: #fff;
    }
    .discovery-feed__section p {
        margin: 0;
        font-size: 0.61rem;
        color: rgba(255, 255, 255, 0.66);
        line-height: 1.35;
    }
    .discovery-feed__score {
        font-size: 0.56rem;
        color: #ffd36e;
    }
    .discovery-feed__section button {
        justify-self: start;
        margin-top: 0.1rem;
        border: 1px solid rgba(0, 242, 255, 0.4);
        border-radius: 6px;
        background: rgba(0, 242, 255, 0.08);
        color: #00f2ff;
        font-size: 0.56rem;
        padding: 0.24rem 0.45rem;
        cursor: pointer;
    }
    .discovery-feed__ranked {
        margin-top: 0.65rem;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        padding-top: 0.55rem;
    }
    .discovery-feed__ranked h5 {
        margin: 0 0 0.3rem;
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .discovery-feed__ranked ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 0.2rem;
    }
    .discovery-feed__ranked li {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.45rem;
        align-items: center;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.76);
    }
    .discovery-feed__ranked li span {
        color: rgba(255, 255, 255, 0.48);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .discovery-feed__ranked li strong {
        font-size: 0.62rem;
        color: #fff;
    }
    .discovery-feed__ranked li em {
        font-style: normal;
        color: #ffd36e;
    }
    @media (max-width: 1200px) {
        .discovery-feed__section-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 760px) {
        .discovery-feed__section-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
