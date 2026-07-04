# Patch Diff (Applied)

## Files changed

1. `frontend/src/lib/storage.js`
   - Function: `stripHeavyThumbnailEntries(...)`
   - Change: dedupe thumbnail metadata by canonical URL (fallback name key).

2. `frontend/src/lib/mediaBootstrap.js`
   - Function: `dedupeThumbEntries(...)`
   - Change: dedupe key now URL-first, fallback fileName/name.
   - Function: `ingestThumbReelsToVault(...)`
   - Change: duplicate check now includes resolved URL equality.
   - Function: `dedupeVideoEntries(...)`
   - Change: canonicalize URL with `toRelativeMediaPath(...)` before dedupe.

3. `frontend/src/viewer/viewerContext.js`
   - Function: `mergeVideoVaultEntries(...)`
   - Change: canonicalize URL before dedupe to collapse absolute/relative duplicates.

4. `frontend/src/components/experiences/VaultExperience.svelte`
   - Function: `acceptPendingThumbnail(...)`
   - Change: persisted thumbnail entry enriched with `fileName` and `title`.
   - Function: `handleVaultVideoDrop(...)`
   - Change: normalize upload response (`videoUrl`/`thumbnailUrl` -> reel-compatible fields) before `reelToVaultEntry(...)`.

## Why these changes fix duplication

- Same asset was entering state from two paths (immediate insert + sync hydration) with identity drift:
  - URL absolute vs relative variants
  - name/title/fileName mismatch for same URL
- URL-first canonical dedupe removes duplicate identity rows.

## Validation outcome

- Re-run counts for one upload per type:
  - `jpg`: `[UPLOAD_START]=1`, `[UPLOAD_COMPLETE]=1`, `[ASSET_INSERT]=1`, `[VAULT_CARD]=1`
  - `png`: `[UPLOAD_START]=1`, `[UPLOAD_COMPLETE]=1`, `[ASSET_INSERT]=1`, `[VAULT_CARD]=1`
  - `webp`: `[UPLOAD_START]=1`, `[UPLOAD_COMPLETE]=1`, `[ASSET_INSERT]=1`, `[VAULT_CARD]=1`
  - `gif`: `[UPLOAD_START]=1`, `[UPLOAD_COMPLETE]=1`, `[ASSET_INSERT]=1`, `[VAULT_CARD]=1`
  - `mp4`: `[UPLOAD_START]=1`, `[UPLOAD_COMPLETE]=1`, `[ASSET_INSERT]=1`, `[VAULT_CARD]=1`

`VAULT_DUPLICATION_FIXED=true`
