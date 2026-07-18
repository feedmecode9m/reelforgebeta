# RC1 Release Checklist

**Canonical release process for ReelForge Release Candidate 1**  
**Production:** https://strong-lolly-a9fcb4.netlify.app/  
**API:** https://reelforge-deploy-production.up.railway.app  
**Netlify site ID:** `791fc14c-cee0-4876-986b-a5c455f10d2a`

---

## Mission classification

| Series | Purpose | Changes code? |
|--------|---------|---------------|
| **BG** | Infrastructure defects — instrument → prove → surgical repair | Yes (minimal) |
| **PRODUCT** | Creator capabilities | Yes |
| **RA** | Release acceptance — production verification | **No** |

During RC1 pursuit: **no PRODUCT missions**. Release engineering only.

---

## RC1 definition

Release Candidate 1 is declared when:

```text
Every supported browser
        ↓
Fresh session
        ↓
Uploads work
        ↓
Attachments persist (server-visible where required)
        ↓
Hero restores (RESTORE_SUCCESS)
        ↓
Readiness updates
        ↓
Automation passes
        ↓
Production behaves identically to verified local build
```

That is a **repeatable release**, not merely green local tests.

---

## RC1 acceptance gate

**Nothing skips a gate.**

| # | Gate | Command / action | Pass criteria |
|---|------|------------------|---------------|
| 1 | **Local verification** | See [Local verification](#local-verification) | All required scripts exit 0 |
| 2 | **Commit frozen** | `git status` clean; intended files only | No accidental artifacts/thumbs |
| 3 | **Push origin/main** | `git push origin main` | Remote matches local HEAD |
| 4 | **Production deploy** | `bash scripts/deploy-netlify.sh "…"` | Netlify prod deploy succeeds |
| 5 | **Production smoke** | Bundle + route checks | BG-7W markers live; `/api/reels` 200 |
| 6 | **Shared-state verification** | `mission-ra-01-shared-state-verify.mjs` | All required RA-01 scenarios PASS |
| 7 | **Regression suite** | See [Regression commands](#regression-commands) | Core missions exit 0 |
| 8 | **Sign-off** | Tag + record | `RC1` tag pushed; checklist signed |

---

## Preconditions

Before starting any release:

- [ ] Clean working tree (`git status` — no unintended generated files)
- [ ] `NETLIFY_AUTH_TOKEN` exported (Netlify personal access token)
- [ ] GitHub push access to `origin/main`
- [ ] `ffmpeg` available (Playwright mission scripts)
- [ ] Playwright Chromium installed (`npx playwright install chromium`)
- [ ] `ADMIN_PASSWORD` known (default in scripts: studio unlock)
- [ ] No open **BG** infrastructure missions blocking release
- [ ] **BG-7T** feed/shelf baseline remains frozen (do not reopen)

**Exclude from commits:** `backend/public/thumbs/`, `public/thumbs/`, `frontend/artifacts/`, `.cursor/`

---

## Local verification

Run from `frontend/` after `npm run build`:

```bash
cd frontend
npm run build

# BG-7W hero restore boundary (identity restore smoke)
FRONTEND_URL=http://127.0.0.1:4173/ \
  npm run preview -- --port 4173 --host 127.0.0.1 --strictPort &
sleep 5
node scripts/mission-bg-7v-restore-reason-smoke.mjs
# Expect: restoreReason "RESTORE_SUCCESS"

# Full hero persistence (best against Netlify same-origin; local may skip upload path)
node scripts/mission-bg-7u-hero-persistence-verify.mjs
# Expect: identityRestoreOk true, restoreReason "RESTORE_SUCCESS" (post-BG-7W)
```

**Local bundle markers (must be present before deploy):**

```bash
grep -oE 'BG7V_HERO_RESTORE_REASON|hero-restore' dist/assets/index-*.js | sort -u
```

---

## Deployment steps

### 1. Commit and push

```bash
cd ~/projects/reelforge
git status -sb
git push origin main
```

### 2. Deploy frontend (canonical pipeline)

```bash
cd frontend
export NETLIFY_AUTH_TOKEN='your-netlify-personal-access-token'
bash scripts/deploy-netlify.sh "RC1: <short description>"
```

The script:

1. Builds with `VITE_USE_SAME_ORIGIN_API=true`
2. Verifies `dist/_redirects` (API / health / SPA proxy)
3. Runs `netlify deploy --prod --dir=dist`
4. Smoke-checks live `/api/reels`, `/health`, SPA fallback

**No manual production hotfixes.** No hand-edited Netlify bundles.

---

## Post-deployment verification

### Production smoke (Gate 5)

```bash
FRONTEND=https://strong-lolly-a9fcb4.netlify.app

# Bundle hash
curl -sS "$FRONTEND/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'

# BG-7W + BG-7V markers in live JS
BUNDLE=$(curl -sS "$FRONTEND/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -sS "$FRONTEND/$BUNDLE" | grep -E 'BG7V_HERO_RESTORE_REASON|hero-restore'

# API proxy via Netlify
curl -sS -o /dev/null -w "reels:%{http_code}\n" "$FRONTEND/api/reels"
curl -sS -o /dev/null -w "health:%{http_code}\n" "$FRONTEND/health"
```

**Pass:** HTTP 200 on routes; both markers present in bundle.

### BG-7U production verify

```bash
cd frontend
node scripts/mission-bg-7u-hero-persistence-verify.mjs
# Output: /tmp/bg-7u-hero-persistence.json
```

**Pass:**

```json
{
  "identityRestoreOk": true,
  "restoreReason": "RESTORE_SUCCESS"
}
```

---

## RA-01 — Shared state verification (Gate 6)

**Script:** `node scripts/mission-ra-01-shared-state-verify.mjs`  
**Report:** `frontend/RA-01_SHARED_STATE_REPORT.md`  
**Artifact:** `frontend/artifacts/mission-ra-01-shared-state-verify.json`

Three browser contexts:

| Context | Role |
|---------|------|
| **A** | Creator — upload, attach, change hero |
| **B** | Existing viewer — refresh, observe server state |
| **C** | Fresh browser — cleared storage, bootstrap from catalog |

### Required scenarios

| # | Scenario | Pass only if |
|---|----------|--------------|
| 1 | A uploads → B sees reel | Catalog match via `GET /api/reels` |
| 2 | A attaches → B sees attachment | **Server-visible** attachment (studio API), not localStorage alone |
| 3 | A replaces hero → C fresh restore | `RESTORE_SUCCESS` in `[BG7V_HERO_RESTORE_REASON]` |
| 4 | C bootstrap | Vault + hero + readiness bootstrap from server |
| 5 | Regression | Core Playwright missions + module presence green |

### After deploy: classify failures only then

```text
Deploy
    ↓
Run BG-7U
    ↓
Run RA-01
    ↓
Record results
    ↓
Classify each failure:
    • No issue (stale bundle / timing)
    • Operational issue (credentials, deploy)
    • Code issue → new small BG mission
    • Regression → revert / fix boundary
```

**Do not open RA-01A / RA-01B until BG-7W is live on production.** Pre-deploy RA failures on Scenario 3 are deployment blockers, not fix failures.

---

## RA-02 — Stress verification (after RA-01 green)

**Blocked until RA-01 is completely green.**

Planned focus (no new functionality):

- Repeated uploads and refreshes
- Multiple concurrent browser contexts
- Persistence over time
- Cache invalidation / hard refresh
- Deployment consistency across sessions
- Race conditions on bootstrap + restore

Script: TBD (`mission-ra-02-stress-verify.mjs`) — create only after RA-01 passes.

---

## Regression commands (Gate 7)

Core release regression (run against production after deploy):

```bash
cd frontend

# Hero
node scripts/mission-bg-7u-hero-persistence-verify.mjs
node scripts/mission-bg-7a-hero-auto-accept.mjs          # Hero Playwright / confirmation
node scripts/mission-bg-7a1-production-release-validation.mjs

# Creator workflow
node scripts/mission-product-03-episode-attach.mjs       # Episode attachment

# Feed baseline (BG-7T locked — detect drift only)
node scripts/mission-bg-7s-shelf-presentation-validate.mjs

# Shared state
node scripts/mission-ra-01-shared-state-verify.mjs
```

**Module presence** (Action Router, Readiness Board) is checked inside RA-01 `regression.modules_present`.

---

## Rollback procedure

### Frontend (Netlify)

**Known-good baseline tag:**

```bash
git checkout BG-7T-STABLE   # Feed/shelf pipeline locked baseline
# or a newer tag after RC1 sign-off
```

Redeploy from that commit:

```bash
git checkout BG-7T-STABLE
cd frontend
export NETLIFY_AUTH_TOKEN='…'
bash scripts/deploy-netlify.sh "Rollback to BG-7T-STABLE"
```

### Backend (Railway)

Backend changes are out of scope for frontend-only rollback. If API regression occurs, roll back Railway deployment to the deployment ID recorded in the last green `frontend/artifacts/release-manifest-latest.json`.

### Verify rollback

```bash
curl -sS https://strong-lolly-a9fcb4.netlify.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
node scripts/mission-bg-7s-shelf-presentation-validate.mjs
```

---

## Sign-off criteria (Gate 8)

RC1 may be declared when **all** are true:

- [ ] Gates 1–7 PASS on the same commit SHA
- [ ] Production bundle contains BG-7W restore fix
- [ ] BG-7U `identityRestoreOk` + `restoreReason: RESTORE_SUCCESS`
- [ ] RA-01 all required scenarios PASS (post-deploy baseline)
- [ ] RA-02 PASS (when script exists)
- [ ] No open **BG** blockers
- [ ] `BG-7T-STABLE` feed behavior unchanged (regression green)

**Tag release:**

```bash
git tag RC1-STABLE
git push origin RC1-STABLE
```

**Record:** Update `frontend/RA-01_SHARED_STATE_REPORT.md` with final PASS artifact paths and bundle hash.

---

## Current RC1 progress (2026-07-18)

| Area | Status |
|------|--------|
| Core media pipeline | ✅ |
| Hero upload | ✅ |
| Hero restore fix (BG-7W) | ✅ proven locally |
| Episode attachment workflow | ✅ |
| Creator workflow | ✅ |
| Automation | ✅ |
| Production deployment | ⏳ pending push + Netlify |
| Shared-state verification (RA-01) | 🔄 run after deploy |
| RA-02 stress | ⏸ blocked on RA-01 |
| **RC1** | **Not yet — ~90–95%** |

**Local commits ahead of origin (deploy when ready):**

- `268e99e` — BG-7V/7W hero restore fix
- `4ddabba` — RA-01 verification script
- `de225da` — BG-7W / RA-01 deliverables

---

## Immediate roadmap

```text
BG-7W        ✅ local
Deploy       ⏳ push + Netlify
BG-7U prod   ⏳ after deploy
RA-01        ⏳ after deploy (clean baseline)
Classify     ⏳ only then
RA-02        ⏸ after RA-01 green
RC1 tag      ⏸ after all gates
```

**Do not start PRODUCT-07** until RC1 is signed off.

---

## Related documents

| Document | Purpose |
|----------|---------|
| `BG-7V_HERO_RESTORE_INSTRUMENTATION.md` | Restore branch map (BG-7V) |
| `BG-7W_HERO_RESTORE_FIX.md` | Surgical fix evidence |
| `RA-01_SHARED_STATE_REPORT.md` | Latest RA-01 run results |
| `BG_7U_HERO_PERSISTENCE_REPORT.md` | Pre-fix persistence boundary |
| Tag `BG-7T-STABLE` | Feed/shelf rollback baseline |

---

## Release discipline (permanent)

```text
Instrument
    ↓
Prove
    ↓
Repair one boundary
    ↓
Deploy
    ↓
Verify in production
    ↓
Repeat
```

Never combine bug fixes with feature work during RC pursuit.
