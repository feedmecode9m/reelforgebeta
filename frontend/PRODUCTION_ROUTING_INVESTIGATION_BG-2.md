# MISSION BG-2 — Production Routing Investigation

**Date:** 2026-07-13  
**Skill:** `reelforge-build-governance`  
**Scope:** Deployment routing only — no application state/ownership changes  
**Status:** Root cause identified — **do not patch yet** (awaiting approval)

---

## Executive Summary

**Root cause:** The live Netlify deployment is serving a **stale static artifact** with **no active redirect rules**. Neither `dist/_redirects` nor `frontend/netlify.toml` rules are applied on the published site. The production bundle is correct (`VITE_USE_SAME_ORIGIN_API` → same-origin `/api`); routing fails at the **CDN edge**, not in application code.

Local preview works because **Vite `server.proxy`** handles `/api/*` — Netlify has no equivalent unless `_redirects` or `netlify.toml` redirects are active.

---

## Symptom vs Expected

| Route | Live Netlify (actual) | Local preview (expected) | Railway direct |
|-------|----------------------|--------------------------|----------------|
| `GET /` | 200 HTML | 200 HTML | N/A |
| `GET /api/reels` | **404** Netlify error page | **200** JSON | **200** JSON |
| `GET /health` | **404** Netlify error page | **200** | **200** |
| `GET /some/deep/client/route` | **404** Netlify error page | **200** SPA (`index.html`) | N/A |
| `GET /videos/hero-background.mp4` | 200 (static dist file) | 200 (static dist) | **404** |
| `GET /manifest.json` | 200 | 200 | N/A |

**Primary failure:** `GET /api/reels` on Netlify returns Netlify's hosted 404 HTML, not Railway JSON and not SPA `index.html`.

---

## Investigation Results

### 1. Netlify SPA fallback

| Check | Result |
|-------|--------|
| `/* → /index.html` in `public/_redirects` | Present in source and local `dist/_redirects` |
| Live deep route `/some/deep/client/route` | **404** Netlify error page |
| Live `/index.html` | 200 (static file exists) |

**Conclusion:** SPA fallback rule is **not active** on the live deploy. If `_redirects` were loaded, deep routes would return `index.html` with 200.

### 2. `/api/reels` proxy path

```bash
curl -sI https://hilarious-licorice-66808a.netlify.app/api/reels
# HTTP/2 404
# content-type: text/html; charset=utf-8
# server: Netlify
# cache-status: "Netlify Edge"; hit
```

Body begins with `<title>Page not found</title>` — Netlify platform 404, not Railway response.

```bash
curl -s https://reelforge-deploy-production.up.railway.app/api/reels
# 200 — valid JSON catalog
```

**Conclusion:** Railway backend is healthy. Netlify edge is **not proxying** `/api/*`.

### 3. `VITE_USE_SAME_ORIGIN_API` behavior

**Source:** `frontend/src/lib/config.js`

| Build-time | Runtime (production bundle) |
|------------|------------------------------|
| `VITE_USE_SAME_ORIGIN_API=true` | `shouldUseSameOriginApi()` → `true` |
| Railway URLs in `.env.production` | Inlined but bypassed when same-origin |
| `API_BASE_URL` | `""` → fetches use `/api/...` on current host |
| `BACKEND_URL` | `""` → media uses relative `/videos/`, `/thumbs/` |

**Netlify hostname guard:** `isNetlifyStaticHost()` forces same-origin even if build env omitted.

**Client fetch path** (`api.js`):

```javascript
const url = `${API_BASE_URL}${endpoint}`;  // → "/api/reels" on Netlify
```

**Conclusion:** Bundle behavior is **correct**. Browser requests `https://hilarious-licorice-66808a.netlify.app/api/reels`. Failure is entirely at Netlify routing.

### 4. `_redirects`

**Local `dist/_redirects`** (matches `public/_redirects`):

```text
/api/*  https://reelforge-deploy-production.up.railway.app/api/:splat  200
/videos/*  https://reelforge-deploy-production.up.railway.app/videos/:splat  200
/thumbs/*  https://reelforge-deploy-production.up.railway.app/thumbs/:splat  200
/health  https://reelforge-deploy-production.up.railway.app/health  200
/ws/*  https://reelforge-deploy-production.up.railway.app/ws/:splat  200
/*  /index.html  200
```

**Live Netlify:** None of these rules are active (API 404, SPA deep route 404, `/health` 404).

### 5. `netlify.toml`

**Location:** `frontend/netlify.toml` (only copy in repo)

Contains matching `[[redirects]]` blocks with `force = true` plus build env `VITE_USE_SAME_ORIGIN_API=true`.

**Deploy path** (`scripts/deploy-netlify.sh`):

```bash
cd frontend
npm run build
netlify deploy --prod --dir=dist --site=hilarious-licorice-66808a
```

`netlify.toml` should be read by Netlify CLI when run from `frontend/`, but **live site behavior proves neither toml nor `_redirects` rules are currently applied**.

### 6. Production bundle environment resolution

| Check | Local `dist/` | Live Netlify |
|-------|---------------|--------------|
| Bundle hash | `index-BYoliSMN.js` | `index-Cuf4liSC.js` (**stale**) |
| Same-origin API init | `USE_SAME_ORIGIN_API=true` | Same (in older bundle) |
| `_redirects` in artifact | **Yes** (`dist/_redirects`) | **Not active on edge** |

---

## Root Cause

### Primary

**The published Netlify deployment does not have redirect rules loaded.**

Evidence chain:

1. `/api/reels` → Netlify 404 (not Railway, not SPA)
2. `/some/deep/client/route` → Netlify 404 (SPA fallback absent)
3. `/health` → Netlify 404 (proxy rule absent)
4. Static files that exist in old `dist/` work (`/`, `/manifest.json`, `/videos/hero-background.mp4`)
5. Local `dist/_redirects` is correct but live deploy uses **older bundle** (`Cuf4liSC` ≠ `BYoliSMN`)

Most likely mechanism: **last production deploy uploaded static files without effective `_redirects` processing** — either an older artifact predating `public/_redirects`, a manual drop omitting `_redirects`, or a deploy that never promoted redirect config to the active edge.

### Secondary (parity masking)

`/videos/hero-background.mp4` returns **200 on Netlify from static `dist/`** while Railway returns **404**. Static files shadow proxy rules when redirects *do* work. This masks video routing gaps but is not the `/api/reels` failure cause.

### Not the cause

| Ruled out | Why |
|-----------|-----|
| Application state logic | No code changes needed; same bundle works on preview |
| `VITE_USE_SAME_ORIGIN_API` | Correctly resolves to same-origin `/api` |
| Railway backend down | `/api/reels` 200 direct |
| `_redirects` syntax (local) | File matches Netlify format; would work if deployed |
| CORS | Same-origin design avoids CORS; request never reaches Railway |

---

## Why Local Preview Works

```text
Browser → http://127.0.0.1:4173/api/reels
         → Vite preview server.proxy (/api → 127.0.0.1:8080)
         → local backend
         → 200 JSON
```

**File responsible:** `frontend/vite.config.js` (`server.proxy`)

Netlify has no Vite proxy. It requires `_redirects` or `netlify.toml` `[[redirects]]` on the edge.

---

## Files Responsible

| File | Role | Issue |
|------|------|-------|
| `frontend/public/_redirects` | Edge redirects copied to `dist/` | Correct in source; **not active live** |
| `frontend/netlify.toml` | Build env + redirect backup | Correct in repo; **not active live** |
| `frontend/scripts/deploy-netlify.sh` | Deploy entrypoint | Deploys `--dir=dist` only; no post-deploy route verification |
| `frontend/vite.config.js` | Preview/dev proxy | Works locally; not used on Netlify |
| `frontend/src/lib/config.js` | Same-origin API resolution | **Working correctly** |

**No changes needed** to forbidden files (`viewerContext.js`, `thumbnailVault.js`, etc.).

---

## Minimal Patch Plan (deployment only — not implemented)

### Step 1 — Fresh build with redirects in artifact

```bash
cd frontend
# as youloose2dafish, not root
VITE_USE_SAME_ORIGIN_API=true npm run build
test -f dist/_redirects && grep -q '/api/\*' dist/_redirects
```

### Step 2 — Redeploy to correct site

```bash
export NETLIFY_AUTH_TOKEN='...'
./scripts/deploy-netlify.sh "BG-2 routing repair"
```

Ensure deploy runs from `frontend/` so CLI reads `netlify.toml`.

### Step 3 — Post-deploy route verification (required for PASS)

```bash
SITE=hilarious-licorice-66808a.netlify.app
curl -sf "https://${SITE}/api/reels" | head -c 80          # expect JSON [
curl -sf -o /dev/null -w "%{http_code}" "https://${SITE}/health"   # expect 200
curl -sf -o /dev/null -w "%{http_code}" "https://${SITE}/app/deep/route"  # expect 200 SPA
```

### Step 4 — Add deploy gate to `deploy-netlify.sh` (optional hardening)

After `netlify deploy`, fail if `/api/reels` is not 200 JSON. Prevents silent stale deploys.

### Step 5 — Railway hero asset (parity, separate from API routing)

Upload `hero-background.mp4` to Railway `public/videos/` so media proxy matches dev when static dist shadowing is removed.

---

## Risk Assessment

| Patch step | Risk | Touches app code? |
|------------|------|-------------------|
| Redeploy `dist/` with `_redirects` | Low | No |
| Post-deploy curl gate | None | No (script only) |
| Railway hero upload | Low | No |

---

## Verdict

| Item | Status |
|------|--------|
| Root cause identified | **Yes** |
| Application code change required | **No** |
| Ready to implement patch | **Yes** — deployment-only redeploy |

**Do not modify application state logic.** Routing repair is a **deploy + verify** operation.
