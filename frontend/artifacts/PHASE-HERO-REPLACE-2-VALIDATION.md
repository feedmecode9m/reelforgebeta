# PHASE-HERO-REPLACE-2 — Validation Report

**Mode:** READ-ONLY forensic (no code/commit/deploy)  
**When:** 2026-08-15T01:48:08.376Z  
**Frontend:** http://127.0.0.1:5173  
**Verdict:** **PHASE-HERO-REPLACE-2 LOCAL FAIL**

Artifact JSON: `/home/youloose2dafish/projects/reelforge/frontend/artifacts/PHASE-HERO-REPLACE-2-VALIDATION.json`

## 1. UI state transitions (explicit replace)

- +6ms · phase=`active` · **Current Hero Active** · Drop a file below to replace your homepage hero background. · asset=7d3984da-6fc4-4e17-a63d-0574bf1d4918
- +279ms · phase=`processing` · **Replacing Hero** · Uploading and applying your new hero… · asset=7d3984da-6fc4-4e17-a63d-0574bf1d4918
- +5376ms · phase=`committed` · **Hero Updated Successfully** · Your homepage hero background has been replaced. · asset=4336335c-0bdb-4eb2-8d20-f8a67d6a9a3d

## 2. Hero asset ID before/after

| Moment | heroAssetId | mode | panel |
|--------|-------------|------|-------|
| A current | 7d3984da-6fc4-4e17-a63d-0574bf1d4918 | asset | Current Hero Active |
| B after replace | 4336335c-0bdb-4eb2-8d20-f8a67d6a9a3d | asset | Hero Updated Successfully |
| C after refresh | 4336335c-0bdb-4eb2-8d20-f8a67d6a9a3d | asset | — |
| D after vault | 4336335c-0bdb-4eb2-8d20-f8a67d6a9a3d | — | — |
| D after vault refresh | 4336335c-0bdb-4eb2-8d20-f8a67d6a9a3d | — | — |

## 3. Persistence

- Pass: **true**

## 4. Media Vault isolation

- Vault 20 → 20
- Hero unchanged: **true**
- Distinction held: Replace Hero may change Hero; Vault must not.

## 5. Failure-state behavior

| Case | left processing | hero intact | retryable/fail UX | pass |
|------|-----------------|-------------|-------------------|------|
| E1 invalid file | true | true | true | true |
| E2 zero-byte | true | true | — | true |
| E3 upload 500 | true | true | true | true |
| E4 finalize broken body | true | true | true | true |
| E5 timeout/watchdog | true | true | timeoutLog=true | true |
| E7 late commit after watchdog | committed | false | — | false |

## 6. Stuck/loading-state risk

{
  "infiniteHangWithoutWatchdog": false,
  "smallFileWatchdogMs": 45000,
  "largeFileWatchdogMs": 900000,
  "processingCopyIsTransient": true,
  "lateCommitAfterWatchdog": true,
  "risk": "Files ≤12MiB: 45s watchdog clears processing. Files >12MiB: up to 15 min processing UX is expected. E7 probes whether a hung upload that later succeeds can still persist Hero after timeout UI."
}

Processing copy (“Uploading and applying your new hero…”) is the `processing` phase copy. It must be transient.

## 7. Regression results

- F pass: **false**
- IMG_/UUID filename cards: 0
- categoryPatch: 0
- titlePatch: 0
- descriptionPatch: 0
- productionCatalogWrites: 0
- ViewerSemanticCard / 6.6.2 / 6.6.3: no source edits this mission

## 8. Findings

- [FAIL] E7: Hero asset changed after watchdog timeout when hung upload later succeeded

## STOP — failure classification (no implementation started)

**Class:** `LATE_COMMIT_AFTER_WATCHDOG` (apply/persistence race, not a stuck spinner)

“Uploading and applying your new hero…” is **correct transient UX** for `heroReplaceUxPhase === 'processing'`. Happy-path B left that copy in ~5.4s. E5 watchdog cleared it at ~45s into `preview_pending` / “Upload Needs Attention”. Small files do not hang forever.

After the timeout UI, `acceptHeroFile` can still `commitHeroVideoIdentity` when a hung `uploadMedia` later returns a canonical reel. E7 delayed POST 48s then 200:

- +269ms processing, asset still `4336335c-…`
- +45262ms Upload Needs Attention, asset still `4336335c-…`
- after late 200: Hero Updated Successfully, asset `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`

Watchdog clears loading and bumps `heroAcceptOperationToken`, but there is no `isOperationActive()` gate between `await uploadMedia(...)` and `commitHeroVideoIdentity(reel)`.

F `heroStillReplacement=false` is a **cascade** of E7, not an independent 6.6 regression (category/title/description/catalog PATCH = 0).

## Pass matrix

| Section | Pass |
|---------|------|
| A Current Hero | true |
| B Explicit Replace | true |
| C Persistence | true |
| D Vault isolation | true |
| E1–E5 + E7 failures | false |
| F Regression | false |

**No implementation mission opened automatically.**
