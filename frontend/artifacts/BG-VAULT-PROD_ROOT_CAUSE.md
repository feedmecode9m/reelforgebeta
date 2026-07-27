# BG-VAULT-PROD — Production Vault Failure Root Cause

**Date:** 2026-07-27  
**Mode:** Investigation + surgical fix

---

## ROOT CAUSE

Railway ingest worker thumbnail extraction fails under modern ffmpeg MJPEG
color-range strictness. Upload POST succeeds; poll returns `status=failed`.

## FILE

`backend/src/ingestion/ffmpeg.rs`

## FUNCTION

`extract_thumbnail_at_1s` / `extract_thumbnail_from_url`
(shared helper `extract_jpeg_frame`)

## WHY LOCAL WORKS

Local ffmpeg (e.g. 6.1.x) accepts limited-range YUV → MJPEG without
`-strict unofficial`. Thumbnail extract succeeds → reel marked `ready`.

## WHY PRODUCTION FAILS

Railway ffmpeg rejects limited-range YUV for MJPEG:

```
Non full-range YUV is non-standard, set strict_std_compliance to at most unofficial
ff_frame_thread_encoder_init failed
```

Worker marks reel `failed`. Frontend correctly surfaces the error.
Affects **all video vault paths** (MP4 vault, hero video, studio drop) that
share `POST /api/reels` → ingest → ffmpeg. Delete unaffected (no ffmpeg).

DnD / pointer-events / Netlify routing were **not** the failing boundary
(verified live: drop fires, `POST /api/reels` returns, poll fails on ffmpeg).

## SMALLEST FIX

In `ffmpeg.rs`:

1. Add `-pix_fmt yuvj420p -strict unofficial` for JPEG extract.
2. Fall back seek `ss=1` → `ss=0` for sub-second / 1s fixtures.

No frontend redesign. No API contract change. No upload architecture change.

## ACCEPTANCE

After Railway redeploy:

1. Drop MP4 in Video Vault → upload → ready → visible after refresh.
2. Thumbnail vault image accept still works.
3. Hero background video upload reaches ready.
4. Delete still works.
