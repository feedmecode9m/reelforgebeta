# VAULT AUTHORITY REPORT

Phase: `VAULT-AUTHORITY AUDIT`  
Mode: Forensic only (no fixes applied)

---

## SOURCES OF TRUTH

### Database (Postgres `reels` table)
- **Role:** Authoritative for frontend sync catalog.
- **Evidence:**
  - `backend/src/api/reels.rs` `list_ready_reels()` returns DB rows (7-16).
  - `backend/src/db/reels.rs` `list_ready_reels()` filters `status='ready' AND validated=true` (59-68).
  - `frontend/src/viewer/viewerContext.js` `syncFromVault()` fetches `GET /api/reels` (814-820).
- **Classification:** **Authoritative**.

### Filesystem (`public/videos`, `public/thumbs`)
- **Role:** Runtime media storage and startup import source.
- **Evidence:**
  - Backend logs/reads these dirs at startup: `backend/src/main.rs` (167-180).
  - Startup reconcile scans `public/videos` and imports missing catalog entries: `backend/src/main.rs` (182-210), `backend/src/ingestion/reconcile.rs` (56-205).
- **Classification:** **Authoritative input for backend reconcile** (secondary authority).

### localStorage
- **Role:** Client cache/state, not canonical when backend is reachable.
- **Keys:**
  - `personal_video_vault`, `personal_thumbnails`, `reelforge_feed`, `reel_vault` in `frontend/src/viewer/viewerContext.js` (146-156).
- **Evidence:**
  - `syncFromVault()` overwrites from backend data and persists local stores: `viewerContext.js` (814-833, 912-929).
- **Classification:** **Cache/derived**.

### Svelte stores (`personalVideos`, `personalThumbnailCollection`, `feed`)
- **Role:** UI runtime state.
- **Evidence:** updated by upload/delete/sync paths in `VaultExperience.svelte`, `aiCleanupAgent.js`, `viewerContext.js`.
- **Classification:** **Derived runtime state**.

### Feed (`reelforge_feed`)
- **Role:** Render model derived from backend reels + placeholder distribution.
- **Evidence:**
  - Built during `syncFromVault()`: `viewerContext.js` (828-894).
  - Placeholder sync from thumbnails/videos: `aiCleanupAgent.js` (227-309).
- **Classification:** **Derived cache**.

### Hero state
- **Role:** Derived presentation state (not primary vault authority).
- **Evidence:** reads vault keys for intelligence signals, e.g. `heroIntelligence.js` (696-697).
- **Classification:** **Derived**.

### Sync engine (`syncFromVault`)
- **Role:** Reconciliation writer from backend -> local stores/feed.
- **Evidence:** `viewerContext.js` `syncFromVault()` (785-968).
- **Classification:** **Reconciler (writes derived state from authorities)**.

### WebSocket (`/ws/control-center`)
- **Role:** Event trigger for sync/purge.
- **Evidence:**
  - `onCreated` triggers `syncFromVault(true)`: `viewerContext.js` (1417-1429).
  - `onDeleted` purges client state: `viewerContext.js` (1430-1440).
  - Socket message handling: `frontend/src/lib/wsReelEvents.js` (42-48).
- **Classification:** **Trigger/channel**, not authority itself.

### Ingestion worker
- **Role:** DB status transition + thumbnail generation; publishes CREATED.
- **Evidence:** `backend/src/ingestion/worker.rs` (95-114).
- **Classification:** **Mutator of authoritative DB state**.

---

## DELETE FLOW

## Batch Delete: Thumbnails
- **Call chain**
  - UI button -> `batchDeleteThumbnails()`: `frontend/src/components/experiences/VaultExperience.svelte` (432-450, button 540).
  - Mutations performed:
    - `personalThumbnailCollection.set([])` (436)
    - `localStorage.removeItem(CONFIG.THUMBNAIL_STORAGE_KEY)` (438)
    - remove `isPersonalThumbnail` from feed + persist feed (440-448)
- **Critical finding:** **No backend delete API call** in batch thumbnail path.

## Batch Delete: Videos
- **Call chain**
  - UI button -> `batchDeleteVideos()`: `VaultExperience.svelte` (452-488, button 629).
  - Mutations performed:
    - `personalVideos.set([])` (469)
    - `persistPersonalVault([])` (470)
    - `localStorage.removeItem(CONFIG.VIDEO_VAULT_KEY)` (472)
    - remove personal video feed nodes + persist feed (475-485)
- **Critical finding:** **No backend delete API call** in batch video path.

## Single Delete: Thumbnail
- **Call chain**
  - UI -> `handleThumbnailRemove(index)` -> `AI_CLEANUP_AGENT.handleThumbnailRemove(index)`:
    - `VaultExperience.svelte` (428-430)
    - `aiCleanupAgent.js` (310-334)
  - Backend delete attempt via `deleteMediaFile(thumbnailName, headers)` (322)
  - Local purge:
    - store update + localStorage update + feed placeholder removal (326-330, 264-268)
- **Backend endpoint behavior**
  - `deleteMediaFile` tries:
    1. `/api/storage/file/{filename}`
    2. fallback `/api/media/storage/{filename}`
    - `frontend/src/lib/api/media.js` (233-250)
  - Fallback endpoint deletes files only, not DB row:
    - `backend/src/media_api.rs` `media_storage_delete` (540-565)

## Single Delete: Video
- **Call chain**
  - UI -> `AI_CLEANUP_AGENT.deleteVaultVideo(video.id)`:
    - `VaultExperience.svelte` (709)
    - `aiCleanupAgent.js` (335-358)
  - Backend delete attempt via `deleteMediaFile(diskName, headers)` (348)
  - Client purge via `runClientMediaPurge(...)` (352), implemented in `deletionSync.js` (52-93)
  - Then explicit `await syncFromVault(true)` (355)
- **Backend endpoint behavior**
  - Same dual endpoint behavior as above (`media.js` 233-250).

---

## REPOPULATION FLOW

## [VAULT_RESTORE_SOURCE] 1 — `syncFromVault()` rehydrates from `GET /api/reels`
- `viewerContext.js` (814-820): fetches canonical backend reels.
- `viewerContext.js` (912-929): merges backend reels into `personalVideos` and persists local vault.
- `viewerContext.js` (832-833 + 733-767): ingests thumb reels to local thumb storage and reloads thumb/video stores.

## [VAULT_RESTORE_SOURCE] 2 — WS `CREATED` triggers sync
- `viewerContext.js` `onCreated` (1417-1429): dispatches upload event and calls `syncFromVault(true)`.
- `wsReelEvents.js` delivers `CREATED` messages (42-45).

## [VAULT_RESTORE_SOURCE] 3 — Startup hydration + sync
- `viewerContext.js` on mount:
  - `bootstrapMediaFromBackend(...)` (1312-1316)
  - then `syncFromVault(true)` (1403)
- `mediaBootstrap.js` hydrates local vault from `GET /api/reels` (61-79, 87-141).

## [VAULT_RESTORE_SOURCE] 4 — Backend startup reconcile re-imports disk files
- `main.rs` startup reconcile block (182-210).
- `ingestion/reconcile.rs` scans `public/videos`, inserts missing reels, and can enqueue/mark ready (56-205).

---

## BACKEND RECONCILIATION

Inspected:
- `backend/src/main.rs`
- `backend/src/handlers.rs`
- `backend/src/db/mod.rs` (no `db.rs` present in this checkout)
- `backend/src/ingestion/worker.rs`
- `backend/src/ingestion/reconcile.rs`

### Can existing files in `public/videos` / `public/thumbs` be re-imported automatically?
- **YES**.
- Exact code path:
  - startup gate: `main.rs` (182) checks `startup_reconcile_enabled()`
  - calls `ingestion::reconcile::reconcile_videos(...)`: `main.rs` (184-189)
  - reconcile scans video dir, inserts DB rows for uncataloged files, may mark ready/queue jobs:
    - `ingestion/reconcile.rs` (84-205)
  - `startup_reconcile_enabled()` default true unless disabled by env:
    - `db/mod.rs` (109-113)

---

## DATABASE CONSISTENCY (after delete)

Interpreted for the observed symptom path (batch delete, then refresh/sync):

## Batch Delete (Thumbnail)
- Reel removed from DB? **NO** (frontend batch path has no backend delete call)
- File removed from disk? **NO** (same reason)
- localStorage removed? **YES** (`THUMBNAIL_STORAGE_KEY` removed)
- feed removed? **YES** (personal thumbnail placeholders filtered and feed persisted)

## Batch Delete (Video)
- Reel removed from DB? **NO** (frontend batch path has no backend delete call)
- File removed from disk? **NO**
- localStorage removed? **YES** (`VIDEO_VAULT_KEY` removed + store set empty)
- feed removed? **YES** (personal videos filtered and feed persisted)

## Single Delete (Thumbnail/Video)
- Reel removed from DB? **INCONSISTENT**
  - YES when `/api/storage/file/{filename}` path resolves and DB match exists (`handlers.rs` 377-399).
  - NO when fallback `/api/media/storage/{filename}` handles request (`media_api.rs` 540-565).
- File removed from disk? **Often YES**
- localStorage removed? **YES** (client purge paths)
- feed removed? **YES** initially, then may be repopulated by sync if backend still has row.

---

## IMAGE FLOW (upload -> persist -> sync -> delete -> reload)

## Upload
- UI drop/accept: `VaultExperience.svelte` `acceptPendingThumbnail()` (327-418)
- API call: `uploadThumbnail()` -> `createReel()` in `lib/api/media.js` (124-131, 35-116)
- Storage layers touched:
  - Backend DB + thumb file via `/api/reels` ingestion (`handlers.rs` 133-154; `ingestion/upload.rs` 237-264)
  - Frontend local thumb metadata (`storeThumbnailMetadata`) + store update (`VaultExperience.svelte` 369-383)

## Persist
- localStorage: `personal_thumbnails` (via `storeThumbnailMetadata`, storage module)
- store: `personalThumbnailCollection`

## Sync
- `syncFromVault()` ingests image reels into thumbnail storage (`viewerContext.js` 832-833 + `mediaBootstrap.js` 158-190)

## Delete
- single: `aiCleanupAgent.js` (310-334)
- batch: `VaultExperience.svelte` (432-450)

## Reload
- startup bootstrap + sync: `viewerContext.js` (1312-1316, 1403)

---

## VIDEO FLOW (upload -> persist -> sync -> delete -> reload)

## Upload
- UI drop handler: `VaultExperience.svelte` `handleVaultVideoDrop()` (149-277)
- API call: `uploadMedia(formData)` -> `createReel()` (`media.js` 155-172, 35-116)
- Persist:
  - store `personalVideos.update(...)` (238-242)
  - local `persistPersonalVault(...)` (254; implemented in `viewerContext.js` 190-192)
  - feed distribution `AI_CLEANUP_AGENT.distributeVideoToFeed(entry)` (255)

## Sync
- `syncFromVault()` fetches backend reels and rewrites merged local video vault:
  - `viewerContext.js` (814-820, 912-929)

## Delete
- single: `aiCleanupAgent.js` (335-358) + `deletionSync.js` purge (52-93)
- batch: `VaultExperience.svelte` (452-488)

## Reload
- startup bootstrap + sync: `viewerContext.js` (1312-1316, 1403)

---

## FINAL ROOT CAUSE (ranked)

## ROOT CAUSE #1 (Highest confidence)
**Batch delete is local-only and does not delete backend reel records/files.**
- Evidence: batch delete functions in `VaultExperience.svelte` (432-488) contain no backend delete API calls.
- Result: next `syncFromVault()` rehydrates from backend.

## ROOT CAUSE #2 (High confidence)
**`syncFromVault()` treats backend `GET /api/reels` as canonical and overwrites local deletion state.**
- Evidence: `viewerContext.js` (814-833, 912-929).
- Result: deleted items return on refresh/navigation/sync.

## ROOT CAUSE #3 (Medium confidence)
**Backend has asymmetric delete endpoints; fallback path can remove files without deleting DB reel rows.**
- Evidence:
  - frontend delete fallback chain: `media.js` (233-250)
  - `/api/media/storage/{filename}` file-only delete: `media_api.rs` (540-565)
  - DB row delete logic exists in `/api/storage/file/{filename}` path: `handlers.rs` (377-399)
- Result: client thinks delete succeeded, but DB row may survive and later rehydrate.

