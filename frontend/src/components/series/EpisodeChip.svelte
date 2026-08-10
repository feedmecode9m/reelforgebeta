<script>
    import { createEventDispatcher } from 'svelte';

    const dispatch = createEventDispatcher();

    /** @param {string} s */
    function normalizeLoose(s) {
        return String(s || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

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
     * Viewer Theater mode — posters + titles only, no admin binding chrome.
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
    $: viewerLine = labelRoot
        ? `${epPad}  ${labelRoot} • S${seasonNumber} • E${episodeNumber}`
        : `${epPad}  ${title}`;
    /** Playability comes from parent presentation (resolver match only). */
    $: isPlayable = playable === true || (playable === undefined && Boolean(mediaAssetId));
    $: readyBound = isPlayable && Boolean(mediaAssetId && String(mediaAssetId).trim());
    $: showUnavailable = !isPlayable;
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
    data-testid={episodeId ? `episode-chip-${episodeId}` : undefined}
    aria-pressed={selected}
    aria-disabled={!isPlayable}
    disabled={!isPlayable}
    aria-label={viewerMode
        ? `${viewerLine}${readyBound ? ' — play' : ' — unavailable'}`
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
        <div class="episode-chip__viewer-row">
            {#if thumbnailUrl && readyBound}
                <div class="episode-chip__thumb-wrap episode-chip__thumb-wrap--viewer">
                    <img class="episode-chip__thumb" src={thumbnailUrl} alt="" loading="lazy" />
                </div>
            {:else}
                <div class="episode-chip__thumb-wrap episode-chip__thumb-wrap--viewer episode-chip__thumb-wrap--empty" aria-hidden="true"></div>
            {/if}
            <div class="episode-chip__viewer-copy">
                <p class="episode-chip__viewer-line">{viewerLine}</p>
                {#if title && labelRoot && !normalizeLoose(title).includes(normalizeLoose(labelRoot))}
                    <p class="episode-chip__viewer-sub">{title}</p>
                {/if}
            </div>
        </div>
    {:else}
        <div class="episode-chip__header">
            <p class="episode-chip__code">{code}</p>
            <p class="episode-chip__title">{title}</p>
        </div>

        {#if thumbnailUrl && readyBound}
            <div class="episode-chip__thumb-wrap">
                <img class="episode-chip__thumb" src={thumbnailUrl} alt="" loading="lazy" />
            </div>
        {/if}

        {#if readyBound}
            <span
                class="episode-chip__status"
                class:episode-chip__status--ready={true}
                class:episode-chip__status--manual={matchTier === 'manual' || displayBindingLabel === 'Manual Vault Asset'}
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
        transition: border-color 0.2s ease, background 0.2s ease;
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
    /* Viewer Theater — posters + episode lines only */
    .episode-chip.viewer {
        flex-direction: row;
        align-items: center;
        padding: 0.55rem 0.7rem;
        gap: 0.75rem;
    }
    .episode-chip__viewer-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        width: 100%;
        min-width: 0;
    }
    .episode-chip__thumb-wrap--viewer {
        width: 4.5rem;
        min-width: 4.5rem;
        max-height: none;
        aspect-ratio: 16 / 10;
        flex-shrink: 0;
    }
    .episode-chip__thumb-wrap--empty {
        background: linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(0, 242, 255, 0.08));
    }
    .episode-chip__viewer-copy {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
    }
    .episode-chip__viewer-line {
        margin: 0;
        font-size: 0.92rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1.25;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .episode-chip__viewer-sub {
        margin: 0;
        font-size: 0.72rem;
        color: rgba(255, 255, 255, 0.55);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
