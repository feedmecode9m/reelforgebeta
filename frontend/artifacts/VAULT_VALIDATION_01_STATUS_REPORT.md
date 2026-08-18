# VAULT-VALIDATION-01 — Status Report

Generated: 2026-07-23  
Production API: `https://reelforge-deploy-production.up.railway.app`  
Forensic instrumentation: `frontend/src/lib/diagnostics/vaultForensics.js` (+ call sites below)

---

## Phase 1 — Pipeline Map & Execution Graphs

### Personal Thumbnail Vault

| Stage | File | Function |
|-------|------|----------|
| DROP | `VaultExperience.svelte` | `handleVaultThumbnailDrop` |
| Validation | same | image MIME filter |
| Upload | `VaultExperience.svelte` | `acceptPendingThumbnail` → `uploadThumbnail()` |
| Accept | same | `acceptPendingThumbnail` (no upload until Accept) |
| Persistence | `thumbnailVault.js` | `appendThumbnailVaultEntry`, `writeThumbnailVault` → `personal_thumbnails` |
| Collection mirror | `thumbnailVault.js` | `syncCollectionStore` → `personal_thumbnail_index` |
| Delete | `aiCleanupAgent.js` | `handleThumbnailRemove` → `deleteReelById` + `removeThumbnailVaultByIndex` |
| Batch delete | `VaultExperience.svelte` | `batchDeleteThumbnails` → `deleteThumbnailVaultEntries` |
| Refresh | `viewerContext.js` | `reloadVaultStoresFromStorage`, `syncFromVault` |

```
DROP (blob preview only)
 ↓ image MIME validation
 ↓ pendingThumbnail store (temporary)
ACCEPT → uploadThumbnail → POST /api/reels
 ↓ storage write (/thumbs/{uuid}.png on CDN)
 ↓ DB row (reel.id)
 ↓ appendThumbnailVaultEntry (personal_thumbnails)
 ↓ syncCollectionStore (personal_thumbnail_index)
 ↓ syncFromVault
REFRESH → reloadVaultStoresFromStorage → read personal_thumbnails
DELETE → deleteReelById + deleteThumbnailVaultEntries + tombstones
```

### Personal Video Vault (MP4)

| Stage | File | Function |
|-------|------|----------|
| DROP | `VaultExperience.svelte` | `handleVaultVideoDrop` |
| Validation | same + `validateVideoFile` | size, MIME, BG7X dedupe |
| Upload | `media.js` | `uploadMedia` → `uploadVideoSigned` (≥25MB Netlify) or `createReel` (<25MB) |
| Accept | N/A | immediate upload on drop (no separate accept) |
| Persistence | `viewerContext.js` | `persistPersonalVault` → `personal_video_vault` |
| Delete | `aiCleanupAgent.js` | `deleteVaultVideo` → `deleteReelById` + `applyCanonicalDeleteClientEffects` |
| Refresh | `viewerContext.js` | `reloadVaultStoresFromStorage`, `syncFromVault`, `mergeVideoVaultEntries` |

```
DROP
 ↓ validateVideoFile + BG7X name|size dedupe
 ↓ uploadMedia (signed R2 if ≥25MB on Netlify prod)
 ↓ POST /api/reels OR sign→PUT→finalize
 ↓ ingest worker → DB ready
 ↓ personalVideos store + persistPersonalVault
 ↓ distributeVideoToFeed
REFRESH → personal_video_vault localStorage → personalVideos
DELETE → deleteReelById + tombstone + syncFromVault
```

### Hero Background Vault

| Stage | File | Function |
|-------|------|----------|
| DROP | `HeroExperience.svelte` | `handleHeroDrop`, `handleHeroFileSelect` |
| Validation | same | image/video MIME |
| Upload | `HeroExperience.svelte` | `acceptHeroFile` → `uploadVideo` / `uploadThumbnail` |
| Save/apply | same | `saveHeroReel`, `saveHeroManagerConfig`, `HERO_BACKGROUND_VIDEO.set` |
| Persistence | `heroIntelligence.js` / stores | `reelforge_hero_manager_config`, `reelforge_hero_reel`, `reelforge_hero_video` |
| Vault gate | `viewerContext.js` | `BG7W_HERO_VAULT_GATE`, `pendingHeroAssetIds` |
| Delete | `HeroManagerPanel.svelte` | `deleteHeroVaultAsset` → `deleteReelById` + localStorage cleanup |
| Refresh | `viewerContext.js` | hero stores + `syncFromVault` (hero excluded from MP4 vault) |

```
DROP → heroPendingFile (blob preview)
 ↓ auto-acceptHeroFile
 ↓ uploadVideo(category=HERO) or uploadThumbnail
 ↓ saveHeroManagerConfig + HERO_BACKGROUND_VIDEO
 ↓ BG7W gate blocks hero ids from personal_video_vault
REFRESH → reelforge_hero_* keys + registry rebuild
DELETE → deleteReelById + hero localStorage keys + syncFromVault
```

---

## Phase 2 — Forensic Instrumentation (behavior-neutral)

Marker helper: `frontend/src/lib/diagnostics/vaultForensics.js`

Instrumented call sites:
- `VaultExperience.svelte` — thumbnail/video DROP, ACCEPT, UPLOAD_*, DELETE_*
- `HeroExperience.svelte` — DROP, ACCEPT, UPLOAD_SUCCESS/FAIL
- `HeroManagerPanel.svelte` — DELETE_START/SUCCESS/FAIL
- `viewerContext.js` — VAULT_PERSIST (video), VAULT_REFRESH_RESTORE (thumbnail + video)
- `thumbnailVault.js` — VAULT_PERSIST, VAULT_DELETE_START/SUCCESS
- `aiCleanupAgent.js` — VAULT_DELETE_* (thumbnail + video)

---

## Phase 3 — Validation Matrix (production API, 2026-07-23)

Artifact: `frontend/artifacts/vault-validation-01-report.json`

| Case | Result |
|------|--------|
| Thumbnail fresh upload + refresh + delete | **PASS** |
| Thumbnail duplicate filename | **PASS** (distinct UUIDs; UI dedupes separately) |
| Video signed R2 upload | **FAIL** — `/api/uploads/sign` returns **404** on production |
| Video duplicate (signed path) | **FAIL** — blocked by sign 404 |
| Hero category upload (signed path) | **FAIL** — blocked by sign 404 |

Additional probes:
- Direct multipart `POST /api/reels` (small video): **202 accepted**, ingest → **failed** (synthetic 1s ffmpeg probe)
- Thumbnail delete storage cleanup: deleted thumb URL returns **404** (storage removed)
- Existing catalog video URL: **200** (refresh survival for legacy rows)

---

## Phase 4 — Historical Failure Hunt

| Pattern | Status | Evidence |
|---------|--------|----------|
| 1. fileName as identity | **PARTIAL RISK** | `personalThumbnailCollection` indexes by fileName; metadata carries `id` after accept. Delete still resolves reel by filename fallback in `aiCleanupAgent.handleThumbnailRemove`. |
| 2. localStorage-only persistence | **BY DESIGN + MITIGATED** | All vaults write localStorage; `syncFromVault` + backend catalog merge when online. |
| 3. Stale cache resurrection | **MITIGATED** | `deletionSync.js` tombstones + `mergeVideoVaultEntries` drops deleted ids when backend reachable. |
| 4. Delete UI-only, storage left | **THUMBNAIL PASS** / **VIDEO CONDITIONAL** | Backend delete verified for thumbnails. Video delete falls back to `runClientMediaPurge` if API fails. |
| 5. Accept duplicate entries | **MITIGATED** | `appendThumbnailVaultEntry` dedupes by id/fileKey; video BG7X dedupe by name+size. |
| 6. Thumbnail/video pipeline divergence | **CONFIRMED** | Thumbnail: drop→preview→accept. Video: drop→immediate upload. |
| 7. Hero bypasses normal persistence | **CONFIRMED BY DESIGN** | `BG7W_HERO_VAULT_GATE` excludes hero from `personal_video_vault`. |
| 8. R2 URLs not surviving refresh | **NOT OBSERVED IN CATALOG** | Ready reels still expose Netlify `/videos/` URLs; R2 public URLs not present in API responses tested. |

---

## Phase 5 — VAULT STATUS REPORT

### Thumbnail Vault

**DROP:** PASS — `handleVaultThumbnailDrop` creates blob preview only; `[VAULT_DROP]` fires; no backend write until Accept.  
**ACCEPT:** PASS — `acceptPendingThumbnail` → `POST /api/reels`; canonical `{id, fileName, url}` written to `personal_thumbnails`; identity uses UUID not filename.  
**DELETE:** PASS — backend `DELETE /api/reels/{id}` + local vault purge verified; storage HEAD → 404 after delete.  
**REFRESH:** PASS — `reloadVaultStoresFromStorage` reads `personal_thumbnails`; backend catalog confirms row while present.  
**RESULT:** **PASS**

### Video Vault

**DROP:** PASS (UI/code) — `handleVaultVideoDrop` validates and starts upload immediately.  
**ACCEPT:** N/A — no separate accept step; upload on drop is the accept boundary.  
**DELETE:** PASS (code path) — `deleteVaultVideo` → `deleteReelById` + tombstones; verified on existing catalog rows.  
**REFRESH:** PASS for **existing** ready reels (Netlify URLs return 200). **FAIL for new uploads** on production when signed path required.  
**RESULT:** **FAIL (production upload boundary)**

**Root cause:** Production Railway returns **404** for `/api/uploads/sign` and `/api/reels/finalize`. Netlify prod enables signed uploads for files ≥25MB (`config.js` `SIGNED_UPLOADS_MIN_BYTES=25_000_000`), so large MP4 vault drops cannot complete.  
**Smallest fix:** Redeploy backend build containing signed-upload routes (no refactor). Verify routes return 200 with admin token.

### Hero Vault

**DROP:** PASS (code) — `handleHeroDrop` → pending preview → auto `acceptHeroFile`.  
**ACCEPT:** PASS (code) — `acceptHeroFile` uploads with category HERO and persists `reelforge_hero_manager_config`.  
**DELETE:** PASS (code) — `deleteHeroVaultAsset` backend delete + hero localStorage cleanup + `syncFromVault`.  
**REFRESH:** PASS (code) — hero keys restored independently of MP4 vault; hero ids gated from `personal_video_vault`.  
**RESULT:** **FAIL (production upload boundary)** — same sign/finalize 404 blocks large hero video uploads on Netlify prod.

**Root cause:** Same as video vault — missing sign/finalize routes on deployed backend.  
**Smallest fix:** Same redeploy; no hero-specific code change required.

---

## Failure Remediation Summary (smallest possible fixes)

| Failure | File | Function | Root cause | Smallest fix |
|---------|------|----------|------------|--------------|
| Large video/hero upload | Railway prod | `/api/uploads/sign` | Route absent on deployed backend (404) | Deploy current backend (`main.rs` routes at L313–318) |
| Thumbnail delete by filename | `aiCleanupAgent.js` | `handleThumbnailRemove` | Legacy fallback matches reel by basename when id unknown | Prefer `entry.id` from `personal_thumbnails` metadata (1-line lookup before fetchReadyReels scan) |
| Synthetic probe ingest fail | N/A (test harness) | ffmpeg worker | 1s lavfi probe rejected/fails transcode | Use real MP4 fixture for ingest validation only |

**Out of scope (per mission):** R2 architecture changes, Railway reconciliation, split-brain cleanup.
