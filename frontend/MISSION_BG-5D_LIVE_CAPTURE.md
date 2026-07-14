# MISSION BG-5D — Live Render Gate Capture

Generated: 2026-07-13T17:30:00Z (local dev, `http://127.0.0.1:5173/`)

Capture artifact: `frontend/artifacts/bg-5d-live-capture.json`  
Capture script: `frontend/scripts/mission-bg-5d-live-capture.mjs`

Console filter: `[RENDER_GATE]`

---

## Vault Timeline

**DROP timestamp:** `2026-07-13T17:30:00.833Z`  
File: `bg5d-vault-1783963800834.mp4` (6903-byte valid MP4, `hero-background.mp4` bytes)

**POST result:** HTTP **202** at `2026-07-13T17:26:01.101Z` → reel `be1aac84-8509-4248-9315-0e3c52852adf`  
(`videoUrl`: `/videos/be1aac84-8509-4248-9315-0e3c52852adf.mp4`, initial `status`: `processing`)

**STORE update:** `[RENDER_GATE][VAULT][STORE]` at `2026-07-13T17:30:02.350Z`  
- `oldLength`: 2 → `newLength`: 3  
- `idsAdded`: `["be1aac84-8509-4248-9315-0e3c52852adf"]`  
- `urlsAdded`: `["/videos/be1aac84-8509-4248-9315-0e3c52852adf.mp4"]`  
- Stack: `VaultExperience.handleVaultVideoDrop` → `personalVideos.update`

**personalVideos value (new entry):**

| Field | Value |
|-------|-------|
| id | `be1aac84-8509-4248-9315-0e3c52852adf` |
| fileName | `be1aac84-8509-4248-9315-0e3c52852adf.mp4` |
| url | `/videos/be1aac84-8509-4248-9315-0e3c52852adf.mp4` |
| type | `video/mp4` |

**isVideo result:** `true` (`isVideo(reel)` and `isVideoReel(reel)` both `true`)

**render gate decision:** `media_renderer` (not placeholder)

**Sequence observed (post-drop window):**

1. `[RENDER_GATE][VAULT][STORE]` — store gains new id/url  
2. `[RENDER_GATE][VAULT]` — index 0, `renderBranchSelected: "media_renderer"`  
3. `[RENDER_GATE][MEDIA]` — `event: mounted`, `src: /videos/be1aac84-8509-4248-9315-0e3c52852adf.mp4`

**Vault note:** No `[RENDER_GATE][VAULT][PLACEHOLDER]` emitted for this upload. Stored identity and rendered identity **matched** within ~10 ms of store write.

---

## Hero Timeline

**CONFIG_SAVE:** `[RENDER_GATE][HERO][CONFIG_SAVE]` at `2026-07-13T17:30:14.894Z`

| Field | Value |
|-------|-------|
| backgroundSource | `custom_video` |
| heroAssetId | `a4345328-0413-4626-98e9-d523f446d374` |
| backgroundStyle | `video` |

**Pre-save processing window** (`17:30:12.537Z`): `heroUploadProcessing: true`, store and render both still `/videos/hero-background.mp4` — no divergence during ingest.

**STORE update:** `[RENDER_GATE][HERO][STORE]` at `2026-07-13T17:30:14.889Z`  
- `oldValue`: `/videos/hero-background.mp4`  
- `newValue`: `/videos/a4345328-0413-4626-98e9-d523f446d374.mp4`  
- Stack: `acceptHeroFile` → `HERO_BACKGROUND_VIDEO.set`

**Post-save (same session):** `[RENDER_GATE][HERO]` shows aligned values — `heroRenderVideo` and `HERO_BACKGROUND_VIDEO` both `/videos/a4345328-0413-4626-98e9-d523f446d374.mp4`, `backgroundSource: custom_video`, `activeHeroMediaMode: video`.

**After page refresh** (first `[RENDER_GATE][HERO]` at `2026-07-13T17:30:18.654Z`):

| Field | Value |
|-------|-------|
| backgroundSource | `custom_video` |
| heroUsesImageBackground | `false` |
| heroRenderVideo | `/videos/a4345328-0413-4626-98e9-d523f446d374.mp4` |
| activeHeroMediaMode | `video` |
| store value (`HERO_BACKGROUND_VIDEO`) | `/videos/hero-background.mp4` |
| render decision | Render gate selects **custom_video presentation URL** (`heroRenderVideo` from `heroBackgroundPresentation.videoUrl`), **not** the stale store subscription |

**Reconciliation:** By `17:30:18.778Z` (~124 ms later), `[RENDER_GATE][HERO]` shows store and render both `/videos/a4345328-0413-4626-98e9-d523f446d374.mp4`.

**Hero `[RENDER_GATE][HERO][STORE]` after reload:** No new-value event in the reload window (store was already written pre-reload; bootstrap re-hydrates without a logged change in the capture window).

---

## First Incorrect Value

This is the **first timestamp** where stored media identity and rendered media identity **diverge** in the live capture.

| | |
|--|--|
| **Variable** | `$HERO_BACKGROUND_VIDEO` (store subscription value logged as `HERO_BACKGROUND_VIDEO`) |
| **Component** | `HeroExperience` (render gate pre-log via `logHeroRenderGatePre`) |
| **File** | `frontend/src/components/experiences/HeroExperience.svelte` |
| **Line** | **154** (gate log reads `$HERO_BACKGROUND_VIDEO`); divergence visible in reactive gate at **165–171** (`heroRenderVideo` vs `$HERO_BACKGROUND_VIDEO`) |
| **Expected** | `/videos/a4345328-0413-4626-98e9-d523f446d374.mp4` (matches persisted `reelforge_hero_manager_config` / `custom_video` asset saved at CONFIG_SAVE) |
| **Observed** | `/videos/hero-background.mp4` |
| **Mutation location** | Viewer bootstrap: `HERO_BACKGROUND_VIDEO` still holds pre-hydration default when the first post-reload render gate fires (`viewerContext.js` `mountViewer` / `hydrateHeroBackgroundStores` ordering). Render path reads `heroBackgroundPresentation.videoUrl` from persisted config **before** the store subscription reflects the saved hero video URL. |

**Contrast at same timestamp:**

- `heroRenderVideo` (render identity): `/videos/a4345328-0413-4626-98e9-d523f446d374.mp4` ✓  
- `HERO_BACKGROUND_VIDEO` (store identity): `/videos/hero-background.mp4` ✗  

**Vault path:** No store/render identity divergence captured for the successful vault upload in this run.

---

## Capture Environment

- Frontend: Vite dev `127.0.0.1:5173`
- Backend: `127.0.0.1:8080` (health 200)
- Vault test file: valid 6903-byte MP4 (required; 2276-byte sample failed ingest with `ffmpeg produced no output file`)
- Hero test file: `hero-background.mp4`
- Total `[RENDER_GATE]` events captured: **71**

Raw structured logs: `frontend/artifacts/bg-5d-live-capture.json`
