# MISSION BG-1 — Production Baseline

**Date:** 2026-07-13  
**Mission:** Establish the Production Baseline (audit-only)  
**Skill:** `reelforge-build-governance`  
**Status:** Complete — no application code modified

---

## Executive Summary

ReelForge frontend production flow is:

```text
Source (src/, index.html, public/)
  → Vite 5 (vite.config.js + .env.production)
  → dist/ (generated artifact)
  → Netlify (hilarious-licorice-66808a.netlify.app)
  → Browser runtime (Svelte app + same-origin API/media)
```

**Core principle confirmed:** Source is truth; `dist/` is generated only.  
**Critical gaps:** Netlify API proxy returns 404; latest mission validation FAIL; production Railway backend missing `hero-background.mp4`.

---

## 1. Build Pipeline Inventory

### 1.1 Source layer

| Path | Role |
|------|------|
| `frontend/src/` | Svelte components, viewer context, vault, hero, API clients |
| `frontend/index.html` | Vite entry shell (`#app`, `/src/main.js`) |
| `frontend/public/` | Static assets copied verbatim into `dist/` at build |
| `frontend/.env` | Dev defaults (`VITE_BACKEND_URL=http://localhost:8080`) |
| `frontend/.env.production` | Production env baked into bundle at build time |
| `frontend/vite.config.js` | Build guard, proxy, aliases, chunk config |
| `frontend/package.json` | `npm run build` → `vite build` |

### 1.2 Vite build layer

**Command:**

```bash
cd frontend
VITE_USE_SAME_ORIGIN_API=true npm run build
```

**Build guard** (`vite.config.js` → `requireProductionBackendUrl`):

- Production build requires `VITE_API_URL`, `VITE_BACKEND_URL`, `VITE_API_BASE_URL`, **or** `VITE_USE_SAME_ORIGIN_API=true`.

**Output structure** (2026-07-13 build):

```text
dist/
├── index.html              # transformed from index.html (hashed asset refs)
├── assets/
│   ├── index-BYoliSMN.js   # ~1.4 MB app bundle
│   ├── index-DTAzumQP.css
│   └── vendor-DgKbj0YD.js
├── manifest.json           # from public/
├── sw.js                   # from public/
├── psw.js                  # from public/
├── _redirects              # from public/
├── icon-192.png            # from public/
├── icon-512.png            # from public/
├── placeholders/           # from public/
├── hero-background.mp4     # from public/ (root copy)
├── videos/hero-background.mp4
└── thumbs/dbd58d9b-....png  # from public/ (demo stub)
```

**Build result:** PASS — `vite build` exited 0 in 9.52s.

**Build warnings:**

- Chunk size > 500 kB (`index-BYoliSMN.js`)
- Mixed static/dynamic imports for `api.js` / `media.js`

### 1.3 dist/ layer (generated artifact)

| Check | Result | Evidence |
|-------|--------|----------|
| Build succeeds | **PASS** | `npm run build` exit 0 |
| `index.html` present | **PASS** | `dist/index.html` |
| Hashed bundles present | **PASS** | `dist/assets/*.js` |
| Root-owned files | **FAIL** | 11 files/dirs owned by `root` (`dist/_redirects`, `dist/videos`, `dist/placeholders`, …) |
| localhost in bundle | **WARN** | `dist/assets/index-BYoliSMN.js` contains `localhost`, `127.0.0.1`, `reelforge-deploy-production` |
| Internal consistency | **PASS** | `index.html` references same-hash bundles |

**localhost in bundle analysis:**

- `localhost` / `127.0.0.1` appear in loopback-detection helpers (`config.js` → `isLoopbackOrigin`) — expected.
- `reelforge-deploy-production.up.railway.app` baked from `.env.production` even when `VITE_USE_SAME_ORIGIN_API=true` — env strings inlined at compile time; runtime uses same-origin when flag is true.

### 1.4 Netlify deployment layer

| File | Role |
|------|------|
| `frontend/netlify.toml` | Build command, publish dir, env vars, redirect rules |
| `frontend/scripts/deploy-netlify.sh` | `npm run build` + `netlify deploy --prod --dir=dist` |
| `NETLIFY_SITE_NAME` default | `hilarious-licorice-66808a` |

**netlify.toml configuration:**

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  VITE_USE_SAME_ORIGIN_API = "true"
  VITE_ALLOW_UI_PLACEHOLDERS = "true"

# Redirects: /api/*, /videos/*, /thumbs/*, /health, /ws/* → Railway
# SPA fallback: /* → /index.html
```

**Live deployment URL:** `https://hilarious-licorice-66808a.netlify.app/`  
**Note:** `https://reelforge.netlify.app/` serves a **different marketing landing page**, not the Svelte app.

**Deployed bundle vs local build:**

| | Deployed (Netlify) | Local (fresh build) |
|--|-------------------|---------------------|
| JS hash | `index-Cuf4liSC.js` | `index-BYoliSMN.js` |
| Status | **Stale** — Netlify is not serving the latest local `dist/` |

### 1.5 Browser runtime layer

| Environment | URL | Server |
|-------------|-----|--------|
| Local dev | `http://127.0.0.1:5173/` | Vite dev + proxy to `:8080` |
| Prod preview | `http://127.0.0.1:4173/` | `vite preview` (inherits dev proxy) |
| Netlify | `https://hilarious-licorice-66808a.netlify.app/` | Netlify CDN + edge redirects |

**Runtime boot chain:**

1. `index.html` loads hashed JS/CSS
2. `main.js` mounts Svelte `Viewer.svelte`
3. `viewerContext.js` onMount → `bootstrapMediaFromBackend()` → `GET /api/reels`
4. Hero hydrate → `hydrateHeroBackgroundStores()` → `/videos/hero-background.mp4`
5. Vault reload → `reloadVaultStoresFromStorage()` → `thumbnailVault.js` reads `personal_thumbnails`

---

## 2. Production Asset Inventory

| Asset | Required | Origin | Build destination | Verified |
|-------|----------|--------|-------------------|----------|
| `hero-background.mp4` | Yes | `public/hero-background.mp4` + `public/videos/hero-background.mp4` | `dist/hero-background.mp4`, `dist/videos/hero-background.mp4` | **PASS** in dist |
| `placeholders/media-fallback.svg` | Yes | `public/placeholders/` | `dist/placeholders/` | **PASS** |
| `placeholders/avatar-fallback.svg` | Yes | `public/placeholders/` | `dist/placeholders/` | **PASS** |
| Thumbnails (runtime) | Yes | Backend `/thumbs/*` (UUID files) | Not in dist (proxied) | **PASS** local backend; **FAIL** Railway hero |
| `manifest.json` | Yes | `public/manifest.json` | `dist/manifest.json` | **PASS** |
| `sw.js` | Yes | `public/sw.js` | `dist/sw.js` | **PASS** |
| `psw.js` | Optional PWA helper | `public/psw.js` | `dist/psw.js` | **PASS** |
| `_redirects` | Yes | `public/_redirects` | `dist/_redirects` | **PASS** in dist; **FAIL** proxy on live Netlify |
| `netlify.toml` | Yes | `frontend/netlify.toml` | Not copied to dist (Netlify build config) | **PASS** in repo |
| `icon-192.png` | Yes | `public/icon-192.png` | `dist/icon-192.png` | **PASS** |
| `icon-512.png` | Yes | `public/icon-512.png` | `dist/icon-512.png` | **PASS** |
| Demo thumb stub | Informational | `public/thumbs/dbd58d9b-....png` | `dist/thumbs/` | Present (not catalog truth) |

### Backend runtime asset (not in frontend dist)

| Asset | Path | Local backend | Railway production |
|-------|------|---------------|-------------------|
| `hero-background.mp4` | `/videos/hero-background.mp4` | **200** | **404** |

### Broken / risky references

| Issue | Severity |
|-------|----------|
| Netlify `/api/reels` returns 404 HTML | **Critical** — uploads/catalog broken on production |
| Netlify `/health` returns 404 | **High** — health checks fail |
| Railway missing default hero video | **High** — hero falls back to static dist copy only |
| `reelforge.netlify.app` is wrong site | **Medium** — operator confusion |

---

## 3. Environment Matrix

See also: `RUNTIME_PARITY_MATRIX.md` § Environment.

| Variable / behavior | Development (`:5173`) | Production build (`.env.production`) | Netlify deployed |
|---------------------|----------------------|--------------------------------------|------------------|
| `VITE_API_URL` | Optional (from `.env`) | `https://reelforge-deploy-production.up.railway.app` | Set via `netlify.toml` → `VITE_USE_SAME_ORIGIN_API=true` |
| `VITE_BACKEND_URL` | `http://localhost:8080` | Same Railway URL (inlined in bundle) | Same-origin mode active |
| `VITE_USE_SAME_ORIGIN_API` | unset (false) | `true` | `true` |
| `VITE_ALLOW_UI_PLACEHOLDERS` | dev default true | `true` | `true` |
| API base (`API_BASE_URL`) | `''` (Vite proxy) | `''` (same-origin) | `''` intended |
| Media origin (`BACKEND_URL`) | `http://localhost:8080` direct URLs | `''` → relative `/videos`, `/thumbs` | Relative (static dist for hero) |
| Thumbnail URLs | `http://localhost:8080/thumbs/{uuid}.png` from API | Same-origin `/thumbs/...` | Proxy **broken** → 404 |
| Hero URLs | `/videos/hero-background.mp4` → local backend **200** | Static dist copy **200** on preview | Static dist **200**; Railway **404** |
| Video URLs | `/videos/{uuid}.mp4` via backend | Same-origin relative | Proxy **broken** on Netlify |
| `GET /api/reels` | `http://127.0.0.1:5173/api/reels` → proxy → `:8080` **200** | `http://127.0.0.1:4173/api/reels` **200** (vite preview proxy) | `https://hilarious-licorice-66808a.netlify.app/api/reels` **404** |
| `POST /api/reels` (upload) | Proxied to localhost backend | Proxied on preview | **FAIL** on Netlify (no API proxy) |
| localhost in JS bundle | N/A (dev mode) | Present (detection + baked env strings) | Deployed bundle — same class |

---

## 4. Validation Performed (audit-only)

| Action | Result |
|--------|--------|
| `npm run build` | PASS |
| dist asset tree audit | PASS (with root-ownership WARN) |
| `curl` backend/Railway/Netlify endpoints | Mixed — see asset table |
| Playwright shell load (dev, preview, Netlify) | PASS all three |
| `mission-5.8-validate.mjs` (latest on disk) | **FAIL** — backend divergence 40 vs 20 |
| `validate:hero-background` browser phase | **FAIL** — preview not on `:4190` |

---

## 5. Cross-References

- Runtime feature parity: [`RUNTIME_PARITY_MATRIX.md`](./RUNTIME_PARITY_MATRIX.md)
- State ownership: [`STATE_OWNERSHIP_MATRIX.md`](./STATE_OWNERSHIP_MATRIX.md)
- Deployment verdict: [`DEPLOYMENT_READINESS.md`](./DEPLOYMENT_READINESS.md)

---

## 6. Audit Constraints

- No application source files modified
- No `dist/` files patched (build regenerated for verification only)
- No fixes implemented per mission scope
