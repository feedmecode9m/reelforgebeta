<script>
    import { createEventDispatcher } from 'svelte';
    import SmartHelpTooltip from '../studio/SmartHelpTooltip.svelte';
    import {
        buildMetadataDraftForReel,
        saveReelSeriesMetadata,
        getReelSeriesMetadata
    } from '../../lib/series/seriesStore.js';
    import { normalizeTags } from '../../lib/series/seriesMetadataStorage.js';

    const dispatch = createEventDispatcher();

    /** @type {string} */
    export let reelId = '';

    /** @type {string} */
    export let reelLabel = '';

    let seriesName = '';
    let seasonNumber = 1;
    let episodeNumber = 1;
    let episodeTitle = '';
    let description = '';
    let genre = '';
    let runtime = '';
    let releaseYear = '';
    let episodeStatus = 'published';
    let tagsInput = '';
    let saveMessage = '';
    let lastLoadedReelId = '';

    $: if (reelId && reelId !== lastLoadedReelId) {
        loadDraft(reelId);
        lastLoadedReelId = reelId;
    }

    /** @param {string} id */
    function loadDraft(id) {
        const draft = buildMetadataDraftForReel(id);
        seriesName = draft.seriesName || '';
        seasonNumber = draft.seasonNumber || 1;
        episodeNumber = draft.episodeNumber || 1;
        episodeTitle = draft.episodeTitle || '';
        description = draft.description || '';
        genre = draft.genre || '';
        runtime = draft.runtime != null ? String(draft.runtime) : '';
        releaseYear = draft.releaseYear != null ? String(draft.releaseYear) : '';
        episodeStatus = draft.episodeStatus || 'published';
        tagsInput = (draft.tags || []).join(', ');
        saveMessage = getReelSeriesMetadata(id) ? 'Loaded saved metadata' : 'Using catalog defaults';
    }

    function handleSave() {
        if (!reelId) return;
        const saved = saveReelSeriesMetadata(reelId, {
            seriesName: seriesName.trim(),
            seasonNumber: Number(seasonNumber) || 1,
            episodeNumber: Number(episodeNumber) || 1,
            episodeTitle: episodeTitle.trim(),
            description: description.trim(),
            genre: genre.trim(),
            runtime: runtime.trim() ? Number(runtime) : undefined,
            releaseYear: releaseYear.trim() ? Number(releaseYear) : undefined,
            episodeStatus: /** @type {'draft' | 'ready' | 'published' | 'archived'} */ (episodeStatus),
            tags: normalizeTags(tagsInput)
        });
        if (!saved) {
            saveMessage = 'Save failed';
            return;
        }
        saveMessage = `Saved (${new Date(saved.updatedAt || Date.now()).toLocaleTimeString()})`;
        dispatch('saved', { reelId, metadata: saved });
    }
</script>

<div class="series-metadata-editor" data-series-metadata-editor data-studio-walkthrough="seriesMetadata">
    <div class="series-metadata-editor__header">
        <div class="series-metadata-editor__title-row">
            <h4>Series Metadata</h4>
            <SmartHelpTooltip helpKey="seriesMetadata" />
        </div>
        <span class="series-metadata-editor__hint">API persistence with localStorage fallback</span>
    </div>

    {#if !reelId}
        <p class="series-metadata-editor__empty">Select a production reel to edit series metadata.</p>
    {:else}
        {#if reelLabel}
            <p class="series-metadata-editor__reel">Reel: <strong>{reelLabel}</strong></p>
        {/if}

        <div class="series-metadata-editor__grid">
            <label class="series-metadata-editor__field">
                <span>Series Name</span>
                <input bind:value={seriesName} placeholder="e.g. Neon Vengeance" />
            </label>

            <label class="series-metadata-editor__field series-metadata-editor__field--compact">
                <span>Season Number</span>
                <input type="number" min="1" bind:value={seasonNumber} />
            </label>

            <label class="series-metadata-editor__field series-metadata-editor__field--compact">
                <span>Episode Number</span>
                <input type="number" min="1" bind:value={episodeNumber} />
            </label>

            <label class="series-metadata-editor__field series-metadata-editor__field--full">
                <span>Episode Title</span>
                <input bind:value={episodeTitle} placeholder="Episode title" />
            </label>

            <label class="series-metadata-editor__field series-metadata-editor__field--full">
                <span>Description</span>
                <textarea bind:value={description} rows="3" placeholder="Episode synopsis" data-workflow-field="description"></textarea>
            </label>

            <label class="series-metadata-editor__field">
                <span>Genre</span>
                <input bind:value={genre} placeholder="e.g. Cyberpunk Thriller" />
            </label>

            <label class="series-metadata-editor__field series-metadata-editor__field--compact">
                <span>Runtime (sec)</span>
                <input type="number" min="0" bind:value={runtime} placeholder="298" data-workflow-field="runtime" />
            </label>

            <label class="series-metadata-editor__field series-metadata-editor__field--compact">
                <span>Release Year</span>
                <input type="number" min="1900" max="2100" bind:value={releaseYear} placeholder="2024" />
            </label>

            <label class="series-metadata-editor__field">
                <span>Episode Status</span>
                <select bind:value={episodeStatus} data-workflow-field="episodeStatus">
                    <option value="published">Published</option>
                    <option value="ready">Ready</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                </select>
            </label>

            <label class="series-metadata-editor__field series-metadata-editor__field--full">
                <span>Tags</span>
                <input bind:value={tagsInput} placeholder="comma-separated, e.g. neon, revenge, hacker" />
            </label>
        </div>

        <div class="series-metadata-editor__actions">
            <button type="button" class="series-metadata-editor__save" on:click={handleSave}>💾 Save Metadata</button>
            {#if saveMessage}
                <span class="series-metadata-editor__status" role="status">{saveMessage}</span>
            {/if}
        </div>
    {/if}
</div>

<style>
    .series-metadata-editor {
        margin-top: 1rem;
        padding: 1rem;
        border-radius: 10px;
        border: 1px solid rgba(0, 242, 255, 0.2);
        background: rgba(0, 242, 255, 0.04);
    }
    .series-metadata-editor__header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
    }
    .series-metadata-editor__title-row {
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }
    .series-metadata-editor__header h4 {
        margin: 0;
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--neon-cyan, #00f2ff);
    }
    .series-metadata-editor__hint {
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.45);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .series-metadata-editor__empty,
    .series-metadata-editor__reel {
        margin: 0 0 0.75rem;
        font-size: 0.82rem;
        color: rgba(255, 255, 255, 0.65);
    }
    .series-metadata-editor__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.65rem;
    }
    .series-metadata-editor__field {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
    }
    .series-metadata-editor__field--full {
        grid-column: 1 / -1;
    }
    .series-metadata-editor__field span {
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.55);
    }
    .series-metadata-editor__field input,
    .series-metadata-editor__field textarea,
    .series-metadata-editor__field select {
        width: 100%;
        padding: 0.5rem 0.65rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        font: inherit;
    }
    .series-metadata-editor__field textarea {
        resize: vertical;
        min-height: 72px;
    }
    .series-metadata-editor__actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 0.85rem;
        flex-wrap: wrap;
    }
    .series-metadata-editor__save {
        padding: 0.55rem 0.9rem;
        border-radius: 6px;
        border: 1px solid var(--neon-cyan, #00f2ff);
        background: rgba(0, 242, 255, 0.15);
        color: var(--neon-cyan, #00f2ff);
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 0.72rem;
        font-weight: 700;
    }
    .series-metadata-editor__save:hover {
        background: var(--neon-cyan, #00f2ff);
        color: #000;
    }
    .series-metadata-editor__status {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.55);
    }
    @media (max-width: 720px) {
        .series-metadata-editor__grid {
            grid-template-columns: 1fr;
        }
    }
</style>
