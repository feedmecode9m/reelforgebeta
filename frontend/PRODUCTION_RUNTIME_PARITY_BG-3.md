# MISSION BG-3 — Production Runtime Parity Audit

**Date:** 2026-07-13  
**Skill:** `reelforge-build-governance`  
**Scope:** Investigation only — no source, deployment, or configuration changes  
**Status:** Complete

---

## Executive Summary

| Target | URL | Role |
|--------|-----|------|
| **Local baseline** | `http://127.0.0.1:5173/` + backend `:8080` | Frozen reference (`npm run dev`) |
| **Production** | `https://strong-lolly-a9fcb4.netlify.app` | Live Netlify deploy (site ID `791fc14c-cee0-4876-986b-a5c455f10d2a`) |
| **Railway backend** | `https://reelforge-deploy-production.up.railway.app` | Upstream for `/api/*`, `/thumbs/*`, `/videos/*` via `_redirects` |

**Verdict: FAIL — production runtime is not parity with local baseline.**

BG-2 routing repair **succeeded** on the new Netlify site: `/api/reels`, `/health`, and SPA deep routes return **200**. Remaining parity gaps are **backend URL emission**, **catalog divergence**, **legacy thumbnail paths**, **placeholder feed fallbacks**, and **hero asset origin mismatch**.

**Bundle:** Production serves `assets/index-BYoliSMN.js` (matches current local `dist/` build; BG-1 stale-bundle issue resolved on this site).

---

## PASS/FAIL Matrix

| Area | Check | Local | Production | Parity |
|------|-------|-------|------------|--------|
| **A. App bootstrap** | SPA shell loads | PASS | PASS | PASS |
| | `GET /api/reels` via app origin | **200** (`:5173` proxy) | **200** (Netlify proxy) | PASS |
| | API routing log | `sameOrigin: false`, `backendUrl: railway` | `sameOrigin: true`, same-origin media | **DIFF** (expected env delta) |
| | Feed hydration (`reelforge_feed`) | 4 rows (localStorage) | 4 rows (localStorage) | PASS (count) |
| | Backend catalog count | **25** reels | **4** reels | **FAIL** |
| | Console errors (non-HMR) | 404 thumb, ingest aborts | 404 thumb, placeholder failures, WS 400 | **FAIL** |
| **B. Thumbnail pipeline** | API `url` field origin | `http://localhost:8080/thumbs/...` | `http://localhost:7463/thumbs/...` | **FAIL** |
| | UUID thumb via same-origin proxy | **200** | **200** | PASS |
| | Legacy `IMG_0113.JPEG` | **404** | **404** | PASS (both broken) |
| | Browser-requested thumb in session | `IMG_0113.JPEG` → 404; UUID → 200 | `IMG_0113.JPEG` → 404 only | **FAIL** (prod never hits UUID) |
| | `localhost:7463` thumb from API JSON | N/A (correct local base) | **unreachable** (connection refused from browser) | **FAIL** |
| **C. MP4 pipeline** | Hero `video.currentSrc` | `http://127.0.0.1:5173/videos/hero-background.mp4` | `https://strong-lolly-a9fcb4.netlify.app/videos/hero-background.mp4` | **PARTIAL** (both play, different origin) |
| | Hero HTTP status | **200** | **200** / **206** (range) | PASS |
| | Railway `/videos/hero-background.mp4` | **200** (local backend) | **404** | **FAIL** |
| | Ingest path ` /ingest/{uuid}` | **404** (local) | **200** (SPA fallback) | **DIFF** |
| **D. Hero background** | Asset resolution path | Vite dev → `public/` static | Netlify static `dist/` (wins over `_redirects`) | **PARTIAL** |
| | Railway as hero origin | Available locally | **404** | **FAIL** |
| | Hero visible in DOM | PASS (`heroSrc` set) | PASS (`heroSrc` set) | PASS |
| **E. State ownership** | `personal_thumbnails` count | 0 | 0 | PASS |
| | `personal_video_vault` count | 2 | 0 | **FAIL** (env-specific) |
| | Backend canonical for `/api/reels` | YES (25 items, correct URLs) | YES (4 items) but **wrong absolute URLs** | **FAIL** |
| | localStorage-only production fallback | Placeholder feed + `via.placeholder.com` | **YES** — demo cards when catalog thin | **FAIL** |
| | Duplicate writers (BG-1 matrix) | Still present in codebase | Still present | **FLAG** (unchanged) |

**Overall: FAIL** — 9 checks fail, 3 partial, remainder pass.

---

## A. App Bootstrap

### API initialization

| Signal | Local | Production |
|--------|-------|------------|
| Console `[API_ROUTING]` | `{sameOrigin: false, apiBase: (same-origin), backendUrl: https://reelforge-deploy-production.up.railway.app}` | `{sameOrigin: true, apiBase: (same-origin), backendUrl: (same-origin-relative-media)}` |
| `GET /api/reels` (curl) | `http://127.0.0.1:8080/api/reels` → **200**, 25 items | `https://strong-lolly-a9fcb4.netlify.app/api/reels` → **200**, 4 items |
| `GET /api/reels` (browser) | `http://127.0.0.1:5173/api/reels?t=...` → **200** | `https://strong-lolly-a9fcb4.netlify.app/api/reels?t=...` → **200** |
| `GET /health` | **200** | **200** |
| Deep client route | **200** SPA | **200** SPA |

Production same-origin routing (BG-2B intent) is **working**. Local dev intentionally uses `sameOrigin: false` with Vite proxy to `:8080` while still logging Railway as `backendUrl`.

### Feed hydration

| Key | Local (Playwright `localStorage`) | Production |
|-----|-----------------------------------|------------|
| `reelforge_feed` | 4 | 4 |
| `reelforge_hero_reel` | 0 | 0 |
| `personal_thumbnails` | 0 | 0 |
| `personal_video_vault` | 2 | 0 |

Backend catalog differs: local Postgres (dev) exposes **25** reels; Railway exposes **4**. Feed row count in localStorage matches (4) but is **not** driven solely by backend count in either environment.

### Console errors (browser evidence)

**Local** (`http://127.0.0.1:5173/`, Playwright headless, 48s session):

```
WebSocket connection to 'wss://127.0.0.1/?token=...' failed: net::ERR_CONNECTION_REFUSED
Failed to load resource: the server responded with a status of 404 (Not Found)
Failed to load resource: net::ERR_CONNECTION_REFUSED  (repeated — HMR / telemetry noise)
```

**Production** (`https://strong-lolly-a9fcb4.netlify.app/`):

```
Failed to load resource: the server responded with a status of 404 ()
WebSocket connection to 'wss://strong-lolly-a9fcb4.netlify.app/ws/control-center' failed: Unexpected response code: 400
Failed to load resource: net::ERR_CONNECTION_CLOSED  (×3)
[Vault Image Error] {src: https://via.placeholder.com/480x270.png?text=Trending+Shorts, ...}
[Vault Image Error] {src: https://via.placeholder.com/480x270.png?text=Vault+Chronicles, ...}
[Vault Image Error] {src: https://via.placeholder.com/480x270.png?text=Neon+Vengeance, ...}
```

`networkidle` timeout on both (polling `/api/notifications` prevents idle) — app still rendered; evidence collected after 45s + 3s wait.

---

## B. Thumbnail Pipeline

### API-emitted thumbnail URLs

**Local backend** (`GET http://127.0.0.1:8080/api/reels`):

```text
582a3389-5f83-4ddd-bdd4-9c1d8fe2601c → http://localhost:8080/thumbs/582a3389-5f83-4ddd-bdd4-9c1d8fe2601c.png
02a38eba-0982-48a7-be88-cc391d68bf98 → http://localhost:8080/thumbs/02a38eba-0982-48a7-be88-cc391d68bf98.png
… (25 total)
```

**Production** (via Netlify proxy, identical to Railway direct):

```text
3b740c8a-04d6-4e4a-a806-310f79c9e4b1 → http://localhost:7463/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg
fd567668-c77b-436c-80df-eca0aaee67f1 → http://localhost:7463/thumbs/fd567668-c77b-436c-80df-eca0aaee67f1.jpeg
… (4 total)
```

Railway `MEDIA_PUBLIC_BASE` is mis-set to `http://localhost:7463` (legacy dev telemetry port per `backend/src/main.rs` comment). Browsers cannot resolve these URLs from the public internet.

### Network probes

| URL | HTTP |
|-----|------|
| `http://127.0.0.1:8080/thumbs/582a3389-5f83-4ddd-bdd4-9c1d8fe2601c.png` | **200** |
| `http://127.0.0.1:5173/thumbs/582a3389-5f83-4ddd-bdd4-9c1d8fe2601c.png` | **200** |
| `http://127.0.0.1:5173/thumbs/7a33c139-0b0e-476a-ad3e-c1951e061db9.jpg` | **200** (browser) |
| `http://127.0.0.1:5173/thumbs/IMG_0113.JPEG` | **404** |
| `https://strong-lolly-a9fcb4.netlify.app/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg` | **200** |
| `https://strong-lolly-a9fcb4.netlify.app/thumbs/IMG_0113.JPEG` | **404** |
| `https://reelforge-deploy-production.up.railway.app/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg` | **200** |
| `http://localhost:7463/thumbs/3b740c8a-04d6-4e4a-a806-310f79c9e4b1.jpeg` | **unreachable** |

### Browser thumbnail requests (session capture)

| Environment | Requests observed | Result |
|-------------|-------------------|--------|
| Local | `/thumbs/IMG_0113.JPEG` | **404** |
| Local | `/thumbs/7a33c139-0b0e-476a-ad3e-c1951e061db9.jpg` | **200** |
| Local | `/thumbs/5fe7a76f-f88c-4af9-b40a-039ed3e559ab.jpg` | **200** |
| Production | `/thumbs/IMG_0113.JPEG` only | **404** |

Production session did **not** request UUID thumbs via same-origin proxy — UI is still driven by legacy filename in feed/localStorage, not canonical API URLs.

### Fallback behavior

- `https://strong-lolly-a9fcb4.netlify.app/placeholders/media-fallback.svg` → **200**
- `http://127.0.0.1:5173/placeholders/media-fallback.svg` → **200**
- Production also attempts `via.placeholder.com` demo images (`VITE_ALLOW_UI_PLACEHOLDERS=true` in `.env.production`) → **ERR_CONNECTION_CLOSED**

---

## C. MP4 Pipeline

### Video source resolution

| Asset | Local | Production |
|-------|-------|------------|
| Hero `currentSrc` | `http://127.0.0.1:5173/videos/hero-background.mp4` | `https://strong-lolly-a9fcb4.netlify.app/videos/hero-background.mp4` |
| `curl -I` hero | **200** (both `:8080` and `:5173`) | **200** (Netlify static) |
| Railway hero | **200** (local backend serves file) | **404** |

Netlify `_redirects` defines `/videos/* → Railway`, but **static files in `dist/` take precedence**. Hero is served from the **bundled static asset**, not the backend — masking Railway's missing hero file in the browser.

### Playback response

| Environment | Network | Notes |
|-------------|---------|-------|
| Local | `hero-background.mp4` → **200** | One `ERR_ABORTED` during range seek (normal) |
| Production | `hero-background.mp4` → **206** then **200** | Playback succeeds from static origin |

### 404/403 failures

| Failing URL | Code | Context |
|-------------|------|---------|
| `https://reelforge-deploy-production.up.railway.app/videos/hero-background.mp4` | **404** | Backend missing hero asset |
| `http://127.0.0.1:5173/ingest/80f69eaf-aa36-4951-9685-b8b1d86a3356` | **404** | Dev telemetry path not mounted locally |
| `https://strong-lolly-a9fcb4.netlify.app/ingest/...` | **200** | SPA `index.html` fallback (misleading success) |

No **403** responses observed in this audit.

---

## D. Hero Background

| Dimension | Local | Production |
|-----------|-------|------------|
| **Source** | Vite dev server → `public/videos/hero-background.mp4` | Netlify CDN → `dist/videos/hero-background.mp4` |
| **Backend origin** | `:8080` also serves hero (**200**) | Railway **404** |
| **DOM** | `<video>` `currentSrc` populated | `<video>` `currentSrc` populated |
| **Parity** | Functional playback | Functional playback via **different resolution path** |

Production hero **works** but is **not backend-canonical** — it bypasses Railway entirely via static dist.

---

## E. State Ownership

### Confirmations requested

| Requirement | Finding | Status |
|-------------|---------|--------|
| No localStorage-only production fallback | `VITE_ALLOW_UI_PLACEHOLDERS=true` injects demo feed cards; `via.placeholder.com` used when backend catalog is thin | **FAIL** |
| No duplicate writers | BG-1 `STATE_OWNERSHIP_MATRIX.md` flags remain (`viewerContext.js`, `mediaBootstrap.js`, `HeroExperience.svelte`) | **FLAG** (code unchanged) |
| Backend remains canonical | `/api/reels` is fetched on boot (**200** both envs), but Railway emits **non-loadable** `localhost:7463` URLs; localStorage feed/vault diverges from backend counts | **FAIL** |

### localStorage snapshot (fresh Playwright profile, post-load)

```json
// Local
{ "personal_thumbnails": 0, "personal_video_vault": 2, "reelforge_feed": 4, "reelforge_hero_reel": 0 }

// Production
{ "personal_thumbnails": 0, "personal_video_vault": 0, "reelforge_feed": 4, "reelforge_hero_reel": 0 }
```

`personal_thumbnails: 0` on both sides aligns with declared owner (`thumbnailVault.js`) when vault is empty, but **Mission 5.8** still reports `backend=22 vaultIds=10` divergence on the local validation harness — backend/vault sync remains a known FAIL outside this deploy audit.

---

## Failing URLs (consolidated)

| URL | Status | Environment |
|-----|--------|-------------|
| `http://localhost:7463/thumbs/*.jpeg` (from API JSON) | unreachable | Production browser |
| `https://strong-lolly-a9fcb4.netlify.app/thumbs/IMG_0113.JPEG` | **404** | Both (browser-requested) |
| `http://127.0.0.1:5173/thumbs/IMG_0113.JPEG` | **404** | Local |
| `http://127.0.0.1:8080/thumbs/IMG_0113.JPEG` | **404** | Local backend |
| `https://reelforge-deploy-production.up.railway.app/videos/hero-background.mp4` | **404** | Production backend |
| `https://via.placeholder.com/480x270.png?text=*` | **ERR_CONNECTION_CLOSED** | Production browser |
| `wss://strong-lolly-a9fcb4.netlify.app/ws/control-center` | **400** | Production |
| `wss://127.0.0.1/?token=...` | **ERR_CONNECTION_REFUSED** | Local (HMR) |

---

## Root Cause Candidates

| # | Candidate | Evidence | Likely impact |
|---|-----------|----------|---------------|
| **RC-1** | Railway `MEDIA_PUBLIC_BASE=http://localhost:7463` (stale dev port) | All 4 production `/api/reels` entries emit `localhost:7463/thumbs/...`; `backend/src/db/mod.rs` `canonical_media_url()` uses this env var | **High** — API JSON URLs unusable in production browsers |
| **RC-2** | Legacy thumbnail filename `IMG_0113.JPEG` in feed/localStorage vs UUID canonical names on disk | Browser requests legacy path → 404 on both envs; UUID paths return 200 when probed directly | **High** — vault/feed hydration shows broken thumbs |
| **RC-3** | Catalog divergence (local 25 reels vs Railway 4) | Different Postgres datasets between dev and production | **Medium** — feature parity impossible until data aligned |
| **RC-4** | `VITE_ALLOW_UI_PLACEHOLDERS=true` in `.env.production` | Console `[Vault Image Error]` on `via.placeholder.com`; external host blocked/closed | **Medium** — production-only demo fallback, not backend-driven |
| **RC-5** | Hero served from Netlify static `dist/`, not Railway | Static file wins over `_redirects`; Railway hero 404 hidden | **Medium** — masked backend gap; non-canonical media origin |
| **RC-6** | `/ingest/*` not in `_redirects`; SPA fallback returns 200 HTML | Production ingest URL returns SPA shell, not telemetry noop | **Low** — debug noise, not user-facing media |
| **RC-7** | Duplicate state writers (BG-1) | `viewerContext.js` / `mediaBootstrap.js` parallel write paths | **Medium** — long-term drift risk; not introduced by BG-3 |
| **RC-8** | WebSocket `/ws/control-center` proxied but handshake 400 | Railway WS endpoint or Netlify proxy WS upgrade mismatch | **Low** — control-center feature degraded |

---

## Network Evidence Summary

```text
# Routing (production) — BG-2 repair confirmed
GET https://strong-lolly-a9fcb4.netlify.app/              → 200
GET https://strong-lolly-a9fcb4.netlify.app/api/reels   → 200  (4 items, localhost:7463 URLs)
GET https://strong-lolly-a9fcb4.netlify.app/health      → 200
GET https://strong-lolly-a9fcb4.netlify.app/deep/client/route → 200 (SPA)

# Media
GET .../videos/hero-background.mp4                      → 200 (static dist)
GET railway.../videos/hero-background.mp4               → 404
GET .../thumbs/{uuid}.jpeg                              → 200 (proxy → Railway)
GET .../thumbs/IMG_0113.JPEG                            → 404

# Local baseline
GET http://127.0.0.1:8080/api/reels                     → 200  (25 items, localhost:8080 URLs)
GET http://127.0.0.1:5173/api/reels                     → 200  (via Vite proxy)
GET http://127.0.0.1:5173/videos/hero-background.mp4    → 200
```

---

## Relationship to Prior Missions

| Mission | Relevance to BG-3 |
|---------|-------------------|
| **BG-1** | Stale bundle / broken routing on `hilarious-licorice-66808a` — superseded by `strong-lolly-a9fcb4` deploy |
| **BG-2** | Root cause was missing `_redirects` on live site — **resolved** on current production URL |
| **BG-2B/2D** | Same-origin API build + site ID deploy — **API proxy now PASS** |
| **Mission 5.8** | Local `backend=22 vaultIds=10` — state divergence still open; aligns with RC-2 / RC-7 |

---

## Audit Constraints (honored)

- No modifications to `frontend/src/**`
- No modifications to `backend/**`
- No deployment configuration changes
- No fixes implemented

---

## Recommended Next Steps (out of scope for BG-3)

> Documentation only — not executed in this mission.

1. Set Railway `MEDIA_PUBLIC_BASE` to `https://strong-lolly-a9fcb4.netlify.app` (or Railway public origin if direct media preferred).
2. Reconcile legacy `IMG_0113.JPEG` references in feed/localStorage with UUID canonical thumbs.
3. Align production Postgres catalog with dev baseline (or accept intentional subset).
4. Upload `hero-background.mp4` to Railway or document static-only hero as intentional.
5. Re-run Mission 5.8 after backend URL fix.
6. Consider disabling `VITE_ALLOW_UI_PLACEHOLDERS` for production parity validation.

---

*Generated by MISSION BG-3 — Production Runtime Parity Audit. Evidence: Playwright headless sessions (2026-07-13), `curl` probes, Railway/Netlify direct API inspection.*
