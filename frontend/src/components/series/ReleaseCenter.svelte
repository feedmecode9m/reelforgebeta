<!-- @deprecated Import from `../release/ReleaseCenter.svelte` -->
<script>
    import ReleaseCenter from '../release/ReleaseCenter.svelte';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = '';
</script>

<ReleaseCenter {feedReels} {seriesId} on:scheduled />
