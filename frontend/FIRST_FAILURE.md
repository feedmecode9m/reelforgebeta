# Mission 5.8.7 — First Failure

**Status:** PROVEN (runtime trace)  
**Do not implement fix until this writer is confirmed** — confirmed below.

---

## Symptom

- Backend: **0 user thumb reels** (catalog has videos but no `/thumbs/` image reels)
- Browser after hard refresh: **"Your Thumbnails (20)"** with placeholder cards
- `personalThumbnailCollection.length === 20`

---

## First incorrect state mutation

### Primary failure (UI-visible)

| Field | Value |
|-------|-------|
| **Function** | `reloadVaultStoresFromStorage` → `syncCollectionStore` |
| **File** | `frontend/src/viewer/viewerContext.js` |
| **Line** | **828** (`syncCollectionStore` call) |
| **Callee line** | `frontend/src/lib/viewer/thumbnailVault.js:115` (`collectionStore.set(keys)`) |
| **Store** | `personalThumbnailCollection` |
| **Mutation** | `previousCount: 0` → `newCount: 20` |
| **Timestamp** | `2026-07-12T17:16:04.541Z` (canonical trace) |

```816:828:frontend/src/viewer/viewerContext.js
function reloadVaultStoresFromStorage() {
const thumbs = readThumbnailVault(CONFIG.THUMBNAIL_STORAGE_KEY);
// ...
if (thumbs.length > 0) {
const nonHeroThumbs = filterNonHeroAssets(thumbs);
writeThumbnailVault(nonHeroThumbs, CONFIG.THUMBNAIL_STORAGE_KEY);
syncCollectionStore(personalThumbnailCollection, CONFIG.THUMBNAIL_STORAGE_KEY);
```

**Why this is incorrect:** `readThumbnailVault` returns **stale `personal_thumbnails` ghosts** that no longer exist in the backend catalog. `reloadVaultStoresFromStorage` unconditionally republishes them to the derived collection store, producing the heading **"Your Thumbnails (20)"** before any reconcile can run.

---

### Upstream failure (first storage writer, same boot)

| Field | Value |
|-------|-------|
| **Function** | `ingestThumbReelsToVault` → `safeStorageSet` |
| **File** | `frontend/src/lib/mediaBootstrap.js` |
| **Line** | **270** (`safeStorageSet(thumbnailKey, …)`) |
| **Store** | `personal_thumbnails` |
| **Mutation** | `previousCount: 1` → `newCount: 20` |
| **Timestamp** | `2026-07-12T17:16:04.502Z` (39ms before collection write) |
| **Stack** | `hydrateVaultFromReels:175` → `bootstrapMediaFromBackend:93` → `mountViewer:1556` |

```166:184:frontend/src/lib/mediaBootstrap.js
        if (!videosOnly) {
            const local = readVaultJson(thumbnailKey);
            // ...
            if (local.length > 0) {
                thumbnailCount = ingestThumbReelsToVault(reels, thumbnailKey);
```

```269:272:frontend/src/lib/mediaBootstrap.js
    safeStorageSet(thumbnailKey, dedupeThumbEntries(entries));
    traceThumbStoreWrite('ingestThumbReelsToVault', thumbnailKey, existing, entries);
    return entries.length;
```

**Why this is incorrect:** `ingestThumbReelsToVault` writes `personal_thumbnails` via `safeStorageSet`, **bypassing** `thumbnailVault.js` ownership. When `local.length > 0` it re-affirms ghost entries even when the intercepted backend returns **0 thumb reels**.

---

## Causal chain (minimal)

```
localStorage personal_thumbnails (20 ghosts, survives hard refresh)
    ↓
bootstrapMediaFromBackend → hydrateVaultFromReels (local.length > 0)
    ↓
ingestThumbReelsToVault → safeStorageSet          [FIRST storage 20-count write, line 270]
    ↓
mountViewer → reloadVaultStoresFromStorage
    ↓
syncCollectionStore                               [FIRST UI 20-count write, line 828]
    ↓
VaultExperience heading: "Your Thumbnails (20)"
```

---

## Why ghosts can persist after full startup (user live case)

Trace shows `reconcileStaleThumbnailsOnStartup` **can** purge to 0 when `backendReachable === true` (events at 17:16:04.644Z). User still seeing 20 implies one of:

1. **Reconcile skipped** — `backendReachable === false` in `syncFromVault` (offline branch preserves local vault)
2. **Reconcile noop for entry shape** — `canonicalizeThumbnailEntries` strips `orphaned` from id-bearing entries (thumbnailCanonicalization.js:217–221) then ghost purge depends on id/backendId set membership
3. **Empty-backend clear not triggered** — `writeThumbnailVault([])` only runs when `rawData.length === 0` (all reels), not when only thumb count is 0 (viewerContext.js:1064)

The **first** writer is unchanged in all cases: `reloadVaultStoresFromStorage` / `ingestThumbReelsToVault`.

---

## Evidence

- `[THUMB_STORE_WRITE]` console logs
- `window.__thumbWriteChain` / `sessionStorage.__thumbWriteChain`
- `frontend/mission-5.8.7-trace-canonical.json`

---

## Fix gate

**Do not implement repair until product owner confirms** the first writer above matches their live `window.__thumbWriteChain` after hard refresh. Re-run:

```bash
cd frontend && node scripts/mission-5.8.7-trace.mjs
```

Compare first `newCount: 20` event stack to this document.
