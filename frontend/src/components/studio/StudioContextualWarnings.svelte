<script>
    import { generateContextualWarnings } from '../../lib/studio/contextualWarnings.js';
    import { logStudioGuidanceDiag } from '../../lib/studio/studioGuidanceDiagnostics.js';

    /** @type {import('../../lib/series/productionHealth.js').SeriesHealthSnapshot} */
    export let health;

    /** @type {import('../../lib/series/productionHealth.js').ProductionReadinessSnapshot} */
    export let readiness;

    /** @type {import('../../lib/series/productionHealth.js').EpisodeOperationRow[]} */
    export let operationRows = [];

    /** @type {string} */
    export let seriesId = '';

    $: warnings = generateContextualWarnings(health, readiness, operationRows, seriesId);
    $: warnings, logStudioGuidanceDiag('STUDIO_WARNING', {
        seriesId,
        count: warnings.length,
        warnings: warnings.map((w) => ({
            id: w.id,
            problem: w.problem,
            whyItMatters: w.whyItMatters,
            howToFix: w.howToFix
        }))
    });
</script>

{#if warnings.length > 0}
    <div class="studio-warnings" data-studio-warnings>
        {#each warnings as warning (warning.id)}
            <div class="studio-warnings__item" data-studio-warning-item>
                <p class="studio-warnings__problem">{warning.problem}</p>
                <p class="studio-warnings__why"><strong>Why it matters:</strong> {warning.whyItMatters}</p>
                <p class="studio-warnings__fix"><strong>How to fix:</strong> {warning.howToFix}</p>
            </div>
        {/each}
    </div>
{/if}

<style>
    .studio-warnings {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        margin-bottom: 0.75rem;
    }
    .studio-warnings__item {
        padding: 0.55rem 0.65rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 193, 7, 0.3);
        background: rgba(255, 193, 7, 0.06);
    }
    .studio-warnings__problem {
        margin: 0 0 0.25rem;
        font-size: 0.78rem;
        font-weight: 700;
        color: #ffd76a;
    }
    .studio-warnings__why,
    .studio-warnings__fix {
        margin: 0.15rem 0 0;
        font-size: 0.68rem;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.75);
    }
    .studio-warnings__why strong,
    .studio-warnings__fix strong {
        color: rgba(255, 255, 255, 0.55);
        font-weight: 600;
    }
</style>
