<script>
    import { createEventDispatcher } from 'svelte';
    import SmartHelpTooltip from '../studio/SmartHelpTooltip.svelte';
    import { attachEpisodeReel } from '../../lib/series/seriesStore.js';

    const dispatch = createEventDispatcher();

    /** @type {import('../../lib/series/productionHealth.js').EpisodeOperationRow[]} */
    export let queue = [];

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {Record<string, string>} */
    let attachSelections = {};

    $: reelOptions = feedReels.filter((r) => r?.id && !r.isPlaceholder);

    /**
     * @param {string} episodeId
     * @param {Event} event
     */
    function handleSelectChange(episodeId, event) {
        const target = /** @type {HTMLSelectElement} */ (event.currentTarget);
        attachSelections = { ...attachSelections, [episodeId]: target.value };
    }

    /**
     * @param {string} episodeId
     */
    function handleAttach(episodeId) {
        const reelId = attachSelections[episodeId];
        if (!reelId) return;
        const ok = attachEpisodeReel(episodeId, reelId);
        if (ok) {
            dispatch('attached', { episodeId, reelId });
            attachSelections = { ...attachSelections, [episodeId]: '' };
        }
    }
</script>

<div class="missing-queue" data-missing-asset-queue data-studio-walkthrough="missingAssetQueue">
    <div class="missing-queue__title-row">
        <h4 class="missing-queue__title">Missing Asset Queue <span class="missing-queue__count">{queue.length}</span></h4>
        <SmartHelpTooltip helpKey="missingAssetQueue" />
    </div>
    {#if queue.length === 0}
        <p class="missing-queue__empty">All episodes have attached reels.</p>
    {:else}
        <ul class="missing-queue__list">
            {#each queue as item (item.episodeId)}
                <li class="missing-queue__item" data-queue-item data-episode-id={item.episodeId}>
                    <div class="missing-queue__info">
                        <span class="missing-queue__code">S{item.seasonNumber}:E{item.episodeNumber}</span>
                        <span class="missing-queue__title">{item.episodeTitle}</span>
                    </div>
                    <div class="missing-queue__actions">
                        <select
                            value={attachSelections[item.episodeId] || ''}
                            on:change={(e) => handleSelectChange(item.episodeId, e)}
                        >
                            <option value="">Select reel…</option>
                            {#each reelOptions as reel (reel.id)}
                                <option value={reel.id}>{reel.title || reel.name || reel.id}</option>
                            {/each}
                        </select>
                        <button
                            type="button"
                            class="missing-queue__attach"
                            disabled={!attachSelections[item.episodeId]}
                            on:click={() => handleAttach(item.episodeId)}
                        >Attach Reel</button>
                    </div>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .missing-queue {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 193, 7, 0.28);
        background: rgba(255, 193, 7, 0.05);
    }
    .missing-queue__title-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        margin-bottom: 0.55rem;
    }
    .missing-queue__title {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #ffd76a;
    }
    .missing-queue__count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.25rem;
        padding: 0.1rem 0.35rem;
        margin-left: 0.35rem;
        border-radius: 999px;
        background: rgba(255, 193, 7, 0.2);
        font-size: 0.65rem;
    }
    .missing-queue__empty {
        margin: 0;
        font-size: 0.78rem;
        color: rgba(255, 255, 255, 0.55);
    }
    .missing-queue__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
    }
    .missing-queue__item {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.5rem 0.55rem;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .missing-queue__info {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        min-width: 8rem;
    }
    .missing-queue__code {
        font-size: 0.65rem;
        font-weight: 700;
        color: var(--neon-cyan, #00f2ff);
    }
    .missing-queue__title {
        font-size: 0.78rem;
    }
    .missing-queue__actions {
        display: flex;
        gap: 0.4rem;
        flex: 1;
        min-width: 12rem;
        justify-content: flex-end;
    }
    .missing-queue__actions select {
        flex: 1;
        min-width: 8rem;
        padding: 0.35rem 0.5rem;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        font-size: 0.72rem;
    }
    .missing-queue__attach {
        padding: 0.35rem 0.65rem;
        border-radius: 4px;
        border: 1px solid var(--neon-cyan, #00f2ff);
        background: rgba(0, 242, 255, 0.12);
        color: var(--neon-cyan, #00f2ff);
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        cursor: pointer;
        white-space: nowrap;
    }
    .missing-queue__attach:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
</style>
