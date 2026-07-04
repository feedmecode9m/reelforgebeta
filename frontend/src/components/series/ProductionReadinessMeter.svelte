<script>
    import SmartHelpTooltip from '../studio/SmartHelpTooltip.svelte';

    /** @type {import('../../lib/series/productionHealth.js').ProductionReadinessSnapshot} */
    export let readiness = {
        metadata: 0,
        assets: 0,
        publishing: 0,
        releaseSchedule: 0,
        weightedPercent: 0
    };

    const pillars = [
        { key: 'metadata', label: 'Metadata', weight: 25 },
        { key: 'assets', label: 'Assets', weight: 35 },
        { key: 'publishing', label: 'Publishing', weight: 25 },
        { key: 'releaseSchedule', label: 'Release Schedule', weight: 15 }
    ];
</script>

<div class="readiness-meter" data-production-readiness-meter data-studio-walkthrough="readinessMeter">
    <div class="readiness-meter__title-row">
        <h4 class="readiness-meter__title">Production Readiness</h4>
        <SmartHelpTooltip helpKey="readinessMeter" />
    </div>
    <div class="readiness-meter__weighted">
        <span class="readiness-meter__pct">{readiness.weightedPercent}%</span>
        <div class="readiness-meter__track">
            <div class="readiness-meter__fill" style="width: {readiness.weightedPercent}%"></div>
        </div>
    </div>
    <div class="readiness-meter__pillars">
        {#each pillars as pillar}
            <div class="readiness-meter__pillar">
                <div class="readiness-meter__pillar-head">
                    <span>{pillar.label}</span>
                    <span class="readiness-meter__pillar-weight">{pillar.weight}%</span>
                </div>
                <div class="readiness-meter__pillar-track">
                    <div
                        class="readiness-meter__pillar-fill"
                        style="width: {readiness[pillar.key]}%"
                    ></div>
                </div>
                <span class="readiness-meter__pillar-value">{readiness[pillar.key]}%</span>
            </div>
        {/each}
    </div>
</div>

<style>
    .readiness-meter {
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 0, 255, 0.2);
        background: rgba(255, 0, 255, 0.04);
    }
    .readiness-meter__title-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        margin-bottom: 0.55rem;
    }
    .readiness-meter__title {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--neon-pink, #ff00ff);
    }
    .readiness-meter__weighted {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        margin-bottom: 0.75rem;
    }
    .readiness-meter__pct {
        font-size: 1.35rem;
        font-weight: 800;
        color: #fff;
        min-width: 3.5rem;
    }
    .readiness-meter__track {
        flex: 1;
        height: 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
    }
    .readiness-meter__fill {
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--neon-pink, #ff00ff), var(--neon-cyan, #00f2ff));
    }
    .readiness-meter__pillars {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.5rem;
    }
    .readiness-meter__pillar {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }
    .readiness-meter__pillar-head {
        display: flex;
        justify-content: space-between;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.55);
    }
    .readiness-meter__pillar-weight {
        color: rgba(255, 255, 255, 0.35);
    }
    .readiness-meter__pillar-track {
        height: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
    }
    .readiness-meter__pillar-fill {
        height: 100%;
        border-radius: inherit;
        background: rgba(0, 242, 255, 0.75);
    }
    .readiness-meter__pillar-value {
        font-size: 0.68rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.8);
    }
    @media (max-width: 720px) {
        .readiness-meter__pillars { grid-template-columns: 1fr; }
    }
</style>
