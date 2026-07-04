<script>
    import { createEventDispatcher } from 'svelte';
    import {
        buildRepairPlan,
        executeRepair,
        executeAllRepairs,
        rollbackRepair,
        logStudioRepair
    } from '../../lib/series/studioRepairEngine.js';
    import { buildPredictiveRepairSnapshot } from '../../lib/repair/predictiveRepairEngine.js';

    const dispatch = createEventDispatcher();

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = '';

    let refreshToken = 0;
    let repairMessage = '';

    $: snapshot = (refreshToken, buildRepairPlan(seriesId, feedReels));
    $: predictive = (refreshToken, buildPredictiveRepairSnapshot(seriesId, feedReels));
    $: issues = snapshot.issues;
    $: repairPlan = snapshot.repairPlan;
    $: predictions = predictive.predictions;
    $: recommendations = predictive.recommendations;

    $: snapshot,
        logStudioRepair('STUDIO_REPAIR', {
            phase: 'plan',
            seriesId,
            issueCount: issues.length,
            repairableCount: snapshot.repairableCount,
            coverage: snapshot.coverage
        });

    /** @param {import('../../lib/series/studioRepairEngine.js').RepairPlanItem} item */
    function handleRepair(item) {
        const result = executeRepair(item);
        repairMessage = result.ok ? `Repaired ${item.label}` : `Could not repair ${item.label}`;
        refreshToken += 1;
        if (result.ok) dispatch('repaired', { repairId: item.id });
    }

    function handleRepairAll() {
        const result = executeAllRepairs(repairPlan);
        repairMessage = `Repaired ${result.succeeded} of ${repairPlan.length} issues`;
        refreshToken += 1;
        if (result.succeeded > 0) dispatch('repaired', { count: result.succeeded });
    }

    function handleRollback() {
        const result = rollbackRepair();
        repairMessage = result.ok ? `Rolled back ${result.repairId}` : 'Nothing to roll back';
        refreshToken += 1;
        if (result.ok) dispatch('repaired', { rollback: true });
    }
</script>

<div class="studio-repair" data-studio-repair-center data-predictive-repair>
    <div class="studio-repair__header">
        <h4 class="studio-repair__title">Studio Repair Center</h4>
        <span class="studio-repair__count" data-repair-issue-count>
            {issues.length} issue{issues.length === 1 ? '' : 's'} · {snapshot.repairableCount} repairable
        </span>
    </div>

    <div class="studio-repair__predictive" data-repair-predictions>
        <div class="studio-repair__predictive-header">
            <h5>Predictive Pre-Release Scan</h5>
            <span data-repair-risk-score>Risk {predictive.preReleaseRiskScore}%</span>
        </div>
        <div class="studio-repair__predictive-metrics">
            <span data-prediction-missing-assets>{predictive.categoryCounts.missing_assets} assets</span>
            <span data-prediction-missing-thumbnails>{predictive.categoryCounts.missing_thumbnails} thumbnails</span>
            <span data-prediction-incomplete-metadata>{predictive.categoryCounts.incomplete_metadata} metadata</span>
            <span data-prediction-workflow-bottlenecks>{predictive.categoryCounts.workflow_bottlenecks} bottlenecks</span>
            <span data-prediction-release-blockers>{predictive.categoryCounts.release_blockers} blockers</span>
            <span data-prediction-team-gaps>{predictive.categoryCounts.team_assignment_gaps} team gaps</span>
        </div>
        {#if predictions.length > 0}
            <ul class="studio-repair__prediction-list">
                {#each predictions.slice(0, 6) as prediction (prediction.id)}
                    <li
                        class="studio-repair__prediction-item"
                        data-repair-prediction
                        data-prediction-category={prediction.category}
                    >
                        <span class="studio-repair__severity studio-repair__severity--{prediction.severity.toLowerCase()}">
                            {prediction.severity}
                        </span>
                        <div class="studio-repair__item-copy">
                            <span class="studio-repair__issue-type">{prediction.title}</span>
                            <span class="studio-repair__detail">{prediction.detail}</span>
                        </div>
                    </li>
                {/each}
            </ul>
        {/if}
        {#if recommendations.length > 0}
            <ul class="studio-repair__recommendation-list">
                {#each recommendations.slice(0, 4) as recommendation (recommendation.id)}
                    <li class="studio-repair__recommendation-item" data-repair-recommendation>
                        <span>{recommendation.label}</span>
                        <small>{recommendation.action}</small>
                    </li>
                {/each}
            </ul>
        {/if}
    </div>

    <div class="studio-repair__actions">
        <button
            type="button"
            class="studio-repair__btn studio-repair__btn--all"
            data-repair-all
            disabled={repairPlan.length === 0}
            on:click={handleRepairAll}
        >Repair All</button>
        <button type="button" class="studio-repair__btn studio-repair__btn--rollback" data-repair-rollback on:click={handleRollback}>
            Rollback Last
        </button>
        {#if repairMessage}
            <span class="studio-repair__message" role="status">{repairMessage}</span>
        {/if}
    </div>

    {#if issues.length === 0}
        <p class="studio-repair__empty" data-repair-empty>No repair issues detected.</p>
    {:else}
        <ul class="studio-repair__list">
            {#each issues as item (item.id)}
                <li class="studio-repair__item" data-repair-issue data-issue-type={item.issue}>
                    <div class="studio-repair__item-main">
                        <span
                            class="studio-repair__severity studio-repair__severity--{item.severity.toLowerCase()}"
                            data-repair-severity
                        >{item.severity}</span>
                        <div class="studio-repair__item-copy">
                            <span class="studio-repair__issue-type">{item.issue.replace(/-/g, ' ')}</span>
                            <span class="studio-repair__detail">{item.detail}</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        class="studio-repair__btn studio-repair__btn--fix"
                        data-repair-fix
                        disabled={!item.repairable}
                        on:click={() => handleRepair(item)}
                    >Fix</button>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .studio-repair {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 120, 120, 0.28);
        background: rgba(255, 80, 80, 0.05);
    }
    .studio-repair__header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.55rem;
    }
    .studio-repair__title {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #ff9f9f;
    }
    .studio-repair__count {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.45);
    }
    .studio-repair__predictive {
        margin-bottom: 0.65rem;
        padding: 0.6rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 193, 7, 0.22);
        background: rgba(255, 193, 7, 0.04);
    }
    .studio-repair__predictive-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.45rem;
    }
    .studio-repair__predictive-header h5 {
        margin: 0;
        font-size: 0.62rem;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: #ffd76a;
    }
    .studio-repair__predictive-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        margin-bottom: 0.45rem;
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: rgba(255, 255, 255, 0.55);
    }
    .studio-repair__prediction-list,
    .studio-repair__recommendation-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .studio-repair__prediction-item {
        display: flex;
        align-items: flex-start;
        gap: 0.45rem;
        padding: 0.4rem 0.5rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.18);
    }
    .studio-repair__recommendation-item {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        padding: 0.35rem 0.5rem;
        border-radius: 6px;
        border: 1px solid rgba(157, 255, 176, 0.18);
        background: rgba(120, 220, 120, 0.06);
        font-size: 0.64rem;
        color: rgba(255, 255, 255, 0.85);
    }
    .studio-repair__recommendation-item small {
        font-size: 0.56rem;
        color: rgba(255, 255, 255, 0.45);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .studio-repair__actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.45rem;
        margin-bottom: 0.55rem;
    }
    .studio-repair__btn {
        padding: 0.38rem 0.7rem;
        border-radius: 6px;
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(0, 0, 0, 0.25);
        color: #fff;
    }
    .studio-repair__btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    .studio-repair__btn--all {
        border-color: rgba(157, 255, 176, 0.45);
        color: #9dffb0;
        background: rgba(120, 220, 120, 0.1);
    }
    .studio-repair__btn--rollback {
        border-color: rgba(255, 193, 7, 0.4);
        color: #ffd76a;
        background: rgba(255, 193, 7, 0.08);
    }
    .studio-repair__btn--fix {
        border-color: rgba(0, 242, 255, 0.4);
        color: #00f2ff;
        background: rgba(0, 242, 255, 0.1);
    }
    .studio-repair__message {
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .studio-repair__list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }
    .studio-repair__item {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.45rem;
        padding: 0.45rem 0.55rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.2);
    }
    .studio-repair__item-main {
        display: flex;
        align-items: flex-start;
        gap: 0.45rem;
        flex: 1;
        min-width: 12rem;
    }
    .studio-repair__severity {
        font-size: 0.5rem;
        font-weight: 800;
        letter-spacing: 0.06em;
        padding: 0.12rem 0.35rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        white-space: nowrap;
    }
    .studio-repair__severity--critical { color: #ff8a8a; border-color: rgba(255, 100, 100, 0.4); }
    .studio-repair__severity--high { color: #ffd76a; border-color: rgba(255, 193, 7, 0.35); }
    .studio-repair__severity--medium { color: #00f2ff; border-color: rgba(0, 242, 255, 0.35); }
    .studio-repair__severity--low { color: rgba(255, 255, 255, 0.55); }
    .studio-repair__item-copy {
        display: flex;
        flex-direction: column;
        gap: 0.12rem;
    }
    .studio-repair__issue-type {
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: capitalize;
        color: rgba(255, 255, 255, 0.9);
    }
    .studio-repair__detail {
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.5);
    }
    .studio-repair__empty {
        margin: 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.45);
    }
</style>
