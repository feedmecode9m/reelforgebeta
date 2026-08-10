<script>
    import { createEventDispatcher } from 'svelte';
    import { resolveMediaForRender } from '../media/resolveDisplayUrl.js';

    const dispatch = createEventDispatcher();

    /** @type {number} */
    export let seasonNumber = 1;

    /** @type {number} */
    export let episodeNumber = 1;

    /** @type {string} */
    export let title = '';

    /** Franchise / series label for viewer list lines (e.g. STIRRED). */
    /** @type {string} */
    export let seriesLabel = '';

    /**
     * Viewer Theater mode — poster + S/E labels + active state.
     * @type {boolean}
     */
    export let viewerMode = false;

    /** @type {string} */
    export let episodeId = '';

    /** @type {import('../../lib/series/seriesTypes.js').EpisodeStatus} */
    export let status = 'published';

    /** @type {boolean} */
    export let selected = false;

    /** @type {boolean | undefined} */
    export let playable = undefined;

    /** Hero Vault thumbnail URL (bound ready asset) */
    /** @type {string} */
    export let thumbnailUrl = '';

    /** @type {string | null} */
    export let mediaAssetId = null;

    /** @type {string | null} */
    export let thumbnailAssetId = null;

    /** @type {'exact' | 'primary' | 'fuzzy' | 'fallback' | 'manual' | null | string} */
    export let matchTier = null;

    /**
     * Binding source label: "Manual Vault Asset" | "Auto matched" | "Asset unavailable"
     * @type {string}
     */
    export let bindingLabel = '';

    $: code = `S${seasonNumber}:E${episodeNumber}`;
    $: epPad = String(Math.max(0, episodeNumber || 0)).padStart(2, '0');
    $: labelRoot = String(seriesLabel || '').trim();
    $: seBadge = `S${seasonNumber} · E${episodeNumber}`;
    /**
     * Viewer shelf line: "01  STIRRED • S1 • E1"
     * Never includes confidence, vault inference, or admin binding labels.
     */
    $: viewerIdentityLine = labelRoot
        ? `${epPad}  ${labelRoot} • S${seasonNumber} • E${episodeNumber}`
        : `${epPad}  S${seasonNumber} • E${episodeNumber}`;
    /** Prefer a human episode title without repeating the franchise alone. */
    $: displayTitle = (() => {
        const t = String(title || '').trim();
        if (!t) return labelRoot ? `Episode ${episodeNumber}` : `Episode ${episodeNumber}`;
        if (labelRoot) {
            const loose = (s) =>
                String(s || '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, ' ')
                    .trim();
            const lt = loose(t);
            const ll = loose(labelRoot);
            // "STIRRED 1" / "STIRRED S01E01" → let identity line carry S/E; hide redundant title
            if (
                lt === ll ||
                lt === `${ll} ${episodeNumber}` ||
                lt === `${ll} s${seasonNumber} e${episodeNumber}` ||
                lt === `${ll} s0${seasonNumber} e0${episodeNumber}` ||
                new RegExp(
                    `^${ll.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*s0*${seasonNumber}\\s*e0*${episodeNumber}$`
                ).test(lt)
            ) {
                return '';
            }
        }
        return t;
    })();
    /** Playability comes from parent presentation. */
    $: isPlayable = playable === true || (playable === undefined && Boolean(mediaAssetId));
    $: readyBound = isPlayable && Boolean(mediaAssetId && String(mediaAssetId).trim());
    $: showUnavailable = !isPlayable;
    /**
     * Final <img> URL through the same media/backend resolver as MediaRenderer/Theater posters.
     * Absolute URLs passthrough; relative `/thumbs/*` join configured media origin.
     */
    $: resolvedPosterUrl = String(thumbnailUrl || '').trim()
        ? resolveMediaForRender(thumbnailUrl, 'poster', 'EpisodeChip:viewerPoster') ||
          String(thumbnailUrl || '').trim()
        : '';
    $: hasPoster = Boolean(resolvedPosterUrl);
    $: displayBindingLabel = bindingLabel
        ? bindingLabel
        : readyBound
          ? matchTier === 'manual'
            ? 'Manual Vault Asset'
            : 'Auto matched'
          : 'Asset unavailable';
</script>

<button
    type="button"
    class="episode-chip"
    class:selected
    class:draft={status === 'draft'}
    class:unplayable={!isPlayable}
    class:ready={readyBound}
    class:viewer={viewerMode}
    data-episode-id={episodeId || undefined}
    data-media-asset-id={mediaAssetId || undefined}
    data-thumbnail-asset-id={thumbnailAssetId || undefined}
    data-match-tier={viewerMode ? undefined : matchTier || undefined}
    data-binding-label={viewerMode ? undefined : displayBindingLabel || undefined}
    data-viewer-mode={viewerMode ? 'true' : undefined}
    data-active={selected ? 'true' : undefined}
    data-testid={episodeId ? `episode-chip-${episodeId}` : undefined}
    aria-pressed={selected}
    aria-disabled={!isPlayable}
    disabled={!isPlayable}
    aria-label={viewerMode
        ? `${viewerIdentityLine}${selected ? ' — now playing' : readyBound ? ' — play' : ' — unavailable'}`
        : `${code} ${title} — ${displayBindingLabel}${readyBound ? ' — Enter Theater' : ''}`}
    on:click={() => {
        if (!isPlayable) return;
        dispatch('select', {
            episodeId,
            seasonNumber,
            episodeNumber,
            title,
            mediaAssetId,
            thumbnailAssetId,
            reelId: mediaAssetId || null
        });
    }}
>
    {#if viewerMode}
        <div class="episode-card">
            <div
                class="episode-card__poster"
                class:episode-card__poster--empty={!hasPoster}
                aria-hidden="true"
            >
                {#if hasPoster}
                    <img class="episode-card__img" src={resolvedPosterUrl} alt="" loading="lazy" />
                {:else}
                    <span class="episode-card__ep-num">{epPad}</span>
                {/if}
                {#if selected}
                    <span class="episode-card__live">Now playing</span>
                {/if}
            </div>
            <div class="episode-card__copy">
                <span class="episode-card__identity" data-viewer-episode-identity>{viewerIdentityLine}</span>
                {#if displayTitle}
                    <span class="episode-card__title">{displayTitle}</span>
                {/if}
            </div>
        </div>
    {:else}
        <div class="episode-chip__header">
            <p class="episode-chip__code">{code}</p>
            <p class="episode-chip__title">{title}</p>
        </div>

        {#if hasPoster && readyBound}
            <div class="episode-chip__thumb-wrap">
                <img class="episode-chip__thumb" src={resolvedPosterUrl} alt="" loading="lazy" />
            </div>
        {/if}

        {#if readyBound}
            <span
                class="episode-chip__status"
                class:episode-chip__status--ready={true}
                class:episode-chip__status--manual={matchTier === 'manual' ||
                    displayBindingLabel === 'Manual Vault Asset'}
            >{displayBindingLabel}</span>
            <span class="episode-chip__enter">▶ Enter Theater</span>
        {:else if showUnavailable}
            <span class="episode-chip__status episode-chip__status--unavailable">{displayBindingLabel}</span>
        {:else if status === 'draft'}
            <span class="episode-chip__status">Draft</span>
        {/if}
    {/if}
</button>

<style>
    .episode-chip {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0.5rem;
        width: 100%;
        padding: 0.75rem 0.9rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        color: #fff;
        cursor: pointer;
        text-align: left;
        transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
        font-family: inherit;
    }
    .episode-chip:hover:not(:disabled) {
        border-color: rgba(0, 242, 255, 0.45);
        background: rgba(0, 242, 255, 0.08);
    }
    .episode-chip.selected {
        border-color: var(--neon-cyan, #00f2ff);
        background: rgba(0, 242, 255, 0.14);
        box-shadow: 0 0 16px rgba(0, 242, 255, 0.2);
    }
    .episode-chip.ready {
        border-color: rgba(52, 211, 153, 0.35);
    }
    .episode-chip.draft,
    .episode-chip.unplayable {
        opacity: 0.78;
        cursor: not-allowed;
    }
    .episode-chip:disabled {
        pointer-events: none;
    }
    .episode-chip__header {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        min-width: 0;
    }
    .episode-chip__thumb-wrap {
        width: 100%;
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.35);
        aspect-ratio: 16 / 9;
        max-height: 8rem;
    }
    .episode-chip__thumb {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .episode-chip__code {
        margin: 0;
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: var(--neon-cyan, #00f2ff);
    }
    .episode-chip__title {
        margin: 0;
        font-size: 0.98rem;
        font-weight: 600;
        line-height: 1.3;
    }
    .episode-chip__status {
        align-self: flex-start;
        font-size: 0.62rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 0.18rem 0.45rem;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.55);
    }
    .episode-chip__status--ready {
        background: rgba(52, 211, 153, 0.18);
        color: #6ee7b7;
        border: 1px solid rgba(52, 211, 153, 0.35);
    }
    .episode-chip__status--manual {
        background: rgba(96, 165, 250, 0.16);
        color: #93c5fd;
        border: 1px solid rgba(96, 165, 250, 0.4);
    }
    .episode-chip__status--unavailable {
        background: rgba(251, 113, 133, 0.12);
        color: #fda4af;
        border: 1px solid rgba(251, 113, 133, 0.28);
    }
    .episode-chip__enter {
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--neon-cyan, #00f2ff);
        letter-spacing: 0.02em;
    }

    /* Viewer streaming episode cards */
    .episode-chip.viewer {
        padding: 0;
        border: 1px solid transparent;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
        overflow: hidden;
    }
    .episode-chip.viewer:hover:not(:disabled) {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        box-shadow: none;
    }
    .episode-chip.viewer.selected {
        border-color: rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.08);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .episode-chip.viewer.ready {
        border-color: transparent;
    }
    .episode-chip.viewer.selected.ready {
        border-color: rgba(255, 255, 255, 0.28);
    }
    .episode-card {
        display: grid;
        grid-template-columns: 5.6rem minmax(0, 1fr);
        gap: 0.8rem;
        align-items: center;
        width: 100%;
        padding: 0.5rem 0.65rem 0.5rem 0.5rem;
    }
    .episode-card__poster {
        position: relative;
        width: 5.6rem;
        aspect-ratio: 16 / 10;
        border-radius: 6px;
        overflow: hidden;
        background: #1a1c24;
        flex-shrink: 0;
    }
    .episode-card__poster--empty {
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(145deg, #1a1c24 0%, #12141a 100%);
        border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .episode-card__img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .episode-card__ep-num {
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: rgba(255, 255, 255, 0.35);
    }
    .episode-card__live {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 0.2rem 0.25rem;
        font-size: 0.55rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        text-align: center;
        color: #0a0a0a;
        background: rgba(255, 255, 255, 0.92);
    }
    .episode-card__copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.12rem;
    }
    .episode-card__identity {
        font-size: 0.88rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.88);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .episode-chip.viewer.selected .episode-card__identity {
        color: #fff;
    }
    .episode-card__se {
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
    }
    .episode-chip.viewer.selected .episode-card__se {
        color: rgba(255, 255, 255, 0.75);
    }
    .episode-card__title {
        font-size: 0.78rem;
        font-weight: 500;
        line-height: 1.25;
        color: rgba(255, 255, 255, 0.45);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .episode-card__series {
        font-size: 0.7rem;
        color: rgba(255, 255, 255, 0.4);
        letter-spacing: 0.02em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
