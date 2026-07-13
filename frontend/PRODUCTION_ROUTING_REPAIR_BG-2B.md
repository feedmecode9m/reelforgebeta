# MISSION BG-2B — Production Routing Repair Report

**Date:** 2026-07-13  
**Skill:** `reelforge-build-governance`  
**Status:** Build + script repair **complete** — deploy **blocked** (missing `NETLIFY_AUTH_TOKEN`)

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/scripts/deploy-netlify.sh` | Added `VITE_USE_SAME_ORIGIN_API=true` build, `dist/_redirects` pre-flight, post-deploy curl gate |
| `frontend/public/_redirects` | **Unchanged** (already correct) |
| `frontend/netlify.toml` | **Unchanged** (already correct) |
| `frontend/src/**` | **Unchanged** (hard boundary preserved) |

---

## Root Cause (why live deploy ignored redirects)

| Finding | Detail |
|---------|--------|
| Publish artifact | `netlify deploy --dir=dist` uploads **only** `frontend/dist/` contents |
| `_redirects` in local dist | **Present and correct** after build |
| Live Netlify behavior | `/api/reels`, `/health`, deep routes → **404** (no proxy, no SPA) |
| Live bundle hash | `index-Cuf4liSC.js` (stale) vs fresh `index-BYoliSMN.js` |
| Conclusion | **Stale production deploy** published without active edge redirect rules; not an application routing bug |

`frontend/netlify.toml` redirects apply on CLI deploy from `frontend/`, but the live site predates or never received a deploy with `dist/_redirects` active.

---

## Before Routing Behavior

**URL:** `https://hilarious-licorice-66808a.netlify.app`

```text
GET /api/reels          HTTP/2 404  (Netlify error page)
GET /health             HTTP/2 404  (Netlify error page)
GET /deep/client/route  HTTP/2 404  (Netlify error page)
```

---

## Build Verification (PASS)

```bash
cd frontend
VITE_USE_SAME_ORIGIN_API=true npm run build
```

| Check | Result |
|-------|--------|
| Build exit code | **0** |
| `dist/_redirects` exists | **PASS** |
| `/api/*` → Railway | **PASS** |
| `/health` → Railway | **PASS** |
| `/*` → `/index.html` | **PASS** |
| Root-owned files in dist | **0** |

```text
/api/*  https://reelforge-deploy-production.up.railway.app/api/:splat  200
/health  https://reelforge-deploy-production.up.railway.app/health  200
/*  /index.html  200
```

---

## Deploy Attempt

```bash
bash scripts/deploy-netlify.sh "BG-2B routing repair"
```

**Result:** Blocked — `NETLIFY_AUTH_TOKEN` not set in environment.

---

## Complete Deploy (operator action)

```bash
export NETLIFY_AUTH_TOKEN='your-token-from-netlify'
cd ~/projects/reelforge/frontend
bash scripts/deploy-netlify.sh "BG-2B routing repair"
```

The script will:
1. Build with `VITE_USE_SAME_ORIGIN_API=true`
2. Verify `dist/_redirects`
3. `netlify deploy --prod --dir=dist --site=hilarious-licorice-66808a`
4. Curl-verify `/api/reels`, `/health`, `/deep/client/route`

---

## Expected After Routing (PASS criteria)

```bash
SITE=hilarious-licorice-66808a.netlify.app
curl -sI "https://${SITE}/api/reels"      # HTTP 200, JSON body
curl -sI "https://${SITE}/health"         # HTTP 200
curl -sI "https://${SITE}/deep/client/route"  # HTTP 200 (SPA index.html)
```

---

## Application Source

**No files under `frontend/src/` modified.** Mission hard boundaries preserved.
