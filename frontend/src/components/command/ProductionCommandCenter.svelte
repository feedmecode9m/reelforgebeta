<script>
    import ProductionCommandCenter from '../studio/ProductionCommandCenter.svelte';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let selectedSeriesId = 'series-neon-vengeance';
</script>

<ProductionCommandCenter {feedReels} bind:selectedSeriesId on:changed />
