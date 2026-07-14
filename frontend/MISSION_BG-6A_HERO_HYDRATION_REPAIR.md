# MISSION BG-6A — Hero Hydration Ordering Repair

Generated: 2026-07-14T06:03:00Z

## Original Race (BG-5D)

**Symptom:** After page refresh with a saved custom hero MP4, the first `HeroExperience` render gate observed stale `HERO_BACKGROUND_VIDEO`:

| Field | Expected | Observed (first render) |
|-------|----------|-------------------------|
| `HERO_BACKGROUND_VIDEO` (store) | `/videos/a4345328-0413-4626-98e9-d523f446d374.mp4` | `/videos/hero-background.mp4` |
| `heroRenderVideo` (presentation) | custom URL | custom URL (correct) |

**Root cause:** Bootstrap ordering in `viewerContext.js`.

```
createViewerContext()
  → HERO_BACKGROUND_VIDEO = writable(CONFIG.HERO_VIDEO_PATHS[0])   // default
  → return stores to Viewer.svelte
Viewer.svelte first render
  → HeroExperienceBridge mounts
  → HeroExperience render gate reads $HERO_BACKGROUND_VIDEO (stale default)
onMount (async, later)
  → mountViewer()
    → bootstrapMediaFromBackend()
    → hydrateHeroBackgroundStores()   // too late
    → HERO_BACKGROUND_VIDEO.set(customUrl)
```

The render gate executed **before** `hydrateHeroBackgroundStores()` completed. Presentation URL (`resolveHeroBackgroundPresentation`) read persisted config synchronously, but the store subscription still held the module-default placeholder.

Reconciliation occurred ~124 ms later when async hydration finished (BG-5D capture at `17:30:18.654Z` → `17:30:18.778Z`).

---

## Fix Applied (Option B)

**Approach:** Initialize `HERO_BACKGROUND_VIDEO` from persisted config **synchronously** at `createViewerContext()` time — before `Viewer.svelte` renders `HeroExperience`.

No duplicate source of truth: the same `hydrateHeroBackgroundStoresSync()` logic used by async `hydrateHeroBackgroundStores()` handles canonical reel, manager config, and legacy localStorage keys. Async hydration retains responsibility only for server-default HEAD probing when no persisted state exists.

---

## Changed Ordering

```
createViewerContext()
  → HERO_BACKGROUND_VIDEO = writable(CONFIG.HERO_VIDEO_PATHS[0])
  → hydrateHeroBackgroundStoresSync()          // NEW — synchronous
  → [HERO_HYDRATION] before/after logs
  → return stores (already hydrated)
Viewer.svelte first render
  → HeroExperience render gate reads hydrated $HERO_BACKGROUND_VIDEO ✓
onMount (async)
  → mountViewer()
    → hydrateHeroBackgroundStores()            // idempotent; HEAD probe if needed
    → [HERO_HYDRATION] before-async/after-async logs
```

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/lib/hero/heroIntelligence.js` | Extracted `hydrateHeroBackgroundStoresSync()`; async `hydrateHeroBackgroundStores()` delegates to sync first, then HEAD-probes defaults |
| `frontend/src/viewer/viewerContext.js` | Import sync hydrator; call at module-init inside `createViewerContext()`; add `[HERO_HYDRATION]` diagnostic logging at module-init and `mountViewer` |

**Not changed:** localStorage keys, persistence format, hero UI, upload pipeline, backend.

---

## Before / After Timeline

### Before (BG-5D reload)

| Time | Event | `HERO_BACKGROUND_VIDEO` |
|------|-------|-------------------------|
| T+0 ms | First `[RENDER_GATE][HERO]` | `/videos/hero-background.mp4` ✗ |
| T+0 ms | `heroRenderVideo` | `/videos/a4345328-…mp4` ✓ |
| T+124 ms | Second `[RENDER_GATE][HERO]` | `/videos/a4345328-…mp4` ✓ |

### After (BG-6A reload)

| Time | Event | `HERO_BACKGROUND_VIDEO` |
|------|-------|-------------------------|
| T+0 ms | `[HERO_HYDRATION] phase: before` | `/videos/hero-background.mp4` |
| T+0 ms | `[HERO_HYDRATION] phase: after` (module-init) | `/videos/a4345328-…mp4` ✓ |
| T+0 ms | First `[RENDER_GATE][HERO]` | `/videos/a4345328-…mp4` ✓ |
| T+0 ms | `heroRenderVideo` | `/videos/a4345328-…mp4` ✓ |

---

## Diagnostic Logging

Filter: `[HERO_HYDRATION]`

Emitted at:

1. **Module init** (`createViewerContext`) — `phase: before` / `phase: after`, `stage: module-init`
2. **mountViewer async pass** — `phase: before-async` / `phase: after-async`, `stage: mountViewer`

Each log includes:

- `HERO_BACKGROUND_VIDEO` (current store value)
- `hydrationCompleteTimestamp` (on `after` phases)
- `result` (sync/async hydrate outcome)

---

## Verification Results

### Build

```bash
cd frontend && npm run build
```

**Result:** ✓ built in 9.78s (exit 0)

### BG-5D Hero Test (automated refresh replay)

Seeded `reelforge_hero_manager_config` + `reelforge_hero_reel` with custom video `a4345328-0413-4626-98e9-d523f446d374`, reloaded page, captured console.

```
before hydration HERO_BACKGROUND_VIDEO: /videos/hero-background.mp4
after hydration HERO_BACKGROUND_VIDEO:  /videos/a4345328-0413-4626-98e9-d523f446d374.mp4
first gate HERO_BACKGROUND_VIDEO:       /videos/a4345328-0413-4626-98e9-d523f446d374.mp4
first gate heroRenderVideo:             /videos/a4345328-0413-4626-98e9-d523f446d374.mp4
stale default absent:                   PASS
store aligned on first render:          PASS
```

### Success Criteria

| Criterion | Status |
|-----------|--------|
| First render uses persisted custom hero video URL | ✓ |
| No stale `/videos/hero-background.mp4` during bootstrap render gate | ✓ |
| `[HERO_HYDRATION]` logs present with before/after values | ✓ |
| `[RENDER_GATE][HERO]` store and render aligned on first event | ✓ |
| `npm run build` passes | ✓ |

---

## Manual Re-test (BG-5D procedure)

1. Upload hero MP4 in Studio → Content
2. Save hero manager config (`custom_video`)
3. Refresh page
4. Console filters: `[RENDER_GATE][HERO]`, `[RENDER_GATE][HERO][STORE]`, `[HERO_HYDRATION]`
5. Confirm first `[RENDER_GATE][HERO]` shows matching `HERO_BACKGROUND_VIDEO` and `heroRenderVideo` with the saved custom URL
