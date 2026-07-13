# MISSION BG-1 — Deployment Readiness Report

**Date:** 2026-07-13  
**Skill:** `reelforge-build-governance`  
**Verdict:** **NOT READY**

---

## Classification

| Status | Meaning |
|--------|---------|
| **NOT READY** | One or more deployment gate items fail; do not recommend production deploy |

A production deploy today would ship an app shell that **does not faithfully represent** local development behavior for catalog, upload, delete, or reload flows.

---

## Deployment Gate Checklist

| # | Gate | Status | Evidence |
|---|------|--------|----------|
| 1 | Build succeeds | **PASS** | `npm run build` exit 0 (2026-07-13) |
| 2 | Runtime parity verified | **FAIL** | Netlify API/media proxy broken; mission 5.8 FAIL on dev |
| 3 | Assets verified | **PARTIAL** | dist complete; Railway missing `hero-background.mp4` |
| 4 | Environment verified | **FAIL** | Netlify `/api/reels` 404; localhost strings in prod bundle |
| 5 | Hero verified | **PARTIAL** | Shell renders; Railway hero 404 |
| 6 | Videos verified | **FAIL** on Netlify | API unreachable |
| 7 | Thumbnails verified | **FAIL** | Mission 5.8 FAIL; Netlify API down |
| 8 | Upload verified | **FAIL** on Netlify | No API proxy |
| 9 | Delete verified | **FAIL** | Mission 5.8-F backend divergence |
| 10 | Reload verified | **PARTIAL** | 5.8-C PASS; full stress FAIL |
| 11 | No phantom placeholders | **FAIL** | `backend=40 vaultIds=20` at 5.8-F |
| 12 | No duplicate identities | **PASS** | Missions 5.5–5.7.7 PASS (prior) |

**Score:** 2 PASS · 3 PARTIAL · 7 FAIL

---

## Blockers (priority order)

### P0 — Critical (deploy-breaking)

| # | Blocker | Evidence | Impact |
|---|---------|----------|--------|
| 1 | **Netlify API proxy non-functional** | `curl https://hilarious-licorice-66808a.netlify.app/api/reels` → **404** HTML; Railway direct → **200** | Upload, catalog, delete, reload all fail on production URL |
| 2 | **Stale Netlify deployment** | Deployed `index-Cuf4liSC.js` ≠ local `index-BYoliSMN.js` | Production does not represent current source build |

### P1 — High (parity-breaking)

| # | Blocker | Evidence | Impact |
|---|---------|----------|--------|
| 3 | **Mission 5.8 FAIL — backend divergence** | `MISSION_5_8_VALIDATION.md`: `backend=40 vaultIds=20` at 5.8-F | Thumbnail vault not parity-safe under stress |
| 4 | **Railway missing hero-background.mp4** | `curl Railway /videos/hero-background.mp4` → **404**; local backend → **200** | Hero video behavior differs dev vs production backend |
| 5 | **Wrong public Netlify URL documented** | `reelforge.netlify.app` serves marketing page, not Svelte app | Operator/deploy confusion |

### P2 — Medium (operational risk)

| # | Blocker | Evidence | Impact |
|---|---------|----------|--------|
| 6 | **Root-owned dist files** | 11 paths in `dist/` owned by `root` | Rebuild permission failures for non-root user |
| 7 | **localhost strings in production bundle** | `rg localhost dist/assets/index-*.js` matches | Audit noise; loopback detection present; baked Railway URLs also inlined |
| 8 | **Multiple state duplicate writers** | See `STATE_OWNERSHIP_MATRIX.md` | Regression risk on any deploy |

### P3 — Low (informational)

| # | Blocker | Evidence | Impact |
|---|---------|----------|--------|
| 9 | **Demo thumb stub in dist** | `public/thumbs/dbd58d9b-....png` copied to dist | Not catalog truth; could confuse asset audit |
| 10 | **Bundle size warning** | `index-BYoliSMN.js` > 500 kB | Performance, not deploy blocker |

---

## What passes today

- Vite production build completes without error
- `dist/` contains required static assets (`manifest.json`, `sw.js`, icons, placeholders, `_redirects`)
- Svelte app shell loads in browser on dev, preview, and Netlify (Playwright verified)
- Studio ghost trigger and hero DOM present on all three targets
- Local dev backend healthy (`:8080/health` 200)
- Prior thumbnail missions 5.5–5.7.7 PASS (except missing 5.7.3 script)

---

## Recommended fix order (documentation only — not implemented)

1. Fix Netlify redirect configuration so `/api/*`, `/videos/*`, `/thumbs/*`, `/health` proxy to Railway (verify `_redirects` in published `dist/` or site-level `netlify.toml` linkage).
2. Redeploy latest `dist/` to `hilarious-licorice-66808a` after redirect fix.
3. Upload `hero-background.mp4` to Railway backend `public/videos/`.
4. Resolve mission 5.8-F backend divergence before claiming thumbnail parity.
5. `chown` dist output to project user; build as non-root.
6. Consolidate duplicate state writers per `STATE_OWNERSHIP_MATRIX.md`.

---

## Validation steps to reach READY

```bash
# 1. Build
cd frontend && VITE_USE_SAME_ORIGIN_API=true npm run build

# 2. Ownership
find dist -user root | wc -l   # expect 0

# 3. Local preview parity
npm run preview -- --port 4173
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4173/api/reels

# 4. Deploy (after Netlify redirect fix)
./scripts/deploy-netlify.sh "BG-1 re-verify"

# 5. Netlify probes
curl -s -o /dev/null -w "%{http_code}\n" https://hilarious-licorice-66808a.netlify.app/api/reels
curl -s -o /dev/null -w "%{http_code}\n" https://hilarious-licorice-66808a.netlify.app/videos/hero-background.mp4

# 6. Browser missions (required for PASS)
node scripts/mission-5.8-validate.mjs
npm run validate:hero-background
```

**READY criteria:** All deployment gate items PASS with browser-verified runtime behavior.

---

## Investigation Report (BG-1)

**Root Cause:** Production Netlify deployment does not proxy API/media to Railway; live site is stale; thumbnail stress validation fails on local dev due to backend/vault count divergence.

**Evidence:**
- `curl` probes (dev/preview/Netlify/Railway)
- Playwright shell audit JSON (2026-07-13)
- `MISSION_5_8_VALIDATION.md` FAIL record
- `npm run build` success log
- `PRODUCTION_BASELINE.md` asset inventory

**Files:**
- `frontend/netlify.toml`
- `frontend/public/_redirects`
- `frontend/.env.production`
- `frontend/src/lib/config.js`
- `frontend/scripts/deploy-netlify.sh`
- `frontend/dist/` (generated)

**Call Graph:** See `STATE_OWNERSHIP_MATRIX.md`

**Recommended Fix:** Fix Netlify redirects → redeploy fresh dist → restore Railway hero asset → pass mission 5.8 (no dist patching).

**Regression Risk:** High for upload/delete/reload; medium for hero background; low for static shell/studio UI.

**Validation Steps:** Listed above.

**Runtime verified:** Partial — shell PASS on three targets; full parity **not** PASS.

---

## Cross-References

- [`PRODUCTION_BASELINE.md`](./PRODUCTION_BASELINE.md)
- [`RUNTIME_PARITY_MATRIX.md`](./RUNTIME_PARITY_MATRIX.md)
- [`STATE_OWNERSHIP_MATRIX.md`](./STATE_OWNERSHIP_MATRIX.md)
