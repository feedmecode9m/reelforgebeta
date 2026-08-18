# VAULT-HYDRATION-01 REPORT

- **Timestamp:** 2026-07-24T03:15:26.665Z
- **Mission:** VAULT-HYDRATION-01
- **Result:** PASS

## BUG 1 — Refresh hydration

### Root cause

`upgradeThumbnailVaultFromBackendReels()` returned `0` immediately when `personal_thumbnails` was empty (`thumbnailVault.js`). It only upgraded existing local rows. Execution chain:

```
reloadVaultStoresFromStorage()
  → read personal_thumbnails ([])
syncFromVault()
  → upgradeThumbnailVaultFromBackendReels() → return 0
  → reloadVaultStoresFromStorage() → clear collection
```

Backend catalog still contained the accepted thumb reel, but no code path inserted it into the personal vault after metadata loss.

### Fix

1. Durable membership list: `personal_thumbnail_reel_ids` (updated on accept/delete).
2. `hydrateEmptyThumbnailVaultFromBackendReels()` inserts backend rows whose `reel.id` is in that set only (no full-catalog phantom import).
3. `mediaBootstrap.hydrateVaultFromReels` always calls upgrade (hydrates when empty + ids present).
4. `reloadVaultStoresFromStorage` no longer re-writes empty `personal_thumbnails` when already empty.

| Check | Result |
|-------|--------|
| Hydration algorithm (empty metadata + id set) | PASS |
| Non-member backend thumb excluded | PASS |
| Source: hydrate function present | PASS |
| Source: reel-id membership key | PASS |

## BUG 2 — Delete storage lifecycle

### Trace

```
DELETE /api/reels/:id
  → handlers::delete_reel
  → db::reels::delete_reel (catalog row removed)
  → disk: thumbs_path + file_name / thumbnail_url basename
  → CDN: Netlify /thumbs/* → Railway serve_thumb
```

**Expected lifecycle:** Option **A** — physical thumb object should be removed. Thumbnail-only reels are written to `thumbs_path` at ingest (`ingest_image_only`).

**Defect found:** For image-only reels, `file_name` is a thumb basename but delete logic first attempted video-path + R2 video-key deletion. Thumb removal depended on `thumbnail_url` alone.

**Fix:** Dedicated `image_only` branch in `delete_reel` deletes from `thumbs_path` using `file_name` (canonical for image-only uploads).

**Production caveat:** Netlify edge may serve cached 200 on `/thumbs/*` briefly after origin delete. This is CDN caching, not orphaned-by-design storage policy. Backend deploy required for handler fix to reach production.

| Check | Result |
|-------|--------|
| Backend image-only delete branch | PASS (code) |

## BUG 3 — Identity audit

| Risk | Status |
|------|--------|
| `handleThumbnailRemove` basename-first API lookup | **Fixed** — resolves `reel.id` from metadata; basename fallback only when id missing |
| Batch delete | Already `reel.id` only |
| Dedupe in vault | **Fixed** — prefers `reel.id` |
| Collection render keys (fileName) | Display-only; canonical ops use `reel.id` |
| `removeThumbnailVaultByIndex` | Retained for legacy id-less rows only |

| Check | Result |
|-------|--------|
| aiCleanupAgent id-first delete | PASS |
| deleteThumbnailVaultEntries on single delete | PASS |
| Dedupe prefers id | PASS |

## Files changed

- `frontend/src/lib/viewer/thumbnailVault.js`
- `frontend/src/lib/viewer/aiCleanupAgent.js`
- `frontend/src/lib/mediaBootstrap.js`
- `frontend/src/viewer/viewerContext.js`
- `backend/src/handlers.rs`

## After execution graph (refresh)

```
appendThumbnailVaultEntry
  → personal_thumbnails + personal_thumbnail_reel_ids
hard reload
  → syncFromVault / bootstrap
  → upgradeThumbnailVaultFromBackendReels
  → hydrateEmptyThumbnailVaultFromBackendReels (ids ∩ backend)
  → writeThumbnailVault
  → reloadVaultStoresFromStorage
  → syncCollectionStore
```

## After execution graph (delete)

```
handleThumbnailRemove(index)
  → resolve entry.id from personal_thumbnails
  → DELETE /api/reels/:id
  → deleteThumbnailVaultEntries([id])
  → removePersonalThumbnailReelIds([id])
hard reload
  → no resurrection (id absent from membership + catalog)
```

## Unit verification

```json
{
  "unit": {
    "refreshPass": true,
    "deletePass": true,
    "restored": [
      {
        "id": "11111111-1111-4111-8111-111111111111",
        "fileName": "11111111-1111-4111-8111-111111111111.jpg",
        "url": "/thumbs/11111111-1111-4111-8111-111111111111.jpg",
        "name": "Test"
      }
    ]
  },
  "source": {
    "hasHydrateEmpty": true,
    "hasReelIdsKey": true,
    "hasEarlyReturnRemoved": true,
    "dedupeUsesId": true
  },
  "cleanup": {
    "deleteByReelIdFirst": true,
    "usesDeleteThumbnailVaultEntries": true
  },
  "backend": {
    "imageOnlyDelete": true
  }
}
```

## VAULT-HYDRATION-01: PASS
