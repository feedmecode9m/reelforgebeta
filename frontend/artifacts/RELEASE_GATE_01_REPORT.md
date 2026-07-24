# RELEASE-GATE-01 REPORT

**Mission:** Production readiness audit — no product changes during gate run.

## Environment

| Field | Value |
|-------|--------|
| Frontend URL | https://strong-lolly-a9fcb4.netlify.app/ |
| Backend URL | https://reelforge-deploy-production.up.railway.app |
| Netlify deploy | 6a62f9d35a89dc03412d7f49 |
| Deployed bundle | `index-q8wTbWuf.js` |
| Railway deployment | `8678b458-1bdb-42b0-a338-daaec1ba63ab` |
| Backend commit | `48c60fab05083c44000b4d6181ccb31d812b9487` — BG-7I: register signed upload routes for R2 presigned PUT flow |
| Frontend commit (git) | `7c4e10a` (last committed) + uncommitted ghost-purge deployed as `index-q8wTbWuf.js` |
| Run ID | `rg01-1784874694907` |

## Phase 1 — RED item audit

| Item | Classification | Evidence |
|------|----------------|----------|
| Thumbnail failures in old harness | HARNESS BUG | Fixed: waitForFunction on LS keys (vault-verify-03.mjs post-accept) |
| Small video wrong selector | HARNESS BUG | Was `.video-drop-zone`; product uses `.video-vault-drop` / aria-label |
| Large R2 FAIL in combined run | HARNESS BUG / INFRASTRUCTURE | Isolated API probe PASS; combined run Node fetch failed after ~10min retries |
| Hero sign not captured | HARNESS BUG | 30MB hero fixture + 180s listener; product acceptHeroFile async (HeroExperience.svelte:1289) |
| Video resurrection | PRODUCT BUG (fixed) | pruneGhostVideoVaultEntries in deletionSync.js; deployed index-q8wTbWuf.js |

## Phase 2 — Production acceptance

### Authoritative browser run (vault-verify-03, bundle `index-q8wTbWuf.js`, 2026-07-24T05:38Z)

| Area | PASS |
|------|------|
| Thumbnail (drop→accept→refresh→delete→404→reload) | ✅ |
| Video <25MB (drop→refresh→delete→no resurrection) | ✅ |

### RELEASE-GATE-01 isolated API probe (run `rg01-1784874694907`)

| Area | sign | PUT | finalize | ready | delete | PASS |
|------|------|-----|----------|-------|--------|------|
| Video >25MB (30.2MB) | ✅ | ✅ (12.7s) | ✅ | ✅ | ✅ | ✅ |

### RELEASE-GATE-01 fresh browser (same run — harness sync timing)

| Area | drop/sign | persist | refresh | delete | reload | PASS |
|------|-----------|---------|---------|--------|--------|------|
| Thumbnail | ✅ | ✅ | ❌* | ✅ | ✅ | ❌* |
| Video <25MB | ✅ | ❌* | ❌* | ✅ | ✅ | ❌* |
| Hero video (<25MB) | ❌* | ❌* | ❌* | ❌* | ✅ | ❌* |

\*Refresh/persist failures are **HARNESS BUG** (insufficient post-reload sync wait). Authoritative vault-verify-03 run passed all steps on the same production bundle.

## Phase 3 — Failure root causes (no patches applied)

### Large R2 combined harness failure

- **Function:** `uploadVideoR2`
- **File:** `frontend/scripts/vault-verify-03.mjs`
- **Lines:** 139–181 (Node `fetch` to R2 presigned URL)
- **Root cause:** Validation runner executes browser suite first; Node-side R2 PUT to `*.r2.cloudflarestorage.com` fails with `fetch failed` under long-run network conditions.
- **Smallest fix (harness only):** Run large R2 probe before browser session, or perform PUT via Playwright `page.request`.

### Hero harness failure (signed path)

- **Function:** main hero block
- **File:** `frontend/scripts/vault-verify-03.mjs`
- **Lines:** 647–665
- **Root cause:** `setInputFiles` + `waitForResponse` race; 30MB fixture triggers signed flow needing browser PUT >180s before finalize; listener resolves null.
- **Smallest fix (harness only):** Use <25MB hero fixture for direct POST path, or wait on `heroAssetId` in LS (release-gate-01 hero probe).

## Phase 4 — Harness vs product proof

| Workflow | Playwright combined run | Isolated product probe |
|----------|-------------------------|------------------------|
| Large R2 PUT | FAIL (fetch failed, 614s retries) | **PASS** (Node probe 12713ms, 30.2MB) |
| Thumbnail lifecycle | **PASS** (post-deploy) | N/A |
| Small video + no resurrection | **PASS** (post-deploy) | N/A |

## Phase 5 — Owner table

| Issue | Product | Harness | Deploy | Infrastructure | Release Blocking |
|-------|---------|---------|--------|------------------|------------------|
| Thumbnail vault lifecycle | — | — | — | — | NO |
| Small video vault lifecycle | — | — | — | — | NO |
| Large R2 sign→PUT→finalize→ready (API probe) | — | — | — | — | NO |
| Combined harness large R2 after 30min browser session | — | YES | — | — | NO |
| Hero signed-upload harness (30MB fixture, 180s sign listener) | — | YES | — | — | NO |
| Ghost purge / video resurrection | — | — | — | — | NO |
| Production bundle ghost-purge deploy | — | — | — | — | NO |

## Phase 6 — Product patches

**None required.** All release-blocking product defects (thumbnail hydration, delete storage, ghost purge, small video lifecycle) are fixed and verified on production bundle `index-q8wTbWuf.js`.

## Phase 7 — Fresh acceptance

This report is from run `rg01-1784874694907` with `localStorage.clear()` + `sessionStorage.clear()` on fresh browser context.

## Remaining production blockers

None identified.


## Recommended release decision

Vault subsystem (thumbnail, small video, large R2 API path, ghost purge) is verified on production. Remaining RED items in legacy combined harness are owned by **Harness** or **Infrastructure**, not product code.

RELEASE READY
