<script>
  import {
    buildCollectionDiscoveryLayer,
    createCollectionFromTitle,
    loadCollections,
    normalizeCollectionMetadata,
    persistCollections,
    selectFeaturedCollection,
    validateCollectionMetadata
  } from '../../lib/collections/collectionIntelligence.js';

  let collections = loadCollections();
  let selectedCollectionId = collections[0]?.collectionId || '';
  let newCollectionTitle = '';
  let statusMessage = 'Manage documentary collections for discovery.';

  function parseCsv(value) {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function toCsv(value) {
    return Array.isArray(value) ? value.join(', ') : '';
  }

  function selectedCollection() {
    return collections.find((item) => item.collectionId === selectedCollectionId) || null;
  }

  function updateSelectedCollection(patch) {
    const current = selectedCollection();
    if (!current) return;
    const next = normalizeCollectionMetadata({ ...current, ...patch });
    collections = collections.map((item) => (item.collectionId === current.collectionId ? next : item));
    persistCollections(collections);
  }

  function createCollection() {
    const created = createCollectionFromTitle(newCollectionTitle);
    collections = [...collections, created];
    persistCollections(collections);
    selectedCollectionId = created.collectionId;
    newCollectionTitle = '';
    statusMessage = `Created collection: ${created.collectionTitle}`;
  }

  function deleteSelectedCollection() {
    const current = selectedCollection();
    if (!current) return;
    collections = collections.filter((item) => item.collectionId !== current.collectionId);
    persistCollections(collections);
    selectedCollectionId = collections[0]?.collectionId || '';
    statusMessage = `Deleted collection: ${current.collectionTitle}`;
  }

  function saveSelectedCollection() {
    const current = selectedCollection();
    if (!current) return;
    const validation = validateCollectionMetadata(current);
    if (!validation.valid) {
      statusMessage = `Missing fields: ${validation.missingFields.join(', ')}`;
      return;
    }
    updateSelectedCollection(validation.normalized);
    statusMessage = `Saved collection: ${validation.normalized.collectionTitle}`;
  }

  $: collection = selectedCollection();
  $: discoveryConnections = buildCollectionDiscoveryLayer(collections);
  $: featuredCollection = selectFeaturedCollection(collections);
</script>

<section class="collections-manager-panel" data-collections-manager-panel>
  <header class="collections-manager-panel__header">
    <div>
      <div class="collections-manager-panel__badge">COLLECTION INTELLIGENCE</div>
      <h3>Collections Manager</h3>
      <p>Create and curate collection-driven documentary discovery.</p>
    </div>
  </header>

  <div class="collections-manager-panel__create">
    <label>
      <span>Create Collection</span>
      <input bind:value={newCollectionTitle} placeholder="Collection title" />
    </label>
    <button type="button" on:click={createCollection} disabled={!newCollectionTitle.trim()}>Create Collection</button>
  </div>

  <div class="collections-manager-panel__selector">
    <label>
      <span>Collection</span>
      <select bind:value={selectedCollectionId}>
        {#each collections as item (item.collectionId)}
          <option value={item.collectionId}>{item.collectionTitle}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if collection}
    <div class="collections-manager-panel__grid">
      <article class="collections-manager-panel__card">
        <h4>Collection Metadata</h4>
        <label><span>collectionId</span><input bind:value={collection.collectionId} on:input={() => updateSelectedCollection({ collectionId: collection.collectionId })} /></label>
        <label><span>collectionTitle</span><input bind:value={collection.collectionTitle} on:input={() => updateSelectedCollection({ collectionTitle: collection.collectionTitle })} /></label>
        <label><span>collectionDescription</span><textarea rows="2" bind:value={collection.collectionDescription} on:input={() => updateSelectedCollection({ collectionDescription: collection.collectionDescription })}></textarea></label>
        <label><span>collectionCoverImage</span><input bind:value={collection.collectionCoverImage} on:input={() => updateSelectedCollection({ collectionCoverImage: collection.collectionCoverImage })} /></label>
        <label><span>collectionTrailer</span><input bind:value={collection.collectionTrailer} on:input={() => updateSelectedCollection({ collectionTrailer: collection.collectionTrailer })} /></label>
        <label><span>collectionType</span><input bind:value={collection.collectionType} on:input={() => updateSelectedCollection({ collectionType: collection.collectionType })} /></label>
        <label><span>collectionPriority</span><input type="number" min="0" max="100" bind:value={collection.collectionPriority} on:input={() => updateSelectedCollection({ collectionPriority: collection.collectionPriority })} /></label>
      </article>

      <article class="collections-manager-panel__card">
        <h4>Assignments</h4>
        <label><span>Assign Series</span><input value={toCsv(collection.featuredSeries)} on:input={(e) => updateSelectedCollection({ featuredSeries: parseCsv(e.currentTarget.value) })} /></label>
        <label><span>Assign Episodes</span><input value={toCsv(collection.featuredEpisodes)} on:input={(e) => updateSelectedCollection({ featuredEpisodes: parseCsv(e.currentTarget.value) })} /></label>
        <label><span>Assign Communities</span><input value={toCsv(collection.communityRepresented)} on:input={(e) => updateSelectedCollection({ communityRepresented: parseCsv(e.currentTarget.value) })} /></label>
        <label><span>Assign Educational Themes</span><input value={toCsv(collection.educationalThemes)} on:input={(e) => updateSelectedCollection({ educationalThemes: parseCsv(e.currentTarget.value) })} /></label>
        <label><span>Assign Sponsorship Categories</span><input value={toCsv(collection.sponsorshipCategories)} on:input={(e) => updateSelectedCollection({ sponsorshipCategories: parseCsv(e.currentTarget.value) })} /></label>
        <label><span>searchKeywords</span><input value={toCsv(collection.searchKeywords)} on:input={(e) => updateSelectedCollection({ searchKeywords: parseCsv(e.currentTarget.value) })} /></label>
      </article>

      <article class="collections-manager-panel__card">
        <h4>Collection Discovery Layer</h4>
        <p><strong>Featured Collection:</strong> {featuredCollection?.collectionTitle || 'None'}</p>
        <ul>
          {#each discoveryConnections as item (item.collectionId)}
            <li>
              <strong>{item.collectionTitle}</strong>
              <span>{item.discoveryConnections.length ? item.discoveryConnections.join(' • ') : 'No metadata links yet'}</span>
            </li>
          {/each}
        </ul>
      </article>
    </div>

    <footer class="collections-manager-panel__actions">
      <button type="button" on:click={saveSelectedCollection}>Edit Collection</button>
      <button type="button" class="danger" on:click={deleteSelectedCollection}>Delete Collection</button>
    </footer>
  {/if}

  <p class="collections-manager-panel__status">{statusMessage}</p>
</section>

<style>
  .collections-manager-panel {
    margin: 0.9rem 0;
    padding: 0.9rem;
    border-radius: 12px;
    border: 1px solid rgba(120, 190, 255, 0.35);
    background: rgba(120, 190, 255, 0.08);
  }
  .collections-manager-panel__badge {
    font-size: 0.56rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #8ed1ff;
  }
  .collections-manager-panel h3 {
    margin: 0.15rem 0 0.2rem;
    font-size: 0.9rem;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .collections-manager-panel p {
    margin: 0;
    font-size: 0.68rem;
    color: rgba(255, 255, 255, 0.7);
  }
  .collections-manager-panel__create,
  .collections-manager-panel__selector {
    margin-top: 0.65rem;
    display: flex;
    gap: 0.5rem;
    align-items: end;
  }
  .collections-manager-panel label {
    display: grid;
    gap: 0.2rem;
    flex: 1;
  }
  .collections-manager-panel label span {
    font-size: 0.54rem;
    color: rgba(255, 255, 255, 0.64);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .collections-manager-panel input,
  .collections-manager-panel textarea,
  .collections-manager-panel select {
    width: 100%;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font: inherit;
    font-size: 0.62rem;
    padding: 0.36rem 0.45rem;
  }
  .collections-manager-panel__create button,
  .collections-manager-panel__actions button {
    border: 1px solid rgba(142, 209, 255, 0.55);
    background: rgba(142, 209, 255, 0.16);
    color: #e9f6ff;
    border-radius: 999px;
    padding: 0.3rem 0.65rem;
    font-size: 0.58rem;
    cursor: pointer;
  }
  .collections-manager-panel__grid {
    margin-top: 0.7rem;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.6rem;
  }
  .collections-manager-panel__card {
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 9px;
    background: rgba(10, 10, 18, 0.5);
    padding: 0.6rem;
    display: grid;
    gap: 0.35rem;
    align-content: start;
  }
  .collections-manager-panel__card h4 {
    margin: 0 0 0.2rem;
    font-size: 0.66rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #d9ecff;
  }
  .collections-manager-panel__card ul {
    margin: 0;
    padding-left: 0.9rem;
    display: grid;
    gap: 0.3rem;
  }
  .collections-manager-panel__card li {
    display: grid;
    gap: 0.1rem;
  }
  .collections-manager-panel__card li strong {
    font-size: 0.6rem;
    color: #fff;
  }
  .collections-manager-panel__card li span {
    font-size: 0.55rem;
    color: rgba(255, 255, 255, 0.68);
  }
  .collections-manager-panel__actions {
    margin-top: 0.65rem;
    display: flex;
    gap: 0.35rem;
  }
  .collections-manager-panel__actions .danger {
    border-color: rgba(255, 120, 120, 0.6);
    background: rgba(255, 120, 120, 0.15);
    color: #ffd7d7;
  }
  .collections-manager-panel__status {
    margin-top: 0.7rem;
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.78);
  }
  @media (max-width: 1200px) {
    .collections-manager-panel__grid {
      grid-template-columns: 1fr;
    }
  }
</style>
