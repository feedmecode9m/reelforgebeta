<script>
    import MediaRenderer from './MediaRenderer.svelte';

    /** @type {string | null | undefined} */
    export let url = '';

    /** @type {string} */
    export let alt = '';

    /** @type {string | undefined} */
    export let aspectRatio = undefined;

    export let lazyLoad = true;

    /** @type {string} */
    export let className = '';

    /** @deprecated Use lazyLoad — kept for existing call sites. */
    export let loading = '';

    /** Skip backend resolve (blob/data preview URLs). */
    export let raw = false;
</script>

<MediaRenderer
    type="thumbnail"
    {url}
    {alt}
    {aspectRatio}
    {className}
    {raw}
    lazyLoad={loading === 'lazy' || lazyLoad}
    on:load
    on:error
/>
