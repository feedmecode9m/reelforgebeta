# BG-5L — Production Write-Path Verification

**Mission:** Prove production upload writes to mounted Railway volume and survives redeploy.  
**Date:** 2026-07-16  
**Result:** **PASS** (write path + persistence) — **conditional** on `split_brain_detected` (legacy catalog rows)

No application code was modified during this mission.

---

## Test Asset

| Field | Value |
|-------|-------|
| **Test file** | `/tmp/bg5l-test.mp4` (3,051 bytes, ffmpeg-generated H.264) |
| **Upload timestamp (UTC)** | `2026-07-16T17:20:42Z` |
| **Asset UUID** | `03f66631-6038-4ff3-8374-444f4c21eaf6` |
| **Stored video filename** | `03f66631-6038-4ff3-8374-444f4c21eaf6.mp4` |
| **Stored thumb filename** | `03f66631-6038-4ff3-8374-444f4c21eaf6.jpg` |
| **Redeploy ID** | `f98c3df7-3f82-4b87-a2cf-dcdfa10ed904` |
| **Redeploy timestamp (UTC)** | `2026-07-16T17:22:23Z` (verified after deploy SUCCESS at 13:21:25 -04:00) |

---

## Phase 1 — Upload Path Trace (code + production logs)

### Code path (unchanged)

```
POST /api/reels
  handlers.rs::create_reel
    → ingestion/upload.rs::ingest_from_reel_multipart
      → media_api.rs::parse_reel_multipart
      → ingest_video_bytes
           Uuid::new_v4() → asset_id
           stored_name = "{uuid}.mp4"
           video_path = videos_path.join(stored_name)   // ./public/videos → /app/public/videos
           std::fs::write(&video_path, bytes)
           reels::insert_pending_reel (status=pending, validated=false)
           jobs::enqueue → worker
  ingestion/worker.rs::process_one
           ffmpeg::extract_thumbnail_at_1s → thumbs_path/{uuid}.jpg
           reels::mark_ready (status=ready, validated=true)
```

### Production Railway logs (verbatim)

```text
[INGEST] ... assetId=03f66631-6038-4ff3-8374-444f4c21eaf6 fileName=bg5l-write-path-test.mp4 result=asset_created
[STORE_WRITE] kind=video path=./public/videos/03f66631-6038-4ff3-8374-444f4c21eaf6.mp4 bytes=3051
[DB] ... fileName=03f66631-6038-4ff3-8374-444f4c21eaf6.mp4 result=insert_pending_ok
[STORE_UPDATE] reel=03f66631-6038-4ff3-8374-444f4c21eaf6 status=pending queue=enqueued
[ingest] accepted reel=03f66631-6038-4ff3-8374-444f4c21eaf6 file=03f66631-6038-4ff3-8374-444f4c21eaf6.mp4 thumb_job=true
[ingest-worker] claimed job=... reel=03f66631-6038-4ff3-8374-444f4c21eaf6 attempt=1
[FFMPEG] ... fileName=03f66631-6038-4ff3-8374-444f4c21eaf6.mp4 result=ok
[DB] ... fileName=03f66631-6038-4ff3-8374-444f4c21eaf6.jpg result=mark_ready_ok
[STORE_UPDATE] reel=03f66631-6038-4ff3-8374-444f4c21eaf6 status=ready worker=true thumb=/thumbs/03f66631-6038-4ff3-8374-444f4c21eaf6.jpg
[ingest-worker] ready reel=03f66631-6038-4ff3-8374-444f4c21eaf6 video=/videos/03f66631-6038-4ff3-8374-444f4c21eaf6.mp4 thumb=/thumbs/03f66631-6038-4ff3-8374-444f4c21eaf6.jpg
```

**Interpretation:** Write target is `./public/videos` at runtime → `/app/public/videos` (WORKDIR `/app`, volume mounted at `/app/public`). No alternate write path observed.

---

## Diagnostics Before Upload

```json
{
  "split_brain_detected": true,
  "db_video_count": 2,
  "filesystem_video_count": 0,
  "db_thumb_count": 2,
  "filesystem_thumb_count": 0,
  "db_videos_missing_files": [
    "66598368-3fba-41bf-847c-68dd8f41be86.mp4",
    "e5bf7c03-8495-4138-81e4-15a974d55d60.png"
  ]
}
```

Legacy catalog rows with no on-disk files (pre-volume-restore state).

---

## Phase 2 — Filesystem Verification (via diagnostics API)

Post-upload filesystem inventory:

```json
{
  "filesystem_videos": ["03f66631-6038-4ff3-8374-444f4c21eaf6.mp4"],
  "filesystem_thumbs": ["03f66631-6038-4ff3-8374-444f4c21eaf6.jpg"],
  "filesystem_video_count": 1,
  "filesystem_thumb_count": 1,
  "orphan_videos": [],
  "orphan_thumbs": []
}
```

✅ New files appear on mounted volume at `/app/public/videos` and `/app/public/thumbs`.  
✅ No orphan files for the new upload.

---

## Phase 3 — Database Row

`GET /api/reels/03f66631-6038-4ff3-8374-444f4c21eaf6`:

```json
{
  "id": "03f66631-6038-4ff3-8374-444f4c21eaf6",
  "fileName": "03f66631-6038-4ff3-8374-444f4c21eaf6.mp4",
  "url": "https://strong-lolly-a9fcb4.netlify.app/videos/03f66631-6038-4ff3-8374-444f4c21eaf6.mp4",
  "thumbnailUrl": "https://strong-lolly-a9fcb4.netlify.app/thumbs/03f66631-6038-4ff3-8374-444f4c21eaf6.jpg",
  "thumbnailPath": "/thumbs/03f66631-6038-4ff3-8374-444f4c21eaf6.jpg",
  "status": "ready",
  "validated": true
}
```

| Field | Value | Matches disk |
|-------|-------|--------------|
| `id` / UUID | `03f66631-6038-4ff3-8374-444f4c21eaf6` | ✅ |
| `fileName` | `03f66631-6038-4ff3-8374-444f4c21eaf6.mp4` | ✅ |
| `video_url` (DB) | `/videos/03f66631-6038-4ff3-8374-444f4c21eaf6.mp4` | ✅ |
| `thumbnail_url` (DB) | `/thumbs/03f66631-6038-4ff3-8374-444f4c21eaf6.jpg` | ✅ |
| `status` | `ready` | ✅ |
| `validated` | `true` | ✅ |

---

## Phase 4 — API Verification

### Upload response (`HTTP 202`)

```json
{
  "id": "03f66631-6038-4ff3-8374-444f4c21eaf6",
  "status": "pending",
  "videoUrl": "https://strong-lolly-a9fcb4.netlify.app/videos/03f66631-6038-4ff3-8374-444f4c21eaf6.mp4",
  "pollUrl": "/api/reels/03f66631-6038-4ff3-8374-444f4c21eaf6"
}
```

Worker completed within ~1s; status became `ready`.

### `GET /api/reels`

New UUID present in list (3 ready reels total; test reel listed first by recency).

### Media HTTP (Railway direct)

**Video:**
```http
HTTP/2 200
content-type: video/mp4
content-length: 3051
last-modified: Thu, 16 Jul 2026 17:20:43 GMT
etag: "1f703:beb:6a5912eb:3459ebb0"
```

**Thumbnail:**
```http
HTTP/2 200
content-type: image/jpeg
content-length: 674
last-modified: Thu, 16 Jul 2026 17:20:44 GMT
etag: "1f704:2a2:6a5912ec:258038c7"
```

✅ Both return **HTTP 200** with correct content types and byte sizes.

---

## Phase 5 — Guardrails After Upload

```json
{
  "db_video_count": 3,
  "db_thumb_count": 3,
  "filesystem_video_count": 1,
  "filesystem_thumb_count": 1,
  "split_brain_detected": true,
  "db_videos_missing_files": [
    "66598368-3fba-41bf-847c-68dd8f41be86.mp4",
    "e5bf7c03-8495-4138-81e4-15a974d55d60.png"
  ],
  "orphan_videos": [],
  "orphan_thumbs": []
}
```

| Check | Result |
|-------|--------|
| Filesystem counts updated | ✅ 0→1 videos, 0→1 thumbs |
| DB counts updated | ✅ 2→3 |
| New upload in sync | ✅ file on disk matches DB row |
| `split_brain_detected` | ⚠️ **still `true`** — 2 **legacy** ready rows missing files (not caused by this upload) |

**Note:** Full `split_brain_detected: false` requires removing or restoring the two pre-existing catalog entries (`66598368…`, `e5bf7c03…`). The BG-5L upload itself introduced **zero** missing files and **zero** orphans.

---

## Phase 6 — Redeploy Persistence

**Action:** `railway redeploy --yes` → deployment `f98c3df7-3f82-4b87-a2cf-dcdfa10ed904` SUCCESS.

**Post-redeploy (no new upload):**

```http
GET /videos/03f66631-6038-4ff3-8374-444f4c21eaf6.mp4 → HTTP/2 200
  content-length: 3051
  etag: "1f703:beb:6a5912eb:3459ebb0"   (unchanged)
  last-modified: Thu, 16 Jul 2026 17:20:43 GMT (unchanged)

GET /thumbs/03f66631-6038-4ff3-8374-444f4c21eaf6.jpg → HTTP/2 200
  content-length: 674
  etag: "1f704:2a2:6a5912ec:258038c7"   (unchanged)
  last-modified: Thu, 16 Jul 2026 17:20:44 GMT (unchanged)
```

Post-redeploy diagnostics: `filesystem_video_count: 1`, `filesystem_thumb_count: 1` — unchanged.

✅ **Media survives Railway redeploy.** Volume persistence confirmed.

---

## PASS Criteria Matrix

| Criterion | Result |
|-----------|--------|
| Upload writes into `/app/public/videos` | ✅ |
| Thumbnail written into `/app/public/thumbs` | ✅ |
| DB row references same UUID | ✅ |
| `GET /videos/{uuid}.mp4` → HTTP 200 | ✅ |
| `GET /thumbs/{uuid}.jpg` → HTTP 200 | ✅ |
| `split_brain_detected = false` | ⚠️ **Conditional** — legacy rows only |
| Files survive Railway redeploy | ✅ |

---

## Verdict

### **PASS — Production write path and volume persistence proven**

The complete pipeline works on Railway:

```
POST /api/reels → disk write → DB insert → FFmpeg thumb → mark_ready() → GET /api/reels → GET /videos|/thumbs → HTTP 200
```

Files land on the mounted volume and **survive redeploy**.

### Remaining catalog hygiene (not a write-path defect)

Two legacy `ready` reels in Postgres predate restored media on the volume. They keep `split_brain_detected: true` until those rows are deleted or their files are restored. **This does not block UI validation** for new uploads.

---

## Recommended Next Steps

1. **Optional:** Delete or restore legacy reels `66598368-3fba-41bf-847c-68dd8f41be86` and `e5bf7c03-8495-4138-81e4-15a974d55d60` to clear split-brain globally.
2. **Proceed to UI validation** on Netlify (MP4 Vault, Hero Background, batch delete) — storage layer is proven.
3. Use UUID `03f66631-6038-4ff3-8374-444f4c21eaf6` as a known-good production reference asset.
