# ReelForge Build Governance — Reference

## 1. Build Integrity

### Production build command

```bash
cd frontend

# Netlify pattern (same-origin API via redirects)
VITE_USE_SAME_ORIGIN_API=true npm run build

# Or explicit backend URL (no same-origin proxy)
VITE_API_URL=https://reelforge-deploy-production.up.railway.app npm run build
```

`vite.config.js` enforces: production build requires `VITE_API_URL`, `VITE_BACKEND_URL`, `VITE_API_BASE_URL`, or `VITE_USE_SAME_ORIGIN_API=true`.

### Ownership checks

```bash
# Root-owned artifacts block rebuild
find frontend/dist frontend/node_modules -user root 2>/dev/null

# Fix
sudo chown -R "$(id -un):$(id -gn)" frontend/dist frontend/node_modules

# Rust workspace (if building backend in same session)
sudo chown -R "$(id -un):$(id -gn)" ~/projects/reelforge/target
pkill -f 'cargo (build|run|test|check)' 2>/dev/null || true
```

### dist/ internal consistency

After `npm run build`:

```bash
test -f frontend/dist/index.html
test -f frontend/dist/manifest.json
test -f frontend/dist/sw.js
test -f frontend/dist/_redirects
ls frontend/dist/assets/*.js | head -1    # hashed bundles exist
```

```bash
# No localhost baked into JS bundles
rg -l 'localhost|127\.0\.0\.1' frontend/dist/assets/*.js && echo "FAIL: localhost in bundle" || echo "PASS: no localhost in bundles"
```

---

## 2. Runtime Parity Matrix

Compare **dev** (`npm run dev` :5173) vs **preview** (`npm run preview` :4173) or **Netlify production**.

| Surface | Dev selector / module | What to verify |
|---------|----------------------|----------------|
| Hero Background | `[data-hero-background]`, `HeroExperience.svelte` | Video/image renders, `data-hero-background-asset`, no fallback-only in prod |
| Hero Vault | Hero manager / vault grid in Studio | Selection persists reload |
| Video Vault | `.vault-grid--videos`, `personal_video_vault` | Card count matches storage |
| Thumbnail Vault | `.vault-grid--images`, `thumbnailVault.js` | Id-only cards, no phantoms |
| Feed | Category rows, `feed` store | Placeholder vs playable video order |
| Viewer | `Viewer.svelte`, `viewerContext.js` | Upload, delete, reload, hero sync |
| Studio | Ghost trigger, workspace tabs | Admin metrics, theme, appearance |

### Browser verification (mandatory for PASS)

```bash
cd frontend
node scripts/mission-5.8-validate.mjs
```

Supplementary hero checks:

```bash
npm run validate:hero-background
npm run validate:hero
```

### Manual parity snapshot (browser console)

```javascript
// Thumbnails
JSON.parse(localStorage.getItem('personal_thumbnails')||'[]').length
document.querySelectorAll('.vault-grid--images .vault-card').length

// Videos
JSON.parse(localStorage.getItem('personal_video_vault')||'[]').length
document.querySelectorAll('.vault-grid--videos .vault-card').length

// Hero
document.querySelector('[data-hero-background-asset]')?.dataset
```

---

## 3. Asset Audit

### Required in `frontend/public/` (copied to dist/)

| Asset | Path | Notes |
|-------|------|-------|
| SPA shell | `public/index.html` | |
| PWA manifest | `public/manifest.json` | references `/icon-192.png`, `/icon-512.png` |
| Service worker | `public/sw.js` | |
| Placeholders | `public/placeholders/media-fallback.svg` | |
| Placeholders | `public/placeholders/avatar-fallback.svg` | |
| Redirects | `public/_redirects` | Railway proxy rules |
| Netlify config | `netlify.toml` | build command, env, redirects |

### Required at runtime (backend / CDN — not in dist)

| Asset | Path | Notes |
|-------|------|-------|
| Hero background | `/videos/hero-background.mp4` | served by backend; referenced in `heroIntelligence.js` |
| Thumbs | `/thumbs/*` | UUID filenames from ingestion |
| Videos | `/videos/*` | UUID filenames from ingestion |

### Icons (manifest references)

```bash
test -f frontend/public/icon-192.png
test -f frontend/public/icon-512.png
```

### Broken reference scan

```bash
cd frontend
rg "hero-background|placeholders/|icon-192|icon-512|manifest\.json|sw\.js" src public
rg "localhost|127\.0\.0\.1" dist/assets/*.js 2>/dev/null
```

---

## 4. Environment Audit

### Build-time variables

| Variable | Dev | Production |
|----------|-----|------------|
| `VITE_API_URL` | optional (proxy) | required unless same-origin |
| `VITE_BACKEND_URL` | `http://localhost:8080` | must not appear in dist bundles |
| `VITE_API_BASE_URL` | alias | must not appear in dist bundles |
| `VITE_USE_SAME_ORIGIN_API` | — | `true` on Netlify (see `netlify.toml`) |
| `VITE_ALLOW_UI_PLACEHOLDERS` | dev default | explicit in Netlify build env |

### Netlify redirects (must match `_redirects`)

Both `frontend/netlify.toml` and `frontend/public/_redirects` proxy:

- `/api/*` → Railway backend
- `/videos/*` → Railway
- `/thumbs/*` → Railway
- `/health`, `/ws/*`
- `/*` → `/index.html` (SPA)

Production backend: `https://reelforge-deploy-production.up.railway.app`

### Audit commands

```bash
# Built bundle must not contain localhost
rg 'localhost|127\.0\.0\.1' frontend/dist/assets/*.js

# Config resolution source
rg "VITE_API_URL|VITE_BACKEND_URL|VITE_USE_SAME_ORIGIN_API" frontend/src/lib/config.js

# Media URL builder
rg "toBackendMediaUrl|BACKEND_URL" frontend/src/lib/config.js
```

### Media origin rules

- Production: same-origin `/api`, `/videos`, `/thumbs` via Netlify redirects **or** explicit `VITE_API_URL`
- Dev: Vite proxy to `localhost:8080` or direct backend URLs
- Never POST uploads to `localhost` from a remote browser (see `config.js` mission-3 guard)

---

## 5. State Integrity — Ownership Detail

| State | Single owner | Forbidden dual writers |
|-------|-------------|------------------------|
| **Thumbnail** | `thumbnailVault.js` → `personal_thumbnails` | `mediaBootstrap` direct writes, `personalThumbnailCollection.set` for lifecycle |
| **Thumbnail index** | `writeThumbnailVault` only | `createPersistentStore` on index as render authority |
| **Hero reel** | `heroReelIdentity.js` (`saveHeroReel`, `loadHeroReel`) | Legacy `reelforge_hero_video` without migration |
| **Hero background** | `heroIntelligence.js` (`resolveHeroBackgroundPresentation`) | Direct `HERO_BACKGROUND_VIDEO.set` outside resolver chain |
| **Video vault** | `viewerContext.js` via `CONFIG.VIDEO_VAULT_KEY` | Parallel JSON or filesystem seed |
| **Feed** | `viewerContext.js` feed merge | Independent catalog bootstrap into feed |

---

## 6. Deployment Gate — Expanded Checklist

All items must pass before recommending deployment:

```
✓ Build succeeds                    npm run build (exit 0)
✓ Runtime parity verified           dev :5173 vs preview :4173 or production URL
✓ Assets verified                   public/ + dist/ audit (§3)
✓ Environment verified              no localhost in dist bundles (§4)
✓ Hero verified                     validate:hero-background + browser hero render
✓ Videos verified                   vault grid + /videos/ URLs resolve
✓ Thumbnails verified               mission-5.8 + vault card count = storage count
✓ Upload verified                   mission upload path (browser)
✓ Delete verified                   mission delete path (browser)
✓ Reload verified                   mission reload hydration (browser)
✓ No phantom placeholders           no cards without backend id (unless marked orphan)
✓ No duplicate identities           id-only canonical delete paths
```

### Deploy targets

| Target | Publish dir | Config |
|--------|-------------|--------|
| Netlify | `frontend/dist` | `netlify.toml` |
| Docker | `Frontend.Dockerfile` | `VITE_BACKEND_URL` build arg |

---

## 7. Regression Prevention — Impact Matrix

Before editing, map the change:

| If you touch… | Check… |
|---------------|--------|
| `thumbnailVault.js` | mission-5.5–5.8, `personal_thumbnails` grep, production vault parity |
| `mediaBootstrap.js` | ALLOW_UI_PLACEHOLDERS, ingest paths, no thumbnail ownership violation |
| `heroIntelligence.js` | hero background pipeline, `validate:hero-background` |
| `config.js` | dist localhost grep, upload CORS, media URL origins |
| `vite.config.js` | production env guard, proxy vs build behavior |
| `netlify.toml` / `_redirects` | API/media proxy, SPA fallback order |
| `public/*` | dist asset audit, manifest icon paths |
| Backend `media_api` / ingestion | upload/delete/reload missions, CORS |

---

## 8. Reporting — Required Fields

Every investigation must include (never skip):

1. **Root Cause** — single sentence mechanism
2. **Evidence** — console logs, network traces, storage snapshots, build grep output
3. **Files** — exact paths changed or implicated
4. **Call Graph** — write chain from user action → storage → render
5. **Recommended Fix** — source-only; rebuild dist; no dist patches
6. **Regression Risk** — which deployment checklist items could break
7. **Validation Steps** — commands + browser steps to confirm fix

**Never report PASS unless runtime behavior has been verified in the browser.**

---

## Architecture CI (backend — separate gate)

Frontend deployment governance does not replace architecture integrity CI:

```bash
cd ~/projects/reelforge
./scripts/ci-architecture-integrity.sh
```

Required for semantic/import changes. Orthogonal to mission scripts and dist audits.

| Classification | Stage |
|----------------|-------|
| `STRUCTURAL_BLOCK` | DGEL |
| `SEMANTIC_BLOCK` | System Hardening |
| `CROSS_LAYER_DRIFT_BLOCK` | Fusion Validation |

See `docs/CI_OPERATIONAL_MODEL.md` and `docs/REELFORGE_CANONICAL_SYSTEM_CONTRACT_v1.0.md`.

---

## Related Skills

| Skill | When |
|-------|------|
| `reelforge-build-governance` | Builds, deploys, production parity |
| `reelforge-state-forensics` | Vault divergence, ownership violations |
| `reelforge-file-serving` | Upload 404, base64, URL resolution |
