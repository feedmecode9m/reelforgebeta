# NETLIFY-R2-PUT-ROOTCAUSE-01

**Mode:** Investigation only — no production behavior changes  
**Timestamp:** 2026-07-24T17:14:58Z  
**Raw JSON:** `frontend/artifacts/netlify-r2-put-rootcause-01.json`  
**Harness:** `frontend/scripts/netlify-r2-put-rootcause-01.mjs` (diagnostic only)

---

## Executive Summary

Two distinct failure modes were identified:

| Context | First boundary | Chrome error | Time to fail | HTTP response from R2 |
|---------|----------------|--------------|--------------|------------------------|
| **Wrong Origin** (local/preview) | **CORS preflight** | `net::ERR_FAILED` + **`PreflightMissingAllowOriginHeader`** | ~80–430ms | OPTIONS **403**, no `Access-Control-Allow-Origin` |
| **Production Netlify Origin** | **PUT body upload stream** | `net::ERR_FAILED` / `TypeError: Failed to fetch` | ~150–300s+ | No response (PUT never completes) |
| **curl (non-browser)** | none | n/a | ~430s for 30MB | **HTTP 200**, cf-ray present |

**curl proves:** presigned URL, signature, TLS, and R2 object write path are all valid.

---

## Timeline

### Instrumented harness (Origin: `http://127.0.0.1:8765`, 1KB)

| Elapsed | Event |
|---------|-------|
| +0ms | Sign request |
| +255ms | `UPLOAD_SIGN_SUCCESS` (HTTP 200) |
| +256ms | `UPLOAD_PUT_BEGIN` |
| +369ms | Browser sends **OPTIONS preflight** to R2 |
| +369ms | R2 returns **403** (Origin not in CORS allowlist) |
| +369ms | Chrome blocks PUT: **`PreflightMissingAllowOriginHeader`** → `net::ERR_FAILED` |
| — | **PUT body never sent**; finalize never starts |

### Instrumented harness (30MB, same wrong Origin)

| Elapsed | Event |
|---------|-------|
| +431ms | Same CORS preflight failure — **not a timeout** |

### Production Netlify (prior missions + curl corroboration)

| Elapsed | Event |
|---------|-------|
| ~255ms | Sign HTTP 200 |
| ~256ms | PUT request issued to R2 (CORS preflight **204** for Netlify origin) |
| 150–300s+ | `fetch` throws `Failed to fetch` mid-stream, no HTTP status |
| — | finalize never starts |

### curl 30MB (same presigned URL pattern)

| Elapsed | Event |
|---------|-------|
| 429.95s | HTTP **200 OK**, CF-RAY `a20485c0abd9120e-MIA`, ETag returned |

---

## Task 1 — Complete Presigned PUT Request (secrets redacted)

| Field | Value |
|-------|-------|
| **PUT URL host** | `f4531bb32bae84de2da9f682afed23e9.r2.cloudflarestorage.com` |
| **Object key** | `prod/{reelId}.mp4` |
| **x-id** | `PutObject` |
| **X-Amz-Algorithm** | `AWS4-HMAC-SHA256` |
| **X-Amz-SignedHeaders** | `content-type;host` |
| **X-Amz-Expires** | `3600` seconds |
| **X-Amz-Date** | `20260724T170737Z` (example) |
| **X-Amz-Credential** | `[REDACTED]` |
| **X-Amz-Signature** | `[REDACTED]` |

**Application request headers (browser):**

| Header | Value | In signature? |
|--------|-------|---------------|
| `Content-Type` | `video/mp4` | **Yes** (signed) |
| `Content-Length` | `file.size` (implicit on File body) | bound via body |
| `X-Upload-Token` | present (Railway direct-upload legacy) | **No** — triggers extra CORS preflight header |
| `Origin` | page origin (e.g. Netlify or localhost) | n/a (CORS layer) |
| `Referer` | page URL | not signed |
| `User-Agent` | Chrome/HeadlessChrome | not signed |

**R2 CORS configuration** (`r2-cors.json`): allows origin **`https://strong-lolly-a9fcb4.netlify.app`** only.

---

## Task 2 — Complete Browser Network Failure

### Playwright surface error

```
net::ERR_FAILED
```

### Chrome DevTools Protocol (internal classification)

```json
{
  "errorText": "net::ERR_FAILED",
  "corsErrorStatus": {
    "corsError": "PreflightMissingAllowOriginHeader",
    "failedParameter": ""
  }
}
```

**Not observed in this run:** `ERR_HTTP2_PROTOCOL_ERROR`, `ERR_CONNECTION_RESET`, `ERR_NETWORK_CHANGED`, `ERR_BLOCKED_BY_CLIENT`, `ERR_CERT_AUTHORITY_INVALID`, `ERR_SSL_PROTOCOL_ERROR`, `ERR_CONTENT_LENGTH_MISMATCH`.

**JavaScript exception:** `TypeError: Failed to fetch` (browser wraps CORS/network abort).

**Production long-upload failures** (prior traces): same `net::ERR_FAILED` but **after PUT is in flight** (no CORS block; stream timeout/drop).

---

## Task 3 — Browser vs curl Side-by-Side

| Attribute | curl 1KB | curl 30MB | Browser (wrong origin) | Browser (Netlify origin, prod) |
|-----------|----------|-----------|------------------------|--------------------------------|
| Method | PUT | PUT | PUT (blocked) | PUT |
| Content-Type | `video/mp4` | `video/mp4` | `video/mp4` | `video/mp4` |
| Content-Length | 1024 | 30,223,729 | 1024 / 30MB | 30MB+ |
| X-Upload-Token | optional | absent in test | present (app default) | present |
| Origin | none | none | `http://127.0.0.1:*` | `https://strong-lolly-a9fcb4.netlify.app` |
| User-Agent | curl/8.x | curl/8.x | HeadlessChrome/148 | Chrome |
| Transfer-Encoding | none (CL) | none (CL) | n/a (blocked) | chunked stream from File |
| Expect | `100-Continue` (30MB) | yes | n/a | browser-managed |
| HTTP version | 1.1 | 1.1 | n/a | HTTP/2 (typical) |
| TLS | TLS 1.3 | TLS 1.3 | TLS opens, preflight fails | TLS 1.3 |
| CORS preflight | not applicable | not applicable | **403** | **204** |
| Result | **200** | **200** in 430s | **ERR_FAILED** ~400ms | **ERR_FAILED** 150–300s+ |
| cf-ray | yes | `a20485c0abd9120e-MIA` | none | none on failure |

---

## Task 4 — fetch() Body Verification

Production code (`media.js`):

```javascript
body: file   // File from drag/drop DataTransfer
```

Harness inspection:

```json
{
  "constructor": "File",
  "isFile": true,
  "isBlob": true,
  "size": 30223729,
  "type": "video/mp4",
  "name": "probe_30m_b.mp4",
  "lastModified": 1784913294410
}
```

Not ArrayBuffer, ReadableStream, or Uint8Array at call site — **native File/Blob**.

---

## Task 5 — Browser Permissions / Policy

| Policy | Netlify production | Local harness |
|--------|-------------------|---------------|
| **CORS** | Preflight **204**, ACAO matches | Preflight **403**, **PreflightMissingAllowOriginHeader** |
| Mixed content | HTTPS page → HTTPS R2 OK | HTTP page → HTTPS R2 OK (secure context) |
| CSP | **Not set** on index | none |
| CORP / COEP / COOP | **Not set** | none |
| Service Worker | registered, **no-op** handler | n/a |
| Private Network Access | n/a | `localNetworkAccessRequestPolicy: PermissionBlock` on localhost fetches (file load only) |
| Extensions | n/a in headless | n/a |

**CORS is the controlling browser policy** for wrong-origin PUT. Production Netlify origin passes CORS.

---

## Task 6 — R2 Signature Compatibility

| Check | Result |
|-------|--------|
| Signed headers | `content-type;host` only |
| App sends `Content-Type: video/mp4` | **Matches** signed content-type |
| App sends `X-Upload-Token` | **Not in signature** — does not break curl; adds CORS preflight header `x-upload-token` |
| curl with token | HTTP **200** |
| curl without token | HTTP **200** |
| URL / key encoding | Valid SigV4 query string |
| Signature mismatch | **Ruled out** (curl succeeds with identical URL) |

---

## Task 7 — TLS Negotiation

```
CONNECTION ESTABLISHED
Protocol version: TLSv1.3
Ciphersuite: TLS_AES_256_GCM_SHA384
Peer certificate: CN = r2.cloudflarestorage.com
Verification: OK
```

Browser **does open TLS** to R2 (OPTIONS preflight reaches Cloudflare). Failure on wrong origin is **after TLS, at CORS layer**. Production failure is **after successful preflight, during PUT upload**.

---

## Task 8 — fetch() vs XMLHttpRequest (diagnostic harness only)

Both fail identically on wrong origin:

| Transport | 1KB result | CDP corsError |
|-----------|------------|---------------|
| fetch | `TypeError: Failed to fetch` | `PreflightMissingAllowOriginHeader` |
| XMLHttpRequest | `xhr.onerror`, status 0 | `PreflightMissingAllowOriginHeader` |

**No transport advantage:** XHR does not bypass CORS preflight.

---

## Task 9 — Ranked Root Cause Analysis

| Rank | Cause | Confidence | Applies when |
|------|-------|------------|--------------|
| **1** | **CORS origin not allowlisted on R2** → preflight 403 → `PreflightMissingAllowOriginHeader` | **Very High** | localhost, preview, any non-Netlify origin |
| **2** | **Long PUT upload stream drop** before R2 responds (slow uplink, browser fetch timeout) | **High** | Production Netlify, large files |
| **3** | **`X-Upload-Token` triggers extra preflight header** (allowed on Netlify, irrelevant to curl) | Medium | All browser uploads using app code |
| **4** | Signature / Content-Type mismatch | **Ruled out** | curl 200 on same URLs |
| **5** | TLS / certificate failure | **Ruled out** | openssl OK, preflight reaches Cloudflare |
| **6** | AbortController / app cancellation | **Ruled out** | prior audit |
| **7** | CSP / Service Worker | **Ruled out** | |

---

## Task 10 — First Failing Transport Boundary

### Path A — Non-Netlify origin (explains ~787ms failures in local diagnostics)

```
OPTIONS preflight → R2 403 (no Access-Control-Allow-Origin)
→ Chrome: PreflightMissingAllowOriginHeader
→ net::ERR_FAILED
→ PUT never sent → no cf-ray → finalize blocked
```

### Path B — Production Netlify origin (explains user-reported large upload failures)

```
OPTIONS preflight → R2 204 ✓
→ PUT begins streaming File body
→ [150–300+ seconds]
→ connection drop: net::ERR_FAILED (no HTTP response)
→ finalize blocked
```

**curl control:** same PUT URL completes in ~430s → boundary is **browser cross-origin upload transport**, not R2 auth.

---

## Recommended Smallest Code Change (NOT implemented)

1. **Infrastructure:** Add all deployment origins to R2 CORS (preview URLs, localhost if needed for dev) — fixes Path A only.
2. **App (minimal):** Stop sending `X-Upload-Token` on R2 presigned PUTs (header is for Railway direct upload only) — reduces preflight surface.
3. **App (production fix for Path B):** Replace monolithic `fetch(File)` with S3-compatible **multipart upload** — addresses slow-uplink stream drops without changing Netlify/Railway.

---

## Files Modified

| File | Purpose |
|------|---------|
| `frontend/scripts/netlify-r2-put-rootcause-01.mjs` | Investigation harness only |
| **No production upload, Netlify, or Railway code changed** |
