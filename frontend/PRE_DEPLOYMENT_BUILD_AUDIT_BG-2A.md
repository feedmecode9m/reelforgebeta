# MISSION BG-2A — Pre-Deployment Build Audit

**Date:** 2026-07-13  
**Skill:** `reelforge-build-governance`  
**Scope:** Production build audit only — no application logic modified  
**Build command:** `VITE_USE_SAME_ORIGIN_API=true npm run build`

---

## Overall Verdict: **FAIL**

Build succeeds and required assets are present, but **dist ownership is not fully repaired** and the bundle still contains a **localhost URL template**. Deploy should wait until ownership is clean.

---

## Task Results

| # | Task | Result | Evidence |
|---|------|--------|----------|
| 1 | `npm run build` completes | **PASS** | Exit 0 in 9.06s; `index-BYoliSMN.js` generated |
| 2 | `dist/` contains expected assets | **PASS** | All required paths present (see §Assets) |
| 3 | Compare dist vs deployment requirements | **PARTIAL** | Assets OK; ownership + `vite.svg` gap |
| 4 | Required asset checklist | **PASS** | All listed assets present in `dist/` |
| 5 | No localhost URLs in bundle | **FAIL** | `http://localhost:${KO}` template present |
| 6 | `VITE_API_URL` / `VITE_BACKEND_URL` production resolution | **PASS** | Same-origin mode active; API/media use relative paths |
| 7 | PASS/FAIL report | **FAIL** | This document |

---

## 1. Build

```
✓ 314 modules transformed
✓ built in 9.06s
dist/assets/index-BYoliSMN.js   1,396.05 kB
```

Warnings only (chunk size, dynamic imports) — non-blocking.

---

## 2. Asset Inventory

| Asset | In `dist/` | Origin |
|-------|------------|--------|
| `hero-background.mp4` | **PASS** (root + `videos/`) | `public/` → copied at build |
| `placeholders/` | **PASS** | `public/placeholders/` |
| `thumbs/` | **PASS** | `public/thumbs/` (demo stub) |
| `videos/` | **PASS** | `public/videos/` |
| `manifest.json` | **PASS** | `public/` |
| `sw.js` | **PASS** | `public/` |
| `_redirects` | **PASS** | `public/` |
| `netlify.toml` | **N/A in dist** | Repo config `frontend/netlify.toml` — used at Netlify build, not published |
| `icon-192.png` / `icon-512.png` | **PASS** | `public/` |
| `index.html` + hashed bundles | **PASS** | Vite generated |

**Minor gap:** `index.html` references `/vite.svg` but `dist/vite.svg` is **missing** (favicon 404 risk only).

---

## 3. dist Ownership

| Check | Result |
|-------|--------|
| Root-owned files in `dist/` | **FAIL — 11 paths** |

```
dist/_redirects
dist/videos/          (dir)
dist/placeholders/    (dir)
dist/placeholders/media-fallback.svg
dist/placeholders/avatar-fallback.svg
dist/thumbs/          (dir)
dist/thumbs/dbd58d9b-....png
```

Build was run as `root` in this audit session, reintroducing ownership drift on `public/` copies.

---

## 4. Localhost Bundle Audit

| Pattern | Found? | Runtime impact |
|---------|--------|----------------|
| `http://localhost:8080` | **No** | — |
| `http://localhost:${port}` template | **Yes** | Fallback in `isBackendMediaOrigin` when `BACKEND_URL` empty |
| `localhost` / `127.0.0.1` (detection) | **Yes** | Loopback guard in `sanitizeExternalBaseUrl` — acceptable |
| `https://reelforge-deploy-production.up.railway.app` | **Yes** | Inlined from `.env.production`; not used as API base when same-origin |

**Bundle init (verified in minified output):**

- `USE_SAME_ORIGIN_API` → `true` (`Hh(){return!0}`)
- `BACKEND_URL` → `""` (empty — relative media)
- `API_BASE_URL` → `""` (same-origin `/api`)

---

## 5. Production Env Resolution

| Variable | `.env.production` | Resolved in bundle |
|----------|-------------------|-------------------|
| `VITE_USE_SAME_ORIGIN_API` | `true` | `true` — **PASS** |
| `VITE_API_URL` | Railway URL | Inlined; API calls use `""` (same-origin) — **PASS** |
| `VITE_BACKEND_URL` | Railway URL | Inlined; media uses relative `/videos`, `/thumbs` — **PASS** |
| `VITE_ALLOW_UI_PLACEHOLDERS` | `true` | Baked — informational |

**Netlify alignment:** `netlify.toml` sets `VITE_USE_SAME_ORIGIN_API=true` and Railway redirect rules matching `dist/_redirects`.

---

## 6. Deployment Requirements Comparison

| Requirement | Status |
|-------------|--------|
| Build artifact complete | **PASS** |
| `_redirects` in publish dir | **PASS** |
| Static hero fallback in dist | **PASS** |
| PWA manifest + SW | **PASS** |
| Same-origin API config | **PASS** (bundle) |
| No root-owned dist files | **FAIL** |
| No localhost URL templates | **FAIL** |
| Bundle matches latest source | **PASS** (`index-BYoliSMN.js`) |

---

## Blockers Before Deploy

1. **P0** — Re-run build as `youloose2dafish` (not root); verify `find dist -user root | wc -l` → 0
2. **P1** — Localhost template in bundle (`http://localhost:${port}`) — audit flags strict FAIL; runtime uses same-origin today but template remains in artifact
3. **P2** — Add `vite.svg` to `public/` or remove reference from `index.html` (non-blocking)

---

## Audit Constraints

- No changes to `Viewer.svelte`, `VaultExperience.svelte`, `viewerContext.js`, `thumbnailVault.js`, `mediaBootstrap.js`
- No application logic modified
- No `dist/` patches applied
