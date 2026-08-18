# MISSION BG-7I — Backend Reconnect + Delete Residual State Audit

**Mode:** Investigation only (no code changes, no commits)  
**Generated:** 2026-07-24T20:10:00Z  
**Production:** https://strong-lolly-a9fcb4.netlify.app/  
**Local:** http://127.0.0.1:5173 (not running during this audit)

---

## Executive summary

| Issue | First failing boundary | Root cause class | Smallest future fix location |
|-------|------------------------|------------------|------------------------------|
| **A — "Backend reconnecting..."** | `uploadStatus` lifecycle after a **successful** backend recovery | Stale frontend operation-status state (cosmetic) | `frontend/src/viewer/viewerContext.js` — `syncFromVault` `finally` block (~1318–1321) and/or `onBackendReconnecting` listener (~1685–1687) |
| **B — MP4 delete leaves thumbnail placeholder** | Video delete client-effects path skips thumbnail vault purge | Asymmetric delete propagation (video vs thumbnail handlers) | `frontend/src/lib/viewer/aiCleanupAgent.js` `deleteVaultVideo` (~618–636) and `frontend/src/components/experiences/VaultExperience.svelte` `applyVideoDeleteTombstone` / batch video delete (~699–702) |

**Shared cause?** **No.** Issue A is operation-status / reconnect UX lifecycle. Issue B is thumbnail vault store not updated on video delete. They may co-occur after refresh (sync triggers reconnect banner) but are independent defects.

---

## PART 1 — Backend reconnect trace

### Display chain

| Layer | File | Function / symbol | Role |
|-------|------|-------------------|------|
| Component | `frontend/src/components/viewer/GlobalOperationStatus.svelte` | reactive `$uploadStatus` → `classifyOperationStatus()` | Renders spinner + **"Backend reconnecting..."** (emoji stripped) |
| Store | `frontend/src/viewer/viewerContext.js` | `uploadStatus` writable (~356) | Single string drives global operation status |
| Presentation | `frontend/src/lib/operationStatusPresentation.js` | `classifyOperationStatus()` | `"reconnecting"` → `kind: 'loading'` (cosmetic; does not gate media) |
| Alt banner (different string) | `frontend/src/components/viewer/BackendHealthBanner.svelte` | listens `reelforge:backend-reconnecting` | Shows **"Reconnecting to backend…"** for 5s — not the same UI surface |

### Producers of `Backend reconnecting...`

| Path | File | Function | Trigger | Network |
|------|------|----------|---------|---------|
| **P1** | `frontend/src/lib/api.js` | `fetchWithRetry()` catch (~209–212) | Any retried `fetch` network error | Whatever URL was passed in (retries 3×, backoff up to 8s) |
| **P1 emit** | `frontend/src/lib/api.js` | `notifyBackendReconnecting()` (~99–104) | Dispatches `reelforge:backend-reconnecting` | — |
| **P2** | `frontend/src/viewer/viewerContext.js` | `syncFromVault()` (~1039–1047) | `checkBackendHealth()` returns `false` | `GET /api/health`, `/health`, `/` (5s timeout each) |
| **P3** | `frontend/src/viewer/viewerContext.js` | `onBackendReconnecting` (~1685–1687) | CustomEvent consumer | Downstream of P1/P2 — sets `uploadStatus` |

### Initialization path

1. App boot → `viewerContext.js` registers `reelforge:backend-reconnecting` listener (~1703).
2. `bootstrapMediaFromBackend` / `syncFromVault` run on mount.
3. `syncFromVault` sets `🔄 Syncing with backend...` then `checkBackendHealth()` then `fetchWithRetry(GET /api/reels)`.

### Health check dependency

- `checkBackendHealth()` in `api.js` (~107–158): probes multiple base/path combos; success sets `backendConnectionStatus.state = 'online'` and dispatches `reelforge:backend-connection`.
- **Independent** of whether `uploadStatus` is later cleared.

### Retry timer

- `fetchWithRetry`: default 3 retries, 400ms base delay, exponential backoff capped at 8s (`api.js` ~161–227).
- Each catch invokes `notifyBackendReconnecting()` **before** retry completes.

### WebSocket / control-center

- Static search: no `notifyBackendReconnecting` in `wsReelEvents.js`.
- Production harness: `websocketState: null` at reconnect occurrence — **not WS-driven** in captured evidence.

### Stuck-state boundary (first failure)

`syncFromVault` `finally` (~1318–1321):

```javascript
if (get(uploadStatus).startsWith('✅') || get(uploadStatus).startsWith('⚠️') || get(uploadStatus).startsWith('❌')) {
  uploadStatus.set('Standby');
}
```

**Does not clear** `🔄 Backend reconnecting...` or other loading prefixes. After backend returns online, `backendConnectionStatus.state === 'online'` but operation status can remain stuck.

No production `viewerContext` listener clears `uploadStatus` on `reelforge:backend-connection` `state === 'online'` (RC3 harness observes online event while DOM still shows reconnect text).

### Blocks media rendering?

**No — cosmetic.** `classifyOperationStatus` treats reconnect as `loading` spinner only. Vault sync, feed build, and media URLs proceed independently when `/api/reels` succeeds.

---

## PART 2 — Delete lifecycle trace

### End-to-end path (vault MP4 single delete)

```
UI: VaultExperience / AI_CLEANUP_AGENT.deleteVaultVideo(videoId)
  ↓ confirm dialog
  ↓ uploadStatus.set('🗑️ Deleting …')
  ↓ deleteReelById(videoId)          → DELETE /api/reels/{uuid}
  ↓ applyCanonicalDeleteClientEffects  → recordDeletedMediaIds + runClientMediaPurge
  ↓ syncFromVault(true)                → GET /api/reels + thumbnail reconcile
  ↓ uploadStatus.set('✅ Video deleted')
```

**Batch video delete** (`VaultExperience.svelte` ~693–702): same API + `applyVideoDeleteTombstone(deletedIds)` twice; **no** `purgeStaleOrphanThumbnails`.

### Identifiers used

| Stage | Primary key | Secondary |
|-------|-------------|-----------|
| API delete | **`reelId` (UUID)** | — |
| Backend storage | **`fileName` / storage key** | `video_url`, `thumbnail_url` on reel row |
| Client purge match | **`reelId`**, **`filename`**, **`videoUrl`** | `reelMatchesDeletedMedia()` in `deletionSync.js` |
| Thumbnail vault | **`id`** (when present), **`fileName`**, **`url`** | Ghost purge compares id to **image-reel** id set only |

### Backend delete (authoritative)

`backend/src/handlers.rs` `delete_reel`: removes video file **and** thumb file from reel row `thumbnail_url`, then DB row.

### Client stores updated by video delete

| Store key | Updated? | Mechanism |
|-----------|----------|-----------|
| `personal_video_vault` | ✅ | `purgeMediaFromClientState` → `personalVideos` + `persistPersonalVault` |
| `reelforge_feed` | ✅ | `purgeMediaFromClientState` → feed filter + persist |
| `reelforge_deleted_media_ids` | ✅ | `recordDeletedMediaIds` |
| `reel_vault` | ⚠️ indirect | Only via offline `syncFromVault` fallback (`CONFIG.VAULT_KEY`) |
| **`personal_thumbnails`** | ❌ **not directly** | Video path never calls `deleteThumbnailVaultEntries` |
| **`personal_thumbnail_index`** | ❌ **not directly** | Mirror of thumbnail vault; only updated via thumbnail write paths |
| `personalThumbnailCollection` (runtime) | ⚠️ partial | `reconcileStaleThumbnailsOnStartup` after sync **may** purge stale ghosts — not guaranteed for all entry shapes |

### Thumbnail delete path (working reference)

`aiCleanupAgent` thumbnail handler (~526) and `VaultExperience.applyThumbnailDeleteTombstone` (~369–394):

- `deleteThumbnailVaultEntries(deletedIds, imageReels, …)`
- `purgeStaleOrphanThumbnails` (thumbnail batch delete ~614, ~1536)

**Video delete omits both.**

### `runClientMediaPurge` scope

`viewerContext.js` (~785–798) → `purgeMediaFromClientState` in `deletionSync.js` (~224–265):

- Touches: `feed`, `personalVideos`, `activeReel`
- **Does not touch** `personal_thumbnails` / thumbnail collection

### Why placeholder can survive

1. **Asymmetric handler:** Video delete never runs explicit thumbnail vault tombstone/purge (unlike thumbnail delete).
2. **Id-less entries:** `deleteThumbnailVaultEntries` keeps entries with no `id` (`!id || !deletedSet.has(id)`).
3. **Orphan retention:** `reconcileStaleThumbnailsOnStartup` calls `reconcileThumbnailVault` with `purgeMarkedOrphans: false` — classified `orphaned` entries are kept unless later marked stale.
4. **Feed shelf:** If a feed card’s `thumbnailUrl` outlives video purge matching, UI shows broken-image / fallback placeholder even when video row is gone.

### Stores retaining deleted media reference (report)

After video delete, these **may** still reference deleted thumb/video metadata until a full thumbnail purge/reconcile succeeds:

- **`personal_thumbnails`** — primary residual risk
- **`personal_thumbnail_index`** — mirror of above
- **`personalThumbnailCollection`** — runtime grid source
- **`reelforge_feed`** — if card/thumbnailUrl not matched by purge
- **`personal_video_vault`** — should clear if purge matches; tombstone blocks resurrection

---

## PART 3 — Reproduction

### Steps

1. Upload MP4 (admin session) via vault or studio upload flow.
2. Refresh page (hydrate from backend + localStorage).
3. Delete MP4 from video vault (single delete confirm).
4. Observe thumbnail vault / feed shelf — note placeholder or stale card.
5. Reload page.
6. Observe global operation status — note **"Backend reconnecting..."** while health succeeds.

### Evidence timeline

| Timestamp (UTC) | Event | Store state | Network result | Render result |
|-----------------|-------|-------------|----------------|---------------|
| 2026-07-24T20:03:28Z | Page load (production harness) | `uploadStatus` → `Syncing with backend...` | `GET /` 200 | App shell loads |
| 2026-07-24T20:03:32Z | Health probe start | — | `GET /api/health` started | — |
| 2026-07-24T20:03:35.100Z | Last successful API | — | `GET /api/notifications?userId=…` **200** | — |
| 2026-07-24T20:03:35.619Z | Transient failure | `backendConnectionStatus` still degrading/offline briefly | `GET /api/notifications/status` **network_error** (`signal timed out`) | — |
| 2026-07-24T20:03:35.621Z | **P1→P3 reconnect** | `uploadStatus` ← `🔄 Backend reconnecting...` | `notifyBackendReconnecting()` fired | `GlobalOperationStatus` shows **Backend reconnecting...** |
| 2026-07-24T20:03:37.272Z | Health completes | — | `GET /api/health` **200** | — |
| 2026-07-24T20:03:36.032Z | Backend online event | `backendConnectionStatus.state = online` | `reelforge:backend-connection` online | **Reconnect text persists** in `finalState.uploadStatus` |
| 2026-07-24T20:03:47Z | Harness end | `uploadStatus: "Backend reconnecting..."` | Health 200 at start and end | Spinner still visible — **stale UI** |

**Delete timeline (code + prior RC3-DELETE-01 static/runtime inventory):**

| Stage | Expected | Actual boundary |
|-------|----------|-----------------|
| DELETE click | `DELETE /api/reels/{id}` | ✅ Backend authoritative |
| Client tombstone | All relevant stores | ✅ feed + video vault; ❌ thumbnail vault not in video path |
| Post-delete sync | `purgeStaleOrphanThumbnails` | ✅ thumbnail batch only; ❌ **skipped for video batch** (`VaultExperience` ~699–702) |
| Thumbnail grid | Card removed | Placeholder/card may remain in `personalThumbnailCollection` |

**Artifacts:**

- Reconnect: `frontend/artifacts/rc3-reconnect-01-attribution.json` (2026-07-24 run)
- Delete inventory: `frontend/artifacts/rc3-delete-01-ghost-item-boundary.json`
- Prior reconnect worksheets: `frontend/RC3_RECONNECT_01_EVENT_SOURCE_ATTRIBUTION.md`

---

## PART 4 — Production vs local

| Check | Production (Netlify) | Local (127.0.0.1:5173) |
|-------|----------------------|-------------------------|
| `/api/health` | **200** | **unreachable** (dev server not running) |
| Reconnect harness | **Reproduced** on cold load (~7s after navigation) | Not executed (no local server) |
| Trigger | After refresh / startup sync; **not** tied to delete in harness | Unknown — needs local replay |
| Backend actually down? | **No** — health 200, catalog calls succeed | — |

### Does reconnect happen…

| Question | Answer |
|----------|--------|
| Both prod and local? | **Confirmed production only** in this audit; local not running |
| Production only? | **Yes** (only environment tested) |
| After refresh only? | **Primarily** — occurs during startup `syncFromVault` + parallel notification polling |
| After delete only? | **No** — harness occurrence had no delete step; delete is not the reconnect trigger |

---

## STOP CONDITION — Deliverables

### 1. First failing boundary

- **Reconnect:** `uploadStatus` clear lifecycle in `syncFromVault` `finally` (and missing online clear for reconnect prefix) — backend is healthy but UI status never returns to `Standby`.
- **Delete:** Video delete handler boundary — `applyCanonicalDeleteClientEffects` / `runClientMediaPurge` stops before `personal_thumbnails`; explicit `deleteThumbnailVaultEntries` / `purgeStaleOrphanThumbnails` never invoked on video path.

### 2. Root cause classification

| Issue | Classification |
|-------|----------------|
| A | **Stale frontend synchronization / operation-status lifecycle** (transient API error sets reconnect; recovery does not reset) |
| B | **Stale frontend state lifecycle / asymmetric delete propagation** (thumbnail vault not purged on video delete) |

### 3. Smallest possible future fix location

| Issue | Location |
|-------|----------|
| A | `viewerContext.js`: extend `syncFromVault` `finally` to clear loading/reconnecting statuses after successful sync; optionally clear on `reelforge:backend-connection` online when status contains `reconnecting` |
| B | `aiCleanupAgent.js` `deleteVaultVideo` + `VaultExperience.svelte` video batch delete: call `deleteThumbnailVaultEntries([reelId], imageReels)` or `purgeStaleOrphanThumbnails(deletedIds)` mirroring thumbnail delete path |

### 4. Independent or shared?

**Independent.** Same session may show both after upload → refresh → delete → reload, but reconnect is triggered by notification/status timeout during sync; delete residual is caused by missing thumbnail vault purge on video delete.

---

## Appendix — Static producer inventory (reconnect)

| # | Writer | Trigger condition | Blocks media? |
|---|--------|-------------------|---------------|
| P1 | `fetchWithRetry` catch | Network error on any retried request | No |
| P2 | `syncFromVault` unhealthy branch | `checkBackendHealth()` false | No (falls back to localStorage catalog) |
| P3 | `onBackendReconnecting` | CustomEvent from P1/P2 | No |

**Health monitor:** `BackendHealthBanner` — separate copy; 5s `reconnectingActive` pulse on same CustomEvent.
