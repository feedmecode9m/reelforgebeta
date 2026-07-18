# BG-7V — Hero Restore Branch Instrumentation

**Mission:** BG-7V — Hero Restore Branch Reason Codes  
**Date:** 2026-07-18  
**Status:** COMPLETE ✅ (instrumentation only — no behavior changes)  
**Scope:** `frontend/src/lib/mediaBootstrap.js`, `frontend/src/lib/diagnostics/bg7vHeroRestoreReason.js`

---

## Executive summary

BG-7U proved catalog match + manager config survive persistence, but `restoreHeroReelIdentityFromReels()` returns `restored: false`. BG-7V adds structured reason codes on every restore exit path.

**Exact failure branch identified:**

```text
restoreHeroReelIdentityFromReels()
        ↓
catalog match found (matchedReelId === heroAssetId)
        ↓
resolveMediaUrl(matched)   ← reel object passed, not string URL
        ↓
returns "" (typeof matched !== 'string')
        ↓
reason: INVALID_URL
detail: resolveMediaUrl_empty
```

This is instrumentation-only. Behavior is unchanged; BG-7W should fix this single branch.

---

## 1. Restore state machine

```text
                    ┌─────────────────────┐
                    │ hydrateVaultFromReels│
                    │ GET /api/reels       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ restoreHeroReelIdentity│
                    │ FromReels(reels)     │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     NO_HERO_ID         ALREADY_PRESENT   NO_CATALOG_MATCH
     (no manager id)   (reel in LS)       (id not in reels)
              │                │                │
              └────────────────┼────────────────┘
                               │
                    catalog match found
                               │
                    ┌──────────▼──────────┐
                    │ resolveMediaUrl()    │
                    └──────────┬──────────┘
                               │
              INVALID_URL ◄────┤ resolveMediaUrl_empty  ◄── BG-7U/7V failure
                               │
                    ┌──────────▼──────────┐
                    │ heroReelFromUpload   │
                    │ Response()           │
                    └──────────┬──────────┘
                               │
         INVALID_REEL ─────────┤ null reel
         CONFIG_MISMATCH ──────┤ reel.id !== heroAssetId
         INVALID_URL ─────────┤ empty reel.url
                               │
                    ┌──────────▼──────────┐
                    │ saveHeroReel()       │
                    └──────────┬──────────┘
                               │
         SAVE_EXCEPTION ──────┤ try/catch
         SAVE_REJECTED ───────┤ returns null
         RESTORE_SUCCESS ─────┤ saved to localStorage
```

---

## 2. Branch map

| Step | Condition | Reason code | `restoreAttempted` | `restored` |
|------|-----------|-------------|-------------------|------------|
| 1 | No `heroAssetId` in manager config | `NO_HERO_ID` | false | false |
| 2 | `loadHeroReel()` already has id | `ALREADY_PRESENT` | false | false |
| 3 | No reel in catalog with matching id | `NO_CATALOG_MATCH` | true | false |
| 4 | `resolveMediaUrl(matched)` empty | `INVALID_URL` | true | false |
| 5 | `heroReelFromUploadResponse()` null | `INVALID_REEL` | true | false |
| 6 | Built reel id ≠ heroAssetId | `CONFIG_MISMATCH` | true | false |
| 7 | Built reel has empty url | `INVALID_URL` | true | false |
| 8 | `saveHeroReel()` throws | `SAVE_EXCEPTION` | true | false |
| 9 | `saveHeroReel()` returns null | `SAVE_REJECTED` | true | false |
| 10 | Save succeeds | `RESTORE_SUCCESS` | true | true |

Log tag: `[BG7V_HERO_RESTORE_REASON]`

Example payload:

```json
{
  "heroAssetId": "aa0691a3-69da-46d6-9ffd-a7f20cf7c976",
  "matchedReelId": "aa0691a3-69da-46d6-9ffd-a7f20cf7c976",
  "restoreAttempted": true,
  "restored": false,
  "reason": "INVALID_URL",
  "detail": "resolveMediaUrl_empty",
  "timestamp": "2026-07-18T18:06:24.887Z"
}
```

---

## 3. Reason codes added

| Code | Meaning |
|------|---------|
| `NO_HERO_ID` | Manager config has no `heroAssetId` / `backgroundAsset` |
| `NO_CATALOG_MATCH` | Catalog fetched but no reel id matches heroAssetId |
| `INVALID_REEL` | `heroReelFromUploadResponse()` returned null |
| `INVALID_URL` | URL resolution failed (`resolveMediaUrl_empty` or `reel_url_empty_after_build`) |
| `SAVE_REJECTED` | `saveHeroReel()` returned null (missing id/url guard) |
| `SAVE_EXCEPTION` | `saveHeroReel()` threw |
| `CONFIG_MISMATCH` | Built reel id does not match manager heroAssetId |
| `RESTORE_SUCCESS` | Reel written to `reelforge_hero_reel` |
| `ALREADY_PRESENT` | Canonical reel already in localStorage (no restore needed) |

**Files changed (instrumentation only):**

- `src/lib/diagnostics/bg7vHeroRestoreReason.js` — new reason logger
- `src/lib/mediaBootstrap.js` — `restoreHeroReelIdentityFromReels()` branch instrumentation
- `scripts/mission-bg-7u-hero-persistence-verify.mjs` — captures `[BG7V_HERO_RESTORE_REASON]` + `restoreReason` in summary
- `scripts/mission-bg-7v-restore-reason-smoke.mjs` — focused Test 4 boundary smoke (mock API)

**Not modified:** feed pipeline, shelf/category logic, upload pipeline, backend APIs, database schema, default hero fallback.

---

## 4. Verification output

### BG-7U script (updated — captures reason when deployed)

```bash
cd frontend
npm run build && npm run preview -- --port 4173 --host 127.0.0.1 --strictPort
# separate terminal:
node scripts/mission-bg-7u-hero-persistence-verify.mjs
```

Before BG-7V:

```json
{ "restored": false, "matchedReelId": "aa0691a3-..." }
```

After BG-7V (expected on identity restore failure):

```json
{
  "restored": false,
  "matchedReelId": "aa0691a3-...",
  "reason": "INVALID_URL",
  "detail": "resolveMediaUrl_empty"
}
```

### BG-7V smoke (Test 4 boundary, mocked catalog)

```bash
FRONTEND_URL=http://127.0.0.1:4173/ node scripts/mission-bg-7v-restore-reason-smoke.mjs
```

**Actual output (2026-07-18):**

```json
{
  "restoreReason": "INVALID_URL",
  "bg7vRestoreTrace": {
    "heroAssetId": "aa0691a3-69da-46d6-9ffd-a7f20cf7c976",
    "matchedReelId": "aa0691a3-69da-46d6-9ffd-a7f20cf7c976",
    "restoreAttempted": true,
    "restored": false,
    "reason": "INVALID_URL",
    "detail": "resolveMediaUrl_empty"
  },
  "restoredReel": null
}
```

Console:

```text
[BG7V_HERO_RESTORE_REASON] restored:false reason:INVALID_URL detail:resolveMediaUrl_empty
[BG7J_HERO_RESTORE] restored:false matchedReelId:aa0691a3-...
```

---

## 5. Exact failure branch (BG-7W target)

**Location:** `restoreHeroReelIdentityFromReels()` in `mediaBootstrap.js`

**Failing line:**

```javascript
const mediaUrl = resolveMediaUrl(matched);
```

**Root cause:** `resolveMediaUrl()` expects a **string URL** (`reelContract.js` line 33: `typeof url !== 'string'` → returns `''`). The restore path passes the **whole reel object** (`matched`). Catalog reels from GET `/api/reels` have valid `url` strings, but the pre-save guard never reaches `heroReelFromUploadResponse()` because the object-typed call fails first.

**BG-7W surgical fix (not applied here):** Pass `String(matched.url || '')` (or equivalent) to `resolveMediaUrl`, or remove the redundant guard and rely on `heroReelFromUploadResponse()` which already normalizes the reel.

---

## Success criteria

| Criterion | Status |
|-----------|--------|
| Every restore exit has a reason | ✅ |
| Failure branch identified | ✅ `INVALID_URL` / `resolveMediaUrl_empty` |
| No behavior changes introduced | ✅ |
| BG-7T remains untouched | ✅ |

---

## Next mission

```text
BG-7V  →  Find failing restore branch     ✅ DONE
BG-7W  →  Fix only INVALID_URL guard      (next)
```
