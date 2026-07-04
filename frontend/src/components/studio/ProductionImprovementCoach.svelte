<script>
    import { generateImprovementActions } from '../../lib/studio/productionImprovementCoach.js';
    import { logStudioGuidanceDiag } from '../../lib/studio/studioGuidanceDiagnostics.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = '';

    $: actions = generateImprovementActions(feedReels, seriesId);
    $: actions, logStudioGuidanceDiag('STUDIO_COACH', {
        seriesId,
        count: actions.length,
        actions: actions.map((a) => ({
            id: a.id,
            label: a.label,
            estimatedGain: a.estimatedGain,
            category: a.category
        }))
    });
</script>

{#if actions.length > 0}
    <div class="improvement-coach" data-studio-improvement-coach>
        <h5 class="improvement-coach__title">Top Actions</h5>
        <ol class="improvement-coach__list">
            {#each actions as action, index (action.id)}
                <li class="improvement-coach__item" data-coach-action>
                    <span class="improvement-coach__label">{index + 1}. {action.label}</span>
                    <span class="improvement-coach__gain">(+{action.estimatedGain} readiness)</span>
                </li>
            {/each}
        </ol>
    </div>
{/if}

<style>
    .improvement-coach {
        margin-top: 0.65rem;
        padding: 0.65rem 0.7rem;
        border-radius: 6px;
        border: 1px solid rgba(0, 242, 255, 0.2);
        background: rgba(0, 242, 255, 0.04);
    }
    .improvement-coach__title {
        margin: 0 0 0.4rem;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: rgba(255, 255, 255, 0.55);
    }
    .improvement-coach__list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .improvement-coach__item {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.25rem;
        font-size: 0.72rem;
        line-height: 1.35;
    }
    .improvement-coach__label {
        color: rgba(255, 255, 255, 0.9);
        flex: 1;
        min-width: 10rem;
    }
    .improvement-coach__gain {
        color: #9dffb0;
        font-weight: 700;
        white-space: nowrap;
    }
</style>
