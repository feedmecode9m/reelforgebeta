# VAULT-ROOTCAUSE-01 — Production Bug Isolation

**Mode:** Read-only trace (no code changes, no deploys).  
**Source of truth:** User manual production testing on https://strong-lolly-a9fcb4.netlify.app/  
**Production bundle:** `index-q8wTbWuf.js` (contains `pruneGhostVideoVaultEntries`, deployed 2026-07-24)  
**Backend:** https://reelforge-deploy-production.up.railway.app (via Netlify `/api` proxy)

---

## Executive summary

| Vault | User symptom | Verdict | First divergence (file:function:lines) |
|-------|--------------|---------|----------------------------------------|
| MP4 | Delete OK, item returns shortly after | **STATE SYNC BUG** | `viewerContext.js:syncFromVault` → `mergeVideoVaultEntries` re-projects backend catalog after delete when tombstone/client purge is incomplete |
| Thumbnail | Accept incomplete; placeholder or missing canonical | **STATE SYNC BUG** | `viewerContext.js:syncFromVault` → `reconcileStaleThumbnailsOnStartup` → `reconcileThumbnailVault` purges or orphan-markets entries; render shows placeholder when metadata/URL diverges |
| Hero | Assumed broken until proven | **STATE SYNC BUG** (+ **PRODUCT BUG** on R2 URL shape) | Bootstrap `syncFromVault` + `pendingHeroAssetIds` gate races `acceptHeroFile`; catalog hero rows use external R2 URLs not `/videos/` paths |

Prior harness PASS results (vault-verify-03) are **not** treated as proof for this report.

---

## Production evidence (2026-07-24)

| Probe | Result |
|-------|--------|
| `GET /api/reels` (admin auth) | 38 catalog rows: 18 video, 14 thumb (`/thumbs/` in `url`), 2 `category=HERO` |
| Thumb reel shape | `url`: `https://…/thumbs/{uuid}.jpg`, `thumbnailPath`: `/thumbs/{uuid}.jpg`, `fileName`: `{uuid}.jpg` |
| Hero reel shape | `url`: `https://pub-….r2.dev/prod/{uuid}.mp4` (not under `/videos/`) |
| Ghost-purge in live bundle | `pruneGhostVideoVaultEntries` present in `index-q8wTbWuf.js` |
| Manual user reports | MP4 resurrection, thumbnail accept/persist failure, hero assumed broken |

---

# 1. MP4 vault — delete resurrection

## Observed (user)

Delete appears successful; deleted MP4 reappears in Video Vault shortly afterward (without user re-upload).

## Canonical execution chain

```
DROP handleVaultVideoDrop (VaultExperience.svelte:864)
  → uploadMedia POST /api/reels (1056–1063)
  → personalVideos.update + persistPersonalVault (1142–1197)
  → AI_CLEANUP_AGENT.distributeVideoToFeed (1198)

DELETE (typical UI: ✕ button)
  → AI_CLEANUP_AGENT.deleteVaultVideo (aiCleanupAgent.js:573)
  → deleteReelById DELETE /api/reels/{id} (616)
  → applyCanonicalDeleteClientEffects → recordDeletedMediaIds (618–621) [if backend OK]
  → syncFromVault(true) (630) [no force]

ASYNC (seconds later)
  → connectReelEventSocket onCreated → syncFromVault(true) (viewerContext.js:1880)
  → Studio/uiAgent/contentAgents refresh → syncFromVault(true) (multiple callers)
  → refreshContent → bootstrapMediaFromBackend → hydrateVaultFromReels (1539–1544)
  → mountViewer boot → syncFromVault(true, true) (1825)
```

## Writers to `personal_video_vault` (complete map)

| # | Function | File | Lines | Expected after DELETE | Observed divergence |
|---|----------|------|-------|----------------------|---------------------|
| W1 | `persistPersonalVault` | `viewerContext.js` | 238–283 | Vault excludes deleted id (tombstone filter) | Re-writes resurrected rows when store repopulated |
| W2 | `personalVideos.subscribe` | `viewerContext.js` | 1784–1787 | Every store mutation persists | Propagates bad store state to LS immediately |
| W3 | `syncFromVault` → `persistPersonalVault` | `viewerContext.js` | 1162–1225 | Backend projection minus tombstoned ids | **Re-inserts row if backend catalog still contains id and tombstone missing** |
| W4 | `hydrateVaultFromReels` → `safeStorageSet` | `mediaBootstrap.js` | 324–329 | Backend videos + pending blob only; ghosts pruned; tombstones filtered | Re-inserts if backend row exists and tombstone missing |
| W5 | `reloadVaultStoresFromStorage` | `viewerContext.js` | 892–919 | Reload LS through `filterOutDeletedMedia` | Reads stale LS if W3/W4 ran without tombstone |
| W6 | `handleVaultVideoDrop` | `VaultExperience.svelte` | 1142–1197 | N/A on delete | N/A |

## Tombstone / purge chain

| Step | Function | File | Lines |
|------|----------|------|-------|
| T1 | `recordDeletedMediaIds` | `deletionSync.js` | 55–71 |
| T2 | `applyCanonicalDeleteClientEffects` | `deletionSync.js` | 86–139 |
| T3 | `purgeMediaFromClientState` | `deletionSync.js` | 224–264 |
| T4 | `filterOutDeletedMedia` | `deletionSync.js` | 158–171 |
| T5 | `pruneGhostVideoVaultEntries` | `deletionSync.js` | 281–294 |
| T6 | `applyVideoDeleteTombstone` | `VaultExperience.svelte` | 337–342 (batch paths only) |

## DELETE timeline (single-item UI path — primary manual path)

| Step | Stage | Expected state | Observed / risk |
|------|-------|----------------|-----------------|
| 1 | User clicks ✕ | — | `VaultExperience.svelte:1957` → `deleteVaultVideo` |
| 2 | Confirm | — | `aiCleanupAgent.js:592` |
| 3 | DELETE API | Catalog row gone; HTTP 200 | `media.js:608–634` — if fail, caught at 623 |
| 4 | Tombstone | `reelforge_deleted_media_ids` contains `{id}` | **SKIPPED when `!token \|\| !diskName`** (`613–624`) |
| 4b | Local purge only | Store/LS row removed | `runClientMediaPurge` at 626–627 — **no tombstone** |
| 5 | UI message | Reflects backend result | `629` sets `✅ Video deleted` even if step 4 skipped backend |
| 6 | `syncFromVault(true)` | Vault stays empty | `630` — **`force=false`**; may no-op if &lt;5s since last sync (`988`) |
| 7 | `mergeVideoVaultEntries` | Empty or tombstone-filtered | `922–926`: when online, **replaces vault with full backend video projection** |
| 8 | `personal_video_vault` write | No deleted id | **FIRST INCORRECT MUTATION** when step 4 had no tombstone and step 7 sees catalog row |
| 9 | Delayed sync / WS / refresh | Stay deleted | `1880`, `1539–1544`, `1825` repeat step 7 |

### First divergence (MP4 resurrection)

**File:** `frontend/src/viewer/viewerContext.js`  
**Function:** `syncFromVault` → `mergeVideoVaultEntries`  
**Lines:** 1162–1174, 922–926  

**Expected:** After successful DELETE, `personal_video_vault` and `personalVideos` store remain without the deleted `id`, even when a later sync runs.

**Observed:** When `deleteVaultVideo` completes local purge **without** `recordDeletedMediaIds` (no admin token or empty `diskName` at `aiCleanupAgent.js:613–624`), or when a sync runs before tombstone is written, the next online `syncFromVault` executes:

```javascript
// viewerContext.js:922–926 — backend catalog wins
return filterOutDeletedMedia(Array.isArray(incomingEntries) ? incomingEntries : []);
```

If the tombstone set is empty, any row still returned by `GET /api/reels` is written back via `persistPersonalVault` (1225) and the `personalVideos.subscribe` hook (1784–1787).

**Recreator function:** `syncFromVault` (primary); also `hydrateVaultFromReels` (324–329) on bootstrap/refresh when the same conditions hold.

**Secondary recreator (fixed for refresh-only ghosts):** `hydrateVaultFromReels` used to merge stale LS ghosts; `pruneGhostVideoVaultEntries` (`mediaBootstrap.js:325–328`) addresses refresh **without** tombstone when backend row is gone. Manual “shortly after” resurrection matches **syncFromVault re-projection**, not bootstrap-only ghost merge.

### Backend persistence check

| Step | Endpoint | Expected | Production note |
|------|----------|----------|-----------------|
| DELETE | `DELETE /api/reels/{id}` | Row removed from Postgres | Must verify per incident id in Network tab |
| Catalog | `GET /api/reels` | Deleted id absent | If id **still present**, divergence is **PRODUCT BUG** (backend); client will resurrect unless tombstoned |

---

# 2. Thumbnail vault — accept / placeholder / persistence

## Observed (user)

Accept does not complete correctly; accepted image does not appear or remains a placeholder; persistence incorrect.

## Canonical execution chain

```
DROP handleVaultThumbnailDrop (VaultExperience.svelte:791)
  → pendingThumbnail store (818–826) [blob preview only, no API]

ACCEPT acceptPendingThumbnail (1329)
  → uploadThumbnail → POST /api/reels (1356–1359)
  → validate thumbPath starts with /thumbs/ (1368–1370)
  → appendThumbnailVaultEntry (1397) + addPersonalThumbnailReelId (thumbnailVault.js:510)
  → syncCollectionStore (1398)
  → AI_CLEANUP_AGENT.distributeThumbnailAcrossCategories (1399)
  → syncFromVault(true, true) (1438)

syncFromVault thumbnail leg (viewerContext.js)
  → upgradeThumbnailVaultFromBackendReels (1068)
  → reloadVaultStoresFromStorage (1069)
  → reconcileStaleThumbnailsOnStartup → reconcileThumbnailVault (1077–1078)

REACTIVE (runs on every vault size change)
  → ensureThumbnailCanonicalization (VaultExperience.svelte:301–303)
  → reconcileThumbnailVault again (263–267)

RENDER (VaultExperience.svelte:1777–1807)
  → personalThumbnailCollection (string keys)
  → getVaultImageReel (vaultUtils.js:244–276)
  → {#if isImage(reel) && reel.url} MediaThumbnail {:else} placeholder
```

## ACCEPT timeline

| Step | Stage | Expected | First divergence risk |
|------|-------|----------|----------------------|
| 1 | Drop | `pendingThumbnail` with blob preview | OK |
| 2 | Accept click | POST succeeds, `response.id` set | Fail → catch 1446–1466 |
| 3 | `appendThumbnailVaultEntry` | `personal_thumbnails` has CANONICAL row; `personal_thumbnail_reel_ids` has id | OK if POST valid |
| 4 | `syncFromVault` | Upgrade id/url from catalog; collection synced | **Step 4a** |
| 4a | `reconcileStaleThumbnailsOnStartup` | Keep canonical row | **Purges row if `classifyThumbnailEntry` → stale/ghost** (`thumbnailVault.js:395–400`, `thumbnailCanonicalization.js:128–130`) |
| 5 | `reloadVaultStoresFromStorage` | Store matches LS | Clears collection if LS empty (`885–889`) |
| 6 | Reactive `ensureThumbnailCanonicalization` | No-op or upgrade | **Second reconcile race** (`301–303`) |
| 7 | Render | `getVaultImageReel` → `/thumbs/…` loads | **Placeholder if url empty or image error** (`1806–1807`) |

### First divergence (thumbnail accept / placeholder)

**Path A — metadata purged after accept (persistence)**

| Field | Value |
|-------|--------|
| **File** | `frontend/src/lib/viewer/thumbnailVault.js` |
| **Function** | `reconcileThumbnailVault` |
| **Lines** | 395–400 |
| **Caller** | `reconcileStaleThumbnailsOnStartup` → `syncFromVault` (`viewerContext.js:1077–1078`) and `ensureThumbnailCanonicalization` (`VaultExperience.svelte:263–267`) |
| **Expected** | Newly accepted `id` remains in `personal_thumbnails` after accept |
| **Observed** | Entry removed or marked orphaned when `backendIds` set (from `GET /api/reels`) does not contain the accepted `id` at reconcile time — classified `ghost_canonical_404` / `stale` (`thumbnailCanonicalization.js:128–130`) |
| **Downstream** | `reloadVaultStoresFromStorage` clears `personalThumbnailCollection` when vault empty (`viewerContext.js:885–889`); grid shows zero cards or orphan placeholders |

**Path B — collection present, render placeholder (display)**

| Field | Value |
|-------|--------|
| **File** | `frontend/src/components/experiences/VaultExperience.svelte` |
| **Function** | template render branch |
| **Lines** | 1789–1807 |
| **Expected** | `getVaultImageReel` returns resolvable `/thumbs/{file}` URL |
| **Observed** | `isImage(reel) && reel.url` false → static placeholder (`🖼️`); or `MediaThumbnail` `on:error` → `handleVaultThumbnailError` inserts placeholder (`vaultUtils.js:158–178`) |
| **Production note** | Catalog thumb URLs resolve to `https://…/thumbs/{uuid}.jpg` (same-origin proxy). 404 or CORS → placeholder while LS may still hold metadata |

**Path C — empty vault after refresh (membership)**

| Field | Value |
|-------|--------|
| **File** | `frontend/src/lib/viewer/thumbnailVault.js` |
| **Function** | `hydrateEmptyThumbnailVaultFromBackendReels` |
| **Lines** | 231–258 |
| **Expected** | After hard refresh, rows restored for ids in `personal_thumbnail_reel_ids` |
| **Observed** | Returns `0` when membership key empty (`232–233`); `upgradeThumbnailVaultFromBackendReels` returns 0 (`269`) — vault stays empty until accept runs again |

### Thumbnail trace table (persistence keys)

| Key | Writer | Reader |
|-----|--------|--------|
| `personal_thumbnails` | `appendThumbnailVaultEntry`, `writeThumbnailVault`, reconcile | `readThumbnailVault`, render lookup |
| `personal_thumbnail_reel_ids` | `addPersonalThumbnailReelId` on append | `hydrateEmptyThumbnailVaultFromBackendReels` |
| `personalThumbnailCollection` (store) | `syncCollectionStore` | Grid `{#each}` |
| `reelforge_feed` | `distributeThumbnailAcrossCategories` | Feed placeholders (not vault grid) |

---

# 3. Hero vault — full lifecycle (no assumed PASS)

## Observed

Treated as broken until manual proof otherwise.

## Canonical execution chain

```
DROP handleHeroDrop (HeroExperience.svelte) → heroPendingFile preview
ACCEPT acceptHeroFile (1289)
  video: uploadVideo category=HERO (1402–1410)
  image: uploadThumbnail category=HERO (1519–1527)
  → saveHeroReel (1423 / 1539)
  → saveHeroManagerConfig heroAssetId (1425–1430 / 1540–1545)
  → HERO_BACKGROUND_VIDEO.set / HERO_POSTER_IMAGE.set (1433 / 1547)
  → dispatch reelforge:hero-upload phases start|created|committed

BOOT mountViewer (viewerContext.js:1557)
  → bootstrapMediaFromBackend → restoreHeroReelIdentityFromReels (mediaBootstrap.js:69–204)
  → hydrateHeroBackgroundStores (1719–1722)
  → reloadVaultStoresFromStorage (1814)
  → syncFromVault(true, true) (1825)
  → connectReelEventSocket onCreated → syncFromVault (1880)

GATE pendingHeroAssetIds (viewerContext.js:1790–1807)
  → blocks video vault admission during hero upload
```

## Hero timeline (first incorrect state)

| Step | Stage | Expected | Divergence |
|------|-------|----------|------------|
| 1 | Accept video | `heroAssetId`, `saveHeroReel`, R2 or `/videos/` URL in stores | Production catalog shows **R2 absolute URL** (`pub-….r2.dev/prod/….mp4`) |
| 2 | `reelforge:hero-upload` created | `pendingHeroAssetIds.add(reelId)` | Hero row blocked from MP4 vault (`1798–1802`) — correct |
| 3 | committed | `pendingHeroAssetIds.delete(reelId)` | If never fires, hero id **excluded** from video vault persist (`238–258`) |
| 4 | Page reload | `restoreHeroReelIdentityFromReels` restores `saveHeroReel` if manager config has id | Fails with `NO_CATALOG_MATCH`, `INVALID_URL`, `CONFIG_MISMATCH` (`mediaBootstrap.js:100–154`) when catalog URL shape ≠ hero pipeline expectation |
| 5 | `syncFromVault` | Hero excluded from `personal_video_vault` via `filterNonHeroAssets` | Hero presentation depends on **separate** hero stores, not MP4 vault |
| 6 | Render | Hero stage plays `HERO_BACKGROUND_VIDEO` | Empty/fallback if hydrate could not resolve R2 URL or blob cleared (`1699–1702`) |

### First divergence (hero)

**File:** `frontend/src/lib/mediaBootstrap.js`  
**Function:** `restoreHeroReelIdentityFromReels`  
**Lines:** 114–127 (resolveMediaUrl empty) or 145–154 (id mismatch)  

**Expected:** After accept + reload, hero manager `heroAssetId` resolves to playable URL in `HERO_BACKGROUND_VIDEO`.

**Observed (production catalog):** Hero reels expose `url` as external R2 HTTPS, not `/videos/{file}`. Any restore/hydrate step that requires relative `/videos/` or local disk path logs `INVALID_URL` / fails `heroReelFromUploadResponse`, leaving hero stage on fallback/empty even when catalog row exists.

**Verdict:** **STATE SYNC BUG** (bootstrap restore vs R2 URL shape) + **PRODUCT BUG** (hero catalog URLs not normalized to same contract as vault MP4 entries).

---

# 4. `reelforge_feed` interaction (MP4)

Not the vault grid, but can look like “resurrection” in Studio feed:

| Function | File | Lines | Behavior |
|----------|------|-------|----------|
| `distributeVideoToFeed` | `aiCleanupAgent.js` | 202+ | Adds personal video placeholders to feed |
| `syncVideoVaultToFeed` | `aiCleanupAgent.js` | 306–315 | Re-distribute all vault videos |
| Called from | `viewerContext.js` | 1842, 1235, 1276 | Post-sync timeouts |

Vault resurrection specifically requires `personal_video_vault` / `personalVideos` writers (Section 1).

---

# 5. Verification commands (manual reproduction)

Run in browser DevTools on production while reproducing user steps:

```javascript
// Snapshot vault + tombstones
JSON.parse(localStorage.getItem('personal_video_vault')||'[]').map(v=>v.id)
JSON.parse(localStorage.getItem('reelforge_deleted_media_ids')||'[]')
JSON.parse(localStorage.getItem('personal_thumbnails')||'[]').map(t=>t.id)
JSON.parse(localStorage.getItem('personal_thumbnail_reel_ids')||'[]')
JSON.parse(localStorage.getItem('reelforge_hero_manager_config')||'{}').heroAssetId
```

```javascript
// Filter console to divergence markers
// MP4: VAULT-DELETE-TRACE, syncFromVault, VIDEO_VAULT_INSERT, merge log
// Thumb: VAULT_BOOTSTRAP, STARTUP_RECONCILE, VAULT_RENDER placeholder:true
// Hero: HERO_ACCEPT, BG7V restore reason, HERO_HYDRATION
```

Network tab (single MP4 delete):

1. `DELETE /api/reels/{id}` → status + body  
2. Immediate `GET /api/reels` → is `id` still present?  
3. Next `syncFromVault` window → does `personal_video_vault` regain `id`?

---

# 6. Verdict matrix

| Issue | Verdict | First divergence | Evidence |
|-------|---------|------------------|----------|
| MP4 reappears after delete | **STATE SYNC BUG** | `viewerContext.js:syncFromVault` / `mergeVideoVaultEntries:922–926` | Tombstone skipped on some delete paths (`aiCleanupAgent.js:613–627`); online sync re-projects backend catalog into `personal_video_vault` |
| MP4 id still in GET after DELETE | **PRODUCT BUG** (backend) | Backend `DELETE` handler / DB | Client will resurrect unless tombstone present |
| Thumbnail accept / persist | **STATE SYNC BUG** | `thumbnailVault.js:reconcileThumbnailVault:395–400` via `syncFromVault:1077` | Post-accept reconcile + reactive `ensureThumbnailCanonicalization:301–303` |
| Thumbnail placeholder UI | **STATE SYNC BUG** (render) | `VaultExperience.svelte:1789–1807` | Grid renders placeholder when `reel.url` missing or image load fails |
| Thumbnail storage 404 | **DEPLOYMENT BUG** (if confirmed) | `/thumbs/*` proxy → Railway | Network 404 on `/thumbs/{file}` with catalog row present |
| Hero broken after reload | **STATE SYNC BUG** + **PRODUCT BUG** | `mediaBootstrap.js:restoreHeroReelIdentityFromReels:114–154` | Production hero `url` on R2; restore expects resolvable hero reel URL |
| Prior vault-verify-03 PASS | **Not applicable** | Harness timing/selectors | Does not override manual production failures |

---

# 7. What this report deliberately does not do

- No fix proposals (per mission scope)  
- No deploy or code changes  
- Does not certify hero/thumbnail/MP4 as PASS  

**Next isolation step for user:** Capture one failing delete id and one failing thumb accept id with the Network + localStorage snapshots above; compare `GET /api/reels` before/after DELETE and immediately after Accept + 3s delay (when user sees resurrection / placeholder).

---

*Generated: VAULT-ROOTCAUSE-01 — 2026-07-24*
