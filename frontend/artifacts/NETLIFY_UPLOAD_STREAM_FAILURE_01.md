# NETLIFY-UPLOAD-STREAM-FAILURE-01

**Mode:** Investigation only — no upload architecture changes  
**Timestamp:** 2026-07-24T17:42:00.514Z  
**Raw JSON:** `frontend/artifacts/netlify-upload-stream-failure-01.json`  
**Harness:** `frontend/scripts/netlify-upload-stream-failure-01.mjs`

---

## Executive summary

This run **did not reproduce Path B mid-stream failure** from the Netlify production origin in Headless Chrome. The browser XHR PUT **completed HTTP 200** in ~475s.

However, the run **does** produce useful boundary evidence:

| Probe | Origin / transport | Result | Time | Bytes |
|-------|---------------------|--------|------|-------|
| Browser XHR | Netlify production origin | **HTTP 200 complete** | 474.7s | progress API reported 0* |
| Browser XHR | Local harness (`127.0.0.1:8771`) | **ERR_FAILED** | 1.4s | 0 (CORS Path A) |
| curl PUT | CLI (no CORS) | **HTTP 502** | 194.4s | 13,041,664 (~43%) |
| Node https PUT | CLI (no CORS) | **HTTP 200 complete** | 448.1s | 30,223,729 (100%) |

\*Headless Chrome did not advance `xhr.upload.loaded` during the successful Netlify upload (readyState advanced to 4, status 200). Treat browser byte progress in this harness as **unreliable**; use Node samples as the ground-truth progress timeline for this network path.

**Methodology caveat:** All four probes reused **one presigned URL** sequentially. After the successful browser PUT, later probes may behave differently than a fresh sign. Interpret the curl 502 accordingly.

---

## Cleanup applied before investigation (committed, not deployed)

Commit `2077828`:

1. **`r2-cors.json`** — added local dev/preview origins (`127.0.0.1` / `localhost` on ports 4173 and 5173).
2. **`frontend/src/lib/api/media.js`** — omit `X-Upload-Token` on R2 presigned PUTs only; retain for Railway direct uploads and finalize.

**Not deployed:** Netlify frontend, R2 bucket CORS (live bucket still returns **403** for local origin preflight).

---

## Mission questions

### Does the upload fail after a consistent time?

| Probe | Time to outcome |
|-------|-----------------|
| Netlify browser | 474,680 ms → **success** |
| Local browser | 1,379 ms → CORS failure |
| curl | 194,373 ms → **502 mid-upload** |
| Node https | 448,078 ms → **success** |

No single failure-time threshold was observed across probes in this run. The previously reported **150–300s browser ERR_FAILED** pattern did **not** appear from Netlify origin here.

### Does it fail after a consistent byte count?

| Probe | Last bytes sent |
|-------|-----------------|
| curl (failed) | 13,041,664 / 30,223,729 (**43.2%**) |
| Node (success) | 30,223,729 (100%) |
| Browser | progress API unusable (reported 0 throughout) |

The curl failure point (~13 MB) is suggestive but **confounded** by presigned URL reuse after browser success.

### Does progress stall before failure?

Node https baseline shows **steady ~65–70 KB/s** with samples every 2s and **no idle gaps** before completion. This indicates the server-side CLI path from this environment can sustain the full stream.

curl shows upload stopped at 43% without a clean idle-stall signature in sampled data (curl probe lacks interval samples).

### Who closes the connection?

| Evidence | Interpretation |
|----------|----------------|
| Netlify browser → HTTP 200 | Connection completed normally in this run |
| Local browser → `PreflightMissingAllowOriginHeader` | **Browser blocked before PUT** (Path A) |
| curl → HTTP 502 at 43% | **Server/intermediary returned error mid-stream** (needs fresh-URL retest) |
| Node → HTTP 200 ETag returned | R2 accepted full object on retry after curl |

**Best current read:** Path B (mid-stream browser drop) is **intermittent or uplink-specific**, not reproduced in this Headless Chrome run from the CI/server network. Path A remains active for local origins until live R2 CORS is updated.

---

## CORS preflight (post-cleanup header set)

| Origin | HTTP | Allow-Origin |
|--------|------|--------------|
| Netlify production | 204 | `https://strong-lolly-a9fcb4.netlify.app` |
| Local preview (`127.0.0.1:4173`) | 403 | missing |

Preflight now requests only `content-type` (no `x-upload-token`), matching the header cleanup.

---

## Node https progress timeline (reliable)

- **Start → finish:** 448s for 30,223,729 bytes
- **Average rate:** ~67 KB/s
- **Pattern:** monotonic progress every 2s, no multi-interval stalls
- **Response:** HTTP 200 with ETag

This establishes that **from this environment**, a non-browser PUT can complete the full object on a fresh stream.

---

## Hypotheses ranked

| # | Hypothesis | Confidence | Notes |
|---|------------|------------|-------|
| 1 | Path B is **intermittent / network-path dependent** | **High** | Netlify browser succeeded here; prior reports failed after 150–300s |
| 2 | Path A still blocks **local dev** until R2 bucket CORS applied | **Very High** | Local probe failed in 1.4s with CORS error |
| 3 | curl 502 at ~13 MB may be **URL reuse artifact** | **Medium** | Needs per-probe fresh sign |
| 4 | Headless `xhr.upload.loaded` is **not trustworthy** for byte accounting | **High** | 0 loaded despite HTTP 200 success |
| 5 | Multipart/resumable uploads **not yet justified** by this single run | **Medium** | One successful browser completion; retry with fresh URLs + user-network HAR first |

---

## Recommended next steps (no architecture change yet)

1. **Apply `r2-cors.json` to the live R2 bucket** (ops step — unblocks local Path A testing).
2. **Re-run harness with a fresh presigned URL per probe** to deconfound curl/node results.
3. **Capture production-user HAR** on a failing upload (progress timeline + CDP) — still the best way to confirm Path B stall vs active-stream cut on real uplinks.
4. **Do not implement multipart/resumable uploads** until Path B is reproduced with reliable byte progress under fresh URLs.

---

## Files

| File | Role |
|------|------|
| `frontend/scripts/netlify-upload-stream-failure-01.mjs` | Investigation harness |
| `frontend/artifacts/netlify-upload-stream-failure-01.json` | Raw structured results |
| `r2-cors.json` | Dev origin allowlist (reference; apply to bucket) |
| `frontend/src/lib/api/media.js` | R2 PUT header cleanup (committed, not deployed) |
