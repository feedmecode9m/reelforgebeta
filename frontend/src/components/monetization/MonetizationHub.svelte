<script>
    import { onMount } from 'svelte';
    import {
        PLAN_IDS,
        getEnabledDonationMethods,
        initMonetizationHub,
        loadMonetizationHubState,
        trackDonationClick,
        viewPlan
    } from '../../lib/monetization/monetizationHub.js';

    let state = loadMonetizationHubState();
    let methods = getEnabledDonationMethods(state);
    let selectedPlan = null;

    function refresh() {
        state = loadMonetizationHubState();
        methods = getEnabledDonationMethods(state);
    }

    function openDonation(method) {
        if (!method?.url) return;
        trackDonationClick(method.id, method.url, { source: 'monetization_hub' });
        window.open(method.url, '_blank', 'noopener,noreferrer');
    }

    function openPlan(planId) {
        selectedPlan = viewPlan(planId, { source: 'monetization_hub' });
    }

    function handleMonetizationUpdated() {
        refresh();
    }

    onMount(() => {
        initMonetizationHub();
        refresh();
        window.addEventListener('reelforge:monetization-updated', handleMonetizationUpdated);
        return () => window.removeEventListener('reelforge:monetization-updated', handleMonetizationUpdated);
    });
</script>

<section class="monetization-hub" data-monetization-hub>
    <header class="monetization-hub__header">
        <h4>Support ReelForge</h4>
        <p data-monetization-message>{state.message}</p>
    </header>

    <div class="monetization-hub__donations" data-monetization-donations>
        {#each methods as method (method.id)}
            <button
                type="button"
                data-donation-method={method.id}
                on:click={() => openDonation(method)}
            >
                {method.label}
            </button>
        {/each}
    </div>

    <article class="monetization-hub__architecture" data-monetization-architecture>
        <h5>Monetization Hub</h5>
        <p>Future-ready SaaS monetization foundation with plan-based upgrade paths and sustainable revenue channels.</p>
    </article>

    <div class="monetization-hub__plans" data-monetization-plans>
        {#each PLAN_IDS as planId (planId)}
            {@const plan = state.plans?.[planId]}
            <button
                type="button"
                class="monetization-hub__plan"
                data-plan-id={planId}
                on:click={() => openPlan(planId)}
            >
                <strong>{plan?.title || planId}</strong>
                <span>{plan?.stage || 'roadmap'}</span>
                <p>{plan?.description || 'Plan details pending'}</p>
            </button>
        {/each}
    </div>

    {#if selectedPlan}
        <footer class="monetization-hub__selected" data-plan-selected>
            <strong>{selectedPlan.title}</strong>
            <p>{selectedPlan.description}</p>
            <em>Target: {selectedPlan.targetUsers}</em>
        </footer>
    {/if}
</section>

<style>
    .monetization-hub {
        margin: 0.75rem 0 1rem;
        padding: 0.85rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 215, 0, 0.18);
        background: rgba(255, 215, 0, 0.04);
    }
    .monetization-hub__header h4 {
        margin: 0 0 0.2rem;
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #ffd36e;
    }
    .monetization-hub__header p {
        margin: 0;
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.72);
    }
    .monetization-hub__donations {
        margin-top: 0.55rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .monetization-hub__donations button {
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(0, 0, 0, 0.2);
        color: rgba(255, 255, 255, 0.92);
        border-radius: 999px;
        padding: 0.28rem 0.6rem;
        font-size: 0.58rem;
        cursor: pointer;
    }
    .monetization-hub__architecture {
        margin-top: 0.65rem;
        padding: 0.5rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.03);
    }
    .monetization-hub__architecture h5 {
        margin: 0 0 0.2rem;
        font-size: 0.62rem;
        color: #fff;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .monetization-hub__architecture p {
        margin: 0;
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.68);
    }
    .monetization-hub__plans {
        margin-top: 0.6rem;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.4rem;
    }
    .monetization-hub__plan {
        text-align: left;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.2);
        border-radius: 8px;
        padding: 0.45rem;
        cursor: pointer;
        display: grid;
        gap: 0.15rem;
    }
    .monetization-hub__plan strong {
        font-size: 0.62rem;
        color: #fff;
    }
    .monetization-hub__plan span {
        font-size: 0.54rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.52);
    }
    .monetization-hub__plan p {
        margin: 0;
        font-size: 0.58rem;
        color: rgba(255, 255, 255, 0.66);
        line-height: 1.35;
    }
    .monetization-hub__selected {
        margin-top: 0.55rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        padding-top: 0.45rem;
        display: grid;
        gap: 0.15rem;
    }
    .monetization-hub__selected strong {
        font-size: 0.62rem;
        color: #fff;
    }
    .monetization-hub__selected p {
        margin: 0;
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.72);
    }
    .monetization-hub__selected em {
        font-style: normal;
        font-size: 0.56rem;
        color: #ffd36e;
    }
    @media (max-width: 1000px) {
        .monetization-hub__plans {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 700px) {
        .monetization-hub__plans {
            grid-template-columns: 1fr;
        }
    }
</style>
