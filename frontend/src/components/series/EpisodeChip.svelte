<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { resolveMediaForRender } from '../media/resolveDisplayUrl.js';
    import { resolveVaultCardProjection } from '../../lib/content/vaultCardProjection.js';
    import {
        resolveLinkedAssetDisplayTitle,
        isUnsafeHeroFilenameTitle,
        UNTITLED_CREATOR_EXPERIENCE
    } from '../../lib/hero/heroTitleIntelligence.js';
    import { isUnsafeViewerCardTitle } from '../../lib/feed/viewerMediaIdentity.js';
    import { isVaultVideoMediaUrl } from '../../lib/vault/normalizeVaultAsset.js';

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

    /** Optional playback URL so persistent-title aliases match Hero Vault ids. */
    /** @type {string} */
    export let mediaUrl = '';

    /** Hero Vault thumbnail URL (bound ready asset) */
    /** @type {string} */
    export let thumbnailUrl = '';

    let titleEpoch = 0;
    onMount(() => {
        if (typeof window === 'undefined') return;
        const onVaultTitle = () => {
            titleEpoch += 1;
        };
        window.addEventListener('reelforge:vault-title-updated', onVaultTitle);
        return () => window.removeEventListener('reelforge:vault-title-updated', onVaultTitle);
    });

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

    /** Optional creator description (admin may still pass; viewer prefers projection). */
    /** @type {string} */
    export let description = '';

    $: code = `S${seasonNumber}:E${episodeNumber}`;
    $: epPad = String(Math.max(0, episodeNumber || 0)).padStart(2, '0');
    $: labelRoot = String(seriesLabel || '').trim();
    $: seBadge = `S${seasonNumber} · E${episodeNumber}`;
    /**
     * Structural S/E line. Master Edit label is `displayTitle` / data-vault-card-title.
     */
    $: viewerIdentityLine =
        seasonNumber && episodeNumber
            ? `${epPad}  • S${seasonNumber} • E${episodeNumber}`
            : '';

    /** @type {string} */
    $: linkedReelId = String(mediaAssetId || '').trim();

    $: vaultCard = linkedReelId
        ? resolveVaultCardProjection(linkedReelId, {
              episodeTitle: String(title || '').trim() || undefined,
              seriesLabel: labelRoot || undefined,
              seasonNumber,
              episodeNumber,
              reel: {
                  id: linkedReelId,
                  title: String(title || '').trim(),
                  name: String(title || '').trim(),
                  thumbnailUrl: String(thumbnailUrl || '').trim(),
                  description: String(description || '').trim(),
                  url: String(mediaUrl || '').trim(),
                  mediaUrl: String(mediaUrl || '').trim()
              }
          })
        : null;

    /**
     * Viewer: Hero Vault Master Edit label (same authority as vault cards).
     * Never paint Finder "copy UUID" / filename stems — blank until a real title exists.
     * Admin: preserve package title for creator tooling.
     */
    $: displayTitle = (() => {
        void titleEpoch;
        if (viewerMode) {
            const projected = String(vaultCard?.title || '').trim();
            if (
                projected &&
                projected !== UNTITLED_CREATOR_EXPERIENCE &&
                !isUnsafeViewerCardTitle(projected) &&
                !isUnsafeHeroFilenameTitle(projected)
            ) {
                return projected;
            }
            const linked = resolveLinkedAssetDisplayTitle(linkedReelId, {
                episodeTitle: String(title || '').trim(),
                assetTitle: String(title || '').trim()
            });
            if (
                linked &&
                linked !== UNTITLED_CREATOR_EXPERIENCE &&
                !isUnsafeViewerCardTitle(linked) &&
                !isUnsafeHeroFilenameTitle(linked)
            ) {
                return linked;
            }
            const t = String(title || '').trim();
            if (
                !t ||
                /^episode\s+\d+$/i.test(t) ||
                /^untitled/i.test(t) ||
                isUnsafeViewerCardTitle(t) ||
                isUnsafeHeroFilenameTitle(t)
            ) {
                return '';
            }
            return t;
        }
        return String(title || '').trim();
    })();

    $: viewerDescription = viewerMode
        ? String(vaultCard?.description || '').trim()
        : String(description || '').trim();

    /** Playability comes from parent presentation. */
    $: isPlayable = playable === true || (playable === undefined && Boolean(mediaAssetId));
    $: readyBound = isPlayable && Boolean(mediaAssetId && String(mediaAssetId).trim());
    $: showUnavailable = !isPlayable;
    /**
     * Final <img> URL through the same media/backend resolver as MediaRenderer/Theater posters.
     * Never use an MP4/playback URL as poster (blank on iOS All Episodes).
     */
    $: posterSource = (() => {
        const candidates = viewerMode
            ? [vaultCard?.posterUrl, thumbnailUrl]
            : [thumbnailUrl, vaultCard?.posterUrl];
        for (const candidate of candidates) {
            const next = String(candidate || '').trim();
            if (!next || next.startsWith('blob:') || next.startsWith('data:')) continue;
            if (isVaultVideoMediaUrl(next)) continue;
            return next;
        }
        return '';
    })();
    $: resolvedPosterUrl = posterSource
        ? resolveMediaForRender(posterSource, 'poster', 'EpisodeChip:viewerPoster') || posterSource
        : '';
    $: hasPoster = Boolean(resolvedPosterUrl);

    let posterExtFallbackTried = false;
    $: if (resolvedPosterUrl) posterExtFallbackTried = false;

    /**
     * @param {Event} event
     */
    function handlePosterError(event) {
        const img = /** @type {HTMLImageElement} */ (event.currentTarget);
        const src = String(img?.src || '');
        if (!src || posterExtFallbackTried) return;
        posterExtFallbackTried = true;
        if (/\.jpg(\?|#|$)/i.test(src)) {
            img.src = src.replace(/\.jpg(\?|#|$)/i, '.png$1');
            return;
        }
        if (/\.png(\?|#|$)/i.test(src)) {
            img.src = src.replace(/\.png(\?|#|$)/i, '.jpg$1');
        }
    }
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
        ? `${viewerIdentityLine || 'Episode'}${displayTitle ? ` — ${displayTitle}` : ''}${selected ? ' — now playing' : readyBound ? ' — play' : ' — unavailable'}`
        : `${code} ${title} — ${displayBindingLabel}${readyBound ? ' — Enter Theater' : ''}`}
    on:click={() => {
        if (!isPlayable) return;
        dispatch('select', {
            episodeId,
            seasonNumber,
            episodeNumber,
            title: displayTitle || title,
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
                    <img
                        class="episode-card__img"
                        src={resolvedPosterUrl}
                        alt=""
                        loading="eager"
                        decoding="async"
                        on:error={handlePosterError}
                    />
                {:else}
                    <span class="episode-card__ep-num">{epPad}</span>
                {/if}
                {#if selected}
                    <span class="episode-card__live">Now playing</span>
                {/if}
            </div>
            <div class="episode-card__copy">
                {#if viewerIdentityLine}
                    <span class="episode-card__identity" data-viewer-episode-identity
                        >{viewerIdentityLine}</span
                    >
                {/if}
                {#if displayTitle}
                    <span class="episode-card__title" data-vault-card-title>{displayTitle}</span>
                {/if}
                {#if viewerDescription}
                    <span class="episode-card__description" data-vault-card-description
                        >{viewerDescription.length > 90
                            ? `${viewerDescription.slice(0, 90)}…`
                            : viewerDescription}</span
                    >
                {/if}
            </div>
        </div>
    {:else}
        <div class="episode-chip__header">
            <p class="episode-chip__code">{code}</p>
            {#if title}
                <p class="episode-chip__title">{title}</p>
            {/if}
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
        min-height: 44px;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
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
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.5);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .episode-chip.viewer.selected .episode-card__identity {
        color: rgba(255, 255, 255, 0.75);
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
        font-size: 0.88rem;
        font-weight: 600;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.92);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .episode-chip.viewer.selected .episode-card__title {
        color: #fff;
    }
    .episode-card__description {
        display: block;
        margin-top: 0.15rem;
        font-size: 0.68rem;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.4);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
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
