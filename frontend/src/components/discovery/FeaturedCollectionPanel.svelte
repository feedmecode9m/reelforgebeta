<script>
  import {
    buildCollectionDiscoveryLayer,
    loadCollections,
    selectFeaturedCollection
  } from '../../lib/collections/collectionIntelligence.js';

  let collections = loadCollections();
  let featured = selectFeaturedCollection(collections);
  let discoveryLinks = buildCollectionDiscoveryLayer(collections);

  function refreshCollections() {
    collections = loadCollections();
    featured = selectFeaturedCollection(collections);
    discoveryLinks = buildCollectionDiscoveryLayer(collections);
  }

  function handleOpenCollection() {
    if (!featured) return;
    console.info('[FEATURED_COLLECTION_OPEN]', {
      collectionId: featured.collectionId,
      collectionTitle: featured.collectionTitle
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('reelforge:collections-updated', refreshCollections);
  }
</script>

<section class="featured-collection-panel" data-featured-collection-panel>
  <header>
    <h3>Featured Collection</h3>
  </header>
  {#if featured}
    <article class="featured-collection-panel__card" data-featured-collection-card>
      <div class="featured-collection-panel__meta">
        <span>{featured.collectionType}</span>
        <h4>{featured.collectionTitle}</h4>
        <p>{featured.collectionDescription}</p>
      </div>
      <div class="featured-collection-panel__chips">
        {#each (featured.searchKeywords || []).slice(0, 5) as keyword (keyword)}
          <small>{keyword}</small>
        {/each}
      </div>
      <p class="featured-collection-panel__links">
        Discovery links:
        {(discoveryLinks.find((item) => item.collectionId === featured.collectionId)?.discoveryConnections || []).join(' • ') || 'pending'}
      </p>
      <button type="button" on:click={handleOpenCollection}>Explore Collection</button>
    </article>
  {:else}
    <p class="featured-collection-panel__empty">No featured collection available.</p>
  {/if}
</section>

<style>
  .featured-collection-panel {
    margin: 0.8rem 2rem 1rem;
    padding: 0.8rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 215, 120, 0.25);
    background: rgba(255, 215, 120, 0.08);
  }
  .featured-collection-panel h3 {
    margin: 0;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #ffe2a3;
  }
  .featured-collection-panel__card {
    margin-top: 0.5rem;
    display: grid;
    gap: 0.4rem;
  }
  .featured-collection-panel__meta span {
    font-size: 0.56rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.68);
  }
  .featured-collection-panel__meta h4 {
    margin: 0.15rem 0;
    font-size: 1rem;
    color: #fff;
  }
  .featured-collection-panel__meta p {
    margin: 0;
    color: rgba(255, 255, 255, 0.78);
    font-size: 0.7rem;
    line-height: 1.35;
  }
  .featured-collection-panel__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .featured-collection-panel__chips small {
    display: inline-block;
    padding: 0.2rem 0.45rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.54rem;
  }
  .featured-collection-panel button {
    justify-self: start;
    border: 1px solid rgba(255, 215, 120, 0.6);
    background: rgba(255, 215, 120, 0.15);
    color: #fff;
    border-radius: 999px;
    padding: 0.3rem 0.65rem;
    font-size: 0.6rem;
    cursor: pointer;
  }
  .featured-collection-panel__links {
    margin: 0;
    font-size: 0.58rem;
    color: rgba(255, 255, 255, 0.7);
  }
  .featured-collection-panel__empty {
    margin: 0.5rem 0 0;
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.68rem;
  }
</style>
