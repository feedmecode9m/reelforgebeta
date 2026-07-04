<script context="module">
    import { writable, get } from 'svelte/store';
    import {
        episodeNavigationFlags,
        initPublishingProfile,
        syncReelshortActiveStore,
        theaterChromeFlags
    } from '../../lib/publishing/publishingProfileStore.js';
    import { logTheaterOpen } from '../../lib/theater/theaterDiagnostics.js';
    import { navigateToNextEpisode } from '../../lib/series/episodeNavigation.js';

    export { episodeNavigationFlags, theaterChromeFlags };

    export const reelshortActive = writable(false);
    export const feedCardProgress = writable({});
    export const feedActiveCardId = writable(null);
    export const theaterTimelinePct = writable(0);
    export const theaterCountdown = writable(0);

    let theaterCountdownTimer = null;
    let watchOnCompleteFn = () => {};
    let getTheaterVideoFn = () => null;

    /** @param {{ watchOnComplete?: (video: HTMLVideoElement) => void; getTheaterVideo?: () => HTMLVideoElement | null }} deps */
    export function configureReelshortExperience(deps = {}) {
        if (deps.watchOnComplete) watchOnCompleteFn = deps.watchOnComplete;
        if (deps.getTheaterVideo) getTheaterVideoFn = deps.getTheaterVideo;
    }

    let reelshortSyncUnsub = null;

    /** @param {{ setTimeout: (fn: () => void, ms: number) => number }} resourceManager @param {() => void} [onWatchContinue] */
    export function initReelshortProfile(resourceManager, onWatchContinue) {
        initPublishingProfile();
        if (!reelshortSyncUnsub) {
            reelshortSyncUnsub = syncReelshortActiveStore(reelshortActive);
        }
        onWatchContinue?.();
    }

    /** @param {HTMLElement} card */
    export function handleFeedCardActive(card) {
        const video = card.querySelector('video');
        if (!video) return;
        const reelId = card.dataset.reelId;
        feedActiveCardId.set(reelId);
        video.play().catch(() => {});
        const onTimeUpdate = () => {
            if (video.duration && Number.isFinite(video.duration)) {
                const pct = (video.currentTime / video.duration) * 100;
                feedCardProgress.update((m) => ({ ...m, [reelId]: pct }));
            }
        };
        video._feedTimeUpdate = onTimeUpdate;
        video.addEventListener('timeupdate', onTimeUpdate);
    }

    /** @param {HTMLElement} card */
    export function handleFeedCardInactive(card) {
        const video = card.querySelector('video');
        if (!video) return;
        video.pause();
        video.currentTime = 0;
        if (video._feedTimeUpdate) {
            video.removeEventListener('timeupdate', video._feedTimeUpdate);
            delete video._feedTimeUpdate;
        }
        const reelId = card.dataset.reelId;
        if (reelId === get(feedActiveCardId)) feedActiveCardId.set(null);
        feedCardProgress.update((m) => {
            const next = { ...m };
            delete next[reelId];
            return next;
        });
    }

    export function clearTheaterCountdown() {
        if (theaterCountdownTimer) {
            clearInterval(theaterCountdownTimer);
            theaterCountdownTimer = null;
        }
        theaterCountdown.set(0);
    }

    /** @deprecated Use navigateToNextEpisode — kept for module export compatibility. */
    export function triggerNextEpisodePlaceholder() {
        navigateToNextEpisode();
    }

    /** @param {Event} [e] */
    export function handleReelshortTheaterEnd(e) {
        if (!get(episodeNavigationFlags).showCountdown) return;
        const video = e?.currentTarget || getTheaterVideoFn();
        if (video) watchOnCompleteFn(video);
        clearTheaterCountdown();
        theaterCountdown.set(3);
        theaterCountdownTimer = setInterval(() => {
            theaterCountdown.update((n) => n - 1);
            if (get(theaterCountdown) <= 0) {
                clearTheaterCountdown();
                navigateToNextEpisode();
            }
        }, 1000);
    }

    /** @param {Event} e */
    export function handleTheaterTimeupdate(e) {
        if (!get(theaterChromeFlags).verticalTimeline) return;
        const v = e.currentTarget;
        if (v?.duration && Number.isFinite(v.duration)) {
            theaterTimelinePct.set((v.currentTime / v.duration) * 100);
        }
    }

    export function resetTheaterTimeline() {
        theaterTimelinePct.set(0);
    }
</script>

<script>
    import MediaRenderer from '../media/MediaRenderer.svelte';
    import MediaThumbnail from '../media/MediaThumbnail.svelte';
    import MediaPoster from '../media/MediaPoster.svelte';
    import { prefersHoverPreview } from '../../lib/vertical/feedCardAutoplay.js';
    import { videoMimeForPath } from '../../lib/config.js';

    /** @type {'feed' | 'theater-ambient' | 'theater-chrome'} */
    export let section = 'feed';

    /** @type {import('svelte/store').Writable<Record<string, unknown[]>>} */
    export let feed;
    /** @type {import('svelte/store').Readable<Record<string, unknown[]>>} */
    export let normalizedFeed;
    /** @type {import('svelte/store').Writable<boolean>} */
    export let adminMode;
    /** @type {import('svelte/store').Writable<Set<string>>} */
    export let feedCardVideoFallbacks;
    /** @type {import('svelte/store').Writable<Record<string, string>>} */
    export let feedCardImageFallbacks;
    /** @type {Record<string, unknown>} */
    export let UIAgent = {};
    /** @type {{ getName: (name: string) => string }} */
    export let categoryNames = { getName: (n) => n };

    /** @type {(reel: unknown) => boolean} */
    export let hasPlayableVideo = () => false;
    /** @type {(reel: unknown, category: string, i: number) => string} */
    export let getImg = () => '';
    /** @type {(reel: unknown) => void} */
    export let onOpenTheater = () => {};
    /** @type {(reelId: string) => void} */
    export let onRecordAccess = () => {};
    /** @type {(event: Event, reel: unknown) => void} */
    export let onCardVideoError = () => {};
    /** @type {(img: HTMLImageElement, reel: unknown, category: string, i: number) => void} */
    export let onImageError = () => {};
    /** @type {(img: HTMLImageElement, src: string) => void} */
    export let logVaultImageError = () => {};

    /** Theater ambient — active reel + playback */
    export let theaterVideoSrc = '';
    /** @type {unknown} */
    export let activeReel = null;
    /** @type {{ poster?: string } | null} */
    export let theaterPlayback = null;

    /** @type {Record<string, HTMLDivElement | null>} */
    let rowRefs = {};

    function getRowStep(row) {
        if (!row) return 360;
        const firstCard = row.querySelector('.reel-card');
        const cardWidth = firstCard?.getBoundingClientRect?.().width || 320;
        const styles = window.getComputedStyle(row);
        const gap = Number.parseFloat(styles.columnGap || styles.gap || '16') || 16;
        return cardWidth + gap;
    }

    function scrollRow(category, direction = 1) {
        const row = rowRefs[category];
        if (!row) return;
        const step = getRowStep(row) * 1.35;
        row.scrollBy({
            left: direction * step,
            behavior: 'smooth'
        });
    }

    function handleRowWheel(event, category) {
        const row = rowRefs[category];
        if (!row) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        row.scrollBy({
            left: event.deltaY,
            behavior: 'auto'
        });
    }

    function reelListKey(reel, category, index) {
        return [
            category,
            reel?.id || 'no-id',
            String(index)
        ].join('::');
    }

</script>

{#if section === 'feed'}
    {#each Object.keys($feed).filter((cat) => cat !== 'Auto-Detect') as category}
        {@const config = UIAgent.getStudioConfigs(category)}
        {@const displayName = categoryNames.getName(category)}
        {@const headingLabel = String(displayName || config.label || category)}
        <section class="shelf">
            <h2 style="border-left: 4px solid {config.color}; color: {config.color};">{headingLabel}</h2>
            <div class="row-shell">
                <button
                    type="button"
                    class="row-nav row-nav--left"
                    aria-label="Scroll row left"
                    on:click={() => scrollRow(category, -1)}
                >‹</button>
                <div
                    class="row"
                    role="region"
                    aria-label="{category} content row"
                    bind:this={rowRefs[category]}
                    on:mouseenter={UIAgent.startScroll}
                    on:mouseleave={UIAgent.stopScroll}
                    on:wheel={(event) => handleRowWheel(event, category)}
                >
                    {#each UIAgent.fillLandscape($normalizedFeed[category] || $feed[category] || [], category) as reel, i (reelListKey(reel, category, i))}
                        <button
                            class="reel-card"
                            class:is-ghost={reel.isPlaceholder}
                            class:is-personal={reel.isPersonalThumbnail || reel.isPersonalVideo}
                            data-reel-id={reel.id}
                            on:click={() => {
                                logTheaterOpen(reel, { source: 'feed-card-click', category });
                                onRecordAccess(reel.id);
                                onOpenTheater(reel);
                            }}
                            on:keydown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    logTheaterOpen(reel, { source: 'feed-card-keydown', category });
                                    onRecordAccess(reel.id);
                                    onOpenTheater(reel);
                                }
                            }}
                            aria-label="Play {reel.title}"
                        >
                            <div class="card-inner vault-card">
                                {#if hasPlayableVideo(reel) && reel.url}
                                    {#if $feedCardVideoFallbacks.has(reel.id)}
                                        <MediaThumbnail
                                            url={reel.thumbnailUrl || getImg(reel, category, i)}
                                            alt={reel.title || reel.name || 'Video poster'}
                                            lazyLoad
                                            className="card-visual card-video-fallback"
                                        />
                                    {:else}
                                        <MediaRenderer
                                            type="video"
                                            url={reel.url}
                                            poster={reel.thumbnailUrl || getImg(reel, category, i)}
                                            validateVideo={true}
                                            useSourceElement={true}
                                            captionsTrack={true}
                                            muted
                                            playsinline
                                            loop
                                            preload="metadata"
                                            className="card-visual"
                                            on:mouseenter={(e) => { if (prefersHoverPreview()) e.currentTarget.play(); }}
                                            on:mouseleave={(e) => { if (prefersHoverPreview()) { e.currentTarget.pause(); e.currentTarget.currentTime = 0; } }}
                                            on:loadeddata={() => console.log('✅ Video loaded:', reel.url, videoMimeForPath(reel.url))}
                                            on:error={(e) => onCardVideoError(e, reel)}
                                        />
                                    {/if}
                                {:else if reel.url}
                                    <MediaThumbnail
                                        url={$feedCardImageFallbacks[reel.id] || reel.url}
                                        alt="{reel.name || reel.title} - {category} production"
                                        lazyLoad
                                        className="card-visual"
                                        raw={Boolean($feedCardImageFallbacks[reel.id])}
                                        on:error={(e) => { logVaultImageError(e.currentTarget, reel.url); onImageError(e.currentTarget, reel, category, i); }}
                                    />
                                {:else}
                                    <div class="vault-card-empty" aria-label="Media unavailable">⚠️</div>
                                {/if}
                                <div class="savvy-hover">
                                    <div class="play-btn">▶</div>
                                    <div class="stats">{reel.match || 'ENHANCED BLACK STORIES'}</div>
                                    {#if reel.faces?.length > 0}<div class="face-count">🎭 {reel.faces.length} BLACK FACES</div>{/if}
                                    {#if reel.black_stories_theme}<div class="black-stories-badge">🎬 {reel.black_stories_theme}</div>{/if}
                                    {#if reel.ai_tags}<div class="ai-tags">🤖 {reel.ai_tags.slice(0, 2).join(', ')}</div>{/if}
                                    {#if reel.user_image_used}<div class="user-image-badge">🖼️ USER IMAGE</div>{/if}
                                    {#if reel.isAIGenerated}<div class="ai-generated-badge">✨ AI-GENERATED</div>{/if}
                                    {#if reel.isPersonalThumbnail}<div class="personal-thumbnail-badge">🖼️ PERSONAL</div>{/if}
                                    {#if reel.isPersonalVideo}<div class="personal-video-badge">🎬 PERSONAL VIDEO</div>{/if}
                                    {#if reel.auto_detected}<div class="auto-detected-badge">🤖 AI-PLACED</div>{/if}
                                </div>
                            </div>
                            <h3 class="reel-title">{reel.title}</h3>
                            {#if reel.views}<div class="reel-meta">👁️ {reel.views}k • ❤️ {reel.likes}</div>{/if}
                        </button>
                    {/each}
                </div>
                <button
                    type="button"
                    class="row-nav row-nav--right"
                    aria-label="Scroll row right"
                    on:click={() => scrollRow(category, 1)}
                >›</button>
            </div>
        </section>
    {/each}
{:else if section === 'theater-ambient' && $theaterChromeFlags.ambientBlur && theaterVideoSrc}
    <MediaPoster
        url={activeReel?.thumbnailUrl || theaterPlayback?.poster || ''}
        className="theater-ambient-bg"
        aria-hidden="true"
    />
{:else if section === 'theater-chrome' && ($theaterChromeFlags.progressRing || $theaterChromeFlags.verticalTimeline || $episodeNavigationFlags.showCountdown)}
    {#if $theaterChromeFlags.progressRing}
        <svg class="theater-progress-ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle class="ring-bg" cx="18" cy="18" r="15.5" />
            <circle class="ring-fill" cx="18" cy="18" r="15.5" pathLength="100" style="stroke-dashoffset: {100 - $theaterTimelinePct}" />
        </svg>
    {/if}
    {#if $theaterChromeFlags.verticalTimeline}
        <div class="vertical-timeline" aria-hidden="true">
            <div class="vertical-timeline-track">
                <div class="vertical-timeline-progress" style="width: {$theaterTimelinePct}%"></div>
                <span class="chapter-dot" style="left: 25%"></span>
                <span class="chapter-dot" style="left: 50%"></span>
                <span class="chapter-dot" style="left: 75%"></span>
            </div>
        </div>
    {/if}
    {#if $episodeNavigationFlags.showCountdown && $theaterCountdown > 0}
        <div class="next-episode-countdown" role="status">Next in {$theaterCountdown}...</div>
    {/if}
{/if}

<style>
    .shelf {
        margin-bottom: 3rem;
        padding: 0 2rem;
    }
    .shelf h2 {
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 2px;
        margin-bottom: 1rem;
        padding-left: 1rem;
    }
    .row {
        display: flex;
        gap: 1rem;
        overflow-x: auto;
        padding: 1rem 0;
        scroll-snap-type: x proximity;
        scroll-padding-inline: 0.25rem;
        scroll-behavior: smooth;
        overscroll-behavior-x: contain;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
    }
    .row-shell {
        position: relative;
    }
    .row-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        z-index: 6;
        width: 2.25rem;
        height: 2.25rem;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 999px;
        background: rgba(8, 10, 16, 0.72);
        color: #fff;
        font-size: 1.35rem;
        line-height: 1;
        display: grid;
        place-items: center;
        cursor: pointer;
        backdrop-filter: blur(6px);
    }
    .row-nav:hover {
        border-color: rgba(0, 242, 255, 0.72);
        color: var(--neon-cyan);
    }
    .row-nav--left {
        left: -0.3rem;
    }
    .row-nav--right {
        right: -0.3rem;
    }
    .row::-webkit-scrollbar {
        height: 6px;
    }
    .row::-webkit-scrollbar-track {
        background: transparent;
    }
    .row::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
    }
    .reel-card {
        flex: 0 0 clamp(280px, 28vw, 380px);
        scroll-snap-align: start;
        cursor: pointer;
        transition: transform 0.22s ease;
        background: none;
        border: none;
        padding: 0;
        text-align: left;
        transform-origin: center center;
        will-change: transform;
    }
    @media (hover: hover) and (pointer: fine) {
        .reel-card:hover {
            transform: scale(1.04);
            z-index: 10;
        }
    }
    @media (max-width: 900px) {
        .row-nav {
            display: none;
        }
    }
    .card-inner.vault-card {
        min-width: 120px;
        min-height: 120px;
        background: #1a1a1a;
    }
    .card-inner.vault-card :global(img),
    .card-inner.vault-card :global(video),
    .card-inner.vault-card :global(.card-video-fallback) {
        object-fit: cover;
        width: 100%;
        height: 100%;
        min-height: 120px;
        background: #1a1a1a;
        display: block;
        pointer-events: none;
    }
    .vault-card-empty {
        width: 100%;
        height: 100%;
        min-height: 120px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        color: rgba(255, 255, 255, 0.5);
        font-size: 2rem;
    }
    .card-inner {
        position: relative;
        aspect-ratio: 16 / 9;
        border-radius: 8px;
        overflow: hidden;
        background: #1a1a1a;
        min-height: 168px;
    }
    :global(.card-visual) {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        min-height: 120px;
        background: #1a1a1a;
        max-width: 100%;
        max-height: 100%;
    }
    .savvy-hover {
        position: absolute;
        inset: 0;
        background: linear-gradient(transparent 40%, rgba(0, 0, 0, 0.9));
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding: 1rem;
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
    }
    .reel-card:hover .savvy-hover {
        opacity: 1;
    }
    .play-btn {
        width: 50px;
        height: 50px;
        background: var(--neon-cyan);
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 1.25rem;
        margin-bottom: 0.5rem;
        color: #000;
    }
    .stats {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.8);
        margin-bottom: 0.25rem;
    }
    .face-count,
    .black-stories-badge,
    .ai-tags,
    .user-image-badge,
    .ai-generated-badge,
    .personal-thumbnail-badge,
    .personal-video-badge,
    .auto-detected-badge {
        font-size: 0.65rem;
        padding: 0.25rem 0.5rem;
        background: rgba(0, 0, 0, 0.6);
        border-radius: 4px;
        margin-top: 0.25rem;
        display: inline-block;
    }
    .reel-title {
        font-size: 0.875rem;
        margin: 0.75rem 0 0.25rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .reel-meta {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.5);
    }
    .is-ghost {
        opacity: 0.7;
    }
    .is-personal {
        border: 2px solid var(--neon-gold);
    }

    /* ── REELSHORT theater-only immersive profile ── */
    :global(:root) {
        --reelshort-aspect: 9 / 16;
        --reelshort-theater-max-width: 450px;
    }
    .theater-progress-ring {
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 4;
        width: 36px;
        height: 36px;
        pointer-events: none;
    }
    .theater-progress-ring .ring-bg {
        fill: none;
        stroke: rgba(255, 255, 255, 0.25);
        stroke-width: 2;
    }
    .theater-progress-ring .ring-fill {
        fill: none;
        stroke: var(--neon-cyan);
        stroke-width: 2.5;
        stroke-linecap: round;
        transform: rotate(-90deg);
        transform-origin: 50% 50%;
        stroke-dasharray: 100;
        transition: stroke-dashoffset 0.15s linear;
    }
    :global(.reelshort-theater) {
        max-width: var(--reelshort-theater-max-width) !important;
        aspect-ratio: var(--reelshort-aspect);
        margin: 0 auto;
        overflow: hidden;
        position: relative;
    }
    :global(.reelshort-theater .theater-header) {
        position: relative;
        z-index: 3;
    }
    :global(.reelshort-theater .theater-meta),
    :global(.reelshort-theater .theater-close-btn-bottom),
    :global(.publishing-immersive .theater-meta),
    :global(.publishing-immersive .theater-close-btn-bottom) {
        display: none;
    }
    :global(.theater-ambient-bg) {
        position: absolute;
        inset: -10%;
        background-size: cover;
        background-position: center;
        filter: blur(24px);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        transform: scale(1.1);
        opacity: 0.45;
        z-index: 0;
        pointer-events: none;
    }
    :global(.reelshort-video-wrap) {
        position: relative;
        z-index: 2;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }
    .vertical-timeline {
        height: 60px;
        background: rgba(0, 0, 0, 0.8);
        padding: 0.75rem 1rem;
        position: relative;
        z-index: 3;
        flex-shrink: 0;
    }
    .vertical-timeline-track {
        position: relative;
        height: 6px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 999px;
        overflow: visible;
    }
    .vertical-timeline-progress {
        height: 100%;
        background: linear-gradient(90deg, var(--neon-cyan), var(--neon-pink));
        border-radius: 999px;
        transition: width 0.15s linear;
    }
    .chapter-dot {
        position: absolute;
        top: 50%;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.55);
        transform: translate(-50%, -50%);
        pointer-events: none;
    }
    .next-episode-countdown {
        position: absolute;
        bottom: 72px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 4;
        padding: 0.5rem 1rem;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.75);
        border: 1px solid rgba(255, 0, 255, 0.45);
        color: #fff;
        font-size: 0.8rem;
        letter-spacing: 0.05em;
        pointer-events: none;
    }
    :global(.theater-swipe-pulse) {
        animation: theaterSwipePulse 0.3s ease;
    }
    @keyframes theaterSwipePulse {
        0% {
            transform: scale(1);
        }
        50% {
            transform: scale(0.98);
        }
        100% {
            transform: scale(1);
        }
    }
    @media (orientation: portrait) and (max-width: 640px) {
        :global(.reelshort-theater) {
            max-height: 100vh;
        }
    }
</style>
