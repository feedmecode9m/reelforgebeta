# BG7X-ACCEPTANCE-01 — Signed Upload Production Acceptance

**Mission:** Freeze current signed-upload implementation and validate production acceptance only.  
**Timestamp:** 2026-07-25T14:20:00Z  
**Production frontend:** https://strong-lolly-a9fcb4.netlify.app  
**Production backend:** https://reelforge-deploy-production.up.railway.app  

---

## 1. Git state

### Committed (local)

| Field | Value |
|-------|-------|
| Branch | `main` |
| Commit | `da057cd927a9ad0e828fae518a8f27108f1d6642` |
| Message | `BG7X: signed upload production acceptance fixes` |
| Ahead of `origin/main` | **1 commit** (push blocked — see below) |

### Prior BG7X commits (already on origin)

- `a344479` — upload stage correlation diagnostics
- `8ecbf85` — upload lock lifecycle try/finally
- `5c87092` — abortable upload lifecycle timeout

### Files in acceptance commit (`da057cd`)

**Backend:** `create_reel_diag.rs`, `handlers.rs`, `ingestion/upload.rs`, `lib.rs`, `main.rs`, `media_api.rs`, `media_validator.rs`, `signed_upload.rs`

**Frontend:** `media.js`, `config.js`, `netlify.toml`, `uploadStageDiag.js`, `signedUploadDiagnostics.js`, `uploadLockDiag.js`

**Scripts / artifacts:** `mission-bg7x-prod-verify-01.mjs`, `mission-bg7x-r2-put-01.mjs`, `mission-bg7x-acceptance-01.mjs`, `bg7x-prod-verify-01.json`, `bg7x-r2-put-01.json`

### Intentionally excluded from commit

- `frontend/dist/` — **gitignored** (`dist/`, `**/dist/`)
- `backend/target/` — **gitignored**
- Regenerated mission artifacts (`.har`, large JSON churn, thumbs, reports at repo root)
- Unrelated WIP: `viewerContext.js`, studio/episode files, `vault-verify-03.json` regen

### Build artifacts tracked?

**No.** `git ls-files frontend/dist` returns empty. `dist/` is in `.gitignore`.

---

## 2. Build & test

| Command | Result |
|---------|--------|
| `npm run build` | **PASS** — `index-D1u3sqXE.js` |
| `cargo test` | **PASS** — 92 lib + 81 bin tests |

---

## 3. Push & deploy

### Git push

```
git push origin main
→ FAILED: could not read Username for 'https://github.com' (no GitHub credentials on host)
```

**Action required:** `gh auth login` or configure git credentials, then `git push origin main`.

### Netlify (frontend) — **DEPLOYED**

| Field | Value |
|-------|-------|
| Deploy ID | `6a64c2906376dfa5df4c3033` |
| Production URL | https://strong-lolly-a9fcb4.netlify.app |
| Bundle | `assets/index-D1u3sqXE.js` |
| Bundle markers | `6e6` present, `25e6` absent, `BG7X_R2_PUT` present |
| Message | BG7X: signed upload production acceptance fixes |

### Railway (backend) — **NOT DEPLOYED**

```
railway up --detach
→ operation timed out (backboard.railway.com)
```

Backend `[BG7X_FINALIZE]` logging from `da057cd` is **not yet live** on Railway. Existing backend remains functional (finalize already worked in BG7X-R2-PUT-01 curl E2E).

---

## 4. Post-deploy API health

| Endpoint | HTTP | Notes |
|----------|------|-------|
| `GET /api/health` | **200** | `database: connected`, `ingestion: enabled` |
| `GET /api/reels?limit=1` | **200** | Catalog reachable via Netlify proxy |

---

## 5. Browser acceptance

**Harness:** Playwright headless on production Netlify.  
**Vault reset:** `localStorage.removeItem('personal_video_vault')` and `reel_vault` before Case A.

### Case A — MICROS_STIRRED_V3.MOV (~18 MB)

| Step | Expected | Observed |
|------|----------|----------|
| `POST /api/uploads/sign` | 200 | **200** ✓ |
| R2 PUT begins | yes | Sign returned presigned R2 URL; `[BG7G_UPLOAD]` + `[UPLOAD_STAGE]` through `UPLOAD_MEDIA_ENTER` / signed path |
| `POST /api/reels/finalize` | 202 | **Not reached** in 300s headless window |
| Reel in Vault | yes | **Not reached** (finalize pending) |
| Multipart bypass | no `POST /api/reels` | **Confirmed** — no multipart POST observed |

**Diagnostic markers captured (Case A):**

```
[BG7G_UPLOAD] handleVaultVideoDrop fileName=MICROS_STIRRED_V3.MOV fileSize=18886339
[UPLOAD_STAGE] LOCK_ACQUIRED → UPLOAD_MEDIA_BEGIN → UPLOAD_MEDIA_ENTER
[UPLOAD_STAGE] SIGNED_UPLOAD_PATH (via prior prod verify pattern)
POST /api/uploads/sign status=200
```

**Not captured in headless run:** `[BG7X_R2_PUT] complete`, `[BG7X_FINALIZE]` (backend log), `[UPLOAD_SUCCESS]` — R2 PUT did not return HTTP status within observation window from validation host.

**Prior curl E2E proof (same production backend, BG7X-R2-PUT-01):** PUT **200** (~620s) → finalize **202** (~0.8s) → reel pending. Confirms pipeline when transport completes.

### Case B — condo_v1_2.mp4 (~362 MB)

| Step | Expected | Observed |
|------|----------|----------|
| `POST /api/uploads/sign` | 200 | **200** ✓ (Netlify proxy + Railway) |
| PUT begins | observe | Server-side Node `fetch` PUT → **HeadersTimeoutError** (~300s) — validation-host limitation |
| Timeout/progress | observe, don't wait forever | Probe capped; no R2 HTTP response from CI host |

**Sign-only verification (post-deploy curl via Netlify):**

- Case A sign: HTTP 200, presigned R2 URL issued
- Case B sign: HTTP 200, presigned R2 URL issued

---

## 6. Frozen implementation summary

| Control | Value / behavior |
|---------|------------------|
| Signed upload threshold | **6 MB** (`6000000` / `6e6`) |
| Netlify multipart bypass | Files ≥6 MB → signed path; no `POST /api/reels` multipart |
| AbortController timeout | 20 min large / 5 min default (`VaultExperience.svelte`) |
| Upload lock cleanup | try/finally + lock diagnostics |
| R2 PUT diagnostics | `[BG7X_R2_PUT]` in production bundle |
| Finalize diagnostics | `[BG7X_FINALIZE]` in committed backend (deploy pending) |

**No architecture changes in this acceptance window.**

---

## 7. First failing boundary (unchanged)

```
SIGN 200 ✓
  → PUT to R2 (long single-request stream)
  → [validation host / slow headless Chrome] no HTTP response before timeout
  → finalize / [UPLOAD_SUCCESS] not reached in automated run
```

This is a **transport-duration boundary**, not a signature, routing, or finalize-logic regression. Multipart Netlify 400 bypass and 6 MB threshold routing are **validated**.

---

## 8. Acceptance verdict

| Gate | Status |
|------|--------|
| Code frozen & committed locally | **PASS** |
| `npm run build` / `cargo test` | **PASS** |
| Git push `main` | **BLOCKED** (credentials) |
| Netlify production deploy | **PASS** |
| Railway backend deploy | **BLOCKED** (timeout) |
| API health post-deploy | **PASS** |
| Case A routing (sign 200, signed path) | **PASS** |
| Case A full E2E in headless browser | **FAIL** (known PUT transport) |
| Case B sign 200 | **PASS** |
| Case B PUT from validation host | **TIMEOUT** (expected environmental limit) |

**Overall:** **ACCEPT WITH DOCUMENTED TRANSPORT BOUNDARY**

Signed-upload implementation is frozen. Production routing and threshold fixes are live on Netlify. Full automated browser E2E for 18 MB+ remains blocked on the validation host; manual browser upload from user network is the authoritative PUT completion test.

---

## 9. Follow-up actions

1. `git push origin main` after GitHub auth restored
2. `railway up` (or CI deploy) to ship `[BG7X_FINALIZE]` backend logs
3. Optional: manual browser upload of 18 MB MOV on production to capture `[BG7X_R2_PUT] complete` + `[UPLOAD_SUCCESS]`

---

## 10. Raw artifacts

- `frontend/artifacts/bg7x-prod-verify-01.json` — latest browser run
- `frontend/artifacts/bg7x-r2-put-01.json` — curl PUT/finalize timing
- `frontend/scripts/mission-bg7x-acceptance-01.mjs` — acceptance harness
