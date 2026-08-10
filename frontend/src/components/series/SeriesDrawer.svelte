<script>
    import { createEventDispatcher, onDestroy, tick } from 'svelte';
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
     * Optional ready vault rows (personal videos, feed extras). Catalog incomplete → vault siblings.
     * @type {Record<string, unknown>[]}
     */
    export let readyAssets = [];

    /**
     * Parent-provided series view (union already computed). When null, drawer resolves locally.
     * @type {import('../../lib/series/seriesTypes.js').Series | null}
     */
    export let seriesView = null;

    /**
     * Viewer Theater presentation — vault-inferred chrome, poster-only list.
     * @type {boolean}
     */
    export let viewerMode = true;

    /**
     * Dock as landscape side panel (no full-screen modal). Theater passes true on wide screens.
     * @type {boolean}
     */
    export let docked = false;

    $: catalogSeries = seriesId ? getSeriesById(seriesId) : null;

    $: relatedResult = (() => {
        // Parent already supplied the unioned series view (Theater) — skip second resolve.
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

    $: sortedSeasons = [...(series?.seasons || [])].sort((a, b) => a.seasonNumber - b.seasonNumber);
    $: officialSeriesDescription = viewerMode
        ? ''
        : creatorFacingDescription(series?.description);
    $: officialSeriesGenre = viewerMode ? '' : creatorFacingGenre(series?.genre);
    $: effectiveSeriesId = series?.id || seriesId || '';
    $: seriesLabelText = String(series?.title || '').trim();
    $: isVaultInferred =
        Array.isArray(series?.tags) &&
        series.tags.some((t) => /vault-inferred|related-resolver|vault-related/i.test(String(t)));

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
                on:click={closeDrawer}
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
            <header class="series-drawer__hero" class:series-drawer__hero--compact={viewerMode}>
                {#if series.poster && !viewerMode}
                    <MediaPoster url={series.poster} className="series-drawer__poster" aria-hidden="true" />
                {/if}
                <div class="series-drawer__hero-scrim"></div>
                <button type="button" class="series-drawer__close" aria-label="Close episode browser" on:click={closeDrawer}>✕</button>
                <div class="series-drawer__hero-copy">
                    <p class="series-drawer__eyebrow">
                        {#if viewerMode && isVaultInferred}
                            Vault-inferred series
                        {:else}
                            Series
                        {/if}
                    </p>
                    <h2 id="series-drawer-title" class="series-drawer__title">{series.title}</h2>
                    {#if viewerMode && seriesLabelText}
                        <p class="series-drawer__vault-label" data-series-label>{seriesLabelText}</p>
                    {/if}
                    {#if officialSeriesDescription}
                        <p class="series-drawer__description">{officialSeriesDescription}</p>
                    {/if}
                    {#if officialSeriesGenre}
                        <p class="series-drawer__official-genre">Genre: {officialSeriesGenre}</p>
                    {/if}
                    {#if selectedEpisodeId && !viewerMode}
                        <SeriesBadge episodeId={selectedEpisodeId} />
                    {/if}
                </div>
            </header>

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
                            {viewerMode}
                            on:episodeSelect={handleEpisodeSelect}
                        />
                    {/each}
                </div>

                {#if selectedEpisodeId && !viewerMode}
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
        top: 0.85rem;
        right: 0.85rem;
        z-index: 2;
        width: 2rem;
        height: 2rem;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(0, 0, 0, 0.55);
        color: #fff;
        cursor: pointer;
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
    /* Viewer Theater — landscape dock + compact chrome */
    .series-drawer-overlay--docked {
        position: relative;
        inset: auto;
        z-index: 1;
        width: min(400px, 38vw);
        min-width: 280px;
        height: 100%;
        max-height: 100vh;
        background: transparent;
        backdrop-filter: none;
        flex-shrink: 0;
        justify-content: flex-end;
    }
    .series-drawer--docked {
        width: 100%;
        height: 100%;
        border-radius: 0;
        border-left: 1px solid rgba(0, 242, 255, 0.22);
        box-shadow: none;
        animation: none;
    }
    .series-drawer__hero--compact {
        min-height: 0;
        padding: 0;
    }
    .series-drawer__hero--compact .series-drawer__hero-copy {
        position: relative;
        padding: 1rem 1rem 0.85rem;
    }
    .series-drawer__hero--compact .series-drawer__hero-scrim {
        display: none;
    }
    .series-drawer__vault-label {
        margin: 0;
        font-size: 0.78rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
    }
    .series-drawer--viewer .series-drawer__title {
        font-size: 1.35rem;
    }
    .series-drawer--viewer {
        background: linear-gradient(180deg, #14161c 0%, #0b0c10 100%);
    }
</style>
