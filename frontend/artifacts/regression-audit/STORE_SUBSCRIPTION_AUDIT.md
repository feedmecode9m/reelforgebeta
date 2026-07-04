# Store Subscription Audit

## Scope

- File inspected: `frontend/src/viewer/viewerContext.js`
- Goal: detect duplicate subscriptions / repeated initialization causing multi-insert behavior.

## Subscription points found

Emitted logical `[STORE_SUBSCRIBE]` map (by code location):

1. `feed.subscribe(...)`
   - Location: around `viewerContext.js` feed persistence block
   - Purpose: persist feed to `reelforge_feed`
2. `HERO_BACKGROUND_VIDEO.subscribe(...)`
   - Location: inside `mountViewer()`
   - Purpose: persist hero video key
3. `HERO_POSTER_IMAGE.subscribe(...)`
   - Location: inside `mountViewer()`
   - Purpose: persist hero image key
4. `personalVideos.subscribe(...)`
   - Location: inside `mountViewer()`
   - Purpose: persist `personal_video_vault`

## Mount lifecycle check

- `Viewer.svelte` creates context once: `const ctx = createViewerContext();`
- `Viewer.svelte` calls `mountViewer()` once in `onMount`.
- `cleanupMount()` + `destroyViewer()` run in `onDestroy`.
- No evidence of double-mount loop in this component lifecycle.

## Duplicate subscription finding

- No duplicate `subscribe(...)` registration for the same store in a single mount path.
- Regression source is not repeated subscription registration.

## Actual duplication mechanism (cross-confirmed)

- Duplicates came from *multiple insertion sources* (immediate insert + sync hydration) with non-canonical keys, not from multiple store subscribers.
