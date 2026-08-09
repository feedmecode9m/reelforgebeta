<script>
    import ProductionCommandCenter from '../studio/ProductionCommandCenter.svelte';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let selectedSeriesId = null;
</script>

<ProductionCommandCenter {feedReels} bind:selectedSeriesId on:changed />
