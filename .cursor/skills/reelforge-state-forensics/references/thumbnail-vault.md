# Thumbnail Vault Reference

## Key Files

| File | Role |
|------|------|
| `frontend/src/lib/viewer/thumbnailVault.js` | Single owner — read/write/reconcile/delete |
| `frontend/src/lib/viewer/thumbnailCanonicalization.js` | Classify, canonicalize, legacy string normalize |
| `frontend/src/lib/viewer/thumbnailInvariants.js` | Runtime assertions |
| `frontend/src/lib/viewer/vaultUtils.js` | `getVaultImageReel` (read-only render) |
| `frontend/src/viewer/viewerContext.js` | `syncFromVault`, `reloadVaultStoresFromStorage` |
| `frontend/src/components/experiences/VaultExperience.svelte` | Upload, delete, startup reconcile UI |
| `frontend/src/lib/mediaBootstrap.js` | `ingestThumbReelsToVault` (existing entries only) |

## Storage Matrix

| Location | Canonical? | May create? | May delete? |
|----------|------------|-------------|-------------|
| `personal_thumbnails` | **YES** | `appendThumbnailVaultEntry`, `writeThumbnailVault` | `deleteThumbnailVaultEntries`, reconcile |
| `personal_thumbnail_index` | No (mirror) | `writeThumbnailVault` only | `writeThumbnailVault` only |
| `personalThumbnailCollection` | No (derived) | Never (except empty-backend clear) | Never direct |
| Backend `/api/reels` | Authority for existence | Upload API | `DELETE /api/reels/{id}` |
| `feed` | No | Placeholders only | Filter on delete |

## Create Paths

| Function | File | Persisted? |
|----------|------|------------|
| `acceptPendingThumbnail` | VaultExperience.svelte | `appendThumbnailVaultEntry` |
| `appendThumbnailVaultEntry` | thumbnailVault.js | Yes |
| `writeThumbnailVault` | thumbnailVault.js | Yes + index mirror |
| `canonicalizeThumbnailEntries` | thumbnailCanonicalization.js | Via reconcile |
| `ingestThumbReelsToVault` | mediaBootstrap.js | Updates existing only — **no new rows** |
| `syncThumbnailsToFeed` | aiCleanupAgent.js | Feed only — **not vault** |

## Delete Paths

| Function | File |
|----------|------|
| `batchDeleteSelectedThumbnails` | VaultExperience.svelte |
| `batchDeleteThumbnails` | VaultExperience.svelte |
| `applyThumbnailDeleteTombstone` | VaultExperience.svelte |
| `purgeStaleOrphanThumbnails` | VaultExperience.svelte |
| `handleThumbnailRemove` | aiCleanupAgent.js |
| `deleteThumbnailVaultEntries` | thumbnailVault.js |
| `reconcileThumbnailVault` | thumbnailVault.js |
| `syncFromVault` (empty backend) | viewerContext.js → `writeThumbnailVault([])` |

## Invariant IDs

- `HAS_STATE` — every entry has `vaultState`
- `CANONICAL_HAS_ID` — canonical implies non-empty `id`
- `NO_GHOST_CANONICAL` — id must exist on backend when reachable
- `BACKEND_EMPTY_CANONICAL` — backend 0 → no ghost canonicals
- `ORPHAN_NO_ID` — `orphaned: true` must not have synthetic `id`
- `DELETE_MUST_REDUCE` — successful delete reduces collection count
- `NO_DUPLICATE_KEYS` — no duplicate `thumbnailEntryFileKey`
