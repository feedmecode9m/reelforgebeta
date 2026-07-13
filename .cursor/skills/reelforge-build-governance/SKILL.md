---
name: reelforge-build-governance
description: Governs all ReelForge production builds and deployments. Verifies Vite dist/ output matches local dev runtime parity (Hero, Vaults, Feed, Viewer, Studio), audits assets and environment, enforces single state owners, and blocks deployment until browser-verified validation passes. Use when building, deploying, investigating production regressions, or editing code that affects dist/, Netlify, or runtime parity.
disable-model-invocation: true
---

# ReelForge Build Governance

This skill governs all production builds and deployments for the ReelForge project.

## Mission

Guarantee that every production build (dist/) faithfully represents the local development application without introducing regressions.

## Core Principle

The source code is the single source of truth.

The dist directory is a generated artifact only.

No fixes are ever applied directly to dist.

## Responsibilities

### 1. Build Integrity

• Verify Vite builds successfully.
• Verify no root-owned files prevent rebuilding.
• Verify required assets exist in dist.
• Verify build output is internally consistent.

### 2. Runtime Parity

Compare local development against production.

Verify:

- Hero Background
- Hero Vault
- Video Vault
- Thumbnail Vault
- Feed
- Viewer
- Studio

All must behave identically.

### 3. Asset Audit

Verify every required asset exists.

Examples:

hero-background.mp4

placeholders/

thumbs/

manifest.json

sw.js

_redirects

netlify.toml

icons

No broken asset references.

### 4. Environment Audit

Verify:

VITE_API_URL

VITE_BACKEND_URL

media origins

API endpoints

Netlify redirects

No localhost values may appear in production builds.

### 5. State Integrity

Never allow production to introduce multiple sources of truth.

Thumbnail state

Hero state

Video state

Feed state

must each have one owner.

### 6. Deployment Gate

Never recommend deployment until all validation passes.

Deployment checklist:

✓ Build succeeds

✓ Runtime parity verified

✓ Assets verified

✓ Environment verified

✓ Hero verified

✓ Videos verified

✓ Thumbnails verified

✓ Upload verified

✓ Delete verified

✓ Reload verified

✓ No phantom placeholders

✓ No duplicate identities

### 7. Regression Prevention

When editing code:

• identify affected state owners

• identify affected pipelines

• identify affected storage

• identify affected API routes

• identify affected build assets

Warn before any edit that could break production parity.

### 8. Reporting

Every investigation should produce:

Root Cause

Evidence

Files

Call Graph

Recommended Fix

Regression Risk

Validation Steps

Never report PASS unless runtime behavior has been verified in the browser.

---

## Quick Start

### Build (source → dist only)

```bash
cd frontend
npm run build
```

Never edit `dist/` directly. Fix source, rebuild, redeploy.

### Pre-build ownership check

```bash
find frontend/dist frontend/node_modules -user root 2>/dev/null | head -20
# If any: sudo chown -R $(id -un):$(id -gn) frontend/dist frontend/node_modules
```

### Local dev baseline (parity reference)

```bash
cd ~/projects/reelforge
docker compose up -d db          # or backend/scripts/start-db.sh
cd backend && cargo run          # :8080
cd frontend && npm run dev       # :5173
```

### Production preview (local dist, not Netlify)

```bash
cd frontend
VITE_USE_SAME_ORIGIN_API=true npm run build
npm run preview                  # :4173 — compare against :5173 dev
```

### Runtime verification (required for PASS)

Mission scripts exercise upload/delete/reload in a real browser:

```bash
cd frontend
node scripts/mission-5.8-validate.mjs
```

Never report PASS from build output alone.

## State Owners (single source of truth)

| Domain | Owner | Storage / authority |
|--------|-------|---------------------|
| Thumbnail state | `thumbnailVault.js` | `personal_thumbnails` localStorage |
| Thumbnail render | `syncCollectionStore` | `personalThumbnailCollection` (derived) |
| Hero selection | `heroIntelligence.js` + `heroReelIdentity.js` | `reelforge_hero_video`, `reelforge_hero_image`, hero manager config |
| Hero background | `heroIntelligence.js` | `resolveHeroBackgroundPresentation` → `HeroExperience.svelte` |
| Video vault | `viewerContext.js` + vault utils | `personal_video_vault` |
| Feed | `viewerContext.js` feed store | merged from vault + backend reels |
| Catalog bytes | ingestion / Postgres | `GET /api/reels` (ready-only) |

Violations → use `reelforge-state-forensics` for thumbnail-specific repair.

## Pre-Edit Warning (Responsibility 7)

Before any code change, grep impact:

```bash
cd frontend/src
rg "personal_thumbnails|personal_video_vault|reelforge_hero|heroSelection|personalThumbnailCollection" -l
rg "VITE_|localhost|toBackendMediaUrl|createReel" -l
rg "hero-background|placeholders/|manifest.json|sw.js" -l
```

Report affected owners, pipelines, storage keys, API routes, and build assets before editing.

## Investigation Report Template (Responsibility 8)

```markdown
## Build Governance Investigation

**Root Cause:**
**Evidence:**
**Files:**
**Call Graph:**
**Recommended Fix:**
**Regression Risk:**
**Validation Steps:**
**Runtime verified:** [yes/no — browser required for PASS]
```

## Additional Resources

- Build commands, asset lists, env audit, parity matrix: [reference.md](reference.md)
- Thumbnail ownership repair: `.cursor/skills/reelforge-state-forensics/SKILL.md`
- Upload/URL issues: `.cursor/skills/reelforge-file-serving/SKILL.md`
- Netlify config: `frontend/netlify.toml`
- Env template: `frontend/.env.example`
