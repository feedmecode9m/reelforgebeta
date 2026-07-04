<script>
    import { onMount } from 'svelte';
    import {
        masterMonetizationAnalysis,
        initMonetizationAI
    } from '../../lib/revenue/monetizationAI.js';

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {ReturnType<typeof masterMonetizationAnalysis> | null} */
    let analysis = null;

    function refresh() {
        initMonetizationAI();
        analysis = masterMonetizationAnalysis(seriesId, feedReels);
    }

    onMount(refresh);

    $: seriesId, feedReels, refresh();
</script>

{#if analysis}
    <section class="monetization-assistant" data-monetization-assistant-panel>
        <header class="monetization-assistant__header">
            <div>
                <h5>Monetization Intelligence</h5>
                <p>Fastest path to increased revenue across content, teams, publishing, marketplace, and revenue profiles.</p>
            </div>
            <strong data-monetization-revenue-score>{analysis.revenueScore}%</strong>
        </header>

        <div class="monetization-assistant__scores">
            <article data-monetization-readiness>
                <span>Monetization Readiness</span>
                <strong>{analysis.monetizationReadiness}%</strong>
            </article>
            <article data-monetization-sponsor-readiness>
                <span>Sponsor Readiness</span>
                <strong>{analysis.sponsorReadiness}%</strong>
            </article>
            <article data-monetization-subscription-readiness>
                <span>Subscription Readiness</span>
                <strong>{analysis.subscriptionReadiness}%</strong>
            </article>
            <article data-monetization-marketplace-potential>
                <span>Marketplace Potential</span>
                <strong>{analysis.marketplacePotential}%</strong>
            </article>
        </div>

        <div class="monetization-assistant__forecast" data-monetization-forecast>
            <span class="monetization-assistant__label">Projected Revenue</span>
            <strong>{analysis.projectedMonthlyFormatted} / month</strong>
            <em>{analysis.projectedAnnualFormatted} / year</em>
        </div>

        <div class="monetization-assistant__section" data-monetization-opportunities>
            <span class="monetization-assistant__label">Top Opportunities</span>
            <ul>
                {#each analysis.topOpportunities.slice(0, 4) as opportunity (opportunity.id)}
                    <li data-monetization-opportunity={opportunity.id}>
                        <strong>{opportunity.title}</strong>
                        <p>{opportunity.detail}</p>
                    </li>
                {/each}
            </ul>
        </div>

        {#if analysis.blockers.length}
            <div class="monetization-assistant__section" data-monetization-blockers>
                <span class="monetization-assistant__label">Blockers</span>
                <ul>
                    {#each analysis.blockers as blocker (blocker.id)}
                        <li data-monetization-blocker={blocker.id}>
                            <strong>{blocker.title}</strong>
                            <p>{blocker.detail}</p>
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}

        <div class="monetization-assistant__section" data-monetization-recommendations>
            <span class="monetization-assistant__label">Recommendations</span>
            <ul>
                {#each analysis.recommendations as recommendation (recommendation.id)}
                    <li data-monetization-recommendation={recommendation.id}>
                        <em>{recommendation.category}</em>
                        <strong>{recommendation.title}</strong>
                        <p>{recommendation.detail}</p>
                    </li>
                {/each}
            </ul>
        </div>
    </section>
{/if}

<style>
    .monetization-assistant {
        margin-top: 0.75rem;
        padding: 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(16, 185, 129, 0.22);
        background: rgba(16, 185, 129, 0.05);
    }
    .monetization-assistant__header {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        align-items: flex-start;
        margin-bottom: 0.65rem;
    }
    .monetization-assistant__header h5 {
        margin: 0 0 0.2rem;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(167, 243, 208, 0.95);
    }
    .monetization-assistant__header p {
        margin: 0;
        font-size: 0.62rem;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.55);
        max-width: 36rem;
    }
    .monetization-assistant__header strong {
        font-size: 1rem;
        color: #34d399;
    }
    .monetization-assistant__scores {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 0.5rem;
        margin-bottom: 0.65rem;
    }
    .monetization-assistant__scores article,
    .monetization-assistant__forecast {
        padding: 0.55rem 0.65rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
    }
    .monetization-assistant__scores span,
    .monetization-assistant__label {
        display: block;
        margin-bottom: 0.2rem;
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
    }
    .monetization-assistant__scores strong,
    .monetization-assistant__forecast strong {
        font-size: 0.82rem;
        color: rgba(255, 255, 255, 0.92);
    }
    .monetization-assistant__forecast {
        margin-bottom: 0.65rem;
    }
    .monetization-assistant__forecast em {
        display: block;
        margin-top: 0.15rem;
        font-style: normal;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.45);
    }
    .monetization-assistant__section ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.45rem;
    }
    .monetization-assistant__section li {
        padding: 0.5rem 0.55rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.18);
    }
    .monetization-assistant__section strong {
        display: block;
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.92);
    }
    .monetization-assistant__section p {
        margin: 0.15rem 0 0;
        font-size: 0.62rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.55);
    }
    .monetization-assistant__section em {
        display: block;
        margin-bottom: 0.15rem;
        font-style: normal;
        font-size: 0.54rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #34d399;
    }
    .monetization-assistant__section + .monetization-assistant__section {
        margin-top: 0.55rem;
    }
</style>
