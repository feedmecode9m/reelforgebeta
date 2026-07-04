---
name: reelforge-file-serving
description: ReelForge upload fix - backend returns URLs, frontend uses directly, no base64 localStorage
keywords: reelforge, upload, vault, thumbnail, base64, localStorage, quota
---

# ReelForge File Serving Skill

## When to Use
- Upload fails with 404
- localStorage quota exceeded
- Vault shows empty borders
- Base64 blobs in console

## Quick Fix
1. media.js: Use unified `POST /api/reels` via `createReel(formData)`
2. storage.js: Remove base64 localStorage fallback
3. Viewer.svelte: Use `reel.url` directly from backend response

## Confirmed Backend Routes
- POST `/api/reels` (multipart: `video`, `thumbnail`, `title`, `description`) → full reel JSON with `videoPath`, `thumbnailPath`, `thumbnailUrl`
- GET `/api/reels` → returns array of reels with `url` field

## Golden Rule
Backend returns `url`. Frontend uses `url`. No base64. No localStorage for images.

## Content progression (micro-drama product logic)

ReelForge is designed to **grow from thumbnails into full video**, not jump straight to an all-video catalog.

| Phase | What users see | Implementation |
|-------|----------------|----------------|
| Early / lean catalog | Category grids filled with **thumbnail placeholders** (`isPlaceholder`, `isPersonalThumbnail`, `video_url: null`) | `syncThumbnailsToFeed`, `fillBlackStoriesUntilVideo`, personal thumb vault → feed |
| Growth | **Real MP4/MOV** reels appear alongside or ahead of placeholders (`isPersonalVideo`, `hasPlayableVideo`) | Video vault → `distributeVideoToFeed`; studio cards use `<video>` when `type: video` + `/videos/` URL |
| Mature (future) | Paywall, **episodes**, serialized drops; video gradually dominates placeholders | Not built yet — hook paywall on `recordAccess` / reel `id`; episode metadata on `Reel` / backend |

**Do not** treat thumbnails and videos as interchangeable:
- Thumbs **populate and sustain** placeholder slots until enough video exists.
- Videos **replace or lead** rows as they are uploaded; placeholders remain as filler where needed (`TARGET_LANDSCAPE_COUNT`).
- Vault UI: thumb grid (1:1) and video grid (16:9) are separate; feed merging respects placeholder vs playable video.
