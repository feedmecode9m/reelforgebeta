# Vault Pipeline Map (Phase 66E)

## Image path

1. `VaultExperience.svelte` (`handleVaultThumbnailDrop`) receives drag/drop.
2. `VaultExperience.svelte` (`acceptPendingThumbnail`) starts upload.
3. `media.js` (`uploadThumbnail` -> `createReel`) sends `POST /api/reels` with `thumbnail`.
4. `handlers.rs` (`create_reel`) routes to `ingestion/upload.rs` (`ingest_image_only`).
5. Backend writes `backend/public/thumbs/<uuid>.(png|jpg)` and inserts DB row (`db/reels.rs`).
6. Backend marks row `ready + validated` and returns accepted payload.
7. Frontend updates stores:
   - `personal_thumbnails` (`storeThumbnailMetadata`)
   - `personalThumbnailCollection` (Svelte store)
8. `viewerContext.js` `syncFromVault()` rehydrates from `GET /api/reels`.
9. `VaultExperience.svelte` image `{#each}` renders via `MediaThumbnail`.

## Video path

1. `VaultExperience.svelte` (`handleVaultVideoDrop`) receives drag/drop.
2. `media.js` (`uploadMedia` -> `createReel`) sends `POST /api/reels` with `video`.
3. `ingestion/upload.rs` writes `backend/public/videos/<uuid>.mp4` and inserts pending DB row.
4. Job enqueued (`db/jobs`), worker (`ingestion/worker.rs`) extracts thumbnail to `public/thumbs/<uuid>.jpg`.
5. Worker marks DB row `ready + validated`.
6. Frontend poll (`ingestPoll.js`) waits on `GET /api/reels/{id}` until ready.
7. Frontend updates stores:
   - `personalVideos`
   - `personal_video_vault` (localStorage)
8. `viewerContext.js` `syncFromVault()` merges backend reels to vault entries.
9. `VaultExperience.svelte` video `{#each}` renders via `MediaRenderer`.

## Forensic root cause

- Primary failure was operational pipeline outage:
  - backend process had been killed (`exit 137` in terminal runtime log),
  - then backend startup failed because Postgres was unavailable.
- During this state, `POST /api/reels` could not complete reliably from UI path, so uploaded assets did not persist into Vault render hydration.

## Secondary defect discovered

- `ingest_image_only` stores PNG/WebP bytes but hardcodes DB `mime_type` to `image/jpeg`.
- WebP uploads are also forced to `.jpg` extension path unless incoming name ends with `.png`.
- This does not block rendering in current browser path, but is a contract correctness defect.

