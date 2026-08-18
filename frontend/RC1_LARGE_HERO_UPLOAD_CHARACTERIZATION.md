# RC1-2026-07-18-001 — Large Hero Upload Characterization

**Release:** RC1-STABLE (`RC1-2026-07-18-001`)  
**Classification:** Post-RC1 evidence — validation only, no application code changes  
**Asset:** `condo_v1_2.mp4` (~362 MB)  
**Production:** https://strong-lolly-a9fcb4.netlify.app/  
**Bundle:** `assets/index-DQeGd3cl.js`

---

## Purpose

Separate three timings that prior RC gates conflated:

1. **Upload transfer** — browser → `POST /api/reels`
2. **Backend ingest** — 202 Accepted → ffmpeg → `status: ready`
3. **Hero restore** — fresh session → `BG7V_HERO_RESTORE_REASON: RESTORE_SUCCESS`

---

## RC1 baseline (confirmed before characterization)

| Check | Result |
|-------|--------|
| `/api/health` | 200 (~1.1s via Netlify) |
| `/api/reels` | 200 (~0.35s) |
| Production bundle | `index-DQeGd3cl.js` |
| BG7V marker | Present |
| Prior condo in catalog | None at characterization start |

---

## Test A — Upload transfer (browser pipeline)

**Method:** Playwright hero vault upload with network phase capture  
**Script:** `frontend/scripts/mission-rc1-large-hero-upload-characterization.mjs`

Record:

| Field | Source |
|-------|--------|
| Request start | `UPLOAD_STARTED` phase |
| Bytes dispatched | `UPLOAD_BYTES_SENT` (setInputFiles) |
| POST finished | `POST_COMPLETE` (status, elapsedMs) |
| Hero localStorage | `testA_upload.heroAfterUpload` |

**Interpretation guide:**

| POST outcome | Meaning |
|--------------|---------|
| 202 after many minutes | Large upload — not backend failure |
| No POST in window | UI timeout / proxy limit — investigate Netlify body limits |
| 200/201 immediate ready | Sync ingest (unlikely at 346MB) |

---

## Test B — Catalog / ingestion (REST)

After POST returns, poll:

```bash
curl -sS "https://strong-lolly-a9fcb4.netlify.app/api/reels/REEL_ID" | jq '{id, name, status, category, url}'
```

Or full catalog filter:

```bash
curl -sS "https://strong-lolly-a9fcb4.netlify.app/api/reels" \
  | jq '[.[] | select((.name // "") | test("condo"; "i"))]'
```

Record:

- `exists`
- `status` (`pending` → `ready` | `failed`)
- `category` (expect `HERO`)
- `url`

Script emits `INGESTION_STARTED` / `INGESTION_COMPLETE` / `INGESTION_TIMEOUT`.

---

## Test C — Hero restore (fresh session)

Fresh Playwright context:

1. Seed `reelforge_hero_manager_config.heroAssetId` from catalog reel id (not copied from uploader localStorage)
2. Clear `reelforge_hero_reel`
3. Reload production
4. Capture `[BG7V_HERO_RESTORE_REASON]`

**Pass:** `{ restored: true, reason: "RESTORE_SUCCESS" }` and hero reel id matches catalog.

---

## Phase timeline (final — 2026-07-18)

> Artifact: `frontend/artifacts/rc1-large-hero-upload-characterization.json`  
> Completed: `2026-07-18T20:47:55Z` · **pass: false** (expected — transport blocked downstream phases)

| Phase | Timestamp (UTC) | Detail | Result |
|-------|-----------------|--------|--------|
| UPLOAD_STARTED | 2026-07-18T20:17:16Z | 362,155,056 bytes | ✅ |
| UPLOAD_BYTES_SENT | 2026-07-18T20:17:31Z | setInputFiles dispatched | ✅ 26ms |
| POST_COMPLETE | 2026-07-18T20:22:31Z | status **502**, elapsedMs **300105** | ❌ Case 1 transport |
| TEST_B_CATALOG_CHECK | 2026-07-18T20:47:55Z | reelId null | ⏭ blocked |
| INGESTION_* | — | not reached | ⏭ blocked |
| RESTORE_COMPLETE | — | `testC_restore.skipped: no_reel_id` | ⏭ blocked |

**Verdict:** Primary failure is **Netlify/proxy transport at ~5 minutes** on 346MB POST. Does not invalidate RC1-STABLE.

```bash
jq '.phases, .testA_upload, .testB_catalog, .testC_restore, .pass' \
  frontend/artifacts/rc1-large-hero-upload-characterization.json
```

---

## Run command

```bash
cd ~/projects/reelforge/frontend

# Default: 30 min upload wait, 15 min ingest poll
UPLOAD_WAIT_MS=1800000 INGEST_WAIT_MS=900000 \
  node scripts/mission-rc1-large-hero-upload-characterization.mjs
```

Artifact: `frontend/artifacts/rc1-large-hero-upload-characterization.json`

---

## Failure classification (no fixes during characterization)

| Class | Label |
|-------|-------|
| POST never completes | A — Upload transfer |
| POST ok, ingest never ready | B — Backend persistence / ingest timeout |
| Ingest ok, refresh loses hero | C — Hero identity persistence |
| Fresh session no RESTORE_SUCCESS | D — Restore boundary |
| REST ok, UI reconnecting | E — Connectivity UX (PRODUCT-08) |

---

## RC1 verdict

This characterization does **not** reopen RC1-STABLE. It measures production edge behavior for large hero assets and feeds **PRODUCT-08** post-release work.

**Milestone:**

```text
RC1-STABLE ✅
  ├── BG-7W ✅
  ├── RA-01 ✅
  ├── RA-02 ✅
  └── condo large-file characterization ⏳ **502 @ ~300s — Case 1 transport**
```
