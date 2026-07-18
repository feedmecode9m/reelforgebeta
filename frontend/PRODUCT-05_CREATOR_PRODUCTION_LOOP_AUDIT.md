# PRODUCT-05 — Creator Production Loop Audit

**Mission type:** Analysis and design only — **no code changes**  
**Date:** 2026-07-16  
**Predecessors:** [`PRODUCT-04_CREATOR_READINESS_AUDIT.md`](PRODUCT-04_CREATOR_READINESS_AUDIT.md), [`PRODUCT-04B_READINESS_BOARD_AUDIT.md`](PRODUCT-04B_READINESS_BOARD_AUDIT.md)

---

## Executive Summary

PRODUCT-04B closed the **visibility gap**: creators can now see per-episode readiness and recommended actions. PRODUCT-05 measures what happens **after** they act.

The dominant finding is a **execution loop gap**, not a missing feature:

```text
See blocker          ✅  (Readiness Board, Guide Me, Command Center)
        ↓
Route to workflow    ⚠   (works for reel attach; broken/incomplete for metadata/thumbnail)
        ↓
Complete work        ✅  (capabilities exist on Content / Production tabs)
        ↓
Return to context    ❌  (no completion loop)
        ↓
See updated state    ⚠   (reactive but inconsistent; no explicit completion signal)
```

ReelForge has crossed from *"can the creator do this?"* to *"how efficiently can they finish production?"* The next bottleneck is **loop efficiency and UI density**, not another intelligence layer.

**Recommendation:** Do not add dashboards. Optimize the **action router**, **completion feedback**, and **Production tab hierarchy** before any PRODUCT-06 implementation.

---

## Product Maturity Context

After PRODUCT-01 through PRODUCT-04B:

| Layer | Status |
|-------|--------|
| Infrastructure confidence | High (BG family closed) |
| Creator actions | Available (attach, metadata, release, upload) |
| Creator guidance | Available (readiness board, Guide Me, action plan) |
| Automation protection | Available (Hero, attachment Playwright) |

The creator navigation contract established in PRODUCT-04B is correct in principle:

```text
Readiness Board → Action Hint → Existing Workflow Target → Existing Feature
```

This audit measures how reliably that contract executes in practice.

---

## 1. Readiness → Completion Loop

### 1.1 Navigation trace

When a creator clicks an action on `CreatorEpisodeReadinessBoard`:

```text
handleAction(row)
    → recommendationForEpisode()     // actionPlan.blockers + recommendations
    → buildTaskNavigation()          // workflowEngine.js ACTION_NAV_MAP
    → navigateToTarget({ type: 'workflow', workflowNavigation, tab: 'Production' })
    → navigateToWorkflow()           // deepNavigationEngine.js
    → executeWorkflowNavigation()    // scroll + highlight + reelforge:workflow-navigate
    → handleWorkflowNavigate()       // viewerContext.js — sets studioAttachEpisodeId / studioSeriesMetadataReelId
```

**Critical behavior** (`deepNavigationEngine.js` lines 200–222): when `workflowNavigation.target` is set, `navigateToWorkflow` **does not** call `dispatchSearchNavigate`. The `tab: 'Production'` argument on `navigateToTarget` is **ignored**. Navigation is DOM-scroll-only on the **currently active tab**.

### 1.2 Click-path estimates

| Blocker | Min clicks from Readiness Board | Tab switch required | Auto-navigation success from Production |
|---------|--------------------------------|---------------------|----------------------------------------|
| **Missing reel** | **3–4:** (1) action → (2) pick vault reel → (3) Attach → optional replace confirm | No | **Partial** — `studioAttachEpisodeId` pre-fills panel; manual scroll hack to `[data-testid="episode-reel-attach-panel"]`; primary selector `[data-queue-item]` lives on **Content** tab |
| **Missing metadata** | **5–8:** (1) action → (2) manual Content tab → (3) select reel → (4–6) edit fields | Yes | **No** — `[data-series-metadata-editor]` is on Content tab only |
| **Missing thumbnail** | **4–6+:** (1) action → (2) manual Content tab → (3–4) find thumbnail UI → assign | Yes | **No** — nav target is read-only `[data-episode-op-row]` in `EpisodeOperationsTable` |
| **Unpublished / unscheduled** | **4–6:** Content tab + metadata editor release fields | Yes | **No** — same Content-tab dependency |

### 1.3 Action-type routing gaps

| actionType | Emitted by actionEngine | In ACTION_NAV_MAP | Resolves correctly |
|------------|-------------------------|-------------------|-------------------|
| `missing-asset` | ✅ | ✅ → `reel-attach` | Partial (Production workaround) |
| `missing-description` | ✅ | ✅ → `metadata-editor` | No (Content tab) |
| `missing-runtime` | ✅ | ✅ → `metadata-editor` | No (Content tab) |
| `missing-metadata` | ✅ | **❌ missing** | **Broken** — `buildTaskNavigation` returns undefined target |
| `missing-thumbnail` | ✅ | ✅ → `episode-editor` | No (display-only row, no editor) |
| `unpublished-episode` | ✅ | ✅ → `release-scheduler` | No (Content tab) |
| `unscheduled-episode` | ✅ | ✅ → `release-scheduler` | No (Content tab) |

Evidence: `actionEngine.js` emits `missing-metadata`; `workflowEngine.js` `ACTION_NAV_MAP` has no entry for it.

### 1.4 Dual attach surfaces

Reel attachment has **two creator paths**:

| Surface | Tab | Trigger |
|---------|-----|---------|
| `EpisodeReelAttachmentPanel` | Production (slot) | PRODUCT-02; readiness board scroll hack |
| `MissingAssetQueue` | Content | Legacy queue; `on:attached` → `handleQueueAttached` → `refreshKey++` |

Workflow navigation selector `[data-missing-asset-queue]` / `[data-queue-item]` points at **Content**. Readiness board partially compensates with Production-panel scroll. Creators may not discover both paths.

### 1.5 Return-to-context after completion

**No completion loop exists today.**

After attach, metadata save, or thumbnail assignment:

- No scroll-back to `[data-creator-readiness-board]`
- No row highlight on the completed episode
- No "return to board" affordance
- Creator remains at attachment panel or metadata editor

`WorkflowTaskCard` has the same gap — navigate out, no navigate back.

### 1.6 Readiness board refresh after actions

**Reactive chain** (`StudioWorkspaceLayout.svelte`):

```text
feedReels, selectedSeriesId
    → buildEpisodeOperationRows()   // reads seriesCatalog inside
    → buildStudioActionPlan()
    → CreatorEpisodeReadinessBoard
```

**Refresh triggers:**

| Event | Updates board? | Mechanism |
|-------|----------------|-----------|
| `feedReels` prop change | ✅ | Reactive `$:` |
| `seriesCatalog` update (attach) | ✅ Likely | `get(seriesCatalog)` inside reactive computation |
| `handleQueueAttached` (Content) | ✅ | Explicit `refreshKey++` |
| `handleEpisodeAssetChanged` (Production attach) | ⚠ Inconsistent | Patches `$feed` via `patchFeedWithEpisodeBindings`; **does not** bump `refreshKey` |
| Workflow / pipeline / release events | ✅ | Event listeners → `refreshKey++` |
| 5-second poll | ✅ Fallback | `setInterval` → `refreshKey++` |

**Risk:** Production-tab attach may appear stale for up to 5 seconds if `feedReels` and `seriesCatalog` subscriptions do not both invalidate in the same tick. Content-tab attach is explicitly wired; Production-tab attach is not symmetric.

---

## 2. Production Workflow Density

### 2.1 Shell hierarchy

```text
StudioExperience (admin mode)
└── ProductionCommandCenter.svelte          ← KPI strip, dashboard sections, risks, focus
    └── StudioWorkspaceLayout.svelte        ← 8 workspace tabs
        └── [Production tab]
```

### 2.2 Production tab widget order (top → bottom)

| # | Component | Purpose |
|---|-----------|---------|
| 1 | `CreatorEpisodeReadinessBoard` | Per-episode checklist + primary actions (PRODUCT-04B) |
| 2 | **Production slot** (`StudioExperience`): | |
|   | — `CreatorOnboardingWizard` | First-run guidance |
|   | — `EpisodeReelAttachmentPanel` | Vault reel attach (PRODUCT-02) |
|   | — Smart upload form + hierarchy CRUD | New content ingestion |
| 3 | `SeriesHealthDashboard` | Aggregate counts (coverage, missing, published) |
| 4 | `ProductionReadinessMeter` | Weighted % + 4 pillars |
| 5 | `WorkflowTaskCenter` | Blockers + completion path tasks |
| 6 | `ProductionPipelineBoard` | 9-column team task kanban |
| 7 | `PipelineBoard` | 8-column episode kanban |

**Scroll estimate:** Command Center shell ≈ 2–3 viewports before workspace tabs; Production tab content ≈ 4–6 viewports to reach pipeline boards. **~15–20 distinct UI sections** visible across the full creator production surface.

### 2.3 Content tab (action targets live here)

| Component | Purpose |
|-----------|---------|
| `SeriesMetadataEditor` | Episode metadata (description, runtime, genre) |
| `ReleaseCenter` | Scheduling and launch |
| `MissingAssetQueue` | Legacy attach queue |
| `EpisodeOperationsTable` | Read-only ops table (nav target for thumbnails) |
| Media Vault / thumbnails | Thumbnail assignment |

**Correction from PRODUCT-04B audit:** `EpisodeOperationsTable` and `MissingAssetQueue` are on the **Content** tab, not Production. Readiness actions that target these selectors fail when the creator stays on Production.

### 2.4 Duplication matrix

Same signals appear in multiple surfaces, powered by the same engines:

| Signal | Readiness Board | WorkflowTaskCenter | SeriesHealth | ReadinessMeter | Guide Me (Overview) | Command Center |
|--------|-----------------|-------------------|--------------|----------------|---------------------|----------------|
| Series readiness % | subtitle | projected header | overall score | weighted % | context cards | KPI ×3 |
| Per-episode gaps | ✅ row checks | task titles | — | assets pillar | blocker insights | production risks |
| Missing asset count | per-row | MISSING_ASSET blockers | `missingAssets` | assets pillar | — | bottlenecks metric |
| Recommended actions | action buttons | task cards | — | — | 6 mission cards | recommendedActions |
| Open workflow tasks | — | open count | — | — | workflow context | workflow mini-list |
| Pipeline stage | — | — | — | — | — | (boards below) |

**Shared engines (no duplication of logic, but duplication of presentation):**

- `computeProductionReadiness` / `computeSeriesHealth`
- `buildStudioActionPlan`
- `buildWorkflowTasks` / `syncWorkflowTasks`
- `buildCommandCenterSnapshot` / `buildGuideMeOperationalBrief`

### 2.5 Density assessment

| Issue | Severity | Evidence |
|-------|----------|----------|
| Same readiness % in 4–6 places | Medium | Command Center KPI + meter + board subtitle + Guide Me |
| Three action surfaces for same blockers | High | Readiness Board + WorkflowTaskCenter + Guide Me missions |
| Two kanban boards stacked | Medium | `ProductionPipelineBoard` + `PipelineBoard` — overlapping episode lists |
| Production slot mixes attach + upload + hierarchy | Medium | Creator completing attach must scroll past upload form |
| Overview tab duplicates Production signals | Low | By design for executive mode; adds cognitive load for daily creators |

**Creator impact:** High information availability, low **signal-to-noise ratio**. The Readiness Board is the right primary surface; everything below it on Production tab is largely reinforcement or legacy overlap.

---

## 3. Episode Lifecycle

### 3.1 Stage map across systems

```text
Creator concept          Catalog (episode.status)    Asset display          Readiness gates           Release Center
─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Idea / planned           (episode exists)            Draft / Missing Asset  —                         draft
Draft (no reel)          draft                       Missing Asset          assets pillar = 0         draft
Assets collected         draft + reelId              Scheduled†             reelInFeed = true         ready (if asset)
Metadata complete        draft + reelId              Scheduled              metadataComplete = true   ready
Production ready         ready                       Ready                  all pillars partial       ready
Approved (pipeline)      ready                       Ready                  isPublishingBlocked=false scheduled
Released                 published                   Published              publishing = 100%         released
```

† **Naming collision:** `resolveEpisodeAssetStatus` maps `draft` + attached reel → display status **`Scheduled`**, which is unrelated to Release Center scheduling. Creators may read "Scheduled" as "release date set" when it only means "has reel, still draft."

### 3.2 Lifecycle flow (creator path)

```text
Idea
 ↓  (catalog episode exists)
Draft — no reel
 ↓  EpisodeReelAttachmentPanel / MissingAssetQueue
Assets collected — reel attached + in feed
 ↓  SeriesMetadataEditor (Content tab)
Metadata + thumbnail complete
 ↓  ReleaseCenter / pipeline approval
Production ready — status ready, pipeline READY + approvedBy
 ↓  Publish / schedule elapsed
Released
```

### 3.3 Bottleneck analysis

| Stage transition | Capability exists? | Creator friction |
|------------------|-------------------|------------------|
| Idea → Draft | ✅ Catalog | Low — episodes pre-seeded in demo |
| Draft → Assets | ✅ PRODUCT-02 attach | **Medium** — best path on Production; nav contract inconsistent |
| Assets → Metadata | ✅ Content editor | **High** — cross-tab; broken auto-nav from Production |
| Metadata → Thumbnail | ✅ Vault thumbnails | **High** — no dedicated completion surface at nav target |
| Ready → Approved | ✅ Pipeline boards | **Medium** — separate from readiness %; `isPublishingBlocked` invisible on board |
| Approved → Released | ✅ ReleaseCenter | **Medium** — Content tab; not linked from readiness actions cleanly |

**Primary bottleneck (post-PRODUCT-04B):** **Assets → Metadata → Thumbnail** on the Content tab, reachable from Production guidance but not efficiently routed.

**Secondary bottleneck:** **Publishing gate** — readiness % can improve while `isPublishingBlocked(episodeId)` remains true (pipeline stage ≠ READY or no `approvedBy`).

---

## 4. Top Friction Points (ranked)

### 1. Broken cross-tab action router (High)

Readiness Board actions assume workflow targets are reachable via scroll on the current tab. Metadata, thumbnail, and release targets live on **Content** tab DOM nodes. `navigateToTarget({ tab: 'Production' })` does not switch tabs when `workflowNavigation.target` is set.

**Impact:** Creator sees action hint → clicks → nothing visible happens (or wrong element highlighted) → manual tab discovery.

**Evidence:** `deepNavigationEngine.js:200–222`, Content slot in `StudioExperience.svelte:875–897`, Production tab structure in `StudioWorkspaceLayout.svelte:451–464`.

### 2. No completion loop / asymmetric refresh (High)

Creators are guided **out** to resolve blockers but never guided **back**. Production attach does not mirror Content attach's `refreshKey++` path.

**Impact:** Uncertainty whether action worked; creator may re-click or scroll hunting for updated state.

**Evidence:** `handleEpisodeAssetChanged` vs `handleQueueAttached` in `StudioWorkspaceLayout.svelte`; no scroll-to-board in `CreatorEpisodeReadinessBoard.svelte`.

### 3. Production tab density + signal duplication (Medium)

~15–20 sections; readiness % and blocker lists repeat across Board, Task Center, Health, Meter, Guide Me, and Command Center.

**Impact:** Scroll cost, unclear hierarchy ("which surface is authoritative?"), slower daily production runs.

**Evidence:** Production tab component list; duplication matrix §2.4.

### 4. `missing-metadata` routing gap (Medium)

Action engine emits `missing-metadata`; workflow engine has no nav mapping.

**Impact:** "Complete Metadata" button may silently fail for genre/title gaps.

**Evidence:** `actionEngine.js:248`, `workflowEngine.js:73–80`.

### 5. Dual attach surfaces + status naming (Low–Medium)

Two attach UIs; asset display "Scheduled" conflates draft-with-reel and release-scheduled.

**Impact:** Confusion about which attach path is canonical; misread episode status.

---

## 5. Efficiency Metrics (baseline for PRODUCT-06)

Suggested measurements before any implementation:

| Metric | Current estimate | Target (PRODUCT-06) |
|--------|------------------|---------------------|
| Clicks: readiness → reel attached | 3–4 | ≤3 |
| Clicks: readiness → metadata saved | 5–8 | ≤4 |
| Clicks: readiness → thumbnail set | 4–6+ | ≤4 |
| Actions with successful auto-nav from Production | ~1 of 6 types | 6 of 6 |
| Time to board refresh after attach | 0–5s | Immediate |
| Production tab scroll to primary action | 1–2 viewports | 0 (board at top) |
| Duplicate readiness % displays on Production | 4 | 1–2 |

---

## 6. Recommended PRODUCT-06+ Candidates

**Do not implement yet.** Prioritized by loop-efficiency impact:

### PRODUCT-06A — Unified Action Router (Highest value)

Single `resolveCreatorAction(actionType, episodeId)` that:

1. Determines correct workspace tab (Production vs Content)
2. Fires `reelforge:search-navigate` **before** scroll
3. Sets store prefill (`studioAttachEpisodeId`, `studioSeriesMetadataReelId`)
4. Scrolls to correct target
5. On completion event → scroll back to readiness row

**Scope:** Navigation layer only. No new readiness logic.

### PRODUCT-06B — Completion Loop Wiring

- Dispatch `reelforge:episode-production-updated` from attach, metadata save, thumbnail assign
- Bump `refreshKey` symmetrically (Production + Content paths)
- Highlight completed row on Readiness Board for 2–3s

**Scope:** Event wiring + UX feedback. No engine changes.

### PRODUCT-06C — Production Tab Consolidation

Collapse on Production tab:

- Health + Meter + WorkflowTaskCenter → single "Production Status" strip
- Move upload/hierarchy to Content or collapsible drawer
- Evaluate merging dual kanban boards

**Scope:** Layout refactor. Reduces density without removing capability.

### PRODUCT-06D — Inline Row Completion (Optional, larger scope)

Embed attach dropdown / metadata mini-form directly in Readiness Board rows for top 2 blockers (reel, metadata).

**Scope:** UX enhancement. Eliminates cross-tab travel entirely for common paths.

### Quick fix bundle (minimal PRODUCT-06)

1. Add `missing-metadata` → `metadata-editor` in `ACTION_NAV_MAP`
2. Fix `navigateToWorkflow` to honor tab switch when target is on another tab
3. Wire `handleEpisodeAssetChanged` → `refreshKey++`

---

## 7. What NOT to Do

Per PRODUCT-04/04B architectural conclusion:

```text
❌  New readiness dashboard
❌  Duplicate readiness calculations
❌  New localStorage keys for creator state
❌  Expand upload / hero / attachment architecture
❌  New AI recommendation layer
```

The system has enough visibility. The next gains come from **execution efficiency**, not **more intelligence**.

---

## 8. Classification

```text
PRODUCT-04   Discover readiness intelligence
PRODUCT-04B  Expose intelligence to creators
PRODUCT-05   Measure creator execution friction   ← this mission
PRODUCT-06   Optimize creator execution           ← recommended next
```

---

## 9. Success Criteria (PRODUCT-05)

| Criterion | Status |
|-----------|--------|
| Readiness → completion loop documented | ✅ |
| Click paths and tab dependencies measured | ✅ |
| Production tab density mapped | ✅ |
| Duplication between surfaces identified | ✅ |
| Episode lifecycle bottlenecks located | ✅ |
| PRODUCT-06 candidates prioritized | ✅ |
| No code changes | ✅ |

---

## 10. Conclusion

PRODUCT-04B correctly completed the creator feedback loop at the **visibility** layer. PRODUCT-05 shows the loop is **open at the bottom**: creators can see what's missing but cannot always reach resolution in one motion, cannot always see immediate confirmation, and face redundant surfaces while doing so.

ReelForge is behaving like a production platform. The next threshold is **production velocity** — measured in clicks, tab switches, and time-to-refreshed-state, not in new dashboards.

**Recommended next mission:** `PRODUCT-06A — Unified Creator Action Router` (narrow implementation of the router + completion events, not full tab consolidation).
