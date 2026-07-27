# BG-DELETE-VAULT-01 — Vault MP4 Delete Resurrection Trace

**Date:** 2026-07-27  
**Scope:** Evidence-only. No code changes.  
**Symptom:** Delete MP4 in Vault → disappears → refresh/sync → same item returns.

---

## Executive summary

The delete pipeline is **split across two layers** with different guarantees:

| Layer | Behavior when DELETE succeeds | Behavior when DELETE fails/skipped |
|-------|------------------------------|-----------------------------------|
| **Backend** (`DELETE /api/reels/{id}`) | DB row + disk/R2 removed; absent from `GET /api/reels` | Row remains; catalog unchanged |
| **Frontend** | Tombstone + backend projection should keep item gone | **Tombstone can be cleared on next sync**, re-importing from catalog |

**The single discriminating test** (run immediately after delete, before refresh):

```bash
curl -sS "https://reelforge-deploy-production.up.railway.app/api/reels" \
  | python3 -c "import sys,json; ids=[r.get('id') for r in json.load(sys.stdin)]; print('DELETED_ID_PRESENT', 'YOUR-UUID' in ids)"
```

| Result | Conclusion |
|--------|------------|
| `DELETED_ID_PRESENT True` | Backend never deleted → fix DELETE path (auth, proxy, handler) |
| `DELETED_ID_PRESENT False` but Vault shows item | Frontend reconciliation resurrected it |

**Ranked likely causes** (code evidence):

1. **~70%** — `syncFromVault()` + `reconcileTombstonesAgainstCatalog()` re-admits catalog rows when backend still serves them (DELETE failed or never sent).
2. **~20%** — `DELETE /api/reels/{id}` blocked (admin auth required; Netlify 503 on same-origin proxy).
3. **~10%** — Startup `reconcile_videos()` re-imports orphan disk files as **new** reel rows (same filename, new UUID) if DB row deleted but file remains.

---

## 1. Delete entry points

| Entry | File | Handler chain |
|-------|------|---------------|
| **Per-video delete button** | `VaultExperience.svelte:2218` | `handleVideoDelete(video.id)` |
| **Drag-to-delete zone** | `VaultExperience.svelte:871-898` | `handleVaultDeleteDrop` → `handleVideoDelete` |
| **Batch: selected videos** | `VaultExperience.svelte:785-854` | `batchDeleteSelectedVideos()` |
| **Batch: all videos** | `VaultExperience.svelte:1827-1903` | `batchDeleteVideos()` |
| **Studio feed delete** | `contentAgents.js:171-207` | `ProductionAgent.deleteReel()` |
| **Studio bulk delete** | `StudioExperience.svelte:367-404` | dynamic `deleteReelById` import |
| **AI cleanup agent** | `aiCleanupAgent.js:576-649` | `deleteVaultVideo()` (canonical Vault path) |
| **Hero manager panel** | `HeroManagerPanel.svelte:448` | `deleteReelById` + `syncFromVault` |
| **UI agent** | `uiAgent.js:123-126` | `ProductionAgent.deleteReel` + `syncFromVault` |

**Keyboard delete:** No dedicated keyboard handler found for MP4 vault delete. Thumbnail batch buttons log `[DELETE_CLICK]` at `VaultExperience.svelte:1979-1990`; video batch uses click handlers only.

---

## 2. End-to-end trace (canonical single-video path)

```
User clicks 🗑️ on MP4 row
  ↓
VaultExperience.handleVideoDelete(videoId)          [VaultExperience.svelte:618]
  ↓
AI_CLEANUP_AGENT.deleteVaultVideo(videoId)          [aiCleanupAgent.js:576]
  ├─ confirm() dialog
  ├─ if admin token + diskName:
  │     DELETE /api/reels/{id}                      [media.js:957 → fetch DELETE]
  │     applyCanonicalDeleteClientEffects()         [deletionSync.js:134]
  │       → recordDeletedMediaIds()                 [localStorage: reelforge_deleted_media_ids]
  │       → purgeMediaFromClientState()             [feed + personalVideos + persist]
  └─ else (no token / API error):
        recordDeletedMediaIds() + runClientMediaPurge()  [local-only tombstone]
  ↓
await syncFromVault(true)                           [aiCleanupAgent.js:649]
  ↓
viewerContext.syncFromVault()                       [viewerContext.js:1034]
  ├─ checkBackendHealth()
  ├─ GET /api/reels                                 [viewerContext.js:1077]
  ├─ reconcileTombstonesAgainstCatalog(catalog)     [viewerContext.js:1088] ⚠️
  ├─ filterOutDeletedMedia(catalog)
  ├─ mergeVideoVaultEntries(local, backend)         [viewerContext.js:1247]
  ├─ personalVideos.set(...) + persistPersonalVault
  └─ AI_CLEANUP_AGENT.syncVideoVaultToFeed()        [reads personal_video_vault → feed]
```

### Batch selected path (different tombstone timing)

```
batchDeleteSelectedVideos()
  ↓
VaultExperience.deleteReelById(reelId)              [VaultExperience.svelte:240]
  → apiDeleteReelById only (no tombstone per item)
  ↓
applyVideoDeleteTombstone(deletedIds)               [only if API returned success]
  ↓
syncDomain → syncFromVault(true, true)
```

**Gap:** Batch path does **not** call `applyCanonicalDeleteClientEffects` per item during the loop; tombstone is batch-applied only for successful API deletes.

---

## 3. Backend DELETE path

```
DELETE /api/reels/{uuid}
  ↓
main.rs:333 → handlers::delete_reel              [handlers.rs:279]
  ├─ AdminAuth required (auth.rs:85-92)           ← 401 if no rf_ session token
  ├─ jobs::cancel_for_reel
  ├─ Remove video file from Railway disk
  ├─ R2 delete_object if R2 enabled               [handlers.rs:361-372]
  ├─ Remove thumb file
  ├─ db::reels::delete_reel                       [db/reels.rs:124]
  └─ EventBus ReelEvent::Deleted
  ↓
200 { success: true, id }
```

`GET /api/reels` returns only `status='ready' AND validated=true` via `list_ready_reels` (`handlers.rs:243` → `api/reels.rs`).

---

## 4. localStorage keys involved

| Key | Purpose |
|-----|---------|
| `personal_video_vault` | Vault MP4 list (`viewerContext.js:193`) |
| `reelforge_feed` | Home feed cards |
| `reelforge_deleted_media_ids` | Tombstone list (`deletionSync.js:15`) |

---

## 5. Every place that can **add items back** after delete

| # | Component | File:line | Mechanism |
|---|-----------|-----------|-----------|
| **A** | `reconcileTombstonesAgainstCatalog` | `deletionSync.js:79-119` | **Removes tombstone** if ID still in backend catalog |
| **B** | `syncFromVault` catalog fetch | `viewerContext.js:1077-1089` | Reloads full catalog from `GET /api/reels` |
| **C** | `mergeVideoVaultEntries` (online) | `viewerContext.js:973-975` | Backend projection replaces vault; includes any catalog video not tombstoned |
| **D** | `hydrateVaultFromReels` | `mediaBootstrap.js:342-348` | On boot: merges backend videos + pending blob uploads into `personal_video_vault` |
| **E** | `reloadVaultStoresFromStorage` | `viewerContext.js:917-933` | Re-reads `personal_video_vault` into store (respects tombstones via `filterOutDeletedMedia`) |
| **F** | `syncVideoVaultToFeed` | `aiCleanupAgent.js:308-317` | Re-distributes vault entries to feed (respects tombstones) |
| **G** | Offline branch in `syncFromVault` | `viewerContext.js:1156-1168` | `distributeVideoToFeed` for local videos missing from feed |
| **H** | Startup `reconcile_videos` | `health_state.rs:169-196` | Imports orphan disk files not in DB as **new** reels |

---

## 6. Resurrection timeline (most common failure mode)

**Precondition:** `DELETE /api/reels/{id}` did **not** remove the catalog row (401/503/network skip).

```
T0  User clicks Delete
      ↓
T1  UI optimistic purge OR brief removal from personalVideos store
      ↓
T2  DELETE fails OR skipped (no admin token)
      • VaultExperience.deleteReelById returns false (batch)
      • OR deleteVaultVideo sets local tombstone anyway (single, fallback path)
      ↓
T3  syncFromVault(true) runs (always after single delete; after batch via syncDomain)
      ↓
T4  GET /api/reels → deleted ID **still present**
      ↓
T5  reconcileTombstonesAgainstCatalog()          ← FIRST RESURRECTION ENABLER
      • Sees ID in live catalog
      • **Removes ID from reelforge_deleted_media_ids**
      ↓
T6  filterOutDeletedMedia() → no longer filters that ID
      ↓
T7  mergeVideoVaultEntries(..., backendReachable: true)
      • Returns backend catalog projection including deleted ID
      ↓
T8  personalVideos.set + persistPersonalVault
      ↓
T9  Item visible again in Vault UI
```

**FIRST component responsible for resurrection:**  
`reconcileTombstonesAgainstCatalog()` in `frontend/src/lib/deletionSync.js:97-102`  
(called from `viewerContext.js:1088` inside `syncFromVault`).

It intentionally drops tombstones when the backend still lists the ID — correct for "delete succeeded but tombstone stale", **incorrect when DELETE never succeeded**.

---

## 7. Alternate resurrection: backend delete succeeds, boot hydrate

Prior fix documented in `VIDEO_DELETE_RESURRECTION_01.md`:

- **Bug (fixed):** `hydrateVaultFromReels` merged stale `personal_video_vault` ghosts when catalog no longer contained deleted IDs.
- **Fix:** `pruneGhostVideoVaultEntries()` before persist (`mediaBootstrap.js:344`).

If resurrection still occurs **after** that fix with catalog confirming deletion, check tombstone clearing at step T5 above (sync still runs on every refresh via `onMount` → `syncFromVault(true, true)` at `viewerContext.js:1964`).

---

## 8. Alternate resurrection: disk reconcile (10%)

If `DELETE` removes DB row but **leaves file on disk**:

```
Railway startup → reconcile_videos()               [health_state.rs:169]
  ↓
Scans videos/ directory
  ↓
find_by_file_name miss → insert_pending_reel NEW uuid
  ↓
Same .mp4 filename re-appears in GET /api/reels with different id
```

Evidence: `ingestion/reconcile.rs:138-169`. Enabled when `startup_reconcile_enabled()` is true.

---

## 9. DELETE transport / auth evidence

| Check | Finding |
|-------|---------|
| DELETE route | `DELETE /api/reels/{id}` — `main.rs:333` |
| Auth | All `/api/*` mutating methods require admin session (`auth.rs:85-92`) |
| Frontend auth header | `getAdminAuthHeaders()` / `authHeaders()` on Vault delete |
| No-token path | `deleteVaultVideo` skips API, local tombstone only (`aiCleanupAgent.js:633`) |
| Netlify proxy | Same-origin `/api/*` may return **503 usage_exceeded** (observed 2026-07-27) — DELETE never reaches Railway |

---

## 10. Prior related work (already in tree)

| Artifact | Fix |
|----------|-----|
| `VIDEO_DELETE_RESURRECTION_01.md` | `pruneGhostVideoVaultEntries` in bootstrap hydrate |
| `VIDEO_SYNC_01.md` | `mergeVideoVaultEntries` tombstone reject |
| `deletionSync.js` | Tombstone system + `applyCanonicalDeleteClientEffects` |

These fixes address **ghost localStorage** resurrection. They do **not** prevent resurrection when **backend catalog still contains the ID** and `reconcileTombstonesAgainstCatalog` clears the tombstone.

---

## 11. Recommended verification protocol (no code)

### Step A — Network (Firefox DevTools)

Delete one MP4. Capture:

```
DELETE https://strong-lolly-a9fcb4.netlify.app/api/reels/{id}
  OR (if bypassing Netlify)
DELETE https://reelforge-deploy-production.up.railway.app/api/reels/{id}
```

Record: status, response body, `Authorization` header present.

### Step B — Catalog truth

```bash
curl -sS "https://reelforge-deploy-production.up.railway.app/api/reels" \
  | jq '.[] | select(.id=="YOUR-DELETED-UUID")'
```

Empty = backend deleted. Non-empty = backend still owns the row.

### Step C — Tombstone state (browser console)

```javascript
JSON.parse(localStorage.getItem('reelforge_deleted_media_ids') || '[]')
JSON.parse(localStorage.getItem('personal_video_vault') || '[]').map(v => v.id)
```

After failed DELETE + sync: expect tombstone **removed** for that ID if still in catalog (confirms T5).

### Step D — Console trace markers

Filter console for:

```
[VAULT-DELETE-TRACE]
[TOMBSTONE_RECONCILE]
[VIDEO-SYNC-01] mergeVideoVaultEntries:tombstone-reject
[VAULT-DELETE-TRACE] syncFromVault:bootstrap_reload
```

---

## 12. Decision matrix

| DELETE network | ID in `/api/reels` | Tombstone after sync | Resurrection cause |
|----------------|-------------------|----------------------|-------------------|
| Never sent (no auth) | Yes | Cleared | **A:** `reconcileTombstonesAgainstCatalog` + catalog reload |
| 401/503 failed | Yes | Cleared | Same as above |
| 200 success | No | Kept | Should **not** resurrect (if it does → stale LS before hydrate fix) |
| 200 success | No (file on disk) | N/A | **H:** startup reconcile creates new row |

---

## 13. Files referenced (investigation index)

| Area | Path |
|------|------|
| Vault UI delete | `frontend/src/components/experiences/VaultExperience.svelte` |
| Canonical delete agent | `frontend/src/lib/viewer/aiCleanupAgent.js` |
| API DELETE | `frontend/src/lib/api/media.js` |
| Tombstones + purge | `frontend/src/lib/deletionSync.js` |
| Sync / merge | `frontend/src/viewer/viewerContext.js` |
| Boot hydrate | `frontend/src/lib/mediaBootstrap.js` |
| Backend handler | `backend/src/handlers.rs` |
| DB delete | `backend/src/db/reels.rs` |
| Disk reconcile | `backend/src/ingestion/reconcile.rs` |

---

**No fixes applied in this mission.** Next step: run Step A+B on one deleted UUID and classify against the decision matrix above.
