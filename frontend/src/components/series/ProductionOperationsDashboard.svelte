<script>
    import { createEventDispatcher } from 'svelte';
    import ProductionCommandCenter from '../command/ProductionCommandCenter.svelte';

    const dispatch = createEventDispatcher();

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let selectedSeriesId = 'series-neon-vengeance';

    function handleChanged() {
        dispatch('changed');
    }
</script>

<div data-production-operations-dashboard>
    <ProductionCommandCenter
        {feedReels}
        bind:selectedSeriesId
        on:changed={handleChanged}
    />
</div>
