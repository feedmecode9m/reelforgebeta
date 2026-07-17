<script>
  import { navigateCreatorAction } from '../../lib/studio/creatorActionRouter.js';

  /** @type {import('../../lib/series/productionHealth.js').EpisodeOperationRow[]} */
  export let rows = [];

  /** @type {import('../../lib/series/actionEngine.js').StudioActionPlan} */
  export let actionPlan = {
    readinessScore: 0,
    blockers: [],
    recommendations: [],
    quickWins: [],
    estimatedImpact: 0
  };

  /** @type {string} */
  export let seriesId = '';

  /** @param {import('../../lib/series/productionHealth.js').EpisodeOperationRow} row */
  function episodeCode(row) {
    return `S${String(row.seasonNumber).padStart(2, '0')}E${String(row.episodeNumber).padStart(2, '0')}`;
  }

  /** @param {import('../../lib/series/productionHealth.js').EpisodeOperationRow} row */
  function missingItems(row) {
    /** @type {string[]} */
    const items = [];
    if (row.status === 'Missing Asset' || !row.reelInFeed || !row.reelId) {
      items.push('Reel missing');
    }
    if (!row.metadataComplete) {
      items.push('Metadata incomplete');
    }
    if (row.reelInFeed && !row.thumbnailUrl) {
      items.push('Thumbnail missing');
    }
    return items;
  }

  /** @param {import('../../lib/series/productionHealth.js').EpisodeOperationRow} row */
  function displayStatus(row) {
    if (row.status === 'Missing Asset') return 'Missing Asset';
    if (row.status === 'Published' || row.status === 'Ready') {
      if (row.metadataComplete && row.reelInFeed && row.thumbnailUrl) return 'Ready';
      return 'Needs Attention';
    }
    if (row.status === 'Scheduled' || row.status === 'Draft') {
      return row.reelInFeed ? 'Needs Attention' : 'Missing Asset';
    }
    return row.releaseStatus || row.status || 'Needs Attention';
  }

  /** @param {string} status */
  function statusClass(status) {
    if (status === 'Ready' || status === 'Published') return 'ready';
    if (status === 'Missing Asset') return 'missing';
    return 'attention';
  }

  /** @param {string} episodeId */
  function recommendationForEpisode(episodeId) {
    const pool = [...(actionPlan.blockers || []), ...(actionPlan.recommendations || [])];
    return pool.find((item) => item.episodeId === episodeId) || null;
  }

  /** @param {import('../../lib/series/actionEngine.js').StudioRecommendation | null} rec */
  function actionLabel(rec) {
    if (!rec) return null;
    switch (rec.actionType) {
      case 'missing-asset':
        return 'Attach Vault Reel';
      case 'missing-thumbnail':
        return 'Add Thumbnail';
      case 'missing-description':
      case 'missing-runtime':
      case 'missing-metadata':
        return 'Complete Metadata';
      case 'unpublished-episode':
        return 'Publish Episode';
      case 'unscheduled-episode':
        return 'Schedule Release';
      default:
        return rec.title || null;
    }
  }

  /** @param {import('../../lib/series/productionHealth.js').EpisodeOperationRow} row */
  function handleAction(row) {
    const rec = recommendationForEpisode(row.episodeId);
    if (!rec) return;

    navigateCreatorAction({
      actionType: rec.actionType,
      episodeId: row.episodeId,
      reelId: row.reelId,
      source: 'readiness-board'
    });
  }

  $: sortedRows = [...rows].sort((a, b) => {
    if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
    return a.episodeNumber - b.episodeNumber;
  });
</script>

<section
  class="creator-readiness-board"
  data-testid="creator-readiness-board"
  data-creator-readiness-board
  data-series-id={seriesId || undefined}
  aria-labelledby="creator-readiness-board-heading"
>
  <div class="creator-readiness-board__header">
    <div>
      <div class="creator-readiness-board__badge">📋 EPISODE READINESS</div>
      <h3 id="creator-readiness-board-heading">Episode Readiness Board</h3>
      <p class="creator-readiness-board__subtitle">
        Per-episode production state — {actionPlan.readinessScore}% series readiness
      </p>
    </div>
  </div>

  {#if sortedRows.length === 0}
    <p class="creator-readiness-board__empty">No episodes in the selected series catalog.</p>
  {:else}
    <div class="creator-readiness-board__table-wrap">
      <table class="creator-readiness-board__table">
        <thead>
          <tr>
            <th scope="col">Episode</th>
            <th scope="col">Status</th>
            <th scope="col">Checks</th>
            <th scope="col">Missing</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedRows as row (row.episodeId)}
            {@const status = displayStatus(row)}
            {@const missing = missingItems(row)}
            {@const rec = recommendationForEpisode(row.episodeId)}
            {@const action = actionLabel(rec)}
            <tr data-testid="readiness-episode-row" data-episode-id={row.episodeId}>
              <td class="creator-readiness-board__episode">
                <strong>{episodeCode(row)}</strong>
                <span>{row.episodeTitle}</span>
              </td>
              <td>
                <span
                  class="creator-readiness-board__status creator-readiness-board__status--{statusClass(status)}"
                  data-readiness-status={status}
                >
                  {status}
                </span>
              </td>
              <td class="creator-readiness-board__checks">
                <span class:ok={row.reelInFeed && row.reelId} class:warn={!row.reelInFeed || !row.reelId}>
                  {row.reelInFeed && row.reelId ? '✅' : '❌'} Reel
                </span>
                <span class:ok={row.metadataComplete} class:warn={!row.metadataComplete}>
                  {row.metadataComplete ? '✅' : '⚠'} Metadata
                </span>
                <span class:ok={Boolean(row.thumbnailUrl)} class:warn={!row.thumbnailUrl}>
                  {row.thumbnailUrl ? '✅' : '⚠'} Thumbnail
                </span>
              </td>
              <td class="creator-readiness-board__missing">
                {#if missing.length === 0}
                  <span class="creator-readiness-board__none">—</span>
                {:else}
                  {missing.join(' · ')}
                {/if}
              </td>
              <td>
                {#if action}
                  <button
                    type="button"
                    class="creator-readiness-board__action"
                    data-testid="readiness-action-btn"
                    data-action="readiness-route"
                    on:click={() => handleAction(row)}
                  >
                    {action}
                  </button>
                {:else}
                  <span class="creator-readiness-board__none">—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .creator-readiness-board {
    margin-bottom: 1.5rem;
    padding: 1.2rem 1.3rem;
    border-radius: 12px;
    border: 1px solid rgba(255, 0, 255, 0.2);
    background: linear-gradient(145deg, rgba(20, 8, 28, 0.92), rgba(10, 14, 24, 0.9));
  }

  .creator-readiness-board__badge {
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    color: rgba(255, 0, 255, 0.85);
    margin-bottom: 0.35rem;
  }

  .creator-readiness-board__header h3 {
    margin: 0 0 0.25rem;
    font-size: 1.05rem;
    color: #fff;
  }

  .creator-readiness-board__subtitle {
    margin: 0;
    font-size: 0.82rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .creator-readiness-board__empty {
    margin: 0.75rem 0 0;
    color: rgba(255, 180, 100, 0.95);
    font-size: 0.85rem;
  }

  .creator-readiness-board__table-wrap {
    margin-top: 1rem;
    overflow-x: auto;
  }

  .creator-readiness-board__table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }

  .creator-readiness-board__table th {
    text-align: left;
    padding: 0.45rem 0.5rem;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.45);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .creator-readiness-board__table td {
    padding: 0.55rem 0.5rem;
    vertical-align: top;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .creator-readiness-board__episode {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 9rem;
  }

  .creator-readiness-board__episode strong {
    color: var(--neon-cyan, #00f2ff);
    font-size: 0.78rem;
  }

  .creator-readiness-board__episode span {
    color: rgba(255, 255, 255, 0.72);
    font-size: 0.75rem;
  }

  .creator-readiness-board__status {
    display: inline-block;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .creator-readiness-board__status--ready {
    background: rgba(100, 255, 160, 0.12);
    color: #9dffb0;
  }

  .creator-readiness-board__status--missing {
    background: rgba(255, 100, 100, 0.12);
    color: #ff8888;
  }

  .creator-readiness-board__status--attention {
    background: rgba(255, 200, 80, 0.12);
    color: #ffd76a;
  }

  .creator-readiness-board__checks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.65rem;
    min-width: 10rem;
  }

  .creator-readiness-board__checks span.ok {
    color: rgba(180, 255, 200, 0.9);
  }

  .creator-readiness-board__checks span.warn {
    color: rgba(255, 210, 120, 0.95);
  }

  .creator-readiness-board__missing {
    color: rgba(255, 255, 255, 0.62);
    min-width: 8rem;
  }

  .creator-readiness-board__none {
    color: rgba(255, 255, 255, 0.35);
  }

  .creator-readiness-board__action {
    border: 1px solid rgba(0, 242, 255, 0.45);
    background: rgba(0, 242, 255, 0.08);
    color: var(--neon-cyan, #00f2ff);
    border-radius: 6px;
    padding: 0.3rem 0.55rem;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .creator-readiness-board__action:hover {
    background: rgba(0, 242, 255, 0.16);
  }

  :global(tr.workflow-nav-highlight) {
    outline: 2px solid rgba(0, 242, 255, 0.65);
    outline-offset: 2px;
    background: rgba(0, 242, 255, 0.08);
  }
</style>
