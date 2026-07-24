# VIDEO-SYNC-01 — Tombstone Enforcement Boundary

**Mission:** Enforce tombstone invariant at `mergeVideoVaultEntries` (sync merge choke point).  
**Date:** 2026-07-24  
**Deploy:** Not deployed (per mission scope).

---

## Changes

### 1. Merge choke point (primary)

**File:** `frontend/src/viewer/viewerContext.js`  
**Function:** `mergeVideoVaultEntries()`

Before backend catalog projection is written into `personal_video_vault`, any entry whose `id` or `personal_video_id` exists in `reelforge_deleted_media_ids` is rejected.

Instrumentation:

```
[VIDEO-SYNC-01] mergeVideoVaultEntries:tombstone-reject
  { mergeMode, backendReachable, rejectedIds, incomingCount, keptCount, ts }
```

Applied on both paths:

| Mode | `mergeMode` |
|------|-------------|
| `backendReachable: true` | `backend-projection` |
| offline merge | `offline-merge` |

**Not changed:** thumbnail code, hero code, bootstrap ghost purge, storage migrations, broad vault rewrites.

### 2. Tombstone before sync on fallback (companion)

**File:** `frontend/src/lib/viewer/aiCleanupAgent.js`  
**Function:** `deleteVaultVideo()` — when `!persistenceSuccess`, `recordDeletedMediaIds(videoId)` before local purge + `syncFromVault`.

Log: `[VIDEO-SYNC-01] deleteVaultVideo:tombstone-before-sync`

Required so merge gate has a tombstone when `!token || !diskName` skips `applyCanonicalDeleteClientEffects`.

---

## Invariant enforced

> A locally deleted canonical ID must remain deleted regardless of catalog timing.

When tombstone exists, merge cannot resurrect the id even if `GET /api/reels` still returns it briefly.

---

## Verification matrix

| Test | Expected | Local unit | Production probe (pre-deploy) |
|------|----------|------------|-------------------------------|
| Delete with token + diskName | stays deleted | PASS (merge gate) | PASS (`resurrectedInVault: false`) |
| Delete with missing diskName | stays deleted | PASS (tombstone fallback + merge gate) | Requires deploy to validate on Netlify |
| Delete while backend catalog briefly contains item | stays deleted | PASS (case 3 in unit script) | Requires deploy + `[VIDEO-SYNC-01]` log |
| Refresh after delete | stays deleted | Same as tombstone present | Requires deploy |

### Local unit script

```bash
node frontend/scripts/video-sync-01-merge-unit.mjs
```

All four local cases passed (2026-07-24).

### Production tombstone script (unchanged bundle)

```bash
node frontend/scripts/video-sync-tombstone-verify.mjs
```

Latest run against Netlify `index-q8wTbWuf.js` (pre-patch):

- `tombstoneWritten: false` — `!diskName` guard at `aiCleanupAgent.js:613`
- `resurrectedInVault: false` — deleted id not in vault after delete (this session)

Post-deploy: re-run probe; expect `[VIDEO-SYNC-01] mergeVideoVaultEntries:tombstone-reject` when catalog still contains tombstoned id.

---

## Remaining gap (addressed in companion one-liner)

When `!token || !diskName`, `applyCanonicalDeleteClientEffects` was skipped → no tombstone → merge gate had nothing to enforce.

**Companion fix (minimal):** `recordDeletedMediaIds(videoId)` in the local-purge fallback before `syncFromVault` (`aiCleanupAgent.js`), with log `[VIDEO-SYNC-01] deleteVaultVideo:tombstone-before-sync`.

Without a tombstone, merge enforcement is a no-op — both layers are required for the full invariant.

---

## Build

```bash
cd frontend && npm run build
```

Build succeeded; bundle `index-wugH44bQ.js` (local only, not deployed).

---

## Isolated missions (unchanged)

| Mission | Status |
|---------|--------|
| THUMB-CANONICAL-01 | Deferred |
| HERO-R2-01 | Deferred |
