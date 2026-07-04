<script>
    import { createEventDispatcher } from 'svelte';
    import MediaThumbnail from '../media/MediaThumbnail.svelte';
    import {
        attachEpisodeReel,
        detachEpisodeReel,
        getSeriesById,
        seriesCatalog
    } from '../../lib/series/seriesStore.js';
    import {
        buildEpisodeAssetRecords,
        computeEpisodeAssetCoverage,
        auditEpisodeAssets
    } from '../../lib/series/episodeAssetStatus.js';
    import EpisodeCoverageDashboard from './EpisodeCoverageDashboard.svelte';

    const dispatch = createEventDispatcher();

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let selectedSeriesId = 'series-neon-vengeance';

    /** @type {string} */
    export let selectedEpisodeId = '';

    let attachReelId = '';
    let actionMessage = '';

    $: series = getSeriesById(selectedSeriesId);
    $: assetRecords = buildEpisodeAssetRecords(feedReels);
    $: coverage = computeEpisodeAssetCoverage(feedReels);
    $: seriesRecords = assetRecords.filter((r) => r.seriesId === selectedSeriesId);
    $: selectedRecord = seriesRecords.find((r) => r.episodeId === selectedEpisodeId) || null;
    $: if (seriesRecords.length && !selectedEpisodeId) {
        selectedEpisodeId = seriesRecords[0].episodeId;
    }
    $: reelOptions = feedReels.filter((r) => r?.id && !r.isPlaceholder);

    /** @param {string} episodeId */
    function selectEpisode(episodeId) {
        selectedEpisodeId = episodeId;
        const record = seriesRecords.find((r) => r.episodeId === episodeId);
        attachReelId = record?.reelId || '';
    }

    function handleAttach() {
        if (!selectedEpisodeId || !attachReelId) {
            actionMessage = 'Select an episode and reel to attach';
            return;
        }
        const ok = attachEpisodeReel(selectedEpisodeId, attachReelId);
        actionMessage = ok ? `Attached reel ${attachReelId.slice(0, 8)}…` : 'Attach failed';
        auditEpisodeAssets(feedReels, true);
        dispatch('changed', { episodeId: selectedEpisodeId, reelId: attachReelId });
    }

    function handleDetach() {
        if (!selectedEpisodeId) return;
        const ok = detachEpisodeReel(selectedEpisodeId);
        attachReelId = '';
        actionMessage = ok ? 'Reel detached' : 'Detach failed';
        auditEpisodeAssets(feedReels, true);
        dispatch('changed', { episodeId: selectedEpisodeId, reelId: null });
    }

    /** @param {number} seconds */
    function formatRuntime(seconds) {
        if (!seconds || seconds <= 0) return '—';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs ? `${mins}m ${secs}s` : `${mins}m`;
    }

</script>

<div class="studio-episode-panel" data-studio-episode-panel>
    <div class="studio-episode-panel__header">
        <h4>Episode Asset Management</h4>
        <span class="studio-episode-panel__hint">Studio source of truth for reel attachment</span>
    </div>

    <EpisodeCoverageDashboard
        totalEpisodes={coverage.totalEpisodes}
        episodesWithAssets={coverage.episodesWithAssets}
        episodesMissingAssets={coverage.episodesMissingAssets}
        coveragePercent={coverage.coveragePercent}
    />

    <label class="studio-episode-panel__field">
        <span>Series</span>
        <select bind:value={selectedSeriesId} on:change={() => { selectedEpisodeId = ''; attachReelId = ''; }}>
            {#each $seriesCatalog as s (s.id)}
                <option value={s.id}>{s.title}</option>
            {/each}
        </select>
    </label>

    <div class="studio-episode-panel__list" data-episode-asset-list>
        {#each seriesRecords as record (record.episodeId)}
            <button
                type="button"
                class="studio-episode-panel__row"
                class:selected={selectedEpisodeId === record.episodeId}
                data-episode-asset-row
                data-episode-id={record.episodeId}
                data-asset-status={record.status}
                on:click={() => selectEpisode(record.episodeId)}
            >
                <span class="studio-episode-panel__code">S{record.seasonNumber}:E{record.episodeNumber}</span>
                <span class="studio-episode-panel__title">{record.episodeTitle}</span>
                <span class="asset-status" class:asset-status--draft={record.status === 'Draft'}
                    class:asset-status--missing={record.status === 'Missing Asset'}
                    class:asset-status--ready={record.status === 'Ready'}
                    class:asset-status--scheduled={record.status === 'Scheduled'}
                    class:asset-status--published={record.status === 'Published'}>{record.status}</span>
            </button>
        {/each}
    </div>

    {#if selectedRecord}
        <section class="studio-episode-panel__detail" data-episode-asset-detail>
            <h5>S{selectedRecord.seasonNumber}:E{selectedRecord.episodeNumber} — {selectedRecord.episodeTitle}</h5>

            <div class="studio-episode-panel__detail-grid">
                <div class="studio-episode-panel__detail-field">
                    <span>Season</span>
                    <strong>{selectedRecord.seasonNumber}</strong>
                </div>
                <div class="studio-episode-panel__detail-field">
                    <span>Episode</span>
                    <strong>{selectedRecord.episodeNumber}</strong>
                </div>
                <div class="studio-episode-panel__detail-field">
                    <span>Runtime</span>
                    <strong>{formatRuntime(selectedRecord.runtime)}</strong>
                </div>
                <div class="studio-episode-panel__detail-field">
                    <span>Publishing Status</span>
                    <strong class="asset-status" class:asset-status--missing={selectedRecord.status === 'Missing Asset'}
                        class:asset-status--ready={selectedRecord.status === 'Ready'}
                        class:asset-status--scheduled={selectedRecord.status === 'Scheduled'}
                        class:asset-status--published={selectedRecord.status === 'Published'}>{selectedRecord.status}</strong>
                </div>
            </div>

            <div class="studio-episode-panel__reel-row">
                <label class="studio-episode-panel__field studio-episode-panel__field--full">
                    <span>Attached Reel</span>
                    <select bind:value={attachReelId}>
                        <option value="">Select reel to attach…</option>
                        {#each reelOptions as reel (reel.id)}
                            <option value={reel.id}>{reel.title || reel.name || reel.id}</option>
                        {/each}
                    </select>
                </label>
            </div>

            {#if selectedRecord.reelUuid}
                <p class="studio-episode-panel__uuid">Reel UUID: <code>{selectedRecord.reelUuid}</code></p>
            {/if}

            {#if selectedRecord.thumbnailUrl}
                <div class="studio-episode-panel__thumb">
                    <span>Thumbnail</span>
                    <MediaThumbnail url={selectedRecord.thumbnailUrl} alt={selectedRecord.episodeTitle} />
                </div>
            {/if}

            <div class="studio-episode-panel__actions">
                <button type="button" class="studio-episode-panel__attach" on:click={handleAttach}>Attach Reel</button>
                {#if selectedRecord.reelId}
                    <button type="button" class="studio-episode-panel__detach" on:click={handleDetach}>Detach</button>
                {/if}
            </div>
            {#if actionMessage}
                <p class="studio-episode-panel__message" role="status">{actionMessage}</p>
            {/if}
        </section>
    {/if}
</div>

<style>
    .studio-episode-panel {
        margin-top: 1rem;
        padding: 1rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 0, 255, 0.22);
        background: rgba(255, 0, 255, 0.04);
    }
    .studio-episode-panel__header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
    }
    .studio-episode-panel__header h4 {
        margin: 0;
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--neon-pink, #ff00ff);
    }
    .studio-episode-panel__hint {
        font-size: 0.62rem;
        color: rgba(255, 255, 255, 0.45);
        text-transform: uppercase;
    }
    .studio-episode-panel__field {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        margin-top: 0.65rem;
    }
    .studio-episode-panel__field--full {
        width: 100%;
    }
    .studio-episode-panel__field span {
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255, 255, 255, 0.55);
    }
    .studio-episode-panel__field select {
        padding: 0.45rem 0.6rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        font: inherit;
    }
    .studio-episode-panel__list {
        margin-top: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        max-height: 220px;
        overflow-y: auto;
    }
    .studio-episode-panel__row {
        display: grid;
        grid-template-columns: 4.5rem 1fr auto;
        gap: 0.5rem;
        align-items: center;
        padding: 0.45rem 0.55rem;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.25);
        color: #fff;
        cursor: pointer;
        text-align: left;
        font: inherit;
    }
    .studio-episode-panel__row.selected {
        border-color: rgba(0, 242, 255, 0.45);
        background: rgba(0, 242, 255, 0.08);
    }
    .studio-episode-panel__code {
        font-size: 0.68rem;
        font-weight: 700;
        color: var(--neon-cyan, #00f2ff);
    }
    .studio-episode-panel__title {
        font-size: 0.78rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .asset-status {
        font-size: 0.58rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 0.12rem 0.4rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
    }
    .asset-status--missing {
        color: #ffd76a;
        border-color: rgba(255, 193, 7, 0.4);
    }
    .asset-status--ready {
        color: #00f2ff;
        border-color: rgba(0, 242, 255, 0.4);
    }
    .asset-status--scheduled {
        color: #c9a0ff;
        border-color: rgba(180, 120, 255, 0.4);
    }
    .asset-status--published {
        color: #9dffb0;
        border-color: rgba(120, 220, 120, 0.4);
    }
    .asset-status--draft {
        color: rgba(255, 255, 255, 0.55);
    }
    .studio-episode-panel__detail {
        margin-top: 0.85rem;
        padding: 0.85rem;
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.28);
        border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .studio-episode-panel__detail h5 {
        margin: 0 0 0.65rem;
        font-size: 0.88rem;
    }
    .studio-episode-panel__detail-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.5rem;
    }
    .studio-episode-panel__detail-field span {
        display: block;
        font-size: 0.58rem;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .studio-episode-panel__detail-field strong {
        font-size: 0.82rem;
    }
    .studio-episode-panel__uuid {
        margin: 0.55rem 0 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.6);
    }
    .studio-episode-panel__uuid code {
        font-size: 0.68rem;
        word-break: break-all;
    }
    .studio-episode-panel__thumb {
        margin-top: 0.65rem;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }
    .studio-episode-panel__thumb span {
        font-size: 0.62rem;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .studio-episode-panel__thumb :global(img) {
        max-width: 120px;
        border-radius: 6px;
    }
    .studio-episode-panel__actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 0.75rem;
        flex-wrap: wrap;
    }
    .studio-episode-panel__attach,
    .studio-episode-panel__detach {
        padding: 0.5rem 0.85rem;
        border-radius: 6px;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
    }
    .studio-episode-panel__attach {
        border: 1px solid var(--neon-cyan, #00f2ff);
        background: rgba(0, 242, 255, 0.15);
        color: var(--neon-cyan, #00f2ff);
    }
    .studio-episode-panel__detach {
        border: 1px solid rgba(255, 120, 120, 0.45);
        background: rgba(255, 80, 80, 0.12);
        color: #ff9f9f;
    }
    .studio-episode-panel__message {
        margin: 0.5rem 0 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.55);
    }
    @media (max-width: 720px) {
        .studio-episode-panel__detail-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .studio-episode-panel__row {
            grid-template-columns: 4rem 1fr;
        }
        .studio-episode-panel__row .asset-status {
            grid-column: 1 / -1;
            justify-self: start;
        }
    }
</style>
