# Upload Pipeline Map (Forensic)

## Scope
- Runtime traced on `http://127.0.0.1:5173` with backend `http://localhost:8080`.
- Flow traced for both thumbnail (`image/png`) and video (`video/mp4`) via Smart Production Studio vault UI.

## End-to-end path

1. Drag/drop UI event
   - Thumbnail drop zone: `frontend/src/components/experiences/VaultExperience.svelte` (`handleVaultThumbnailDrop`)
   - Video drop zone: `frontend/src/components/experiences/VaultExperience.svelte` (`handleVaultVideoDrop`)

2. Accept/upload frontend API call
   - Thumbnail accept button: `acceptPendingThumbnail()` in `VaultExperience.svelte`
   - Upload API client: `frontend/src/lib/api/media.js`
     - `uploadThumbnail()` / `uploadMedia()` -> `createReel()`
     - HTTP endpoint: `POST /api/reels`

3. Backend upload endpoint and ingestion
   - Route wiring: `backend/src/main.rs`
     - `/api/reels` -> `handlers::create_reel`
   - Handler: `backend/src/handlers.rs` (`create_reel`)
   - Multipart ingestion: `backend/src/ingestion/upload.rs`
     - `ingest_from_reel_multipart()`
     - image-only path: `ingest_image_only()`
     - video path: `ingest_video_bytes()` (may return `status: pending`)

4. Media persistence and metadata
   - Physical write:
     - Videos -> `backend/public/videos`
     - Thumbs -> `backend/public/thumbs`
   - DB metadata:
     - insert pending reel -> `backend/src/db/reels.rs` (`insert_pending_reel`)
     - mark ready -> `mark_ready`
   - Poll endpoint:
     - `GET /api/reels/{id}` via `handlers::get_reel_status`

5. Static media serving
   - `GET /videos/{filename}` -> `video_stream::serve_video`
   - `GET /thumbs/{filename}` -> `video_stream::serve_thumb`
   - Files + MIME logic in `backend/src/video_stream.rs`

6. Vault store hydration and render
   - Store owner: `frontend/src/viewer/viewerContext.js`
     - stores: `personalVideos`, `personalThumbnailCollection`
     - sync function: `syncFromVault()`
   - Card normalization/render helpers:
     - `frontend/src/lib/viewer/vaultUtils.js`
     - `getVaultImageReel()` / `getVaultVideoReel()`
   - Render components:
     - `VaultExperience.svelte` -> `MediaThumbnail` / `MediaRenderer`
     - media resolver chain: `resolveDisplayUrl.js` -> `reelContract.resolveMediaUrl()`

7. Hero Manager integration
   - Hero resolver: `frontend/src/lib/hero/heroIntelligence.js`
     - `loadHeroVaultItems()`
     - `resolveHeroBackgroundAsset()`
     - `saveHeroManagerConfig()`
   - Hero can consume vault assets only when vault entries include resolvable `id`/`url`/thumbnail data.

## Observed breakpoints in this chain
- Upload response schema mismatch for video pending uploads (`videoUrl`/`thumbnailUrl` without `url` field) is not normalized before `reelToVaultEntry()`.
- Thumbnail accept path expected `thumbnailPath|thumbnail_path|url` only (regression vector); backend returns `thumbnailUrl` camelCase.
- Placeholder path in vault error handling historically only created fallback for video errors, not thumbnail errors.
