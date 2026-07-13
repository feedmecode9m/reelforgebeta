# MISSION 5.8.10 — Validator Architecture Redesign

Generated: 2026-07-13

## Executive summary

Mission 5.8 stress validation was redesigned from **simultaneous capacity** testing to **rolling-window throughput** testing. The old validator assumed 100 thumbnails could coexist in the vault; the application enforces `MAX_THUMBNAILS = 20`. That mismatch made Mission 5.8-F impossible at `STRESS=100` / `DELETE_STRESS=100`.

The new validator processes 100 uploads and 100 deletes across multiple windows of at most 20 items, never exceeding application capacity.

---

## Why the old validator could never succeed

### Application invariant

```javascript
// frontend/src/lib/storage.js
STORAGE_LIMITS: { MAX_THUMBNAILS: 20 }
```

`stripHeavyThumbnailEntries`, `clearOldestThumbnailData`, and persistent store writes all cap the vault at 20 entries. Additional uploads evict or reject; the vault cannot hold 100 simultaneous thumbnails.

### Old 5.8-D behavior

```javascript
for (let i = 0; i < stressCount; i++) {
  await dropThumb(page, `m58-stress-${RUN_ID}-${i}.png`);
  // assert thumbs === index === cards after each upload
}
```

With `MISSION_5_8_STRESS=100`, the loop attempted 100 consecutive uploads in one session without rolling deletes. After upload 20, the vault stayed at 20 entries. Uploads 21–100 replaced or failed to grow the vault, so the test measured **replacement churn**, not **100 distinct successful ingestions**, and never validated throughput across capacity boundaries.

### Old 5.8-F behavior (fatal flaw)

```javascript
for (let i = 0; i < deleteStress; i++) {
  await dropThumb(page, `m58-del-${RUN_ID}-${i}.png`);
}
const pre = await vaultSnap(page);
if (pre.thumbs < deleteStress) {
  fail('5.8-F delete setup', `Expected >=${deleteStress} thumbs before delete, got ${pre.thumbs}`, pre);
}
```

With `MISSION_5_8_DELETE_STRESS=100`:

1. Upload loop runs 100 times.
2. Vault caps at **20** thumbnails.
3. Setup assertion requires `pre.thumbs >= 100`.
4. Test fails immediately: `Expected >=100 thumbs before delete, got 20`.

This is not a product bug — it is a **validator architecture bug**. The test conflated *total lifetime operations* with *simultaneous vault occupancy*.

### Secondary issues in old 5.8-F

| Issue | Impact |
|-------|--------|
| Button selector `/delete all thumbnails/i` | No such button exists; UI uses `🗑️ BATCH DELETE ALL` in the thumbnail section |
| Single batch delete after 100 uploads | Even if capacity were unlimited, one delete pass cannot prove delete throughput |
| No per-window invariant checks | Divergence, orphans, and backend drift could accumulate across windows undetected |

Profile evidence (`MISSION_5_8_PROFILE.md`) recorded the failure:

> **5.8-F failed**: expected 100 thumbs, got **20** (`MAX_THUMBNAILS=20`)

---

## New architecture: rolling-window throughput

### Design principles

1. **Never exceed `MAX_THUMBNAILS` (20)** in localStorage, index, or render layer at any checkpoint.
2. **Measure totals**, not peak occupancy: 100 uploads and 100 deletes over the run.
3. **Validate after every window**, not only at the end.
4. **Do not modify application code** — only `scripts/mission-5.8-validate.mjs`.

### Window model

```
WINDOW_SIZE = MAX_THUMBNAILS = 20

Example: STRESS=100, DELETE_STRESS=100 → 5 cycles

Cycle 0: upload 20 → validate → delete 20 → validate
Cycle 1: upload 20 → validate → delete 20 → validate
...
Cycle 4: upload 20 → validate → delete 20 → validate

Total uploads  = 100
Total deletes  = 100
Peak occupancy = 20 (never 100)
```

### 5.8-D — upload throughput (`runRollingUploadThroughput`)

For each window until `totalUploads` target is met:

1. If vault would exceed capacity, batch-delete to make room (rolling forward).
2. Upload `min(remaining, WINDOW_SIZE)` thumbnails.
3. **Validate window** (see metrics below).
4. If more uploads remain, batch-delete all and validate empty vault before next window.

### 5.8-F — delete throughput (`runRollingDeleteThroughput`)

For each window until `totalDeletes` target is met:

1. Assert vault is empty at cycle start.
2. Upload `min(remaining, WINDOW_SIZE)` thumbnails.
3. Validate pre-delete state.
4. Batch-delete all thumbnails.
5. Validate post-delete empty state and backend drain.

### Per-window validation (`validateThroughputWindow`)

Each checkpoint verifies:

| Invariant | Check |
|-----------|-------|
| Canonical identity preserved | `withId === uniqueIdCount` when non-empty |
| No phantom thumbnails | `phantomCards === 0` (render − storage, placeholders) |
| No duplicate ids | `duplicateIds === 0` |
| No orphan accumulation | `orphanCount === 0` after delete windows |
| No storage divergence | `localStorageCount === indexCount === renderCount` |
| No backend divergence | `|backendCount − withId| ≤ tolerance` (upload windows); `backendCount ≈ 0` after deletes |
| Capacity bound | `localStorageCount ≤ MAX_THUMBNAILS` |

### Metrics collected (`vaultMetrics`)

| Field | Meaning |
|-------|---------|
| `totalProcessed` | Upload + delete operations in window |
| `totalUploads` / `totalDeletes` | Cumulative throughput |
| `duplicateIds` | Id collision count |
| `orphanCount` | Entries flagged orphaned or id-less non-canonical |
| `renderCount` | `.vault-grid--images .vault-card` DOM count |
| `backendCount` | `GET /api/reels` entries with `/thumbs/` URL |
| `localStorageCount` | `personal_thumbnails` array length |
| `failures` | Validation failures (fail-fast via `fail()`) |

### Batch delete selector fix

```javascript
// Scoped to "Your Thumbnails" section — avoids video vault BATCH DELETE ALL
const thumbSection = grids.find((g) => g.textContent?.includes('Your Thumbnails'));
const btn = [...scope.querySelectorAll('button')].find((b) => /BATCH DELETE ALL/i.test(b.textContent || ''));
```

---

## Environment variables (unchanged)

| Variable | Default | Meaning |
|----------|---------|---------|
| `MISSION_5_8_STRESS` | `10` | Total upload throughput target |
| `MISSION_5_8_DELETE_STRESS` | `10` | Total delete throughput target |

Full stress run:

```bash
cd frontend
MISSION_5_8_STRESS=100 MISSION_5_8_DELETE_STRESS=100 node scripts/mission-5.8-validate.mjs
```

---

## Files changed

| File | Change |
|------|--------|
| `scripts/mission-5.8-validate.mjs` | Rolling throughput helpers; 5.8-D and 5.8-F rewritten |
| `MISSION_5_8_VALIDATOR_REDESIGN.md` | This document |

**Not changed:** `frontend/src/**` (application behavior untouched).

---

## Expected runtime impact

Rolling windows add batch-delete settle waits (`15s` each) between upload batches when `STRESS > 20`. For `STRESS=100`, expect ~4 extra delete windows in 5.8-D plus 5 full cycles in 5.8-F — longer than the old (broken) single-pass attempt, but **the test can now pass** and actually exercises upload/delete throughput under the real capacity invariant.
