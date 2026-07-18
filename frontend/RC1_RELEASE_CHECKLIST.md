# RC1 Release Checklist

**Release ID:** `RC1-2026-07-18-001`  
**Use this identifier in:** checklist, Netlify deploy message, RA reports, release manifest, git tag notes.

**Canonical release process for ReelForge Release Candidate 1**  
**Production:** https://strong-lolly-a9fcb4.netlify.app/  
**API:** https://reelforge-deploy-production.up.railway.app  
**Netlify site ID:** `791fc14c-cee0-4876-986b-a5c455f10d2a`

> RC1 is an **operations and verification exercise**, not a coding exercise.

---

## Mission classification

| Series | Purpose | Changes code? |
|--------|---------|---------------|
| **BG** | Infrastructure defects — instrument → prove → surgical repair | Yes (minimal) |
| **PRODUCT** | Creator capabilities | Yes |
| **RA** | Release acceptance — production verification | **No** |

During RC1 pursuit: **no PRODUCT missions**. Release engineering only.

---

## Freeze rule (until RC1 signed off)

Prevents “just one more improvement” from delaying release or introducing regressions.

**Allowed:**

- Release fixes
- Deployment fixes
- Regression fixes
- RA-discovered issues (after post-deploy classification)
- Documentation updates

**Not allowed:**

- New PRODUCT missions
- UI redesigns
- Refactors
- New features
- Architectural experiments

Everything outside the [RC1 critical path](#rc1-critical-path) is out of scope until RC1 is complete.

---

## RC1 critical path

Official release path — execute in order:

```text
BG-7W                    ✅ Local verification complete
Push to GitHub           ⏳
Netlify deployment       ⏳
Production verification  ⏳
RA-01                    ⏳
Address verified RA findings only (if any)  ⏳
RA-02                    ⏳
RC1-STABLE               ⏳
```

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

**Nothing skips a gate. Do not continue until the current gate's exit criterion is met.**

| # | Gate | Exit criterion |
|---|------|----------------|
| 0 | Environment snapshot | Immutable pre-push record captured; working tree clean for release commits |
| 1 | Local verification | Required scripts exit 0; local bundle has BG-7W markers |
| 2 | Commit frozen | Intended files committed; no accidental artifacts |
| 3 | Push & deploy | Production serves new bundle with BG-7W changes |

**Gate 3 is the pivot point.** Until the new bundle is deployed and verified live, Gates 4–8 are potentially invalid — you may still be testing the previous production build.

| 4 | Production smoke | Production matches validated local build |
| 5 | RA-01 | All required scenarios PASS (post-deploy baseline) |
| 6 | Targeted repairs | Only if RA-01 exposes verified defect; rerun RA-01 |
| 7 | RA-02 + regression | Stress + core regression suite green |
| 8 | RC1 sign-off | Definition of done all ✅; `RC1-STABLE` tag |

---

## Gate ownership

Each gate produces evidence that becomes input to the next. No ambiguity about what “done” means.

| Gate | Input | Output |
|------|-------|--------|
| 0 | Release intent | **Environment snapshot** (immutable starting point) |
| 3 | Local verified build | **Verified production deployment** (bundle + markers) |
| 4 | Verified deployment | **Production smoke evidence** (BG-7U, routes) |
| 5 | Production smoke | **Shared-state evidence** (RA-01 artifact + report) |
| 6 | RA findings (if any) | **Verified repairs** (surgical fix + rerun) |
| 7 | Clean RA-01 | **Stress verification evidence** (RA-02 + regression) |
| 8 | All evidence | **`RC1-STABLE`** tag + archived manifest |

---

## Deployment identity decision rule

**Never diagnose application behavior until deployment identity has been verified.**

```text
Deployment identity verified?
        │
   No ──┴──► Stop (do not run Gates 4–8)

   Yes
        │
        ▼
Run verification
        │
        ▼
Classify findings
```

Deployment identity = Gate 3 complete: new bundle live + `BG7V_HERO_RESTORE_REASON` and `hero-restore` markers present.

---

## Gate execution playbook

**Execute only.** Do not redesign the checklist, invent gates, expand scope, refactor, or start PRODUCT-07 during this release.

Execute gates sequentially. **Stop at any FAIL until resolved.**

### Gate 0 — Environment snapshot

Capture **before** Gate 3 push. Immutable starting point for the release.

```bash
cd ~/projects/reelforge
git rev-parse HEAD
git branch --show-current
git status --porcelain   # must be empty before Gate 3 push
git tag -l 'BG-7T-STABLE' 'RC1-STABLE'
curl -sS https://strong-lolly-a9fcb4.netlify.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
date -u +"%Y-%m-%dT%H:%M:%SZ"
```

Record in `releases/RC1-2026-07-18-001/gate-0-environment-snapshot.json` and [Deployment record](#deployment-record).

| Item | RC1-2026-07-18-001 (captured) |
|------|-------------------------------|
| Release ID | `RC1-2026-07-18-001` |
| Local commit | `fc61c41d710d8d29d2550f6fad2851bc9d860fac` |
| Branch | `main` |
| Working tree | **Not clean** — 66 untracked lines (reports/artifacts only; no pending release code) |
| Local tag | `BG-7T-STABLE` |
| Production bundle (current) | `assets/index-DwXGyOoS.js` |
| Timestamp (UTC) | `2026-07-18T18:48:15Z` |

**Exit criterion:** Snapshot recorded. Before Gate 3 push: `git status --porcelain` empty for release scope (or explicitly accept untracked non-release files).

**Status:** ✅ Snapshot captured · ⚠️ Confirm working tree policy before push

---

### Gate 1–2 — Local verification & commit frozen

See [Local verification](#local-verification). Gate 2: `git status` — only intended release files committed.

**Status (2026-07-18):** ✅ Gates 1–2 complete (8 commits on `main`, BG-7W proven locally).

---

### Gate 3 — Push & deploy (pivot point)

Treat Gate 3 as **formal deployment verification**, not just a deploy command.

**Until Gate 3 exit criterion is met, do not run Gates 4–8.**

#### Step 1 — Push

```bash
cd ~/projects/reelforge
git push origin main
```

#### Step 2 — Deploy

```bash
cd frontend
export NETLIFY_AUTH_TOKEN='your-netlify-personal-access-token'
bash scripts/deploy-netlify.sh "RC1-2026-07-18-001: BG-7W hero restore deploy"
```

#### Step 3 — Verify deployment completed

- Confirm Netlify CLI reports a successful production deploy.
- Record deploy ID and timestamp in [Deployment record](#deployment-record) below.

#### Step 4 — Verify the correct bundle is live

```bash
FRONTEND=https://strong-lolly-a9fcb4.netlify.app
BUNDLE=$(curl -sS "$FRONTEND/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
echo "Live bundle: $BUNDLE"
curl -sS "$FRONTEND/$BUNDLE" | grep -E 'BG7V_HERO_RESTORE_REASON|hero-restore'
```

#### Step 5 — Mark Gate 3 complete (only if Step 4 succeeds)

Record **actual values** in `releases/RC1-2026-07-18-001/gate-3-deployment-record.json`:

| Item | Value (fill on deploy) |
|------|------------------------|
| Push commit | _(SHA pushed)_ |
| Netlify deploy ID | _(from CLI output)_ |
| Deploy finished (UTC) | _(timestamp)_ |
| Production bundle | `assets/index-XXXX.js` |
| Marker `BG7V_HERO_RESTORE_REASON` | ✓ / ✗ |
| Marker `hero-restore` | ✓ / ✗ |

If markers are **not** present: **stop**. Investigate why deployment did not produce the expected bundle. Do not run acceptance tests on a stale build.

**Exit criterion:** Production serves expected bundle containing BG-7W changes; verification markers found.

**Status:** ⏳ Requires GitHub push + Netlify credentials (not available in agent environment).

#### If Gate 3 fails — deployment vs application

Treat deployment failures **separately** from application failures. None of these automatically imply a code regression:

| Symptom | Classification |
|---------|----------------|
| Git push rejected | Source control issue |
| Netlify deploy failed | Deployment issue |
| New bundle not served | Publishing / cache issue |
| Marker absent from served bundle | Deployment verification issue |

Fix the deployment boundary first. Do not open BG missions until deployment identity is verified.

---

## Deployment record

Fill this table when Gate 3 completes. Every RC should have a concise audit trail correlating code, deploy, and verification.

### RC1-2026-07-18-001 (in progress)

| Item | Value |
|------|-------|
| **Release ID** | `RC1-2026-07-18-001` |
| Git commit | `4400f53` (local HEAD — update after push) |
| Git tag | _(pending `RC1-STABLE`)_ |
| Netlify deploy ID | _(record from deploy output)_ |
| Deploy timestamp | _(UTC)_ |
| Netlify deploy message | `RC1-2026-07-18-001: BG-7W hero restore deploy` |
| Production bundle (pre-deploy) | `assets/index-DwXGyOoS.js` |
| Production bundle (post-deploy) | _(fill after Gate 3 Step 4)_ |
| Verification marker found | **No** (pre-deploy — markers absent) |
| Gate 3 complete | ⏳ |

**Release manifest path (fill on sign-off):** `frontend/artifacts/release-manifest-RC1-2026-07-18-001.json`

### Post-deploy verification command (copy/paste)

```bash
FRONTEND=https://strong-lolly-a9fcb4.netlify.app
BUNDLE=$(curl -sS "$FRONTEND/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
echo "commit: $(git rev-parse HEAD)"
echo "bundle: $BUNDLE"
curl -sS "$FRONTEND/$BUNDLE" | grep -E 'BG7V_HERO_RESTORE_REASON|hero-restore' && echo "markers: YES" || echo "markers: NO"
```

---

### Gate 4 — Production smoke

```bash
cd frontend
node scripts/mission-bg-7u-hero-persistence-verify.mjs

curl -sS -o /dev/null -w "health:%{http_code}\n" https://strong-lolly-a9fcb4.netlify.app/health
curl -sS -o /dev/null -w "reels:%{http_code}\n"  https://strong-lolly-a9fcb4.netlify.app/api/reels
```

**Pass when:**

- `identityRestoreOk: true`
- `restoreReason: "RESTORE_SUCCESS"`
- `/health` and `/api/reels` return 200

**Exit criterion:** Production behaves the same as validated local build.

**Status:** ⏳ After Gate 3.

---

### Gate 5 — RA-01

```bash
node scripts/mission-ra-01-shared-state-verify.mjs
# Artifact: frontend/artifacts/mission-ra-01-shared-state-verify.json
# Report:   frontend/RA-01_SHARED_STATE_REPORT.md
```

Run **only after** Gate 4 passes. Classify every FAIL:

| Classification | Action |
|----------------|--------|
| Deployment / configuration | Redeploy, fix env, re-smoke |
| Operational | Credentials, timing, external service |
| Genuine code defect | Narrow RA follow-up → surgical BG fix → rerun scenario → full RA-01 |

**Do not assume a code bug until deployed baseline is verified.**

**Exit criterion:** All required RA-01 scenarios PASS.

**Status:** ⏳ After Gate 4. Pre-deploy run (`RA-01-2026-07-18-001-pre`) documented in `RA-01_SHARED_STATE_REPORT.md` — **invalid per deployment identity rule** until Gate 3 passes.

#### If Gate 5 finds an issue — repair discipline

Use the same BG mission discipline:

1. Reproduce  
2. Instrument if necessary  
3. Isolate the boundary  
4. One surgical repair  
5. Re-run the affected gate  
6. Re-run the full acceptance gate  

No accumulating “fixes” without proof. No PRODUCT work.

---

### Gate 6 — Targeted repairs (only if required)

If Gate 5 exposes a verified defect:

1. Create narrowly scoped follow-up (not a feature mission)
2. Repair only that boundary
3. Rerun affected RA-01 scenario
4. Rerun **complete** RA-01

**Do not broaden scope. Do not resume PRODUCT work.**

**Status:** ⏳ Only if Gate 5 requires it.

---

### Gate 7 — RA-02 + regression

**Blocked until Gate 5 is fully green.**

Stress verification (script TBD after RA-01 passes):

- Repeated uploads and refreshes
- Multiple browser sessions
- Persistence over time
- Cache invalidation
- Regression confirmation

Plus [regression commands](#regression-commands) — hero, attachment, feed baseline.

**Exit criterion:** RA-02 + core regression suite exit 0.

**Status:** ⏳ After RA-01 green.

---

### Gate 8 — RC1 sign-off

Only when [Definition of done](#definition-of-done) is all ✅:

```bash
git tag -a RC1-STABLE -m "Release ID: RC1-2026-07-18-001"
git push origin RC1-STABLE
```

Archive release artifacts (`frontend/artifacts/`, verification JSON outputs). Freeze RC1. Branch `vNext` for post-release work.

**Success statement (target):**

> Open this Netlify URL in a browser you've never used before. Uploads, attachments, Hero state, and production workflow have been validated through repeatable release acceptance tests.

**Status:** ⏳

---

## Gate reference (commands)

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

### Definition of done

RC1 is complete only when **all** requirements are true:

| Requirement | Status |
|-------------|--------|
| BG-7W deployed to production | ⏳ |
| Production bundle verified | ⏳ |
| Hero restore passes in a fresh browser | ⏳ |
| RA-01 passes after deployment | ⏳ |
| Any RA findings resolved and reverified | ⏳ |
| RA-02 passes | ⏳ |
| Regression suite passes | ⏳ |
| RC1 checklist signed off | ⏳ |
| RC1-STABLE tag created | ⏳ |

Update the **Status** column as each gate completes. All must be ✅ before sign-off.

### Gate checklist

RC1 may be declared when **all** are true:

- [ ] Gate 0 environment snapshot recorded
- [ ] Gates 1–7 PASS on the same commit SHA
- [ ] Production bundle contains BG-7W restore fix
- [ ] BG-7U `identityRestoreOk` + `restoreReason: RESTORE_SUCCESS`
- [ ] RA-01 all required scenarios PASS (post-deploy baseline)
- [ ] RA-02 PASS (when script exists)
- [ ] No open **BG** blockers
- [ ] `BG-7T-STABLE` feed behavior unchanged (regression green)

**Tag release:**

```bash
git tag -a RC1-STABLE -m "Release ID: RC1-2026-07-18-001"
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
| Gate 0 snapshot | ✅ captured |
| Production deployment | ⏳ pending push + Netlify |
| Shared-state verification (RA-01) | 🔄 run after deploy |
| RA-02 stress | ⏸ blocked on RA-01 |
| **RC1** | **Not yet — ~90–95%** |

**Local commits ahead of origin (deploy when ready):**

- `268e99e` — BG-7V/7W hero restore fix
- `4ddabba` — RA-01 verification script
- `de225da` — BG-7W / RA-01 deliverables
- `756f29f` — RC1 release checklist
- `3bbfdc5` — freeze rule + definition of done
- `fc61c41` — RC1-2026-07-18-001 release ID + gate ownership
- _(Gate 0 snapshot commit pending)_

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

## After RC1 (post-release)

Once RC1 is signed off:

1. Create `RC1-STABLE` tag (see Gate 8)
2. Open a new branch or milestone for post-release work (e.g. `vNext`, `PRODUCT-07`)
3. Resume feature development on that branch without jeopardizing the released baseline

The RC1 branch/tag remains the rollback and support reference.

---

## Release evidence archive

After `RC1-STABLE`, archive the complete evidence package:

```text
releases/RC1-2026-07-18-001/
    gate-0-environment-snapshot.json
    gate-3-deployment-record.json
    release-manifest.json
    RC1_RELEASE_CHECKLIST.md
    RA-01_SHARED_STATE_REPORT.md
    RA-02_STRESS_REPORT.md          (when Gate 7 complete)
    BG-7W_HERO_RESTORE_FIX.md
    README.md
```

See `releases/RC1-2026-07-18-001/README.md` for copy commands.

**Success statement:**

> Release `RC1-2026-07-18-001` is traceable from source commit → deployed bundle → production verification → multi-browser acceptance testing.

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
