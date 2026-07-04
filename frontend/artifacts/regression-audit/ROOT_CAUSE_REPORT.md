# Root Cause Report

## 1) Exact failing file

- Primary: `frontend/src/components/experiences/VaultExperience.svelte`
- Secondary: `frontend/src/lib/api/reelContract.js`
- Secondary: `frontend/src/lib/viewer/vaultUtils.js`

## 2) Exact failing function

- Video immediate-display regression:
  - `handleVaultVideoDrop(...)` in `VaultExperience.svelte`
  - `reelToVaultEntry(...)` in `reelContract.js`
- Thumbnail accept regression vector:
  - `acceptPendingThumbnail(...)` in `VaultExperience.svelte`
- Placeholder regression:
  - `handleVaultMediaError(...)` in `vaultUtils.js`

## 3) Exact failing lines (current file coordinates)

- `frontend/src/components/experiences/VaultExperience.svelte`
  - `177`: `const vaultEntry = reelToVaultEntry(response);`
  - `178-183`: builds vault entry from the reel-mapped object.
  - `263-268` (thumbnail accept): response thumbnail path extraction/validation gate.
- `frontend/src/lib/api/reelContract.js`
  - `305-315`: `reelToVaultEntry(...)` depends on `reel.url`/`reel.fileName`/`reel.name` fields.
- `frontend/src/lib/viewer/vaultUtils.js`
  - `122-143`: `handleVaultMediaError(...)` fallback branch logic.
  - Historically only video branch inserted fallback node; thumbnail branch could leave blank card.

## 4) Why upload succeeds

- Backend endpoint `POST /api/reels` is healthy and returns `202` with valid IDs.
- Files are physically persisted to disk (`backend/public/videos`, `backend/public/thumbs`).
- Ingestion worker processes video and eventually marks it ready.

## 5) Why asset disappears

- Exact payload mismatch for video uploads:
  - Frontend expects reel-shaped payload (`url`, `name`, `fileName`).
  - Backend accepted response is:
    - `id`
    - `status`
    - `videoUrl`
    - `thumbnailUrl`
    - `pollUrl`
- `reelToVaultEntry(response)` receives response without `url`, producing an invalid/empty URL vault entry (`url: ''`, `name: 'Untitled'`).
- Subsequent sync and dedupe logic drops or fails to render that immediate entry, so vault appears unchanged right after upload.

## 6) Why placeholder disappears

- Thumbnail image error path hid the `<img>` but did not guarantee insertion of a thumbnail fallback placeholder.
- Users see blank slot (no image + no fallback node).

## 7) Minimal safe fix (no patch applied in this report)

- Normalize upload responses before writing to vault stores:
  - map `videoUrl -> url`
  - map `thumbnailUrl -> thumbnail` (or `thumbnailUrl` field expected by renderer path)
  - map missing `name/fileName` from URL basename when absent
- In thumbnail accept flow, accept both camelCase and snake_case response keys:
  - `thumbnailUrl`, `thumbnail_url`, `thumbnailPath`, `thumbnail_path`, `url`
- Ensure `handleVaultMediaError` creates placeholder for both `video` and `thumbnail` branches.
- Keep pending-video UX stable by either:
  - polling until ready before final vault insertion, or
  - storing pending item with resolvable `videoUrl` immediately then updating when ready.

## Required payload evidence

`[UPLOAD_RESPONSE]` exact captured payloads:

```json
{
  "id": "a1645728-5f41-4ec1-9e00-0cee50a2f019",
  "status": "ready",
  "videoUrl": "http://localhost:8080/thumbs/a1645728-5f41-4ec1-9e00-0cee50a2f019.png",
  "thumbnailUrl": "http://localhost:8080/thumbs/a1645728-5f41-4ec1-9e00-0cee50a2f019.png",
  "pollUrl": "/api/reels/a1645728-5f41-4ec1-9e00-0cee50a2f019"
}
```

```json
{
  "id": "174e30c6-a0a4-4c48-809f-9137ff1a8f71",
  "status": "pending",
  "videoUrl": "http://localhost:8080/videos/174e30c6-a0a4-4c48-809f-9137ff1a8f71.mp4",
  "thumbnailUrl": null,
  "pollUrl": "/api/reels/174e30c6-a0a4-4c48-809f-9137ff1a8f71"
}
```

Payload contract check against required keys:

- `id`: present
- `mediaUrl`: **missing** (backend emits `videoUrl` instead)
- `thumbnailUrl`: present for image upload, `null` for pending video upload
- `assetType`: **missing**
