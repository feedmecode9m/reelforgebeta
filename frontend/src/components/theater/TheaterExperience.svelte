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
        mergePlaybackDerivativeFields,
        resolvePlayableMediaUrl as resolvePlayableMediaUrlForTheater
    } from '../../lib/media/resolvePlayableMediaUrl.js';

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
        // Prefer ready derivative from any source before first Theater media attachment.
        const playbackMeta = mergePlaybackDerivativeFields(reel, fromFeed, vaultHit);
        let fresh = {
            ...(fromFeed && typeof fromFeed === 'object' ? fromFeed : {}),
            ...(vaultHit && typeof vaultHit === 'object' ? vaultHit : {}),
            ...reel,
            ...playbackMeta
        };
        return fresh;
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
        // Phase 1: own bandwidth + unload hero/preview masters BEFORE any Theater <video> src binds.
        beginTheaterExclusiveSession('theater-open-before-attach');

        let fresh = enrichTheaterReelForPlayback(/** @type {Record<string, unknown>} */ (reel));
        if (!fresh) return;

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
        // Defensive: stamp the resolved theater playable url so intermediate objects can't lose ready derivative.
        const preferred = resolvePlayableMediaUrlForTheater(fresh, 'theater', { silent: true });
        if (preferred) {
            const master = String(fresh.url || fresh.video_url || '').trim();
            // When ready derivative wins, expose it explicitly alongside master.
            if (
                preferred !== master &&
                (preferred.includes('.playback.') || preferred.endsWith('.playback.mp4'))
            ) {
                fresh = {
                    ...fresh,
                    playbackUrl: preferred,
                    playback_url: preferred,
                    playbackStatus: String(fresh.playbackStatus || fresh.playback_status || 'ready')
                };
            }
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
        logTheater('📺 Theater video mounted', { src: node.currentSrc || node.src });
        if (DEBUG_THEATER || import.meta.env.DEV) {
            const insp = inspectTheaterPlaybackElements();
            logTheater('playback exclusive check', insp);
            if (insp.theaterVideos > 1 || insp.theaterSrcs.length > 1) {
                console.warn('[THEATER] multiple primary theater videos or MP4 sources', insp);
            }
        }
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
    import { resolvePlayableMediaUrl } from '../../lib/media/resolvePlayableMediaUrl.js';
    import SeriesDrawer from '../series/SeriesDrawer.svelte';
    import TheaterSeriesPanel from '../series/TheaterSeriesPanel.svelte';
    import TheaterSeriesMetadata from '../publishing/TheaterSeriesMetadata.svelte';
    import { reelSeriesMetadata, getSeriesById, getEpisodeByReelId, seriesCatalog } from '../../lib/series/seriesStore.js';
    import {
        resolveContentIdentity,
        applyContentIdentityToSeriesContext
    } from '../../lib/content/contentIdentityResolver.js';

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

    /**
     * Mobile theater presentation: touch/coarse-pointer devices do not reliably show
     * native video volume chrome, and overflow:hidden can clip menu + control bars.
     * Desktop path leaves controls as always-native (no mobile chrome).
     */
    let isMobileTheater = false;
    /** Autoplay requires muted; after gesture, user mute state is tracked (never force-mute). */
    let theaterMuted = true;
    let theaterVolume = 1;
    let controlsVisible = true;
    let volumeVisible = true;
    let menuVisible = true;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let mobileControlsHideTimer = null;
    /** @type {MediaQueryList | null} */
    let mobileTheaterMql = null;

    /** @param {string} reason */
    function reportTheaterControls(reason) {
        logTheaterControls({
            deviceType: isMobileTheater ? 'mobile' : 'desktop',
            isMobile: isMobileTheater,
            controlsVisible,
            volumeVisible,
            menuVisible,
            reason,
            muted: theaterMuted,
            volume: theaterVolume
        });
    }

    function detectMobileTheater() {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return false;
        }
        // Coarse pointer / no-hover covers phones & tablets; narrow width covers landscape phones.
        return (
            window.matchMedia('(hover: none) and (pointer: coarse)').matches ||
            window.matchMedia('(max-width: 640px)').matches
        );
    }

    function syncMobileTheaterFlag(reason = 'detect') {
        const next = detectMobileTheater();
        const changed = next !== isMobileTheater;
        isMobileTheater = next;
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
            // Fresh mobile open — chrome hidden until first playback/tap (native-like).
            controlsVisible = false;
            volumeVisible = false;
            menuVisible = true; // framing / episodes / close stay reachable in header
        }
        reportTheaterControls(reason);
    }

    /** Reveal mobile volume chrome + keep menu raised; auto-hide only volume strip. */
    function showMobileTheaterControls(reason = 'tap') {
        if (!isMobileTheater) {
            reportTheaterControls(reason);
            return;
        }
        controlsVisible = true;
        volumeVisible = true;
        menuVisible = true;
        reportTheaterControls(reason);
        if (mobileControlsHideTimer != null) clearTimeout(mobileControlsHideTimer);
        mobileControlsHideTimer = setTimeout(() => {
            // Menu stays accessible; volume chrome can dim after idle.
            volumeVisible = false;
            controlsVisible = Boolean(theaterManager.videoElement && !theaterManager.videoElement.paused);
            reportTheaterControls('auto_hide_idle');
            mobileControlsHideTimer = null;
        }, 4500);
    }

    function applyTheaterMuteState(nextMuted) {
        theaterMuted = Boolean(nextMuted);
        const el = theaterManager.videoElement;
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
    }

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
        // Keep overlay-close from stealing video hits; still allow native control chrome.
        e.stopPropagation();
        if (isMobileTheater) {
            showMobileTheaterControls(e.type === 'touchend' ? 'touch' : 'pointer');
        }
    }

    onMount(() => {
        syncMobileTheaterFlag('mount');
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        mobileTheaterMql = window.matchMedia('(hover: none) and (pointer: coarse), (max-width: 640px)');
        const onChange = () => syncMobileTheaterFlag('viewport_change');
        if (typeof mobileTheaterMql.addEventListener === 'function') {
            mobileTheaterMql.addEventListener('change', onChange);
        } else if (typeof mobileTheaterMql.addListener === 'function') {
            mobileTheaterMql.addListener(onChange);
        }
        return () => {
            if (!mobileTheaterMql) return;
            if (typeof mobileTheaterMql.removeEventListener === 'function') {
                mobileTheaterMql.removeEventListener('change', onChange);
            } else if (typeof mobileTheaterMql.removeListener === 'function') {
                mobileTheaterMql.removeListener(onChange);
            }
        };
    });
    onDestroy(() => {
        if (mobileControlsHideTimer != null) clearTimeout(mobileControlsHideTimer);
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
    $: if (!$activeReel) {
        seriesDrawerOpen = false;
        selectedSeriesEpisodeId = '';
        episodeNavNotice = '';
        theaterBgPosterFailed = false;
    }
    /**
     * Mount the existing SeriesDrawer shelf when Theater has series episodes so
     * episode posters are discoverable without requiring ALL EPISODES first.
     * Uses the same SeriesDrawer + SeasonAccordion + EpisodeChip path (no second list).
     * ALL EPISODES control remains for re-open after dismiss. Does not change selection/playback.
     * Only re-runs when $activeReel / hasSeriesDrawer change — manual close is respected until then.
     */
    $: if ($activeReel && hasSeriesDrawer) {
        seriesDrawerOpen = true;
    }

    let lastTheaterVideoKey = '';
    $: if (theaterVideoKey && theaterVideoKey !== lastTheaterVideoKey) {
        lastTheaterVideoKey = theaterVideoKey;
        // New stream → re-start muted for autoplay policy; mobile chrome waits for play/tap.
        theaterMuted = true;
        if (isMobileTheater) {
            controlsVisible = false;
            volumeVisible = false;
            menuVisible = true;
            reportTheaterControls('video_source_change');
        }
    }

    /** @param {CustomEvent<{ episodeId: string }>} event */
    function handleSeriesEpisodeSelect(event) {
        const episodeId = event.detail.episodeId;
        selectedSeriesEpisodeId = episodeId;
        const detailReelId = event.detail?.reelId ? String(event.detail.reelId) : '';
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
        const reelId =
            detailReelId ||
            (event.detail?.mediaAssetId ? String(event.detail.mediaAssetId) : '') ||
            relatedEpisodes?.members?.find(
                (m) =>
                    m.episodeId === episodeId ||
                    m.assetId === detailReelId ||
                    m.assetId === String(event.detail?.mediaAssetId || '')
            )?.reelId ||
            drawerSeriesView?.seasons
                ?.flatMap((s) => s.episodes || [])
                .find((e) => e.episodeId === episodeId)?.reelId ||
            '';
        if (reelId) {
            const fromVault = ($personalVideos || []).find((v) => String(v?.id || '') === reelId);
            const fromReady = relatedReadyAssets.find(
                (v) => String(v?.id || v?.assetId || '') === reelId
            );
            const candidate = fromVault || fromReady;
            if (candidate && typeof openTheaterReel === 'function') {
                openTheaterReel(candidate);
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
            ? resolvePlayableMediaUrl($activeReel, 'theater')
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
            class:theater-controls-visible={controlsVisible}
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
                    on:pointerup={(e) => {
                        if (isMobileTheater && e.target === e.currentTarget) {
                            showMobileTheaterControls('wrapper_pointer');
                        }
                    }}
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
                            controls
                            playsinline
                            playbackRole="theater"
                            on:ended={handleTheaterEnded}
                            on:timeupdate={(e) => {
                                handleTheaterTimeupdate(e);
                                theaterWatchOnProgress(e.currentTarget);
                            }}
                            on:volumechange={handleTheaterVideoVolumeChange}
                            on:play={(e) => {
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
                            on:touchend={handleTheaterVideoInteraction}
                        />
                    {/key}
                    {#if isMobileTheater}
                        <div
                            class="theater-mobile-controls"
                            class:is-visible={volumeVisible}
                            role="toolbar"
                            aria-label="Theater volume controls"
                            aria-hidden={!volumeVisible}
                        >
                            <button
                                type="button"
                                class="theater-mobile-mute"
                                aria-pressed={!theaterMuted}
                                aria-label={theaterMuted ? 'Unmute video' : 'Mute video'}
                                on:click|stopPropagation={toggleTheaterMute}
                            >{theaterMuted ? 'Unmute' : 'Mute'}</button>
                            <input
                                class="theater-mobile-volume"
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={theaterMuted ? 0 : theaterVolume}
                                aria-label="Volume"
                                on:input|stopPropagation={handleTheaterVolumeInput}
                                on:pointerdown|stopPropagation
                            />
                        </div>
                    {/if}
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
                seriesId={drawerSeriesId || relatedEpisodes?.seriesId || ''}
                seriesView={drawerSeriesView}
                seedAsset={$activeReel}
                readyAssets={relatedReadyAssets}
                selectedEpisodeId={selectedSeriesEpisodeId}
                viewerMode={true}
                docked={seriesDrawerDocked}
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
        width: 100%;
        height: 100%;
        border-radius: 0;
        margin: 0;
        flex: unset;
        padding: 1rem 1.25rem;
        box-sizing: border-box;
    }
    .theater-overlay--series-landscape .theater-glow-border {
        display: none;
    }
    @media (max-width: 900px) {
        .theater-overlay--series-landscape {
            display: flex;
            grid-template-columns: none;
        }
        .theater-overlay--series-landscape .theater-container {
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

    /* Mobile-only presentation fixes — desktop selectors above are unchanged. */
    .theater-mobile-controls {
        display: none;
    }

    @media (max-width: 640px), (hover: none) and (pointer: coarse) {
        .theater-container.theater-mobile {
            max-height: min(100dvh, 100vh);
            /* Prevent clipping header menus + control chrome under immersive overflow. */
            overflow-x: hidden;
            overflow-y: auto;
        }

        .theater-container.theater-mobile .theater-header,
        .theater-container.theater-mobile .theater-header--menu-raised {
            position: sticky;
            top: 0;
            z-index: 40;
            flex-shrink: 0;
            margin-bottom: 0.65rem;
            padding: 0.35rem 0 0.55rem;
            background: linear-gradient(
                180deg,
                rgba(12, 12, 16, 0.96) 0%,
                rgba(12, 12, 16, 0.88) 70%,
                rgba(12, 12, 16, 0) 100%
            );
            pointer-events: auto;
        }

        .theater-container.theater-mobile .theater-header-actions,
        .theater-container.theater-mobile .theater-header-actions--visible {
            position: relative;
            z-index: 41;
            pointer-events: auto;
            max-width: min(100%, 22rem);
        }

        .theater-container.theater-mobile .theater-title {
            max-width: 100%;
            white-space: normal;
            font-size: 1.15rem;
        }

        .theater-container.theater-mobile .theater-video-wrapper,
        .theater-container.theater-mobile .theater-video-wrapper--mobile {
            /* Native control bars are often clipped by overflow:hidden on iOS/Android. */
            overflow: visible;
            z-index: 2;
        }

        .theater-container.theater-mobile .theater-video-bg {
            overflow: hidden;
            border-radius: 8px;
        }

        .theater-container.theater-mobile .theater-video-wrapper :global(.theater-video-fg) {
            position: relative;
            z-index: 3;
            /* Leave room so native + mobile volume chrome stay hit-testable */
            max-height: min(62vh, 70dvh);
        }

        .theater-mobile-controls {
            display: flex;
            align-items: center;
            gap: 0.65rem;
            position: absolute;
            left: 0.5rem;
            right: 0.5rem;
            bottom: 0.55rem;
            z-index: 12;
            padding: 0.45rem 0.65rem;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.72);
            border: 1px solid rgba(255, 255, 255, 0.18);
            opacity: 0;
            pointer-events: none;
            transform: translateY(6px);
            transition: opacity 0.18s ease, transform 0.18s ease;
        }

        .theater-mobile-controls.is-visible {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0);
        }

        .theater-mobile-mute {
            flex-shrink: 0;
            border: 1px solid rgba(255, 255, 255, 0.28);
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
            border-radius: 4px;
            padding: 0.35rem 0.55rem;
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            cursor: pointer;
            min-height: 2rem;
        }

        .theater-mobile-volume {
            flex: 1;
            min-width: 0;
            accent-color: var(--neon-cyan, #00f2ff);
            height: 1.5rem;
        }
    }
</style>
