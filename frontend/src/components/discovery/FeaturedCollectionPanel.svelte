<script>
  import {
    buildCollectionDiscoveryLayer,
    loadCollections,
    selectFeaturedCollection
  } from '../../lib/collections/collectionIntelligence.js';
  import { presentFeaturedCollection } from '../../lib/viewer/viewerIntelligencePresentation.js';

  let collections = loadCollections();
  let featured = selectFeaturedCollection(collections);
  let discoveryLinks = buildCollectionDiscoveryLayer(collections);

  $: presentation = (() => {
    if (!featured) return null;
    const connections =
      discoveryLinks.find((item) => item.collectionId === featured.collectionId)
        ?.discoveryConnections || [];
    return presentFeaturedCollection(featured, { discoveryConnections: connections });
  })();

  function refreshCollections() {
    collections = loadCollections();
    featured = selectFeaturedCollection(collections);
    discoveryLinks = buildCollectionDiscoveryLayer(collections);
  }

  function handleOpenCollection() {
    if (!featured || !presentation) return;
    console.info('[FEATURED_COLLECTION_OPEN]', {
      collectionId: featured.collectionId,
      // Only creator truth title — never NLP rewrite
      collectionTitle: presentation.creatorTruth.title,
      provenance: {
        creatorTruth: true,
        intelligenceExplanation: presentation.intelligenceExplanation.authoritative === false,
        discoveryContext: presentation.discoveryContext.authoritative === false
      }
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
  {#if presentation}
    <article class="featured-collection-panel__card" data-featured-collection-card>
      <div class="featured-collection-panel__meta" data-creator-truth>
        <span>{featured.collectionType}</span>
        <!-- Creator title only — primary display -->
        <h4 data-creator-title>{presentation.display.primaryTitle}</h4>
        {#if presentation.display.officialDescription}
          <p data-creator-description>{presentation.display.officialDescription}</p>
        {/if}
      </div>

      {#if presentation.display.showIntelligence}
        <div
          class="featured-collection-panel__intelligence"
          data-intelligence-explanation
          aria-label="Intelligence interpretation"
        >
          <p class="featured-collection-panel__intel-label">Viewer intelligence</p>
          {#each presentation.display.intelligenceLines as line (line)}
            <p class="featured-collection-panel__intel-line">{line}</p>
          {/each}
        </div>
      {/if}

      {#if presentation.display.discoveryChips.length}
        <div class="featured-collection-panel__chips" data-discovery-context>
          <p class="featured-collection-panel__discovery-label">Discovery signals (not official metadata)</p>
          {#each presentation.display.discoveryChips as chip (chip)}
            <small>{chip}</small>
          {/each}
        </div>
      {/if}

      {#if presentation.discoveryContext.connectionTags.length}
        <p class="featured-collection-panel__links" data-discovery-links>
          Discovery links:
          {presentation.discoveryContext.connectionTags.join(' • ')}
        </p>
      {/if}

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
    gap: 0.45rem;
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
  .featured-collection-panel__intelligence {
    padding: 0.4rem 0.5rem;
    border-radius: 8px;
    border: 1px dashed rgba(250, 204, 21, 0.35);
    background: rgba(250, 204, 21, 0.06);
  }
  .featured-collection-panel__intel-label {
    margin: 0 0 0.25rem;
    font-size: 0.52rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(250, 204, 21, 0.9);
  }
  .featured-collection-panel__intel-line {
    margin: 0.15rem 0 0;
    font-size: 0.68rem;
    line-height: 1.35;
    color: rgba(255, 255, 255, 0.82);
    font-style: italic;
  }
  .featured-collection-panel__discovery-label {
    width: 100%;
    margin: 0 0 0.2rem;
    font-size: 0.5rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.5);
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
