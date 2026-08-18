# R2-UPLOAD-RELIABILITY-02

**Mode:** Investigation only — no production code changes  
**Timestamp:** 2026-07-24T19:57:25.521Z  
**Raw JSON:** `frontend/artifacts/r2-upload-reliability-02.json`  
**Harness:** `frontend/scripts/r2-upload-reliability-02.mjs`

---

## Executive Summary

With **fresh presigned URLs per probe** (no URL/uploadId/object-key reuse), **4 of 8 probes succeeded**.

| Tier | Result |
|------|--------|
| **50MB** | Node ✓, curl ✓, Netlify browser ✓ — local browser blocked by R2 CORS (Path A) |
| **250MB** | curl ✓ — Node failed after ~64.5 MB sent, then ~17 min stall → `ENETUNREACH` |

**Key correction vs prior missions:** The earlier curl 502 at ~13MB and mixed results were **confounded by presigned URL reuse**. On fresh URLs, **50MB transport is reliable** from this environment across Node, curl, and Netlify-origin browser. The remaining failures are **(1) expected local CORS** and **(2) an intermittent/large-payload Node stream stall**, not signature reuse.

**500MB stress tier:** Not run (would add ~30+ min per probe; defer until 250MB browser probe is scheduled).

---

## Environment

| Field | Value |
|-------|-------|
| API | `https://reelforge-deploy-production.up.railway.app` |
| Netlify origin | `https://strong-lolly-a9fcb4.netlify.app` |
| Local origin | `http://127.0.0.1:8781` |
| Size tiers (MB) | 50, 250 |
| Upload timeout | 7,200,000 ms (2 h) |
| Probes run | A (Node), B (curl), C (Netlify XHR), D (localhost XHR) |
| Browser probes at 250MB | Skipped (`RELIABILITY_BROWSER_MAX_MB=50` default; override to include) |
| Fresh URL per probe | **Yes** — each probe called `POST /api/uploads/sign` independently |

---

## Signed upload flow (Task 1)

| Item | Value |
|------|-------|
| **Sign endpoint** | `POST https://reelforge-deploy-production.up.railway.app/api/uploads/sign` |
| **Route registration** | `backend/src/main.rs` → `/uploads/sign` |
| **Auth headers** | `Authorization: Bearer <admin token>` (from `POST /admin/auth`); admin required for mutating routes |
| **Request body** | `filename`, `contentType`, `sizeBytes`, optional `title`, `description`, `category` |
| **Response** | `uploadId`, `reelId`, `uploadUrl`, `uploadToken`, `storageKey`, `expiresAt`, `maxBytes` |
| **TTL** | 3600 s default (`SIGNED_UPLOAD_TTL_SECONDS`, minimum 300) |
| **Max size** | 2,147,483,648 bytes / 2 GiB (`SIGNED_UPLOAD_MAX_BYTES`) |
| **Content-Type on PUT** | Must match signed value (probes use `video/mp4`) |
| **Signed headers (SigV4)** | `content-type;host` only |
| **PUT URL single-use?** | **No** — presigned URL is valid until expiry and may overwrite the same key; each sign creates a **new** `uploadId`, `reelId`, `storageKey`, and URL |
| **Frontend helper** | `uploadVideoSigned()` in `frontend/src/lib/api/media.js` |
| **R2 PUT implementation** | `R2Storage::presigned_put_url()` in `backend/src/storage/r2.rs` |

---

## Probe Matrix

Each row used a **unique** `uploadId`, `storageKey`, and presigned URL.

| Size | Probe | Transport | Fresh URL | Upload ID | Outcome | HTTP | Bytes sent | Elapsed | Class | Failure |
|------|-------|-----------|-----------|-----------|---------|------|------------|---------|-------|---------|
| 50MB | A | node_https_put | yes | 97db8b6c… | complete | 200 | 50,108,442 | 23.45s | success | — |
| 50MB | B | curl_put | yes | ab0e1285… | complete | 200 | 50,108,442 | 17.79s | success | — |
| 50MB | C | browser_xhr_netlify_origin | yes | e59cc419… | complete | 200 | 0* | 17.53s | success | — |
| 50MB | D | browser_xhr_localhost_origin | yes | 9f588c72… | error | n/a | 0 | 0.17s | cors_blocked | `PreflightMissingAllowOriginHeader` |
| 250MB | A | node_https_put | yes | e3d4dce9… | error | n/a | 67,633,152 | 1030.88s | midstream_connection_drop | `read ENETUNREACH` |
| 250MB | B | curl_put | yes | 33e3deea… | complete | 200 | 262,144,000 | 109.53s | success | — |
| 250MB | C | browser_xhr_netlify_origin | n/a | — | skipped | — | — | — | skipped | >50MB browser cap |
| 250MB | D | browser_xhr_localhost_origin | n/a | — | skipped | — | — | — | skipped | >50MB browser cap |

\*Headless Chrome `xhr.upload.loaded` reported 0 despite HTTP 200 (known measurement limitation; same pattern as STREAM-FAILURE-01).

---

## Failure Classification

| Class | Count | Probes | Interpretation |
|-------|-------|--------|----------------|
| **success** | 4 | A50, B50, C50, B250 | Fresh URL + transport completed |
| **cors_blocked** | 1 | D50 | Path A — live R2 bucket has not applied dev origins from `r2-cors.json` |
| **midstream_connection_drop** | 1 | A250 | 67.6 MB sent, progress stalled ~1005 s, then `ENETUNREACH` |
| **skipped** | 2 | C250, D250 | Harness runtime cap, not a transport result |

---

## Evidence

### Timeline highlights (fresh URLs)

**50MB Probe A (Node)** — sign 365 ms → upload 23.45 s → HTTP 200, ETag present, cf-ray `ATL`

**50MB Probe C (Netlify browser XHR)** — sign 295 ms → upload 17.53 s → HTTP 200, ETag present, no CDP `loadingFailed`

**250MB Probe A (Node)** — progress timeline:
- 0–25 s: bytes sent 0 → 67,633,152 (~25.8% of 250 MB)
- 25 s–1030 s: **bytes frozen at 67,633,152** (~17 min idle)
- 1030.88 s: `read ENETUNREACH`, no HTTP response

**250MB Probe B (curl, fresh URL)** — 109.53 s, 262,144,000 bytes, HTTP 200, ~2.4 MB/s

### Success criteria answers

1. **Does a fresh presigned URL eliminate failures?**  
   **Mostly yes for transport at 50MB.** All three transport paths (Node, curl, Netlify browser) succeeded with independent URLs. Failures that remain are **CORS config (Probe D)** and **one Node 250MB stream drop** — not URL reuse. This invalidates prior STREAM-FAILURE-01 curl 502 conclusions tied to shared URLs.

2. **Does failure correlate with browser only?**  
   **No at 50MB.** Netlify browser succeeded alongside Node and curl. The only browser failure (Probe D) is CORS preflight, not mid-stream transport.

3. **Does failure correlate with Netlify only?**  
   **No.** Netlify-origin browser succeeded at 50MB. Localhost failed only because R2 CORS allowlist does not include the harness origin on the live bucket.

4. **Does failure correlate with payload size?**  
   **Partially.** 50MB: 3/4 succeeded (excluding CORS). 250MB: curl succeeded; Node failed after ~64.5 MB with long stall. Suggests **size-sensitive stream instability on at least one client stack**, not a universal R2 rejection.

5. **Is resumable upload actually justified?**  
   **Not yet from this evidence alone.** We have one Node 250MB stall (not browser, not Netlify). Production Path B (browser mid-stream drop on slow uplinks) was **not reproduced** at 250MB because browser probes were capped at 50MB. Before multipart/resumable architecture: (a) apply R2 CORS, (b) run 250MB Probe C from Netlify origin, (c) capture user-network HAR on a failing production upload.

### Comparison to URL-reuse mission (STREAM-FAILURE-01)

| Finding (reuse invalid) | Fresh-URL result (this mission) |
|-------------------------|----------------------------------|
| curl 502 at ~13 MB | curl **200** at 50 MB and **200** at 250 MB |
| Mixed browser/CLI failures | 50MB: consistent success except CORS |
| Could not attribute failure class | Failures now isolate to CORS vs Node stall |

---

## Recommendation

1. **Apply `r2-cors.json` to the live R2 bucket** — unblocks Probe D and local dev parity; no app code change required.
2. **Re-run 250MB Probe C** (Netlify browser XHR) with `RELIABILITY_BROWSER_MAX_MB=250` — this is the closest automated repro of production Path B still missing from this matrix.
3. **Treat Node 250MB `ENETUNREACH` as environment/client-path signal**, not primary production blocker — curl completed the same object on a fresh URL seconds later.
4. **Do not implement multipart/resumable uploads yet** — production browser mid-stream failure at 250MB+ is not established; 50MB fresh-URL path is healthy from Netlify origin.
5. **500MB stress** — defer until 250MB browser probe completes.

Stop here per mission scope: evidence collected, no production changes.
