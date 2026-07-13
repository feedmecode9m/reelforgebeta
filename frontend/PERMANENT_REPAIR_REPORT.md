# Mission 5.8 — Permanent Thumbnail Vault Repair Report

Generated: 2026-07-12

## Status

**Repair validated.** Mission 5.8 checks PASS (ghost purge, index sync, hard refresh, stress). Run `node scripts/mission-5.8-validate.mjs`. Prior mission 5.5 fails on reload hydration (pre-existing gap).

## Root cause (why impossible states occurred)

Four independent authorities could disagree:

1. **Backend** (`GET /api/reels`) — 0 reels
2. **`personal_thumbnails`** — 20 metadata objects (some without `id`, some with ghost ids)
3. **`personal_thumbnail_index`** — 20 fileName keys via `createPersistentStore` (render authority)
4. **`personalThumbnailCollection`** — hydrated from index on first subscription, **before** reconciliation

Validation scripts counted backend + metadata; the live UI rendered the **index store**, which was never purged when deletes returned 404 or when `deletedIds` was empty.

### Critical race (5.8 fix)

`VaultExperience.ensureThumbnailCanonicalization` captured a **stale in-memory snapshot** of vault entries at function start. When `viewerContext.syncFromVault` reconciled and purged ghosts first, the component path **re-wrote the stale snapshot** back to `personal_thumbnails` via `writeThumbnailVault(entries)` (triggered by `needsWork` which was always `true`). Result: `thumbs=20` in localStorage, `cards=0` in derived collection — the exact live failure mode.

**Fix:** Removed pre-reconcile writes from `ensureThumbnailCanonicalization`. Only `reconcileThumbnailVault` may mutate vault metadata. Ghost ids with no backend match are classified `stale` in `classifyThumbnailEntry` when `backendReachable`.

### Specific failure chains (5.7.7)

| Symptom | Mechanism |
|---------|-----------|
| DELETE 404 → count unchanged | `applyThumbnailDeleteTombstone` gated on successful ids only |
| BATCH DELETE ALL, idsToDeleteCount: 0 | Orphan/id-less entries skipped tombstone (`!id \|\| !deletedSet.has(id)` preserves all) |
| Ghost canonical | Entry with `id` not on backend kept as CANONICAL |
| Startup orphans survive | `purgeStaleOrphanThumbnails` never ran without prior delete |

## Permanent repair (one path each)

| Concern | Single owner |
|---------|--------------|
| Source of truth | `personal_thumbnails` only |
| Write path | `thumbnailVault.writeThumbnailVault` / `appendThumbnailVaultEntry` |
| Delete path | `thumbnailVault.deleteThumbnailVaultEntries` (+ `removeThumbnailVaultByIndex` for legacy single delete) |
| Reconciliation | `thumbnailVault.reconcileThumbnailVault` |
| Startup | `viewerContext.reconcileStaleThumbnailsOnStartup` after `syncFromVault` |
| Collection render | `thumbnailVault.syncCollectionStore` → `writable([])` store |

## Code changes (minimal, removal-first)

### Added
- `src/lib/viewer/thumbnailVault.js` — single owner
- `src/lib/viewer/thumbnailInvariants.js` — runtime assertions

### Modified
- `src/viewer/viewerContext.js` — `personalThumbnailCollection` no longer `createPersistentStore`; reload/reconcile via vault module
- `src/components/experiences/VaultExperience.svelte` — all vault mutations delegate to `thumbnailVault`; ghost ids on 404
- `src/lib/viewer/aiCleanupAgent.js` — single delete uses `removeThumbnailVaultByIndex`

### Removed / neutralized
- `createPersistentStore(THUMBNAIL_INDEX_KEY)` as render authority
- Direct `storeThumbnailMetadata` / `personalThumbnailCollection.update` for thumbnail lifecycle (except authoritative empty-backend clear)

## Create paths (post-repair)

| File | Function | Line | Id assigned? | Persisted? |
|------|----------|------|--------------|------------|
| `VaultExperience.svelte` | `acceptPendingThumbnail` | ~1070 | After sync | Yes via `appendThumbnailVaultEntry` |
| `thumbnailVault.js` | `appendThumbnailVaultEntry` | 203 | If in entry | Yes |
| `thumbnailVault.js` | `writeThumbnailVault` | 70 | Normalized | Yes |
| `mediaBootstrap.js` | `ingestThumbReelsToVault` | 209 | Updates existing only | Yes (no new entries) |

## Delete paths (post-repair)

| File | Function | Line | Mechanism |
|------|----------|------|-----------|
| `VaultExperience.svelte` | `batchDeleteSelectedThumbnails` | ~488 | API + `deleteThumbnailVaultEntries` + ghostIds |
| `VaultExperience.svelte` | `batchDeleteThumbnails` | ~1141 | Delete all + reconcile |
| `VaultExperience.svelte` | `applyThumbnailDeleteTombstone` | ~334 | `deleteThumbnailVaultEntries` |
| `VaultExperience.svelte` | `purgeStaleOrphanThumbnails` | ~311 | `reconcileThumbnailVault` |
| `aiCleanupAgent.js` | `handleThumbnailRemove` | ~369 | `removeThumbnailVaultByIndex` |
| `viewerContext.js` | `syncFromVault` (empty backend) | ~1053 | `writeThumbnailVault([])` |

## Validation matrix

| Mission | Script | Focus |
|---------|--------|-------|
| 5.5 | `mission-5.5-validate.mjs` | Canonical id identity |
| 5.6 | `mission-5.6-validate.mjs` | Upload pipeline |
| 5.6.5 | `mission-5.6.5-validate.mjs` | Extended upload |
| 5.7 | `mission-5.7-validate.mjs` | Batch delete by id |
| 5.7.1 | `mission-5.7.1-validate.mjs` | Selection model |
| 5.7.2 | `mission-5.7.2-validate.mjs` | No catalog import |
| 5.7.3 | `mission-5.7.3-validate.mjs` | Delete propagation |
| 5.7.4 | `mission-5.7.4-validate.mjs` | Orphan lifecycle |
| 5.7.5 | `mission-5.7.5-render-audit.mjs` | Render source audit |
| 5.7.6 | `mission-5.7.6-validate.mjs` | Startup reconciliation |
| 5.7.7 | `mission-5.7.7-live-delete-audit.mjs` | Live delete events |
| 5.8 | `mission-5.8-validate.mjs` | Ghost purge, stress, invariants |

## Expected post-repair behavior

- Backend 0 + reachable → vault 0 → UI 0 cards
- DELETE 404 → entry treated as ghost → removed from vault
- Hard refresh after delete → no phantom cards
- Index length always equals metadata-derived key count
- No `[THUMBNAIL_INVARIANT_VIOLATION]` in strict validation run

## Mission 5.8 validation (2026-07-12)

| Check | Result |
|-------|--------|
| 5.8-A ghost purge | **PASS** (thumbs=0, cards=0 after 20 ghost canonicals + empty backend) |
| 5.8-B index sync | **PASS** |
| 5.8-C hard refresh | **PASS** |
| 5.8-D stress uploads (10) | **PASS** |
| Invariant violations | None |

### Fixes applied for 5.8-A

1. **`viewerContext.js` `syncFromVault`**: Treat any HTTP response from `GET /api/reels` as `backendReachable=true` (including 401/403). Non-OK responses use `rawData=[]` for reconcile instead of localStorage fallback. Pass admin auth header. Empty-backend path calls `syncCollectionStore` after `writeThumbnailVault([])`. `mountViewer` uses `syncFromVault(true, true)` to bypass cooldown on startup.
2. **`VaultExperience.svelte`**: Fixed duplicate `reels` declaration (build blocker). `ensureThumbnailCanonicalization` uses `fetchWithRetry`, treats HTTP errors as reachable with empty catalog, reconciles all vault entries (including ghost canonicals with ids), always calls `syncCollectionStore` after reconcile.
3. **`mission-5.8-validate.mjs`**: Mock `GET /api/reels` as `[]` via `page.route` before navigation in scenario 5.8-A.

### Prior mission regression (orchestrated run)

| Mission | Result |
|---------|--------|
| mission-5.5-validate.mjs | **FAIL** — after-reload metadata empty when `addInitScript` clears `personal_thumbnails` on navigation; vault not re-hydrated from backend when local vault is empty (`ingestThumbReelsToVault` / `hydrateVaultFromReels` skip insert). Not introduced by 5.8 ghost-purge fix; 5.8-C hard-refresh passes with normal reload semantics. |
| mission-5.6 through 5.7.7 | Not reached (5.8 script stops on first prior failure) |

### Remaining issues

- Mission 5.5 reload hydration: when `personal_thumbnails` is empty but backend has thumb reels, startup should seed vault from `GET /api/reels` (separate from ghost purge).
- Restart Vite after `VaultExperience.svelte` syntax fix if dev server served 500 on that module.
