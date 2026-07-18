# PRODUCT-06A — Unified Creator Action Router

**Mission type:** Workflow routing repair — **no readiness engine or feature changes**  
**Date:** 2026-07-16  
**Predecessors:** [`PRODUCT-04B_READINESS_BOARD_AUDIT.md`](PRODUCT-04B_READINESS_BOARD_AUDIT.md), [`PRODUCT-05_CREATOR_PRODUCTION_LOOP_AUDIT.md`](PRODUCT-05_CREATOR_PRODUCTION_LOOP_AUDIT.md)

---

## Executive Summary

PRODUCT-06A repairs the creator action completion loop identified in PRODUCT-05. A unified **creator action router** now:

1. Switches workspace tabs **before** scrolling to targets
2. Waits for target DOM mount
3. Routes `missing-metadata` correctly
4. Emits a completion event that refreshes readiness state and returns creators to the board

No new dashboards, readiness formulas, or workflow engines were added.

---

## 1. Existing Navigation Architecture

### Before PRODUCT-06A

```text
CreatorEpisodeReadinessBoard
        ↓
navigateToTarget({ type: 'workflow', workflowNavigation })
        ↓
navigateToWorkflow()
        ↓
executeWorkflowNavigation()   ← scroll only, current tab
        ↓
Target often absent (Content tab DOM while on Production)
```

### After PRODUCT-06A

```text
CreatorEpisodeReadinessBoard / WorkflowTaskCard
        ↓
navigateCreatorAction() / routeWorkflowNavigation()
        ↓
1. activateWorkspaceTab(tab)           ← reelforge:search-navigate
2. reelforge:workflow-navigate         ← store prefill (viewerContext)
3. waitForSelector(selector)           ← poll up to 4s
4. executeWorkflowNavigation()         ← scroll + focus
        ↓
[User completes task]
        ↓
emitCreatorProductionUpdated()
        ↓
reelforge:creator-production-updated
        ↓
StudioWorkspaceLayout refreshKey++
        ↓
Return to Production + highlight readiness row
```

---

## 2. Root Causes (from PRODUCT-05)

| Issue | Root cause |
|-------|------------|
| Metadata/thumbnail actions failed from Production | `navigateToWorkflow` skipped tab switch when `workflowNavigation.target` was set |
| `missing-metadata` broken | `actionEngine` emitted type; `ACTION_NAV_MAP` had no entry |
| Stale readiness board after Production attach | `handleQueueAttached` bumped `refreshKey`; Production attach path did not |
| No completion confirmation | No event bridged task completion back to readiness UI |

---

## 3. Files Changed

| File | Change |
|------|--------|
| `src/lib/studio/creatorActionRouter.js` | **Created** — tab-first routing, completion events, return-to-board |
| `src/lib/series/workflowEngine.js` | Added `missing-metadata` to `ACTION_NAV_MAP`, types, estimates |
| `src/lib/navigation/deepNavigationEngine.js` | `navigateToWorkflow` delegates to `routeWorkflowNavigation` |
| `src/components/studio/CreatorEpisodeReadinessBoard.svelte` | Uses `navigateCreatorAction`; row highlight CSS |
| `src/components/studio/StudioWorkspaceLayout.svelte` | Listens for `CREATOR_PRODUCTION_UPDATED` → `refreshKey++` |
| `src/components/studio/EpisodeReelAttachmentPanel.svelte` | Emits completion on successful attach |
| `src/components/series/MissingAssetQueue.svelte` | Emits completion on attach |
| `src/components/experiences/StudioExperience.svelte` | `handleMetadataSaved` → completion event |
| `src/components/workflow/WorkflowTaskCard.svelte` | Uses `routeWorkflowNavigation` with `workflow-task` source |

### Not modified (frozen)

Upload pipeline, Hero workflow, thumbnail generation, ingestion, readiness calculations, episode asset models, storage contracts.

---

## 4. Routing Changes

### Tab mapping (`WORKFLOW_TARGET_TABS`)

| Nav target | Workspace tab | Creator selector override |
|------------|---------------|---------------------------|
| `reel-attach` | Production | `[data-testid="episode-reel-attach-panel"]` |
| `metadata-editor` | Content | `[data-series-metadata-editor]` |
| `release-scheduler` | Content | `[data-series-metadata-editor]` |
| `episode-editor` (thumbnail) | Content | `[data-content-panel="assets"]` |

### `missing-metadata` routing

```text
actionEngine: missing-metadata
        ↓
buildTaskNavigation('missing-metadata', episodeId, reelId)
        ↓
ACTION_NAV_MAP: metadata-editor
        ↓
Content tab → SeriesMetadataEditor
```

### Navigation order (enforced)

```text
1. Determine destination tab from nav target
2. activateWorkspaceTab via reelforge:search-navigate
3. Emit reelforge:workflow-navigate (store prefill)
4. Poll for selector (50ms interval, 4s max)
5. executeWorkflowNavigation (scroll + field focus)
```

Fallback: if override selector fails, retry base `WORKFLOW_NAV_TARGETS` selector.

---

## 5. Completion Event Flow

### Event

```text
reelforge:creator-production-updated
```

Exported constant: `CREATOR_PRODUCTION_UPDATED`

### Emitters

| Source | Trigger | Payload |
|--------|---------|---------|
| `EpisodeReelAttachmentPanel` | Successful attach | `{ episodeId, reelId, actionType: 'missing-asset' }` |
| `MissingAssetQueue` | Successful attach | `{ episodeId, reelId, actionType: 'missing-asset' }` |
| `SeriesMetadataEditor` (via StudioExperience) | Save metadata | `{ reelId, actionType: 'missing-metadata' }` + episode lookup |

### Listeners

| Consumer | Behavior |
|----------|----------|
| `StudioWorkspaceLayout` | `refreshKey++`, `refreshSnapshot`, `dispatch('changed')` |
| `creatorActionRouter` | If action started from readiness board → switch to Production tab, scroll/highlight completed row |

### Return-to-board

When `lastCreatorActionContext.source` is `readiness-board` or `workflow-task`:

```text
emitCreatorProductionUpdated
        ↓
activateWorkspaceTab('Production')
        ↓
scrollToReadinessEpisode(episodeId)
        ↓
Highlight row (workflow-nav-highlight, 2.4s)
```

---

## 6. Validation Results

### Build

```bash
npm run build
```

**Result:** ✅ PASS (2026-07-16)

### Functional verification

| Flow | Expected behavior | Status |
|------|-------------------|--------|
| Missing reel → Attach | Production tab, attach panel visible, pre-filled episode | ✅ Router + PRODUCT-02 panel |
| Missing reel → Complete | Completion event, board refresh, return to row | ✅ |
| Missing metadata → Open | Content tab, metadata editor visible | ✅ Tab-first routing |
| Missing metadata → Save | Board refresh via completion event | ✅ |
| Missing thumbnail → Navigate | Content tab, Media Vault section | ✅ Selector override |
| `missing-metadata` action type | Routes to metadata editor | ✅ ACTION_NAV_MAP entry |

### Regression (local preview `BASE_URL=http://127.0.0.1:4173`)

| Test | Result |
|------|--------|
| Hero Playwright | ✅ 1 passed |
| Hero confirmation | ✅ pass |
| Episode attachment | ✅ 1 passed |

---

## 7. Success Criteria

| Criterion | Status |
|-----------|--------|
| Actions open correct tab | ✅ |
| Targets become visible | ✅ (wait-for-mount + fallback) |
| Missing metadata routes correctly | ✅ |
| Completion updates readiness | ✅ |
| No duplicate workflow logic | ✅ (reuses `buildTaskNavigation`, existing panels) |

---

## 8. Creator Loop Status

```text
Detect blocker        ✅  Readiness Board
Understand blocker    ✅  Row checks + missing column
Navigate to solution  ✅  Tab-first router (PRODUCT-06A)
Complete task         ✅  Existing panels unchanged
Verify completion     ✅  Event + refresh + return-to-board (PRODUCT-06A)
```

---

## 9. Classification

```text
PRODUCT-04B  Visibility layer
PRODUCT-05     Execution friction audit
PRODUCT-06A    Creator action loop repair   ← this mission
```

Next optimization candidates (not in scope): Production tab consolidation (PRODUCT-06C), inline row completion (PRODUCT-06D).
