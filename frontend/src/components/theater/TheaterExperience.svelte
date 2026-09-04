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
        buildSeriesViewFromRelated,
        resolveRelatedEpisodes
    } from '../../lib/series/resolveRelatedEpisodes.js';
    import { getReadyHeroVaultAssets } from '../../lib/series/heroVaultAssetSource.js';
    import {
        resolveLinkedAssetDisplayTitle,
        UNTITLED_CREATOR_EXPERIENCE
    } from '../../lib/hero/heroTitleIntelligence.js';
    import {
        activePublishingProfile,
        episodeNavigationFlags,
        metadataDisplayFlags,
        theaterChromeFlags
    } from '../../lib/publishing/publishingProfileStore.js';
    import {
        logTheaterClose,
        logTheaterControls,
        logTheaterMedia,
        logTheaterOpen,
        logTheaterState
    } from '../../lib/theater/theaterDiagnostics.js';
    import {
        attachTheaterPlaybackDiagnostics,
        inspectTheaterPlaybackElements,
        logTheaterPlaybackPhase
    } from '../../lib/theater/theaterPlaybackDiagnostics.js';
    import {
        beginTheaterExclusiveSession,
        hardUnloadVideoElement,
        pauseCompetingPageVideos,
        resumeCompetingPageVideos
    } from '../../lib/theater/theaterExclusivePlayback.js';
    import {
        enrichReelForTheaterPlayback,
        stampReadyPlaybackDerivative,
        getMasterMediaUrl
    } from '../../lib/media/resolvePlayableMediaUrl.js';
    import { logMobilePlayTrace } from '../../lib/device/mobileExperienceDiagnostics.js';
    import { setTheaterProtectedMaster } from '../../lib/media/playbackOwnership.js';

    export {
        activePublishingProfile,
        episodeNavigationFlags,
        metadataDisplayFlags,
        theaterChromeFlags
    };

    export const activeReel = writable(null);
    export const theaterPlaybackError = writable(false);
    export const theaterRetryNonce = writable(0);

    /** Live Master Edit bus → open Theater must not keep a stale title snapshot. */
    let vaultTitleTheaterHooked = false;
    function ensureVaultTitleTheaterHook() {
        if (vaultTitleTheaterHooked || typeof window === 'undefined') return;
        vaultTitleTheaterHooked = true;
        window.addEventListener('reelforge:vault-title-updated', (event) => {
            const detail = /** @type {CustomEvent} */ (event)?.detail || {};
            const reelId = String(detail.reelId || '').trim();
            const nextTitle = String(detail.newTitle || detail.title || '').trim();
            if (!reelId || !nextTitle) return;
            const current = get(activeReel);
            if (!current || String(current.id || '').trim() !== reelId) return;
            activeReel.set({
                ...current,
                title: nextTitle,
                name: nextTitle,
                title_original: nextTitle
            });
        });
    }
    ensureVaultTitleTheaterHook();

    export const DEBUG_THEATER =
        typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'theater';

    let resourceManagerRef = null;
    /** @type {null | (() => void)} */
    let disposeTheaterPlaybackDiag = null;
    let watchOnExitFn = () => {};
    let watchOnCompleteFn = () => {};
    let watchOnPlayFn = () => {};
    let watchOnPauseFn = () => {};
    let watchOnProgressFn = () => {};
    let watchApplyResumeFn = () => {};
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
        if (deps.watchOnProgress) watchOnProgressFn = deps.watchOnProgress;
        if (deps.watchApplyResume) watchApplyResumeFn = deps.watchApplyResume;
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
            if (typeof disposeTheaterPlaybackDiag === 'function') {
                disposeTheaterPlaybackDiag();
                disposeTheaterPlaybackDiag = null;
            }
            const el = this.videoElement;
            if (el) {
                watchOnExitFn(el);
                hardUnloadVideoElement(/** @type {HTMLVideoElement} */ (el));
                this.videoElement = null;
            }
            resourceManagerRef?.cleanupAllBlobs?.();
            activeReel.set(null);
            // Best-effort: free bandwidth for page/hero media again after exclusive Theater session.
            resumeCompetingPageVideos();
            // Hero background reclaim is handled by HeroExperience remount / load handlers.
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

    /**
     * Build the Theater reel with feed+vault + ready playback derivative fields.
     * Ready playbackUrl must be present before MediaRenderer attaches a source.
     * @param {Record<string, unknown> | null | undefined} reel
     * @returns {Record<string, unknown> | null}
     */
    export function enrichTheaterReelForPlayback(reel) {
        if (!reel || typeof reel !== 'object') return null;
        const reelId = reel.id != null ? String(reel.id) : '';
        const fromFeed = reelId ? findReelInFeedFn(reelId) : null;
        const vaultList = getPersonalVideosFn() || [];
        const vaultHit = reelId
            ? vaultList.find((v) => String(v?.id || '') === reelId)
            : null;
        return enrichReelForTheaterPlayback(reel, [fromFeed, vaultHit]);
    }

    /** @param {unknown} reel */
    export function openTheaterReel(reel) {
        if (!reel) {
            logTheaterOpen(null, { aborted: true, reason: 'no-reel' });
            logMobilePlayTrace('OPEN_THEATER_REEL_ABORTED', {
                resolver: 'TheaterExperience.openTheaterReel',
                reason: 'no-reel',
                playCalled: false
            });
            return;
        }
        logTheaterOpen(reel, { source: 'openTheaterReel', activeReelBefore: get(activeReel)?.id ?? null });
        logMobilePlayTrace('OPEN_THEATER_REEL', {
            assetId: String(/** @type {Record<string, unknown>} */ (reel)?.id || '').trim(),
            title: String(
                /** @type {Record<string, unknown>} */ (reel)?.title ||
                    /** @type {Record<string, unknown>} */ (reel)?.name ||
                    ''
            ).trim(),
            mediaUrl: String(
                /** @type {Record<string, unknown>} */ (reel)?.url ||
                    /** @type {Record<string, unknown>} */ (reel)?.playbackUrl ||
                    /** @type {Record<string, unknown>} */ (reel)?.mediaUrl ||
                    ''
            ).trim(),
            resolver: 'TheaterExperience.openTheaterReel',
            source: 'openTheaterReel',
            playCalled: false
        });
        clearTheaterCountdown();
        resetTheaterTimeline();
        // Phase 1: own bandwidth + unload hero/preview masters BEFORE any Theater <video> src binds.
        beginTheaterExclusiveSession('theater-open-before-attach');

        let fresh = enrichTheaterReelForPlayback(/** @type {Record<string, unknown>} */ (reel));
        if (!fresh) {
            logMobilePlayTrace('OPEN_THEATER_REEL_ENRICH_FAILED', {
                assetId: String(/** @type {Record<string, unknown>} */ (reel)?.id || '').trim(),
                resolver: 'enrichTheaterReelForPlayback',
                reason: 'enrich-returned-null',
                playCalled: false
            });
            return;
        }

        const seriesCtx = resolveSeriesContextForReel(fresh);
        if (seriesCtx) {
            fresh = applyEpisodeFieldsToReel(fresh, seriesCtx);
        }
        // Master Edit: Theater must not keep snapshot titles from package/feed/vault harvest.
        const reelId = String(fresh?.id || reel?.id || '').trim();
        if (reelId) {
            const canonical = resolveLinkedAssetDisplayTitle(reelId, {
                episodeTitle: String(
                    seriesCtx?.episode?.title ||
                        /** @type {{ _episodePackageTitle?: string }} */ (reel)._episodePackageTitle ||
                        ''
                ),
                assetTitle: String(fresh?.title || fresh?.name || reel?.title || reel?.name || ''),
                fileName: String(fresh?.fileName || fresh?.file_name || '')
            });
            if (canonical && canonical !== UNTITLED_CREATOR_EXPERIENCE) {
                fresh = {
                    ...fresh,
                    title: canonical,
                    name: canonical,
                    title_original: canonical
                };
            }
        }
        // Re-stamp after episode/title overlays so remount cannot drop a known ready pair.
        fresh = stampReadyPlaybackDerivative(fresh);
        setTheaterProtectedMaster(String(fresh?.id || ''), getMasterMediaUrl(fresh));
        // Re-assert exclusive unload now that the owned master identity is known.
        pauseCompetingPageVideos();
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
        logMobilePlayTrace('OPEN_THEATER_REEL_SET_ACTIVE', {
            assetId: String(fresh.id || '').trim(),
            title: String(fresh.title || fresh.name || '').trim(),
            mediaUrl: String(playback?.url || getMasterMediaUrl(fresh) || '').trim(),
            resolver: 'TheaterExperience.openTheaterReel.setActive',
            source: String(playback?.mode || 'unknown'),
            viewerOpen: true,
            playCalled: false
        });
        tick().then(() => {
            const videoEl = document.querySelector('[data-theater-video]');
            logMobilePlayTrace('OPEN_THEATER_REEL_AFTER_TICK', {
                assetId: String(fresh.id || '').trim(),
                title: String(fresh.title || '').trim(),
                mediaUrl: String(playback?.url || '').trim(),
                resolver: 'TheaterExperience.openTheaterReel.afterTick',
                source: String(playback?.mode || 'unknown'),
                viewerOpen: true,
                videoMounted: Boolean(videoEl),
                playCalled: false
            });
            if (import.meta.env.DEV || DEBUG_THEATER) {
                logTheaterHandshakeFn(fresh, playback, { videoInDom: Boolean(videoEl) });
                checkTheaterVideoMount();
            }
        });
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
        if (typeof disposeTheaterPlaybackDiag === 'function') {
            disposeTheaterPlaybackDiag();
            disposeTheaterPlaybackDiag = null;
        }
        // Re-assert exclusive unload (session already claimed in openTheaterReel).
        // Do NOT call play() here — native autoplay owns start; avoids concurrent play race.
        pauseCompetingPageVideos();
        disposeTheaterPlaybackDiag = attachTheaterPlaybackDiagnostics(
            /** @type {HTMLVideoElement} */ (node),
            { getReelId: () => get(activeReel)?.id ?? null }
        );
        logTheaterMedia({
            phase: 'mount',
            reelId: get(activeReel)?.id ?? null,
            src: node.currentSrc || node.src,
            readyState: node.readyState
        });
        logTheaterPlaybackPhase('mount', /** @type {HTMLVideoElement} */ (node), {
            reelId: get(activeReel)?.id ?? null,
            exclusive: inspectTheaterPlaybackElements()
        });
        logMobilePlayTrace('VIDEO_MOUNT', {
            assetId: String(get(activeReel)?.id || '').trim(),
            resolver: 'TheaterExperience.theaterVideoMount',
            source: 'theater-video-lifecycle',
            viewerOpen: true,
            videoMounted: true,
            playCalled: false,
            videoEl: /** @type {HTMLVideoElement} */ (node)
        });
        logTheater('📺 Theater video mounted', { src: node.currentSrc || node.src });
        if (DEBUG_THEATER || import.meta.env.DEV) {
            const insp = inspectTheaterPlaybackElements();
            logTheater('playback exclusive check', insp);
            if (insp.theaterVideos > 1 || insp.theaterSrcs.length > 1) {
                console.warn('[THEATER] multiple primary theater videos or MP4 sources', insp);
            }
        }
        const mountedEl = /** @type {HTMLVideoElement} */ (node);
        setTimeout(() => {
            if (!mountedEl.isConnected) return;
            logMobilePlayTrace('VIDEO_READY_POLL', {
                assetId: String(get(activeReel)?.id || '').trim(),
                resolver: 'TheaterExperience.theaterVideoMount.poll1s',
                source: 'theater-video-lifecycle',
                viewerOpen: true,
                videoMounted: true,
                playCalled: false,
                videoEl: mountedEl
            });
        }, 1000);
        return {
            destroy() {
                if (typeof disposeTheaterPlaybackDiag === 'function') {
                    disposeTheaterPlaybackDiag();
                    disposeTheaterPlaybackDiag = null;
                }
                // Hard-unload outgoing Theater primary so E1→E2 does not keep the old range pipeline.
                hardUnloadVideoElement(/** @type {HTMLVideoElement} */ (node));
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
        logMobilePlayTrace('VIDEO_ERROR', {
            assetId: String(get(activeReel)?.id || '').trim(),
            mediaUrl: String(src || '').trim(),
            resolver: 'TheaterExperience.handleTheaterVideoError',
            source: 'theater-video-lifecycle',
            reason: String(mediaError?.message || mediaError?.code || 'media-error'),
            viewerOpen: true,
            videoMounted: true,
            videoEl: /** @type {HTMLVideoElement} */ (event.currentTarget)
        });
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

    /** @param {HTMLVideoElement} el */
    export function theaterWatchOnProgress(el) {
        watchOnProgressFn(el);
    }

    /** @param {HTMLVideoElement} el */
    export function theaterApplyResume(el) {
        watchApplyResumeFn(el, get(activeReel)?.id);
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
    import { onMount, onDestroy } from 'svelte';
    import MediaRenderer from '../media/MediaRenderer.svelte';
    import MediaThumbnail from '../media/MediaThumbnail.svelte';
    import ReelshortExperience from '../vertical/ReelshortExperience.svelte';
    import { theaterSwipe } from '../../lib/vertical/theaterSwipe.js';
    import { resolveDisplayUrl } from '../media/resolveDisplayUrl.js';
    import {
        theaterFraming,
        setTheaterFraming,
        FRAMING_MODES
    } from '../../lib/theater/theaterFraming.js';
    import { logFinalMediaUrl, videoMimeForPath } from '../../lib/config.js';
    import { isVideoReel, isImageReel } from '../../lib/api/reelContract.js';
    import { resolveTheaterPlayback } from '../../lib/media/theaterPlayback.js';
    import {
        resolvePlayableMediaUrl,
        resolveTheaterAttachUrl
    } from '../../lib/media/resolvePlayableMediaUrl.js';
    import SeriesDrawer from '../series/SeriesDrawer.svelte';
    import TheaterSeriesPanel from '../series/TheaterSeriesPanel.svelte';
    import TheaterSeriesMetadata from '../publishing/TheaterSeriesMetadata.svelte';
    import { reelSeriesMetadata, getSeriesById, getEpisodeByReelId, seriesCatalog } from '../../lib/series/seriesStore.js';
    import {
        resolveContentIdentity,
        applyContentIdentityToSeriesContext
    } from '../../lib/content/contentIdentityResolver.js';
    import {
        detectMobileLandscapePresentation,
        detectMobilePresentation,
        subscribeMobilePresentation
    } from '../../lib/device/mobilePresentation.js';
    import {
        subscribeViewerPaidAccessEntitlement,
        resolveViewerSubscriptionUrl,
        openViewerSubscriptionCheckout,
        consumeViewerCheckoutFailureReason,
        VIEWER_CHECKOUT_FAILURE_REASONS
    } from '../../lib/series/viewerAccessEntitlement.js';
    import { resolveEpisodeAccessPricing } from '../../lib/series/episodeAccessPricing.js';

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
    /** Set when the Smart-framing poster image fails to load. */
    let theaterBgPosterFailed = false;
    let seriesDrawerOpen = false;
    let selectedSeriesEpisodeId = '';
    let episodeNavNotice = '';
    let hasAccessEntitlement = false;
    let subscriptionUrl = '';
    let pendingLockedEpisode = null;
    /** Homepage Learn More asked for All Episodes; Watch Now must not auto-dock the rail. */
    let heroCtaPendingEpisodes = false;
    let heroCtaSuppressAutoOpen = false;
    let seriesDrawerOpenIntent = '';

    /**
     * Mobile theater presentation: touch/coarse-pointer devices do not reliably show
     * native video volume chrome, and overflow:hidden can clip menu + control bars.
     * Desktop path leaves controls as always-native (no mobile chrome).
     */
    let isMobileTheater = typeof window !== 'undefined' ? detectMobilePresentation() : true;
    let isMobileLandscapeTheater =
        typeof window !== 'undefined' ? detectMobileLandscapePresentation() : false;
    /** Autoplay requires muted; after gesture, user mute state is tracked (never force-mute). */
    let theaterMuted = true;
    let theaterVolume = 1;
    let controlsVisible = true;
    let volumeVisible = true;
    let menuVisible = true;
    /** Reactive play state for mobile Play/Pause chrome (video.paused is not a Svelte store). */
    let theaterIsPlaying = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let mobileControlsHideTimer = null;
    /** Brief play/pause/seek glyph over landscape video (~400–700 ms). */
    /** @type {{ kind: 'play' | 'pause' | 'seek-back' | 'seek-forward' | 'mute' | 'unmute'; seconds?: number } | null} */
    let landscapeGestureHint = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let landscapeGestureHintTimer = null;
    /** @type {{ x: number; y: number; id: number } | null} */
    let landscapePointerStart = null;
    /** @type {number} */
    let landscapePointerDownAt = 0;
    /** @type {{ time: number; x: number; y: number } | null} */
    let landscapeLastTap = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let landscapeSingleTapTimer = null;
    const LANDSCAPE_TAP_SLOP_PX = 14;
    const LANDSCAPE_SWIPE_THRESHOLD_PX = 36;
    const LANDSCAPE_SEEK_SECONDS = 10;
    const LANDSCAPE_GESTURE_HINT_MS = 550;
    const LANDSCAPE_DOUBLE_TAP_MS = 280;

    /** @param {string} reason */
    function reportTheaterControls(reason) {
        logTheaterControls({
            deviceType: isMobileLandscapeTheater
                ? 'mobile-landscape'
                : isMobileTheater
                  ? 'mobile'
                  : 'desktop',
            isMobile: isMobileTheater,
            controlsVisible,
            volumeVisible,
            menuVisible,
            reason,
            muted: theaterMuted,
            volume: theaterVolume
        });
    }

    function syncMobileLandscapeTheaterFlag() {
        const next = detectMobileLandscapePresentation();
        if (next === isMobileLandscapeTheater) return;
        const wasLandscape = isMobileLandscapeTheater;
        isMobileLandscapeTheater = next;
        if (isMobileLandscapeTheater) {
            controlsVisible = false;
            volumeVisible = false;
            menuVisible = false;
            landscapeGestureHint = null;
            if (mobileControlsHideTimer != null) {
                clearTimeout(mobileControlsHideTimer);
                mobileControlsHideTimer = null;
            }
            if (landscapeGestureHintTimer != null) {
                clearTimeout(landscapeGestureHintTimer);
                landscapeGestureHintTimer = null;
            }
            return;
        }
        if (wasLandscape && isMobileTheater) {
            const el = resolveTheaterVideoElement();
            const playing = Boolean(el && !el.paused && !el.ended);
            if (playing) hideMobileTheaterControls('orientation_portrait');
            else showMobileTheaterControls('orientation_portrait');
        }
    }

    function syncMobileTheaterFlag(reason = 'detect') {
        const next = detectMobilePresentation();
        const changed = next !== isMobileTheater;
        isMobileTheater = next;
        syncMobileLandscapeTheaterFlag();
        if (!isMobileTheater) {
            // Desktop: native controls + header always available — never hide.
            controlsVisible = true;
            volumeVisible = true;
            menuVisible = true;
            if (mobileControlsHideTimer != null) {
                clearTimeout(mobileControlsHideTimer);
                mobileControlsHideTimer = null;
            }
        } else if (changed) {
            // Fresh mobile open — show Play chrome immediately (autoplay often stays paused).
            controlsVisible = true;
            volumeVisible = true;
            menuVisible = true; // framing / episodes / close stay reachable in header
            showMobileTheaterControls('mobile_open');
        }
        reportTheaterControls(reason);
    }

    /** Hide header chrome while playing; restore when paused. */
    function hideMobileTheaterControls(reason = 'idle') {
        if (!isMobileTheater) return;
        const el = resolveTheaterVideoElement();
        const playing = Boolean(el && !el.paused && !el.ended);
        if (playing) {
            controlsVisible = false;
            volumeVisible = false;
            menuVisible = false;
        } else {
            controlsVisible = true;
            volumeVisible = false;
            menuVisible = true;
        }
        reportTheaterControls(reason);
    }

    /** Reveal header chrome; auto-hide while playback is running. */
    function showMobileTheaterControls(reason = 'tap') {
        if (!isMobileTheater) {
            reportTheaterControls(reason);
            return;
        }
        controlsVisible = true;
        volumeVisible = false;
        menuVisible = true;
        reportTheaterControls(reason);
        if (mobileControlsHideTimer != null) clearTimeout(mobileControlsHideTimer);
        const el = resolveTheaterVideoElement();
        const playing = Boolean(el && !el.paused && !el.ended);
        if (!playing) return;
        mobileControlsHideTimer = setTimeout(() => {
            hideMobileTheaterControls('auto_hide_idle');
            mobileControlsHideTimer = null;
        }, 2800);
    }

    /** @param {'play' | 'pause' | 'seek-back' | 'seek-forward' | 'mute' | 'unmute'} kind @param {number} [seconds] */
    function showLandscapeGestureHint(kind, seconds = LANDSCAPE_SEEK_SECONDS) {
        landscapeGestureHint = { kind, seconds };
        if (landscapeGestureHintTimer != null) clearTimeout(landscapeGestureHintTimer);
        landscapeGestureHintTimer = setTimeout(() => {
            landscapeGestureHint = null;
            landscapeGestureHintTimer = null;
        }, LANDSCAPE_GESTURE_HINT_MS);
    }

    /** @param {number} deltaSeconds */
    function seekTheaterRelative(deltaSeconds) {
        const el = resolveTheaterVideoElement();
        if (!el) return;
        const duration = Number(el.duration);
        const hasDuration = Number.isFinite(duration) && duration > 0;
        const next = hasDuration
            ? Math.min(duration, Math.max(0, el.currentTime + deltaSeconds))
            : Math.max(0, el.currentTime + deltaSeconds);
        try {
            el.currentTime = next;
        } catch {
            /* ignore seek failures */
        }
        showLandscapeGestureHint(
            deltaSeconds < 0 ? 'seek-back' : 'seek-forward',
            Math.abs(deltaSeconds)
        );
        reportTheaterControls(deltaSeconds < 0 ? 'landscape_seek_back' : 'landscape_seek_forward');
    }

    async function toggleTheaterPlaybackWithLandscapeHint() {
        const el = resolveTheaterVideoElement();
        const willPlay = Boolean(el && (el.paused || el.ended));
        await toggleTheaterPlayback();
        showLandscapeGestureHint(willPlay ? 'play' : 'pause');
    }

    /** @param {PointerEvent} e */
    function handleLandscapeWrapperPointerDown(e) {
        if (!isMobileTheater || e.pointerType === 'mouse') return;
        const target = /** @type {HTMLElement | null} */ (e.target);
        if (target?.closest?.('button, input, a, [role="toolbar"]')) return;
        landscapePointerDownAt = Date.now();
        landscapePointerStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
    }

    /**
     * @param {PointerEvent} e
     * @param {{ allowLongPressUnmute?: boolean }} [opts]
     */
    function handleLandscapeWrapperPointerUp(e, opts = {}) {
        if (!isMobileTheater || e.pointerType === 'mouse') return;
        if (!landscapePointerStart || landscapePointerStart.id !== e.pointerId) return;
        const target = /** @type {HTMLElement | null} */ (e.target);
        if (target?.closest?.('button, input, a, [role="toolbar"]')) {
            landscapePointerStart = null;
            return;
        }
        const heldMs = Date.now() - landscapePointerDownAt;
        const dx = e.clientX - landscapePointerStart.x;
        const dy = e.clientY - landscapePointerStart.y;
        landscapePointerStart = null;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const el = resolveTheaterVideoElement();
        const isLongPress = heldMs > 450;

        // iOS long-press: unmute in place only — avoid load()/play() restart from the beginning.
        if (isLongPress) {
            if (opts.allowLongPressUnmute && el && !el.paused && !el.ended && theaterMuted) {
                unlockTheaterAudioForUserGesture(el);
                showLandscapeGestureHint('unmute');
            }
            return;
        }

        unlockTheaterAudioForUserGesture(el);
        if (absDx >= LANDSCAPE_SWIPE_THRESHOLD_PX && absDx > absDy * 1.2) {
            e.preventDefault();
            e.stopPropagation();
            seekTheaterRelative(dx > 0 ? LANDSCAPE_SEEK_SECONDS : -LANDSCAPE_SEEK_SECONDS);
            return;
        }
        if (absDx <= LANDSCAPE_TAP_SLOP_PX && absDy <= LANDSCAPE_TAP_SLOP_PX) {
            e.preventDefault();
            e.stopPropagation();
            const wrapper = /** @type {HTMLElement | null} */ (e.currentTarget);
            const rect = wrapper?.getBoundingClientRect?.();
            const relX =
                rect && rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
            handleLandscapeTapGesture(e, relX);
        }
    }

    /**
     * Tap play must run synchronously inside pointerup (Safari revokes unmuted play after ~280ms).
     * Pause stays delayed so double-tap seek/mute zones can cancel it.
     * @param {PointerEvent} e
     * @param {number} relX 0–1 horizontal position in wrapper
     */
    function handleLandscapeTapGesture(e, relX) {
        const now = Date.now();
        if (landscapeLastTap && now - landscapeLastTap.time <= LANDSCAPE_DOUBLE_TAP_MS) {
            handleLandscapeDoubleTap(e, relX);
            return;
        }
        landscapeLastTap = { time: now, x: e.clientX, y: e.clientY };
        const el = resolveTheaterVideoElement();
        // Autoplay-muted: first tap unmutes in place (no pause, no reload).
        if (el && !el.paused && !el.ended && theaterMuted) {
            clearLandscapeSingleTapTimer();
            landscapeLastTap = null;
            unlockTheaterAudioForUserGesture(el);
            showLandscapeGestureHint('unmute');
            return;
        }
        if (el && (el.paused || el.ended)) {
            clearLandscapeSingleTapTimer();
            landscapeLastTap = null;
            theaterPlayGestureLock = true;
            syncStartTheaterPlaybackFromGesture(el);
            setTimeout(() => {
                theaterPlayGestureLock = false;
            }, 400);
            return;
        }
        scheduleLandscapeSingleTapPause();
    }

    /** iOS-safe play/unmute — play() must run synchronously inside pointerup (no await before it). */
    function syncStartTheaterPlaybackFromGesture(el) {
        unlockTheaterAudioForUserGesture(el);
        if (el.ended) {
            try {
                el.currentTime = 0;
            } catch {
                /* ignore seek failures */
            }
        }
        const needsLoad =
            el.paused &&
            !el.currentSrc &&
            Boolean(el.querySelector('source')) &&
            el.readyState < HTMLMediaElement.HAVE_METADATA;
        if (needsLoad) {
            try {
                el.load();
            } catch {
                /* ignore */
            }
        }
        el.muted = false;
        theaterMuted = false;
        if (el.volume === 0) {
            el.volume = theaterVolume > 0 ? theaterVolume : 1;
        }
        try {
            const playResult = el.play();
            theaterIsPlaying = !el.paused;
            showLandscapeGestureHint('play');
            if (playResult && typeof playResult.then === 'function') {
                playResult
                    .then(() => {
                        theaterIsPlaying = !el.paused;
                    })
                    .catch(() => {
                        theaterMuted = true;
                        el.muted = true;
                        el.play()?.catch?.(() => {});
                        showMobileTheaterControls('play_error');
                    });
            }
        } catch {
            showMobileTheaterControls('play_error');
        }
    }

    function handleLandscapeWrapperPointerCancel() {
        landscapePointerStart = null;
        landscapeLastTap = null;
        clearLandscapeSingleTapTimer();
    }

    function toggleMobileTheaterChrome(reason = 'tap') {
        if (!isMobileTheater) return;
        const el = resolveTheaterVideoElement();
        const playing = Boolean(el && !el.paused && !el.ended);
        if (playing && menuVisible) {
            if (mobileControlsHideTimer != null) {
                clearTimeout(mobileControlsHideTimer);
                mobileControlsHideTimer = null;
            }
            hideMobileTheaterControls(reason);
            return;
        }
        showMobileTheaterControls(reason);
    }

    function applyTheaterMuteState(nextMuted) {
        theaterMuted = Boolean(nextMuted);
        const el = resolveTheaterVideoElement();
        if (el) {
            el.muted = theaterMuted;
            if (!theaterMuted && el.volume === 0) {
                el.volume = theaterVolume > 0 ? theaterVolume : 1;
            }
        }
        showMobileTheaterControls(theaterMuted ? 'mute' : 'unmute');
    }

    function toggleTheaterMute() {
        applyTheaterMuteState(!theaterMuted);
        showLandscapeGestureHint(theaterMuted ? 'mute' : 'unmute');
    }

    /** Smallest mobile sound dock — must run unmute/play synchronously inside pointerup (iOS). */
    function handleMobileSoundDockPointerUp(event) {
        if (!isMobileTheater) return;
        event.preventDefault();
        event.stopPropagation();
        const el = resolveTheaterVideoElement();
        if (!el) return;
        if (theaterMuted) {
            if (el.paused || el.ended) {
                syncStartTheaterPlaybackFromGesture(el);
            } else {
                unlockTheaterAudioForUserGesture(el);
            }
            showLandscapeGestureHint('unmute');
            reportTheaterControls('mobile_sound_dock_unmute');
            return;
        }
        applyTheaterMuteState(true);
        showLandscapeGestureHint('mute');
        reportTheaterControls('mobile_sound_dock_mute');
    }

    function clearLandscapeSingleTapTimer() {
        if (landscapeSingleTapTimer != null) {
            clearTimeout(landscapeSingleTapTimer);
            landscapeSingleTapTimer = null;
        }
    }

    /** User tap on the pure-gesture layer unlocks audio (no native volume chrome on mobile). */
    function unlockTheaterAudioForUserGesture(el = null) {
        if (!isMobileTheater || !theaterMuted) return;
        const video = el || resolveTheaterVideoElement();
        if (!video) return;
        theaterMuted = false;
        video.muted = false;
        if (video.volume === 0) {
            video.volume = theaterVolume > 0 ? theaterVolume : 1;
        }
        // iOS ignores muted=false on an already-playing stream unless play() runs in the gesture.
        if (!video.paused && !video.ended) {
            try {
                const pending = video.play();
                if (pending && typeof pending.catch === 'function') {
                    pending.catch(() => {});
                }
            } catch {
                /* ignore */
            }
        }
    }

    /** Delay pause-only tap so double-tap seek/mute can cancel (play uses sync path). */
    function scheduleLandscapeSingleTapPause() {
        clearLandscapeSingleTapTimer();
        landscapeSingleTapTimer = setTimeout(() => {
            landscapeSingleTapTimer = null;
            landscapeLastTap = null;
            theaterPlayGestureLock = true;
            void toggleTheaterPlaybackWithLandscapeHint().finally(() => {
                setTimeout(() => {
                    theaterPlayGestureLock = false;
                }, 400);
            });
        }, LANDSCAPE_DOUBLE_TAP_MS);
    }

    /**
     * Double-tap left/right: ±10s. Double-tap center: mute/unmute.
     * @param {PointerEvent} e
     * @param {number} relX 0–1 horizontal position in wrapper
     */
    function handleLandscapeDoubleTap(e, relX) {
        e.preventDefault();
        e.stopPropagation();
        clearLandscapeSingleTapTimer();
        landscapeLastTap = null;
        if (relX < 0.35) {
            seekTheaterRelative(-LANDSCAPE_SEEK_SECONDS);
            return;
        }
        if (relX > 0.65) {
            seekTheaterRelative(LANDSCAPE_SEEK_SECONDS);
            return;
        }
        toggleTheaterMute();
    }

    /** Prefer mounted Theater primary; fall back to live DOM if manager ref was cleared mid-remount. */
    function resolveTheaterVideoElement() {
        const managed = /** @type {HTMLVideoElement | null} */ (theaterManager.videoElement);
        if (managed && managed.isConnected) return managed;
        if (typeof document === 'undefined') return null;
        const live = /** @type {HTMLVideoElement | null} */ (
            document.querySelector('video[data-theater-video]')
        );
        if (live) theaterManager.setVideoElement(live);
        return live;
    }

    /**
     * Start Theater playback under mobile autoplay rules (muted first, then retry).
     * @param {HTMLVideoElement} el
     */
    async function startTheaterPlayback(el) {
        logMobilePlayTrace('START_THEATER_PLAYBACK', {
            assetId: String(get(activeReel)?.id || '').trim(),
            title: String(get(activeReel)?.title || '').trim(),
            mediaUrl: String(el?.currentSrc || el?.src || '').trim(),
            resolver: 'TheaterExperience.startTheaterPlayback',
            source: 'theater-play',
            viewerOpen: true,
            videoMounted: true,
            playCalled: true
        });
        if (el.ended) {
            try {
                el.currentTime = 0;
            } catch {
                /* ignore seek failures */
            }
        }
        // Source-only attach can sit at readyState 0 until load() — never reload mid-playback.
        const needsLoad =
            el.paused &&
            !el.currentSrc &&
            Boolean(el.querySelector('source')) &&
            el.readyState < HTMLMediaElement.HAVE_METADATA;
        if (needsLoad) {
            logMobilePlayTrace('VIDEO_LOAD_CALL', {
                assetId: String(get(activeReel)?.id || '').trim(),
                resolver: 'TheaterExperience.startTheaterPlayback.load',
                source: 'theater-play',
                reason: 'empty-currentSrc-has-source',
                viewerOpen: true,
                videoMounted: true,
                playCalled: true,
                videoEl: el
            });
            try {
                el.load();
            } catch {
                /* ignore */
            }
        }
        el.muted = theaterMuted;
        try {
            const playResult = el.play();
            if (playResult && typeof playResult.then === 'function') await playResult;
            logMobilePlayTrace('PLAY_RESULT', {
                assetId: String(get(activeReel)?.id || '').trim(),
                resolver: 'TheaterExperience.startTheaterPlayback.play',
                source: 'theater-play',
                reason: el.paused ? 'play-resolved-still-paused' : 'play-resolved',
                viewerOpen: true,
                videoMounted: true,
                playCalled: true,
                videoEl: el
            });
        } catch (err) {
            const msg =
                err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
            const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
            logMobilePlayTrace('PLAY_REJECT', {
                assetId: String(get(activeReel)?.id || '').trim(),
                resolver: 'TheaterExperience.startTheaterPlayback.play',
                source: 'theater-play',
                reason: `${name} ${msg}`.trim().slice(0, 180),
                viewerOpen: true,
                videoMounted: true,
                playCalled: true,
                videoEl: el
            });
            // iOS/Android: unmuted play often rejected without a sticky gesture — force mute + retry.
            if (!el.muted || /NotAllowed|interact|user/i.test(`${name} ${msg}`)) {
                theaterMuted = true;
                el.muted = true;
                const retry = el.play();
                if (retry && typeof retry.then === 'function') await retry;
            } else {
                throw err;
            }
        }
        theaterIsPlaying = !el.paused;
        showMobileTheaterControls(el.paused ? 'play_error' : 'play');
        logMobilePlayTrace('START_THEATER_PLAYBACK_DONE', {
            assetId: String(get(activeReel)?.id || '').trim(),
            mediaUrl: String(el?.currentSrc || '').trim(),
            resolver: 'TheaterExperience.startTheaterPlayback.done',
            viewerOpen: true,
            videoMounted: true,
            playCalled: true,
            reason: el.paused ? 'still-paused' : 'playing'
        });
    }

    /**
     * Explicit mobile play/pause — native <video controls> play is unreliable when
     * Theater also attaches touch/click handlers on the same element (iOS swallows the tap).
     * Decision always uses el.paused (not theaterIsPlaying label) to avoid desync no-ops.
     */
    async function toggleTheaterPlayback() {
        const el = resolveTheaterVideoElement();
        if (!el) {
            showMobileTheaterControls('play_missing_element');
            logTheater('mobile play/pause failed', { message: 'play_missing_element' });
            logMobilePlayTrace('TOGGLE_THEATER_PLAYBACK_MISSING', {
                assetId: String(get(activeReel)?.id || '').trim(),
                resolver: 'TheaterExperience.toggleTheaterPlayback',
                reason: 'play_missing_element',
                viewerOpen: true,
                videoMounted: false,
                playCalled: false
            });
            return;
        }
        logMobilePlayTrace('TOGGLE_THEATER_PLAYBACK', {
            assetId: String(get(activeReel)?.id || '').trim(),
            mediaUrl: String(el.currentSrc || el.src || '').trim(),
            resolver: 'TheaterExperience.toggleTheaterPlayback',
            source: el.paused || el.ended ? 'play' : 'pause',
            viewerOpen: true,
            videoMounted: true,
            playCalled: Boolean(el.paused || el.ended)
        });
        try {
            if (el.paused || el.ended) {
                unlockTheaterAudioForUserGesture();
                await startTheaterPlayback(el);
            } else {
                el.pause();
                theaterIsPlaying = false;
                showMobileTheaterControls('pause_button');
            }
        } catch (err) {
            theaterIsPlaying = Boolean(el && !el.paused);
            logTheater('mobile play/pause failed', {
                message: err && typeof err === 'object' && 'message' in err ? err.message : String(err),
                paused: el?.paused,
                readyState: el?.readyState,
                currentSrc: (el?.currentSrc || '').slice(0, 120)
            });
            showMobileTheaterControls('play_error');
        }
    }

    /** Guards against pointerup + synthetic click double-toggle on some WebViews. */
    let theaterPlayGestureLock = false;

    /** @param {Event} e */
    function handleTheaterVolumeInput(e) {
        const input = /** @type {HTMLInputElement} */ (e.currentTarget);
        const next = Math.min(1, Math.max(0, Number(input.value)));
        theaterVolume = Number.isFinite(next) ? next : 1;
        const el = theaterManager.videoElement;
        if (el) {
            el.volume = theaterVolume;
            el.muted = theaterVolume === 0;
            theaterMuted = el.muted;
        } else if (theaterVolume === 0) {
            theaterMuted = true;
        } else {
            theaterMuted = false;
        }
        showMobileTheaterControls('volume_slider');
    }

    /** @param {Event} e */
    function handleTheaterVideoVolumeChange(e) {
        const el = /** @type {HTMLVideoElement} */ (e.currentTarget);
        if (!el) return;
        theaterMuted = Boolean(el.muted || el.volume === 0);
        if (!el.muted && el.volume > 0) theaterVolume = el.volume;
    }

    /** @param {Event} e */
    function handleTheaterVideoInteraction(e) {
        // Mobile portrait + landscape: wrapper owns tap/swipe gestures (pure-gesture layer).
        if (isMobileTheater) return;
    }

    /**
     * Wrapper-only gesture on mobile: tap play/pause, horizontal swipe seek.
     * @param {PointerEvent} e
     */
    function handleTheaterWrapperPointerUp(e) {
        if (isMobileTheater) {
            handleLandscapeWrapperPointerUp(e, { allowLongPressUnmute: true });
        }
    }

    /** @param {Event} e */
    function preventMobileTheaterContextMenu(e) {
        if (!isMobileTheater) return;
        e.preventDefault();
    }

    function onHeroWatchNowCta() {
        heroCtaSuppressAutoOpen = true;
        heroCtaPendingEpisodes = false;
        seriesDrawerOpenIntent = '';
    }

    function onHeroLearnMoreCta() {
        heroCtaPendingEpisodes = true;
        heroCtaSuppressAutoOpen = false;
        seriesDrawerOpenIntent = 'hero-learn-more';
    }

    onMount(() => {
        syncMobileTheaterFlag('mount');
        const stopEntitlement = subscribeViewerPaidAccessEntitlement((next) => {
            hasAccessEntitlement = Boolean(next);
        });
        resolveViewerSubscriptionUrl()
            .then((url) => {
                subscriptionUrl = String(url || '').trim();
            })
            .catch(() => {
                subscriptionUrl = '';
            });
        const stopMobilePresentation = subscribeMobilePresentation(() =>
            syncMobileTheaterFlag('viewport_change')
        );
        /** @type {MediaQueryList | null} */
        let orientationMql = null;
        const onOrientationChange = () => syncMobileTheaterFlag('orientation_change');
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
            orientationMql = window.matchMedia('(orientation: landscape)');
            if (typeof orientationMql.addEventListener === 'function') {
                orientationMql.addEventListener('change', onOrientationChange);
            } else if (typeof orientationMql.addListener === 'function') {
                orientationMql.addListener(onOrientationChange);
            }
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('reelforge:hero-watch-now', onHeroWatchNowCta);
            window.addEventListener('reelforge:hero-learn-more', onHeroLearnMoreCta);
            window.addEventListener('reelforge:episode-play-blocked', handleSeriesEpisodeLocked);
        }
        return () => {
            stopEntitlement();
            stopMobilePresentation();
            if (orientationMql) {
                if (typeof orientationMql.removeEventListener === 'function') {
                    orientationMql.removeEventListener('change', onOrientationChange);
                } else if (typeof orientationMql.removeListener === 'function') {
                    orientationMql.removeListener(onOrientationChange);
                }
            }
            if (landscapeGestureHintTimer != null) clearTimeout(landscapeGestureHintTimer);
            clearLandscapeSingleTapTimer();
            if (typeof window !== 'undefined') {
                window.removeEventListener('reelforge:hero-watch-now', onHeroWatchNowCta);
                window.removeEventListener('reelforge:hero-learn-more', onHeroLearnMoreCta);
                window.removeEventListener('reelforge:episode-play-blocked', handleSeriesEpisodeLocked);
            }
        };
    });
    onDestroy(() => {
        if (mobileControlsHideTimer != null) clearTimeout(mobileControlsHideTimer);
        clearLandscapeSingleTapTimer();
        if (typeof window !== 'undefined') {
            window.removeEventListener('reelforge:hero-watch-now', onHeroWatchNowCta);
            window.removeEventListener('reelforge:hero-learn-more', onHeroLearnMoreCta);
        }
    });

    /** Creator identity for the active reel (Hero Vault source of truth). */
    $: contentIdentity = (() => {
        const reelId = $activeReel?.id == null ? '' : String($activeReel.id);
        if (!reelId) return null;
        // Depend on series metadata store so Hero saves re-render Theater menus.
        void $reelSeriesMetadata;
        return resolveContentIdentity(reelId, { reel: $activeReel });
    })();

    $: seriesContext = (() => {
        if (!$activeReel) return null;
        void $reelSeriesMetadata;
        void $seriesCatalog;
        const base = resolveSeriesContextForReel($activeReel);
        const identity =
            contentIdentity ||
            resolveContentIdentity(String($activeReel.id || ''), { reel: $activeReel });
        if (!base) return null;
        return applyContentIdentityToSeriesContext(base, identity);
    })();
    $: hasSeriesMetadata = Boolean(seriesContext);
    $: seriesId = seriesContext?.series.id ?? '';
    $: drawerSeriesId = (() => {
        // Bound series only — never invent demo catalog (e.g. Neon Vengeance).
        if (seriesId && getSeriesById(seriesId)) return seriesId;
        const reelId = $activeReel?.id == null ? '' : String($activeReel.id);
        if (reelId) {
            const byReel = getEpisodeByReelId(reelId);
            if (byReel?.series?.id && getSeriesById(byReel.series.id)) {
                return byReel.series.id;
            }
        }
        return '';
    })();

    /** Ready vault pool for related-episode resolution (does not alter Hero Vault UI). */
    $: relatedReadyAssets = (() => {
        if (!$activeReel) return [];
        const extras = [$activeReel, ...($personalVideos || [])];
        try {
            return getReadyHeroVaultAssets({ extraItems: extras });
        } catch {
            return extras.filter(Boolean);
        }
    })();

    $: relatedEpisodes = $activeReel
        ? resolveRelatedEpisodes($activeReel, { readyAssets: relatedReadyAssets })
        : null;

    $: drawerSeriesView = (() => {
        if (!$activeReel || !relatedEpisodes) return null;
        const catalog =
            (drawerSeriesId && getSeriesById(drawerSeriesId)) ||
            (relatedEpisodes.seriesId && getSeriesById(relatedEpisodes.seriesId)) ||
            null;
        return buildSeriesViewFromRelated(relatedEpisodes, catalog);
    })();

    $: relatedEpisodeTitles = (drawerSeriesView?.seasons || [])
        .flatMap((s) => s.episodes || [])
        .map((e) => String(e.title || '').trim())
        .filter(Boolean);

    $: hasRelatedFamily = (relatedEpisodes?.members?.length || 0) >= 2 || relatedEpisodeTitles.length >= 2;
    /** All Episodes — vault-related family first; catalog series id can also open drawer. */
    $: hasSeriesDrawer =
        hasRelatedFamily ||
        Boolean(drawerSeriesView && (drawerSeriesView.seasons || []).some((s) => (s.episodes || []).length > 0)) ||
        Boolean(drawerSeriesId);
    /** Episodes pop-out — catalog series or related vault family (≥2 members). */
    $: showSeriesDrawerControl = hasSeriesDrawer;
    /** Landscape Theater: dock episode rail beside player (desktop / wide canvas). */
    $: seriesDrawerDocked = seriesDrawerOpen && !isMobileTheater && hasSeriesDrawer;
    $: if (seriesContext) selectedSeriesEpisodeId = seriesContext.episode.episodeId;

    /**
     * Auto-open the episode rail once per Theater session on desktop only.
     * Phones must see the MP4 first — a full-screen All Episodes overlay hid playback
     * and ate the close control because this used to re-force open=true on every tick.
     * Homepage Watch Now also suppresses that dock. Learn More may open All Episodes
     * on purpose, including on phones.
     */
    let seriesDrawerAutoOpenedForId = '';
    $: theaterSessionId = $activeReel?.id == null ? '' : String($activeReel.id);
    $: if (!theaterSessionId) {
        seriesDrawerOpen = false;
        seriesDrawerAutoOpenedForId = '';
        selectedSeriesEpisodeId = '';
        episodeNavNotice = '';
        theaterBgPosterFailed = false;
        seriesDrawerOpenIntent = '';
    } else if (heroCtaPendingEpisodes && hasSeriesDrawer) {
        seriesDrawerOpen = true;
        seriesDrawerAutoOpenedForId = theaterSessionId;
        seriesDrawerOpenIntent = 'hero-learn-more';
        heroCtaPendingEpisodes = false;
        heroCtaSuppressAutoOpen = false;
    } else if (heroCtaSuppressAutoOpen) {
        seriesDrawerOpen = false;
        seriesDrawerAutoOpenedForId = theaterSessionId;
        seriesDrawerOpenIntent = '';
        heroCtaSuppressAutoOpen = false;
    } else if (
        hasSeriesDrawer &&
        !isMobileTheater &&
        seriesDrawerAutoOpenedForId !== theaterSessionId
    ) {
        seriesDrawerOpen = true;
        seriesDrawerAutoOpenedForId = theaterSessionId;
        seriesDrawerOpenIntent = 'auto';
    } else if (
        isMobileTheater &&
        seriesDrawerOpen &&
        seriesDrawerOpenIntent === 'auto' &&
        seriesDrawerAutoOpenedForId &&
        seriesDrawerAutoOpenedForId === theaterSessionId
    ) {
        // Desktop auto-open raced before mobile detect — do not keep a blocking overlay.
        seriesDrawerOpen = false;
        seriesDrawerOpenIntent = '';
    }

    let lastTheaterVideoKey = '';
    $: if (theaterVideoKey && theaterVideoKey !== lastTheaterVideoKey) {
        lastTheaterVideoKey = theaterVideoKey;
        // New stream → re-start muted for autoplay policy; mobile chrome waits for play/tap.
        theaterMuted = true;
        theaterIsPlaying = false;
        if (isMobileTheater) {
            // Keep Play reachable even when autoplay is blocked.
            controlsVisible = true;
            volumeVisible = true;
            menuVisible = true;
            showMobileTheaterControls('video_source_change');
        }
    }

    /** @param {CustomEvent<{ episodeId: string }>} event */
    function handleSeriesEpisodeSelect(event) {
        const episodeId = event.detail.episodeId;
        selectedSeriesEpisodeId = episodeId;
        const detailReelId = event.detail?.reelId ? String(event.detail.reelId) : '';
        const fromView = drawerSeriesView?.seasons
            ?.flatMap((s) => s.episodes || [])
            .find((e) => e.episodeId === episodeId);
        const access = resolveEpisodeAccessPricing({
            episode:
                fromView ||
                ({
                    episodeNumber: event.detail?.episodeNumber,
                    accessMode: event.detail?.accessMode
                }),
            mediaAssetId: String(event.detail?.mediaAssetId || fromView?.mediaAssetId || ''),
            reelId: detailReelId || String(fromView?.reelId || ''),
            seriesId: drawerSeriesView?.id,
            seriesAccessMode:
                drawerSeriesView?.accessMode ?? drawerSeriesView?.access_mode ?? event.detail?.seriesAccessMode,
            freeEpisodeCount:
                drawerSeriesView?.freeEpisodeCount ??
                drawerSeriesView?.free_episode_count ??
                event.detail?.freeEpisodeCount
        });
        if (access.mode !== 'free' && !hasAccessEntitlement) {
            const episodeNumber = Number(fromView?.episodeNumber ?? event.detail?.episodeNumber);
            const episodeLine =
                Number.isFinite(episodeNumber) && episodeNumber > 0
                    ? `Episode ${episodeNumber}`
                    : 'This episode';
            const gateLine = access.badgeLabel
                ? `${episodeLine} is ${access.badgeLabel}.`
                : `${episodeLine} requires paid access.`;
            episodeNavNotice = `${gateLine} Pay or subscribe to continue.`;
            pendingLockedEpisode = {
                episodeId: String(episodeId || ''),
                reelId: String(
                    detailReelId || event.detail?.mediaAssetId || fromView?.mediaAssetId || fromView?.reelId || ''
                ),
                episodeNumber: Number.isFinite(episodeNumber) ? episodeNumber : undefined,
                mode: access.mode,
                price: access.price
            };
            return;
        }
        console.info('[THEATER_EPISODE_LOAD]', {
            seriesId: drawerSeriesId || seriesId || relatedEpisodes?.seriesId || null,
            episodeId,
            mediaId: detailReelId || null,
            source: 'theater-drawer-select',
            phase: 'request',
            ts: new Date().toISOString()
        });
        const navigated = navigateFromDrawer(episodeId);
        if (navigated) {
            seriesDrawerOpen = false;
            episodeNavNotice = '';
            return;
        }
        // Related-resolver members may carry reelId without catalog bind yet.
        const member = relatedEpisodes?.members?.find(
            (m) =>
                m.episodeId === episodeId ||
                m.assetId === detailReelId ||
                m.reelId === detailReelId ||
                m.assetId === String(event.detail?.mediaAssetId || '')
        );
        const reelId =
            detailReelId ||
            (event.detail?.mediaAssetId ? String(event.detail.mediaAssetId) : '') ||
            (member?.reelId ? String(member.reelId) : '') ||
            (member?.assetId ? String(member.assetId) : '') ||
            (fromView?.reelId ? String(fromView.reelId) : '') ||
            (fromView?.mediaAssetId ? String(fromView.mediaAssetId) : '');
        if (reelId) {
            const fromVault = ($personalVideos || []).find((v) => String(v?.id || '') === reelId);
            const fromReady = relatedReadyAssets.find(
                (v) => String(v?.id || v?.assetId || '') === reelId
            );
            const candidate = fromVault || fromReady || (member?.url || member?.playbackUrl ? member : null);
            if (candidate && typeof openTheaterReel === 'function') {
                const candidateWithAccess = {
                    ...candidate,
                    episodeId: String(episodeId || candidate?.episodeId || ''),
                    episodeNumber:
                        Number(fromView?.episodeNumber ?? member?.episodeNumber ?? event.detail?.episodeNumber) ||
                        candidate?.episodeNumber ||
                        null,
                    accessMode:
                        member?.accessMode ||
                        fromView?.accessMode ||
                        event.detail?.accessMode ||
                        candidate?.accessMode ||
                        null,
                    price:
                        member?.price ||
                        fromView?.price ||
                        event.detail?.price ||
                        candidate?.price ||
                        '',
                    mediaAssetId:
                        String(event.detail?.mediaAssetId || fromView?.mediaAssetId || candidate?.mediaAssetId || reelId)
                };
                openTheaterReel(candidateWithAccess);
                seriesDrawerOpen = false;
                episodeNavNotice = '';
                return;
            }
        }
        episodeNavNotice = 'No playable reel is linked to that episode yet.';
    }

    function openSeriesDrawer() {
        seriesDrawerOpen = true;
        episodeNavNotice = '';
    }

    /** @param {CustomEvent<Record<string, unknown>>} event */
    function handleSeriesEpisodeLocked(event) {
        const lockedEpisodeId = String(
            event.detail?.episodeId ||
                event.detail?.id ||
                selectedSeriesEpisodeId ||
                ''
        ).trim();
        const episodeNumber = Number(event.detail?.episodeNumber);
        const badgeLabel = String(event.detail?.badgeLabel || '').trim();
        const episodeLine =
            Number.isFinite(episodeNumber) && episodeNumber > 0
                ? `Episode ${episodeNumber}`
                : 'This episode';
        const gateLine = badgeLabel ? `${episodeLine} is ${badgeLabel}.` : `${episodeLine} requires paid access.`;
        episodeNavNotice = `${gateLine} Pay or subscribe to continue.`;
        pendingLockedEpisode = {
            episodeId: lockedEpisodeId,
            reelId: String(event.detail?.reelId || event.detail?.mediaAssetId || ''),
            episodeNumber: Number.isFinite(episodeNumber) ? episodeNumber : undefined,
            mode: String(event.detail?.accessMode || 'paid'),
            price: String(event.detail?.price || '')
        };
    }

    function resolveCheckoutFailureMessage() {
        const reason = consumeViewerCheckoutFailureReason();
        if (reason === VIEWER_CHECKOUT_FAILURE_REASONS.UNAUTHENTICATED) {
            return 'Payment unavailable right now. Sign in and try again.';
        }
        if (reason === VIEWER_CHECKOUT_FAILURE_REASONS.MISSING_EPISODE) {
            return 'Payment unavailable for this episode right now. Select the locked episode again and retry.';
        }
        return 'Payment unavailable right now. Please try again.';
    }

    async function openTheaterSubscriptionFlow() {
        const opened = await openViewerSubscriptionCheckout({
            source: 'theater_episode_lock',
            episodeId: pendingLockedEpisode?.episodeId,
            reelId: pendingLockedEpisode?.reelId,
            episodeNumber: pendingLockedEpisode?.episodeNumber,
            mode: pendingLockedEpisode?.mode,
            price: pendingLockedEpisode?.price
        });
        if (!opened) {
            episodeNavNotice = resolveCheckoutFailureMessage();
        }
    }

    $: theaterPlayback =
        $activeReel &&
        ($activeReel.isPlaceholder ||
            $activeReel.isBlackStoriesPlaceholder ||
            // Vault image assets (Theater media contract) — resolve image mode without treating as video
            (Boolean($activeReel.mediaAssetId || $activeReel.mediaType === 'image') &&
                !isVideoReel($activeReel) &&
                isImageReel($activeReel)))
            ? resolveTheaterPlayback($activeReel, $personalVideos)
            : null;
    $: theaterVideoSrc =
        $activeReel && isVideoReel($activeReel) && !$activeReel.isPlaceholder && !$activeReel.isBlackStoriesPlaceholder
            ? resolveTheaterAttachUrl($activeReel) || resolvePlayableMediaUrl($activeReel, 'theater')
            : theaterPlayback?.mode === 'video'
              ? theaterPlayback.url
              : null;
    $: theaterVideoMime = theaterVideoSrc ? videoMimeForPath(theaterVideoSrc) : null;
    /** Existing thumbnail/poster path used by the foreground player — never the MP4 itself. */
    $: theaterBgPosterSrc = $activeReel?.thumbnailUrl || theaterPlayback?.poster || '';
    $: theaterBgPosterKey = `${$activeReel?.id || ''}|${theaterBgPosterSrc}`;
    $: if (theaterBgPosterKey) {
        // Reset failed state only when reel/poster identity changes (not on every tick).
        theaterBgPosterFailed = false;
    }
    $: theaterVideoKey = theaterVideoSrc
        ? `${theaterVideoSrc}|${$activeReel?.id || ''}|${$theaterRetryNonce}`
        : '';

    $: if (theaterVideoSrc) {
        logFinalMediaUrl('theater-video', resolveDisplayUrl(theaterVideoSrc, 'video', 'theater-video'));
    }
    $: if (theaterBgPosterSrc) {
        logFinalMediaUrl(
            'theater-poster',
            resolveDisplayUrl(theaterBgPosterSrc, 'poster', 'theater-poster')
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
        class:theater-overlay--series-landscape={seriesDrawerDocked}
        class:theater-overlay--mobile={isMobileTheater}
        data-series-open={seriesDrawerOpen ? 'true' : undefined}
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
            class:theater-mobile={isMobileTheater}
            class:theater-mobile-landscape={isMobileLandscapeTheater}
            class:theater-controls-visible={controlsVisible}
            class:theater-chrome-visible={isMobileTheater && (controlsVisible || menuVisible)}
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
            <div
                class="theater-header"
                class:theater-header--menu-raised={isMobileTheater && menuVisible}
            >
                <div class="theater-header-main">
                    {#if $metadataDisplayFlags.showReelTitle}
                        <h2 class="theater-title">{$activeReel.name || $activeReel.title}</h2>
                    {/if}
                    {#if hasSeriesMetadata && seriesContext}
                        <TheaterSeriesMetadata {seriesContext} />
                    {/if}
                </div>
                <div class="theater-header-actions" class:theater-header-actions--visible={menuVisible}>
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
                    class:theater-video-wrapper--mobile={isMobileTheater}
                    class:theater-video-wrapper--landscape={isMobileLandscapeTheater}
                    on:pointerdown={handleLandscapeWrapperPointerDown}
                    on:pointerup={handleTheaterWrapperPointerUp}
                    on:pointercancel={handleLandscapeWrapperPointerCancel}
                    on:contextmenu|preventDefault={preventMobileTheaterContextMenu}
                >
                    {#key theaterVideoKey}
                        {#if $theaterFraming === 'smart'}
                            <div
                                class="theater-video-bg"
                                class:theater-video-bg-fallback={!theaterBgPosterSrc || theaterBgPosterFailed}
                                aria-hidden="true"
                            >
                                {#if theaterBgPosterSrc && !theaterBgPosterFailed}
                                    <MediaThumbnail
                                        url={theaterBgPosterSrc}
                                        alt=""
                                        className="theater-video-bg-image"
                                        lazyLoad={false}
                                        on:error={() => {
                                            theaterBgPosterFailed = true;
                                        }}
                                    />
                                {/if}
                            </div>
                        {/if}
                        <MediaRenderer
                            type="video"
                            url={theaterVideoSrc}
                            poster={theaterBgPosterSrc}
                            className="theater-video theater-video-fg"
                            dataTheaterVideo={true}
                            action={theaterVideoMount}
                            mimeType={theaterVideoMime}
                            useSourceElement={true}
                            preload="metadata"
                            autoplay
                            muted={theaterMuted}
                            controls={!isMobileTheater}
                            playsinline
                            playbackRole="theater"
                            on:ended={handleTheaterEnded}
                            on:timeupdate={(e) => {
                                handleTheaterTimeupdate(e);
                                theaterWatchOnProgress(e.currentTarget);
                            }}
                            on:volumechange={handleTheaterVideoVolumeChange}
                            on:play={(e) => {
                                theaterIsPlaying = true;
                                logTheaterMedia({
                                    phase: 'play',
                                    reelId: get(activeReel)?.id ?? null,
                                    currentTime: e.currentTarget.currentTime,
                                    paused: e.currentTarget.paused
                                });
                                logTheaterPlaybackPhase('playing-event', e.currentTarget, {
                                    reelId: get(activeReel)?.id ?? null
                                });
                                logTheater('▶️ Theater video play');
                                theaterWatchOnPlay(e.currentTarget);
                                if (isMobileTheater) showMobileTheaterControls('playback_start');
                            }}
                            on:pause={(e) => {
                                theaterIsPlaying = false;
                                theaterWatchOnPause(e.currentTarget);
                                if (isMobileTheater) showMobileTheaterControls('pause');
                            }}
                            on:waiting={(e) => {
                                logTheaterPlaybackPhase('waiting', e.currentTarget, {
                                    reelId: get(activeReel)?.id ?? null
                                });
                            }}
                            on:stalled={(e) => {
                                logTheaterPlaybackPhase('stalled', e.currentTarget, {
                                    reelId: get(activeReel)?.id ?? null
                                });
                            }}
                            on:error={handleTheaterVideoError}
                            on:loadedmetadata={(e) => {
                                theaterPlaybackError.set(false);
                                resetTheaterTimeline();
                                theaterApplyResume(e.currentTarget);
                                logTheaterMedia({
                                    phase: 'loadedmetadata',
                                    reelId: get(activeReel)?.id ?? null,
                                    duration: e.currentTarget.duration,
                                    videoWidth: e.currentTarget.videoWidth,
                                    videoHeight: e.currentTarget.videoHeight,
                                    framing: $theaterFraming
                                });
                                logTheaterPlaybackPhase('loadedmetadata', e.currentTarget, {
                                    reelId: get(activeReel)?.id ?? null,
                                    framing: $theaterFraming
                                });
                                logTheater('🎞️ Theater metadata loaded', {
                                    duration: e.currentTarget.duration,
                                    videoWidth: e.currentTarget.videoWidth,
                                    videoHeight: e.currentTarget.videoHeight,
                                    framing: $theaterFraming
                                });
                            }}
                            on:loadeddata={(e) => {
                                logTheaterMedia({ phase: 'loadeddata', reelId: get(activeReel)?.id ?? null, url: theaterVideoSrc });
                                logTheaterPlaybackPhase('loadeddata', e.currentTarget, {
                                    reelId: get(activeReel)?.id ?? null,
                                    url: theaterVideoSrc
                                });
                                logTheater('✅ Theater video data loaded', { url: theaterVideoSrc });
                            }}
                            on:click={handleTheaterVideoInteraction}
                            on:pointerup={handleTheaterVideoInteraction}
                        />
                    {/key}
                    {#if isMobileTheater && landscapeGestureHint}
                        <div class="theater-landscape-gesture-hint" aria-hidden="true">
                            {#if landscapeGestureHint.kind === 'play'}
                                <span class="theater-landscape-gesture-hint__icon">▶</span>
                            {:else if landscapeGestureHint.kind === 'pause'}
                                <span class="theater-landscape-gesture-hint__icon">❚❚</span>
                            {:else if landscapeGestureHint.kind === 'seek-back'}
                                <span class="theater-landscape-gesture-hint__icon"
                                    >↶ {landscapeGestureHint.seconds}s</span
                                >
                            {:else if landscapeGestureHint.kind === 'seek-forward'}
                                <span class="theater-landscape-gesture-hint__icon"
                                    >{landscapeGestureHint.seconds}s ↷</span
                                >
                            {:else if landscapeGestureHint.kind === 'mute'}
                                <span class="theater-landscape-gesture-hint__icon">🔇</span>
                            {:else if landscapeGestureHint.kind === 'unmute'}
                                <span class="theater-landscape-gesture-hint__icon">🔊</span>
                            {/if}
                        </div>
                    {/if}
                    {#if !isMobileTheater}
                        <ReelshortExperience section="theater-chrome" />
                    {/if}
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
                        <p>
                          {$theaterPlaybackError
                            ? 'This file could not be decoded. It may be corrupt, HTML disguised as video, or not a valid MP4/MOV.'
                            : $activeReel?.isPersonalVideo
                              ? 'This vault upload never finished (failed or interrupted). Remove the stub in Video Vault and re-upload the MP4.'
                              : 'This is a placeholder reel or AI-generated content'}
                        </p>
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
            {#if !$theaterChromeFlags.hideMetaPanel && !isMobileTheater}
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
                            <span class="meta-value" style="color: {UIAgent.getStudioConfigs($activeReel.category).color}">{UIAgent.getStudioConfigs($activeReel.category).label}</span>
                        </div>
                        {#if $activeReel.auto_detected}
                            <div class="auto-detect-notice"><span>🤖 Smart-placed in: <strong>{UIAgent.getStudioConfigs($activeReel.category).label}</strong> ({$activeReel.detection_confidence || 'High'} confidence)</span></div>
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
            {#if !$theaterChromeFlags.hideBottomClose && !isMobileTheater}
            <button class="theater-close-btn-bottom" on:click={(e) => { e.stopPropagation(); theaterManager.close(); }}>✕ CLOSE THEATER (ESC)</button>
            {/if}
            {#if episodeNavNotice}
                <div class="theater-episode-nav-notice" role="status">
                    <p>{episodeNavNotice}</p>
                    {#if subscriptionUrl}
                        <div class="theater-payment-actions">
                            <button
                                type="button"
                                class="theater-payment-btn"
                                on:click|stopPropagation={openTheaterSubscriptionFlow}
                            >PAY WITH STRIPE</button>
                            <button
                                type="button"
                                class="theater-payment-btn theater-payment-btn--quiet"
                                on:click|stopPropagation={() => {
                                    episodeNavNotice = '';
                                }}
                            >Not now</button>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
        {#if isMobileTheater && theaterVideoSrc && !$theaterPlaybackError}
            <button
                type="button"
                class="theater-sound-dock"
                class:theater-sound-dock--muted={theaterMuted}
                aria-label={theaterMuted ? 'Turn sound on' : 'Mute sound'}
                aria-pressed={!theaterMuted}
                data-theater-sound-dock
                on:pointerup|stopPropagation={handleMobileSoundDockPointerUp}
            >
                <span class="theater-sound-dock__icon" aria-hidden="true"
                    >{theaterMuted ? '🔇' : '🔊'}</span
                >
            </button>
        {/if}
        {#if hasSeriesDrawer}
            <SeriesDrawer
                bind:open={seriesDrawerOpen}
                seriesId={drawerSeriesId || relatedEpisodes?.seriesId || ''}
                seriesView={drawerSeriesView}
                seedAsset={$activeReel}
                readyAssets={relatedReadyAssets}
                selectedEpisodeId={selectedSeriesEpisodeId}
                viewerMode={true}
                {hasAccessEntitlement}
                docked={seriesDrawerDocked}
                on:episodeSelect={handleSeriesEpisodeSelect}
                on:episodeLocked={handleSeriesEpisodeLocked}
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
    .theater-overlay--mobile {
        padding: 0;
        align-items: stretch;
        justify-content: stretch;
        width: 100%;
        height: 100%;
        height: 100dvh;
        background: #000;
    }
    .theater-overlay--mobile .theater-container {
        max-width: none;
        max-height: none;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        border-radius: 0;
    }
    .theater-overlay--series-landscape {
        align-items: stretch;
        justify-content: stretch;
        gap: 0;
        padding: 0;
        background: #050508;
        display: grid;
        grid-template-columns: minmax(0, 1fr) min(360px, 34vw);
    }
    .theater-overlay--series-landscape .theater-container {
        max-width: none;
        max-height: 100vh;
        width: min(440px, 46vw);
        min-width: 320px;
        height: 100%;
        border-radius: 34px;
        margin: 0;
        flex: unset;
        justify-self: center;
        align-self: center;
        padding: 0.7rem;
        box-sizing: border-box;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background:
            radial-gradient(120% 100% at 50% 0%, rgba(255, 255, 255, 0.08) 0%, transparent 58%),
            linear-gradient(180deg, #0f1014 0%, #08090d 100%);
        box-shadow:
            0 16px 48px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }
    .theater-overlay--series-landscape .theater-glow-border {
        display: none;
    }
    .theater-overlay--series-landscape .theater-video-wrapper {
        border-radius: 26px;
        min-height: min(84vh, 860px);
        box-shadow: 0 22px 48px rgba(0, 0, 0, 0.55);
    }
    .theater-overlay--series-landscape .theater-header {
        margin-bottom: 0.5rem;
        padding-inline: 0.1rem;
    }
    .theater-overlay--series-landscape :global([data-theater-series-panel]),
    .theater-overlay--series-landscape .theater-meta,
    .theater-overlay--series-landscape .theater-close-btn-bottom {
        display: none;
    }
    @media (max-width: 900px) {
        .theater-overlay--series-landscape {
            display: flex;
            grid-template-columns: none;
        }
        .theater-overlay--series-landscape .theater-container {
            width: 100%;
            min-width: 0;
            max-width: min(96vw, 520px);
            max-height: 92vh;
            border-radius: 12px;
            padding: 1.25rem;
        }
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
    /* Smart framing: static poster ambient (no second MP4 decode/sync). */
    .theater-video-bg {
        position: absolute;
        inset: -8%;
        width: 116%;
        height: 116%;
        z-index: 0;
        pointer-events: none;
        overflow: hidden;
        background: radial-gradient(ellipse at center, #1c1c24 0%, #050508 68%);
    }
    .theater-video-bg.theater-video-bg-fallback {
        background:
            radial-gradient(ellipse at 50% 40%, rgba(0, 242, 255, 0.12) 0%, transparent 55%),
            radial-gradient(ellipse at center, #1c1c24 0%, #050508 68%);
    }
    .theater-video-bg :global(.theater-video-bg-image) {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scale(1.12);
        filter: blur(28px) brightness(0.55);
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
    .theater-episode-nav-notice p {
        margin: 0;
    }
    .theater-payment-actions {
        margin-top: 0.65rem;
        display: flex;
        gap: 0.45rem;
        justify-content: center;
        flex-wrap: wrap;
    }
    .theater-payment-btn {
        border: 1px solid rgba(247, 207, 74, 0.55);
        border-radius: 999px;
        background: rgba(247, 207, 74, 0.18);
        color: #fff7db;
        font-size: 0.66rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 0.35rem 0.7rem;
        cursor: pointer;
    }
    .theater-payment-btn--quiet {
        border-color: rgba(255, 255, 255, 0.25);
        background: transparent;
        color: rgba(255, 255, 255, 0.8);
        font-weight: 500;
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

    /* Portrait + landscape mobile — must not live inside landscape-only @media. */
    .theater-overlay--mobile .theater-sound-dock {
        position: fixed;
        right: max(0.75rem, env(safe-area-inset-right, 0px));
        bottom: max(1rem, env(safe-area-inset-bottom, 0px));
        z-index: 2200;
        width: 2.85rem;
        height: 2.85rem;
        min-width: 2.85rem;
        min-height: 2.85rem;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 999px;
        background: rgba(8, 10, 16, 0.88);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        pointer-events: auto;
    }

    .theater-overlay--mobile .theater-sound-dock--muted {
        border-color: rgba(250, 204, 21, 0.65);
        box-shadow:
            0 0 0 1px rgba(250, 204, 21, 0.35),
            0 8px 24px rgba(0, 0, 0, 0.55);
    }

    .theater-overlay--mobile .theater-sound-dock__icon {
        font-size: 1.2rem;
        line-height: 1;
    }

    /* Mobile-only presentation — desktop selectors above are unchanged. Playback path untouched. */
    @media (max-width: 640px), (hover: none) and (pointer: coarse) {
        .theater-container.theater-mobile {
            max-width: 100%;
            max-height: 100dvh;
            width: 100%;
            height: 100%;
            min-height: 100dvh;
            margin: 0;
            padding: 0;
            border-radius: 0;
            overflow: hidden;
            background: #000;
        }

        .theater-container.theater-mobile .theater-glow-border {
            display: none;
        }

        .theater-container.theater-mobile .theater-header,
        .theater-container.theater-mobile .theater-header--menu-raised {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            z-index: 40;
            flex-shrink: 0;
            margin: 0;
            padding: max(0.45rem, env(safe-area-inset-top, 0px))
                max(0.65rem, env(safe-area-inset-right, 0px))
                1.15rem
                max(0.65rem, env(safe-area-inset-left, 0px));
            background: linear-gradient(
                180deg,
                rgba(0, 0, 0, 0.72) 0%,
                rgba(0, 0, 0, 0.28) 70%,
                rgba(0, 0, 0, 0) 100%
            );
            pointer-events: none;
            opacity: 0;
            transform: translateY(-6px);
            transition: opacity 0.2s ease, transform 0.2s ease;
        }

        .theater-container.theater-mobile.theater-chrome-visible .theater-header,
        .theater-container.theater-mobile.theater-chrome-visible .theater-header--menu-raised {
            opacity: 1;
            transform: translateY(0);
            pointer-events: none;
        }

        .theater-container.theater-mobile .theater-close-btn,
        .theater-container.theater-mobile .theater-header-actions,
        .theater-container.theater-mobile .theater-series-btn,
        .theater-container.theater-mobile .theater-framing-btn {
            pointer-events: auto;
        }

        .theater-container.theater-mobile .theater-close-btn {
            min-width: 2.75rem;
            min-height: 2.75rem;
            padding: 0.55rem 0.85rem;
            z-index: 42;
            touch-action: manipulation;
        }

        .theater-container.theater-mobile .theater-header-actions,
        .theater-container.theater-mobile .theater-header-actions--visible {
            position: relative;
            z-index: 41;
            max-width: min(100%, 22rem);
        }

        .theater-container.theater-mobile .theater-title {
            max-width: 100%;
            white-space: nowrap;
            font-size: 1rem;
            text-shadow: 0 1px 12px rgba(0, 0, 0, 0.8);
        }

        .theater-container.theater-mobile .theater-video-wrapper,
        .theater-container.theater-mobile .theater-video-wrapper--mobile {
            position: absolute;
            inset: 0;
            flex: none;
            width: 100%;
            height: 100%;
            min-height: 100%;
            overflow: hidden;
            border-radius: 0;
            box-shadow: none;
            z-index: 2;
        }

        .theater-container.theater-mobile .theater-video-bg {
            overflow: hidden;
        }

        .theater-container.theater-mobile .theater-video-wrapper,
        .theater-container.theater-mobile .theater-video-wrapper--mobile {
            touch-action: none;
            -webkit-touch-callout: none;
            user-select: none;
            -webkit-user-select: none;
        }

        .theater-container.theater-mobile .theater-video-wrapper :global(.theater-video-fg) {
            position: absolute;
            inset: 0;
            z-index: 3;
            width: 100%;
            height: 100%;
            max-height: none;
            object-fit: cover;
            /* Wrapper owns tap/swipe — video must not steal iOS pointer events. */
            touch-action: none;
            pointer-events: none;
        }

        .theater-container.theater-mobile .theater-video-bg,
        .theater-container.theater-mobile .theater-video-bg :global(.theater-video-bg-image) {
            pointer-events: none;
        }

        .theater-container.theater-mobile .theater-video-wrapper.framing-fit :global(.theater-video-fg) {
            object-fit: contain;
        }

        .theater-container.theater-mobile .theater-close-btn-bottom {
            display: none;
        }
    }

    @media (max-width: 640px) and (orientation: landscape),
        (hover: none) and (pointer: coarse) and (orientation: landscape) {
        .theater-container.theater-mobile .theater-video-wrapper :global(.theater-video-fg) {
            max-height: none;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .theater-container.theater-mobile.theater-mobile-landscape .theater-header,
        .theater-container.theater-mobile.theater-mobile-landscape .theater-header--menu-raised,
        .theater-container.theater-mobile.theater-mobile-landscape.theater-chrome-visible
            .theater-header,
        .theater-container.theater-mobile.theater-mobile-landscape.theater-chrome-visible
            .theater-header--menu-raised {
            opacity: 0 !important;
            pointer-events: none !important;
            transform: translateY(-6px);
        }

        .theater-container.theater-mobile.theater-mobile-landscape .theater-video-wrapper,
        .theater-container.theater-mobile.theater-mobile-landscape .theater-video-wrapper--landscape {
            touch-action: none;
        }

        .theater-landscape-gesture-hint {
            position: absolute;
            inset: 0;
            z-index: 20;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            animation: theaterLandscapeHintFade 0.55s ease forwards;
        }

        .theater-landscape-gesture-hint__icon {
            font-size: clamp(1.75rem, 6vw, 2.75rem);
            font-weight: 600;
            color: rgba(255, 255, 255, 0.94);
            text-shadow: 0 2px 28px rgba(0, 0, 0, 0.82);
            letter-spacing: 0.04em;
        }

        @keyframes theaterLandscapeHintFade {
            0% {
                opacity: 0;
                transform: scale(0.92);
            }
            18% {
                opacity: 1;
                transform: scale(1);
            }
            72% {
                opacity: 1;
                transform: scale(1);
            }
            100% {
                opacity: 0;
                transform: scale(1);
            }
        }
    }
</style>
