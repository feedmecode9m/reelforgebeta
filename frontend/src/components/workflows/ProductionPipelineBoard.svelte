<script>
    import { onMount } from 'svelte';
    import {
        assignTaskOwner,
        blockTask,
        buildProductionPipelineBoard,
        handoffTask,
        initProductionPipelineEngine,
        PRODUCTION_PIPELINE_STAGE_LABELS,
        PRODUCTION_PIPELINE_STAGES,
        submitTaskApproval,
        transitionTaskStage,
        unblockTask
    } from '../../lib/workflows/productionPipelineEngine.js';
    import { ensureTeamForSeries, getCurrentTeamUserId } from '../../lib/teams/creatorTeams.js';

    /** @type {string} */
    export let seriesId = '';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {import('../../lib/workflows/productionPipelineEngine.js').ProductionPipelineTask | null} */
    let draggingTask = null;

    /** @type {ReturnType<typeof buildProductionPipelineBoard> extends Promise<infer T> ? T : never | null} */
    let board = null;

    /** @type {{ userId: string; displayName: string }[]} */
    let teamMembers = [];

    let statusMessage = '';

    async function refreshBoard() {
        if (!seriesId) return;
        initProductionPipelineEngine();
        board = await buildProductionPipelineBoard(seriesId, feedReels);
        const team = await ensureTeamForSeries(seriesId);
        teamMembers = (team?.members || []).map((member) => ({
            userId: member.userId,
            displayName: member.displayName
        }));
    }

    onMount(() => {
        void refreshBoard();
        const onUpdate = () => void refreshBoard();
        window.addEventListener('reelforge:production-pipeline-updated', onUpdate);
        return () => window.removeEventListener('reelforge:production-pipeline-updated', onUpdate);
    });

    $: seriesId, feedReels, refreshBoard();

    /** @param {import('../../lib/workflows/productionPipelineEngine.js').ProductionPipelineTask} task */
    function handleDragStart(task) {
        draggingTask = task;
    }

    /** @param {DragEvent} event */
    function handleDragOver(event) {
        event.preventDefault();
    }

    /**
     * @param {DragEvent} event
     * @param {import('../../lib/workflows/productionPipelineEngine.js').ProductionPipelineStage} stage
     */
    async function handleDrop(event, stage) {
        event.preventDefault();
        if (!draggingTask) return;
        statusMessage = '';
        try {
            await transitionTaskStage(seriesId, draggingTask.id, stage, feedReels);
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Stage transition blocked';
        } finally {
            draggingTask = null;
        }
    }

    /** @param {import('../../lib/workflows/productionPipelineEngine.js').ProductionPipelineTask} task @param {string} userId */
    async function handleAssign(task, userId) {
        if (!userId) return;
        statusMessage = '';
        try {
            const member = teamMembers.find((item) => item.userId === userId);
            await assignTaskOwner(seriesId, task.id, userId, member?.displayName || userId);
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Assignment failed';
        }
    }

    /** @param {import('../../lib/workflows/productionPipelineEngine.js').ProductionPipelineTask} task @param {string} userId */
    async function handleHandoff(task, userId) {
        if (!userId) return;
        statusMessage = '';
        try {
            const member = teamMembers.find((item) => item.userId === userId);
            await handoffTask(seriesId, task.id, userId, {
                fromUserId: task.ownerUserId || getCurrentTeamUserId(),
                displayName: member?.displayName || userId
            });
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Handoff failed';
        }
    }

    /** @param {import('../../lib/workflows/productionPipelineEngine.js').ProductionPipelineTask} task */
    async function handleApprove(task) {
        statusMessage = '';
        try {
            submitTaskApproval(seriesId, task.id, getCurrentTeamUserId());
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Approval failed';
        }
    }

    /** @param {import('../../lib/workflows/productionPipelineEngine.js').ProductionPipelineTask} task */
    async function handleBlock(task) {
        statusMessage = '';
        try {
            blockTask(seriesId, task.id, 'Blocked from production board');
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Block failed';
        }
    }

    /** @param {import('../../lib/workflows/productionPipelineEngine.js').ProductionPipelineTask} task */
    async function handleUnblock(task) {
        statusMessage = '';
        try {
            unblockTask(seriesId, task.id);
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Unblock failed';
        }
    }
</script>

{#if board}
    <div class="production-pipeline-board" data-production-pipeline-board>
        <div class="production-pipeline-board__header">
            <h4 class="production-pipeline-board__title">Multi-User Production Pipeline</h4>
            <span class="production-pipeline-board__hint">Parallel creators · handoffs · approvals</span>
        </div>

        {#if statusMessage}
            <p class="production-pipeline-board__status" data-production-pipeline-status>{statusMessage}</p>
        {/if}

        <div class="production-pipeline-board__columns">
            {#each PRODUCTION_PIPELINE_STAGES as stage (stage)}
                <section
                    class="production-pipeline-board__column"
                    aria-label={`${PRODUCTION_PIPELINE_STAGE_LABELS[stage]} pipeline column`}
                    data-production-pipeline-column
                    data-production-pipeline-stage={stage}
                    on:dragover={handleDragOver}
                    on:drop={(event) => handleDrop(event, stage)}
                >
                    <header class="production-pipeline-board__column-header">
                        <span>{PRODUCTION_PIPELINE_STAGE_LABELS[stage]}</span>
                        <strong data-production-pipeline-column-count>{(board.columns[stage] || []).length}</strong>
                    </header>

                    <ul class="production-pipeline-board__cards">
                        {#each board.columns[stage] || [] as task (task.id)}
                            <li
                                class="production-pipeline-board__card"
                                class:production-pipeline-board__card--blocked={task.blocked}
                                draggable={!task.blocked}
                                data-production-pipeline-task
                                data-production-pipeline-task-id={task.id}
                                data-production-pipeline-task-stage={task.stage}
                                data-production-pipeline-blocked={task.blocked ? 'true' : 'false'}
                                on:dragstart={() => handleDragStart(task)}
                            >
                                <div class="production-pipeline-board__card-title">{task.title}</div>
                                <div class="production-pipeline-board__card-meta">
                                    {#if task.episodeId}
                                        <span class="production-pipeline-board__episode-id">{task.episodeId}</span>
                                    {/if}
                                    {#if task.ownerDisplayName}
                                        <span class="production-pipeline-board__badge" data-production-pipeline-owner>
                                            {task.ownerDisplayName}
                                        </span>
                                    {/if}
                                    {#if task.blocked}
                                        <span class="production-pipeline-board__badge production-pipeline-board__badge--blocked">
                                            Blocked
                                        </span>
                                    {/if}
                                    {#if task.approvals.length}
                                        <span class="production-pipeline-board__badge production-pipeline-board__badge--approved">
                                            {task.approvals.length}/{task.approvalChain.length} approved
                                        </span>
                                    {/if}
                                </div>

                                <div class="production-pipeline-board__card-actions">
                                    <select
                                        class="production-pipeline-board__select"
                                        data-production-pipeline-assign-select
                                        on:change={(event) =>
                                            handleAssign(
                                                task,
                                                /** @type {HTMLSelectElement} */ (event.currentTarget).value
                                            )}
                                    >
                                        <option value="">Assign owner...</option>
                                        {#each teamMembers as member (member.userId)}
                                            <option value={member.userId}>{member.displayName}</option>
                                        {/each}
                                    </select>

                                    <select
                                        class="production-pipeline-board__select"
                                        data-production-pipeline-handoff-select
                                        on:change={(event) =>
                                            handleHandoff(
                                                task,
                                                /** @type {HTMLSelectElement} */ (event.currentTarget).value
                                            )}
                                    >
                                        <option value="">Handoff...</option>
                                        {#each teamMembers as member (member.userId)}
                                            <option value={member.userId}>{member.displayName}</option>
                                        {/each}
                                    </select>

                                    {#if task.stage === 'REVIEW' || task.stage === 'APPROVAL'}
                                        <button
                                            type="button"
                                            class="production-pipeline-board__btn"
                                            data-production-pipeline-approve
                                            on:click={() => handleApprove(task)}
                                        >
                                            Approve
                                        </button>
                                    {/if}

                                    {#if task.blocked}
                                        <button
                                            type="button"
                                            class="production-pipeline-board__btn"
                                            data-production-pipeline-unblock
                                            on:click={() => handleUnblock(task)}
                                        >
                                            Unblock
                                        </button>
                                    {:else}
                                        <button
                                            type="button"
                                            class="production-pipeline-board__btn"
                                            data-production-pipeline-block
                                            on:click={() => handleBlock(task)}
                                        >
                                            Block
                                        </button>
                                    {/if}
                                </div>
                            </li>
                        {/each}
                    </ul>
                </section>
            {/each}
        </div>
    </div>
{/if}

<style>
    .production-pipeline-board {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(125, 211, 252, 0.24);
        background: rgba(14, 116, 144, 0.08);
    }
    .production-pipeline-board__header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.5rem;
    }
    .production-pipeline-board__title {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #7dd3fc;
    }
    .production-pipeline-board__hint {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.45);
        text-transform: uppercase;
    }
    .production-pipeline-board__status {
        margin: 0 0 0.5rem;
        font-size: 0.68rem;
        color: #ffb4b4;
    }
    .production-pipeline-board__columns {
        display: grid;
        grid-template-columns: repeat(3, minmax(11rem, 1fr));
        gap: 0.45rem;
        overflow-x: auto;
        padding-bottom: 0.25rem;
    }
    .production-pipeline-board__column {
        min-width: 11rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.22);
        padding: 0.45rem;
    }
    .production-pipeline-board__column-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.4rem;
        font-size: 0.58rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
    }
    .production-pipeline-board__cards {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        min-height: 4rem;
    }
    .production-pipeline-board__card {
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        padding: 0.45rem;
        cursor: grab;
    }
    .production-pipeline-board__card--blocked {
        border-color: rgba(255, 120, 120, 0.35);
        opacity: 0.85;
        cursor: not-allowed;
    }
    .production-pipeline-board__card-title {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.92);
        margin-bottom: 0.2rem;
    }
    .production-pipeline-board__card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        margin-bottom: 0.35rem;
    }
    .production-pipeline-board__episode-id {
        font-size: 0.56rem;
        color: rgba(255, 255, 255, 0.45);
    }
    .production-pipeline-board__badge {
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.1rem 0.35rem;
        border-radius: 999px;
        background: rgba(125, 211, 252, 0.12);
        color: #bae6fd;
    }
    .production-pipeline-board__badge--approved {
        background: rgba(157, 255, 176, 0.12);
        color: #9dffb0;
    }
    .production-pipeline-board__badge--blocked {
        background: rgba(255, 120, 120, 0.12);
        color: #ffb4b4;
    }
    .production-pipeline-board__card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
    }
    .production-pipeline-board__select {
        flex: 1;
        min-width: 6rem;
        font-size: 0.58rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(0, 0, 0, 0.28);
        color: #fff;
        padding: 0.2rem 0.3rem;
    }
    .production-pipeline-board__btn {
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.85);
        border-radius: 6px;
        padding: 0.2rem 0.45rem;
        font-size: 0.56rem;
        text-transform: uppercase;
        cursor: pointer;
    }
    @media (max-width: 1100px) {
        .production-pipeline-board__columns {
            grid-template-columns: repeat(2, minmax(11rem, 1fr));
        }
    }
</style>
