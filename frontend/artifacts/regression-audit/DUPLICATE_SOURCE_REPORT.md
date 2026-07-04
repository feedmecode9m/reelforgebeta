# Duplicate Source Report

## Method

- Logged `[VAULT_CARD]` per rendered vault card with asset URL/id matching uploaded asset id stem.
- Logged `[ASSET_INSERT]` and backend `[UPLOAD_RESPONSE]` IDs.

## Determination

- Duplicate case is **same asset duplicated**, not multiple backend assets created.

### Evidence (thumbnail)

- One upload response id mapped to one backend media file.
- Store previously contained two rows for same URL under different names.
- Example observed pattern:
  - row A: `name=generated-id.png`, `url=/thumbs/<same-id>.png`
  - row B: `name=original-upload-name.png`, `url=/thumbs/<same-id>.png`

### Evidence (video)

- One upload response id created one backend video file.
- Store previously showed two rows for same asset:
  - one with relative URL (`/videos/<id>.mp4`)
  - one with absolute URL (`http://localhost:8080/videos/<id>.mp4`)

## Root source by file/function

1. `frontend/src/lib/mediaBootstrap.js`
   - `dedupeThumbEntries(...)` originally keyed by `name` only.
   - `dedupeVideoEntries(...)` originally keyed by raw URL string.
2. `frontend/src/viewer/viewerContext.js`
   - `mergeVideoVaultEntries(...)` originally keyed by raw URL (absolute vs relative mismatch).
3. `frontend/src/components/experiences/VaultExperience.svelte`
   - video response normalization gap caused mixed URL forms and inconsistent naming.

## Output class

- Not `A1 A2 A3 A4` from one upload call.
- Equivalent to repeated `A1` under identity drift (name/url canonical mismatch).
