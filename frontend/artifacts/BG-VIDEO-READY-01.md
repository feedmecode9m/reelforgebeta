# BG-VIDEO-READY-01 — Why MP4 uploads never reach READY in production

**Date:** 2026-07-27  
**Mode:** Investigation + temporary `[VIDEO_PIPELINE]` tracing + smallest R2-worker integrity fix  
**Constraints honored:** no cleanup, no orphan deletion, no schema changes, no frontend redesign, signed R2 preserved

---

## Verdict

**First failing boundary (362MB case): upload transport truncation before ingest.**

Exact production evidence:

```text
rejecting file: reason=truncated_container
detail="atom mdat at offset 184138 extends to 362155056 but file is 5242880 bytes"
```

- Expected media payload: **~362 155 056 bytes**
- Bytes on Railway disk / received object: **5 242 880 bytes (exactly 5 MiB)**
- Ingestion / ffprobe / quarantine then correctly refuse the corrupt container
- `GET /api/reels` only lists **ready** rows → **0 ready videos** (images still ready)

ffmpeg thumbnail extraction is **not** the first failure for that 362MB artifact. It never receives a complete MP4.

---

## Lifecycle map (shared by Video Vault + Hero)

Both surfaces call the same backend path:

```text
VaultExperience.handleVaultVideoDrop  ─┐
HeroExperience.acceptHeroFile         ─┴─► uploadMedia()
                                              │
                     large file → sign → R2 PUT → POST /api/reels/finalize
                     small file → POST /api/reels (multipart)
                                              │
                                              ▼
                              ingest_stored_video / ingest_video_bytes
                                              │
                                              ▼
                              jobs.enqueue → ingest worker
                                              │
                              disk: size + ffprobe validate
                              R2: download → (now) size + ffprobe → ffmpeg thumb
                                              │
                                              ▼
                              reels.mark_ready | reels.mark_failed
                                              │
                                              ▼
                              frontend pollIngestionUntilReady → vault insert
```

**Hero and Video Vault are not divergent UI failures.** They share `uploadMedia` → finalize/ingest → worker.

| Surface | Frontend entry | Backend |
|---|---|---|
| Video Vault | `handleVaultVideoDrop` → `uploadMedia` | same |
| Hero MP4 | `acceptHeroFile` → `uploadMedia` | same |
| Thumbnail vault | `uploadThumbnail` → image path | **skips video ffmpeg job** when user thumb present / image reel |

---

## Required size check (362MB)

| Check | Expected if healthy | Observed historically |
|---|---|---|
| `browserFileSize` | 362 155 056 | metadata claims ~362MB |
| R2 `Content-Length` / disk size | 362 155 056 | **5 242 880** |
| finalize `sizeBytes` / `expected_size` | must match object | mismatch or declared size == truncated received bytes on multipart |

**If sizes differ:** stop at transport — do not chase ffmpeg.  
**If sizes match:** continue to worker ffprobe/ffmpeg (tracing now covers that).

Current public HEAD of the previously failed R2 key returns **404** (object gone/quarantined) — inconclusive for that key now, but the Railway reject log remains definitive.

---

## Ingest failure classes

| Failure | Where | Outcome |
|---|---|---|
| `truncated_container` | `media_validator` atom walk / worker disk validate | quarantine + `mark_failed` → never READY |
| size mismatch | finalize / worker | `upload incomplete: object size mismatch` |
| ffprobe reject | worker (disk; **now also R2 after download**) | `mark_failed` |
| ffmpeg thumb fail | `ffmpeg::extract_thumbnail_*` | retry then `mark_failed` |
| stuck pending | job not claimed / enqueue fail | poll timeout in UI |

Production catalog today: **ready images only**. Failed video rows are invisible to `GET /api/reels` (ready-only), which matches “drop then nothing appears.”

---

## Why local succeeds / production fails

| Factor | Local | Production |
|---|---|---|
| Upload path | Direct to backend; full body | Same-origin Netlify proxy **truncated multipart at 5 MiB** |
| Large file path | Optional signed | **Must** use signed R2 PUT (bypass Netlify body) |
| Incomplete object | Rare | Historical 5 MiB stubs + orphan tiny MP4s on volume |
| ffmpeg MJPEG strictness | Older ffmpeg often lenient | Railway ffmpeg needs `yuvj420p` + `-strict unofficial` (already on `origin/main`) |
| R2 worker validation | N/A or full file on disk | **Previously skipped ffprobe after R2 download** (gap closed in this mission) |

---

## Code boundaries

| Stage | File | Function |
|---|---|---|
| Sign | `backend/src/signed_upload.rs` | `sign_upload` |
| Finalize size gate | `backend/src/signed_upload.rs` | `finalize_reel` + `verify_signed_byte_count` |
| Stored ingest | `backend/src/ingestion/upload.rs` | `ingest_stored_video` |
| Multipart ingest | `backend/src/ingestion/upload.rs` | `ingest_from_reel_multipart` / `ingest_video_bytes` |
| Job pickup | `backend/src/ingestion/worker.rs` | `process_one` |
| Container validate | `backend/src/media_validator.rs` | `validate_video_path` / truncated atom walk |
| Thumb extract | `backend/src/ingestion/ffmpeg.rs` | `extract_jpeg_frame` |
| READY transition | `backend/src/db/reels.rs` | `mark_ready` / `mark_failed` |

---

## Temporary tracing added

Module: `backend/src/video_pipeline_trace.rs`

Emits:

```text
[VIDEO_PIPELINE] {"stage","fileName","fileSize","storageKey","statusBefore","statusAfter","error"}
```

Wired at:

- `sign`
- `finalize_verify` (size ok / upload_incomplete)
- `finalize_ingest` / `ingest_enqueue`
- `worker_pickup`
- `r2_download`
- `ffprobe`
- `ffmpeg_thumb`
- `db_status` (`pending` → `processing` → `ready` | `failed`)

After Railway deploy, one fresh 362MB upload should show either:

1. `finalize_verify` → `upload_incomplete` (**transport still broken**), or  
2. `finalize_verify` → `size_ok` → `worker_pickup` → `ffprobe`/`ffmpeg_thumb` → `db_status: ready`

---

## Smallest production fix

1. **Transport (primary for 362MB):** Keep signed R2 only for large videos; never multipart through Netlify. Finalize must reject size mismatch with `upload incomplete: object size mismatch`. (Frontend signed redirect + backend verify — deploy both.)

2. **Worker R2 integrity (this mission):** After R2 download, run **size integrity + ffprobe** before ffmpeg so truncated/corrupt objects fail with a clear `[VIDEO_PIPELINE] ffprobe` reason instead of opaque ffmpeg failure.

3. **ffmpeg (secondary, already on origin):** Keep `yuvj420p` + `-strict unofficial` so **complete** files can reach READY on Railway.

4. **Do not** treat Vault DnD / placeholder UI as the READY blocker for MP4.

---

## Acceptance after deploy

1. Drop/accept one **small** complete MP4 → `[VIDEO_PIPELINE]` reaches `db_status: ready` → appears in Video Vault.  
2. Drop one **~362MB** MP4 → `browserFileSize == R2 Content-Length == finalize expected` → then READY.  
3. If size mismatch at finalize → stop; fix PUT/Content-Length only.  
4. Thumbnail vault still works.  
5. No orphan cleanup in this mission.

---

## What was changed in-repo (this mission)

- `backend/src/video_pipeline_trace.rs` (new)
- `backend/src/signed_upload.rs` — `[VIDEO_PIPELINE]` on sign/finalize
- `backend/src/ingestion/upload.rs` — `[VIDEO_PIPELINE]` on validate/enqueue
- `backend/src/ingestion/worker.rs` — `[VIDEO_PIPELINE]` + **R2 download ffprobe/size gate before ffmpeg**
- `backend/src/lib.rs`, `backend/src/main.rs` — module registration

No frontend UI/DnD redesign in this mission.
