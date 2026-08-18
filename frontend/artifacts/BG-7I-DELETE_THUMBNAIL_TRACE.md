# BG-7I-A — MP4 Delete Thumbnail Ghost Trace

**Mode:** Investigation only  
**Generated:** 2026-07-24

---

## Delete Flow

### Entry points (MP4 / video reel)

| # | UI surface | File | Function | Mechanism |
|---|------------|------|----------|-----------|
| 1 | Video vault — single delete | `frontend/src/lib/viewer/aiCleanupAgent.js` | `deleteVaultVideo(videoId)` (~573) | Confirm → DELETE API → client purge → `syncFromVault(true)` |
| 2 | Video vault — batch selected | `frontend/src/components/experiences/VaultExperience.svelte` | `batchDeleteSelectedVideos()` (~693–702) | Loop `deleteReelById` → `applyVideoDeleteTombstone` → `syncFromVault(true, true)` |
| 3 | Studio feed / productions | `frontend/src/lib/viewer/contentAgents.js` | `ProductionAgent.deleteReel(reelId)` (~171) | Modal confirm → `deleteReelById` → `applyCanonicalDeleteClientEffects` |
| 4 | API primitive | `frontend/src/lib/api/media.js` | `deleteReelById(reelId, headers)` (~610) | `DELETE ${API_BASE_URL}/api/reels/{id}` |

### Step-by-step (primary path — vault single delete)

```
DELETE button (video vault card)
  ↓
AI_CLEANUP_AGENT.deleteVaultVideo(videoId)          [aiCleanupAgent.js:573]
  ↓ confirm()
  ↓ deleteReelById(videoId, authHeaders)            [media.js:610]
      DELETE /api/reels/{uuid}
  ↓ applyCanonicalDeleteClientEffects({ purge: runClientMediaPurge }, { reelId, filename, videoUrl })
      [deletionSync.js:86]
  ↓ runClientMediaPurge → purgeMediaFromClientState  [viewerContext.js:785, deletionSync.js:224]
      Updates: reelforge_feed, personal_video_vault, activeReel/theater
  ↓ syncFromVault(true)                              [viewerContext.js:636]
      GET /api/reels → upgradeThumbnailVaultFromBackendReels → reconcileStaleThumbnailsOnStartup
  ↓ uploadStatus.set('✅ Video deleted')
  ✗ NO deleteThumbnailVaultEntries()
  ✗ NO purgeStaleOrphanThumbnails()
```

### Thumbnail delete path (reference — works)

```
deleteVaultThumbnail / batchDeleteSelectedThumbnails   [aiCleanupAgent.js:525–529, VaultExperience.svelte:602–614]
  ↓ deleteReelById(reelId)
  ↓ applyCanonicalDeleteClientEffects(...)
  ↓ deleteThumbnailVaultEntries(deletedIds, imageReels, { storageKey: THUMBNAIL_STORAGE_KEY })
  ↓ purgeStaleOrphanThumbnails(deletedIds, imageReelsAfter)   [thumbnail batch only]
  ↓ syncCollectionStore(personalThumbnailCollection, ...)
```

---

## Identifiers used

| Stage | Primary identifier | Secondary |
|-------|-------------------|-----------|
| API `DELETE /api/reels/{id}` | **`reelId` (UUID)** | — |
| Backend disk/R2 | **`fileName` / storage key** | `video_url`, `thumbnail_url` on reel row |
| Client purge (`purgeMediaFromClientState`) | **`reelId`**, **`filename`**, **`videoUrl`** | `reelMatchesDeletedMedia()` in `deletionSync.js:199` |
| Thumbnail vault entry | **`id`** (when set), **`fileName`**, **`url`** (`/thumbs/...`) | Legacy string keys |
| Storage keys | `CONFIG.THUMBNAIL_STORAGE_KEY` → `'personal_thumbnails'` | `CONFIG.VIDEO_VAULT_KEY` → `'personal_video_vault'` |

**Backend:** `handlers.rs` `delete_reel` removes video file and thumb file from reel's `thumbnail_url` field, then DB row.

---

## State Mutation Flow

### Stores touched by video delete

| Store key | Updated on video delete? | How |
|-----------|--------------------------|-----|
| **`personal_video_vault`** | ✅ Yes | `purgeMediaFromClientState` → `personalVideos.update` + `persistPersonalVault` |
| **`reelforge_feed`** | ✅ Yes | Feed filter + `persistFeed` |
| **`reelforge_deleted_media_ids`** | ✅ Yes | `recordDeletedMediaIds(reelId)` |
| **`reel_vault`** (`CONFIG.VAULT_KEY`) | ⚠️ Indirect | Offline `syncFromVault` fallback only; not primary purge target |
| **`personal_thumbnails`** | ❌ **Not directly** | Video path skips `deleteThumbnailVaultEntries` |
| **`personal_thumbnail_index`** | ❌ **Not directly** | Mirror; only updated via `writeThumbnailVault` |
| **`personalThumbnailCollection`** (runtime) | ⚠️ Partial | May update only if `reconcileStaleThumbnailsOnStartup` purges ghosts |

### `applyVideoDeleteTombstone` (batch video)

`VaultExperience.svelte:337–343`:

```javascript
applyCanonicalDeleteClientEffects({ ctx: buildDeletePurgeCtx() }, { reelIds: deletedIds });
```

`buildDeletePurgeCtx()` (~330–334) wires `feed` + `personalVideos` only — **no thumbnail storage**.

### `runClientMediaPurge` scope

`deletionSync.js:224–265` — explicitly limits to:

- `feed`
- `personalVideos` / `personal_video_vault`
- `activeReel` / theater

**Does not read or write `personal_thumbnails`.**

### Post-delete sync reconciliation

`syncFromVault` after delete runs:

1. `upgradeThumbnailVaultFromBackendReels(rawData, THUMBNAIL_STORAGE_KEY)` — upgrades existing entries from **image** thumb reels only (`isBackendThumbReel`).
2. `reconcileStaleThumbnailsOnStartup(rawData, true)` — may purge entries classified `stale` / ghost when `id` ∉ backend **image** reel ids.

**Gap:** Video delete does not pass `deletedIds` into `purgeStaleOrphanThumbnails(..., { purgeMarkedOrphans: true })`. Reconcile alone may leave:

- Id-less string entries (`deleteThumbnailVaultEntries` filter keeps `!id` rows).
- Entries classified `orphaned` when `purgeMarkedOrphans: false` (startup reconcile default).

---

## Remaining Reference

**Does the deleted MP4 remain referenced anywhere?**

| Location | Video reference | Thumbnail reference | After successful backend DELETE |
|----------|-----------------|---------------------|----------------------------------|
| `personal_video_vault` | Was `id`, `url`, embedded `thumbnail` | — | **Should be removed** by purge |
| `reelforge_feed` | Card `url`, `id` | `thumbnailUrl` on card | **Should be removed** if `reelMatchesDeletedMedia` matches |
| `personal_thumbnails` | May share **`id`** with video reel | **`url`**: `/thumbs/{uuid}.jpg`, **`fileName`** | **Often retained** — no explicit tombstone on video path |
| `personal_thumbnail_index` | Mirror of above | Same | **Often retained** |
| `reelforge_deleted_media_ids` | Tombstone **`reelId`** | — | **Added** (blocks resurrection) |
| `reel_vault` | Legacy | — | May retain until offline reconcile |
| Feed placeholder cards | — | `personal_thumbnail` / `isPlaceholder` | Separate thumbnail sync paths |

**Ghost symptom:** Video card gone from video vault; **thumbnail grid or feed shelf still shows image placeholder** sourced from `personal_thumbnails` / `personalThumbnailCollection` or feed `thumbnailUrl` pointing to deleted `/thumbs/{file}.jpg` (404 → fallback UI).

**Asymmetric proof (same codebase):**

| Operation | Calls `deleteThumbnailVaultEntries`? |
|-----------|--------------------------------------|
| Thumbnail delete (`aiCleanupAgent.js:526`) | ✅ Yes |
| Video delete (`aiCleanupAgent.js:618–636`) | ❌ No |
| Video batch delete (`VaultExperience.svelte:699–702`) | ❌ No |
| Thumbnail batch delete (`VaultExperience.svelte:614`) | ✅ via `purgeStaleOrphanThumbnails` |

---

## Root Cause Classification

**Stale frontend delete propagation** — video and thumbnail vaults use divergent cleanup paths. Backend delete is authoritative for disk; client leaves thumbnail vault entries unless async reconcile happens to classify them stale.

**First stale boundary:** Missing `deleteThumbnailVaultEntries([videoId], imageReels, …)` immediately after successful video `deleteReelById` (compare thumbnail handler at `aiCleanupAgent.js:525–529`).

---

## Smallest Fix Location

| Priority | File | Function | Change |
|----------|------|----------|--------|
| 1 | `frontend/src/lib/viewer/aiCleanupAgent.js` | `deleteVaultVideo` (~618–636) | After `applyCanonicalDeleteClientEffects`, call `deleteThumbnailVaultEntries([videoId], imageReels, { storageKey: CONFIG.THUMBNAIL_STORAGE_KEY })` and/or `purgeStaleOrphanThumbnails` |
| 2 | `frontend/src/components/experiences/VaultExperience.svelte` | `batchDeleteSelectedVideos` (~699–702) | After `applyVideoDeleteTombstone`, mirror thumbnail batch: `purgeStaleOrphanThumbnails(deletedIds, imageReelsAfter)` |
| 3 | `frontend/src/lib/deletionSync.js` | `purgeMediaFromClientState` (~224) | Optional: extend to purge matching thumb entries by `reelId` / `filename` (broader blast radius) |

**Recommended surgical patch:** **#1 + #2** — align video delete with existing thumbnail delete helpers; avoid widening generic purge until needed.

---

## Search index (grep targets)

| Pattern | Primary hits |
|---------|--------------|
| `deleteReelById` | `media.js`, `aiCleanupAgent.js`, `VaultExperience.svelte`, `contentAgents.js` |
| `deleteVaultVideo` | `aiCleanupAgent.js:573` |
| `applyVideoDeleteTombstone` | `VaultExperience.svelte:337` |
| `deleteThumbnailVaultEntries` | `thumbnailVault.js:425`, `aiCleanupAgent.js:526`, `VaultExperience.svelte:378` |
| `THUMBNAIL_STORAGE_KEY` / `personal_thumbnails` | `viewerContext.js:193`, `thumbnailVault.js:33` |
| `personal_video_vault` | `viewerContext.js` CONFIG, `deletionSync.js` purge |
| `reel_vault` | `CONFIG.VAULT_KEY` offline fallback in `syncFromVault` |
