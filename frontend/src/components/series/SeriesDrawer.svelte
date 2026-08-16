<script>
    import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
    import { getSeriesById, getReelSeriesMetadata } from '../../lib/series/seriesStore.js';
    import {
        buildSeriesViewFromRelated,
        resolveRelatedEpisodes
    } from '../../lib/series/resolveRelatedEpisodes.js';
    import { getReadyHeroVaultAssets } from '../../lib/series/heroVaultAssetSource.js';
    import {
        creatorFacingDescription,
        creatorFacingGenre
    } from '../../lib/series/seriesCatalogTruth.js';
    import { formatIntelligenceExplanation } from '../../lib/architecture/intelligenceProvenance.js';
    import { emitAccessibilityAudit } from '../../lib/accessibility/accessibilityAudit.js';
    import MediaPoster from '../media/MediaPoster.svelte';
    import SeasonAccordion from './SeasonAccordion.svelte';
    import SeriesBadge from './SeriesBadge.svelte';

    const dispatch = createEventDispatcher();

    /** @type {boolean} */
    export let open = false;

    /** @type {string} */
    export let seriesId = null;

    /** @type {string} */
    export let selectedEpisodeId = '';

    /**
     * Active theater reel / vault asset — seeds related-episode resolution.
     * @type {Record<string, unknown> | null}
     */
    export let seedAsset = null;

    /**
     * Optional ready vault rows (personal videos, feed extras).
     * @type {Record<string, unknown>[]}
     */
    export let readyAssets = [];

    /**
     * Parent-provided series view (union already computed). When null, drawer resolves locally.
     * @type {import('../../lib/series/seriesTypes.js').Series | null}
     */
    export let seriesView = null;

    /**
     * Viewer Theater presentation — streaming shelf chrome (not admin).
     * @type {boolean}
     */
    export let viewerMode = true;

    /**
     * Dock as landscape side panel (no full-screen modal).
     * @type {boolean}
     */
    export let docked = false;

    let titleEpoch = 0;
    onMount(() => {
        if (typeof window === 'undefined') return;
        const onVaultTitle = () => {
            titleEpoch += 1;
        };
        window.addEventListener('reelforge:vault-title-updated', onVaultTitle);
        return () => window.removeEventListener('reelforge:vault-title-updated', onVaultTitle);
    });

    $: catalogSeries = seriesId ? getSeriesById(seriesId) : null;

    $: relatedResult = (() => {
        void titleEpoch;
        if (seriesView) return null;
        if (!seedAsset) return null;
        const ready =
            Array.isArray(readyAssets) && readyAssets.length
                ? readyAssets
                : getReadyHeroVaultAssets({
                      extraItems: seedAsset ? [seedAsset] : []
                  });
        return resolveRelatedEpisodes(seedAsset, { readyAssets: ready });
    })();

    /** Vault related first; catalog enriches via buildSeriesViewFromRelated. */
    $: series =
        seriesView ||
        buildSeriesViewFromRelated(
            relatedResult || {
                seriesId,
                seriesTitle: catalogSeries?.title || '',
                members: []
            },
            catalogSeries
        ) ||
        catalogSeries;

    /** Drop empty seasons — no blank accordion shells. */
    $: sortedSeasons = [...(series?.seasons || [])]
        .filter((s) => Array.isArray(s?.episodes) && s.episodes.length > 0)
        .sort((a, b) => a.seasonNumber - b.seasonNumber);

    $: episodeCount = sortedSeasons.reduce((n, s) => n + (s.episodes?.length || 0), 0);
    $: seasonCount = sortedSeasons.length;
    $: flatViewerShelf = viewerMode && seasonCount <= 1;

    $: officialSeriesDescription = viewerMode
        ? ''
        : creatorFacingDescription(series?.description);
    $: officialSeriesGenre = viewerMode ? '' : creatorFacingGenre(series?.genre);
    $: effectiveSeriesId = series?.id || seriesId || '';
    $: seriesLabelText = String(series?.title || '').trim();
    $: hasViewerBody = viewerMode && episodeCount > 0;
    $: seriesMetaLine =
        seasonCount > 0 && episodeCount > 0
            ? seasonCount === 1
                ? `${episodeCount} episode${episodeCount === 1 ? '' : 's'}`
                : `${seasonCount} seasons · ${episodeCount} episodes`
            : '';

    /** @param {CustomEvent<{ episodeId: string }>} event */
    function handleEpisodeSelect(event) {
        selectedEpisodeId = event.detail.episodeId;
        const episode = series?.seasons
            ?.flatMap((s) => s.episodes || [])
            .find((e) => e.episodeId === event.detail.episodeId);
        dispatch('episodeSelect', {
            ...event.detail,
            reelId: episode?.reelId || event.detail.reelId || null,
            mediaAssetId: episode?.mediaAssetId || null
        });
    }

    function closeDrawer() {
        open = false;
        dispatch('close');
    }

    /** @type {HTMLElement | null} */
    let drawerElement = null;
    /** @type {HTMLElement | null} */
    let previousFocusedElement = null;
    let focusTrapActive = false;

    const FOCUSABLE_SELECTOR = [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
    ].join(', ');

    async function activateFocusTrap() {
        if (typeof document === 'undefined') return;
        focusTrapActive = true;
        previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        await tick();
        const focusable = getFocusableElements();
        (focusable[0] || drawerElement)?.focus();
        emitAccessibilityAudit('SeriesDrawer', {
            action: 'open',
            seriesId: effectiveSeriesId
        });
    }

    function getFocusableElements() {
        if (!drawerElement) return [];
        return Array.from(drawerElement.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
            (element) => element instanceof HTMLElement
        );
    }

    function restoreFocus() {
        if (previousFocusedElement && typeof previousFocusedElement.focus === 'function') {
            previousFocusedElement.focus();
        }
        previousFocusedElement = null;
    }

    /** @param {KeyboardEvent} event */
    function handleWindowKeydown(event) {
        if (!open) return;
        if (!drawerElement) return;
        const active = document.activeElement;
        if (active && !drawerElement.contains(active)) return;

        if (event.key === 'Escape') {
            event.preventDefault();
            closeDrawer();
            return;
        }
        if (event.key !== 'Tab') return;

        const focusable = getFocusableElements();
        if (focusable.length === 0) {
            event.preventDefault();
            drawerElement?.focus();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    $: if (open && !focusTrapActive) {
        void activateFocusTrap();
    }

    $: if (!open && focusTrapActive) {
        emitAccessibilityAudit('SeriesDrawer', {
            action: 'close',
            seriesId: effectiveSeriesId
        });
        focusTrapActive = false;
        restoreFocus();
    }

    onDestroy(() => {
        restoreFocus();
    });

    /** @param {number} seconds */
    function formatRuntime(seconds) {
        if (!seconds || seconds <= 0) return '—';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return secs ? `${mins}m ${secs}s` : `${mins}m`;
    }
</script>

<svelte:window on:keydown={handleWindowKeydown} />

{#if open && series}
    <div
        class="series-drawer-overlay"
        class:series-drawer-overlay--docked={docked}
        role="presentation"
        data-theater-series-drawer
        data-viewer-mode={viewerMode ? 'true' : undefined}
        data-docked={docked ? 'true' : undefined}
    >
        {#if !docked}
            <button
                type="button"
                class="series-drawer-backdrop"
                aria-label="Close episode browser"
                on:click|stopPropagation={closeDrawer}
            ></button>
        {/if}
        <aside
            bind:this={drawerElement}
            class="series-drawer"
            class:series-drawer--viewer={viewerMode}
            class:series-drawer--docked={docked}
            role="dialog"
            aria-modal={!docked}
            aria-labelledby="series-drawer-title"
            tabindex="-1"
        >
            {#if viewerMode}
                <!-- Streaming shelf header: title + counts only (no empty hero plane) -->
                <header class="series-shelf__header">
                    <div class="series-shelf__heading">
                        <p class="series-shelf__eyebrow">All Episodes</p>
                        <h2 id="series-drawer-title" class="series-shelf__title" data-series-label>
                            {seriesLabelText || 'Series'}
                        </h2>
                        {#if seriesMetaLine}
                            <p class="series-shelf__meta">{seriesMetaLine}</p>
                        {/if}
                    </div>
                    <button
                        type="button"
                        class="series-shelf__close"
                        aria-label="Close episode browser"
                        on:click|stopPropagation={closeDrawer}
                    >✕</button>
                </header>

                {#if hasViewerBody}
                    <div class="series-shelf__body">
                        <h3 class="series-shelf__section" data-series-episodes-heading>Episodes</h3>
                        {#each sortedSeasons as season (season.seasonId || season.seasonNumber)}
                            <SeasonAccordion
                                seriesId={effectiveSeriesId}
                                {season}
                                selectedEpisodeId={selectedEpisodeId}
                                defaultExpanded={true}
                                heroVaultAssets={readyAssets}
                                seriesLabel={seriesLabelText}
                                viewerMode={true}
                                flat={flatViewerShelf}
                                titleEpoch={titleEpoch}
                                on:episodeSelect={handleEpisodeSelect}
                            />
                        {/each}
                    </div>
                {/if}
            {:else}
                <header class="series-drawer__hero">
                    {#if series.poster}
                        <MediaPoster url={series.poster} className="series-drawer__poster" aria-hidden="true" />
                    {/if}
                    <div class="series-drawer__hero-scrim"></div>
                    <button type="button" class="series-drawer__close" aria-label="Close episode browser" on:click|stopPropagation={closeDrawer}>✕</button>
                    <div class="series-drawer__hero-copy">
                        <p class="series-drawer__eyebrow">Series</p>
                        <h2 id="series-drawer-title" class="series-drawer__title">{series.title}</h2>
                        {#if officialSeriesDescription}
                            <p class="series-drawer__description">{officialSeriesDescription}</p>
                        {/if}
                        {#if officialSeriesGenre}
                            <p class="series-drawer__official-genre">Genre: {officialSeriesGenre}</p>
                        {/if}
                        {#if selectedEpisodeId}
                            <SeriesBadge episodeId={selectedEpisodeId} />
                        {/if}
                    </div>
                </header>

                {#if sortedSeasons.length}
                    <div class="series-drawer__content">
                        <div class="series-drawer__toolbar">
                            <h3>Episodes</h3>
                            <span>{sortedSeasons.length} season{sortedSeasons.length === 1 ? '' : 's'}</span>
                        </div>

                        <div class="series-drawer__seasons">
                            {#each sortedSeasons as season (season.seasonId || season.seasonNumber)}
                                <SeasonAccordion
                                    seriesId={effectiveSeriesId}
                                    {season}
                                    selectedEpisodeId={selectedEpisodeId}
                                    defaultExpanded={season.seasonNumber === sortedSeasons[0]?.seasonNumber}
                                    heroVaultAssets={readyAssets}
                                    seriesLabel={seriesLabelText}
                                    viewerMode={false}
                                    titleEpoch={titleEpoch}
                                    on:episodeSelect={handleEpisodeSelect}
                                />
                            {/each}
                        </div>

                        {#if selectedEpisodeId}
                            {@const ctx = series.seasons.flatMap((s) => s.episodes).find((e) => e.episodeId === selectedEpisodeId)}
                            {#if ctx}
                                {@const reelMeta = ctx.reelId ? getReelSeriesMetadata(ctx.reelId) : null}
                                {@const officialEpDesc = creatorFacingDescription(ctx.description)}
                                {@const officialEpGenre = creatorFacingGenre(ctx.genre)}
                                {@const suggestedGenre = String(reelMeta?.suggestedGenre || '').trim()}
                                {@const suggestionText =
                                    String(reelMeta?.intelligenceExplanation || '').trim() ||
                                    (suggestedGenre
                                        ? formatIntelligenceExplanation(suggestedGenre, { fromTitle: true })
                                        : '')}
                                <section class="series-drawer__detail" aria-label="Selected episode details">
                                    <h4>{ctx.title}</h4>
                                    {#if officialEpDesc}
                                        <p>{officialEpDesc}</p>
                                    {/if}
                                    <div class="series-drawer__detail-meta">
                                        <span>Runtime: {formatRuntime(ctx.runtime)}</span>
                                        <span>Status: {ctx.status}</span>
                                        {#if officialEpGenre}<span>Genre: {officialEpGenre}</span>{/if}
                                    </div>
                                    {#if suggestionText}
                                        <p class="series-drawer__suggestion" data-intelligence-suggestion>
                                            {suggestionText}
                                        </p>
                                    {/if}
                                    {#if ctx.tags?.length}
                                        <div class="series-drawer__tags">
                                            {#each ctx.tags as tag}
                                                <span class="series-drawer__tag">{tag}</span>
                                            {/each}
                                        </div>
                                    {/if}
                                </section>
                            {/if}
                        {/if}
                    </div>
                {/if}
            {/if}
        </aside>
    </div>
{/if}

<style>
    .series-drawer-overlay {
        position: fixed;
        inset: 0;
        z-index: 2500;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(6px);
        display: flex;
        justify-content: flex-end;
    }
    .series-drawer-backdrop {
        position: absolute;
        inset: 0;
        border: none;
        padding: 0;
        margin: 0;
        background: transparent;
        cursor: pointer;
    }
    .series-drawer {
        position: relative;
        z-index: 1;
        width: min(480px, 100vw);
        height: 100%;
        background: linear-gradient(180deg, #121212 0%, #0a0a0a 100%);
        border-left: 1px solid rgba(0, 242, 255, 0.2);
        box-shadow: -12px 0 40px rgba(0, 0, 0, 0.55);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: seriesDrawerSlideIn 0.28s ease;
    }
    @keyframes seriesDrawerSlideIn {
        from {
            transform: translateX(100%);
            opacity: 0.6;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    .series-drawer__hero {
        position: relative;
        min-height: 220px;
        overflow: hidden;
        flex-shrink: 0;
    }
    .series-drawer__hero :global(.series-drawer__poster) {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        background-size: cover;
        background-position: center top;
    }
    .series-drawer__hero-scrim {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(0, 0, 0, 0.15) 0%, rgba(0, 0, 0, 0.92) 78%);
    }
    .series-drawer__close {
        position: absolute;
        top: max(0.85rem, env(safe-area-inset-top, 0px));
        right: max(0.85rem, env(safe-area-inset-right, 0px));
        z-index: 2;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        cursor: pointer;
        touch-action: manipulation;
    }
    .series-drawer__hero-copy {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 2;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
    }
    .series-drawer__eyebrow {
        margin: 0;
        font-size: 0.68rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--neon-cyan, #00f2ff);
    }
    .series-drawer__title {
        margin: 0;
        font-size: 1.6rem;
        line-height: 1.1;
        text-shadow: 0 0 18px rgba(0, 242, 255, 0.25);
    }
    .series-drawer__description {
        margin: 0;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.72);
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .series-drawer__official-genre {
        margin: 0;
        font-size: 0.72rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
    }
    .series-drawer__suggestion {
        margin: 0.5rem 0 0;
        font-size: 0.78rem;
        color: rgba(250, 204, 21, 0.85);
        line-height: 1.4;
        font-style: italic;
    }
    .series-drawer__content {
        flex: 1;
        overflow-y: auto;
        padding: 1rem 1rem 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 0.85rem;
    }
    .series-drawer__toolbar {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
    }
    .series-drawer__toolbar h3 {
        margin: 0;
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }
    .series-drawer__toolbar span {
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    .series-drawer__seasons {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
    }
    .series-drawer__detail {
        padding: 0.85rem;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .series-drawer__detail h4 {
        margin: 0 0 0.35rem;
        font-size: 1rem;
    }
    .series-drawer__detail p {
        margin: 0 0 0.6rem;
        font-size: 0.82rem;
        color: rgba(255, 255, 255, 0.7);
        line-height: 1.45;
    }
    .series-drawer__detail-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .series-drawer__tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        margin-top: 0.5rem;
    }
    .series-drawer__tag {
        font-size: 0.65rem;
        padding: 0.15rem 0.45rem;
        border-radius: 999px;
        background: rgba(0, 242, 255, 0.1);
        border: 1px solid rgba(0, 242, 255, 0.25);
        color: rgba(255, 255, 255, 0.75);
    }

    /* —— Viewer streaming shelf —— */
    .series-drawer--viewer {
        background: #0c0d12;
        border-left-color: rgba(255, 255, 255, 0.08);
    }
    .series-shelf__header {
        flex-shrink: 0;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 1.1rem 1rem 0.85rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .series-shelf__heading {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.28rem;
    }
    .series-shelf__eyebrow {
        margin: 0;
        font-size: 0.65rem;
        font-weight: 600;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.45);
    }
    .series-shelf__title {
        margin: 0;
        font-size: 1.45rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.15;
        color: #fff;
    }
    .series-shelf__meta {
        margin: 0;
        font-size: 0.78rem;
        color: rgba(255, 255, 255, 0.5);
        letter-spacing: 0.01em;
    }
    .series-shelf__close {
        flex-shrink: 0;
        width: 2.75rem;
        height: 2.75rem;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.85);
        cursor: pointer;
        font-size: 1rem;
        line-height: 1;
        touch-action: manipulation;
        z-index: 3;
        transition: background 0.15s ease, border-color 0.15s ease;
    }
    .series-shelf__close:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.22);
    }
    .series-shelf__body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 0.75rem 0.75rem 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        -webkit-overflow-scrolling: touch;
    }
    .series-shelf__section {
        margin: 0 0 0.15rem;
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.4);
    }

    /* Docked landscape rail */
    .series-drawer-overlay--docked {
        position: relative;
        inset: auto;
        z-index: 1;
        width: min(360px, 34vw);
        min-width: 300px;
        max-width: 400px;
        height: 100%;
        max-height: 100vh;
        background: transparent;
        backdrop-filter: none;
        flex-shrink: 0;
        justify-content: stretch;
    }
    .series-drawer--docked {
        width: 100%;
        height: 100%;
        border-radius: 0;
        border-left: 1px solid rgba(255, 255, 255, 0.07);
        box-shadow: none;
        animation: none;
    }
</style>
