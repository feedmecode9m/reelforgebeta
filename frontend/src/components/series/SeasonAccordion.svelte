<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import EpisodeChip from './EpisodeChip.svelte';
    import {
        resolveEpisodeMedia,
        episodeChipPresentation
    } from '../../lib/series/episodeVaultBindingResolver.js';
    import { getReadyHeroVaultAssets } from '../../lib/series/heroVaultAssetSource.js';
    import { resolveViewerEpisodePosterUrl } from '../../lib/series/viewerEpisodePoster.js';
    import { resolveEpisodeAccessPricing } from '../../lib/series/episodeAccessPricing.js';
    import { assetIdOf } from '../../lib/series/episodeVaultResolver.js';

    const dispatch = createEventDispatcher();

    /** @type {string} */
    export let seriesId = '';

    /** @type {import('../../lib/series/seriesTypes.js').Season} */
    export let season;

    /** @type {boolean} */
    export let defaultExpanded = false;

    let expanded = defaultExpanded;

    /** @type {string} */
    export let selectedEpisodeId = '';

    /**
     * Ready Hero Vault assets (optional parent override; falls back to canonical source).
     * @type {Record<string, unknown>[]}
     */
    export let heroVaultAssets = [];

    /**
     * Viewer Theater list — no admin binding chrome on chips.
     * @type {boolean}
     */
    export let viewerMode = false;
    /** Whether paid/subscription episodes are unlocked for this viewer session. */
    export let hasAccessEntitlement = false;

    /**
     * Flat shelf: no accordion shell (single-season viewer lists).
     * @type {boolean}
     */
    export let flat = false;

    /** @type {string} */
    export let seriesLabel = '';

    /** @type {string} */
    export let seriesAccessMode = '';
    /** @type {number | undefined} */
    export let freeEpisodeCount = undefined;

    /** Remount chips when Hero Vault Master Edit fans out. */
    /** @type {number} */
    export let titleEpoch = 0;

    /**
     * Sibling episode titles / filenames for All Episodes editorial overlay.
     * @type {unknown[]}
     */
    export let familyItems = [];

    /**
     * Cold-viewer ready pool when parent effectiveReadyAssets has not hydrated yet.
     * @type {Record<string, unknown>[]}
     */
    let viewerPublicReadyAssets = [];

    /**
     * @param {unknown} reels
     * @returns {Record<string, unknown>[]}
     */
    function mapApiReelsToReadyAssets(reels) {
        if (!Array.isArray(reels)) return [];
        /** @type {Record<string, unknown>[]} */
        const out = [];
        for (const r of reels) {
            if (!r || typeof r !== 'object') continue;
            const id = String(/** @type {Record<string, unknown>} */ (r).id || '').trim();
            if (!id) continue;
            const row = /** @type {Record<string, unknown>} */ (r);
            const url = String(row.url || row.videoUrl || row.video_url || row.mediaUrl || '').trim();
            if (!url) continue;
            const playbackUrl = String(row.playbackUrl || row.playback_url || '').trim();
            const playbackStatus = String(row.playbackStatus || row.playback_status || '')
                .trim()
                .toLowerCase();
            out.push({
                id,
                mediaAssetId: id,
                assetId: id,
                name: row.name || row.title || id,
                title: row.name || row.title || id,
                fileName: row.fileName || row.filename || '',
                url,
                videoUrl: url,
                thumbnailUrl: row.thumbnailUrl || row.thumbnail_url || '',
                status: row.status || 'ready',
                type: row.type || 'video',
                validated: row.validated,
                ...(playbackUrl ? { playbackUrl } : {}),
                ...(playbackStatus ? { playbackStatus } : {})
            });
        }
        return out;
    }

    onMount(() => {
        if (!viewerMode) return;
        if (Array.isArray(heroVaultAssets) && heroVaultAssets.length) return;
        (async () => {
            try {
                const res = await fetch('/api/reels');
                if (!res.ok) return;
                const reels = await res.json();
                viewerPublicReadyAssets = mapApiReelsToReadyAssets(reels);
            } catch {
                /* non-fatal — chips remain unavailable until parent pool hydrates */
            }
        })();
    });

    $: readyVaultAssets =
        Array.isArray(heroVaultAssets) && heroVaultAssets.length
            ? heroVaultAssets
            : Array.isArray(viewerPublicReadyAssets) && viewerPublicReadyAssets.length
              ? viewerPublicReadyAssets
              : getReadyHeroVaultAssets();

    $: sortedEpisodes = [...(season?.episodes || [])]
        .filter(Boolean)
        .sort((a, b) => a.episodeNumber - b.episodeNumber);

    /**
     * Build viewer chip rows from catalog episodes + ready vault/API assets.
     * Assets are passed explicitly so Svelte 4 invalidates when the ready pool updates
     * (e.g. after SeriesPublicPage loads /api/reels into effectiveReadyAssets).
     *
     * @param {import('../../lib/series/seriesTypes.js').Episode[]} episodes
     * @param {Record<string, unknown>[]} assets
     */
    function buildViewerRows(episodes, assets) {
        const ready = Array.isArray(assets) ? assets : [];
        return episodes.map((episode) => {
            const vault = resolveEpisodeMedia({ episode, readyVaultAssets: ready });
            const chip = episodeChipPresentation(episode, vault);
            const mediaUrl = mediaUrlForChip(episode, chip);
            const playable = chip.playable || Boolean(mediaUrl);
            const mediaId = String(chip.mediaAssetId || episode.mediaAssetId || episode.reelId || '').trim();
            const vaultAsset =
                ready.find(
                    (a) => assetIdOf(a) === mediaId || String(a?.id || '').trim() === mediaId
                ) || null;
            const access = resolveEpisodeAccessPricing({
                episode: /** @type {Record<string, unknown>} */ (episode),
                mediaAssetId: mediaId,
                reelId: String(episode.reelId || '').trim(),
                vaultAsset,
                seriesId,
                seriesAccessMode,
                freeEpisodeCount
            });
            return {
                episode,
                chip,
                mediaUrl,
                posterUrl: resolveViewerEpisodePosterUrl({
                    episode,
                    chipThumbnailUrl: chip?.thumbnailUrl || '',
                    readyVaultAssets: ready
                }),
                playable,
                vaultAsset,
                accessMode: access.mode,
                price: access.price
            };
        });
    }

    // Explicit static dependency on readyVaultAssets (Svelte 4).
    $: viewerRows = buildViewerRows(sortedEpisodes, readyVaultAssets);
    // Desktop parity: render the full season catalog in viewer mode.
    // Per-row playability/locking is handled inside EpisodeChip.
    $: viewerRenderableRows = viewerRows;
    $: viewerEpisodes = viewerRows.map((row) => row.episode);
    $: seasonLabel = season?.title || `Season ${season?.seasonNumber ?? 1}`;
    $: episodeCount = viewerMode ? viewerEpisodes.length : sortedEpisodes.length;
    $: effectiveSeriesLabel = String(seriesLabel || '').trim();
    $: showShell = !flat && viewerMode && episodeCount > 0;
    $: showViewerFlat = viewerMode && flat && episodeCount > 0;
    $: showAdmin = !viewerMode && episodeCount > 0;

    // Viewer multi-season: keep first pass open; flat is always open without shell
    $: if (viewerMode && flat) expanded = true;

    /**
     * @param {import('../../lib/series/seriesTypes.js').Episode} episode
     */
    function resolveForChip(episode) {
        return resolveEpisodeMedia({ episode, readyVaultAssets });
    }

    /**
     * Viewer poster: chip/vault first, then mediaAssetId-keyed product thumbs.
     * Does not change playable selection or media ownership.
     * @param {import('../../lib/series/seriesTypes.js').Episode} episode
     * @param {{ thumbnailUrl?: string }} chip
     */
    function posterForChip(episode, chip) {
        return resolveViewerEpisodePosterUrl({
            episode,
            chipThumbnailUrl: chip?.thumbnailUrl || '',
            readyVaultAssets
        });
    }

    /**
     * @param {import('../../lib/series/seriesTypes.js').Episode} episode
     * @param {{ mediaUrl?: string }} chip
     */
    function mediaUrlForChip(episode, chip) {
        return String(
            chip?.mediaUrl ||
                /** @type {{ mediaUrl?: string }} */ (episode).mediaUrl ||
                ''
        ).trim();
    }

    /**
     * Stable episode identifier used across lock/select event propagation.
     * @param {import('../../lib/series/seriesTypes.js').Episode} episode
     * @returns {string}
     */
    function stableEpisodeIdFor(episode) {
        return String(episode?.episodeId || episode?.id || '').trim();
    }

    function toggleExpanded() {
        if (flat) return;
        expanded = !expanded;
    }

    /** @param {CustomEvent<{ episodeId: string }>} event */
    function handleEpisodeSelect(event) {
        selectedEpisodeId = event.detail.episodeId;
        dispatch('episodeSelect', { seriesId, seasonNumber: season.seasonNumber, ...event.detail });
    }

    /** @param {CustomEvent<Record<string, unknown>>} event */
    function handleEpisodeLocked(event) {
        dispatch('episodeLocked', { seriesId, seasonNumber: season.seasonNumber, ...event.detail });
    }

    /**
     * Active rail state: selected id may be catalog episode id, vault media id, or reel id.
     * @param {import('../../lib/series/seriesTypes.js').Episode} episode
     */
    function isEpisodeSelected(episode) {
        const sel = String(selectedEpisodeId || '').trim();
        if (!sel) return false;
        const candidates = [episode.episodeId, episode.id, episode.mediaAssetId, episode.reelId]
            .map((v) => String(v || '').trim())
            .filter(Boolean);
        return candidates.includes(sel);
    }
</script>

{#if showViewerFlat}
    <!-- Single-season shelf: no empty accordion chrome -->
    <div class="season-shelf" role="list" aria-label="{seasonLabel} episodes">
        {#each viewerRenderableRows as row (`${row.episode.episodeId}:${titleEpoch}`)}
            <div role="listitem">
                <EpisodeChip
                    seasonNumber={season.seasonNumber}
                    episodeNumber={row.episode.episodeNumber}
                    title={row.episode.title}
                    description={row.episode.description || ''}
                    seriesLabel={/** @type {{ seriesLabel?: string }} */ (row.episode).seriesLabel ||
                        effectiveSeriesLabel}
                    familyItems={familyItems}
                    viewerMode={true}
                    episodeId={stableEpisodeIdFor(row.episode)}
                    status={row.episode.status}
                    mediaAssetId={row.chip.mediaAssetId || null}
                    thumbnailUrl={row.posterUrl}
                    mediaUrl={row.mediaUrl}
                    matchTier={null}
                    bindingLabel={''}
                    playable={row.playable}
                    vaultAsset={row.vaultAsset}
                    accessMode={row.accessMode}
                    price={row.price}
                    {hasAccessEntitlement}
                    selected={isEpisodeSelected(row.episode)}
                    on:select={handleEpisodeSelect}
                    on:locked={handleEpisodeLocked}
                />
            </div>
        {/each}
    </div>
{:else if showShell}
    <section class="season-accordion season-accordion--viewer" class:expanded>
        <button
            type="button"
            class="season-accordion__header season-accordion__header--viewer"
            aria-expanded={expanded}
            on:click={toggleExpanded}
        >
            <span class="season-accordion__chevron season-accordion__chevron--viewer" aria-hidden="true"
                >{expanded ? '▾' : '▸'}</span
            >
            <span class="season-accordion__title">{seasonLabel}</span>
            <span class="season-accordion__count">{episodeCount} ep{episodeCount === 1 ? '' : 's'}</span>
        </button>

        {#if expanded}
            <div
                class="season-accordion__body season-accordion__body--viewer"
                role="region"
                aria-label="{seasonLabel} episodes"
            >
                {#each viewerRenderableRows as row (`${row.episode.episodeId}:${titleEpoch}`)}
                    <EpisodeChip
                        seasonNumber={season.seasonNumber}
                        episodeNumber={row.episode.episodeNumber}
                        title={row.episode.title}
                        description={row.episode.description || ''}
                        seriesLabel={/** @type {{ seriesLabel?: string }} */ (row.episode).seriesLabel ||
                            effectiveSeriesLabel}
                        familyItems={familyItems}
                        viewerMode={true}
                        episodeId={stableEpisodeIdFor(row.episode)}
                        status={row.episode.status}
                        mediaAssetId={row.chip.mediaAssetId || null}
                        thumbnailUrl={row.posterUrl}
                        mediaUrl={row.mediaUrl}
                        matchTier={null}
                        bindingLabel={''}
                        playable={row.playable}
                        vaultAsset={row.vaultAsset}
                        accessMode={row.accessMode}
                        price={row.price}
                        {hasAccessEntitlement}
                        selected={isEpisodeSelected(row.episode)}
                        on:select={handleEpisodeSelect}
                        on:locked={handleEpisodeLocked}
                    />
                {/each}
            </div>
        {/if}
    </section>
{:else if showAdmin}
    <section class="season-accordion" class:expanded>
        <button
            type="button"
            class="season-accordion__header"
            aria-expanded={expanded}
            on:click={toggleExpanded}
        >
            <span class="season-accordion__chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
            <span class="season-accordion__title">{seasonLabel}</span>
            <span class="season-accordion__count"
                >{episodeCount} episode{episodeCount === 1 ? '' : 's'}</span
            >
        </button>

        {#if expanded}
            <div class="season-accordion__body" role="region" aria-label="{seasonLabel} episodes">
                {#each sortedEpisodes as episode (`${episode.episodeId}:${titleEpoch}`)}
                    {@const vault = resolveForChip(episode)}
                    {@const chip = episodeChipPresentation(episode, vault)}
                    <EpisodeChip
                        seasonNumber={season.seasonNumber}
                        episodeNumber={episode.episodeNumber}
                        title={episode.title}
                        seriesLabel={/** @type {{ seriesLabel?: string }} */ (episode).seriesLabel ||
                            effectiveSeriesLabel}
                        viewerMode={false}
                        episodeId={stableEpisodeIdFor(episode)}
                        status={episode.status}
                        mediaAssetId={chip.mediaAssetId || episode.mediaAssetId || episode.reelId || null}
                        thumbnailUrl={posterForChip(episode, chip)}
                        mediaUrl={mediaUrlForChip(episode, chip)}
                        matchTier={chip.matchTier}
                        bindingLabel={chip.bindingLabel}
                        playable={chip.playable || Boolean(episode.mediaAssetId || episode.reelId)}
                        selected={isEpisodeSelected(episode)}
                        on:select={handleEpisodeSelect}
                    />
                {/each}
            </div>
        {/if}
    </section>
{/if}

<style>
    .season-shelf {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    .season-accordion {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.25);
    }
    .season-accordion.expanded {
        border-color: rgba(0, 242, 255, 0.2);
    }
    .season-accordion--viewer {
        border: none;
        background: transparent;
        border-radius: 0;
        overflow: visible;
    }
    .season-accordion--viewer.expanded {
        border-color: transparent;
    }
    .season-accordion__header {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.65rem;
        padding: 0.85rem 1rem;
        background: rgba(255, 255, 255, 0.03);
        border: none;
        color: #fff;
        cursor: pointer;
        text-align: left;
        transition: background 0.2s ease;
    }
    .season-accordion__header--viewer {
        padding: 0.35rem 0.15rem 0.5rem;
        background: transparent;
        gap: 0.5rem;
        cursor: pointer;
        pointer-events: auto;
    }
    .season-accordion__header:hover {
        background: rgba(0, 242, 255, 0.06);
    }
    .season-accordion__header--viewer:hover {
        background: rgba(255, 255, 255, 0.03);
    }
    .season-accordion__chevron {
        color: var(--neon-cyan, #00f2ff);
        font-size: 0.85rem;
        width: 1rem;
        flex-shrink: 0;
    }
    .season-accordion__chevron--viewer {
        color: rgba(255, 255, 255, 0.4);
        font-size: 0.7rem;
    }
    .season-accordion__title {
        flex: 1;
        font-size: 0.95rem;
        font-weight: 600;
    }
    .season-accordion--viewer .season-accordion__title {
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .season-accordion__count {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.5);
        letter-spacing: 0.04em;
        text-transform: uppercase;
    }
    .season-accordion--viewer .season-accordion__count {
        font-size: 0.68rem;
        color: rgba(255, 255, 255, 0.35);
    }
    .season-accordion__body {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        padding: 0.65rem;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .season-accordion__body--viewer {
        padding: 0;
        border-top: none;
        gap: 0.5rem;
    }
</style>
