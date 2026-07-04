<script>
    import { onMount } from 'svelte';
    import { PIPELINE_STAGES } from '../../lib/api/pipelineApi.js';
    import {
        approvePipelineEpisode,
        assignPipelineEpisode,
        hydratePipeline,
        isPublishingBlocked,
        movePipelineStage,
        publishPipelineEpisode,
        submitPipelineReview
    } from '../../lib/pipeline/episodePipeline.js';
    import { ensureTeamForSeries, getCurrentTeamUserId } from '../../lib/teams/creatorTeams.js';

    /** @type {string} */
    export let seriesId = '';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {import('../../lib/pipeline/episodePipeline.js').PipelineCard | null} */
    let draggingCard = null;

    /** @type {{ seriesId: string; columns: Record<string, import('../../lib/pipeline/episodePipeline.js').PipelineCard[]>; stages: readonly string[] } | null} */
    let board = null;

    /** @type {{ userId: string; displayName: string }[]} */
    let teamMembers = [];

    let statusMessage = '';

    async function refreshBoard() {
        if (!seriesId) return;
        board = await hydratePipeline(seriesId, feedReels);
        const team = await ensureTeamForSeries(seriesId);
        teamMembers = (team?.members || []).map((member) => ({
            userId: member.userId,
            displayName: member.displayName
        }));
    }

    onMount(() => {
        void refreshBoard();
        const onUpdate = () => void refreshBoard();
        window.addEventListener('reelforge:pipeline-updated', onUpdate);
        return () => window.removeEventListener('reelforge:pipeline-updated', onUpdate);
    });

    $: seriesId, feedReels, refreshBoard();

    /** @param {import('../../lib/pipeline/episodePipeline.js').PipelineCard} card */
    function handleDragStart(card) {
        draggingCard = card;
    }

    /** @param {DragEvent} event */
    function handleDragOver(event) {
        event.preventDefault();
    }

    /**
     * @param {DragEvent} event
     * @param {string} stage
     */
    async function handleDrop(event, stage) {
        event.preventDefault();
        if (!draggingCard) return;
        statusMessage = '';
        try {
            if (stage === 'PUBLISHED') {
                await publishPipelineEpisode(draggingCard.episodeId, seriesId, feedReels);
            } else {
                await movePipelineStage(
                    draggingCard.episodeId,
                    /** @type {import('../../lib/pipeline/episodePipeline.js').PipelineStage} */ (stage),
                    seriesId,
                    feedReels
                );
            }
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Pipeline move blocked';
        } finally {
            draggingCard = null;
        }
    }

    /** @param {import('../../lib/pipeline/episodePipeline.js').PipelineCard} card @param {string} userId */
    async function handleAssign(card, userId) {
        if (!userId) return;
        statusMessage = '';
        try {
            await assignPipelineEpisode(card.episodeId, userId, seriesId);
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Assignment failed';
        }
    }

    /** @param {import('../../lib/pipeline/episodePipeline.js').PipelineCard} card */
    async function handleApprove(card) {
        statusMessage = '';
        try {
            await approvePipelineEpisode(card.episodeId, getCurrentTeamUserId(), seriesId);
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Approval failed';
        }
    }

    /** @param {import('../../lib/pipeline/episodePipeline.js').PipelineCard} card */
    async function handleSubmitReview(card) {
        statusMessage = '';
        try {
            await submitPipelineReview(card.episodeId, seriesId, feedReels);
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Review submission failed';
        }
    }

    /** @param {import('../../lib/pipeline/episodePipeline.js').PipelineCard} card */
    function reviewStatusLabel(card) {
        switch (card.reviewStatus) {
            case 'pending':
                return 'Pending Review';
            case 'approved':
                return 'Approved';
            case 'blocked':
                return 'Blocked';
            default:
                return '';
        }
    }

    /** @param {import('../../lib/pipeline/episodePipeline.js').PipelineCard} card */
    async function handlePublish(card) {
        if (isPublishingBlocked(card.episodeId)) {
            statusMessage = 'Publish blocked — episode must be READY with review approval';
            return;
        }
        statusMessage = '';
        try {
            await publishPipelineEpisode(card.episodeId, seriesId, feedReels);
            await refreshBoard();
        } catch (err) {
            statusMessage = err?.message || 'Publish blocked by gate';
        }
    }
</script>

{#if board}
    <div class="pipeline-board" data-pipeline-board>
        <div class="pipeline-board__header">
            <h4 class="pipeline-board__title">Production Pipeline</h4>
            <span class="pipeline-board__hint">Drag episodes across stages</span>
        </div>

        {#if statusMessage}
            <p class="pipeline-board__status" data-pipeline-status>{statusMessage}</p>
        {/if}

        <div class="pipeline-board__columns">
            {#each PIPELINE_STAGES as stage (stage)}
                <section
                    class="pipeline-board__column"
                    aria-label={`${stage} pipeline column`}
                    data-pipeline-column
                    data-pipeline-stage={stage}
                    on:dragover={handleDragOver}
                    on:drop={(event) => handleDrop(event, stage)}
                >
                    <header class="pipeline-board__column-header">
                        <span>{stage}</span>
                        <strong data-pipeline-column-count>{(board.columns[stage] || []).length}</strong>
                    </header>

                    <ul class="pipeline-board__cards">
                        {#each board.columns[stage] || [] as card (card.episodeId)}
                            <li
                                class="pipeline-board__card"
                                class:pipeline-board__card--blocked={card.publishingBlocked && card.stage === 'READY'}
                                draggable="true"
                                data-pipeline-card
                                data-episode-id={card.episodeId}
                                data-pipeline-card-stage={card.stage}
                                data-pipeline-review-status={card.reviewStatus}
                                data-pipeline-blocked={card.publishingBlocked ? 'true' : 'false'}
                                on:dragstart={() => handleDragStart(card)}
                            >
                                <div class="pipeline-board__card-title">{card.title}</div>
                                <div class="pipeline-board__card-meta">
                                    <span class="pipeline-board__episode-id">{card.episodeId}</span>
                                    {#if reviewStatusLabel(card)}
                                        <span
                                            class="pipeline-board__badge pipeline-board__badge--review"
                                            data-pipeline-review-status
                                        >
                                            {reviewStatusLabel(card)}
                                        </span>
                                    {/if}
                                    {#if card.assignedUserName}
                                        <span class="pipeline-board__badge" data-pipeline-assignee>
                                            {card.assignedUserName}
                                        </span>
                                    {/if}
                                    {#if card.approvedByName}
                                        <span class="pipeline-board__badge pipeline-board__badge--approved" data-pipeline-approved>
                                            ✓ {card.approvedByName}
                                        </span>
                                    {/if}
                                </div>

                                <div class="pipeline-board__card-actions">
                                    <select
                                        class="pipeline-board__assign-select"
                                        data-pipeline-assign-select
                                        on:change={(event) =>
                                            handleAssign(
                                                card,
                                                /** @type {HTMLSelectElement} */ (event.currentTarget).value
                                            )}
                                    >
                                        <option value="">Assign...</option>
                                        {#each teamMembers as member (member.userId)}
                                            <option value={member.userId}>{member.displayName}</option>
                                        {/each}
                                    </select>

                                    {#if card.stage === 'EDITING'}
                                        <button
                                            type="button"
                                            class="pipeline-board__btn"
                                            data-pipeline-submit-review
                                            on:click={() => handleSubmitReview(card)}
                                        >
                                            Submit Review
                                        </button>
                                    {/if}

                                    {#if card.stage === 'REVIEW'}
                                        <button
                                            type="button"
                                            class="pipeline-board__btn"
                                            data-pipeline-approve
                                            on:click={() => handleApprove(card)}
                                        >
                                            Approve
                                        </button>
                                    {/if}

                                    {#if card.stage === 'READY'}
                                        <button
                                            type="button"
                                            class="pipeline-board__btn pipeline-board__btn--publish"
                                            data-pipeline-publish
                                            disabled={card.publishingBlocked}
                                            on:click={() => handlePublish(card)}
                                        >
                                            {card.publishingBlocked ? 'Blocked' : 'Publish'}
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
    .pipeline-board {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 211, 110, 0.22);
        background: rgba(255, 211, 110, 0.04);
    }
    .pipeline-board__header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.35rem;
        margin-bottom: 0.5rem;
    }
    .pipeline-board__title {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #ffd36e;
    }
    .pipeline-board__hint {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.45);
        text-transform: uppercase;
    }
    .pipeline-board__status {
        margin: 0 0 0.5rem;
        font-size: 0.68rem;
        color: #ffb4b4;
    }
    .pipeline-board__columns {
        display: grid;
        grid-template-columns: repeat(4, minmax(10rem, 1fr));
        gap: 0.45rem;
        overflow-x: auto;
        padding-bottom: 0.25rem;
    }
    .pipeline-board__column {
        min-width: 10rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.22);
        padding: 0.45rem;
    }
    .pipeline-board__column-header {
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
    .pipeline-board__cards {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        min-height: 4rem;
    }
    .pipeline-board__card {
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        padding: 0.45rem;
        cursor: grab;
    }
    .pipeline-board__card-title {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.92);
        margin-bottom: 0.2rem;
    }
    .pipeline-board__card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        margin-bottom: 0.35rem;
    }
    .pipeline-board__episode-id {
        font-size: 0.56rem;
        color: rgba(255, 255, 255, 0.45);
    }
    .pipeline-board__badge {
        font-size: 0.56rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.1rem 0.35rem;
        border-radius: 999px;
        background: rgba(0, 242, 255, 0.12);
        color: #9defff;
    }
    .pipeline-board__badge--approved {
        background: rgba(157, 255, 176, 0.12);
        color: #9dffb0;
    }
    .pipeline-board__badge--review {
        background: rgba(255, 211, 110, 0.12);
        color: #ffd36e;
    }
    .pipeline-board__card--blocked {
        border-color: rgba(255, 120, 120, 0.35);
    }
    .pipeline-board__card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
    }
    .pipeline-board__assign-select {
        flex: 1;
        min-width: 6rem;
        font-size: 0.58rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(0, 0, 0, 0.28);
        color: #fff;
        padding: 0.2rem 0.3rem;
    }
    .pipeline-board__btn {
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.85);
        border-radius: 6px;
        padding: 0.2rem 0.45rem;
        font-size: 0.56rem;
        text-transform: uppercase;
        cursor: pointer;
    }
    .pipeline-board__btn--publish {
        border-color: #ffd36e;
        color: #ffd36e;
        background: rgba(255, 211, 110, 0.1);
    }
    .pipeline-board__btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    @media (max-width: 1100px) {
        .pipeline-board__columns {
            grid-template-columns: repeat(2, minmax(10rem, 1fr));
        }
    }
</style>
