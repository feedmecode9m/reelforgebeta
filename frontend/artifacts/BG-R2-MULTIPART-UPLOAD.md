# BG-R2-MULTIPART-UPLOAD — Parallel chunked R2 puts

**Date:** 2026-07-29  
**Status:** Design + frontend scaffold (backend not implemented yet)  
**Symptom:** Single-stream signed PUT of ~345 MB (`condo_v1_2.mp4`) can sit at low % for many minutes — feeling unproductive.

---

## Clarification

The slow step is **browser → Cloudflare R2** (presigned PUT), **not** the Postgres “app database.”  
After the PUT completes, finalize + ingest are comparatively quick. A 345 MB file on a ~1 MB/s upstream takes ~6 minutes in the best case; on ~100 KB/s it can take an hour.

Today’s path:

```
sign (/api/uploads/sign) → one XHR PUT of entire File → finalize → ingest
```

---

## Goal

Use **S3-compatible multipart upload** to R2:

1. Create multipart upload (backend)
2. Presign **N part URLs** (or one signing endpoint per part)
3. Browser uploads **parts in parallel** (e.g. 4–6 × 8–16 MiB chunks)
4. Complete multipart (backend) with ETags
5. Existing finalize / ingest unchanged (object key still becomes the reel media)

Expected client benefit: better use of available upstream bandwidth + faster recovery (retry one part, not the whole 345 MB).

---

## Proposed backend API (not built yet)

Feature flag: `R2_MULTIPART_UPLOADS=true`

### `POST /api/uploads/multipart/create`

Request (same identity fields as sign):

```json
{
  "filename": "condo_v1_2.mp4",
  "contentType": "video/mp4",
  "sizeBytes": 362155056,
  "partSizeBytes": 16777216,
  "title": "...",
  "category": "Trending"
}
```

Response:

```json
{
  "multipartSupported": true,
  "uploadId": "...",
  "reelId": "...",
  "storageKey": "<uuid>.mp4",
  "s3UploadId": "<aws multipart id>",
  "partSizeBytes": 16777216,
  "partCount": 22,
  "expiresAt": "..."
}
```

### `POST /api/uploads/multipart/sign-part`

```json
{ "uploadId": "...", "partNumber": 1 }
```

→ `{ "uploadUrl": "https://...r2...presigned...", "partNumber": 1 }`

### `POST /api/uploads/multipart/complete`

```json
{
  "uploadId": "...",
  "parts": [{ "partNumber": 1, "etag": "\"...\"" }, ...]
}
```

Then client calls existing `POST /api/reels/finalize` with the same `uploadId`.

### Fallback

If create returns `404` / `multipart_not_enabled`, client uses today’s single `POST /api/uploads/sign` + one PUT.

---

## Frontend scaffold

Module: `frontend/src/lib/api/r2MultipartUpload.js`

- `isMultipartUploadEnabled()` — `VITE_R2_MULTIPART_UPLOADS === 'true'`
- `tryCreateMultipartSession(file, headers, meta)` — probes create endpoint; returns `null` on failure
- `uploadFileMultipartParallel(session, file, …)` — concurrency-limited part PUTs + progress events
- Wired from `uploadVideoSigned`: try multipart first when flag on; **always fall back** to current single PUT

Until backend ships, the flag should stay **off** in production so behavior is unchanged.

---

## Today’s workarounds (no code deploy required)

1. **Keep the condo tab open** — aborting wastes all transferred bytes (single PUT has no resume).
2. **Use the fastest uplink available** (ethernet > Wi‑Fi > hotspot). Run a speedtest **upload** number.
3. **Compress first** (HandBrake / Adobe MEZ) to ~50–100 MB H.264 if vault quality allows — often 3–7× faster.
4. **Don’t upload two large files at once** (MICROS retry + condo compete for the same pipe).
5. **Overnight / background** for masters until multipart lands.
6. Status `%` is real R2 progress — low % after minutes usually means **upstream bandwidth**, not a stuck DB write.

---

## Success criteria (later)

- [ ] 300 MB+ vault upload finishes materially faster on the same network vs single PUT  
- [ ] Part failure retries without restarting from 0%  
- [ ] Finalize/ingest still produces a playable `/videos/…` reel  
- [ ] Single-PUT path remains default when multipart API is absent  
