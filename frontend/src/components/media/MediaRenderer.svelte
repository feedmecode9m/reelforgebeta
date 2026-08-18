<script>
    import { onMount, createEventDispatcher } from 'svelte';
    import { DEFAULT_MEDIA_PLACEHOLDER, videoMimeForPath } from '../../lib/config.js';
    import { logBg7kPlaceholderFallback } from '../../lib/diagnostics/bg7kCardRenderTrace.js';
    import { logMediaRendererEvent } from '../../lib/diagnostics/renderGateForensics.js';
    import { resolveMediaForRender, resolveValidatedVideoUrl, isPassthroughMediaUrl } from './resolveDisplayUrl.js';
    import {
        getPlaybackOwner,
        getPlaybackOwnerSnapshot,
        tagVideoPlaybackRole,
        canAttachMediaForRole,
        isTheaterProtectedMasterUrl,
        playbackOwner
    } from '../../lib/media/playbackOwnership.js';

    const dispatch = createEventDispatcher();

    /** @type {'video' | 'thumbnail' | 'poster'} */
    export let type = 'thumbnail';

    /** @deprecated Use `type` — 'image' maps to 'thumbnail', 'video' unchanged. */
    export let kind = undefined;

    /** @type {string | null | undefined} */
    export let url = '';

    /** @type {string | null | undefined} */
    export let poster = '';

    /** @type {string} */
    export let alt = '';

    /** @type {string | undefined} */
    export let aspectRatio = undefined;

    export let lazyLoad = false;

    /** Explicit opt-in — never default to true. */
    export let autoplay = false;
    export let muted = false;
    export let loop = false;
    export let controls = false;
    /** Required for iOS/Android inline playback (otherwise Safari force-fullscreens). */
    export let playsinline = true;

    /** @type {string} */
    export let className = '';
    export let fallbackUrl = DEFAULT_MEDIA_PLACEHOLDER;

    /** Use <source> child instead of src attribute (shelf/hero feed cards). */
    export let useSourceElement = false;

    /** Apply sanitizeGoogleDriveUrl + isValidVideoUrl before resolve (shelf cards). */
    export let validateVideo = false;

    /** blob:/data: passthrough without backend resolve. */
    export let raw = false;

    /** @type {string | undefined} */
    export let mimeType = undefined;

    /**
     * Least-expensive default for video: no speculative download.
     * Callers that need earliest frame (hero/theater) must pass "metadata".
     * @type {string | undefined}
     */
    export let preload = undefined;

    export let width = undefined;
    export let height = undefined;

    /** Svelte use: action forwarded to <video> (theater mount). */
    export let action = undefined;

    /** bind:videoElement for hero persistence */
    export let videoElement = null;

    /** Shelf cards include empty captions track */
    export let captionsTrack = false;

    /** Sets data-theater-video on <video> (theater mount diagnostics). */
    export let dataTheaterVideo = false;

    /**
     * Logical bandwidth owner for this element: hero | theater | preview.
     * Diagnostics only — claim/release lives in playbackOwnership + surfaces.
     * @type {string}
     */
    export let playbackRole = '';

    $: mediaType = (() => {
        if (type && type !== 'thumbnail') return type;
        if (kind === 'video') return 'video';
        if (kind === 'image') return 'thumbnail';
        if (type) return type;
        return 'thumbnail';
    })();

    // Reactive owner: when Theater claims bandwidth, hero/preview must drop network sources.
    $: activePlaybackOwner = $playbackOwner;

    $: resolvedSrc = (() => {
        // While Theater owns playback, block Hero/Vault/preview (and any protected master URL).
        if (mediaType === 'video' && activePlaybackOwner === 'theater' && playbackRole !== 'theater') {
            if (!canAttachMediaForRole(playbackRole) || isTheaterProtectedMasterUrl(url)) {
                return '';
            }
        }
        if (raw) return url || '';
        if (mediaType === 'video' && validateVideo) {
            const validated = resolveValidatedVideoUrl(url);
            if (!validated && url) {
                logBg7kPlaceholderFallback('', 'video_url_validation_failed', { url: String(url) });
            }
            return validated;
        }
        const resolved = resolveMediaForRender(url, mediaType, 'MediaRenderer');
        if (!resolved && url) {
            logBg7kPlaceholderFallback('', 'media_resolve_empty', { url: String(url), mediaType });
        }
        return resolved;
    })();

    $: resolvedPoster = poster
        ? raw || isPassthroughMediaUrl(poster)
            ? poster
            : resolveMediaForRender(poster, 'poster', 'MediaRenderer:poster')
        : '';
    $: resolvedFallback = fallbackUrl
        ? resolveMediaForRender(fallbackUrl, 'thumbnail', 'MediaRenderer:fallback')
        : '';
    let posterSrc = '';
    $: posterSrc = resolvedSrc || resolvedFallback;

    $: videoMime = mimeType || videoMimeForPath(resolvedSrc || url || '');

    /** Default preload=none for video unless caller opts into metadata/auto. */
    $: effectivePreload =
        mediaType === 'video'
            ? preload == null || preload === ''
                ? 'none'
                : String(preload)
            : preload || undefined;

    $: aspectStyle = aspectRatio ? `aspect-ratio: ${aspectRatio};` : '';
    $: posterBackgroundStyle =
        mediaType === 'poster' && posterSrc
            ? `${aspectStyle}background-image: url('${posterSrc}');`
            : aspectStyle;

    $: imgLoading = lazyLoad ? 'lazy' : undefined;

    function mediaCtx() {
        const snap = getPlaybackOwnerSnapshot();
        return {
            url,
            resolvedSrc,
            mediaType,
            autoplay: Boolean(autoplay),
            preload: effectivePreload,
            playbackRole: String(playbackRole || '') || null,
            activePlaybackOwner: snap.owner
        };
    }

    function forwardVideoEvent(name, event) {
        const target = /** @type {HTMLVideoElement | null} */ (event?.currentTarget || videoElement);
        logMediaRendererEvent(name, target, mediaCtx());
        dispatch(name, event);
    }

    function logVideoMountDiag(node) {
        if (!node) return;
        tagVideoPlaybackRole(node, playbackRole);
        if (!import.meta.env.DEV) return;
        const snap = getPlaybackOwnerSnapshot();
        console.info('[MediaRenderer:video]', {
            src: node.currentSrc || node.getAttribute('src') || resolvedSrc || url || null,
            autoplay: Boolean(autoplay),
            muted: Boolean(muted),
            preload: effectivePreload || null,
            playbackRole: String(playbackRole || '') || null,
            activePlaybackOwner: snap.owner,
            dataTheaterVideo: Boolean(dataTheaterVideo),
            timestamp: new Date().toISOString()
        });
    }

    onMount(() => {
        logMediaRendererEvent('mounted', videoElement, mediaCtx());
        if (mediaType === 'video' && videoElement) {
            logVideoMountDiag(videoElement);
        } else if (import.meta.env.DEV) {
            const element = mediaType === 'video' ? 'video' : mediaType === 'poster' ? 'div' : 'img';
            console.debug('[MediaRenderer]', {
                type: mediaType,
                originalUrl: url,
                resolvedUrl: resolvedSrc,
                autoplay: Boolean(autoplay),
                preload: effectivePreload,
                playbackRole: playbackRole || null,
                activePlaybackOwner: getPlaybackOwner(),
                element,
                timestamp: new Date().toISOString()
            });
        }
    });

    $: if (videoElement && mediaType === 'video') {
        tagVideoPlaybackRole(videoElement, playbackRole);
    }

    function applyImageFallback(node) {
        let thumbRetries = 0;
        /** @type {ReturnType<typeof setTimeout>[]} */
        const retryTimers = [];
        const handler = () => {
            const currentSrc = node.getAttribute('src') || '';
            const thumbPath = currentSrc.split('?')[0];
            if (/\/thumbs\//i.test(thumbPath) && thumbRetries < 3) {
                thumbRetries += 1;
                const delay = 700 * thumbRetries;
                retryTimers.push(
                    setTimeout(() => {
                        node.setAttribute('src', `${thumbPath}?v=${Date.now()}`);
                    }, delay)
                );
                return;
            }
            if (!resolvedFallback) return;
            const absoluteCurrent = new URL(currentSrc, window.location.href).href;
            const absoluteFallback = new URL(resolvedFallback, window.location.href).href;
            if (absoluteCurrent !== absoluteFallback) {
                logBg7kPlaceholderFallback('', 'image_error_fallback_svg', {
                    failedSrc: currentSrc,
                    fallbackSrc: resolvedFallback
                });
                node.setAttribute('src', resolvedFallback);
            }
        };
        node.addEventListener('error', handler);
        return {
            destroy() {
                node.removeEventListener('error', handler);
                retryTimers.forEach((id) => clearTimeout(id));
            }
        };
    }
</script>

{#if mediaType === 'video' && resolvedSrc}
    {#if action}
        <video
            bind:this={videoElement}
            class={className}
            style={aspectStyle || undefined}
            src={useSourceElement ? undefined : resolvedSrc}
            poster={resolvedPoster || undefined}
            data-theater-video={dataTheaterVideo ? '' : undefined}
            data-media-renderer
            data-viewer-media-exempt
            data-playback-role={playbackRole || undefined}
            data-autoplay={autoplay ? 'true' : 'false'}
            data-preload={effectivePreload || undefined}
            {autoplay}
            {muted}
            {loop}
            {controls}
            {playsinline}
            webkit-playsinline={playsinline ? true : undefined}
            preload={effectivePreload || undefined}
            width={width || undefined}
            height={height || undefined}
            use:action={action}
            on:loadeddata={(e) => forwardVideoEvent('loadeddata', e)}
            on:loadedmetadata={(e) => forwardVideoEvent('loadedmetadata', e)}
            on:error={(e) => forwardVideoEvent('error', e)}
            on:play
            on:pause
            on:ended
            on:volumechange
            on:timeupdate
            on:waiting
            on:stalled
            on:suspend
            on:progress
            on:canplay
            on:canplaythrough
            on:seeking
            on:seeked
            on:mouseenter
            on:mouseleave
            on:click
            on:pointerup
            on:touchend
        >
            {#if useSourceElement}
                <source src={resolvedSrc} type={videoMime} />
            {/if}
            {#if captionsTrack}
                <track kind="captions" src="" srclang="en" label="English" />
            {/if}
        </video>
    {:else}
        <video
            bind:this={videoElement}
            class={className}
            style={aspectStyle || undefined}
            src={useSourceElement ? undefined : resolvedSrc}
            poster={resolvedPoster || undefined}
            data-theater-video={dataTheaterVideo ? '' : undefined}
            data-media-renderer
            data-viewer-media-exempt
            data-playback-role={playbackRole || undefined}
            data-autoplay={autoplay ? 'true' : 'false'}
            data-preload={effectivePreload || undefined}
            {autoplay}
            {muted}
            {loop}
            {controls}
            {playsinline}
            webkit-playsinline={playsinline ? true : undefined}
            preload={effectivePreload || undefined}
            width={width || undefined}
            height={height || undefined}
            on:loadeddata={(e) => forwardVideoEvent('loadeddata', e)}
            on:loadedmetadata={(e) => forwardVideoEvent('loadedmetadata', e)}
            on:error={(e) => forwardVideoEvent('error', e)}
            on:play
            on:pause
            on:ended
            on:volumechange
            on:timeupdate
            on:waiting
            on:stalled
            on:suspend
            on:progress
            on:canplay
            on:canplaythrough
            on:seeking
            on:seeked
            on:mouseenter
            on:mouseleave
            on:click
            on:pointerup
            on:touchend
        >
            {#if useSourceElement}
                <source src={resolvedSrc} type={videoMime} />
            {/if}
            {#if captionsTrack}
                <track kind="captions" src="" srclang="en" label="English" />
            {/if}
        </video>
    {/if}
{:else if mediaType === 'poster' && (resolvedSrc || resolvedFallback)}
    <div
        class="{className} media-poster-bg"
        style={posterBackgroundStyle}
        role="img"
        aria-label={alt || undefined}
        data-media-renderer
        data-viewer-media-exempt
        {...$$restProps}
    >
        <img
            class="media-poster-probe"
            src={posterSrc}
            alt=""
            aria-hidden="true"
            on:error={() => {
                if (resolvedFallback && posterSrc !== resolvedFallback) {
                    posterSrc = resolvedFallback;
                }
            }}
        />
        <slot />
    </div>
{:else if mediaType === 'thumbnail' && (resolvedSrc || resolvedFallback)}
    <img
        src={resolvedSrc || resolvedFallback}
        alt={alt}
        class={className}
        style={aspectStyle || undefined}
        loading={imgLoading}
        data-media-renderer
        data-viewer-media-exempt
        use:applyImageFallback
        {...$$restProps}
        on:load
        on:error
    />
{/if}

<style>
    .media-poster-bg {
        position: relative;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
    }
    .media-poster-probe {
        position: absolute;
        width: 0;
        height: 0;
        opacity: 0;
        pointer-events: none;
    }
</style>
