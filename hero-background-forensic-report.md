# REELFORGE PHASE — HERO BACKGROUND VAULT FORENSIC AUDIT

Mode: FORENSIC ONLY (no fixes/refactors/features applied)

## STEP 1 — ENTRYPOINT DISCOVERY

Primary files and functions touching Hero manager/background/vault/media pipeline:

| File | Function(s) | Purpose |
|---|---|---|
| `frontend/src/components/studio/HeroManagerPanel.svelte` | `handleHeroAssetChange()`, `applyConfig()`, `refresh()`, `handleManagerUpdate()` | Hero Manager UI controls, selects `heroAssetId`, sets `backgroundSource`, applies manager config updates |
| `frontend/src/components/experiences/HeroExperience.svelte` | `handleHeroFileSelect()`, `acceptHeroFile()`, `rejectHeroFile()`, `queueHeroRenderDiagnostics()` | Hero upload preview/accept path, upload invocation, manager config write trigger, render diagnostics |
| `frontend/src/lib/hero/heroIntelligence.js` | `loadHeroManagerConfig()`, `saveHeroManagerConfig()`, `loadHeroVaultItems()`, `resolveHeroBackgroundAsset()`, `applyHeroManagerBackground()`, `resolveHeroBackgroundPresentation()`, `hasUserHeroOverride()`, `hydrateHeroBackgroundStores()` | Core Hero state persistence, shared vault reads, hero asset classification/resolution, background application/hydration |
| `frontend/src/lib/hero/heroAssetBridge.js` | `normalizeHeroAssetRecord()`, `buildHeroAssetRegistry()`, `resolveHeroAssetById()`, `isVideoHeroAssetType()` | Normalizes vault entries (video + thumbnail stores) into Hero asset registry and resolves selected asset |
| `frontend/src/viewer/viewerContext.js` | `syncFromVault()`, `reloadVaultStoresFromStorage()`, `handleHeroManagerUpdated()`, `applyHeroBackgroundFromIntelligence()` | Global sync/hydration, feed + vault fanout, Hero event handling, Hero background store wiring |
| `frontend/src/components/experiences/VaultExperience.svelte` | `acceptPendingThumbnail()`, `handleVaultVideoDrop()`, `batchDeleteThumbnails()`, `batchDeleteVideos()` | Shared vault ingest paths for images/videos; pushes into AI cleanup/feed pipeline |
| `frontend/src/lib/viewer/aiCleanupAgent.js` | `syncThumbnailsToFeed()`, `syncVideoVaultToFeed()`, `distributeThumbnailAcrossCategories()`, `distributeVideoToFeed()`, `handleThumbnailRemove()`, `deleteVaultVideo()` | Shared feed distribution, placeholder generation, vault delete flows |
| `frontend/src/lib/mediaBootstrap.js` | `ingestThumbReelsToVault()`, `reelsToVideoVaultEntries()` | Converts backend reels into thumbnail/video vault stores |
| `frontend/src/lib/api/media.js` | `uploadMedia()`, `createReel()`, `uploadThumbnail()`, `uploadVideo()` | Client upload router and `/api/reels` request path |
| `frontend/src/lib/wsReelEvents.js` | `connectReelEventSocket()` | WebSocket CREATED/DELETED events feeding sync pipeline |
| `frontend/src/components/experiences/StudioExperience.svelte` | `<HeroExperience section="replace" .../>`, `<HeroManagerPanel .../>` | Where Hero replace UI and Hero manager panel are mounted in Control Center |
| `backend/src/handlers.rs` | `create_reel()` | Backend entrypoint for `POST /api/reels` |
| `backend/src/ingestion/upload.rs` | `ingest_from_reel_multipart()`, `ingest_image_only()`, `ingest_video_bytes()` | Backend media classification (image/video) and storage writes (`/thumbs` vs `/videos`) |

---

## STEP 2 — ACCEPT BUTTON TRACE

[HERO_ACCEPT_TRACE]

### A) Hero background replace "Accept" button (actual Hero upload accept path)

UI:
- Button: `frontend/src/components/experiences/HeroExperience.svelte` (`.accept-btn`) -> `on:click={() => acceptHeroFile()}`

Event -> Handler:
- `acceptHeroFile()` reads `$heroPendingFile`
- For image: builds `FormData` with `formData.append('image', file)` and calls `uploadMedia(formData, authHeaders)`

Persistence:
- `uploadMedia()` -> `createReel()` -> `POST /api/reels` (`frontend/src/lib/api/media.js`)
- Backend `create_reel()` -> `ingest_from_reel_multipart()` -> `ingest_image_only()` for image fields (`backend/src/handlers.rs`, `backend/src/ingestion/upload.rs`)
- Image stored to `/thumbs/<uuid>.<ext>` and inserted as image reel
- Frontend then calls `syncFromVault(true)` and persists manager selection using `saveHeroManagerConfig({ backgroundSource: 'custom_image', heroAssetId, ... })`
- `saveHeroManagerConfig()` writes `reelforge_hero_manager_config` and dispatches `reelforge:hero-manager-updated`

Renderer:
- `HeroExperience` reactive `heroBackgroundPresentation = resolveHeroBackgroundPresentation(...)`
- `resolveHeroBackgroundAsset()` reads shared hero vault items from `personal_video_vault` + `personal_thumbnails`
- `applyHeroManagerBackground()` sets `HERO_POSTER_IMAGE`/`HERO_BACKGROUND_VIDEO`
- Render branch: image path uses `heroSlideImage` (`image-node`) when `backgroundSource === 'custom_image'`

### B) "Apply Hero Settings" in Hero Manager panel (not an "Accept" button)

UI:
- Button: `frontend/src/components/studio/HeroManagerPanel.svelte` -> `on:click={applyConfig}`

Event -> Handler:
- `applyConfig()` -> `updateHeroManagerConfig(config, feedReels)` -> `saveHeroManagerConfig(patch)`

Persistence:
- Writes only manager config (`reelforge_hero_manager_config`)
- Does **not** upload files and does **not** write to a dedicated hero-vault store

Renderer:
- Event `reelforge:hero-manager-updated` handled by viewer + HeroExperience; background reapplied from current config + shared vault state

Note on symptom #1:
- For Hero replace "Accept", confirmation is `uploadStatus` text update only (`✅ Hero image uploaded`) in replace panel state.
- For Hero Manager panel apply, confirmation is status text `Hero updated · ...` in `<p data-hero-manager-status>`.
- There is no dedicated success toast/modal for either path.

---

## STEP 3 — STORE AUDIT

[HERO_STORE_AUDIT]

| Store / Key | Writer(s) | Reader(s) | Delete/Clear | Sync source |
|---|---|---|---|---|
| Svelte store `heroPendingFile` | `handleHeroFileSelect()` | `acceptHeroFile()`, UI preview block | `rejectHeroFile()`, post-accept clear | local only |
| Local key `reelforge_hero_manager_config` | `saveHeroManagerConfig()` | `loadHeroManagerConfig()`, manager panel, viewer, HeroExperience | no dedicated delete path | updated by UI actions, event fanout |
| Local key `personal_thumbnails` | `ingestThumbReelsToVault()`, `storeThumbnailMetadata()`, thumbnail delete flows | `loadHeroVaultItems()`, `reloadVaultStoresFromStorage()`, AI cleanup | thumbnail delete / batch delete | `syncFromVault()` + API reels |
| Local key `personal_video_vault` | `persistPersonalVault()`, sync merge path | `loadHeroVaultItems()`, `reloadVaultStoresFromStorage()`, AI cleanup | video delete / batch delete | `syncFromVault()` + API reels |
| Svelte store `personalThumbnailCollection` | `reloadVaultStoresFromStorage()`, `acceptPendingThumbnail()` | Vault UI loop, sync logic | `AI_CLEANUP_AGENT.handleThumbnailRemove()`/batch | seeded from `personal_thumbnails` |
| Svelte store `personalVideos` | video upload drop path, `syncFromVault()` merge | Vault video UI, AI cleanup, hero registry indirectly | `AI_CLEANUP_AGENT.deleteVaultVideo()`/batch | seeded from `personal_video_vault` |
| Local key `reelforge_feed` | `syncFromVault()`, AI cleanup distribution | feed/discovery/search subsystems | purge/prune paths | sync + AI cleanup |
| Local key `reelforge_hero_video` | subscription on `HERO_BACKGROUND_VIDEO` | hydrate path (`hydrateHeroBackgroundStores`) | `clearHeroVideoStorage()` | hero store subscription |
| Local key `reelforge_hero_image` | subscription on `HERO_POSTER_IMAGE` | hydrate path (`hydrateHeroBackgroundStores`) | `clearHeroImageStorage()` | hero store subscription |

Hero-specific observation:
- No dedicated `heroBackgroundAssets` or `heroVault` store exists.
- Hero asset inventory is composed by reading shared media stores (`personal_video_vault` + `personal_thumbnails`) via `loadHeroVaultItems()`.

---

## STEP 4 — LOCALSTORAGE AUDIT

Hero/media keys involved:

| Key | Purpose | Writer | Reader |
|---|---|---|---|
| `reelforge_hero_manager_config` | Hero manager authoritative config (`backgroundSource`, `heroAssetId`, style, rotation) | `saveHeroManagerConfig()` | `loadHeroManagerConfig()`, manager panel, viewer, HeroExperience |
| `personal_thumbnails` | Shared thumbnail vault metadata | `ingestThumbReelsToVault()`, `storeThumbnailMetadata()`, delete flows | `loadHeroVaultItems()`, vault UI, AI cleanup |
| `personal_video_vault` | Shared video vault metadata | `persistPersonalVault()`, sync merge | `loadHeroVaultItems()`, vault UI, AI cleanup |
| `reelforge_feed` | Shared feed cache | `syncFromVault()`, AI cleanup distribution | feed/discovery/search systems |
| `reelforge_hero_video` | Legacy/custom hero video persisted URL | Hero video store subscription | `hydrateHeroBackgroundStores()`, `hasUserHeroOverride()` |
| `reelforge_hero_image` | Legacy/custom hero image persisted URL | Hero image store subscription | `hydrateHeroBackgroundStores()`, `hasUserHeroOverride()` |

Collision / overlap findings:
- Hero inventory **collides by design** with media vault keys:
  - `loadHeroVaultItems()` merges `personal_video_vault` and `personal_thumbnails`.
- Legacy hero keys (`reelforge_hero_video` / `reelforge_hero_image`) coexist with manager config (`reelforge_hero_manager_config`) and are still read during hydrate/override checks, creating multi-authority behavior.
- Thumbnail normalization in `reloadVaultStoresFromStorage()` allows retained URLs starting with `/videos/` for thumbnail entries, enabling cross-path placeholder display if malformed entries exist.

---

## STEP 5 — RENDER AUDIT

[HERO_RENDER_AUDIT]

Hero vault display loop:
- No dedicated Hero Vault visual grid/list loop exists.
- Hero Manager renders asset inventory only as select options:
  - `{#each heroAssetRegistry as item (item.assetId)}` in `HeroManagerPanel.svelte`
- Hero stage render uses resolved single background asset + carousel slides:
  - reactive `heroBackgroundPresentation = resolveHeroBackgroundPresentation(...)`
  - stage branches for video/image/fallback
  - carousel markers loop `{#each carouselSlides as slide, index (slide.id)}`

Derived/computed lists and filters:
- `heroAssetRegistry = buildHeroAssetRegistry(loadHeroVaultItems())`
- `loadHeroVaultItems()` returns `[...videos, ...normalizedThumbs].filter(Boolean)`
- Asset type inferred from URL/mime in `heroAssetBridge.inferAssetType()`

Sorting/filtering in Hero inventory:
- Registry dedupe by `assetId` only; no separation filter for "hero-only" assets
- No explicit image-only/video-only inventory sections in Hero panel

Runtime implication:
- User cannot inspect a dedicated "Hero Background Vault"; only a merged dropdown of shared vault assets is available.

---

## STEP 6 — SYNC AUDIT

[HERO_SYNC_AUDIT]

`syncFromVault()` flow:
1. Fetches `/api/reels`
2. `ingestThumbReelsToVault(rawData, personal_thumbnails)`
3. `reloadVaultStoresFromStorage()` -> updates `personalThumbnailCollection` and `personalVideos`
4. Merges backend videos into `personal_video_vault`
5. Calls `AI_CLEANUP_AGENT.syncThumbnailsToFeed()` and, in several paths, `syncVideoVaultToFeed()`

Event paths:
- `saveHeroManagerConfig()` dispatches `reelforge:hero-manager-updated`
  - consumed by `HeroExperience` and `viewerContext` to reapply hero background
- WebSocket CREATED:
  - `connectReelEventSocket(... onCreated ...)` in `viewerContext`
  - dispatches `reelforge:upload-updated`
  - then calls `syncFromVault(true)`
- `reelforge:upload-updated` is consumed by discovery/search engines (reindex/refresh), not by a hero-isolated sync path

Overwrite risk findings:
- Hero background state can be influenced by multiple authorities:
  - manager config key
  - legacy `reelforge_hero_video` / `reelforge_hero_image`
  - shared vault rehydration and asset registry rebuild
- `hydrateHeroBackgroundStores()` checks legacy hero keys before manager config fallback path, contributing to persistence inconsistency when keys diverge.

---

## STEP 7 — HERO / VIDEO CROSS-CONTAMINATION AUDIT

[HERO_CROSS_CONTAMINATION]

### Does Hero image enter `personalVideos` / video vault?
- Evidence from code path:
  - Hero image upload sends `image` field
  - backend `ingest_image_only()` writes `/thumbs/*` and image reel
  - `reelsToVideoVaultEntries()` includes only `isVideoReel(reel)`
- Result: direct image -> `personalVideos` insertion path not present in audited flow.

### Does Hero image enter placeholder generation?
- Yes, via shared thumbnail sync path:
  - `syncFromVault()` -> `ingestThumbReelsToVault()` -> `AI_CLEANUP_AGENT.syncThumbnailsToFeed()`
  - `syncThumbnailsToFeed()` creates `isPlaceholder` reels from every thumbnail entry
- This includes hero-uploaded images because they are persisted in shared `personal_thumbnails`.

### Does Hero image enter feed category insertion?
- Yes, through placeholder creation from `syncThumbnailsToFeed()` and direct thumbnail distribution paths.

### Does Hero image enter AI cleanup agent?
- Yes, indirectly as thumbnail entries consumed by `syncThumbnailsToFeed()`.

### Does Hero image enter video distribution?
- No direct hero-image -> `distributeVideoToFeed()` path found.
- `distributeVideoToFeed()` is fed by `personal_video_vault` entries only.

### Cross-path risk evidence
- `loadHeroVaultItems()` merges thumbnail + video vault into one Hero registry.
- `reloadVaultStoresFromStorage()` allows thumbnail URLs that already start with `/videos/` to remain unchanged, enabling path-type bleed into placeholder display when such records exist.

---

## STEP 8 — VISUAL INVENTORY AUDIT

[HERO_VISIBILITY_AUDIT]

Can UI display:

- Total Hero Images: **No dedicated metric**
- Total Hero Videos: **No dedicated metric**
- Current Hero Asset: **Partial** (selected option in Hero Manager dropdown by `config.heroAssetId`)
- Active Hero Asset: **Partial** (stage data attrs include background asset/source; no explicit inspector panel)
- Pending Hero Asset: **Yes** (Hero replace preview uses `$heroPendingFile` until accept/reject)

Missing UI capability (evidence-backed):
- No dedicated Hero Vault grid/list/card UI exists.
- No per-type Hero inventory counters.
- No explicit "active asset details" panel showing resolved asset id/type/source/render target.

---

## ROOT CAUSES (Evidence-backed)

### ROOT CAUSE 1 — No isolated Hero vault store; Hero consumes merged shared vault stores

Evidence:
- `loadHeroVaultItems()` reads both `personal_video_vault` and `personal_thumbnails` and merges.
- Hero Manager asset selector uses this merged registry (`buildHeroAssetRegistry(loadHeroVaultItems())`).

Files / Functions:
- `frontend/src/lib/hero/heroIntelligence.js` -> `loadHeroVaultItems()`
- `frontend/src/components/studio/HeroManagerPanel.svelte` -> reactive `heroAssetRegistry`

Runtime impact:
- Hero asset inventory appears merged with general media vault logic.
- Users cannot inspect Hero-only assets separately.

### ROOT CAUSE 2 — Shared thumbnail sync automatically creates feed placeholders for Hero-uploaded images

Evidence:
- Hero image upload persists to shared `/thumbs` reel path, then `syncFromVault()` ingests thumbnails.
- `AI_CLEANUP_AGENT.syncThumbnailsToFeed()` creates placeholders for all thumbnail entries.

Files / Functions:
- `frontend/src/components/experiences/HeroExperience.svelte` -> `acceptHeroFile()`
- `frontend/src/viewer/viewerContext.js` -> `syncFromVault()`
- `frontend/src/lib/viewer/aiCleanupAgent.js` -> `syncThumbnailsToFeed()`
- `backend/src/ingestion/upload.rs` -> `ingest_image_only()`

Runtime impact:
- Hero images later surface in placeholder/feed paths, interpreted as cross-contamination.

### ROOT CAUSE 3 — Multi-authority Hero persistence (manager config + legacy hero keys)

Evidence:
- Manager config persisted in `reelforge_hero_manager_config`.
- Legacy keys `reelforge_hero_video` / `reelforge_hero_image` are still persisted/read and consulted by hydrate/override logic.
- Hydration path checks persisted hero keys and manager config in sequence.

Files / Functions:
- `frontend/src/lib/hero/heroIntelligence.js` -> `saveHeroManagerConfig()`, `hasUserHeroOverride()`, `hydrateHeroBackgroundStores()`
- `frontend/src/viewer/viewerContext.js` -> hero store subscriptions and local key persistence

Runtime impact:
- Hero background persistence can feel unreliable when keys diverge or stale values survive.

### ROOT CAUSE 4 — Confirmation UX is text-state only, no explicit commit/receipt visualization

Evidence:
- Hero replace accept updates `uploadStatus` text and clears pending file.
- Hero manager apply sets `statusMessage` string only.

Files / Functions:
- `frontend/src/components/experiences/HeroExperience.svelte` -> `acceptHeroFile()`
- `frontend/src/components/studio/HeroManagerPanel.svelte` -> `applyConfig()`

Runtime impact:
- Users can perceive “Accept did nothing” without strong visual confirmation artifacts.

---

## STEP 10 — FIX PLAN (DO NOT IMPLEMENT)

### Minimal Fix Plan (lowest change)
1. Add explicit post-accept confirmation surface in Hero replace panel (asset id/type + resolved source).
2. Add Hero Manager mini-inspector showing current `heroAssetId`, resolved URL, resolved type, render branch.
3. Add strict thumbnail URL validation before placeholder creation in `syncThumbnailsToFeed()` to prevent `/videos/` path bleed.

Risk: Low; mostly visibility and guardrails, minimal flow changes.

### Safe Fix Plan (moderate change)
1. Introduce read-only Hero inventory view derived from shared stores but filtered/tagged by Hero assignment usage.
2. Add deterministic precedence policy for persistence reads (manager config first, legacy keys second) and emit conflict diagnostics when diverged.
3. Add explicit Hero assignment event payload including resolved asset metadata to support debug/telemetry.

Risk: Medium; touches persistence ordering and diagnostics semantics.

### Recommended Fix Plan (highest correctness, higher change)
1. Create true Hero vault namespace (separate key/store and render inventory) with explicit assignment metadata.
2. Separate Hero upload ingest intent from general thumbnail vault ingest so Hero assets are not implicitly fed into placeholder generation.
3. Keep compatibility bridge for legacy shared vault references, but enforce clear ownership boundaries and migration path.

Risk: Higher; architectural boundary changes and migration concerns.

