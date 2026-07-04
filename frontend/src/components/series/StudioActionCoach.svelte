<script>
    import {
        buildStudioActionPlan,
        projectReadinessFromPlan
    } from '../../lib/series/actionEngine.js';
    import { logStudioGuidanceDiag } from '../../lib/studio/studioGuidanceDiagnostics.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = '';

    $: plan = buildStudioActionPlan(seriesId, feedReels);
    $: topPriority = plan.recommendations[0] || null;
    $: nextBestAction = plan.recommendations[1] || null;
    $: projected = projectReadinessFromPlan(plan);

    $: plan,
        logStudioGuidanceDiag('STUDIO_ACTION_ENGINE', {
            seriesId,
            readinessBefore: projected.readinessBefore,
            readinessAfter: projected.readinessAfter,
            recommendations: plan.recommendations.map((r) => ({
                id: r.id,
                priority: r.priority,
                title: r.title,
                impact: r.impact,
                actionType: r.actionType,
                episodeId: r.episodeId
            }))
        });
</script>

{#if plan.recommendations.length > 0}
    <div class="action-coach" data-studio-action-coach>
        <div class="action-coach__current">
            <span class="action-coach__label">Current Readiness:</span>
            <span class="action-coach__value">{plan.readinessScore}%</span>
        </div>

        {#if topPriority}
            <div class="action-coach__section" data-action-coach-priority>
                <h5 class="action-coach__title">Top Priority</h5>
                <div class="action-coach__item" data-coach-action>
                    <span class="action-coach__item-label">{topPriority.title}</span>
                    <span class="action-coach__gain">(+{topPriority.impact}%)</span>
                </div>
            </div>
        {/if}

        {#if nextBestAction}
            <div class="action-coach__section" data-action-coach-next>
                <h5 class="action-coach__title">Next Best Action</h5>
                <div class="action-coach__item" data-coach-action>
                    <span class="action-coach__item-label">{nextBestAction.title}</span>
                    <span class="action-coach__gain">(+{nextBestAction.impact}%)</span>
                </div>
            </div>
        {/if}

        {#if plan.quickWins.length > 0}
            <div class="action-coach__section">
                <h5 class="action-coach__title">Quick Wins</h5>
                <ul class="action-coach__list">
                    {#each plan.quickWins as win (win.id)}
                        <li class="action-coach__item" data-coach-action data-action-coach-quick-win>
                            <span class="action-coach__item-label">{win.title}</span>
                            <span class="action-coach__gain">(+{win.impact}%)</span>
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}

        <div class="action-coach__projected" data-action-coach-projected>
            <span class="action-coach__label">Projected Readiness:</span>
            <span class="action-coach__value action-coach__value--projected">{projected.readinessAfter}%</span>
            {#if plan.estimatedImpact > 0}
                <span class="action-coach__gain action-coach__gain--summary">
                    (+{plan.estimatedImpact}% gain)
                </span>
            {/if}
        </div>
    </div>
{/if}

<style>
    .action-coach {
        margin-top: 0.65rem;
        padding: 0.65rem 0.7rem;
        border-radius: 6px;
        border: 1px solid rgba(0, 242, 255, 0.2);
        background: rgba(0, 242, 255, 0.04);
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
    }
    .action-coach__current,
    .action-coach__projected {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.35rem;
    }
    .action-coach__label {
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.5);
    }
    .action-coach__value {
        font-size: 0.85rem;
        font-weight: 700;
        color: #fff;
    }
    .action-coach__value--projected {
        color: #9dffb0;
    }
    .action-coach__section {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
    }
    .action-coach__title {
        margin: 0;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: rgba(255, 255, 255, 0.55);
    }
    .action-coach__list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
    }
    .action-coach__item {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.25rem;
        font-size: 0.72rem;
        line-height: 1.35;
    }
    .action-coach__item-label {
        color: rgba(255, 255, 255, 0.9);
        flex: 1;
        min-width: 10rem;
    }
    .action-coach__gain {
        color: #9dffb0;
        font-weight: 700;
        white-space: nowrap;
    }
    .action-coach__gain--summary {
        font-size: 0.68rem;
    }
</style>
