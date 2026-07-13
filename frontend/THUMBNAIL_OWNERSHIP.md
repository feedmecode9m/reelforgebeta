# Thumbnail Vault Ownership Model (Mission 5.8)

Generated: 2026-07-12

## Single owner

**Module:** `frontend/src/lib/viewer/thumbnailVault.js`

Owns all reads/writes of `personal_thumbnails`, index mirror updates, collection derivation, reconciliation, and delete tombstones.

## Transition ownership table

| Transition | Owner (logic) | Mutator | Persists | Renders | Removes |
|------------|---------------|---------|----------|---------|---------|
| Upload pending | `VaultExperience` | `pendingThumbnail` store | No | Pending panel | User reject |
| Accept upload | `thumbnailVault.appendThumbnailVaultEntry` | `writeThumbnailVault` | `personal_thumbnails` + index mirror | `syncCollectionStore` → `#each` | — |
| Startup load | `viewerContext.reloadVaultStoresFromStorage` | `readThumbnailVault` / `writeThumbnailVault` | Reads LS | `syncCollectionStore` | Clears if empty |
| Backend sync | `viewerContext.syncFromVault` | `ingestThumbReelsToVault` (metadata refresh only) | Updates existing entries | `reloadVaultStoresFromStorage` | Empty backend clears vault |
| Canonicalize | `thumbnailVault.reconcileThumbnailVault` | `canonicalizeThumbnailEntries` | `writeThumbnailVault` | `syncCollectionStore` | Purges stale/ghost |
| Orphan retain (startup) | `reconcileThumbnailVault` (`purgeMarkedOrphans: false`) | `writeThumbnailVault` | `orphaned: true` entries | Disabled checkbox | — |
| Orphan purge (post-delete) | `purgeStaleOrphanThumbnails` (`purgeMarkedOrphans: true`) | `reconcileThumbnailVault` | `writeThumbnailVault` | `syncCollectionStore` | Removes orphans |
| Select card | `VaultExperience` | `selectedThumbnailIds` (local) | Never | Checkbox UI | Deselect |
| Delete selected | `VaultExperience.batchDeleteSelectedThumbnails` | `deleteThumbnailVaultEntries` | Tombstone + reconcile | `syncCollectionStore` | API + local |
| Delete all | `VaultExperience.batchDeleteThumbnails` | Same | Same | Same | Same |
| Single delete | `aiCleanupAgent.handleThumbnailRemove` | `removeThumbnailVaultByIndex` | `writeThumbnailVault` | `syncCollectionStore` | Backend + local |
| Feed mirror | `aiCleanupAgent.syncThumbnailsToFeed` | `feed` store | `feed` LS key | Feed UI | **Not render authority** |

## Storage locations

| Location | Owner | Lifetime | Canonical? | May create? | May delete? |
|----------|-------|----------|------------|-------------|-------------|
| `personal_thumbnails` (localStorage) | `thumbnailVault.js` | Persistent | **YES — sole source of truth** | `appendThumbnailVaultEntry`, `writeThumbnailVault` | `deleteThumbnailVaultEntries`, reconcile purge |
| `personal_thumbnail_index` (localStorage) | `thumbnailVault.js` (mirror) | Persistent | No — derived | Only via `writeThumbnailVault` | Only via `writeThumbnailVault` |
| `personalThumbnailCollection` (Svelte store) | `thumbnailVault.syncCollectionStore` | Session | No — derived | Never direct `.set` except empty-backend clear | Never direct `.update` for deletes |
| Backend Postgres `/api/reels` | Rust backend | Persistent | Authority for reel existence | Upload API | DELETE `/api/reels/{id}` |
| Disk `/thumbs/{fileName}` | Rust ingestion | Persistent | Authority for file bytes | Upload API | DELETE storage API |
| `feed` (localStorage) | `viewerContext` / `aiCleanupAgent` | Persistent | No | Placeholder reels for display | Filter on delete |
| `pendingThumbnail` | `VaultExperience` | Session | No | File picker | Accept/reject |
| `selectedThumbnailIds` | `VaultExperience` | Session | No | User selection | Clear after delete |
| Blob/data upload cache | Browser memory | Transient | No | FileReader | GC / accept |
| `ingestThumbReelsToVault` | `mediaBootstrap.js` | Sync event | No — enricher only | **No** (existing entries only) | No |
| `hydrateVaultFromReels` | `mediaBootstrap.js` | Bootstrap | No | **No** (empty-local bootstrap removed) | No |

## Pre-5.8 violations (resolved)

| Violation | Detail | Fix |
|-----------|--------|-----|
| Dual authority | `createPersistentStore(THUMBNAIL_INDEX_KEY)` vs `personal_thumbnails` | Collection is `writable([])`; derived only |
| Index recreates metadata | `reloadVaultStoresFromStorage` built objects from index keys | Removed; keys derived from metadata |
| Multiple creators | VaultExperience, viewerContext, scripts each wrote LS | All writes route through `thumbnailVault.js` |
| Multiple delete paths | Tombstone, purge, aiCleanupAgent direct filter | `deleteThumbnailVaultEntries` + `removeThumbnailVaultByIndex` |
| Ghost 404 retained | Tombstone required successful `deletedIds` | `failedIds`/`ghostIds` + `purgeGhostCanonical` |
| Placeholder persistence | Index keys without metadata rendered blank cards | Orphan/stale purge on reconcile |
| Derived store writes back | `createPersistentStore` auto-persisted index | Index mirror written atomically with metadata |
| Stale snapshot re-write | `ensureThumbnailCanonicalization` wrote captured snapshot after reconcile | Pre-write removed |
| Phantom catalog import | `hydrateVaultFromReels` bootstrapped empty local from full backend | Bootstrap-empty-local removed |
| Legacy string dropped | `dedupeThumbEntries` filtered strings (empty key) | String entries preserved |
| Orphan over-purge | All `orphaned` entries purged on startup | `purgeMarkedOrphans` flag; startup keeps, post-delete purges |

## Create paths (Phase 4 — frontend audit)

| File | Function | Line | Entry shape | Id assigned? | Placeholder? | Persisted? |
|------|----------|------|-------------|--------------|--------------|------------|
| `VaultExperience.svelte` | `acceptPendingThumbnail` | ~1055 | `{ id, fileName, url, vaultState }` | Yes (API) | No | `appendThumbnailVaultEntry` |
| `VaultExperience.svelte` | `handleVaultThumbnailDrop` | ~761 | blob preview | No | Yes | No (`pendingThumbnail` only) |
| `thumbnailVault.js` | `appendThumbnailVaultEntry` | ~208 | metadata object | If in entry | No | Yes |
| `thumbnailVault.js` | `writeThumbnailVault` | ~70 | metadata array | Normalized | No | Yes + index mirror |
| `thumbnailVault.js` | `canonicalizeThumbnailEntries` (via reconcile) | — | upgrades id-less | From backend match | No | Via reconcile write |
| `mediaBootstrap.js` | `ingestThumbReelsToVault` | ~226 | updates existing + legacy strings | Refreshes id | No | Yes (no new rows) |
| `viewerContext.js` | `reloadVaultStoresFromStorage` | ~801 | reads existing | No create | No | Rewrites mirror only |
| `aiCleanupAgent.js` | `syncThumbnailsToFeed` | ~303 | feed placeholder reel | Synthetic feed id | Yes (feed only) | Feed key only |

## Delete paths (Phase 5 — frontend audit)

| File | Function | Line | Mechanism | Persisted? |
|------|----------|------|-----------|------------|
| `VaultExperience.svelte` | `batchDeleteSelectedThumbnails` | ~471 | API + `deleteThumbnailVaultEntries` + ghostIds | Yes |
| `VaultExperience.svelte` | `batchDeleteThumbnails` | ~1126 | Delete all + reconcile | Yes |
| `VaultExperience.svelte` | `applyThumbnailDeleteTombstone` | ~317 | `deleteThumbnailVaultEntries` | Yes |
| `VaultExperience.svelte` | `purgeStaleOrphanThumbnails` | ~294 | `reconcileThumbnailVault(purgeMarkedOrphans)` | Yes |
| `aiCleanupAgent.js` | `handleThumbnailRemove` | ~370 | `removeThumbnailVaultByIndex` | Yes |
| `viewerContext.js` | `syncFromVault` (empty backend) | ~1059 | `writeThumbnailVault([])` | Yes |
| `viewerContext.js` | `reconcileStaleThumbnailsOnStartup` | ~870 | `reconcileThumbnailVault` | Yes |
| `thumbnailVault.js` | `deleteThumbnailVaultEntries` | ~168 | Tombstone + reconcile | Yes |
| `thumbnailVault.js` | `reconcileThumbnailVault` | ~116 | Purge stale/ghost/orphan | Yes |

## Read-only consumers (must not mutate vault)

- `vaultUtils.js` — `findStoredThumbnailEntry`, `getVaultImageReel`
- `VaultExperience` render loop — reads `$personalThumbnailCollection`
- `aiCleanupAgent.syncThumbnailsToFeed` — reads metadata, writes feed only
