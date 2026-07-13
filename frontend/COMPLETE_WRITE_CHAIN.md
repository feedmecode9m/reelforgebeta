# Mission 5.8.7 — Complete Write Chain

**Investigation date:** 2026-07-12  
**Method:** Live Playwright boot trace with `[THUMB_STORE_WRITE]` instrumentation  
**Scenario:** Backend intercepted to **0 thumb reels**; `localStorage` pre-seeded with **20 ghost** `personal_thumbnails` entries  
**Trace artifact:** `mission-5.8.7-trace-canonical.json` (65 events)

Runtime browser behavior is source of truth. Do not trust prior validation reports.

---

## Startup Order (live path)

```
Viewer.svelte onMount
  → mountViewer() [viewerContext.js]
      → prepareStorageOnStartup()
      → bootstrapMediaFromBackend()
          → hydrateVaultFromReels()
              → ingestThumbReelsToVault()   ← FIRST personal_thumbnails reaffirm
      → reloadVaultStoresFromStorage()      ← FIRST personalThumbnailCollection 0→20
      → AI_CLEANUP_AGENT.syncThumbnailsToFeed() [+100ms timer]
      → syncFromVault()
          → ingestThumbReelsToVault()       [again]
          → reloadVaultStoresFromStorage()  [again]
          → reconcileStaleThumbnailsOnStartup()
              → reconcileThumbnailVault()   [may purge ghosts if backend reachable]
          → feed.set / storageSet(reelforge_feed)
      → AI_CLEANUP_AGENT.init()
VaultExperience.svelte onMount
  → ensureThumbnailCanonicalization()
      → reconcileThumbnailVault()
      → syncCollectionStore()
```

---

## Chronological Mutations (canonical ghost trace)

| # | Timestamp (UTC) | Function | Store | prev→new | Stack anchor |
|---|-----------------|----------|-------|----------|--------------|
| 1 | 17:16:04.204Z | `safeStorageSet` | `reelforge_feed` | 1→1 | `feed.subscribe` → `storageSet` (viewerContext.js:311) |
| 2 | **17:16:04.502Z** | **`safeStorageSet`** | **`personal_thumbnails`** | **1→20** | **`ingestThumbReelsToVault` mediaBootstrap.js:270** |
| 3 | 17:16:04.502Z | `ingestThumbReelsToVault` | `personal_thumbnails` | 20→20 | mediaBootstrap.js:271 |
| 4 | 17:16:04.539Z | `storeThumbnailMetadata` | `personal_thumbnails` | 20→20 | `writeThumbnailVault` ← `reloadVaultStoresFromStorage` |
| 5 | 17:16:04.539Z | `safeStorageSet` | `personal_thumbnails` | 1→20 | via `storeThumbnailMetadata` |
| 6 | 17:16:04.541Z | `writeThumbnailVault:indexMirror` | `personal_thumbnail_index` | 20→20 | thumbnailVault.js:96 |
| 7 | 17:16:04.541Z | `writeThumbnailVault` | `personal_thumbnails` | 20→20 | thumbnailVault.js:103 |
| 8 | **17:16:04.541Z** | **`syncCollectionStore`** | **`personalThumbnailCollection`** | **0→20** | **reloadVaultStoresFromStorage viewerContext.js:828** |
| 9 | 17:16:04.636Z | `safeStorageSet` | `personal_thumbnails` | 1→20 | `ingestThumbReelsToVault` inside `syncFromVault` |
| 10 | 17:16:04.639Z | `writeThumbnailVault` | `personal_thumbnails` | 20→20 | `reloadVaultStoresFromStorage` inside `syncFromVault` |
| 11 | 17:16:04.640Z | `syncCollectionStore` | `personalThumbnailCollection` | 20→20 | `reloadVaultStoresFromStorage` inside `syncFromVault` |
| 12 | 17:16:04.644Z | `storeThumbnailMetadata` | `personal_thumbnails` | 20→0 | `reconcileThumbnailVault` (startup purge) |
| 13 | 17:16:04.645Z | `safeStorageSet` | `personal_thumbnails` | 1→0 | reconcile purge |
| 14 | 17:16:04.648Z | `syncCollectionStore` | `personalThumbnailCollection` | 20→0 | `reconcileStaleThumbnailsOnStartup` |

**Note:** Events 12–14 occur only when `backendReachable === true` and ghost canonical purge runs. If reconcile is skipped (offline) or entries are not purgeable, events 8–11 remain the terminal state and **"Your Thumbnails (20)"** persists.

---

## First 3 ghost entries at first 20-count write

```json
[
  { "id": "ghost-01-…", "fileName": "mission-587-ghost-1.png", "url": "/thumbs/mission-587-ghost-1.png", "orphaned": null, "placeholder": null },
  { "id": "ghost-02-…", "fileName": "mission-587-ghost-2.png", "url": "/thumbs/mission-587-ghost-2.png", "orphaned": null, "placeholder": null },
  { "id": "ghost-03-…", "fileName": "mission-587-ghost-3.png", "url": "/thumbs/mission-587-ghost-3.png", "orphaned": null, "placeholder": null }
]
```

All entries are **placeholder-class** vault cards (no resolvable backend reel; `isPlaceholder` set later by `syncThumbnailsToFeed`).

---

## Writer inventory (instrumented)

| Writer | File | Stores touched |
|--------|------|----------------|
| `safeStorageSet` | storage.js:313 | `personal_thumbnails`, `personal_thumbnail_index`, `reelforge_feed` |
| `storeThumbnailMetadata` | storage.js:165 | `personal_thumbnails` |
| `writeThumbnailVault` | thumbnailVault.js:72–104 | `personal_thumbnails`, `personal_thumbnail_index` |
| `syncCollectionStore` | thumbnailVault.js:111–117 | `personalThumbnailCollection` |
| `reconcileThumbnailVault` | thumbnailVault.js:125–195 | `personal_thumbnails` (purge path) |
| `ingestThumbReelsToVault` | mediaBootstrap.js:224–272 | `personal_thumbnails` (**bypasses owner**) |
| `hydrateVaultFromReels` | mediaBootstrap.js:120–207 | triggers ingest when `local.length > 0` |
| `reloadVaultStoresFromStorage` | viewerContext.js:806–855 | `personal_thumbnails`, `personalThumbnailCollection` |
| `syncFromVault` | viewerContext.js:905+ | all vault stores + `reelforge_feed` |
| `reconcileStaleThumbnailsOnStartup` | viewerContext.js:875–904 | via `reconcileThumbnailVault` |
| `setPersonalThumbnailCollection` | viewerContext.js:317–321 | `personalThumbnailCollection` (clear path) |
| `syncThumbnailsToFeed` | aiCleanupAgent.js:303–368 | `reelforge_feed` placeholders |
| `feed.subscribe` | viewerContext.js:300–302 | `reelforge_feed` |
| `createPersistentStore:persistValue` | viewerContext.js:239–252 | any persistent key (thumb keys logged) |
| `ensureThumbnailCanonicalization` | VaultExperience.svelte:184–245 | reconcile + `syncCollectionStore` |

---

## reelforge_feed path (secondary)

After collection reaches 20, `onMount` schedules:

```
AI_CLEANUP_AGENT.syncThumbnailsToFeed()  [viewerContext.js:1639, +100ms]
```

This reads `personal_thumbnails` and inserts `isPlaceholder: true, isPersonalThumbnail: true` reels into `reelforge_feed`. It does **not** drive the vault heading count (`$personalThumbnailCollection.length`), but does recreate placeholder feed cards.

---

## Reproduction command

```bash
cd frontend
node scripts/mission-5.8.7-trace.mjs
# Inspect: mission-5.8.7-trace.json → writeChain
# Browser console: window.__thumbWriteChain
```

---

## Stop condition

First incorrect mutation that restores 20 entries is **proven** at event #2 (storage) and event #8 (collection/UI). No fix applied per mission rules.
