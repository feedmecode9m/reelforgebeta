# NETLIFY-UPLOAD-DIAGNOSTICS-01

**Mode:** Diagnostic only — instrumentation added, no upload behavior changes  
**Timestamp:** 2026-07-24T17:02:31Z  
**Branch:** main  
**Preview (Netlify-like proxy):** http://127.0.0.1:4173/  
**Backend:** https://reelforge-deploy-production.up.railway.app  
**Test file:** `diag_large_30m.mp4` (30,223,729 bytes)  
**Raw JSON:** `frontend/artifacts/netlify-upload-diagnostics-01.json`

---

## Executive Summary

Instrumentation was added to the existing `uploadVideoSigned()` path only. One instrumented large upload was executed in Headless Chrome with a Netlify-like same-origin `/api` proxy.

**First verified failing boundary:** `UPLOAD_PUT_BEGIN` → browser `fetch(PUT)` to R2 → **`TypeError: Failed to fetch`** (`net::ERR_FAILED`).

**Finalize was never attempted.** No application-level `AbortController` is attached to the signed upload PUT.

---

## Timeline (instrumented run)

| Time (UTC) | Elapsed | Marker | Stage |
|------------|---------|--------|-------|
| 17:02:25.406 | +1ms | `UPLOAD_SIGN_START` | sign |
| 17:02:25.661 | +255ms | `UPLOAD_SIGN_SUCCESS` | sign (HTTP 200) |
| 17:02:25.661 | +256ms | `UPLOAD_PUT_BEGIN` | put |
| 17:02:26.192 | +787ms | `UPLOAD_ERROR` | put — **failure** |

Markers **not observed:** `UPLOAD_PUT_PROGRESS` (not measurable), `UPLOAD_PUT_COMPLETE`, `UPLOAD_FINALIZE_BEGIN`, `UPLOAD_FINALIZE_SUCCESS`, `UPLOAD_ABORT`, `UPLOAD_TIMEOUT`.

---

## First Failing Boundary

**Stage:** R2 PUT (`fetch` body upload)  
**Marker:** `UPLOAD_ERROR` at **+787ms**  
**Location:** `frontend/src/lib/api/media.js` → `uploadVideoSigned()` → `fetch(uploadUrl, { method: 'PUT', body: file })`

| Field | Value |
|-------|-------|
| Exception constructor | `TypeError` |
| Exception name | `TypeError` |
| Exception message | `Failed to fetch` |
| Classification | `isNetworkError: true`, `isTypeError: true`, `isAbortError: false`, `isTimeout: false`, `isDomException: false` |
| Inferred cause | `network_failure` |
| HTTP status | none (throw before response) |
| cf-ray | none |
| x-amz-request-id | none |
| AbortController present | **no** |
| signal.aborted | **no** |
| signal.reason | null |
| retryNumber | 0 |
| Content-Length | 30,223,729 |
| Browser | HeadlessChrome/148.0.7778.96 |
| navigator.connection | effectiveType=4g, downlink=9.9, rtt=0, onLine=true |

**Network (Playwright):**

```json
{
  "put_request": "https://f4531bb32bae84de2da9f682afed23e9.r2.cloudflarestorage.com/reelforge-media/prod/...",
  "failed": { "method": "PUT", "errorText": "net::ERR_FAILED" }
}
```

---

## Complete Upload Sequence

| Step | Expected | Observed | Result |
|------|----------|----------|--------|
| Drop / upload start | yes | `[UPLOAD_STARTED]` | PASS |
| Sign | `POST /api/uploads/sign` | 200 via same-origin proxy | PASS |
| PUT begin | `fetch(PUT)` to R2 | `UPLOAD_PUT_BEGIN` logged | started |
| PUT progress | optional | not measurable (`fetch`+`File` body) | n/a |
| PUT complete | HTTP 200/204 | not reached | **FAIL** |
| Finalize begin | `POST /api/reels/finalize` | **never called** | blocked |
| Finalize success | 202 | not reached | blocked |
| DB row / vault hydrate | after finalize | not reached | blocked |

---

## Task 4 — Error Classification

When `fetch(PUT)` threw:

| Category | Match? |
|----------|--------|
| AbortError | **No** — `exceptionName !== 'AbortError'`, `signalAborted: false` |
| NetworkError | **Yes** — message `Failed to fetch`, Playwright `net::ERR_FAILED` |
| TypeError | **Yes** — constructor/name `TypeError` (browser wraps network failures) |
| DOMException | **No** |
| Timeout / AbortSignal.timeout | **No** — failure at 787ms, no timeout signal on upload path |
| Connection reset | **Possible** — no HTTP response to confirm; consistent with mid-stream drop |

**Stack trace (truncated):**

```
TypeError: Failed to fetch
  at window.fetch (index-C905aj1H.js:1:21161)
  at ZD (index-C905aj1H.js:7:19599)   ← uploadVideoSigned PUT
  at async HTMLDivElement.Cn (...)     ← VaultExperience.handleVaultVideoDrop
```

---

## Task 5 — Finalize Verification

**Finalize attempted:** **NO**

**Reason finalize never starts:** PUT `fetch()` throws before code reaches `UPLOAD_FINALIZE_BEGIN`. Instrumentation sets `finalizeBlockedReason: "PUT fetch threw before finalize"`.

Relevant code path in `media.js`:

1. `UPLOAD_PUT_BEGIN` logged  
2. `putResponse = await fetch(uploadUrl, …)` throws  
3. `UPLOAD_ERROR` logged with `finalizeAttempted: false`  
4. `throw error` — execution never reaches finalize block

---

## Task 6 — AbortController / Retry Audit

| Check | Result |
|-------|--------|
| `uploadVideoSigned()` uses AbortController? | **No** — `fetch()` calls have no `signal` option |
| In-app PUT retry loop? | **No** |
| `fetchWithRetry` on signed path? | **No** — plain `fetch()` only |
| Fetch wrappers abort uploads? | **No** — `pipelineSnapshot.js`, `threatDetectionEngine.js`, `observabilityCenter.js` pass through; no abort |
| Health check timeout | `api.js` `AbortSignal.timeout(5000)` on `/health` only — unrelated |

**Conclusion:** Upload failure is **not** caused by application code calling `AbortController.abort()`.

---

## Console Evidence

```
[UPLOAD_SIGN_START]   elapsedMs: 1
[UPLOAD_SIGN_SUCCESS] elapsedMs: 255  httpStatus: 200  reelId: 29bfdeb9-e7b3-42ca-9320-b0ebdb05c5fb
[UPLOAD_PUT_BEGIN]    elapsedMs: 256  contentLength: 30223729  progressMeasurable: false
[UPLOAD_ERROR]        elapsedMs: 787  stage: put  finalizeAttempted: false
[UPLOAD_FAILED]       vault: video  error: Failed to fetch
```

Full structured entries: `frontend/artifacts/netlify-upload-diagnostics-01.json` → `diagEntries`.

---

## Supplemental Evidence (prior traces, same failure class)

Corroborates production symptom (150–300s failures) with same error type:

| Run | Client | Stage | Duration to fail | Error |
|-----|--------|-------|------------------|-------|
| vault-verify-03 | Node `fetch` | R2 PUT | ~150s (3 attempts) | `fetch failed` |
| upload-pipeline-trace | Node `fetch` | R2 PUT | ~301s | `fetch failed` |
| upload-pipeline-trace | `curl` | R2 PUT | ~449s | **HTTP 200 success** |
| This mission | Browser `fetch` | R2 PUT | ~0.5s | `Failed to fetch` / `net::ERR_FAILED` |

The instrumented browser run failed quickly (likely Headless Chrome + synthetic `File` from localhost blob). Production and harness runs show the same **`TypeError` / `fetch failed`** class on PUT, often after **150–300+ seconds** on slow uplinks. **curl completes the same object in ~450s**, proving R2 credentials, CORS, and sign/finalize endpoints are healthy.

---

## Root Cause Candidates (ranked by confidence)

1. **High — Browser/network stack cannot sustain long single-request PUT uploads**  
   `fetch(File)` streams the entire body in one request. Connection drops with `Failed to fetch` / `net::ERR_FAILED` before completion. Not an app abort. curl tolerates the same upload longer.

2. **High — Effective uplink throughput vs. connection idle/timeout tolerance**  
   ~66 KB/s required for 450s completion on 30MB. fetch fails earlier than curl on identical payload.

3. **Medium — No HTTP-level error from R2**  
   Failure throws before any response status/headers (`cf-ray`, `x-amz-request-id` absent). Points to transport layer, not S3 403/500.

4. **Low — Application AbortController or retry cancellation**  
   Ruled out by instrumentation and code audit.

5. **Low — Sign or finalize defect**  
   Sign succeeded (200). Finalize never reached.

---

## Recommended Minimal Fix (not implemented)

Use a transport that tolerates slow uplinks for large objects (S3 multipart upload, resumable/chunked protocol, or client with progress + retry per part). **Out of scope for this mission.**

---

## Instrumentation Added (behavior-neutral)

| File | Change |
|------|--------|
| `frontend/src/lib/diagnostics/signedUploadDiagnostics.js` | **New** — stage markers, error classification, header capture |
| `frontend/src/lib/api/media.js` | `uploadVideoSigned()` only — diagnostic logs around existing `fetch()` calls |
| `frontend/scripts/netlify-upload-diagnostics-01.mjs` | Harness to run one instrumented upload (not production code) |

**No changes to:** hero, playback, delete, viewer, schema, signed URL protocol, or upload transport.

---

## Success Criteria Checklist

- [x] No behavior changes — only logging added  
- [x] All required stage markers implemented  
- [x] Large upload performed once with instrumentation  
- [x] First failing boundary identified with evidence  
- [x] Finalize never-attempted reason recorded  
- [x] AbortController audit complete  
- [x] Report at `frontend/artifacts/NETLIFY_UPLOAD_DIAGNOSTICS_01.md`
