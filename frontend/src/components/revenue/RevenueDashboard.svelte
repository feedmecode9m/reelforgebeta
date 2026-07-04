<script>
    import { onDestroy, onMount } from 'svelte';
    import {
        buildRevenueDashboardBrief,
        initRevenueCore
    } from '../../lib/revenue/revenueCore.js';
    import {
        fetchRevenueDashboard,
        fetchRevenueForecast,
        toRevenueDashboardBriefFromApi
    } from '../../lib/api/revenueApi.js';
    import {
        emitRevenueDashboardDiagnostics,
        initRevenueDashboard
    } from '../../lib/revenue/revenueDashboard.js';
    import { initRevenueEngine } from '../../lib/revenue/revenueEngine.js';
    import { emitAccessibilityAudit } from '../../lib/accessibility/accessibilityAudit.js';
    import MonetizationAssistantPanel from './MonetizationAssistantPanel.svelte';

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {ReturnType<typeof buildRevenueDashboardBrief> | null} */
    let brief = null;

    let refreshTimer = null;
    let refreshToken = 0;

    async function refresh(phase = 'refresh') {
        const token = ++refreshToken;
        initRevenueCore();
        initRevenueEngine();
        initRevenueDashboard();
        const localBrief = buildRevenueDashboardBrief(seriesId, feedReels);
        const dashboardPayload = await fetchRevenueDashboard({ seriesId });

        if (token !== refreshToken) return;

        if (dashboardPayload?.disabled) {
            brief = localBrief;
            emitRevenueDashboardDiagnostics(phase, brief, {
                source: 'revenue-dashboard',
                backend: 'fallback-local'
            });
            emitAccessibilityAudit('RevenueDashboard', {
                action: phase,
                backend: 'fallback-local'
            });
            return;
        }

        let backendBrief = toRevenueDashboardBriefFromApi(dashboardPayload, seriesId);
        const forecastPayload = await fetchRevenueForecast({ seriesId });
        if (token !== refreshToken) return;
        if (Array.isArray(forecastPayload?.forecasts) && forecastPayload.forecasts.length) {
            backendBrief = {
                ...backendBrief,
                forecasts: toRevenueDashboardBriefFromApi(
                    { ...dashboardPayload, forecasts: forecastPayload.forecasts },
                    seriesId
                ).forecasts
            };
        }
        brief = backendBrief;
        emitRevenueDashboardDiagnostics(phase, brief, {
            source: 'revenue-dashboard',
            backend: 'api'
        });
        emitAccessibilityAudit('RevenueDashboard', {
            action: phase,
            backend: 'api'
        });
    }

    onMount(() => {
        void refresh('load');
        refreshTimer = window.setInterval(() => {
            void refresh('refresh');
        }, 5000);
        const onUpdate = () => void refresh('refresh');
        window.addEventListener('reelforge:revenue-updated', onUpdate);
        return () => window.removeEventListener('reelforge:revenue-updated', onUpdate);
    });

    onDestroy(() => {
        if (refreshTimer) clearInterval(refreshTimer);
    });

    $: seriesId, feedReels, void refresh('refresh');
</script>

{#if brief}
    <section class="revenue-dashboard" data-revenue-dashboard aria-label="Revenue dashboard">
        <div class="revenue-dashboard__header">
            <h5>Executive Revenue Dashboard</h5>
            <span>{brief.currency} · {brief.seriesId}</span>
        </div>

        <div class="revenue-dashboard__grid" data-revenue-kpi-grid aria-live="polite">
            <article class="revenue-dashboard__card" data-revenue-kpi-mrr>
                <span class="revenue-dashboard__label">{brief.kpis.mrr.label}</span>
                <strong class="revenue-dashboard__value">{brief.kpis.mrr.formatted}</strong>
            </article>
            <article class="revenue-dashboard__card" data-revenue-kpi-arr>
                <span class="revenue-dashboard__label">{brief.kpis.arr.label}</span>
                <strong class="revenue-dashboard__value">{brief.kpis.arr.formatted}</strong>
            </article>
            <article class="revenue-dashboard__card" data-revenue-kpi-series-revenue>
                <span class="revenue-dashboard__label">{brief.kpis.seriesRevenue.label}</span>
                <strong class="revenue-dashboard__value">{brief.kpis.seriesRevenue.formatted}</strong>
            </article>
            <article class="revenue-dashboard__card" data-revenue-kpi-revenue-per-episode>
                <span class="revenue-dashboard__label">{brief.kpis.revenuePerEpisode.label}</span>
                <strong class="revenue-dashboard__value">{brief.kpis.revenuePerEpisode.formatted}</strong>
            </article>
            <article class="revenue-dashboard__card" data-revenue-kpi-revenue-per-creator>
                <span class="revenue-dashboard__label">{brief.kpis.revenuePerCreator.label}</span>
                <strong class="revenue-dashboard__value">{brief.kpis.revenuePerCreator.formatted}</strong>
            </article>
            <article class="revenue-dashboard__card" data-revenue-kpi-revenue-per-team>
                <span class="revenue-dashboard__label">{brief.kpis.revenuePerTeam.label}</span>
                <strong class="revenue-dashboard__value">{brief.kpis.revenuePerTeam.formatted}</strong>
            </article>
        </div>

        <div class="revenue-dashboard__forecasts" data-revenue-forecast-panel aria-live="polite">
            <h6>Revenue Forecasts</h6>
            <div class="revenue-dashboard__forecast-grid">
                {#each brief.forecasts as forecast (forecast.horizonDays)}
                    <article
                        class="revenue-dashboard__forecast-card"
                        data-revenue-forecast={forecast.horizonDays}
                    >
                        <span class="revenue-dashboard__label">{forecast.label}</span>
                        <strong class="revenue-dashboard__value">{forecast.formattedNet}</strong>
                        <em>Gross {forecast.formattedGross}</em>
                    </article>
                {/each}
            </div>
        </div>

        <MonetizationAssistantPanel {seriesId} {feedReels} />
    </section>
{/if}

<style>
    .revenue-dashboard {
        margin-top: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    .revenue-dashboard__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
    }
    .revenue-dashboard__header h5 {
        margin: 0;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.72);
    }
    .revenue-dashboard__header span {
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.42);
    }
    .revenue-dashboard__grid,
    .revenue-dashboard__forecast-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 0.55rem;
    }
    .revenue-dashboard__card,
    .revenue-dashboard__forecast-card {
        padding: 0.65rem 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(0, 242, 255, 0.18);
        background: rgba(0, 242, 255, 0.05);
    }
    .revenue-dashboard__label {
        display: block;
        margin-bottom: 0.2rem;
        font-size: 0.58rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.45);
    }
    .revenue-dashboard__value {
        display: block;
        font-size: 0.92rem;
        color: var(--neon-cyan, #00f2ff);
    }
    .revenue-dashboard__forecasts h6 {
        margin: 0 0 0.35rem;
        font-size: 0.66rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.55);
    }
    .revenue-dashboard__forecast-card em {
        display: block;
        margin-top: 0.2rem;
        font-style: normal;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.45);
    }
</style>
