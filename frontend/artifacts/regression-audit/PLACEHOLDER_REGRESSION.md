# Placeholder Regression Analysis

## Components checked

- `frontend/src/components/experiences/VaultExperience.svelte`
- `frontend/src/lib/viewer/vaultUtils.js`
- `frontend/src/components/experiences/StudioExperience.svelte`
- `frontend/src/components/viewer/StudioLauncher.svelte`
- `frontend/src/Viewer.svelte`

## What regressed

In `vaultUtils.handleVaultMediaError(...)` the fallback creation branch was gated by:

- `if (kind === 'video' && card) { ... create .video-placeholder ... }`

That means failed thumbnail loads (`kind='thumbnail'`) had:

- image hidden + `src` removed
- **no guaranteed thumbnail fallback element inserted**

Result: empty/blank vault slot instead of visible placeholder.

## Viewer decomposition commit comparison

- `git log --follow` for `VaultExperience.svelte` and `vaultUtils.js` returns no tracked history in this repository state (both currently untracked paths), so an exact commit hash for first regression introduction is not recoverable from local git metadata.
- For tracked ancestor surfaces (`Viewer.svelte`) history exists, but not for the extracted vault utility file where the placeholder branch logic currently lives.

## Evidence summary

- Runtime `[VAULT_RENDER]` shows cards with `thumbnailUrl: null` and placeholder dependence.
- Code-level branch asymmetry (`video` placeholder insertion only) explains disappearance of visible placeholder for image error paths.

## Determination

- Regression location is confirmed at function level (`handleVaultMediaError`) in `frontend/src/lib/viewer/vaultUtils.js`.
- Commit attribution is blocked by missing tracked history for that extracted file in this workspace snapshot.
