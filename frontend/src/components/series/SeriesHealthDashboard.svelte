<script>
    import SmartHelpTooltip from '../studio/SmartHelpTooltip.svelte';

    /** @type {import('../../lib/series/productionHealth.js').SeriesHealthSnapshot} */
    export let health = {
        totalEpisodes: 0,
        assetCoverage: 0,
        missingAssets: 0,
        publishedEpisodes: 0,
        scheduledEpisodes: 0,
        draftEpisodes: 0,
        readyEpisodes: 0,
        overallReadinessScore: 0
    };
</script>

<div class="series-health" data-series-health-dashboard>
    <div class="series-health__title-row">
        <h4 class="series-health__title">Series Health</h4>
        <SmartHelpTooltip helpKey="productionHealth" />
    </div>
    <div class="series-health__score">
        <span class="series-health__score-value">{health.overallReadinessScore}%</span>
        <span class="series-health__score-label">Overall Readiness</span>
    </div>
    <div class="series-health__grid">
        <div class="series-health__stat">
            <span class="series-health__value">{health.totalEpisodes}</span>
            <span class="series-health__label">Total Episodes</span>
        </div>
        <div class="series-health__stat series-health__stat--cyan">
            <span class="series-health__value">{health.assetCoverage}%</span>
            <span class="series-health__label">Asset Coverage</span>
        </div>
        <div class="series-health__stat series-health__stat--warn">
            <span class="series-health__value">{health.missingAssets}</span>
            <span class="series-health__label">Missing Assets</span>
        </div>
        <div class="series-health__stat series-health__stat--ok">
            <span class="series-health__value">{health.publishedEpisodes}</span>
            <span class="series-health__label">Published</span>
        </div>
        <div class="series-health__stat series-health__stat--scheduled">
            <span class="series-health__value">{health.scheduledEpisodes}</span>
            <span class="series-health__label">Scheduled</span>
        </div>
        <div class="series-health__stat">
            <span class="series-health__value">{health.draftEpisodes}</span>
            <span class="series-health__label">Draft</span>
        </div>
    </div>
</div>

<style>
    .series-health {
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(0, 242, 255, 0.22);
        background: rgba(0, 0, 0, 0.28);
    }
    .series-health__title-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        margin-bottom: 0.55rem;
    }
    .series-health__title {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--neon-cyan, #00f2ff);
    }
    .series-health__score {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        margin-bottom: 0.65rem;
    }
    .series-health__score-value {
        font-size: 1.75rem;
        font-weight: 800;
        color: #fff;
        line-height: 1;
    }
    .series-health__score-label {
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.5);
    }
    .series-health__grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.45rem;
    }
    .series-health__stat {
        padding: 0.4rem 0.5rem;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
    }
    .series-health__value {
        font-size: 1rem;
        font-weight: 700;
        color: #fff;
    }
    .series-health__label {
        font-size: 0.55rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: rgba(255, 255, 255, 0.48);
    }
    .series-health__stat--cyan .series-health__value { color: var(--neon-cyan, #00f2ff); }
    .series-health__stat--warn .series-health__value { color: #ffd76a; }
    .series-health__stat--ok .series-health__value { color: #9dffb0; }
    .series-health__stat--scheduled .series-health__value { color: #c9a0ff; }
    @media (max-width: 720px) {
        .series-health__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
</style>
