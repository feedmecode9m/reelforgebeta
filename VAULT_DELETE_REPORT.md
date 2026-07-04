# VAULT DELETE REPORT (PHASE V-RESTORE-001)

Forensic scope: frontend delete lifecycle + backend API behavior that affects rehydration.
No code changes applied.

---

## [DELETE_PATH] DELETE THUMBNAIL (single item)

1. **Which function removes item**
- UI click path: `VaultExperience.svelte` -> `handleThumbnailRemove(index)` delegates to `AI_CLEANUP_AGENT.handleThumbnailRemove(index)`.
- Evidence:
  - `frontend/src/components/experiences/VaultExperience.svelte` (428-430)
  - `frontend/src/lib/viewer/aiCleanupAgent.js` (310-334)

2. **Which persistence layer is updated**
- `personalThumbnailCollection` Svelte store is updated:
  - `frontend/src/lib/viewer/aiCleanupAgent.js` (326)
- `personal_thumbnails` localStorage key is updated via `storageSet`:
  - `frontend/src/lib/viewer/aiCleanupAgent.js` (327-329)
- Feed placeholders are removed and feed persisted:
  - `frontend/src/lib/viewer/aiCleanupAgent.js` (330)
  - `frontend/src/lib/viewer/aiCleanupAgent.js` (264-268)

3. **Which persistence layer is NOT updated**
- Canonical backend reel catalog is not reliably updated for thumbnail deletes.
- Why:
  - Delete call uses `deleteMediaFile(thumbnailName, ...)` where `thumbnailName` comes from local thumb name:
    - `frontend/src/lib/viewer/aiCleanupAgent.js` (313, 322)
  - That call can fall through to `/api/media/storage/{filename}`:
    - `frontend/src/lib/api/media.js` (231-250)
  - `/api/media/storage/{filename}` deletes files only, not DB rows:
    - `backend/src/media_api.rs` (540-565)
  - DB row deletion exists only in `/api/storage/file/{filename}` path when `find_by_video_basename` matches:
    - `backend/src/handlers.rs` (350-399)
    - `backend/src/db/reels.rs` (176-193)
  - `find_by_video_basename` matches `video_url` only, which image-only reels typically do not have:
    - `backend/src/db/reels.rs` (186)

4. **Which later process re-inserts item**
- `syncFromVault()` fetches `GET /api/reels`, then re-ingests thumbnail reels into local thumbnail storage and stores:
  - `frontend/src/viewer/viewerContext.js` (814-820, 832-833)
  - `frontend/src/lib/mediaBootstrap.js` `ingestThumbReelsToVault(...)` (158-190)
  - `frontend/src/viewer/viewerContext.js` `reloadVaultStoresFromStorage()` (733-767)
- Net effect: if backend row remains, thumbnail reappears after refresh/sync/navigation.

5. **Exact source file**
- `frontend/src/components/experiences/VaultExperience.svelte`
- `frontend/src/lib/viewer/aiCleanupAgent.js`
- `frontend/src/lib/api/media.js`
- `frontend/src/viewer/viewerContext.js`
- `frontend/src/lib/mediaBootstrap.js`
- `backend/src/handlers.rs`
- `backend/src/media_api.rs`
- `backend/src/db/reels.rs`

6. **Exact line numbers**
- Frontend remove entrypoint: `VaultExperience.svelte` (428-430)
- Thumbnail delete core: `aiCleanupAgent.js` (310-334)
- API delete fallback behavior: `media.js` (231-250)
- Sync rehydrate: `viewerContext.js` (814-833, 733-767)
- Thumb ingest into local storage: `mediaBootstrap.js` (158-190)
- Backend DB delete path: `handlers.rs` (350-399)
- Backend file-only delete path: `media_api.rs` (540-565)
- Basename query constraint: `db/reels.rs` (176-193)

---

## [DELETE_PATH] DELETE VIDEO (single item)

1. **Which function removes item**
- UI click path in vault video card:
  - `VaultExperience.svelte` -> `AI_CLEANUP_AGENT.deleteVaultVideo(video.id)`
  - `frontend/src/components/experiences/VaultExperience.svelte` (709)
- Core delete:
  - `frontend/src/lib/viewer/aiCleanupAgent.js` (335-358)

2. **Which persistence layer is updated**
- Client feed + vault stores are purged through `runClientMediaPurge`:
  - `frontend/src/lib/viewer/aiCleanupAgent.js` (352)
  - `frontend/src/lib/deletionSync.js` (66-83)
- Vault localStorage is persisted by `persistPersonalVault` action in viewer context:
  - `frontend/src/viewer/viewerContext.js` (667, 190-192)

3. **Which persistence layer is NOT updated**
- Backend DB may remain unchanged when delete resolves via fallback `/api/media/storage/{filename}` (file-only delete), or when primary delete fails and is swallowed.
- Evidence:
  - Primary delete attempts `/api/storage/file/{filename}` first, fallback `/api/media/storage/{filename}`:
    - `frontend/src/lib/api/media.js` (233-250)
  - Fallback endpoint does not delete reel rows:
    - `backend/src/media_api.rs` (540-565)
  - Primary endpoint deletes DB row only if `find_by_video_basename` matches:
    - `backend/src/handlers.rs` (377-399)

4. **Which later process re-inserts item**
- After client purge, `deleteVaultVideo` explicitly calls `syncFromVault(true)`:
  - `frontend/src/lib/viewer/aiCleanupAgent.js` (355)
- `syncFromVault` reloads from `GET /api/reels` and rewrites `personalVideos` + local vault:
  - `frontend/src/viewer/viewerContext.js` (814-820, 912-929)
- If backend row survived delete, video is reinserted.

5. **Exact source file**
- `frontend/src/components/experiences/VaultExperience.svelte`
- `frontend/src/lib/viewer/aiCleanupAgent.js`
- `frontend/src/lib/deletionSync.js`
- `frontend/src/lib/api/media.js`
- `frontend/src/viewer/viewerContext.js`
- `backend/src/handlers.rs`
- `backend/src/media_api.rs`

6. **Exact line numbers**
- Vault click handler: `VaultExperience.svelte` (709)
- Video delete core: `aiCleanupAgent.js` (335-358)
- Client purge path: `deletionSync.js` (66-83)
- API delete fallback chain: `media.js` (233-250)
- Sync rehydrate of videos: `viewerContext.js` (814-820, 912-929)
- Backend DB delete path: `handlers.rs` (377-399)
- Backend file-only delete fallback: `media_api.rs` (540-565)

---

## [LOCALSTORAGE_STATE]

- Thumbnail delete updates local keys (`personal_thumbnails`, feed) correctly:
  - `aiCleanupAgent.js` (327-330, 264-268)
- Video delete updates local vault/feed correctly via purge + persist:
  - `deletionSync.js` (77-83)
  - `viewerContext.js` (190-192, 667)
- But localStorage is not source of truth: `syncFromVault` overwrites from backend catalog on each sync:
  - `viewerContext.js` (814-833, 912-929)

---

## [API_STATE]

- Canonical data source for vault hydration is `GET /api/reels`:
  - `viewerContext.js` (814-820)
- Delete API split is asymmetric:
  - `/api/storage/file/{filename}` can delete DB row + publish WS DELETED:
    - `handlers.rs` (350-407)
  - `/api/media/storage/{filename}` deletes files only, no DB row delete:
    - `media_api.rs` (540-565)

---

## [SYNC_STATE]

- `syncFromVault()` is the restore engine when backend still has the reel:
  - Pulls `/api/reels`, ingests thumbs, reloads vault stores, rebuilds feed:
    - `viewerContext.js` (814-833, 835-894, 912-929)
- WS CREATED also triggers sync and can rehydrate stale backend entries:
  - `viewerContext.js` (1417-1429)

---

## [RESTORE_SOURCE]

Primary restore source: **backend reel catalog (`GET /api/reels`)**, re-applied by `syncFromVault()`.

Why items reappear:
- client delete mutates UI/local storage,
- backend row is not always deleted (especially thumbnail path via `/api/media/storage` fallback or name mismatch),
- next `syncFromVault()` rehydrates from backend and re-inserts.

---

## Special Check Matrix (A-E)

- **A. Delete only removes from UI store** -> **Partially true** (UI/local store are removed first).
- **B. localStorage still contains item** -> **Often false initially** (local is usually updated), but later restored by sync.
- **C. backend still contains item** -> **True in failing cases** (critical condition).
- **D. `syncFromVault()` rehydrates deleted item** -> **True**.
- **E. websocket onCreated/onUpdated triggers restore** -> **CREATED path triggers sync** (`viewerContext.js` 1417-1429), so **can** restore from backend.

---

## Single Source of Truth

Current effective source of truth is **backend `reels` catalog** (`GET /api/reels`), not UI stores or localStorage.
