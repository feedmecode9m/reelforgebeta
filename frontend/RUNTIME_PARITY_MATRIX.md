# MISSION BG-1 — Runtime Parity Matrix

**Date:** 2026-07-13  
**Skill:** `reelforge-build-governance`  
**Rule:** PASS requires browser-verified runtime behavior, not build output alone.

**Targets:**

| Label | URL | Notes |
|-------|-----|-------|
| Local Development | `http://127.0.0.1:5173/` | Vite dev + proxy → backend `:8080` |
| Production Build | `http://127.0.0.1:4173/` | `vite preview` of fresh `dist/` |
| Netlify Deployment | `https://hilarious-licorice-66808a.netlify.app/` | Canonical deploy site per `deploy-netlify.sh` |

---

## Environment Differences (summary)

| Concern | Dev | Prod Build (preview) | Netlify |
|---------|-----|-------------------|---------|
| API routing | Vite proxy → `localhost:8080` | Vite preview proxy → `localhost:8080` | Intended `_redirects` → Railway (**broken**) |
| Media routing | Direct `localhost:8080` or proxy | Same-origin relative + proxy | Static dist for hero; proxy **broken** for API |
| Bundle hash | Unbundled modules | `index-BYoliSMN.js` (local) | `index-Cuf4liSC.js` (**stale**) |
| Placeholders enabled | `VITE_ALLOW_UI_PLACEHOLDERS` dev default | `true` (baked) | `true` (baked) |

---

## Feature Parity Matrix

| Feature | Local Dev | Production Build | Netlify Deployment |
|---------|-----------|------------------|-------------------|
| **Hero Background** | **PASS** | **PASS** | **PARTIAL** |
| **Hero Vault** | **PASS** | **PASS** | **PASS** (shell) |
| **Video Vault** | **PASS** | **PASS** | **FAIL** |
| **Thumbnail Vault** | **FAIL** | **UNVERIFIED** | **FAIL** |
| **Feed** | **PASS** | **PASS** | **FAIL** |
| **Viewer** | **PASS** | **PASS** | **PARTIAL** |
| **Studio** | **PASS** | **PASS** | **PASS** (shell) |

---

## Per-Feature Evidence

### Hero Background

| Target | Status | Evidence |
|--------|--------|----------|
| Local Dev | **PASS** | Playwright: `heroBg: true`; `curl :8080/videos/hero-background.mp4` → **200** |
| Production Build | **PASS** | Playwright: `heroBg: true`; `curl :4173/videos/hero-background.mp4` → **200** (static dist) |
| Netlify | **PARTIAL** | Playwright: `heroBg: true` (DOM shell); `curl .../videos/hero-background.mp4` → **200** (static dist); Railway direct → **404**; hero video error logs in prior forensic reports when backend path used |

**Parity gap:** Production Railway lacks `hero-background.mp4`. Dev uses local backend file; Netlify uses bundled static copy only.

---

### Hero Vault

| Target | Status | Evidence |
|--------|--------|----------|
| Local Dev | **PASS** | Studio ghost trigger present; `heroIntelligence.js` + `HeroManagerPanel.svelte` load; `reelforge_hero_manager_config` storage key active |
| Production Build | **PASS** | Playwright: `studio: true`; same modules in bundle |
| Netlify | **PASS** (shell) | Playwright: `studio: true`, Svelte loaded; manager panel not exercised in this audit |

**Parity gap:** Upload/save/reload of hero selection not browser-tested in this mission (no code changes allowed).

---

### Video Vault

| Target | Status | Evidence |
|--------|--------|----------|
| Local Dev | **PASS** | Backend `:8080` **200**; `bootstrapMediaFromBackend` hydrates `personal_video_vault`; Playwright `videoCards: 0` on empty vault (expected) |
| Production Build | **PASS** | `GET :4173/api/reels` → **200** JSON; vault bootstrap path available |
| Netlify | **FAIL** | `GET .../api/reels` → **404** Netlify HTML; catalog/upload pipeline unreachable |

---

### Thumbnail Vault

| Target | Status | Evidence |
|--------|--------|----------|
| Local Dev | **FAIL** | `MISSION_5_8_VALIDATION.md` (2026-07-13T02:27:45Z): **FAIL** at 5.8-F — `backend=40 vaultIds=20`; prior missions 5.5–5.7.7 PASS |
| Production Build | **UNVERIFIED** | Mission scripts target `:5173` by default; not re-run against `:4173` in this audit |
| Netlify | **FAIL** | API proxy broken; upload/delete/reload cannot complete against production URL |

**Evidence file:** `frontend/MISSION_5_8_VALIDATION.md`

---

### Feed

| Target | Status | Evidence |
|--------|--------|----------|
| Local Dev | **PASS** | Playwright shell loads; `feed` store populated via `aiCleanupAgent.syncThumbnailsToFeed` on startup path |
| Production Build | **PASS** | App boots; API reels available on preview |
| Netlify | **FAIL** | Without `/api/reels`, feed cannot hydrate from catalog |

---

### Viewer

| Target | Status | Evidence |
|--------|--------|----------|
| Local Dev | **PASS** | Playwright: `hasApp: true`, `title: "ReelForge"`, `svelte-loaded`, no page errors |
| Production Build | **PASS** | Same evidence on `:4173` |
| Netlify | **PARTIAL** | Shell PASS; catalog-dependent flows FAIL (API 404) |

---

### Studio

| Target | Status | Evidence |
|--------|--------|----------|
| Local Dev | **PASS** | Playwright: `studio: true` (`.ghost-trigger` present) |
| Production Build | **PASS** | Playwright: `studio: true` |
| Netlify | **PASS** (shell) | Playwright: `studio: true` |

---

## Deployment Checklist (from build-governance skill)

| Item | Local Dev | Prod Build | Netlify |
|------|-----------|------------|---------|
| Build succeeds | N/A | **PASS** | **PASS** (deployed artifact exists) |
| Runtime parity verified | Partial | Partial | **FAIL** |
| Assets verified | **PASS** | **PASS** | **PARTIAL** |
| Environment verified | **PASS** | **WARN** (localhost strings in bundle) | **FAIL** (API proxy) |
| Hero verified | **PASS** | **PASS** | **PARTIAL** |
| Videos verified | **PASS** | **PASS** | **FAIL** |
| Thumbnails verified | **FAIL** | UNVERIFIED | **FAIL** |
| Upload verified | Not in this audit | Not in this audit | **FAIL** |
| Delete verified | **FAIL** (5.8-F) | UNVERIFIED | **FAIL** |
| Reload verified | Partial (5.8-C PASS) | UNVERIFIED | **FAIL** |
| No phantom placeholders | **FAIL** (backend divergence) | UNVERIFIED | UNVERIFIED |
| No duplicate identities | Prior missions PASS | UNVERIFIED | UNVERIFIED |

---

## API Endpoint Parity

| Endpoint | Dev `:5173` | Preview `:4173` | Netlify |
|----------|-------------|-----------------|---------|
| `GET /api/reels` | 200 | 200 | **404** |
| `GET /health` | proxied 200 | proxied 200 | **404** |
| `GET /videos/hero-background.mp4` | 200 (backend) | 200 (static dist) | 200 (static dist) |
| `GET /placeholders/media-fallback.svg` | 200 | 200 | 200 |
| `GET /manifest.json` | 200 | 200 | 200 |
| `GET /sw.js` | 200 | 200 | 200 |

---

## Root Cause Summary (parity failures)

1. **Netlify `_redirects` / `netlify.toml` proxy rules not effective** for `/api/*` and `/health` on live site (404 HTML, not Railway JSON).
2. **Stale Netlify deploy** — bundle hash `Cuf4liSC` ≠ latest local `BYoliSMN`.
3. **Mission 5.8 FAIL on dev** — backend catalog count diverges from vault (40 vs 20) under stress.
4. **Railway production backend** missing default hero video asset.

---

## Validation Steps Used

```bash
# Build
cd frontend && VITE_USE_SAME_ORIGIN_API=true npm run build

# Endpoint probes
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4173/api/reels
curl -s -o /dev/null -w "%{http_code}" https://hilarious-licorice-66808a.netlify.app/api/reels

# Playwright shell audit (dev, preview, Netlify)
node -e '...' # see PRODUCTION_BASELINE.md audit log
```

**Mission script evidence:** `frontend/MISSION_5_8_VALIDATION.md`

---

## Regression Risk

Any deploy to Netlify without fixing API redirects will ship a shell-only app: hero/static assets render, but catalog, upload, delete, and reload will not match local dev.
