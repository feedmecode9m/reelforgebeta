# BG-6C — Hero Accept Execution Trace

**Mission:** READ-ONLY production Playwright trace — drop-only vs drop+Accept.  
**Target:** https://strong-lolly-a9fcb4.netlify.app  
**Artifact:** `artifacts/bg-6c-hero-accept-trace.json`  
**Script:** `scripts/mission-bg-6c-hero-accept-trace.mjs` (forensics only)  
**Run:** 2026-07-16T17:42:40Z  

---

## Classification

| Hypothesis | Verdict | Evidence |
|------------|---------|----------|
| **A — Accept never executed** | **CONFIRMED** (explains BG-6A / drop-only failure) | PATH A: 0 POST `/api/reels`, no storage writes, stage DOM unchanged |
| **B — Accept UI unreachable** | **REJECTED** | PATH A after drop: `acceptBtnVisible: true`, `acceptBtnDisabled: false`, text `"Accept"` |
| **C — Accept executes but state mutation fails** | **REJECTED** | PATH B: full chain through `saveHeroReel`, `saveHeroManagerConfig`, store + DOM update |
| **D — Accept succeeds but render ignores it** | **REJECTED** | PATH B: stage `<video>` src changed from `hero-background.mp4` → UUID mp4 |

---

## Root cause (one sentence)

Production Hero “failure” on drop-only is **user-interaction gap**: **`acceptHeroFile()` is never invoked without an Accept click**, so upload, persistence, and render promotion never run, while the stage hero correctly stays on `/videos/hero-background.mp4`.

---

## 1. Execution timeline

### PATH A — Drop only (mirrors BG-6A)

```
Drop on .hero-replace-section
  ↓ handleHeroDrop → handleHeroFileSelect
  ↓ heroPendingFile = { blob preview }     [HERO_FILE_SELECTED], [HERO_UX_STATE: idle→previewing]
  ✗ acceptHeroFile() NOT called
  ✗ uploadVideo() / createReel() NOT called
  ✗ saveHeroReel / saveHeroManagerConfig NOT called
  ↓ heroRenderVideo = $HERO_BACKGROUND_VIDEO = /videos/hero-background.mp4
  ↓ prioritizedHeroVideo = hero-background.mp4 (carousel/selection path)
  ↓ MediaRenderer stage src unchanged
```

### PATH B — Drop + Accept (full pipeline)

```
Drop
  ↓ heroPendingFile set, Accept visible
Accept click → acceptHeroFile()
  ↓ [HERO_ACCEPT stage: start]
  ↓ uploadVideo() → createReel() → POST /api/reels
  ↓ 202 pending → poll → [UPLOAD_SUCCESS] status: ready
  ↓ saveHeroReel → reelforge_hero_reel
  ↓ HERO_BACKGROUND_VIDEO.set(/videos/f3d26ccd…mp4)
  ↓ saveHeroManagerConfig → backgroundSource: custom_video, heroAssetId
  ↓ reelforge:hero-manager-updated
  ↓ [HERO_ACCEPT stage: complete]
  ↓ resolveHeroBackgroundPresentation → heroRenderVideo = UUID url
  ↓ activeHeroMediaMode = video
  ↓ MediaRenderer rerenders → stage src = UUID mp4
```

---

## 2. Before / after values

### PATH A — Drop only

| Signal | Before drop | After drop (no Accept) | Source | Consumer |
|--------|-------------|------------------------|--------|----------|
| `heroPendingFile` | `null` | `{ type: 'video', blob preview }` (console) | `handleHeroFileSelect` | drop-zone preview UI |
| `reelforge_hero_reel` | `null` | `null` | — | `resolveHeroBackgroundAsset` |
| `reelforge_hero_manager_config` | `null` | `null` | — | `heroBackgroundPresentation` |
| `backgroundSource` (DOM attr) | `selection` | `selection` | default / hydrate | render fork |
| `$HERO_BACKGROUND_VIDEO` | `/videos/hero-background.mp4` | `/videos/hero-background.mp4` | hydrate | `heroRenderVideo` |
| `heroRenderVideo` | `/videos/hero-background.mp4` | `/videos/hero-background.mp4` | `[RENDER_GATE][HERO]` | `prioritizedHeroVideo` |
| Stage `<video>` src | `…/hero-background.mp4` | `…/hero-background.mp4` | `MediaRenderer` | user-visible hero |
| Preview `<video>` | — | blob in drop-zone only | preview UI | **not** stage hero |
| Network POST `/api/reels` | — | **0** | — | — |
| Accept button | hidden | **visible, enabled** | DOM | user must click |

### PATH B — Drop + Accept

| Signal | After drop | After Accept | Source | Consumer |
|--------|------------|--------------|--------|----------|
| `heroPendingFile` | pending blob | `null` | `acceptHeroFile` clear | `heroUploadState: idle` |
| `reelforge_hero_reel` | `null` | `{ id: f3d26ccd-2fff-46b7-8c57-14a87242e350, url: /videos/…mp4 }` | `saveHeroReel` | vault + resolve |
| `backgroundSource` | `selection` | **`custom_video`** | `saveHeroManagerConfig` | presentation gate |
| `heroAssetId` | `""` | **`f3d26ccd-…`** | `saveHeroManagerConfig` | `resolveHeroBackgroundAsset` |
| `$HERO_BACKGROUND_VIDEO` | `/videos/hero-background.mp4` | **`/videos/f3d26ccd-…mp4`** | `HERO_BACKGROUND_VIDEO.set` | render fallback |
| `heroRenderVideo` | `/videos/hero-background.mp4` | **`/videos/f3d26ccd-…mp4`** | `[RENDER_GATE][HERO]` | `prioritizedHeroVideo` |
| `heroBackgroundPresentationVideoUrl` | `null` | **`/videos/f3d26ccd-…mp4`** | `resolveHeroBackgroundPresentation` | custom_video branch |
| `activeHeroMediaMode` | `video` | `video` | reactive gate | `{#if activeHeroMediaMode === 'video'}` |
| Stage `<video>` src | `…/hero-background.mp4` | **`…/f3d26ccd-…mp4`** | `MediaRenderer` | user-visible hero |
| POST `/api/reels` | — | **1** (202 → poll → ready) | `createReel` | `heroReelFromUploadResponse` |

**New reel ID (PATH B):** `f3d26ccd-2fff-46b7-8c57-14a87242e350`

---

## 3. Instrumentation answers (PATH B chain)

| Step | Executed? | Evidence |
|------|-----------|----------|
| `acceptHeroFile()` | **Yes** | `[HERO_ACCEPT] { stage: start }` → `{ stage: complete }` |
| Upload succeeded? | **Yes** | POST 202; `[UPLOAD_SUCCESS] { status: ready, url: /videos/f3d26ccd-…mp4 }` |
| `saveHeroManagerConfig()` | **Yes** | `[HERO_SAVE]`, `[HERO_STORE_WRITE]`, `[RENDER_GATE][HERO][CONFIG_SAVE]` |
| `backgroundSource → custom_video` | **Yes** | localStorage + DOM `data-hero-background-source="custom_video"` |
| `HERO_BACKGROUND_VIDEO` changed? | **Yes** | `[RENDER_GATE][HERO][STORE]` + gate log shows UUID path |
| `prioritizedHeroVideo` changed? | **Yes** (via presentation) | `heroRenderVideo` = UUID; stage DOM src = UUID |
| `MediaRenderer` rerendered? | **Yes** | `stageVideoSrc` before/after differ; `readyState: 4` |
| Stale config? | **No** | No `[HERO][STALE CONFIG DETECTED]` in PATH B |

---

## 4. First divergence

**PATH A (production failure mode):** First divergence is **immediately after drop** at the **`acceptHeroFile()` call site** — the Accept button is shown but **never clicked**, so the pipeline stops before `uploadVideo()`.

**Exact statement preventing rerender (PATH A):**

Drop path ends in `handleHeroFileSelect` (preview only). Stage render continues to use:

```javascript
heroRenderVideo = $HERO_BACKGROUND_VIDEO  // because backgroundSource !== 'custom_video'
```

No code path runs `saveHeroManagerConfig({ backgroundSource: 'custom_video' })` without Accept.

**PATH B:** No divergence — full chain completes; **first divergence = null**.

---

## 5. Console highlights

### PATH A (post-drop, no Accept)

- `[HERO_FILE_SELECTED] { fileName: bg6c-hero-…mp4 }`
- `[HERO_UX_STATE_CHANGE] { fromState: idle, toState: previewing }`
- `[RENDER_GATE][HERO] { backgroundSource: selection, heroRenderVideo: /videos/hero-background.mp4, pendingHero: { blob… } }`
- **Absent:** `[HERO_ACCEPT]`, `[UPLOAD_SUCCESS]`, `[HERO_REEL_SAVE]`

### PATH B (Accept)

- `[HERO_UX_STATE_CHANGE] previewing → processing → idle`
- `[HERO_ACCEPT] stage: start` @ 17:43:16.127Z
- `[HERO_CLASSIFY] createReel:request` + `[HERO_UPLOAD]`
- `[UPLOAD_SUCCESS] id: f3d26ccd-…` @ 17:43:18.795Z
- `[HERO_REEL_SAVE]`, `[HERO_STORE_WRITE]`
- `[RENDER_GATE][HERO][CONFIG_SAVE]`
- `[HERO_ACCEPT] stage: complete`

---

## 6. Network (PATH B)

| Time | Method | URL | Status | Body |
|------|--------|-----|--------|------|
| 17:43:16.193Z | POST | `/api/reels` | 202 | `{ id: f3d26ccd-…, status: pending }` |
| (poll) | GET | ingest status | — | → `ready` per `[UPLOAD_SUCCESS]` |

PATH A: **no network activity**.

---

## 7. Correlation with BG-6A

BG-6A automated hero phase **dropped only** (same as PATH A here):

- `localStorage.hero_reel: null` (script also checked wrong key `reelforge_hero_reel_identity`)
- DOM: `hero-background.mp4`
- **Did not click Accept**

BG-6C proves: **same drop-only behavior is expected**; **Accept is required** for replacement.

---

## 8. UX note (observational, not a fix)

After drop, preview appears **inside the replace-section drop zone**, not on the main stage hero. Stage video stays on default until Accept completes. Accept button is **reachable** in production (`visible: true`, `enabled: true`).

---

*BG-6C — evidence only. No application code modified.*
