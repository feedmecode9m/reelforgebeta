<script context="module">
    import { writable, get } from 'svelte/store';
    import { tick } from 'svelte';
    import {
        handleReelshortTheaterEnd,
        handleTheaterTimeupdate,
        clearTheaterCountdown,
        resetTheaterTimeline
    } from '../vertical/ReelshortExperience.svelte';
    import { applyEpisodeFieldsToReel } from '../../lib/series/episodeBridge.js';
    import { navigateFromDrawer, navigateOnSwipeUp } from '../../lib/series/episodeNavigation.js';
    import { resolveSeriesContextForReel } from '../../lib/series/seriesStore.js';
    import {
        activePublishingProfile,
        episodeNavigationFlags,
        metadataDisplayFlags,
        theaterChromeFlags
    } from '../../lib/publishing/publishingProfileStore.js';
    import {
        logTheaterClose,
        logTheaterMedia,
        logTheaterOpen,
        logTheaterState
    } from '../../lib/theater/theaterDiagnostics.js';

    export {
        activePublishingProfile,
        episodeNavigationFlags,
        metadataDisplayFlags,
        theaterChromeFlags
    };

    export const activeReel = writable(null);
    export const theaterPlaybackError = writable(false);
    export const theaterRetryNonce = writable(0);

    export const DEBUG_THEATER =
        typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'theater';

    let resourceManagerRef = null;
    let watchOnExitFn = () => {};
    let watchOnCompleteFn = () => {};
    let watchOnPlayFn = () => {};
    let watchOnPauseFn = () => {};
    let findReelInFeedFn = () => null;
    let watchSessionStartFn = () => {};
    let getPersonalVideosFn = () => [];
    let resolveTheaterPlaybackFn = () => null;
    let logTheaterHandshakeFn = () => {};
    let isVideoReelFn = () => false;
    let reuploadDeps = {
        deleteProduction: () => {},
        openControlCenter: () => {},
        setUploadStatus: () => {},
        scheduleStandby: () => {}
    };

    /** @param {Record<string, unknown>} deps */
    export function configureTheaterExperience(deps = {}) {
        if (deps.resourceManager) resourceManagerRef = deps.resourceManager;
        if (deps.watchOnExit) watchOnExitFn = deps.watchOnExit;
        if (deps.watchOnComplete) watchOnCompleteFn = deps.watchOnComplete;
        if (deps.watchOnPlay) watchOnPlayFn = deps.watchOnPlay;
        if (deps.watchOnPause) watchOnPauseFn = deps.watchOnPause;
        if (deps.findReelInFeed) findReelInFeedFn = deps.findReelInFeed;
        if (deps.watchSessionStart) watchSessionStartFn = deps.watchSessionStart;
        if (deps.getPersonalVideos) getPersonalVideosFn = deps.getPersonalVideos;
        if (deps.resolveTheaterPlayback) resolveTheaterPlaybackFn = deps.resolveTheaterPlayback;
        if (deps.logTheaterHandshake) logTheaterHandshakeFn = deps.logTheaterHandshake;
        if (deps.isVideoReel) isVideoReelFn = deps.isVideoReel;
        if (deps.reupload) reuploadDeps = { ...reuploadDeps, ...deps.reupload };
    }

    class TheaterManager {
        constructor() {
            this.videoElement = null;
        }
        setVideoElement(el) {
            this.videoElement = el;
        }
        close() {
            const closingId = get(activeReel)?.id ?? null;
            logTheaterClose({ reelId: closingId, reason: 'theaterManager.close' });
            const el = this.videoElement;
            if (el) {
                watchOnExitFn(el);
                el.pause();
                el.src = '';
                el.load();
                this.videoElement = null;
            }
            resourceManagerRef?.cleanupAllBlobs?.();
            activeReel.set(null);
            logTheaterState({ activeReelId: null, visible: false, phase: 'closed' });
        }
        handleVideoEnd() {
            if (this.videoElement) watchOnCompleteFn(this.videoElement);
            resourceManagerRef?.setTimeout?.(() => this.close(), 1000);
        }
    }

    export const theaterManager = new TheaterManager();

    export function logTheater(msg, data = {}) {
        if (!DEBUG_THEATER && !import.meta.env.DEV) return;
        console.log(`🎭 [THEATER DEBUG] ${msg}`, {
            timestamp: new Date().toISOString(),
            activeReelId: get(activeReel)?.id,
            ...data
        });
    }

    /** @param {Event} e */
    export function handleTheaterEnded(e) {
        if (get(episodeNavigationFlags).showCountdown) handleReelshortTheaterEnd(e);
        else theaterManager.handleVideoEnd();
    }

    /** @param {unknown} reel */
    export function openTheaterReel(reel) {
        if (!reel) {
            logTheaterOpen(null, { aborted: true, reason: 'no-reel' });
            return;
        }
        logTheaterOpen(reel, { source: 'openTheaterReel', activeReelBefore: get(activeReel)?.id ?? null });
        clearTheaterCountdown();
        resetTheaterTimeline();
        let fresh = findReelInFeedFn(reel.id) || reel;
        const seriesCtx = resolveSeriesContextForReel(fresh);
        if (seriesCtx) {
            fresh = applyEpisodeFieldsToReel(fresh, seriesCtx);
        }
        theaterPlaybackError.set(false);
        theaterRetryNonce.set(0);
        activeReel.set(fresh);
        logTheaterState({
            activeReelId: fresh.id,
            visible: true,
            phase: 'opened',
            resolvedFromFeed: Boolean(findReelInFeedFn(reel.id))
        });
        watchSessionStartFn({
            reelId: fresh.id,
            episodeId: seriesCtx?.episode?.episodeId || fresh.episode_id || fresh.episodeId || null,
            seriesId: seriesCtx?.series?.id || fresh.seriesId || null,
            seasonNumber: seriesCtx?.season?.seasonNumber ?? fresh.seasonNumber ?? null
        });
        const playback = resolveTheaterPlaybackFn(fresh, getPersonalVideosFn());
        logTheaterHandshakeFn(fresh, playback);
        logTheater('openTheaterReel', {
            reelId: fresh.id,
            mode: playback?.mode,
            url: playback?.url?.slice?.(0, 80),
            isPlaceholder: fresh.isPlaceholder
        });
        if (import.meta.env.DEV || DEBUG_THEATER) {
            tick().then(() => {
                const videoEl = document.querySelector('[data-theater-video]');
                logTheaterHandshakeFn(fresh, playback, { videoInDom: Boolean(videoEl) });
                checkTheaterVideoMount();
            });
        }
    }

    export async function checkTheaterVideoMount() {
        if (!DEBUG_THEATER) return;
        const theaterContainer = document.querySelector('[data-theater-container]');
        const videoEl = document.querySelector('.theater-video');
        logTheater('🔍 Mount check', {
            theaterContainerExists: !!theaterContainer,
            videoElementExists: !!videoEl,
            videoParent: videoEl?.parentElement?.className,
            display: videoEl ? getComputedStyle(videoEl).display : null,
            visibility: videoEl ? getComputedStyle(videoEl).visibility : null,
            opacity: videoEl ? getComputedStyle(videoEl).opacity : null,
            zIndex: videoEl ? getComputedStyle(videoEl).zIndex : null,
            readyState: videoEl?.readyState,
            networkState: videoEl?.networkState,
            error: videoEl?.error,
            src: videoEl?.currentSrc || videoEl?.src,
            paused: videoEl?.paused
        });
    }

    /** @param {HTMLElement} node */
    export function theaterVideoMount(node) {
        theaterManager.setVideoElement(node);
        logTheaterMedia({
            phase: 'mount',
            reelId: get(activeReel)?.id ?? null,
            src: node.currentSrc || node.src,
            readyState: node.readyState
        });
        logTheater('📺 Theater video mounted', { src: node.currentSrc || node.src });
        tick().then(() => {
            node.play?.().catch((err) => {
                logTheaterMedia({ phase: 'autoplay-blocked', message: err?.message, reelId: get(activeReel)?.id ?? null });
                logTheater('autoplay blocked', { message: err?.message });
            });
            checkTheaterVideoMount();
        });
        return {
            destroy() {
                if (theaterManager.videoElement === node) theaterManager.videoElement = null;
            }
        };
    }

    /** @param {Event} event */
    export function handleTheaterVideoError(event) {
        theaterPlaybackError.set(true);
        const src = event.currentTarget?.currentSrc || event.currentTarget?.src;
        const mediaError = event.currentTarget?.error;
        logTheater('❌ Theater video error', { src, code: mediaError?.code, message: mediaError?.message });
        console.warn('[theater] Video failed to load/decode:', {
            src,
            code: mediaError?.code,
            message: mediaError?.message
        });
        event.currentTarget?.pause?.();
    }

    /** @param {HTMLVideoElement} el */
    export function theaterWatchOnPlay(el) {
        watchOnPlayFn(el);
    }

    /** @param {HTMLVideoElement} el */
    export function theaterWatchOnPause(el) {
        watchOnPauseFn(el);
    }

    /** @param {unknown} reel */
    export function reuploadBrokenReel(reel) {
        if (!reel) return;
        theaterManager.close();
        if (reel.id) reuploadDeps.deleteProduction(reel.id);
        reuploadDeps.openControlCenter();
        reuploadDeps.setUploadStatus('⚠️ Re-upload a valid MP4/MOV file in Smart Studio');
        reuploadDeps.scheduleStandby();
    }
</script>

<script>
    import MediaRenderer from '../media/MediaRenderer.svelte';
    import MediaThumbnail from '../media/MediaThumbnail.svelte';
    import ReelshortExperience from '../vertical/ReelshortExperience.svelte';
    import { theaterSwipe } from '../../lib/vertical/theaterSwipe.js';
    import { resolveDisplayUrl, resolveMediaForRender } from '../media/resolveDisplayUrl.js';
    import {
        theaterFraming,
        setTheaterFraming,
        FRAMING_MODES
    } from '../../lib/theater/theaterFraming.js';
    import { logFinalMediaUrl, videoMimeForPath } from '../../lib/config.js';
    import { isVideoReel } from '../../lib/api/reelContract.js';
    import { resolveTheaterPlayback } from '../../lib/media/theaterPlayback.js';
    import SeriesDrawer from '../series/SeriesDrawer.svelte';
    import TheaterSeriesPanel from '../series/TheaterSeriesPanel.svelte';
    import TheaterSeriesMetadata from '../publishing/TheaterSeriesMetadata.svelte';
    import { reelSeriesMetadata, getSeriesById } from '../../lib/series/seriesStore.js';

    /** @type {import('svelte/store').Readable<unknown[]>} */
    export let personalVideos;
    /** @type {Record<string, unknown>} */
    export let UIAgent = {};
    /** @type {{ getFallbackImage: () => string }} */
    export let AI_IMAGE_GENERATOR = { getFallbackImage: () => '' };
    /** @type {(img: HTMLImageElement, src: string) => void} */
    export let logVaultImageError = () => {};

    let theaterPlayback = null;
    let theaterVideoSrc = null;
    let theaterVideoMime = null;
    let theaterVideoKey = '';
    let theaterBgVideo = null;
    let seriesDrawerOpen = false;
    let selectedSeriesEpisodeId = '';
    let episodeNavNotice = '';

    /** Featured catalog used when the active reel has no series bridge yet. */
    const DEFAULT_THEATER_SERIES_ID = 'series-neon-vengeance';

    $: seriesContext = ($reelSeriesMetadata, $activeReel ? resolveSeriesContextForReel($activeReel) : null);
    $: hasSeriesMetadata = Boolean(seriesContext);
    $: seriesId = seriesContext?.series.id ?? '';
    $: drawerSeriesId =
        seriesId && getSeriesById(seriesId)
            ? seriesId
            : getSeriesById(DEFAULT_THEATER_SERIES_ID)
              ? DEFAULT_THEATER_SERIES_ID
              : '';
    $: hasSeriesDrawer = Boolean(drawerSeriesId);
    /** Episodes pop-out lives in the header next to framing controls — always on when catalog exists. */
    $: showSeriesDrawerControl = hasSeriesDrawer;
    $: if (seriesContext) selectedSeriesEpisodeId = seriesContext.episode.episodeId;
    $: if (!$activeReel) {
        seriesDrawerOpen = false;
        selectedSeriesEpisodeId = '';
        episodeNavNotice = '';
    }

    /** @param {CustomEvent<{ episodeId: string }>} event */
    function handleSeriesEpisodeSelect(event) {
        const episodeId = event.detail.episodeId;
        selectedSeriesEpisodeId = episodeId;
        const navigated = navigateFromDrawer(episodeId);
        if (navigated) {
            seriesDrawerOpen = false;
            episodeNavNotice = '';
            return;
        }
        episodeNavNotice = 'No playable reel is linked to that episode yet.';
    }

    function openSeriesDrawer() {
        seriesDrawerOpen = true;
        episodeNavNotice = '';
    }

    /** @param {HTMLVideoElement | null | undefined} fg */
    function syncTheaterBgVideo(fg) {
        const bg = theaterBgVideo;
        if (!bg || !fg || $theaterFraming !== 'smart') return;
        try {
            if (fg.paused) {
                if (!bg.paused) bg.pause();
            } else if (bg.paused) {
                bg.play().catch(() => {});
            }
            if (Math.abs(bg.currentTime - fg.currentTime) > 0.25) {
                bg.currentTime = fg.currentTime;
            }
        } catch (_) {
            /* sync best-effort */
        }
    }

    $: theaterPlayback =
        $activeReel && ($activeReel.isPlaceholder || $activeReel.isBlackStoriesPlaceholder)
            ? resolveTheaterPlayback($activeReel, $personalVideos)
            : null;
    $: theaterVideoSrc =
        $activeReel && isVideoReel($activeReel) && !$activeReel.isPlaceholder && !$activeReel.isBlackStoriesPlaceholder
            ? $activeReel.url
            : theaterPlayback?.mode === 'video'
              ? theaterPlayback.url
              : null;
    $: theaterVideoMime = theaterVideoSrc ? videoMimeForPath(theaterVideoSrc) : null;
    $: theaterBgSrc = theaterVideoSrc
        ? resolveMediaForRender(theaterVideoSrc, 'video', 'TheaterExperience:bg')
        : '';
    $: theaterVideoKey = theaterVideoSrc
        ? `${theaterVideoSrc}|${$activeReel?.id || ''}|${$theaterRetryNonce}`
        : '';

    $: if (theaterVideoSrc) {
        logFinalMediaUrl('theater-video', resolveDisplayUrl(theaterVideoSrc, 'video', 'theater-video'));
    }
    $: if ($activeReel?.thumbnailUrl || theaterPlayback?.poster) {
        const theaterPoster = $activeReel?.thumbnailUrl || theaterPlayback?.poster;
        logFinalMediaUrl(
            'theater-poster',
            theaterPoster ? resolveDisplayUrl(theaterPoster, 'poster', 'theater-poster') : ''
        );
    }
    $: if ($activeReel) {
        theaterPlaybackError.set(false);
        if (DEBUG_THEATER || import.meta.env.DEV) {
            logTheater('➡️ Theater opened', {
                mode: theaterPlayback?.mode,
                source: theaterPlayback?.source,
                theaterVideoSrc,
                linkedName: theaterPlayback?.linkedName,
                reelType: $activeReel.type,
                isPlaceholder: $activeReel.isPlaceholder,
                isPersonalVideo: $activeReel.isPersonalVideo,
                playableUrlFirst: isVideoReel($activeReel)
            });
            if (DEBUG_THEATER) setTimeout(() => checkTheaterVideoMount(), 100);
        }
    }
    $: if (DEBUG_THEATER && $activeReel) {
        console.group('🔄 Theater reactive dependencies');
        console.log('theaterPlayback:', theaterPlayback);
        console.log('theaterVideoSrc:', theaterVideoSrc);
        console.log('activeReel.url:', $activeReel?.url);
        console.log('activeReel.type:', $activeReel?.type);
        console.log('theaterVideoKey:', theaterVideoKey);
        console.groupEnd();
    }
</script>

{#if $activeReel}
    <div
        class="theater-overlay"
        role="button"
        tabindex="-1"
        aria-label="Close theater"
        on:click={(e) => { if (e.target === e.currentTarget) theaterManager.close(); }}
        on:keydown={(e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (seriesDrawerOpen) {
                    seriesDrawerOpen = false;
                    return;
                }
                theaterManager.close();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                theaterManager.close();
            }
        }}
    >
        <div
            class="theater-container"
            class:reelshort-theater={$theaterChromeFlags.immersive916}
            class:publishing-immersive={$theaterChromeFlags.hideMetaPanel}
            class:publishing-profile-netflix={$activePublishingProfile === 'netflix'}
            class:publishing-profile-reelshort={$activePublishingProfile === 'reelshort'}
            class:publishing-profile-dramabox={$activePublishingProfile === 'dramabox'}
            class:publishing-profile-youtube-series={$activePublishingProfile === 'youtube-series'}
            class:framing-fill={$theaterFraming === 'fill'}
            class:framing-fit={$theaterFraming === 'fit'}
            class:framing-smart={$theaterFraming === 'smart'}
            data-theater-container
            style={DEBUG_THEATER ? 'outline: 2px dashed red; position: relative;' : ''}
            use:theaterSwipe={{ enabled: $episodeNavigationFlags.swipeUpNext, onSwipeUp: navigateOnSwipeUp }}
        >
            <ReelshortExperience
                section="theater-ambient"
                {theaterVideoSrc}
                activeReel={$activeReel}
                {theaterPlayback}
            />
            <div class="theater-glow-border"></div>
            <div class="theater-header">
                <div class="theater-header-main">
                    {#if $metadataDisplayFlags.showReelTitle}
                        <h2 class="theater-title">{$activeReel.name || $activeReel.title}</h2>
                    {/if}
                    {#if hasSeriesMetadata && seriesContext}
                        <TheaterSeriesMetadata {seriesContext} />
                    {/if}
                </div>
                <div class="theater-header-actions">
                    {#if showSeriesDrawerControl}
                        <button
                            type="button"
                            class="theater-series-btn"
                            aria-label="Browse series episodes"
                            on:click|stopPropagation={openSeriesDrawer}
                        >{$episodeNavigationFlags.episodesButtonLabel || 'Episodes'}</button>
                    {/if}
                    <div class="theater-framing-controls" role="group" aria-label="Video framing mode">
                        {#each FRAMING_MODES as mode}
                            <button
                                type="button"
                                class="theater-framing-btn"
                                class:active={$theaterFraming === mode}
                                aria-pressed={$theaterFraming === mode}
                                title="Framing: {mode}"
                                on:click|stopPropagation={() => setTheaterFraming(mode)}
                            >{mode}</button>
                        {/each}
                    </div>
                    <button class="theater-close-btn" on:click={(e) => { e.stopPropagation(); theaterManager.close(); }}>✕ CLOSE</button>
                </div>
            </div>
            {#if theaterVideoSrc && !$theaterPlaybackError}
                <div
                    class="theater-video-wrapper"
                    class:reelshort-video-wrap={$theaterChromeFlags.immersive916}
                    class:framing-fill={$theaterFraming === 'fill'}
                    class:framing-fit={$theaterFraming === 'fit'}
                    class:framing-smart={$theaterFraming === 'smart'}
                >
                    {#key theaterVideoKey}
                        {#if $theaterFraming === 'smart' && theaterBgSrc}
                            <video
                                class="theater-video-bg"
                                bind:this={theaterBgVideo}
                                muted
                                playsinline
                                autoplay
                                preload="auto"
                                aria-hidden="true"
                                tabindex="-1"
                            >
                                <source src={theaterBgSrc} type={theaterVideoMime} />
                            </video>
                        {/if}
                        <MediaRenderer
                            type="video"
                            url={theaterVideoSrc}
                            poster={$activeReel.thumbnailUrl || theaterPlayback?.poster}
                            className="theater-video theater-video-fg"
                            dataTheaterVideo={true}
                            action={theaterVideoMount}
                            mimeType={theaterVideoMime}
                            useSourceElement={true}
                            preload="auto"
                            autoplay
                            muted
                            controls
                            playsinline
                            on:ended={handleTheaterEnded}
                            on:timeupdate={(e) => {
                                handleTheaterTimeupdate(e);
                                syncTheaterBgVideo(e.currentTarget);
                            }}
                            on:play={(e) => {
                                logTheaterMedia({
                                    phase: 'play',
                                    reelId: get(activeReel)?.id ?? null,
                                    currentTime: e.currentTarget.currentTime,
                                    paused: e.currentTarget.paused
                                });
                                logTheater('▶️ Theater video play');
                                theaterWatchOnPlay(e.currentTarget);
                                syncTheaterBgVideo(e.currentTarget);
                            }}
                            on:pause={(e) => {
                                theaterWatchOnPause(e.currentTarget);
                                syncTheaterBgVideo(e.currentTarget);
                            }}
                            on:seeked={(e) => syncTheaterBgVideo(e.currentTarget)}
                            on:error={handleTheaterVideoError}
                            on:loadedmetadata={(e) => {
                                theaterPlaybackError.set(false);
                                resetTheaterTimeline();
                                syncTheaterBgVideo(e.currentTarget);
                                logTheaterMedia({
                                    phase: 'loadedmetadata',
                                    reelId: get(activeReel)?.id ?? null,
                                    duration: e.currentTarget.duration,
                                    videoWidth: e.currentTarget.videoWidth,
                                    videoHeight: e.currentTarget.videoHeight,
                                    framing: $theaterFraming
                                });
                                logTheater('🎞️ Theater metadata loaded', {
                                    duration: e.currentTarget.duration,
                                    videoWidth: e.currentTarget.videoWidth,
                                    videoHeight: e.currentTarget.videoHeight,
                                    framing: $theaterFraming
                                });
                            }}
                            on:loadeddata={() => {
                                logTheaterMedia({ phase: 'loadeddata', reelId: get(activeReel)?.id ?? null, url: theaterVideoSrc });
                                logTheater('✅ Theater video data loaded', { url: theaterVideoSrc });
                            }}
                            on:click={(e) => e.stopPropagation()}
                        />
                    {/key}
                    <ReelshortExperience section="theater-chrome" />
                </div>
                {#if theaterPlayback?.source === 'vault-link'}
                    <p class="theater-vault-link-notice">▶ Playing linked vault episode for this placeholder</p>
                {/if}
            {:else if theaterPlayback?.mode === 'image' && theaterPlayback.url}
                <div class="theater-image-wrapper">
                    <MediaThumbnail
                        url={theaterPlayback.url}
                        alt={$activeReel.name || $activeReel.title}
                        className="theater-full-image"
                        on:error={(e) => logVaultImageError(e.currentTarget, $activeReel.url)}
                    />
                </div>
            {:else}
                <div class="theater-placeholder">
                    <div class="placeholder-content">
                        <div class="placeholder-icon">{$theaterPlaybackError ? '⚠️' : '🎬'}</div>
                        <h3>{$theaterPlaybackError ? 'Video Unavailable' : 'No Video Available'}</h3>
                        <p>{$theaterPlaybackError ? 'This file could not be decoded. It may be corrupt, HTML disguised as video, or not a valid MP4/MOV.' : 'This is a placeholder reel or AI-generated content'}</p>
                        {#if $activeReel.thumbnailUrl}
                            <MediaThumbnail
                                url={$activeReel.thumbnailUrl}
                                alt={$activeReel.name || $activeReel.title}
                                className="placeholder-thumbnail"
                                on:error={(e) => logVaultImageError(e.currentTarget, $activeReel.thumbnailUrl)}
                            />
                        {/if}
                        {#if $theaterPlaybackError}
                            <button class="theater-reupload-btn" on:click|stopPropagation={() => reuploadBrokenReel($activeReel)}>Re-upload Video</button>
                            <button
                                class="theater-reupload-btn"
                                on:click|stopPropagation={() => {
                                    theaterPlaybackError.set(false);
                                    theaterRetryNonce.update((n) => n + 1);
                                    logTheater('🔄 Retry theater video');
                                }}
                            >Retry playback</button>
                        {/if}
                        {#if theaterVideoSrc}
                            <a class="theater-open-tab" href={theaterVideoSrc} target="_blank" rel="noopener noreferrer" on:click|stopPropagation>Open video in new tab</a>
                        {/if}
                    </div>
                </div>
            {/if}
            {#if !$theaterChromeFlags.hideMetaPanel}
                {#if hasSeriesMetadata && seriesContext}
                    <TheaterSeriesPanel
                        {seriesContext}
                        showEpisodeList={showSeriesDrawerControl}
                        on:episodes={openSeriesDrawer}
                    />
                {:else}
                    <div class="theater-meta">
                        <div class="meta-row">
                            <span class="meta-label">Category:</span>
                            <span class="meta-value" style="color: {UIAgent.getStudioConfigs($activeReel.category).color}">{$activeReel.category}</span>
                        </div>
                        {#if $activeReel.auto_detected}
                            <div class="auto-detect-notice"><span>🤖 Smart-placed in: <strong>{$activeReel.category}</strong> ({$activeReel.detection_confidence || 'High'} confidence)</span></div>
                        {/if}
                        {#if $activeReel.isPersonalThumbnail}
                            <div class="personal-thumbnail-notice"><span>🖼️ Personal thumbnail from your collection</span></div>
                        {/if}
                        {#if $activeReel.isPersonalVideo}
                            <div class="personal-video-notice"><span>🎬 Personal video from your vault</span></div>
                        {/if}
                        {#if $activeReel.faces?.length > 0}
                            <div class="face-characters">
                                <h4>Black Characters Detected:</h4>
                                <div class="character-grid">
                                    {#each $activeReel.faces as face}
                                        {@const faceUrl = face.thumbnail || face.faceData || AI_IMAGE_GENERATOR.getFallbackImage()}
                                        <div class="character-item">
                                            <MediaThumbnail
                                                url={faceUrl}
                                                alt={face.character_name}
                                                className="character-thumb"
                                                raw={faceUrl.startsWith('data:') || faceUrl.startsWith('blob:')}
                                            />
                                            <span>{face.character_name}</span>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                        <div class="theater-stats">
                            {#if $activeReel.views}<span class="stat-item">👁️ {$activeReel.views}k views</span>{/if}
                            {#if $activeReel.likes}<span class="stat-item">❤️ {$activeReel.likes} likes</span>{/if}
                            {#if $activeReel.created_at}<span class="stat-item">📅 Added {new Date($activeReel.created_at).toLocaleDateString()}</span>{/if}
                        </div>
                    </div>
                {/if}
            {/if}
            {#if !$theaterChromeFlags.hideBottomClose}
            <button class="theater-close-btn-bottom" on:click={(e) => { e.stopPropagation(); theaterManager.close(); }}>✕ CLOSE THEATER (ESC)</button>
            {/if}
            {#if episodeNavNotice}
                <p class="theater-episode-nav-notice" role="status">{episodeNavNotice}</p>
            {/if}
        </div>
        {#if hasSeriesDrawer}
            <SeriesDrawer
                bind:open={seriesDrawerOpen}
                seriesId={drawerSeriesId}
                selectedEpisodeId={selectedSeriesEpisodeId}
                on:episodeSelect={handleSeriesEpisodeSelect}
            />
        {/if}
    </div>
{/if}
{#if DEBUG_THEATER}
    <div class="theater-debug-overlay" aria-hidden="true">
        <strong>🎭 Theater Debug</strong><br />
        Playback: {theaterPlayback?.mode} ({theaterPlayback?.source || 'n/a'})<br />
        Video URL: {theaterVideoSrc ? `${theaterVideoSrc.slice(0, 56)}…` : '—'}<br />
        Key: {theaterVideoKey || '—'}<br />
        Error: {$theaterPlaybackError ? 'yes' : 'no'}<br />
        <button type="button" on:click={checkTheaterVideoMount}>Run mount check</button>
    </div>
{/if}

<style>
    .theater-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.95);
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        backdrop-filter: blur(10px);
    }
    .theater-container {
        width: 100%;
        max-width: 450px;
        max-height: 90vh;
        position: relative;
        background: rgba(20, 20, 20, 0.8);
        border-radius: 12px;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
    }
    .theater-glow-border {
        position: absolute;
        inset: -2px;
        border-radius: 14px;
        background: linear-gradient(45deg, var(--neon-cyan), var(--neon-pink), var(--neon-gold), var(--neon-cyan));
        background-size: 400% 400%;
        z-index: -1;
        animation: glowRotate 3s ease infinite;
        opacity: 0.8;
    }
    @keyframes glowRotate {
        0% {
            background-position: 0% 50%;
        }
        50% {
            background-position: 100% 50%;
        }
        100% {
            background-position: 0% 50%;
        }
    }
    .theater-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.75rem;
        margin-bottom: 1rem;
        position: relative;
        z-index: 1;
    }
    .theater-header-main {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        min-width: 0;
        flex: 1;
    }
    .theater-series-btn {
        padding: 0.45rem 0.75rem;
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        border-radius: 4px;
        border: 1px solid rgba(255, 0, 255, 0.45);
        background: rgba(255, 0, 255, 0.12);
        color: #fff;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
    }
    .theater-series-btn:hover {
        background: rgba(255, 0, 255, 0.28);
        border-color: var(--neon-pink, #ff00ff);
    }
    .theater-header-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-shrink: 0;
        flex-wrap: wrap;
        justify-content: flex-end;
    }
    .theater-framing-controls {
        display: flex;
        gap: 0.25rem;
        padding: 0.15rem;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .theater-framing-btn {
        padding: 0.25rem 0.5rem;
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        border: 1px solid transparent;
        border-radius: 4px;
        background: transparent;
        color: rgba(255, 255, 255, 0.65);
        cursor: pointer;
        transition: all 0.2s ease;
    }
    .theater-framing-btn:hover {
        color: #fff;
        border-color: rgba(255, 255, 255, 0.2);
    }
    .theater-framing-btn.active {
        color: #000;
        background: var(--neon-cyan);
        border-color: var(--neon-cyan);
    }
    .theater-title {
        font-size: 1.5rem;
        margin: 0;
        text-shadow: 0 0 20px rgba(0, 242, 255, 0.5);
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        max-width: 80%;
    }
    .theater-close-btn {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        padding: 0.5rem 1rem;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.3s;
    }
    .theater-close-btn:hover {
        background: rgba(229, 9, 20, 0.8);
        border-color: var(--neon-red);
    }
    .theater-video-wrapper {
        position: relative;
        width: 100%;
        background: #000;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 0 40px rgba(0, 242, 255, 0.3);
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 200px;
    }
    .theater-video-bg {
        position: absolute;
        inset: -8%;
        width: 116%;
        height: 116%;
        object-fit: cover;
        transform: scale(1.12);
        filter: blur(28px) brightness(0.55);
        z-index: 0;
        pointer-events: none;
    }
    .theater-video-wrapper :global(.theater-video-fg) {
        position: relative;
        z-index: 2;
        width: 100%;
        height: auto;
        max-height: 70vh;
        object-fit: contain;
        background: transparent;
    }
    .theater-video-wrapper.framing-fit :global(.theater-video-fg) {
        object-fit: contain;
    }
    .theater-video-wrapper.framing-fill :global(.theater-video-fg) {
        width: 100%;
        height: 100%;
        max-height: none;
        object-fit: cover;
    }
    .theater-video-wrapper.framing-smart {
        min-height: 240px;
    }
    .theater-video-wrapper.framing-smart :global(.theater-video-fg) {
        width: 100%;
        height: 100%;
        max-height: 70vh;
        object-fit: contain;
    }
    :global(.reelshort-theater) .theater-video-wrapper.framing-fill,
    :global(.reelshort-theater) .theater-video-wrapper.framing-smart {
        flex: 1;
        min-height: 0;
        max-height: none;
    }
    :global(.reelshort-theater) .theater-video-wrapper.framing-fill :global(.theater-video-fg),
    :global(.reelshort-theater) .theater-video-wrapper.framing-smart :global(.theater-video-fg) {
        max-height: none;
        height: 100%;
    }
    :global(.reelshort-theater.framing-smart .theater-ambient-bg) {
        display: none;
    }
    .theater-image-wrapper {
        width: 100%;
        background: #000;
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 240px;
    }
    :global(.theater-full-image) {
        width: 100%;
        max-height: 70vh;
        object-fit: contain;
        background: #1a1a1a;
    }
    .theater-reupload-btn {
        margin-top: 1rem;
        padding: 0.75rem 1.25rem;
        background: rgba(0, 242, 255, 0.15);
        border: 1px solid var(--neon-cyan);
        color: var(--neon-cyan);
        border-radius: 4px;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 1px;
    }
    .theater-reupload-btn:hover {
        background: var(--neon-cyan);
        color: #000;
    }
    .theater-placeholder {
        aspect-ratio: 9/16;
        background: #1a1a1a;
        border-radius: 8px;
        display: grid;
        place-items: center;
        text-align: center;
        box-shadow: 0 0 40px rgba(255, 0, 255, 0.2);
    }
    .placeholder-content {
        padding: 2rem;
    }
    .placeholder-icon {
        font-size: 4rem;
        margin-bottom: 1rem;
        filter: drop-shadow(0 0 20px rgba(0, 242, 255, 0.5));
    }
    :global(.placeholder-thumbnail) {
        max-width: 300px;
        margin-top: 1rem;
        border-radius: 8px;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
    }
    .theater-meta {
        margin-top: 1.5rem;
        padding: 1rem;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .meta-row {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }
    .meta-label {
        color: rgba(255, 255, 255, 0.5);
    }
    .auto-detect-notice,
    .personal-thumbnail-notice,
    .personal-video-notice {
        padding: 0.5rem;
        background: rgba(0, 242, 255, 0.1);
        border-radius: 4px;
        margin-top: 0.5rem;
        font-size: 0.875rem;
        border-left: 3px solid var(--neon-cyan);
    }
    .theater-stats {
        display: flex;
        gap: 1rem;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        flex-wrap: wrap;
    }
    .stat-item {
        font-size: 0.875rem;
        color: rgba(255, 255, 255, 0.6);
    }
    .theater-close-btn-bottom {
        width: 100%;
        margin-top: 1rem;
        padding: 1rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.3s;
        text-transform: uppercase;
        letter-spacing: 2px;
    }
    .theater-close-btn-bottom:hover {
        background: rgba(229, 9, 20, 0.8);
        border-color: var(--neon-red);
    }
    .theater-vault-link-notice {
        margin-top: 0.5rem;
        font-size: 0.8rem;
        color: var(--neon-cyan);
        text-align: center;
    }
    .theater-open-tab {
        display: inline-block;
        margin-top: 0.75rem;
        color: var(--neon-cyan);
        font-size: 0.85rem;
    }
    .theater-episode-nav-notice {
        margin: 0.75rem 0 0;
        padding: 0.55rem 0.75rem;
        border-radius: 6px;
        font-size: 0.78rem;
        text-align: center;
        color: #fbbf24;
        background: rgba(251, 191, 36, 0.1);
        border: 1px solid rgba(251, 191, 36, 0.35);
    }
    .theater-debug-overlay {
        position: fixed;
        bottom: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.85);
        color: lime;
        padding: 8px 10px;
        font-family: monospace;
        z-index: 9999;
        max-width: 420px;
        font-size: 11px;
        line-height: 1.45;
        border: 1px solid rgba(0, 255, 0, 0.35);
        border-radius: 6px;
        pointer-events: auto;
    }
    .theater-debug-overlay button {
        margin-top: 6px;
        padding: 4px 8px;
        background: #111;
        color: lime;
        border: 1px solid lime;
        cursor: pointer;
        font-size: 11px;
    }
</style>
