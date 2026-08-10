<script>
    import { createEventDispatcher } from 'svelte';
    import {
        seriesCatalog,
        getSeriesById,
        updateCatalogEpisode,
        updateCatalogSeries,
        updateCatalogSeason,
        setEpisodeStatus,
        reorderEpisodesInSeason,
        attachEpisodeReel,
        detachEpisodeReel
    } from '../../lib/series/seriesStore.js';
    import { EPISODE_STATUSES } from '../../lib/series/seriesTypes.js';
    import EpisodeVaultBindingPicker from './EpisodeVaultBindingPicker.svelte';
    import { getReadyHeroVaultAssets } from '../../lib/series/heroVaultAssetSource.js';

    const dispatch = createEventDispatcher();

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** Optional host hint (e.g. Studio studioSelectedSeriesId) */
    export let preferredSeriesId = '';

    let selectedSeriesId = '';
    let selectedSeasonNumber = 1;
    let selectedEpisodeId = '';

    let editTitle = '';
    let editDescription = '';
    let editStatus = 'published';
    let attachReelId = '';
    let saveMessage = '';
    let attachMessage = '';
    let lastLoadedEpisodeId = '';

    /**
     * Prefer vault-inferred series, then explicit preferred id, never force Neon only.
     * @param {import('../../lib/series/seriesTypes.js').Series[]} catalog
     * @param {string} preferred
     */
    function resolveDefaultSeriesId(catalog, preferred) {
        const list = Array.isArray(catalog) ? catalog : [];
        if (!list.length) return '';
        const pref = String(preferred || '').trim();
        if (pref && list.some((s) => s.id === pref)) return pref;
        // Prefer real vault-inferred tags over demo descriptions that happen to mention "vault".
        const tagged = list.find(
            (s) => Array.isArray(s.tags) && s.tags.includes('vault-inferred')
        );
        if (tagged) return tagged.id;
        const stirred = list.find((s) => String(s.id || '').startsWith('series-stirred'));
        if (stirred) return stirred.id;
        // Non-demo first if possible (skip Neon default trap)
        const nonDemo = list.find((s) => !String(s.id || '').includes('neon-vengeance'));
        return (nonDemo || list[0]).id;
    }

    $: catalogList = $seriesCatalog || [];
    $: seriesOptions = [...catalogList].sort((a, b) => {
        const aVault = Array.isArray(a.tags) && a.tags.includes('vault-inferred') ? 0 : 1;
        const bVault = Array.isArray(b.tags) && b.tags.includes('vault-inferred') ? 0 : 1;
        if (aVault !== bVault) return aVault - bVault;
        return String(a.title || '').localeCompare(String(b.title || ''));
    });

    $: if (seriesOptions.length) {
        const stillValid = seriesOptions.some((s) => s.id === selectedSeriesId);
        if (!stillValid) {
            selectedSeriesId = resolveDefaultSeriesId(seriesOptions, preferredSeriesId);
            selectedSeasonNumber = 1;
            selectedEpisodeId = '';
            lastLoadedEpisodeId = '';
        }
    } else {
        selectedSeriesId = '';
        selectedEpisodeId = '';
    }

    $: series = selectedSeriesId ? getSeriesById(selectedSeriesId) : null;
    $: seasons = series?.seasons
        ? [...series.seasons].sort((a, b) => a.seasonNumber - b.seasonNumber)
        : [];
    $: if (seasons.length && !seasons.some((s) => s.seasonNumber === selectedSeasonNumber)) {
        selectedSeasonNumber = seasons[0].seasonNumber;
        selectedEpisodeId = '';
        lastLoadedEpisodeId = '';
    }
    $: season =
        seasons.find((s) => s.seasonNumber === selectedSeasonNumber) || seasons[0] || null;
    $: episodes = season?.episodes
        ? sortDisplay([...season.episodes])
        : [];

    /**
     * @param {import('../../lib/series/seriesTypes.js').Episode[]} list
     */
    function sortDisplay(list) {
        return [...list].sort((a, b) => {
            const da = Number(a.displayOrder);
            const db = Number(b.displayOrder);
            if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
            return (a.episodeNumber || 0) - (b.episodeNumber || 0);
        });
    }

    let editSeriesTitle = '';
    let editSeriesDescription = '';
    let editSeriesPoster = '';
    let editSeasonTitle = '';
    let editSeasonDescription = '';
    let editSeasonPoster = '';
    let seriesSaveMessage = '';

    $: if (series) {
        editSeriesTitle = series.title || '';
        editSeriesDescription = series.description || '';
        editSeriesPoster = series.poster || '';
    }
    $: if (season) {
        editSeasonTitle = season.title || `Season ${season.seasonNumber}`;
        editSeasonDescription = season.description || '';
        editSeasonPoster = /** @type {{ poster?: string }} */ (season).poster || '';
    }

    function handleSaveSeriesMeta() {
        if (!selectedSeriesId) return;
        const updated = updateCatalogSeries(selectedSeriesId, {
            title: editSeriesTitle,
            description: editSeriesDescription,
            poster: editSeriesPoster
        });
        seriesSaveMessage = updated ? 'Series metadata saved' : 'Series save failed';
        if (updated) {
            dispatch('changed', { type: 'series-meta', seriesId: selectedSeriesId });
        }
    }

    function handleSaveSeasonMeta() {
        if (!selectedSeriesId || !season) return;
        const updated = updateCatalogSeason(selectedSeriesId, season.seasonNumber, {
            title: editSeasonTitle,
            description: editSeasonDescription,
            poster: editSeasonPoster
        });
        seriesSaveMessage = updated ? 'Season metadata saved' : 'Season save failed';
        if (updated) {
            dispatch('changed', {
                type: 'season-meta',
                seriesId: selectedSeriesId,
                seasonNumber: season.seasonNumber
            });
        }
    }

    /** HTML5 drag reorder */
    let dragEpisodeId = '';

    /** @param {DragEvent} event @param {string} episodeId */
    function onEpisodeDragStart(event, episodeId) {
        dragEpisodeId = episodeId;
        try {
            event.dataTransfer?.setData('text/plain', episodeId);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        } catch {
            /* ignore */
        }
    }

    /** @param {DragEvent} event @param {string} targetId */
    function onEpisodeDrop(event, targetId) {
        event.preventDefault();
        const fromId = dragEpisodeId || event.dataTransfer?.getData('text/plain') || '';
        dragEpisodeId = '';
        if (!fromId || !targetId || fromId === targetId || !selectedSeriesId || !season) return;
        const ordered = episodes.map((e) => e.episodeId);
        const from = ordered.indexOf(fromId);
        const to = ordered.indexOf(targetId);
        if (from < 0 || to < 0) return;
        const next = [...ordered];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        const ok = reorderEpisodesInSeason(selectedSeriesId, season.seasonNumber, next);
        saveMessage = ok ? 'Episode order updated (persisted)' : 'Reorder failed';
        if (ok) {
            dispatch('changed', {
                type: 'reorder',
                seriesId: selectedSeriesId,
                seasonNumber: season.seasonNumber,
                orderedEpisodeIds: next
            });
        }
    }

    /** @param {DragEvent} event */
    function onEpisodeDragOver(event) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }

    $: if (episodes.length && !episodes.some((e) => e.episodeId === selectedEpisodeId)) {
        selectedEpisodeId = episodes[0].episodeId;
    }

    $: selectedEpisode = episodes.find((e) => e.episodeId === selectedEpisodeId) || null;

    $: if (selectedEpisode && selectedEpisode.episodeId !== lastLoadedEpisodeId) {
        loadEditor(selectedEpisode);
        lastLoadedEpisodeId = selectedEpisode.episodeId;
        attachReelId = selectedEpisode.reelId || '';
    }

    $: reelOptions = (feedReels || []).filter((r) => r?.id && !r.isPlaceholder);

    /** Ready Hero Vault assets only — canonical source (same as public Series). */
    $: readyVaultAssets = getReadyHeroVaultAssets({
        extraItems: Array.isArray(feedReels) ? feedReels : null
    });

    /**
     * @param {import('../../lib/series/seriesTypes.js').Episode} ep
     */
    function loadEditor(ep) {
        editTitle = ep.title || '';
        editDescription = ep.description || '';
        editStatus = ep.status || 'published';
        saveMessage = '';
        attachMessage = '';
    }

    function handleSeriesChange() {
        selectedSeasonNumber = 1;
        selectedEpisodeId = '';
        lastLoadedEpisodeId = '';
        dispatch('seriesSelect', { seriesId: selectedSeriesId });
    }

    function handleSeasonChange() {
        selectedEpisodeId = '';
        lastLoadedEpisodeId = '';
    }

    /** @param {string} episodeId */
    function selectEpisode(episodeId) {
        selectedEpisodeId = episodeId;
    }

    function handleSave() {
        if (!selectedEpisodeId) {
            saveMessage = 'Select an episode first';
            return;
        }
        const updated = updateCatalogEpisode(selectedEpisodeId, {
            title: editTitle,
            description: editDescription,
            status: /** @type {import('../../lib/series/seriesTypes.js').EpisodeStatus} */ (
                editStatus
            )
        });
        if (!updated) {
            saveMessage = 'Save failed — check title and status';
            return;
        }
        saveMessage = `Saved ${new Date().toLocaleTimeString()}`;
        dispatch('changed', {
            type: 'update',
            episodeId: selectedEpisodeId,
            seriesId: selectedSeriesId,
            episode: updated.episode
        });
    }

    function handleStatusQuick(status) {
        if (!selectedEpisodeId) return;
        editStatus = status;
        const updated = setEpisodeStatus(selectedEpisodeId, status);
        if (!updated) {
            saveMessage = 'Status update failed';
            return;
        }
        saveMessage = `Status → ${status}`;
        dispatch('changed', {
            type: 'status',
            episodeId: selectedEpisodeId,
            seriesId: selectedSeriesId,
            status
        });
    }

    /** @param {'up' | 'down'} direction */
    function handleReorder(direction) {
        if (!selectedSeriesId || !season || !selectedEpisodeId) return;
        const ordered = episodes.map((e) => e.episodeId);
        const idx = ordered.indexOf(selectedEpisodeId);
        if (idx < 0) return;
        const swapWith = direction === 'up' ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= ordered.length) return;
        const next = [...ordered];
        const tmp = next[idx];
        next[idx] = next[swapWith];
        next[swapWith] = tmp;
        const ok = reorderEpisodesInSeason(selectedSeriesId, season.seasonNumber, next);
        if (!ok) {
            saveMessage = 'Reorder failed';
            return;
        }
        saveMessage = 'Episode order updated';
        dispatch('changed', {
            type: 'reorder',
            seriesId: selectedSeriesId,
            seasonNumber: season.seasonNumber,
            orderedEpisodeIds: next
        });
    }

    function handleAttach() {
        if (!selectedEpisodeId || !attachReelId) {
            attachMessage = 'Select episode and reel';
            return;
        }
        const ok = attachEpisodeReel(selectedEpisodeId, attachReelId);
        attachMessage = ok ? 'Reel attached' : 'Attach failed';
        if (ok) {
            dispatch('changed', {
                type: 'attach',
                episodeId: selectedEpisodeId,
                reelId: attachReelId
            });
        }
    }

    function handleDetach() {
        if (!selectedEpisodeId) return;
        const ok = detachEpisodeReel(selectedEpisodeId);
        attachMessage = ok ? 'Reel detached' : 'Detach failed';
        attachReelId = '';
        if (ok) {
            dispatch('changed', {
                type: 'detach',
                episodeId: selectedEpisodeId,
                reelId: null
            });
        }
    }

    /** @param {string | null | undefined} reelId */
    function shortReel(reelId) {
        const id = String(reelId || '');
        if (!id) return 'No reel';
        return id.length > 12 ? `${id.slice(0, 8)}…` : id;
    }
</script>

<div
    class="creator-catalog"
    data-creator-catalog
    data-series-id={selectedSeriesId || undefined}
    data-testid="creator-catalog-panel"
>
    <header class="creator-catalog__header">
        <div>
            <h4 class="creator-catalog__title">Creator Catalog</h4>
            <p class="creator-catalog__subtitle">
                Series → season → episode — edit metadata, status, and order
            </p>
        </div>
    </header>

    {#if !seriesOptions.length}
        <p class="creator-catalog__empty" role="status">No series in catalog yet.</p>
    {:else}
        <div class="creator-catalog__filters">
            <label class="creator-catalog__field">
                <span>Series</span>
                <select
                    bind:value={selectedSeriesId}
                    data-creator-catalog-series
                    data-series-id={selectedSeriesId}
                    on:change={handleSeriesChange}
                >
                    {#each seriesOptions as s (s.id)}
                        <option value={s.id}>
                            {s.title}{#if Array.isArray(s.tags) && s.tags.includes('vault-inferred')}
                                {' '}(vault){/if}
                        </option>
                    {/each}
                </select>
            </label>

            <label class="creator-catalog__field">
                <span>Season</span>
                <select
                    bind:value={selectedSeasonNumber}
                    data-creator-catalog-season
                    on:change={handleSeasonChange}
                    disabled={!seasons.length}
                >
                    {#each seasons as s (s.seasonId || s.seasonNumber)}
                        <option value={s.seasonNumber}>
                            {s.title || `Season ${s.seasonNumber}`}
                        </option>
                    {/each}
                </select>
            </label>
        </div>

        <div class="creator-catalog__body">
            {#if series}
                <section class="creator-catalog__meta-block" data-series-editor-meta>
                    <h5 class="creator-catalog__meta-title">Series metadata</h5>
                    <label class="creator-catalog__field">
                        <span>Title</span>
                        <input bind:value={editSeriesTitle} data-series-title />
                    </label>
                    <label class="creator-catalog__field">
                        <span>Description</span>
                        <textarea rows="2" bind:value={editSeriesDescription} data-series-description
                        ></textarea>
                    </label>
                    <label class="creator-catalog__field">
                        <span>Series artwork URL</span>
                        <input bind:value={editSeriesPoster} data-series-poster placeholder="/or https://…" />
                    </label>
                    <button type="button" class="creator-catalog__btn" data-save-series on:click={handleSaveSeriesMeta}
                        >Save series</button
                    >
                    {#if season}
                        <h5 class="creator-catalog__meta-title">Season {season.seasonNumber} metadata</h5>
                        <label class="creator-catalog__field">
                            <span>Season name</span>
                            <input bind:value={editSeasonTitle} data-season-title />
                        </label>
                        <label class="creator-catalog__field">
                            <span>Season description</span>
                            <textarea rows="2" bind:value={editSeasonDescription} data-season-description
                            ></textarea>
                        </label>
                        <label class="creator-catalog__field">
                            <span>Season artwork URL</span>
                            <input bind:value={editSeasonPoster} data-season-poster />
                        </label>
                        <button
                            type="button"
                            class="creator-catalog__btn"
                            data-save-season
                            on:click={handleSaveSeasonMeta}>Save season</button
                        >
                    {/if}
                    {#if seriesSaveMessage}
                        <p class="creator-catalog__msg" role="status">{seriesSaveMessage}</p>
                    {/if}
                </section>
            {/if}

            <div class="creator-catalog__list" data-creator-catalog-episodes role="list">
                {#if !episodes.length}
                    <p class="creator-catalog__empty">No episodes in this season.</p>
                {:else}
                    {#each episodes as ep, epIndex (ep.episodeId)}
                        {@const code = `S${season?.seasonNumber ?? 1}:E${ep.episodeNumber}`}
                        <div
                            class="creator-catalog__row"
                            class:selected={selectedEpisodeId === ep.episodeId}
                            role="listitem"
                            draggable="true"
                            data-episode-id={ep.episodeId}
                            data-episode-status={ep.status}
                            data-display-order={ep.displayOrder ?? epIndex}
                            data-has-reel={Boolean(ep.reelId)}
                            on:dragstart={(e) => onEpisodeDragStart(e, ep.episodeId)}
                            on:dragover={onEpisodeDragOver}
                            on:drop={(e) => onEpisodeDrop(e, ep.episodeId)}
                        >
                            <button
                                type="button"
                                class="creator-catalog__row-main"
                                data-episode-id={ep.episodeId}
                                on:click={() => selectEpisode(ep.episodeId)}
                            >
                                <span class="creator-catalog__drag" aria-hidden="true">⋮⋮</span>
                                <span class="creator-catalog__code">{code}</span>
                                <span class="creator-catalog__ep-title">{ep.title}</span>
                                <span
                                    class="creator-catalog__badge"
                                    class:draft={ep.status === 'draft'}
                                    class:ready={ep.status === 'ready'}
                                    class:published={ep.status === 'published'}
                                    class:archived={ep.status === 'archived'}
                                >
                                    {ep.status}
                                </span>
                                <span
                                    class="creator-catalog__reel-flag"
                                    class:attached={Boolean(ep.reelId)}
                                    title={ep.reelId || 'No reel attached'}
                                >
                                    {ep.reelId ? '● reel' : '○ no reel'}
                                </span>
                            </button>
                            <div class="creator-catalog__row-order">
                                <button
                                    type="button"
                                    class="creator-catalog__order-btn"
                                    data-reorder="up"
                                    data-episode-id={ep.episodeId}
                                    title="Move up"
                                    disabled={epIndex <= 0}
                                    on:click|stopPropagation={() => {
                                        selectEpisode(ep.episodeId);
                                        handleReorder('up');
                                    }}
                                >
                                    ↑
                                </button>
                                <button
                                    type="button"
                                    class="creator-catalog__order-btn"
                                    data-reorder="down"
                                    data-episode-id={ep.episodeId}
                                    title="Move down"
                                    disabled={epIndex >= episodes.length - 1}
                                    on:click|stopPropagation={() => {
                                        selectEpisode(ep.episodeId);
                                        handleReorder('down');
                                    }}
                                >
                                    ↓
                                </button>
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>

            <section
                class="creator-catalog__editor"
                data-creator-catalog-editor
                data-episode-id={selectedEpisodeId || undefined}
            >
                {#if !selectedEpisode}
                    <p class="creator-catalog__empty">Select an episode to edit.</p>
                {:else}
                    <h5 class="creator-catalog__editor-heading">
                        S{season?.seasonNumber ?? 1}:E{selectedEpisode.episodeNumber}
                        <span class="creator-catalog__editor-id">{selectedEpisode.episodeId}</span>
                    </h5>

                    <label class="creator-catalog__field creator-catalog__field--full">
                        <span>Title</span>
                        <input
                            type="text"
                            bind:value={editTitle}
                            data-creator-catalog-title
                            data-episode-id={selectedEpisodeId}
                        />
                    </label>

                    <label class="creator-catalog__field creator-catalog__field--full">
                        <span>Description</span>
                        <textarea
                            rows="3"
                            bind:value={editDescription}
                            data-creator-catalog-description
                        ></textarea>
                    </label>

                    <label class="creator-catalog__field">
                        <span>Status</span>
                        <select bind:value={editStatus} data-creator-catalog-status>
                            {#each EPISODE_STATUSES as st}
                                <option value={st}>{st}</option>
                            {/each}
                        </select>
                    </label>

                    <div class="creator-catalog__actions">
                        <button
                            type="button"
                            class="creator-catalog__btn creator-catalog__btn--primary"
                            data-creator-catalog-save
                            on:click={handleSave}
                        >
                            Save episode
                        </button>
                        <button
                            type="button"
                            class="creator-catalog__btn"
                            data-creator-catalog-status-draft
                            on:click={() => handleStatusQuick('draft')}
                        >
                            Draft
                        </button>
                        <button
                            type="button"
                            class="creator-catalog__btn"
                            data-creator-catalog-status-published
                            on:click={() => handleStatusQuick('published')}
                        >
                            Publish
                        </button>
                    </div>
                    {#if saveMessage}
                        <p class="creator-catalog__message" role="status">{saveMessage}</p>
                    {/if}

                    <div class="creator-catalog__attach" data-creator-catalog-attach>
                        <label class="creator-catalog__field creator-catalog__field--full">
                            <span>Attached reel</span>
                            <select bind:value={attachReelId} data-creator-catalog-reel>
                                <option value="">Select vault / feed reel…</option>
                                {#each reelOptions as reel (reel.id)}
                                    <option value={reel.id}>
                                        {reel.title || reel.name || reel.id}
                                    </option>
                                {/each}
                            </select>
                        </label>
                        <p class="creator-catalog__reel-current">
                            Current: <code>{shortReel(selectedEpisode.reelId)}</code>
                        </p>
                        <div class="creator-catalog__actions">
                            <button
                                type="button"
                                class="creator-catalog__btn creator-catalog__btn--primary"
                                data-creator-catalog-attach-btn
                                on:click={handleAttach}
                            >
                                Attach
                            </button>
                            {#if selectedEpisode.reelId}
                                <button
                                    type="button"
                                    class="creator-catalog__btn"
                                    data-creator-catalog-detach-btn
                                    on:click={handleDetach}
                                >
                                    Detach
                                </button>
                            {/if}
                        </div>
                        {#if attachMessage}
                            <p class="creator-catalog__message" role="status">{attachMessage}</p>
                        {/if}
                    </div>

                    <EpisodeVaultBindingPicker
                        episodeId={selectedEpisodeId}
                        episodeTitle={selectedEpisode.title || ''}
                        selectedAssetId={selectedEpisode.heroVaultAssetId || null}
                        {readyVaultAssets}
                        on:bound={() => {
                            saveMessage = 'Manual vault binding saved';
                            dispatch('changed', {
                                type: 'vault-binding',
                                episodeId: selectedEpisodeId,
                                seriesId: selectedSeriesId
                            });
                        }}
                        on:cleared={() => {
                            saveMessage = 'Vault binding cleared (auto-match)';
                            dispatch('changed', {
                                type: 'vault-binding-clear',
                                episodeId: selectedEpisodeId,
                                seriesId: selectedSeriesId
                            });
                        }}
                    />
                {/if}
            </section>
        </div>
    {/if}
</div>

<style>
    .creator-catalog {
        margin-top: 0.5rem;
        padding: 1rem 1.1rem 1.15rem;
        border-radius: 12px;
        border: 1px solid rgba(0, 210, 180, 0.28);
        background: linear-gradient(165deg, rgba(0, 40, 36, 0.55), rgba(8, 12, 20, 0.72));
        color: #e8f5f2;
    }
    .creator-catalog__header {
        margin-bottom: 0.85rem;
    }
    .creator-catalog__title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 700;
        letter-spacing: 0.02em;
    }
    .creator-catalog__subtitle {
        margin: 0.25rem 0 0;
        font-size: 0.78rem;
        opacity: 0.72;
    }
    .creator-catalog__filters {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: 0.65rem;
        margin-bottom: 0.85rem;
    }
    .creator-catalog__field {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        opacity: 0.95;
    }
    .creator-catalog__field--full {
        grid-column: 1 / -1;
    }
    .creator-catalog__field input,
    .creator-catalog__field select,
    .creator-catalog__field textarea {
        padding: 0.45rem 0.55rem;
        border-radius: 7px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        font-size: 0.88rem;
        text-transform: none;
        letter-spacing: normal;
    }
    .creator-catalog__body {
        display: grid;
        grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
        gap: 0.85rem;
        align-items: start;
    }
    .creator-catalog__list {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        max-height: 22rem;
        overflow: auto;
        padding-right: 0.15rem;
    }
    .creator-catalog__row {
        display: flex;
        gap: 0.25rem;
        align-items: stretch;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
    }
    .creator-catalog__row.selected {
        border-color: rgba(0, 230, 195, 0.55);
        background: rgba(0, 200, 170, 0.1);
        box-shadow: 0 0 0 1px rgba(0, 230, 195, 0.12);
    }
    .creator-catalog__row-main {
        flex: 1;
        display: grid;
        grid-template-columns: 3.5rem 1fr auto auto;
        gap: 0.4rem;
        align-items: center;
        padding: 0.5rem 0.55rem;
        border: 0;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
        min-width: 0;
    }
    .creator-catalog__code {
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: #5effd6;
    }
    .creator-catalog__ep-title {
        font-size: 0.86rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .creator-catalog__badge {
        font-size: 0.62rem;
        text-transform: uppercase;
        padding: 0.15rem 0.35rem;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.08);
    }
    .creator-catalog__badge.draft {
        color: #ffc78a;
    }
    .creator-catalog__badge.published {
        color: #8dffa8;
    }
    .creator-catalog__badge.ready {
        color: #8ad4ff;
    }
    .creator-catalog__badge.archived {
        color: #aaa;
    }
    .creator-catalog__reel-flag {
        font-size: 0.65rem;
        opacity: 0.65;
        white-space: nowrap;
    }
    .creator-catalog__reel-flag.attached {
        color: #7dffe0;
        opacity: 1;
    }
    .creator-catalog__row-order {
        display: flex;
        flex-direction: column;
        border-left: 1px solid rgba(255, 255, 255, 0.06);
    }
    .creator-catalog__order-btn {
        flex: 1;
        min-width: 1.7rem;
        border: 0;
        background: rgba(0, 0, 0, 0.2);
        color: #9ef;
        cursor: pointer;
        font-size: 0.75rem;
        line-height: 1;
        padding: 0.2rem;
    }
    .creator-catalog__order-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }
    .creator-catalog__order-btn:not(:disabled):hover {
        background: rgba(0, 230, 195, 0.15);
    }
    .creator-catalog__editor {
        padding: 0.75rem;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.28);
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
    }
    .creator-catalog__editor-heading {
        margin: 0 0 0.15rem;
        font-size: 0.92rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        align-items: baseline;
    }
    .creator-catalog__editor-id {
        font-size: 0.68rem;
        font-weight: 500;
        opacity: 0.55;
        font-family: ui-monospace, monospace;
    }
    .creator-catalog__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
    }
    .creator-catalog__btn {
        border-radius: 7px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
        color: #eef;
        padding: 0.4rem 0.7rem;
        font-size: 0.8rem;
        cursor: pointer;
    }
    .creator-catalog__btn--primary {
        border-color: rgba(0, 230, 195, 0.45);
        background: rgba(0, 180, 150, 0.22);
        color: #bfffee;
        font-weight: 600;
    }
    .creator-catalog__btn:hover {
        filter: brightness(1.08);
    }
    .creator-catalog__message {
        margin: 0;
        font-size: 0.78rem;
        color: #9fe;
    }
    .creator-catalog__attach {
        margin-top: 0.35rem;
        padding-top: 0.65rem;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
    }
    .creator-catalog__reel-current {
        margin: 0;
        font-size: 0.75rem;
        opacity: 0.75;
    }
    .creator-catalog__reel-current code {
        font-size: 0.72rem;
    }
    .creator-catalog__empty {
        margin: 0;
        font-size: 0.85rem;
        opacity: 0.7;
    }
    @media (max-width: 900px) {
        .creator-catalog__filters,
        .creator-catalog__body {
            grid-template-columns: 1fr;
        }
        .creator-catalog__row-main {
            grid-template-columns: 3.25rem 1fr;
            grid-template-rows: auto auto;
        }
        .creator-catalog__badge,
        .creator-catalog__reel-flag {
            grid-column: 2;
        }
    }
</style>
