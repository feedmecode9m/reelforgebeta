<script>
    import { createEventDispatcher } from 'svelte';
    import { routeWorkflowNavigation } from '../../lib/studio/creatorActionRouter.js';
    import { resolveTaskNavigation } from '../../lib/workflow/workflowEngine.js';

    const dispatch = createEventDispatcher();

    /** @type {import('../../lib/workflow/workflowEngine.js').WorkflowOperationalTask} */
    export let task;

    const statusLabels = {
        PENDING: 'Pending',
        IN_PROGRESS: 'In Progress',
        COMPLETE: 'Complete'
    };

    const typeLabels = {
        MISSING_ASSET: 'Missing Asset',
        MISSING_METADATA: 'Missing Metadata',
        UNPUBLISHED_EPISODE: 'Unpublished',
        MISSING_RUNTIME: 'Missing Runtime',
        MISSING_THUMBNAIL: 'Missing Thumbnail',
        MISSING_RELEASE_DATE: 'Missing Release Date'
    };

    /** @param {import('../../lib/workflow/workflowEngine.js').WorkflowOperationalTask} item */
    function actionLabel(item) {
        const nav = resolveTaskNavigation(item);
        if (nav.target === 'reel-attach') return 'Attach';
        if (nav.target === 'metadata-editor') return 'Edit Metadata';
        if (nav.target === 'release-scheduler') return 'Schedule';
        return 'Open';
    }

    function handleAssign() {
        dispatch('assign', { taskId: task.id });
    }

    function handleComplete() {
        dispatch('complete', { taskId: task.id });
    }

    function handleNavigate() {
        const navigation = resolveTaskNavigation(task);
        void routeWorkflowNavigation(navigation, {
            source: 'workflow-task',
            episodeId: task.episodeId
        });
        dispatch('navigate', { taskId: task.id, navigation });
        if (typeof window !== 'undefined') {
            window.dispatchEvent(
                new CustomEvent('reelforge:metrics-workflow', {
                    detail: {
                        seriesId: task.seriesId,
                        taskId: task.id,
                        actionType: task.taskType
                    }
                })
            );
        }
    }
</script>

<li
    class="workflow-task-card workflow-task-card--{task.status.toLowerCase()}"
    data-workflow-task
    data-workflow-task-card
    data-task-id={task.id}
    data-task-status={task.status}
    data-task-type={task.taskType}
>
    <div class="workflow-task-card__main">
        <div class="workflow-task-card__title-row">
            <span class="workflow-task-card__priority">P{task.priority}</span>
            <span class="workflow-task-card__title">{task.title || task.id}</span>
        </div>
        <div class="workflow-task-card__meta">
            <span class="workflow-task-card__type">{typeLabels[task.taskType] || task.taskType}</span>
            <span class="workflow-task-card__impact">+{task.estimatedImpact}% readiness</span>
            {#if task.estimatedMinutes}
                <span class="workflow-task-card__time">{task.estimatedMinutes} min</span>
            {/if}
            <span class="workflow-task-card__status">{statusLabels[task.status]}</span>
        </div>
    </div>

    <div class="workflow-task-card__actions">
        {#if task.status === 'PENDING'}
            <button type="button" class="workflow-task-card__btn" data-workflow-task-assign on:click={handleAssign}>
                Assign
            </button>
        {/if}
        {#if task.status !== 'COMPLETE'}
            <button
                type="button"
                class="workflow-task-card__btn workflow-task-card__btn--primary"
                data-workflow-task-action
                on:click={handleNavigate}
            >
                {actionLabel(task)}
            </button>
            <button type="button" class="workflow-task-card__btn" data-workflow-task-complete on:click={handleComplete}>
                Complete
            </button>
        {/if}
    </div>
</li>

<style>
    .workflow-task-card {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.45rem;
        padding: 0.5rem 0.6rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.22);
        list-style: none;
    }
    .workflow-task-card--complete {
        opacity: 0.55;
    }
    .workflow-task-card__main {
        flex: 1;
        min-width: 12rem;
    }
    .workflow-task-card__title-row {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        margin-bottom: 0.2rem;
    }
    .workflow-task-card__priority {
        font-size: 0.62rem;
        font-weight: 800;
        color: #ffb347;
        min-width: 1.4rem;
    }
    .workflow-task-card__title {
        font-size: 0.74rem;
        color: rgba(255, 255, 255, 0.92);
    }
    .workflow-task-card__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.5);
    }
    .workflow-task-card__impact {
        color: #9dffb0;
        font-weight: 700;
    }
    .workflow-task-card__status {
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .workflow-task-card__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
    }
    .workflow-task-card__btn {
        padding: 0.35rem 0.65rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.85);
        font-size: 0.62rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        white-space: nowrap;
    }
    .workflow-task-card__btn--primary {
        border-color: var(--neon-cyan, #00f2ff);
        background: rgba(0, 242, 255, 0.12);
        color: var(--neon-cyan, #00f2ff);
    }
    .workflow-task-card__btn:hover {
        filter: brightness(1.1);
    }
</style>
