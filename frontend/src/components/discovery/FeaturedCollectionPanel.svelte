<script>
  import { onDestroy } from 'svelte';
  import { resolvePublicFeaturedCollectionTitle } from '../../lib/collections/collectionIntelligence.js';
  import { presentFeaturedCollection } from '../../lib/viewer/viewerIntelligencePresentation.js';

  let featuredTitle = resolvePublicFeaturedCollectionTitle();

  $: presentation = featuredTitle
    ? presentFeaturedCollection(
        {
          collectionId: 'hero-admin-featured',
          collectionTitle: featuredTitle,
          collectionDescription: '',
          collectionType: 'documentary'
        },
        { discoveryConnections: [] }
      )
    : null;

  function refreshFeatured() {
    featuredTitle = resolvePublicFeaturedCollectionTitle();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('reelforge:hero-manager-updated', refreshFeatured);
    window.addEventListener('reelforge:hero-record-updated', refreshFeatured);
  }

  onDestroy(() => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('reelforge:hero-manager-updated', refreshFeatured);
    window.removeEventListener('reelforge:hero-record-updated', refreshFeatured);
  });
</script>

{#if presentation}
  <section class="featured-collection-panel" data-featured-collection-panel>
    <header>
      <h3>Featured Collection</h3>
    </header>
    <article class="featured-collection-panel__card" data-featured-collection-card>
      <div class="featured-collection-panel__meta" data-creator-truth>
        <h4 data-creator-title>{presentation.display.primaryTitle}</h4>
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
    </article>
  </section>
{/if}

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
  .featured-collection-panel__meta h4 {
    margin: 0.15rem 0 0;
    font-size: 0.95rem;
    color: #fff;
  }
  .featured-collection-panel__intel-label,
  .featured-collection-panel__discovery-label {
    margin: 0;
    font-size: 0.56rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.55);
  }
  .featured-collection-panel__intel-line {
    margin: 0.15rem 0 0;
    font-size: 0.68rem;
    color: rgba(255, 255, 255, 0.72);
  }
  .featured-collection-panel__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .featured-collection-panel__chips small {
    font-size: 0.58rem;
    color: rgba(255, 226, 163, 0.85);
  }
</style>
