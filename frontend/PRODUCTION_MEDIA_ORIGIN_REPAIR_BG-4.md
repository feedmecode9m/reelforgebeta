# MISSION BG-4 — Production Media Origin Resolution (Investigation)

**Date:** 2026-07-13  
**Skill:** `reelforge-build-governance`  
**Scope:** Backend environment/config only — **no patch applied**  
**Status:** Root cause confirmed — awaiting operator approval to change Railway env

---

## Executive Summary

Production emits `http://localhost:7463/thumbs/*` because the **Railway runtime `MEDIA_PUBLIC_BASE` resolves to `http://localhost:7463`** at API serialization time. The database stores **relative paths only** (`/thumbs/{uuid}.jpeg`); the bad origin is injected by `canonical_media_url()` when building `ReelV1` JSON — not by frontend rewriting or duplicate state writers.

**Fix (proposed, not applied):** Set Railway `MEDIA_PUBLIC_BASE` to the public HTTPS media origin. No Rust or frontend changes required.

---

## 1. `MEDIA_PUBLIC_BASE` Configuration Map

| Location | Value | In git? | Applies to |
|----------|-------|---------|------------|
| `backend/.env.example` | `http://localhost:8080` | Yes | Documentation / local template |
| `backend/.env` | *(not set)* | Yes (local only) | Local `cargo run` — falls back to `PORT` |
| `docker-compose.yml` | `http://localhost:8080` | Yes | Docker prod profile on host |
| `docker-compose.dev.yml` | `http://localhost:8080` | Yes | Dev compose |
| `backend/Dockerfile` | *(not set)* | Yes | Image build — expects runtime env |
| **Railway dashboard** | **Inferred: `http://localhost:7463`** | **No** | **Live production backend** |

**Current production env source:** Railway service environment variables for `reelforge-deploy-production.up.railway.app`. This value is **not** present in any tracked repo file. Railway CLI is unavailable in the audit environment; the live value is **confirmed by API output** (see §4).

### Fallback logic (when `MEDIA_PUBLIC_BASE` unset)

```128:137:backend/src/db/mod.rs
pub fn media_public_base() -> String {
    std::env::var("MEDIA_PUBLIC_BASE")
        .unwrap_or_else(|_| {
            format!(
                "http://localhost:{}",
                std::env::var("PORT").unwrap_or_else(|_| "8080".to_string())
            )
        })
        .trim_end_matches('/')
        .to_string()
}
```

Production URLs use port **7463**, so Railway runtime is either:

1. **`MEDIA_PUBLIC_BASE=http://localhost:7463`** (explicit misconfiguration), or  
2. **`MEDIA_PUBLIC_BASE` unset** and **`PORT=7463`** (platform-assigned listen port used as public base).

Port `7463` matches the legacy dev telemetry ingest port referenced in `backend/src/main.rs` (comment on `debug_ingest_noop`). It is **not** a valid public browser origin.

---

## 2. Trace: Database → API → Browser

```text
Postgres `reels` row
  video_url:      "/thumbs/{uuid}.jpeg"     (relative — image-only ingest)
  thumbnail_url:  "/thumbs/{uuid}.jpeg"     (relative)
        ↓
GET /api/reels → db/reels.rs::list_ready_reels()
        ↓
reel_contract.rs::row_to_reel_v1()
  url:           canonical_media_url(video_url)
  thumbnailUrl:  canonical_media_url(thumbnail_path)
  thumbnailPath: relative path (passthrough, not re-resolved)
        ↓
JSON response
  "url": "http://localhost:7463/thumbs/{uuid}.jpeg"
  "thumbnailUrl": "http://localhost:7463/thumbs/{uuid}.jpeg"
  "thumbnailPath": "/thumbs/{uuid}.jpeg"
        ↓
Browser (production)
  Cannot connect to localhost:7463 from remote client
  Same-origin path /thumbs/{uuid}.jpeg via Netlify proxy → 200 (when requested directly)
```

### Step 1 — Database / media record

Per `docs/MEDIA_CONTRACT_v1.md`, Postgres stores **relative paths only**:

| Column | Production example |
|--------|-------------------|
| `video_url` | `/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg` |
| `thumbnail_url` | `/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg` |

Image-only ingest writes thumb path into both columns (`ingestion/upload.rs::ingest_image_only`).

**Conclusion:** DB is correct. No migration or row rewrite needed.

### Step 2 — API serializer

| File | Role |
|------|------|
| `backend/src/api/reels.rs` | `list_ready_reels()` — maps rows → `ReelV1` |
| `backend/src/reel_contract.rs` | `row_to_reel_v1()` — calls `canonical_media_url()` on read |
| `backend/src/db/mod.rs` | `media_public_base()` + `canonical_media_url()` — **sole URL resolver** |

```102:118:backend/src/reel_contract.rs
pub fn row_to_reel_v1(row: &ReelRow) -> ReelV1 {
    let video_url = row.video_url.clone().unwrap_or_default();
    let thumb_rel = row.thumbnail_url.clone().filter(|s| !s.trim().is_empty());
    let thumb_abs = thumb_rel.as_ref().map(|p| db::canonical_media_url(p));

    ReelV1 {
        // ...
        url: db::canonical_media_url(&video_url),
        thumbnail_url: thumb_abs,
        thumbnail_path: thumb_rel,
        // ...
    }
}
```

Absolute URLs are computed **at response time**, not stored in Postgres for list endpoints.

Other call sites (same resolver, same env dependency):

| File | Usage |
|------|-------|
| `backend/src/handlers.rs` | `list_videos()` → `canonical_media_url` |
| `backend/src/ingestion/upload.rs` | POST accept responses |
| `backend/src/ingestion/mod.rs` | `IngestionConfig.media_base` at service init |

### Step 3 — Thumbnail URL in JSON

**Local baseline** (`GET http://127.0.0.1:8080/api/reels`):

```text
thumbnailPath: /thumbs/582a3389-5f83-4ddd-bdd4-9c1d8fe2601c.png
url:           http://localhost:8080/thumbs/582a3389-5f83-4ddd-bdd4-9c1d8fe2601c.png
```

Matches `MEDIA_PUBLIC_BASE=http://localhost:8080` (docker-compose / local default).

**Production** (`GET https://reelforge-deploy-production.up.railway.app/api/reels`):

```json
{
  "id": "3b740c8a-04d6-4e4a-a806-310f79c9e4b1",
  "type": "image",
  "fileName": "3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg",
  "url": "http://localhost:7463/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg",
  "thumbnailUrl": "http://localhost:7463/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg",
  "thumbnailPath": "/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg",
  "status": "ready"
}
```

All 4 production reels exhibit the same `localhost:7463` origin. `thumbnailPath` remains correct relative form.

### Step 4 — Browser request

| Request | Result |
|---------|--------|
| `http://localhost:7463/thumbs/{uuid}.jpeg` (from API JSON) | **Unreachable** from remote browser |
| `https://strong-lolly-a9fcb4.netlify.app/thumbs/{uuid}.jpeg` | **200** (Netlify `_redirects` → Railway) |
| `https://reelforge-deploy-production.up.railway.app/thumbs/{uuid}.jpeg` | **200** (Railway direct) |

Media **files exist and serve correctly**; only the **absolute URL prefix in API JSON** is wrong.

---

## 3. Root Cause Confirmation

| Hypothesis | Verdict | Evidence |
|------------|---------|----------|
| DB stores absolute `localhost:7463` URLs | **Rejected** | `thumbnailPath` is `/thumbs/...` relative |
| Frontend rewrites or corrupts URLs | **Rejected** | Mission scope forbids; JSON arrives wrong from API |
| Serializer uses wrong env at runtime | **Confirmed** | `canonical_media_url("/thumbs/x")` → `http://localhost:7463/thumbs/x` |
| Railway `MEDIA_PUBLIC_BASE` missing from repo | **Confirmed** | No `7463` in tracked backend config; value only on platform |
| State ownership / duplicate writers | **Not causal** | URL emission is backend env; BG-1 writer flags unchanged |

**Root cause:** Railway production backend `MEDIA_PUBLIC_BASE` (or `PORT`-derived fallback) resolves to `http://localhost:7463`, a loopback dev origin unusable by production browsers.

---

## 4. Affected Backend Files (read-only — no code change required)

These files implement the pipeline; the defect is **runtime configuration**, not logic:

| File | Function |
|------|----------|
| `backend/src/db/mod.rs` | `media_public_base()`, `canonical_media_url()` |
| `backend/src/reel_contract.rs` | `row_to_reel_v1()`, WS/upload response shapes |
| `backend/src/api/reels.rs` | `GET /api/reels` list |
| `backend/src/handlers.rs` | `get_reels`, `list_videos` |
| `backend/src/ingestion/upload.rs` | Ingest accept responses |
| `backend/src/ingestion/mod.rs` | `IngestionConfig.media_base` |
| `backend/src/ingestion/worker.rs` | Thumb path generation (relative — OK) |
| `backend/src/db/reels.rs` | Row storage (relative — OK) |

**Not in scope / not modified:** `frontend/src/**`, viewer modules, Netlify `_redirects`.

---

## 5. Proposed Change (NOT APPLIED)

### Primary fix — Railway environment variable

Set on the `reelforge-deploy-production` Railway service:

```bash
# Recommended — aligns with Netlify same-origin media proxy (BG-2B architecture)
MEDIA_PUBLIC_BASE=https://strong-lolly-a9fcb4.netlify.app
```

**Alternative** (direct Railway origin — also valid for `curl`/HEAD):

```bash
MEDIA_PUBLIC_BASE=https://reelforge-deploy-production.up.railway.app
```

| Option | Pros | Cons |
|--------|------|------|
| Netlify origin | Matches `VITE_USE_SAME_ORIGIN_API=true`; browser same-origin `/thumbs/*` | Extra CDN hop |
| Railway origin | Direct media host; simpler backend-only mental model | Cross-origin absolute URLs in JSON (CORS not needed for `<img>`/`<video>`) |

**Recommendation:** `https://strong-lolly-a9fcb4.netlify.app` — consistent with production same-origin routing documented in BG-2/BG-3.

### Operator steps (when approved)

```bash
# Railway dashboard → reelforge-deploy-production → Variables
MEDIA_PUBLIC_BASE=https://strong-lolly-a9fcb4.netlify.app

# Redeploy / restart service (Railway picks up env on redeploy)

# Verify
BACKEND=https://reelforge-deploy-production.up.railway.app \
  ./backend/scripts/post-deploy-verify.sh
```

### Expected API output after fix

```json
{
  "url": "https://strong-lolly-a9fcb4.netlify.app/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg",
  "thumbnailUrl": "https://strong-lolly-a9fcb4.netlify.app/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg",
  "thumbnailPath": "/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg"
}
```

### Optional hardening (out of scope for BG-4 code rules)

| Item | Note |
|------|------|
| Document Railway var in `docs/DEPLOYMENT.md` | Operator runbook only |
| Extend `post-deploy-verify.sh` | Fail on `localhost:` in reel URLs (currently only checks `localhost:5173`) |
| Remove erroneous `MEDIA_PUBLIC_BASE=http://localhost:7463` if explicitly set | Check Railway Variables UI |

---

## 6. What This Fix Does NOT Address

Per mission boundaries and BG-3 findings — separate from media origin:

- Legacy `IMG_0113.JPEG` feed references (frontend/localStorage — no filename fallbacks)
- Catalog count divergence (local 25 vs Railway 4 reels)
- Railway missing `hero-background.mp4` (static Netlify dist masks this)
- `VITE_ALLOW_UI_PLACEHOLDERS` demo feed cards
- Duplicate state writers (BG-1 flags)

---

## 7. Approval Gate

| Item | Status |
|------|--------|
| Root cause confirmed | **YES** |
| Patch applied | **NO** — awaiting operator approval |
| Frontend changes | **NONE** |
| Backend code changes | **NONE** |
| Railway env change proposed | **YES** — see §5 |

---

*Generated by MISSION BG-4 — investigation only. Apply Railway `MEDIA_PUBLIC_BASE` when operator approves.*
