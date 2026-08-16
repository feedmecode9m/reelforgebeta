<script>
  /**
   * Phase 3A — Smart Category audit + approval queue (Studio).
   * Read-only until Accept / Override / Manual / Approve Selected.
   */
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import {
    auditProductionCatalog,
    applyAuditCategoryDecision,
    CREATOR_SHELF_OPTIONS,
    DISCOVERY_SHELVES
  } from '../../lib/feed/productionCategoryAudit.js';
  import { formatSuggestionConfidence } from '../../lib/feed/categorySuggestionReview.js';
  import { fetchReadyReels } from '../../lib/api/media.js';
  import { categoryAliasStore, displayDiscoveryShelf } from '../../lib/feed/discoveryTaxonomy.js';

  /** @type {import('svelte/store').Readable<Record<string, unknown[]>> | null} */
  export let feed = null;
  /** Optional auth headers for GET /api/reels */
  export let authHeaders = () => ({});
  /** Called after an explicit persistence so Studio can refresh overlays */
  export let onCategoryPersisted = () => {};

  /** @type {Awaited<ReturnType<typeof auditProductionCatalog>> | null} */
  let audit = null;
  let auditBusy = false;
  let auditError = '';
  let auditSource = 'idle';
  /** @type {Record<string, boolean>} */
  let selected = {};
  /** @type {Record<string, string>} */
  let manualDraft = {};
  let actionBusyId = '';
  let lastActionMessage = '';
  let patchCountThisSession = 0;

  $: approvalCandidates = (audit?.eligible || []).filter((r) => r.eligibleForApproval);
  $: selectedApprovalIds = Object.keys(selected).filter(
    (id) => selected[id] && approvalCandidates.some((r) => r.id === id)
  );

  function shelfEntries(dist) {
    const d = dist || {};
    return ['Trending', 'Romance', 'Cyber-Action', 'Suspense']
      .map((name) => ({ name, count: Number(d[name]) || 0 }))
      .concat(d.HERO ? [{ name: 'HERO', count: Number(d.HERO) || 0 }] : []);
  }

  /**
   * Prefer live feed inventory; fall back to GET /api/reels.
   * Never invents demo placeholders into the audit (excluded by eligibility).
   */
  async function collectCatalogRows() {
    /** @type {Record<string, unknown>[]} */
    const fromFeed = [];
    if (feed && typeof feed.subscribe === 'function') {
      const map = get(feed) || {};
      for (const rows of Object.values(map)) {
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          if (row && typeof row === 'object') fromFeed.push(/** @type {Record<string, unknown>} */ (row));
        }
      }
    }
    // Dedupe by id
    const byId = new Map();
    for (const row of fromFeed) {
      const id = String(row.id || '').trim();
      if (id && !byId.has(id)) byId.set(id, row);
    }

    try {
      const apiRows = await fetchReadyReels(authHeaders() || {});
      for (const row of Array.isArray(apiRows) ? apiRows : []) {
        if (!row || typeof row !== 'object') continue;
        const id = String(row.id || '').trim();
        if (!id || byId.has(id)) continue;
        byId.set(id, row);
      }
      auditSource = byId.size ? 'feed+api' : 'api';
    } catch (err) {
      auditSource = byId.size ? 'feed' : 'error';
      if (!byId.size) throw err;
    }
    return [...byId.values()];
  }

  async function runAudit() {
    auditBusy = true;
    auditError = '';
    lastActionMessage = '';
    selected = {};
    try {
      const catalog = await collectCatalogRows();
      audit = await auditProductionCatalog(catalog);
      for (const row of audit.eligible || []) {
        manualDraft[row.id] = row.suggestedCategory || row.currentCategory || 'Trending';
      }
      manualDraft = { ...manualDraft };
    } catch (err) {
      auditError = err instanceof Error ? err.message : 'Audit failed';
      audit = null;
    } finally {
      auditBusy = false;
    }
  }

  onMount(() => {
    void runAudit();
  });

  function toggleSelect(id) {
    selected = { ...selected, [id]: !selected[id] };
  }

  function selectAllApprovalEligible() {
    /** @type {Record<string, boolean>} */
    const next = { ...selected };
    for (const row of approvalCandidates) next[row.id] = true;
    selected = next;
  }

  function clearSelection() {
    selected = {};
  }

  /**
   * @param {Record<string, unknown>} row
   * @param {'accept'|'override'|'manual'|'leave'} action
   * @param {string} [category]
   */
  async function applyDecision(row, action, category) {
    const id = String(row.id || '').trim();
    if (!id || actionBusyId) return;
    if (action === 'accept' && row.creatorLocked) {
      lastActionMessage = 'Creator locked — Accept blocked. Use Override/Manual deliberately.';
      return;
    }
    actionBusyId = id;
    lastActionMessage = '';
    try {
      if (action === 'leave') {
        lastActionMessage = `Left current · ${row.currentCategory} · ${row.canonicalTitle}`;
        return;
      }
      const chosen =
        String(category || manualDraft[id] || row.suggestedCategory || row.currentCategory || 'Trending').trim() ||
        'Trending';
      const beforePatches = patchCountThisSession;
      const result = applyAuditCategoryDecision(
        id,
        {
          title: String(row.canonicalTitle || ''),
          category: chosen,
          action
        },
        { asset: { id, ...row }, patchCategory: true }
      );
      if (!result.ok) {
        lastActionMessage = `Blocked · ${result.reason || 'failed'} · ${row.canonicalTitle}`;
        return;
      }
      patchCountThisSession = beforePatches + (result.skipped ? 0 : 1);
      lastActionMessage = `${action} → ${chosen} · ${row.canonicalTitle}`;
      try {
        onCategoryPersisted({ id, category: chosen, action });
      } catch {
        /* ignore */
      }
      await runAudit();
    } finally {
      actionBusyId = '';
    }
  }

  async function approveSelected() {
    const ids = selectedApprovalIds.slice();
    if (!ids.length || actionBusyId) return;
    actionBusyId = 'bulk';
    let ok = 0;
    let failed = 0;
    try {
      for (const id of ids) {
        const row = (audit?.eligible || []).find((r) => r.id === id);
        if (!row || !row.eligibleForApproval) {
          failed += 1;
          continue;
        }
        const result = applyAuditCategoryDecision(
          id,
          {
            title: String(row.canonicalTitle || ''),
            category: String(row.suggestedCategory || ''),
            action: 'accept'
          },
          { asset: { id, ...row }, patchCategory: true }
        );
        if (result.ok && !result.skipped) {
          ok += 1;
          patchCountThisSession += 1;
        } else failed += 1;
      }
      lastActionMessage = `Approve selected · updated ${ok} · failed ${failed}`;
      try {
        onCategoryPersisted({ bulk: true, updated: ok });
      } catch {
        /* ignore */
      }
      selected = {};
      await runAudit();
    } finally {
      actionBusyId = '';
    }
  }
</script>

<section class="smart-audit" data-smart-category-audit aria-label="Smart category audit">
  <div class="smart-audit__header">
    <h4 class="smart-audit__title">Category audit &amp; approval</h4>
    <button
      type="button"
      class="smart-audit__btn"
      data-audit-refresh
      disabled={auditBusy}
      on:click|stopPropagation={() => runAudit()}
    >
      {auditBusy ? 'Auditing…' : 'Re-run audit'}
    </button>
  </div>

  {#if auditError}
    <p class="smart-audit__error" data-audit-error>{auditError}</p>
  {/if}

  {#if audit}
    <div class="smart-audit__distributions" data-audit-distributions>
      <div class="smart-audit__dist" data-current-distribution>
        <p class="smart-audit__dist-label">CURRENT DISTRIBUTION</p>
        <ul>
          {#each shelfEntries(audit.currentDistribution) as row}
            <li data-current-shelf={row.name}>{displayDiscoveryShelf(row.name, $categoryAliasStore)}: {row.count}</li>
          {/each}
        </ul>
      </div>
      <div class="smart-audit__dist" data-recommended-distribution>
        <p class="smart-audit__dist-label">RECOMMENDED DISTRIBUTION</p>
        <ul>
          {#each shelfEntries(audit.recommendedDistribution) as row}
            <li data-recommended-shelf={row.name}>{displayDiscoveryShelf(row.name, $categoryAliasStore)}: {row.count}</li>
          {/each}
        </ul>
      </div>
    </div>

    <p class="smart-audit__meta" data-audit-meta>
      Eligible {audit.eligibleCount} · Excluded {audit.excludedCount} · Approval-ready {audit.approvalEligibleCount}
      · Source {auditSource} · Session patches {patchCountThisSession}
    </p>

    {#if approvalCandidates.length}
      <div class="smart-audit__bulk" data-audit-bulk>
        <button type="button" class="smart-audit__btn" on:click|stopPropagation={selectAllApprovalEligible}
          >Select high-confidence ({approvalCandidates.length})</button
        >
        <button type="button" class="smart-audit__btn" on:click|stopPropagation={clearSelection}>Clear</button>
        <button
          type="button"
          class="smart-audit__btn smart-audit__btn--primary"
          data-audit-approve-selected
          disabled={!selectedApprovalIds.length || actionBusyId === 'bulk'}
          on:click|stopPropagation={approveSelected}
        >
          Approve Selected ({selectedApprovalIds.length})
        </button>
      </div>
    {/if}

    <div class="smart-audit__queue" data-audit-queue>
      {#each audit.eligible as row (row.id)}
        <article
          class="smart-audit__card"
          data-audit-row
          data-audit-state={row.auditState}
          data-asset-id={row.id}
          data-creator-locked={row.creatorLocked ? 'true' : 'false'}
        >
          <div class="smart-audit__card-top">
            {#if row.eligibleForApproval}
              <label class="smart-audit__check">
                <input
                  type="checkbox"
                  checked={Boolean(selected[row.id])}
                  on:change={() => toggleSelect(row.id)}
                  aria-label="Select for bulk approval"
                />
              </label>
            {/if}
            <div class="smart-audit__identity">
              <strong data-audit-title>{row.canonicalTitle || '(untitled)'}</strong>
              <span class="smart-audit__state" data-audit-state-label>{row.auditState}</span>
              <span class="smart-audit__kind">{row.mediaKind}</span>
            </div>
          </div>
          <ul class="smart-audit__facts">
            <li data-audit-current>Current: {displayDiscoveryShelf(row.currentCategory, $categoryAliasStore)} ({row.currentCategorySource})</li>
            <li data-audit-suggested>
              Recommended: {row.suggestedCategory ? displayDiscoveryShelf(row.suggestedCategory, $categoryAliasStore) : '—'}
              {#if row.alternativeCategory}
                · Alt: {displayDiscoveryShelf(row.alternativeCategory, $categoryAliasStore)}
              {/if}
            </li>
            <li data-audit-confidence>
              Confidence: {formatSuggestionConfidence(row.suggestedConfidence, row.confidenceBand)}
            </li>
            {#if row.signals?.length}
              <li class="smart-audit__signals" data-audit-signals>
                Signals: {row.signals.slice(0, 6).join(', ')}
              </li>
            {/if}
          </ul>

          {#if row.creatorLocked}
            <p class="smart-audit__lock" data-audit-creator-lock>
              CREATOR LOCKED · NLP may suggest {row.suggestedCategory ? displayDiscoveryShelf(row.suggestedCategory, $categoryAliasStore) : '—'} but cannot overwrite {displayDiscoveryShelf(row.currentCategory, $categoryAliasStore)}
            </p>
          {:else if row.auditState === 'RECOMMEND_CHANGE'}
            <div class="smart-audit__actions">
              <button
                type="button"
                class="smart-audit__btn smart-audit__btn--primary"
                data-audit-accept
                disabled={Boolean(actionBusyId)}
                on:click|stopPropagation={() => applyDecision(row, 'accept', row.suggestedCategory)}
              >
                Accept
              </button>
              <label>
                Override
                <select bind:value={manualDraft[row.id]} data-audit-override-select>
                  {#each CREATOR_SHELF_OPTIONS as opt}
                    <option value={opt}>{displayDiscoveryShelf(opt, $categoryAliasStore)}</option>
                  {/each}
                </select>
              </label>
              <button
                type="button"
                class="smart-audit__btn"
                data-audit-override
                disabled={Boolean(actionBusyId)}
                on:click|stopPropagation={() => applyDecision(row, 'override', manualDraft[row.id])}
              >
                Override
              </button>
              <button
                type="button"
                class="smart-audit__btn"
                data-audit-leave
                disabled={Boolean(actionBusyId)}
                on:click|stopPropagation={() => applyDecision(row, 'leave')}
              >
                Leave Current
              </button>
            </div>
          {:else if row.manualReviewRequired}
            <div class="smart-audit__actions" data-audit-manual-helper>
              <label>
                Choose Category
                <select bind:value={manualDraft[row.id]} data-manual-category-select>
                  {#each CREATOR_SHELF_OPTIONS as opt}
                    <option value={opt}>{displayDiscoveryShelf(opt, $categoryAliasStore)}</option>
                  {/each}
                </select>
              </label>
              <button
                type="button"
                class="smart-audit__btn smart-audit__btn--primary"
                data-manual-category-apply
                disabled={Boolean(actionBusyId)}
                on:click|stopPropagation={() => applyDecision(row, 'manual', manualDraft[row.id])}
              >
                Apply category
              </button>
              <button
                type="button"
                class="smart-audit__btn"
                data-audit-leave
                disabled={Boolean(actionBusyId)}
                on:click|stopPropagation={() => applyDecision(row, 'leave')}
              >
                Leave Current
              </button>
            </div>
          {:else if row.auditState === 'MATCH'}
            <p class="smart-audit__ok" data-audit-match>Match — no change needed.</p>
          {/if}
        </article>
      {/each}
    </div>
  {:else if auditBusy}
    <p class="smart-audit__meta">Running read-only production audit…</p>
  {/if}

  {#if lastActionMessage}
    <p class="smart-audit__meta" data-audit-last-action aria-live="polite">{lastActionMessage}</p>
  {/if}
</section>

<style>
  .smart-audit {
    margin: 0.75rem 0 1rem;
    padding: 0.75rem;
    border: 1px solid rgba(56, 189, 248, 0.28);
    border-radius: 10px;
    background: rgba(8, 47, 73, 0.28);
  }
  .smart-audit__header {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
  }
  .smart-audit__title {
    margin: 0;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #e0f2fe;
  }
  .smart-audit__distributions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.65rem;
    margin: 0.65rem 0;
  }
  .smart-audit__dist {
    padding: 0.45rem 0.55rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(0, 0, 0, 0.2);
  }
  .smart-audit__dist-label {
    margin: 0 0 0.35rem;
    font-size: 0.58rem;
    letter-spacing: 0.05em;
    color: #7dd3fc;
  }
  .smart-audit__dist ul {
    margin: 0;
    padding-left: 1rem;
    font-size: 0.68rem;
    color: rgba(255, 255, 255, 0.82);
  }
  .smart-audit__meta,
  .smart-audit__error,
  .smart-audit__lock,
  .smart-audit__ok {
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.7);
  }
  .smart-audit__error {
    color: #fca5a5;
  }
  .smart-audit__lock {
    color: #fde68a;
  }
  .smart-audit__bulk {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.55rem;
  }
  .smart-audit__queue {
    display: grid;
    gap: 0.45rem;
    max-height: 28rem;
    overflow: auto;
  }
  .smart-audit__card {
    padding: 0.45rem 0.55rem;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(2, 6, 23, 0.35);
  }
  .smart-audit__card-top {
    display: flex;
    gap: 0.4rem;
    align-items: flex-start;
  }
  .smart-audit__identity {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .smart-audit__identity strong {
    font-size: 0.72rem;
    color: #f8fafc;
  }
  .smart-audit__state {
    font-size: 0.55rem;
    padding: 0.1rem 0.35rem;
    border-radius: 999px;
    background: rgba(56, 189, 248, 0.18);
    color: #bae6fd;
  }
  .smart-audit__kind {
    font-size: 0.55rem;
    color: rgba(255, 255, 255, 0.45);
  }
  .smart-audit__facts {
    margin: 0.35rem 0;
    padding-left: 1rem;
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.75);
  }
  .smart-audit__signals {
    opacity: 0.8;
  }
  .smart-audit__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .smart-audit__actions label {
    display: grid;
    gap: 0.1rem;
    font-size: 0.52rem;
    color: rgba(255, 255, 255, 0.55);
  }
  .smart-audit__actions select {
    padding: 0.25rem 0.35rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.04);
    color: #fff;
    font-size: 0.6rem;
  }
  .smart-audit__btn {
    padding: 0.3rem 0.5rem;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
    font-size: 0.6rem;
    cursor: pointer;
  }
  .smart-audit__btn--primary {
    border-color: rgba(56, 189, 248, 0.45);
    background: rgba(14, 165, 233, 0.2);
  }
  .smart-audit__btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }
</style>
