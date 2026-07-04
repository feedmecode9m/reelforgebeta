# Store State Audit

## Diagnostics emitted

`[VAULT_STORE_UPDATE]`

```json
{
  "before": { "thumbs": 3, "videos": 6 },
  "after": { "thumbs": 5, "videos": 6 },
  "latestThumb": {
    "name": "a1645728-5f41-4ec1-9e00-0cee50a2f019.png",
    "url": "/thumbs/a1645728-5f41-4ec1-9e00-0cee50a2f019.png",
    "size": 68,
    "type": "image",
    "addedAt": "2026-06-14T00:40:43.347Z"
  },
  "latestVideo": {
    "id": "fd142051-077c-4e79-966e-85762ea16e44",
    "name": "d43c4148-4037-4f94-bff7-1197ad2449d5",
    "type": "video/quicktime",
    "addedAt": "2026-06-13T09:34:49.247569+00:00",
    "thumbnail": "/thumbs/fd142051-077c-4e79-966e-85762ea16e44.jpg",
    "url": "/videos/d43c4148-4037-4f94-bff7-1197ad2449d5.mov"
  }
}
```

## Findings

- Thumbnail store increments (`3 -> 5`) and includes newly uploaded thumbnail metadata.
- Video store does **not** increment immediately after upload (`6 -> 6`) despite successful `POST /api/reels` for new MP4.
- This confirms video ingestion success but frontend vault store update mismatch for pending video response payload.

## Relevant stores

- `personal_thumbnails` (localStorage + `personalThumbnailCollection`)
- `personal_video_vault` (localStorage + `personalVideos`)
- feed-level distribution side effects (`feed`, `AI_CLEANUP_AGENT.distributeVideoToFeed`)

## Additional observation

- After ingestion worker marks uploaded video ready and a subsequent reload/sync runs, the new video appears in `personal_video_vault`.
- Failure is in immediate post-upload mapping, not in long-term persistence.
