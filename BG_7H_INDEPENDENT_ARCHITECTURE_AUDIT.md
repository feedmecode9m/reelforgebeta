# BG-7H — Independent Architecture Audit (No Code Changes)

**Role:** Independent principal backend engineer review  
**Scope:** Validate or falsify: *"Remaining bottleneck is transport bandwidth + Railway request-body timeout, not Netlify and not application code."*  
**Method:** Repository read + production measurements (`/tmp/bg7h-transport-certification.json`)  
**Code modified:** None

---

## A. Upload Request Path Diagram

### Small files (< 25 MB, FormData path)

```
Browser (Netlify origin: *.netlify.app)
  │  POST /api/reels  (multipart body)
  ▼
Netlify Edge redirect (netlify.toml → Railway)
  │  proxy /api/* → reelforge-deploy-production.up.railway.app
  ▼
Railway public ingress (TLS terminate, ~300s body limit applies here too)
  ▼
Actix App (main.rs)
  │  wrap: CORS → NoCompress → Logger → DefaultHeaders
  │  scope /api + AdminAuth middleware
  ▼
handlers::create_reel (handlers.rs:186)
  ▼
ingest_from_reel_multipart (ingestion/upload.rs:313)
  ▼
media_api::parse_reel_multipart → read_multipart_upload (media_api.rs:148)
  │  ⚠ buffers entire field into Vec<u8> in memory
  ▼
ingest pipeline → DB row → async worker → ffmpeg thumbnail
```

**Netlify involved:** YES (full request body proxied).

---

### Large files (signed path, ≥ 25 MB threshold in prod bundle)

```
Browser (Netlify origin)
  │
  ├─ POST /api/uploads/sign  (JSON only, ~1 KB)
  │    → Netlify → Railway → AdminAuth → signed_upload::sign_upload
  │    ← uploadUrl = https://reelforge-deploy-production.up.railway.app/api/uploads/direct/{id}
  │
  ├─ PUT uploadUrl  (video bytes, NO Netlify)
  │    Browser ──TLS──► Railway ingress ──► Actix (direct route OUTSIDE AdminAuth)
  │    signed_upload::direct_upload (signed_upload.rs:222)
  │    stream Payload chunks → tokio::fs::File (.partial) → rename → videos/
  │
  └─ POST /api/reels/finalize  (JSON only)
       → Netlify → Railway → AdminAuth → signed_upload::finalize_reel
       → ingest_stored_video → DB → worker → ready
```

**Netlify involved for PUT body:** **NO** — confirmed in code and production:

- `direct_upload_public_base()` builds Railway URL (`signed_upload.rs:80–87`, `201–202`)
- Frontend `fetch(uploadUrl, { method: 'PUT', body: file })` uses server-returned URL (`media.js:206–224`)
- BG-7H measurements: `uploadUrlHost` = `reelforge-deploy-production.up.railway.app`, `netlifyInvolved: false` on all PUT tests

---

## B. Every Timeout Discovered

| Location | Default | Configured in ReelForge | Matches ~300s failures? | Evidence |
|----------|---------|-------------------------|-------------------------|----------|
| **Railway public edge — request body upload window** | 300 s (platform docs: "Request bodies must finish uploading within 5 minutes") | Not configurable in `railway.toml` | **YES** | PUT failures at 300.2–300.7 s, HTTP 502; bytes still flowing |
| **Railway public edge — idle / overall request** | 900 s max with data transfer (15 min platform max) | N/A | No — failures occur at 300s while data flows | Railway networking specs |
| **Actix `HttpServer::client_request_timeout`** | 5 s (actix-web 4.14 default) | **Not set** (`main.rs:669–670` only `.bind().run()`) | **NO** | 10 MB PUT succeeds in **155 s** — falsifies 5 s total-body timeout as active ceiling |
| **Actix `PayloadConfig` read timeout** | None explicit | 100 MiB global (`main.rs:275`); 600 MiB on direct route (`main.rs:291`) | No | Failures at 300s with partial bytes below limits |
| **sqlx pool `acquire_timeout`** | — | 5 s (`main.rs:149`) | No | DB pool only |
| **Signed session TTL floor** | — | `max(300, env)` seconds (`signed_upload.rs:46–50`) | No | Session expiry is 3600s in prod sign responses |
| **ffmpeg subprocess** | — | 30 s (`ingestion/ffmpeg.rs:8`) | No | Post-upload ingest only |
| **CORS `max_age`** | — | 3600 s (`main.rs:81`) | No | Preflight cache only |
| **Dockerfile / Railway deploy** | — | No proxy, no nginx, no timeout env | No app-level 300s | `backend/Dockerfile`, `railway.toml` |
| **curl client `--max-time`** | — | 400 s in BG-7H harness | No | curl exit 0 on 502; not client abort |

**Conclusion on 300 s:** No Rust source contains a 300-second request timeout. The observed **300.2–300.7 s** termination correlates with **Railway ingress**, not Actix configuration.

---

## C. Every Upload Size Limit

| Layer | Limit | Source |
|-------|-------|--------|
| Actix global payload | **100 MiB** (104,857,600) | `main.rs:275` |
| Actix direct PUT route | **600 MiB** | `main.rs:291` |
| Signed upload store | **2 GiB** default (`SIGNED_UPLOAD_MAX_BYTES`) | `signed_upload.rs:53–56` |
| Railway production env | `UPLOADS_MAX_VIDEO_BYTES=2147483648` (2 GiB) | Railway variables (prior deploy audit) |
| Sign request validation | `size_bytes > store.max_bytes` → 400 | `signed_upload.rs:160–163` |
| Direct PUT runtime | `total > max_bytes` → 413 PayloadTooLarge | `signed_upload.rs:297–301` |
| Small multipart path | Inherits **100 MiB** PayloadConfig on `/api/reels` POST | `main.rs:275` + `create_reel` |
| Netlify Edge (legacy POST /api/reels) | ~instant 400 for large bodies (historical); bypassed by signed PUT | BG-7G.2 artifacts |
| **Effective production ceiling (this network)** | **~10 MB completes; ≥25 MB fails at 300 s** | BG-7H measured matrix |

362 MB is **below** all application byte limits. It fails on **time**, not declared size caps.

---

## D. Request Body Buffering vs Streaming

| Path | Behavior | File / function |
|------|----------|-----------------|
| **Signed PUT `/api/uploads/direct/{id}`** | **Streams** — `while let Some(chunk) = payload.next().await` → `file.write_all` | `signed_upload.rs:287–308` |
| **Small POST `/api/reels`** | **Buffers entire file** in `Vec<u8>` | `media_api.rs:187–195` `read_multipart_upload` |
| **finalize / sign** | JSON only, no file body | `signed_upload.rs:144–220, 360–447` |
| **NoCompress middleware** | Strips response `Content-Encoding` on media paths only | `no_compress.rs:62–72` — does not touch request bodies |
| **AdminAuth** | Checks Bearer header only | `auth.rs:134–138` — does not read body |
| **CORS** | Header handling | `main.rs:62–143` — does not buffer PUT |

The large-upload path is implemented as **incremental disk streaming**, not in-memory buffering of the full file.

---

## E. Hypothesis Checklist (1–9)

### 1. Actix body configuration — **FALSIFIED as root cause**

- `PayloadConfig` on direct route = 600 MiB — larger than 362 MB.
- Global 100 MiB limit applies to `/api` scope routes, **not** the direct PUT resource registered outside that scope (`main.rs:289–293`).
- No `DefaultBodyLimit` middleware found in codebase.

### 2. Railway reverse proxy — **CONFIRMED as hard ceiling**

- No nginx in container (`Dockerfile:36` runs `./backend` directly).
- Railway public ingress sits in front (TLS to `*.up.railway.app`).
- 502 `upstream error` at ~300 s with continuous upload throughput matches Railway documented **5-minute request-body upload limit**.
- No Cloudflare/nginx config in repo; IP resolves to Railway edge (69.46.46.35 in verbose curl).

### 3. Streaming implementation — **CONFIRMED streaming; not the failure mode**

- Handler uses async `web::Payload` iteration and `tokio::fs::File` writes (`signed_upload.rs:287–308`).
- Successful 5 MB / 10 MB uploads prove handler completes when given enough time.

### 4. Tokio / blocking — **NOT implicated**

- Writes use `tokio::fs::File` + `AsyncWriteExt::write_all` (async).
- Final `rename` is async (`signed_upload.rs:328`).
- No `spawn_blocking` on upload hot path.

### 5. Filesystem — **NOT implicated**

- Writes to `{reel_id}.mp4.partial` then atomic rename — standard streaming pattern.
- Volume mounted at `/app/public` on Railway — 10 MB uploads reach `ready` ingest.

### 6. Accidental middleware — **NOT implicated for PUT failure**

| Middleware | Touches request body? | On direct PUT? |
|------------|----------------------|----------------|
| CORS | No | Yes (wraps all) |
| NoCompress | Response only | Yes |
| Logger | Access log only | Yes |
| AdminAuth | Header only | **No** — route outside `/api` scope |

### 7. Netlify on PUT — **ELIMINATED**

- Code: `uploadUrl` points to Railway (`signed_upload.rs:201–202`, `media.js:206–217`).
- Measurement: all BG-7H sign responses return Railway host; curl verbose shows direct TLS to `reelforge-deploy-production.up.railway.app`.
- Netlify still proxies **sign** and **finalize** JSON calls — irrelevant to PUT bytes.

### 8. Railway deployment configuration — **Partial**

- `railway.toml`: healthcheck, Docker build — **no timeout/memory overrides**.
- No in-repo Railway setting for 300 s — it is **platform networking**, not app config.
- Memory/CPU limits not cited as cause: uploads fail at predictable time with steady throughput, not OOM/kill patterns.

### 9. Rust code explaining hard 300 s — **NONE FOUND**

- Grep across `backend/` shows no 300-second HTTP/server timeout.
- `SIGNED_UPLOAD_TTL_SECONDS` uses `.max(300)` as **minimum TTL floor**, not HTTP timeout (`signed_upload.rs:50`).

---

## F. Verdict on the Statement

> *"The remaining bottleneck is transport bandwidth combined with Railway request-body timeout, not Netlify and not the application code."*

### **Confidence: HIGH**

| Component | Role | Confidence |
|-----------|------|------------|
| Local/client uplink ~64 KB/s | Primary — sets minimum transfer duration | HIGH (Railway PUT measured + speedtest 0.5 Mbps) |
| Railway ~300 s body-upload limit | Hard ceiling — terminates in-flight uploads | HIGH (502 at 300.2–300.7 s; partial bytes prove active transfer) |
| Netlify on large PUT | Eliminated | HIGH |
| Application sign/finalize/ingest | Works when PUT completes | HIGH (5/10 MB → ready) |
| Actix size limits | Not reached for 362 MB | HIGH |
| Browser implementation | Not tested in BG-7H curl harness; prior failures were Playwright OOM on 362 MB base64, not 502 at 300 s | MEDIUM for browser-specific paths |

### Why HIGH (not merely MEDIUM)

1. **Controlled falsification:** 10 MB completes in 155 s → rules out Actix 5 s default, 100 MiB cap on direct route, and ingest bugs for successful paths.
2. **Exact time correlation:** 25/50/80/100 MB all fail at **300 ± 0.7 s**, not at size-dependent times — signature of **platform wall**, not app logic.
3. **Bytes flowing until cut:** 25 MB test sent **76.8%** before 502 — rules out stall/middleware abort at start.
4. **Netlify bypass verified** in code + host telemetry.

### Arithmetic (362 MB)

- Measured PUT throughput: **~64.5 KB/s** average (BG-7H matrix)
- Time required: **362 MB ÷ 0.064 MB/s ≈ 5,881 s (~98 min)**
- Railway body window: **~300 s**
- Max deliverable in window: **300 × 64.5 KB/s ≈ 18.5–19 MB** — matches 25 MB failure at 20.1 MB sent

---

## G. Recommendation

### **No further application changes are recommended** based on current evidence.

The signed-upload architecture behaves as designed. Failures above ~10 MB from this verifier network are **expected** given measured uplink + Railway ingress policy.

**Evidence-only follow-ups** (not code rewrites):

1. Re-run BG-7H matrix from a network with ≥ **1.2 MB/s** sustained uplink — minimum to complete 362 MB within 300 s.
2. If product must support 362 MB from slow networks, that requires **new evidence** that Railway's 300 s body limit can change — not visible in this repo.

Do **not** spend engineering time "fixing Netlify" for large upload bodies — Netlify is not on the PUT path.

---

## Appendix — Production Measurement Summary (BG-7H)

| Size | PUT HTTP | Duration | Bytes sent | Finalize | Ingest |
|------|----------|----------|------------|----------|--------|
| 5 MB | 200 | 94 s | 100% | 202 | ready |
| 10 MB | 200 | 155 s | 100% | 202 | ready |
| 25 MB | 502 | 300.2 s | 76.8% | 409 | — |
| 50 MB | 502 | 300.3 s | 36.8% | 409 | — |
| 80 MB | 502 | 300.7 s | 24.0% | 409 | — |
| 100 MB | 502 | 300.2 s | 18.9% | 409 | — |

**Largest successful production upload (this network): 10 MB**  
**Failure boundary: >10 MB and ≤25 MB**  
**Connection closed by: Railway edge/proxy (~300 s), not curl client**

Raw JSON: `/tmp/bg7h-transport-certification.json`
