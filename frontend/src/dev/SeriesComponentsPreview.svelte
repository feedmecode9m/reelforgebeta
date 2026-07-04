<script>
    import SeriesBadge from '../components/series/SeriesBadge.svelte';
    import EpisodeChip from '../components/series/EpisodeChip.svelte';
    import SeasonAccordion from '../components/series/SeasonAccordion.svelte';
    import SeriesDrawer from '../components/series/SeriesDrawer.svelte';
    import { seriesCatalog } from '../lib/series/seriesStore.js';

    let drawerOpen = true;
    let selectedEpisodeId = 'ep-neon-s01e01';
    $: previewSeries = $seriesCatalog[0];
    $: previewSeason = previewSeries?.seasons?.[0];
</script>

<div class="series-preview" data-series-preview>
    <header class="series-preview__header">
        <h1>Series Components Preview</h1>
        <p>Phase 2 mock-data harness — not wired to Viewer.</p>
    </header>

    <section class="series-preview__panel">
        <h2>SeriesBadge</h2>
        <SeriesBadge episodeId="ep-neon-s01e03" />
    </section>

    <section class="series-preview__panel">
        <h2>EpisodeChip</h2>
        <div class="series-preview__chips">
            <EpisodeChip seasonNumber={1} episodeNumber={3} title="Midnight Firewall" episodeId="ep-neon-s01e03" status="ready" playable={true} selected={true} />
            <EpisodeChip seasonNumber={1} episodeNumber={4} title="Zero Day" episodeId="ep-neon-s01e04" status="draft" playable={false} />
        </div>
    </section>

    {#if previewSeries && previewSeason}
        <section class="series-preview__panel">
            <h2>SeasonAccordion</h2>
            <SeasonAccordion
                seriesId={previewSeries.id}
                season={previewSeason}
                defaultExpanded={true}
                selectedEpisodeId={selectedEpisodeId}
                on:episodeSelect={(e) => { selectedEpisodeId = e.detail.episodeId; }}
            />
        </section>
    {/if}

    <section class="series-preview__panel">
        <h2>SeriesDrawer</h2>
        <button type="button" class="series-preview__open" on:click={() => { drawerOpen = true; }}>Open Episode Browser</button>
        <SeriesDrawer
            bind:open={drawerOpen}
            seriesId="series-neon-vengeance"
            bind:selectedEpisodeId
            on:episodeSelect={(e) => { selectedEpisodeId = e.detail.episodeId; }}
        />
    </section>
</div>

<style>
    :global(body) {
        margin: 0;
        background: #000;
        color: #fff;
        font-family: system-ui, sans-serif;
    }
    .series-preview {
        max-width: 720px;
        margin: 0 auto;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
    }
    .series-preview__header h1 {
        margin: 0 0 0.35rem;
        font-size: 1.4rem;
        color: var(--neon-cyan, #00f2ff);
    }
    .series-preview__header p {
        margin: 0;
        color: rgba(255, 255, 255, 0.55);
        font-size: 0.85rem;
    }
    .series-preview__panel {
        padding: 1rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.03);
    }
    .series-preview__panel h2 {
        margin: 0 0 0.75rem;
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: rgba(255, 255, 255, 0.55);
    }
    .series-preview__chips {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    .series-preview__open {
        padding: 0.65rem 1rem;
        border-radius: 6px;
        border: 1px solid var(--neon-cyan, #00f2ff);
        background: rgba(0, 242, 255, 0.12);
        color: var(--neon-cyan, #00f2ff);
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 0.75rem;
    }
</style>
