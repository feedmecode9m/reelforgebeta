# Viewer Decomposition Regression Audit

## Files inspected

- `frontend/src/Viewer.svelte`
- `frontend/src/components/viewer/FeedExperienceBridge.svelte`
- `frontend/src/components/viewer/HeroExperienceBridge.svelte`
- `frontend/src/components/viewer/StudioLauncher.svelte`
- `frontend/src/viewer/viewerContext.js`
- `frontend/src/components/experiences/VaultExperience.svelte`

## Checks performed

1. Double mounting
   - `Viewer.svelte` mounts once, bridges are pass-through wrappers.
   - No duplicate bridge mount logic found.

2. Double initialization
   - `createViewerContext()` invoked once at module instance creation.
   - `mountViewer()` called once in `onMount`.
   - No second explicit call in bridge chain.

3. Duplicate event listeners
   - Listener setup centralized in `mountViewer()`.
   - Cleanup path removes listeners via `resourceManager.clearAll()` and returned cleanup callback.
   - No direct duplicate listener registration loop identified.

4. Duplicate store hydration
   - Confirmed:
     - immediate insert path (vault component)
     - sync hydration path (`syncFromVault` + bootstrap/reload)
   - This is the duplication vector under non-canonical identity keys.

## Regression verdict

- Viewer decomposition wrappers (`FeedExperienceBridge`, `HeroExperienceBridge`, `StudioLauncher`) are not the primary duplication trigger.
- Primary regression is identity normalization/dedupe across insertion + hydration paths in vault/store utilities.
