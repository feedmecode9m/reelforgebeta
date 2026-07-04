<script>
    import { createEventDispatcher } from 'svelte';

    const dispatch = createEventDispatcher();

    /** @type {number} */
    export let seasonNumber = 1;

    /** @type {number} */
    export let episodeNumber = 1;

    /** @type {string} */
    export let title = '';

    /** @type {string} */
    export let episodeId = '';

    /** @type {import('../../lib/series/seriesTypes.js').EpisodeStatus} */
    export let status = 'published';

    /** @type {boolean} */
    export let selected = false;

    /** @type {boolean | undefined} */
    export let playable = undefined;

    $: code = `S${seasonNumber}:E${episodeNumber}`;
    $: isPlayable = playable ?? (status === 'published' || status === 'ready');
</script>

<button
    type="button"
    class="episode-chip"
    class:selected
    class:draft={status === 'draft'}
    class:unplayable={!isPlayable}
    aria-pressed={selected}
    aria-disabled={!isPlayable}
    disabled={!isPlayable}
    aria-label="{code} {title}"
    on:click={() => {
        if (!isPlayable) return;
        dispatch('select', { episodeId, seasonNumber, episodeNumber, title });
    }}
>
    <span class="episode-chip__code">{code}</span>
    <span class="episode-chip__title">{title}</span>
    {#if status === 'draft'}
        <span class="episode-chip__status">Draft</span>
    {:else if !isPlayable}
        <span class="episode-chip__status">{status}</span>
    {/if}
</button>

<style>
    .episode-chip {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        width: 100%;
        padding: 0.65rem 0.85rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        cursor: pointer;
        text-align: left;
        transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
    }
    .episode-chip:hover {
        border-color: rgba(0, 242, 255, 0.45);
        background: rgba(0, 242, 255, 0.08);
    }
    .episode-chip.selected {
        border-color: var(--neon-cyan, #00f2ff);
        background: rgba(0, 242, 255, 0.14);
        box-shadow: 0 0 16px rgba(0, 242, 255, 0.2);
    }
    .episode-chip.draft,
    .episode-chip.unplayable {
        opacity: 0.72;
        cursor: not-allowed;
    }
    .episode-chip:disabled {
        pointer-events: none;
    }
    .episode-chip__code {
        flex-shrink: 0;
        min-width: 3.25rem;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: var(--neon-cyan, #00f2ff);
    }
    .episode-chip__title {
        flex: 1;
        font-size: 0.9rem;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .episode-chip__status {
        flex-shrink: 0;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 0.15rem 0.4rem;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.55);
    }
</style>
