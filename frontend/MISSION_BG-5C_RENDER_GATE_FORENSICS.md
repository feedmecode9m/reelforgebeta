# MISSION BG-5C — Render Gate State Forensics

**Date:** 2026-07-13  
**Scope:** Diagnostics only — logging at render gates; no behavior, store, or upload changes  
**Build:** `npm run build` ✅

---

## Executive Summary

BG-5B proved upload + ingest + store updates can succeed while UI stays on placeholders. BG-5C instruments **only the render decision variables** to prove which value is wrong at gate time.

**Filter:** `[RENDER_GATE]` in browser console.

---

## Instrumentation Map

| Part | Location | Log prefix |
|------|----------|------------|
| 1–2 | `VaultExperience.svelte` ~1567–1612 | `[RENDER_GATE][VAULT]`, `[RENDER_GATE][VAULT][PLACEHOLDER]` |
| 3 | `MediaRenderer.svelte` | `[RENDER_GATE][MEDIA]` |
| 4–5 | `HeroExperience.svelte` ~131–330, ~1226 | `[RENDER_GATE][HERO]`, `[RENDER_GATE][HERO][CONFIG_SAVE]`, `[RENDER_GATE][HERO][STALE CONFIG DETECTED]` |
| 6 | `viewerContext.js` ~1567 | `[RENDER_GATE][HERO][STORE]` |
| 7 | `viewerContext.js` ~1604 | `[RENDER_GATE][VAULT][STORE]` |
| Helper | `renderGateForensics.js` | All `[RENDER_GATE]*` formatters |

---

## PART 1 — Vault Render Gate

**File:** `VaultExperience.svelte`  
**Gate line:** **1585** `{#if isVideo(reel) && reel.url}`

Logged immediately before gate (via `{@const}` at line **1567**):

```
[RENDER_GATE][VAULT]
  id, name, type, mime, url, thumbnailPath, status
  isVideo(reel)          → isVideoReel wrapper
  isVideoReel(reel)      → url must include /videos/ or video extension
  Boolean(reel.url)
  Boolean(reel.thumbnailPath)
  renderBranchSelected   → "media_renderer" | "placeholder"
  videoRaw, reelResolved (full objects)
```

---

## PART 2 — Vault Placeholder Branch

**File:** `VaultExperience.svelte`  
**Line:** **1610–1612** `{:else}` branch

```
[RENDER_GATE][VAULT][PLACEHOLDER]
  reelFull   → full resolved reel from getVaultVideoReel()
  videoFull  → full personalVideos entry
```

---

## PART 3 — MediaRenderer

**File:** `MediaRenderer.svelte`

Events logged (parent handlers preserved via `createEventDispatcher`):

| Event | Fields |
|-------|--------|
| `mounted` | src, resolvedSrc, mediaType |
| `loadedmetadata` | readyState, networkState, videoWidth, videoHeight, currentSrc |
| `loadeddata` | same |
| `error` | errorCode, errorMessage, currentSrc |

Prefix: `[RENDER_GATE][MEDIA]`

If gate selects `media_renderer` but `[MEDIA] error` appears → URL/load failure after gate passed.

If no `[MEDIA] mounted` → gate never selected video branch (or `resolvedSrc` empty inside MediaRenderer line 130).

---

## PART 4 — Hero Render Gate

**File:** `HeroExperience.svelte`  
**Gate inputs logged before `heroRenderVideo` (lines ~131–155) and after `activeHeroMediaMode` computed (~293–320)**

```
[RENDER_GATE][HERO]
  heroManagerConfig              ← in-memory object (line 65 init)
  heroManagerConfigPersisted     ← loadHeroManagerConfig() from localStorage
  heroUsesImageBackground
  backgroundSource
  heroRenderVideo                ← computed value used for render
  activeHeroMediaMode            ← 'video' | 'image' | 'fallback'
  HERO_BACKGROUND_VIDEO          ← store value
  pendingHero, heroUploadState, heroUploadProcessing
  prioritizedHeroVideo
  heroBackgroundPresentationVideoUrl
```

**Render gate chain:**

| Step | Line | Condition |
|------|------|-----------|
| `heroRenderVideo` | 160–166 | `heroUsesImageBackground ? '' : $HERO_BACKGROUND_VIDEO` when not custom_video+videoUrl |
| `prioritizedHeroVideo` | 231–233 | carousel vs render priority |
| `activeHeroMediaMode` | 314–320 | `'video'` only if `prioritizedHeroVideo` truthy |
| DOM video mount | ~1395 | `{#if activeHeroMediaMode === 'video'}` |

---

## PART 5 — Stale Hero Config Detection

**After `saveHeroManagerConfig()`** in `acceptHeroFile()` (lines ~1226, ~1284):

```
[RENDER_GATE][HERO][CONFIG_SAVE]
  savedObject          ← loadHeroManagerConfig() after save
  inMemoryObject       ← heroManagerConfig variable (unchanged)
```

If differ → `[RENDER_GATE][HERO][STALE CONFIG DETECTED]`

**Before each render cycle** (reactive block ~308–318): compares in-memory vs persisted; logs STALE if `backgroundSource` or `heroAssetId` mismatch.

---

## PART 6 — HERO_BACKGROUND_VIDEO Store

**File:** `viewerContext.js` ~1567

```
[RENDER_GATE][HERO][STORE]
  oldValue, newValue
  stackTrace
```

---

## PART 7 — personalVideos Store

**File:** `viewerContext.js` ~1604

```
[RENDER_GATE][VAULT][STORE]
  oldLength, newLength
  idsAdded, urlsAdded
  stackTrace
```

---

## PART 8 — Full Timeline & First Incorrect Value

```text
DROP
  [PIPELINE] DROP_RECEIVED

POST
  [PIPELINE] POST_API_REELS → POST_COMPLETED (202)

READY
  [REEL_RES] pollIngestionUntilReady EXIT result=ready
  [PIPELINE] EVENT_EMITTED (backend)

STORE UPDATE
  [REEL_RES] STORE personalVideos  OR  [RENDER_GATE][HERO][STORE] HERO_BACKGROUND_VIDEO
  [RENDER_GATE][VAULT][STORE] idsAdded, urlsAdded

WEBSOCKET
  [REEL_RES] WebSocket:rawPayload eventType=CREATED
  syncFromVault (no direct render gate effect)

REACTIVE STORE
  Svelte re-run → heroRenderVideo / personalVideos each()

RENDER GATE  ◄── FIRST INCORRECT VALUE TYPICALLY HERE
  [RENDER_GATE][VAULT] or [RENDER_GATE][HERO]

MEDIA COMPONENT
  [RENDER_GATE][MEDIA] mounted  (only if gate passed)

loadedmetadata
  [RENDER_GATE][MEDIA] loadedmetadata  (only if video element mounted)
```

---

## Forensic Verdict — First Incorrect Value (Static + BG-5B)

### Vault (▶ placeholder)

| Field | Expected | Observed (typical failure) | File | Line |
|-------|----------|----------------------------|------|------|
| **`isVideo(reel)`** | `true` for MP4 upload | **`false`** when `reel.url` is `""` or `/thumbs/...` without `/videos/` | `VaultExperience.svelte` | **1585** |
| **`reel.url`** | `/videos/{uuid}.mp4` (non-empty) | **`""`** or thumb-only path | `getVaultVideoReel` → `vaultUtils.js` ~280 | derived from `video.url` |
| **`renderBranchSelected`** | `media_renderer` | **`placeholder`** | `VaultExperience.svelte` | **1585** → **1610** |

**Exact reason rendering stopped:** Gate condition `isVideo(reel) && reel.url` is false → `MediaRenderer` never instantiated → no `[MEDIA] mounted`.

**Confirm with logs:** `[RENDER_GATE][VAULT]` shows `'isVideo(reel)': false` OR `'Boolean(reel.url)': false` → then `[RENDER_GATE][VAULT][PLACEHOLDER]` with full `reelFull`.

---

### Hero (fallback / no canonical video)

| Field | Expected after video accept | Observed (typical failure) | File | Line |
|-------|----------------------------|----------------------------|------|------|
| **`heroManagerConfig.backgroundSource`** | `custom_video` | **`custom_image`** (stale in-memory) | `HeroExperience.svelte` | **65** (init), not refreshed after save |
| **`heroManagerConfigPersisted.backgroundSource`** | `custom_video` | `custom_video` (localStorage correct) | `loadHeroManagerConfig()` | — |
| **`heroUsesImageBackground`** | `false` | **`true`** (stale config + imageUrl present) | `HeroExperience.svelte` | **167–169** |
| **`heroRenderVideo`** | canonical `/videos/...` | **`""`** (empty string) | `HeroExperience.svelte` | **174–175** |
| **`activeHeroMediaMode`** | `video` | **`image`** or **`fallback`** | `HeroExperience.svelte` | **314–320** |

**Exact reason rendering stopped:** At line **174–175**, `heroUsesImageBackground ? ''` forces `heroRenderVideo = ''` because in-memory `heroManagerConfig` still has `backgroundSource: 'custom_image'` while localStorage was updated to `custom_video`.

**Confirm with logs:**
1. `[RENDER_GATE][HERO][CONFIG_SAVE]` → savedObject.backgroundSource = `custom_video`, inMemoryObject.backgroundSource = `custom_image`
2. `[RENDER_GATE][HERO][STALE CONFIG DETECTED]`
3. `[RENDER_GATE][HERO]` → `heroRenderVideo: ""` but `HERO_BACKGROUND_VIDEO: "/videos/..."`
4. No `[RENDER_GATE][MEDIA] mounted` for hero video

---

## Expected vs Observed — Single-Line Answers

### Vault

| | |
|---|---|
| **First incorrect value** | `isVideo(reel) === false` OR `reel.url === ""` |
| **File** | `VaultExperience.svelte` |
| **Function** | template gate / `getVaultVideoReel` + `isVideoReel` |
| **Line** | **1585** (`{#if isVideo(reel) && reel.url}`) |
| **Object** | `reel` from `getVaultVideoReel(video)` |
| **Expected** | `{ url: "/videos/{id}.mp4", type: "video" }` |
| **Observed** | `{ url: "", type: "video/mp4" }` or url under `/thumbs/` |
| **Why rendering stopped** | Boolean gate false → placeholder branch |

### Hero

| | |
|---|---|
| **First incorrect value** | `heroUsesImageBackground === true` (causing `heroRenderVideo === ""`) |
| **File** | `HeroExperience.svelte` |
| **Function** | reactive `$: heroRenderVideo` |
| **Line** | **174–175** (`heroUsesImageBackground ? ''`) |
| **Object** | in-memory `heroManagerConfig` |
| **Expected** | `{ backgroundSource: "custom_video", heroAssetId: "<reelId>" }` |
| **Observed** | `{ backgroundSource: "custom_image", ... }` (stale) while store has new video URL |
| **Why rendering stopped** | Empty `heroRenderVideo` → `activeHeroMediaMode !== 'video'` → no hero `<MediaRenderer>` |

---

## Operator Procedure

1. Hard refresh, open DevTools console, filter `[RENDER_GATE]`.
2. Upload one MP4 to **Vault** and one to **Hero**.
3. For each upload, capture logs in order through the timeline above.
4. Find the **first log where Expected ≠ Observed** in the tables above.

**Vault success signature:**
```
[RENDER_GATE][VAULT] renderBranchSelected: "media_renderer"
[RENDER_GATE][MEDIA] event: "mounted"
[RENDER_GATE][MEDIA] event: "loadedmetadata"
```

**Hero success signature:**
```
[RENDER_GATE][HERO] heroRenderVideo: "/videos/..."
[RENDER_GATE][HERO] activeHeroMediaMode: "video"
[RENDER_GATE][MEDIA] event: "mounted"
[RENDER_GATE][MEDIA] event: "loadedmetadata"
```

---

## No Repairs Applied

This mission adds **console instrumentation only**. No gate conditions, stores, uploads, or rendering logic were modified.
