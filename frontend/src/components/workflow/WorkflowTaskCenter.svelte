<script>
    import { onDestroy, onMount } from 'svelte';
    import WorkflowTaskCard from './WorkflowTaskCard.svelte';
    import SmartHelpTooltip from '../studio/SmartHelpTooltip.svelte';
    import {
        syncWorkflowTasks,
        assignWorkflowTask,
        completeWorkflowTask,
        getWorkflowTasksForSeries
    } from '../../lib/workflow/workflowEngine.js';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = '';

    /** @type {import('../../lib/workflow/workflowEngine.js').WorkflowOperationalTask[]} */
    let tasks = [];

    /** @type {{ readinessBefore: number; readinessAfter: number; totalImpact: number }} */
    let projected = { readinessBefore: 0, readinessAfter: 0, totalImpact: 0 };

    let openCount = 0;
    let refreshKey = 0;

    function refreshTasks() {
        const sync = syncWorkflowTasks(seriesId, feedReels);
        tasks = sync.tasks;
        projected = sync.projected;
        openCount = tasks.filter((task) => task.status !== 'COMPLETE').length;
    }

    onMount(() => {
        refreshTasks();
        const onUpdate = () => refreshTasks();
        window.addEventListener('reelforge:workflow-tasks-updated', onUpdate);
        return () => window.removeEventListener('reelforge:workflow-tasks-updated', onUpdate);
    });

    onDestroy(() => {});

    $: seriesId, feedReels, refreshKey, refreshTasks();

    /** @param {CustomEvent<{ taskId: string }>} event */
    function handleAssign(event) {
        assignWorkflowTask(event.detail.taskId);
        refreshKey += 1;
    }

    /** @param {CustomEvent<{ taskId: string }>} event */
    function handleComplete(event) {
        completeWorkflowTask(event.detail.taskId);
        refreshKey += 1;
    }

    $: openTasks = tasks.filter((task) => task.status !== 'COMPLETE');
    $: blockers = openTasks.filter((task) => task.taskType === 'MISSING_ASSET');
    $: completionPath = openTasks
        .filter((task) => task.taskType !== 'MISSING_ASSET')
        .slice(0, 6);
</script>

{#if openCount > 0 || tasks.length > 0}
    <div class="workflow-task-center" data-workflow-task-center>
        <div class="workflow-task-center__header">
            <div class="workflow-task-center__title-row">
                <h4 class="workflow-task-center__title">Production Workflow</h4>
                <SmartHelpTooltip helpKey="workflowTasks" />
            </div>
            <span class="workflow-task-center__summary" data-workflow-projected-readiness>
                {projected.readinessBefore}% → {projected.readinessAfter}%
                {#if projected.totalImpact > 0}
                    <span class="workflow-task-center__gain">(+{projected.totalImpact}%)</span>
                {/if}
            </span>
        </div>

        <p class="workflow-task-center__status" data-workflow-open-count>
            {openCount} open task{openCount === 1 ? '' : 's'} · {tasks.filter((t) => t.status === 'COMPLETE').length} complete
        </p>

        {#if blockers.length > 0}
            <div class="workflow-task-center__section" data-workflow-blockers>
                <h5 class="workflow-task-center__section-title">Blockers</h5>
                <ul class="workflow-task-center__list">
                    {#each blockers as task (task.id)}
                        <WorkflowTaskCard
                            {task}
                            on:assign={handleAssign}
                            on:complete={handleComplete}
                        />
                    {/each}
                </ul>
            </div>
        {/if}

        {#if completionPath.length > 0}
            <div class="workflow-task-center__section" data-workflow-completion-path>
                <h5 class="workflow-task-center__section-title">Completion Path</h5>
                <ul class="workflow-task-center__list">
                    {#each completionPath as task (task.id)}
                        <WorkflowTaskCard
                            {task}
                            on:assign={handleAssign}
                            on:complete={handleComplete}
                        />
                    {/each}
                </ul>
            </div>
        {/if}
    </div>
{/if}

<style>
    .workflow-task-center {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(0, 242, 255, 0.22);
        background: rgba(0, 242, 255, 0.04);
    }
    .workflow-task-center__header {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.35rem;
    }
    .workflow-task-center__title-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }
    .workflow-task-center__title {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--neon-cyan, #00f2ff);
    }
    .workflow-task-center__summary {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.75);
    }
    .workflow-task-center__gain {
        color: #9dffb0;
        font-weight: 700;
    }
    .workflow-task-center__status {
        margin: 0 0 0.5rem;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.45);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .workflow-task-center__section {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        margin-top: 0.5rem;
    }
    .workflow-task-center__section-title {
        margin: 0;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: rgba(255, 255, 255, 0.55);
    }
    .workflow-task-center__list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
    }
    :global(.workflow-nav-highlight) {
        outline: 2px solid rgba(0, 242, 255, 0.75);
        outline-offset: 2px;
    }
</style>
