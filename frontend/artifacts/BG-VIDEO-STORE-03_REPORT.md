# BG-VIDEO-STORE-03 — Upload Integrity Hardening

**Date:** 2026-07-26  
**Verdict:** Surgical backend patch applied. Truncated/incomplete uploads can no longer reach `status=ready`.

---

## Root cause (5,242,880-byte corruption)

| Layer | Finding |
|-------|---------|
| **Symptom** | Railway disk files at `/videos/{uuid}.mp4` are exactly **5,242,880 bytes (5 MiB)** while source assets are 100MB+ |
| **Playback boundary** | Netlify and Railway serve identical truncated bytes; browser decode fails on incomplete `mdat` |
| **Validation gap** | `ffprobe` succeeds because `moov`/metadata is intact at file head — **metadata-only pass** |
| **Size gate gap** | Multipart `POST /api/reels` had **no declared-size vs stored-size check** |
| **Finalize gap** | `finalize_reel` verified R2 size only when session status ≠ `Uploaded`; **local disk finalize skipped re-check** |
| **Tolerance gap** | Signed upload paths allowed **±5% size drift** — insufficient for truncated proxy bodies |

### Where 5 MiB does **not** come from (code search)

| Location | Limit | Notes |
|----------|-------|-------|
| `backend/src/main.rs:291` | `PayloadConfig::new(104_857_600)` | 100 MiB global |
| `backend/src/main.rs:307` | `600 * 1024 * 1024` | 600 MiB direct PUT |
| `backend/src/signed_upload.rs:56` | `2_147_483_648` default | 2 GiB signed max |
| `frontend/src/lib/config.js:132` | `6_000_000` | Signed route threshold (6 MB), not 5 |
| `frontend/src/lib/storage.js:23` | `5 * 1024 * 1024` | **localStorage budget only** — not upload transport |

**Most likely truncation source:** Netlify same-origin proxy on `POST /api/reels` multipart for files **below** the 6 MB signed-upload switch but large enough to hit an intermediate proxy/body cap (~5 MiB observed in production). Files routed through signed R2 PUT bypass this path and play correctly.

---

## Upload lifecycle (before patch)

```
uploadVideo() [media.js:781]
  ├─ < 6MB + Netlify prod → multipart POST /api/reels
  │     handlers.rs:240 → ingest_from_reel_multipart
  │     media_api.rs:313 → parse_reel_multipart (reads all bytes, no size declaration)
  │     upload.rs:27 → ingest_video_bytes → fs::write → validate_video_path (ffprobe only)
  │     worker.rs:133 → mark_ready (no size re-check)
  │
  └─ ≥ 6MB → signed flow
        sign_upload [signed_upload.rs:149] — stores expected_size
        PUT R2 or direct_upload — partial size check (±5%)
        finalize_reel [signed_upload.rs:397]
          R2: head_object size check (±5%)
          Disk session=Uploaded: **no size re-check**
        ingest_stored_video → pending → worker → ready
```

---

## Patch summary (smallest surgical diff)

### 1. `backend/src/media_validator.rs`

- Added `verify_upload_size_integrity(expected, actual)` — **exact match required**
- Added `verify_mp4_atom_bounds(path)` — detects ISO-BMFF boxes extending past EOF
- Added `validate_video_path_with_expected_size(path, expected_size)`
- ffprobe now reads `format.size` and compares to on-disk length
- Tests: truncated MP4 atom rejection, 362MB vs 5242880 mismatch

### 2. `backend/src/signed_upload.rs`

- `direct_upload`: exact size match → **409 `upload_incomplete`**
- `finalize_reel`: verifies disk or R2 size == signed `expected_size` before ingest
- Passes `expected_size` into `ingest_stored_video`

### 3. `backend/src/ingestion/upload.rs`

- `ingest_stored_video(..., expected_size)` — 409 on mismatch, quarantine on corrupt disk copy

### 4. `backend/src/ingestion/worker.rs`

- Blocks `mark_ready` when DB `file_size` ≠ disk size or container validation fails

---

## Expected API behavior after deploy

```http
POST /api/reels/finalize
→ 409 Conflict

{
  "error": "upload_incomplete",
  "expected_size": 362000000,
  "stored_size": 5242880
}
```

Multipart uploads without a declared size are still accepted at ingress but **fail container integrity** if atoms are truncated (new `truncated_container` reason).

---

## Tests

```bash
cd /home/youloose2dafish/projects/reelforge
cargo test -p backend media_validator
```

Covers:

- `rejects_truncated_mp4_atom_extends_past_eof`
- `rejects_upload_size_mismatch` (362_000_000 vs 5_242_880)
- `accepts_matching_upload_size`

---

## Not changed (per scope)

- Frontend playback / Theater / Vault rendering
- R2 migration of existing corrupt catalog (Phase 4 audit remains operational follow-up)

---

## Recommended next steps

1. Deploy backend to Railway
2. Upload one small + one large MP4 via signed R2 path; confirm `curl -I /videos/{id}.mp4` Content-Length matches client file.size
3. Run catalog audit (`GET /api/reels` + disk/R2 size compare) and re-upload corrupt entries through signed R2 flow
