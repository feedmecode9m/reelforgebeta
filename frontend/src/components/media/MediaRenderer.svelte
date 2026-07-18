<script>
    import { onMount, createEventDispatcher } from 'svelte';
    import { DEFAULT_MEDIA_PLACEHOLDER, videoMimeForPath } from '../../lib/config.js';
    import { logBg7kPlaceholderFallback } from '../../lib/diagnostics/bg7kCardRenderTrace.js';
    import { logMediaRendererEvent } from '../../lib/diagnostics/renderGateForensics.js';
    import { resolveMediaForRender, resolveValidatedVideoUrl, isPassthroughMediaUrl } from './resolveDisplayUrl.js';

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

    export let autoplay = false;
    export let muted = false;
    export let loop = false;
    export let controls = false;
    export let playsinline = false;

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

    $: mediaType = (() => {
        if (type && type !== 'thumbnail') return type;
        if (kind === 'video') return 'video';
        if (kind === 'image') return 'thumbnail';
        if (type) return type;
        return 'thumbnail';
    })();

    $: resolvedSrc = (() => {
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

    $: aspectStyle = aspectRatio ? `aspect-ratio: ${aspectRatio};` : '';
    $: posterBackgroundStyle =
        mediaType === 'poster' && posterSrc
            ? `${aspectStyle}background-image: url('${posterSrc}');`
            : aspectStyle;

    $: imgLoading = lazyLoad ? 'lazy' : undefined;

    function mediaCtx() {
        return { url, resolvedSrc, mediaType };
    }

    function forwardVideoEvent(name, event) {
        const target = /** @type {HTMLVideoElement | null} */ (event?.currentTarget || videoElement);
        logMediaRendererEvent(name, target, mediaCtx());
        dispatch(name, event);
    }

    onMount(() => {
        logMediaRendererEvent('mounted', videoElement, mediaCtx());
        if (!import.meta.env.DEV) return;
        const element = mediaType === 'video' ? 'video' : mediaType === 'poster' ? 'div' : 'img';
        console.debug('[MediaRenderer]', {
            type: mediaType,
            originalUrl: url,
            resolvedUrl: resolvedSrc,
            element,
            timestamp: new Date().toISOString()
        });
    });

    function applyImageFallback(node) {
        const handler = () => {
            if (!resolvedFallback) return;
            const currentSrc = node.getAttribute('src') || '';
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
            {autoplay}
            {muted}
            {loop}
            {controls}
            {playsinline}
            preload={preload || undefined}
            width={width || undefined}
            height={height || undefined}
            use:action={action}
            on:loadeddata={(e) => forwardVideoEvent('loadeddata', e)}
            on:loadedmetadata={(e) => forwardVideoEvent('loadedmetadata', e)}
            on:error={(e) => forwardVideoEvent('error', e)}
            on:play
            on:pause
            on:ended
            on:mouseenter
            on:mouseleave
            on:click
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
            {autoplay}
            {muted}
            {loop}
            {controls}
            {playsinline}
            preload={preload || undefined}
            width={width || undefined}
            height={height || undefined}
            on:loadeddata={(e) => forwardVideoEvent('loadeddata', e)}
            on:loadedmetadata={(e) => forwardVideoEvent('loadedmetadata', e)}
            on:error={(e) => forwardVideoEvent('error', e)}
            on:play
            on:pause
            on:ended
            on:mouseenter
            on:mouseleave
            on:click
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
