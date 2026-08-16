<script>
  /**
   * Phase 4 prep — identity-backed editorial review surface.
   * Read-only until authoritative coworker metadata exists.
   */
  import { onMount } from 'svelte';
  import {
    buildPhase4IdentityBackedReview,
    applyIdentityBackedCategoryDecision,
    CREATOR_SHELF_OPTIONS
  } from '../../lib/feed/identityBackedEditorialReview.js';
  import { formatSuggestionConfidence } from '../../lib/feed/categorySuggestionReview.js';
  import { fetchReadyReels } from '../../lib/api/media.js';
  import { categoryAliasStore, displayDiscoveryShelf } from '../../lib/feed/discoveryTaxonomy.js';

  export let authHeaders = () => ({});
  export let onCategoryPersisted = () => {};

  let report = null;
  let busy = false;
  let error = '';
  let lastMessage = '';
  let actionBusyId = '';
  /** @type {Record<string, string>} */
  let manualDraft = {};

  async function load() {
    busy = true;
    error = '';
    lastMessage = '';
    try {
      /** @type {Record<string, { title?: string; category?: string }>} */
      const overrides = {};
      try {
        const apiRows = await fetchReadyReels(authHeaders() || {});
        for (const row of Array.isArray(apiRows) ? apiRows : []) {
          const id = String(row?.id || '').trim();
          if (!id) continue;
          overrides[id] = {
            title: String(row.title || row.name || ''),
            category: String(row.category || 'Trending')
          };
        }
      } catch {
        /* identity registry still works offline */
      }
      // Intentionally do NOT load episode-guide titles as authoritative.
      report = await buildPhase4IdentityBackedReview(overrides);
      for (const row of report.rows || []) {
        manualDraft[row.productionId] =
          row.suggestedCategory || row.currentCategory || 'Trending';
      }
      manualDraft = { ...manualDraft };
    } catch (err) {
      error = err instanceof Error ? err.message : 'Identity review failed';
      report = null;
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void load();
  });

  /**
   * @param {Record<string, unknown>} row
   * @param {'accept'|'override'|'manual'} action
   */
  async function applyDecision(row, action) {
    const id = String(row.productionId || '');
    if (!id || actionBusyId) return;
    if (!row.actionsEnabled) {
      lastMessage = `Blocked · ${row.actionsBlockedReason || 'WAITING_FOR_AUTHORITATIVE_METADATA'}`;
      return;
    }
    actionBusyId = id;
    try {
      const category =
        action === 'accept'
          ? String(row.suggestedCategory || '')
          : String(manualDraft[id] || row.currentCategory || 'Trending');
      const result = applyIdentityBackedCategoryDecision(
        row,
        { action, category, title: String(row.editorialTitle || '') },
        { patchCategory: true }
      );
      if (!result.ok) {
        lastMessage = `Blocked · ${result.reason}`;
        return;
      }
      lastMessage = `${action} → ${category} · ${row.editorialTitle || id}`;
      try {
        onCategoryPersisted({ id, category, action });
      } catch {
        /* ignore */
      }
      await load();
    } finally {
      actionBusyId = '';
    }
  }
</script>

<section
  class="id-editorial"
  data-identity-backed-editorial-review
  aria-label="Identity-backed editorial review"
>
  <div class="id-editorial__header">
    <h4 class="id-editorial__title">Identity-backed editorial review</h4>
    <button
      type="button"
      class="id-editorial__btn"
      data-id-editorial-refresh
      disabled={busy}
      on:click|stopPropagation={() => load()}
    >
      {busy ? 'Loading…' : 'Refresh'}
    </button>
  </div>

  <p class="id-editorial__note" data-id-editorial-note>
    Media identity, editorial authority, and NLP confidence are separate. Exact media matches do not
    rename assets or write categories. Waiting for coworker authoritative title/description list.
  </p>

  {#if error}
    <p class="id-editorial__error" data-id-editorial-error>{error}</p>
  {/if}

  {#if report}
    <p class="id-editorial__meta" data-id-editorial-meta>
      Exact identities {report.exactIdentityCount} · Waiting {report.waitingCount} · Authoritative
      {report.authoritativeCount}
    </p>

    <div class="id-editorial__queue" data-id-editorial-queue>
      {#each report.rows as row (row.productionId)}
        <article
          class="id-editorial__card"
          data-id-editorial-row
          data-production-id={row.productionId}
          data-identity-confidence={row.identityConfidence}
          data-metadata-status={row.metadataStatus}
          data-workflow-state={row.workflowState}
          data-actions-enabled={row.actionsEnabled ? 'true' : 'false'}
          data-creator-locked={row.creatorLocked ? 'true' : 'false'}
        >
          <div class="id-editorial__identity">
            <strong data-id-current-title>{row.currentProductionTitle || '(untitled)'}</strong>
            <span class="id-editorial__pill" data-id-confidence>{row.identityConfidence}</span>
            <span class="id-editorial__pill" data-metadata-status-label>{row.metadataStatus}</span>
            <span class="id-editorial__pill" data-workflow-state-label>{row.workflowState}</span>
          </div>
          <ul class="id-editorial__facts">
            <li data-id-reel-id>Reel ID: {row.productionId}</li>
            <li data-id-matched-file>
              Matched source: {row.matchedLocalFiles?.join(' ≡ ') || row.matchedLocalFile || '—'}
            </li>
            <li data-id-current-category>Current category: {displayDiscoveryShelf(row.currentCategory, $categoryAliasStore)}</li>
            {#if row.provisionalTitle}
              <li data-id-provisional-title>
                Provisional (not authoritative): {row.provisionalTitle}
              </li>
            {/if}
            {#if row.editorialTitle}
              <li data-id-editorial-title>Editorial title: {row.editorialTitle}</li>
            {/if}
            {#if row.editorialDescription}
              <li data-id-editorial-description>
                Editorial description: {String(row.editorialDescription).slice(0, 160)}…
              </li>
            {/if}
            <li data-id-metadata-reason>{row.metadataReason}</li>
          </ul>

          {#if row.workflowState === 'WAITING_FOR_AUTHORITATIVE_METADATA'}
            <p class="id-editorial__wait" data-waiting-for-authoritative-metadata>
              WAITING_FOR_AUTHORITATIVE_METADATA — NLP production decision blocked. Accept / Override
              / Manual disabled.
            </p>
          {:else if row.nlpRan}
            <ul class="id-editorial__facts" data-id-nlp-block>
              <li data-id-suggested>Suggested: {row.suggestedCategory ? displayDiscoveryShelf(row.suggestedCategory, $categoryAliasStore) : '—'}</li>
              <li data-id-nlp-confidence>
                NLP confidence: {formatSuggestionConfidence(row.nlpConfidence, row.confidenceBand)}
              </li>
              {#if row.alternativeCategory}
                <li data-id-alternative>Alternative: {row.alternativeCategory}</li>
              {/if}
              <li data-id-ambiguous>Ambiguous: {row.ambiguous ? 'yes' : 'no'}</li>
              {#if row.classificationState}
                <li data-id-classification-state>State: {row.classificationState}</li>
              {/if}
              {#if row.shelfFitReason}
                <li data-id-shelf-reason>{row.shelfFitReason}</li>
              {/if}
              {#if row.signals?.length}
                <li data-id-signals>Signals: {row.signals.slice(0, 6).join(', ')}</li>
              {/if}
            </ul>
          {/if}

          {#if row.creatorLocked}
            <p class="id-editorial__lock" data-id-creator-lock>CREATOR LOCKED</p>
          {/if}

          <div class="id-editorial__actions" data-id-actions>
            <button
              type="button"
              class="id-editorial__btn id-editorial__btn--primary"
              data-id-accept
              disabled={!row.actionsEnabled || Boolean(actionBusyId) || row.creatorLocked || !row.suggestedCategory}
              on:click|stopPropagation={() => applyDecision(row, 'accept')}
            >
              Accept
            </button>
            <label>
              Override / Manual
              <select
                bind:value={manualDraft[row.productionId]}
                data-id-manual-select
                disabled={!row.actionsEnabled || Boolean(actionBusyId)}
              >
                {#each CREATOR_SHELF_OPTIONS as opt}
                  <option value={opt}>{displayDiscoveryShelf(opt, $categoryAliasStore)}</option>
                {/each}
              </select>
            </label>
            <button
              type="button"
              class="id-editorial__btn"
              data-id-override
              disabled={!row.actionsEnabled || Boolean(actionBusyId)}
              on:click|stopPropagation={() => applyDecision(row, 'override')}
            >
              Override
            </button>
            <button
              type="button"
              class="id-editorial__btn"
              data-id-manual
              disabled={!row.actionsEnabled || Boolean(actionBusyId)}
              on:click|stopPropagation={() => applyDecision(row, 'manual')}
            >
              Manual Category
            </button>
          </div>
        </article>
      {/each}
    </div>
  {:else if busy}
    <p class="id-editorial__meta">Loading identity-backed review…</p>
  {/if}

  {#if lastMessage}
    <p class="id-editorial__meta" data-id-last-action aria-live="polite">{lastMessage}</p>
  {/if}
</section>

<style>
  .id-editorial {
    margin: 0.75rem 0 1rem;
    padding: 0.75rem;
    border: 1px solid rgba(251, 191, 36, 0.35);
    border-radius: 10px;
    background: rgba(69, 26, 3, 0.28);
  }
  .id-editorial__header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
  }
  .id-editorial__title {
    margin: 0;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #fde68a;
  }
  .id-editorial__note,
  .id-editorial__meta,
  .id-editorial__error,
  .id-editorial__wait,
  .id-editorial__lock {
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.72);
  }
  .id-editorial__error {
    color: #fca5a5;
  }
  .id-editorial__wait {
    color: #fde68a;
  }
  .id-editorial__lock {
    color: #fde68a;
  }
  .id-editorial__queue {
    display: grid;
    gap: 0.45rem;
    max-height: 32rem;
    overflow: auto;
  }
  .id-editorial__card {
    padding: 0.45rem 0.55rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(2, 6, 23, 0.35);
  }
  .id-editorial__identity {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .id-editorial__identity strong {
    font-size: 0.72rem;
    color: #f8fafc;
  }
  .id-editorial__pill {
    font-size: 0.55rem;
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    background: rgba(251, 191, 36, 0.16);
    color: #fde68a;
  }
  .id-editorial__facts {
    margin: 0.35rem 0;
    padding-left: 1rem;
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.75);
  }
  .id-editorial__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .id-editorial__actions label {
    display: grid;
    gap: 0.1rem;
    font-size: 0.52rem;
    color: rgba(255, 255, 255, 0.55);
  }
  .id-editorial__actions select {
    padding: 0.25rem 0.35rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.04);
    color: #fff;
    font-size: 0.6rem;
  }
  .id-editorial__btn {
    padding: 0.3rem 0.5rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    font-size: 0.6rem;
    cursor: pointer;
  }
  .id-editorial__btn--primary {
    border-color: rgba(251, 191, 36, 0.45);
    background: rgba(245, 158, 11, 0.2);
  }
  .id-editorial__btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
