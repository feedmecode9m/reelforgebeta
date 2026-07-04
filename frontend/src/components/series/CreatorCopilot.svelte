<!-- @deprecated Import from `../copilot/CreatorCopilot.svelte` -->
<script>
    import CreatorCopilot from '../copilot/CreatorCopilot.svelte';

    /** @type {Record<string, unknown>[]} */
    export let feedReels = [];

    /** @type {string} */
    export let seriesId = '';
</script>

<CreatorCopilot {feedReels} {seriesId} />
