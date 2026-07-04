<script>
    import MediaRenderer from './MediaRenderer.svelte';
    import { isPassthroughMediaUrl } from './resolveDisplayUrl.js';

    /** @type {string | null | undefined} */
    export let url = '';

    /**
     * background — div with background-image via MediaRenderer (default)
     * attribute — slot exposes raw url; bind poster on MediaRenderer instead
     */
    export let mode = 'background';

    /** @type {string} */
    export let alt = '';

    /** @type {string | undefined} */
    export let aspectRatio = undefined;

    /** @type {string} */
    export let className = '';

    /** Use data:/blob: as-is (hero image persistence). */
    export let allowDataUrl = true;

    $: passthrough = allowDataUrl && isPassthroughMediaUrl(url);
</script>

{#if mode === 'background'}
    <MediaRenderer type="poster" {url} {alt} {aspectRatio} {className} raw={passthrough} {...$$restProps}>
        <slot />
    </MediaRenderer>
{:else}
    <slot resolved={url} />
{/if}
