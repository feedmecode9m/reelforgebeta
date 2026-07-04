<script>
    import { onMount } from 'svelte';
    import { buildHeroCommandBrief } from '../../lib/hero/heroIntelligence.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = 'series-neon-vengeance';
    /** @type {'overlay' | 'below'} */
    export let dock = 'overlay';

    /** @type {import('../../lib/hero/heroIntelligence.js').HeroCommandBrief | null} */
    let brief = null;

    function refreshBrief() {
        brief = buildHeroCommandBrief(seriesId, feedReels);
    }

    onMount(() => {
        refreshBrief();
        const onUpdate = () => refreshBrief();
        window.addEventListener('reelforge:pipeline-updated', onUpdate);
        window.addEventListener('reelforge:workflow-tasks-updated', onUpdate);
        window.addEventListener('reelforge:notifications-updated', onUpdate);
        window.addEventListener('reelforge:hero-intelligence-updated', onUpdate);
        return () => {
            window.removeEventListener('reelforge:pipeline-updated', onUpdate);
            window.removeEventListener('reelforge:workflow-tasks-updated', onUpdate);
            window.removeEventListener('reelforge:notifications-updated', onUpdate);
            window.removeEventListener('reelforge:hero-intelligence-updated', onUpdate);
        };
    });

    $: seriesId, feedReels, refreshBrief();
</script>

{#if brief}
    <aside
        class="hero-command-center"
        class:hero-command-center--below={dock === 'below'}
        data-hero-command-center
        data-hero-command-center-dock={dock}
    >
        <div class="hero-command-center__primary" data-hero-primary-card>
            <span class="hero-command-center__eyebrow">Current Series</span>
            <h2 class="hero-command-center__series" data-hero-series-title>{brief.primary.seriesTitle}</h2>
            <div class="hero-command-center__readiness">
                <strong data-hero-readiness>{brief.primary.readinessPercent}%</strong>
                <span>Production Readiness</span>
            </div>
            <p class="hero-command-center__blocker" data-hero-blocker>
                <span>Biggest Blocker</span>
                {brief.primary.biggestBlocker}
            </p>
        </div>

        <div class="hero-command-center__secondary">
            {#each brief.secondary as card (card.id)}
                <div class="hero-command-center__card" data-hero-secondary-card data-hero-card-id={card.id}>
                    <span class="hero-command-center__card-label">{card.label}</span>
                    <strong class="hero-command-center__card-value">{card.value}</strong>
                    {#if card.detail}
                        <p class="hero-command-center__card-detail">{card.detail}</p>
                    {/if}
                </div>
            {/each}
        </div>
    </aside>
{/if}

<style>
    .hero-command-center {
        position: absolute;
        left: 1.25rem;
        right: 1.25rem;
        bottom: 1.25rem;
        z-index: 2;
        display: grid;
        grid-template-columns: minmax(14rem, 1.1fr) minmax(0, 1.6fr);
        gap: 0.75rem;
        pointer-events: none;
    }
    .hero-command-center--below {
        position: relative;
        left: auto;
        right: auto;
        bottom: auto;
        z-index: auto;
        margin: 0.85rem 1.25rem 0;
    }
    .hero-command-center__primary,
    .hero-command-center__card {
        pointer-events: auto;
        border-radius: 10px;
        border: 1px solid rgba(0, 242, 255, 0.28);
        background: rgba(6, 10, 18, 0.78);
        backdrop-filter: blur(10px);
        padding: 0.85rem 1rem;
    }
    .hero-command-center__eyebrow {
        display: block;
        font-size: 0.62rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(0, 242, 255, 0.75);
        margin-bottom: 0.25rem;
    }
    .hero-command-center__series {
        margin: 0 0 0.55rem;
        font-size: 1.35rem;
        color: #fff;
        text-shadow: 0 0 24px rgba(0, 242, 255, 0.25);
    }
    .hero-command-center__readiness {
        display: flex;
        align-items: baseline;
        gap: 0.45rem;
        margin-bottom: 0.55rem;
    }
    .hero-command-center__readiness strong {
        font-size: 1.6rem;
        color: #ffd36e;
    }
    .hero-command-center__readiness span {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.55);
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }
    .hero-command-center__blocker {
        margin: 0;
        font-size: 0.78rem;
        color: rgba(255, 255, 255, 0.82);
        line-height: 1.4;
    }
    .hero-command-center__blocker span {
        display: block;
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 120, 120, 0.85);
        margin-bottom: 0.15rem;
    }
    .hero-command-center__secondary {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.55rem;
    }
    .hero-command-center__card-label {
        display: block;
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.48);
        margin-bottom: 0.2rem;
    }
    .hero-command-center__card-value {
        display: block;
        font-size: 0.95rem;
        color: #fff;
        margin-bottom: 0.15rem;
        line-height: 1.3;
    }
    .hero-command-center__card-detail {
        margin: 0;
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.52);
        line-height: 1.35;
    }
    @media (max-width: 900px) {
        .hero-command-center {
            grid-template-columns: 1fr;
        }
        .hero-command-center__secondary {
            grid-template-columns: 1fr 1fr;
        }
    }
</style>
