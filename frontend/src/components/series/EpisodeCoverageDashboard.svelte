<script>
    /** @type {number} */
    export let totalEpisodes = 0;

    /** @type {number} */
    export let episodesWithAssets = 0;

    /** @type {number} */
    export let episodesMissingAssets = 0;

    /** @type {number} */
    export let coveragePercent = 0;
</script>

<div class="episode-coverage" data-episode-coverage-dashboard>
    <h4 class="episode-coverage__title">Asset Coverage</h4>
    <div class="episode-coverage__grid">
        <div class="episode-coverage__stat">
            <span class="episode-coverage__value">{totalEpisodes}</span>
            <span class="episode-coverage__label">Total Episodes</span>
        </div>
        <div class="episode-coverage__stat episode-coverage__stat--ok">
            <span class="episode-coverage__value">{episodesWithAssets}</span>
            <span class="episode-coverage__label">With Assets</span>
        </div>
        <div class="episode-coverage__stat episode-coverage__stat--warn">
            <span class="episode-coverage__value">{episodesMissingAssets}</span>
            <span class="episode-coverage__label">Missing Assets</span>
        </div>
        <div class="episode-coverage__stat episode-coverage__stat--pct">
            <span class="episode-coverage__value">{coveragePercent}%</span>
            <span class="episode-coverage__label">Coverage</span>
        </div>
    </div>
    <div class="episode-coverage__track" aria-hidden="true">
        <div class="episode-coverage__fill" style="width: {coveragePercent}%"></div>
    </div>
</div>

<style>
    .episode-coverage {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(0, 242, 255, 0.2);
        background: rgba(0, 0, 0, 0.25);
    }
    .episode-coverage__title {
        margin: 0 0 0.65rem;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--neon-cyan, #00f2ff);
    }
    .episode-coverage__grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.5rem;
    }
    .episode-coverage__stat {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        padding: 0.45rem 0.5rem;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .episode-coverage__value {
        font-size: 1.1rem;
        font-weight: 700;
        color: #fff;
    }
    .episode-coverage__label {
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
    }
    .episode-coverage__stat--ok .episode-coverage__value {
        color: #9dffb0;
    }
    .episode-coverage__stat--warn .episode-coverage__value {
        color: #ffd76a;
    }
    .episode-coverage__stat--pct .episode-coverage__value {
        color: var(--neon-cyan, #00f2ff);
    }
    .episode-coverage__track {
        margin-top: 0.65rem;
        height: 5px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
    }
    .episode-coverage__fill {
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #00f2ff, #7af7ff);
    }
    @media (max-width: 720px) {
        .episode-coverage__grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
</style>
