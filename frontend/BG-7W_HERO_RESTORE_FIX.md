# BG-7W — Hero Restore Boundary Repair

**Classification:** Infrastructure Repair  
**Priority:** Critical (Release Gate)  
**Status:** FIXED locally ✅ · Production deploy **PENDING** ⏳  
**Date:** 2026-07-18  
**Commit:** `268e99e` — `BG-7V/7W: hero restore instrumentation and INVALID_URL fix`

---

## Root cause

BG-7V isolated the failure to a single guard in `restoreHeroReelIdentityFromReels()`:

```text
catalog match found
        ↓
resolveMediaUrl(matched)     ← reel OBJECT passed
        ↓
typeof url !== 'string' → ''
        ↓
INVALID_URL (restore aborted)
```

`resolveMediaUrl()` in `reelContract.js` requires a **string URL**. The restore path passed the entire normalized reel object. Catalog reels from `GET /api/reels` have valid `url` fields, but the pre-save guard never reached `heroReelFromUploadResponse()`.

Upload, persistence, manager config, and catalog matching were already validated by BG-7U.

---

## Code path changed

**File:** `frontend/src/lib/mediaBootstrap.js`  
**Function:** `restoreHeroReelIdentityFromReels()`

### Before

```javascript
const mediaUrl = resolveMediaUrl(matched);
```

### After

```javascript
const matchedMediaUrl = String(
    matched.url ?? matched.video_url ?? matched.videoUrl ?? matched.videoPath ?? ''
).trim();
const mediaUrl = resolveMediaUrl(matchedMediaUrl, 'video', 'hero-restore');
```

**Scope:** One surgical branch only. No fallback masking. BG-7T feed/shelf pipeline untouched.

---

## Expected flow (after fix)

```text
Catalog Match
      ↓
Extract canonical URL string
      ↓
resolveMediaUrl(validString)
      ↓
heroReelFromUploadResponse()
      ↓
saveHeroReel()
      ↓
RESTORE_SUCCESS
```

---

## Validation evidence

### Local bundle (post-fix build)

```bash
grep -oE 'BG7V_HERO_RESTORE_REASON|hero-restore' frontend/dist/assets/index-*.js | sort -u
```

```text
BG7V_HERO_RESTORE_REASON
hero-restore
```

### BG-7V restore smoke (Test 4 boundary)

```bash
cd frontend
npm run build && npm run preview -- --port 4173 --host 127.0.0.1 --strictPort
FRONTEND_URL=http://127.0.0.1:4173/ node scripts/mission-bg-7v-restore-reason-smoke.mjs
```

**Result (2026-07-18):**

```json
{
  "restoreReason": "RESTORE_SUCCESS",
  "bg7vRestoreTrace": {
    "heroAssetId": "aa0691a3-69da-46d6-9ffd-a7f20cf7c976",
    "matchedReelId": "aa0691a3-69da-46d6-9ffd-a7f20cf7c976",
    "restoreAttempted": true,
    "restored": true,
    "reason": "RESTORE_SUCCESS"
  },
  "restoredReel": {
    "id": "aa0691a3-69da-46d6-9ffd-a7f20cf7c976",
    "url": "/videos/aa0691a3-69da-46d6-9ffd-a7f20cf7c976.mp4",
    "backgroundSource": "custom_video"
  }
}
```

### BG-7U full persistence verify

```bash
node frontend/scripts/mission-bg-7u-hero-persistence-verify.mjs
```

| Target | identityRestore | restoreReason | Notes |
|--------|-----------------|---------------|-------|
| **Local preview (BG-7W build)** | ✅ via smoke | `RESTORE_SUCCESS` | Full BG-7U upload path requires Netlify same-origin API |
| **Production (pre-deploy)** | ❌ | `null` (no BG7V bundle) | Bundle `index-DwXGyOoS.js` — markers absent |

Production pre-deploy evidence:

```json
{
  "identityRestore": {
    "ok": false,
    "restoreTrace": { "restored": false, "matchedReelId": "356f0466-..." },
    "bg7vRestoreTrace": null,
    "restoreReason": null
  }
}
```

**Post-deploy expectation:**

```json
{
  "restored": true,
  "reason": "RESTORE_SUCCESS"
}
```

---

## Deploy gate

After `git push origin main` and Netlify deploy:

```bash
bash frontend/scripts/deploy-netlify.sh "BG-7W: hero restore INVALID_URL fix"

# Verify live bundle
curl -s https://strong-lolly-a9fcb4.netlify.app/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
curl -s "https://strong-lolly-a9fcb4.netlify.app/assets/index-XXXX.js" \
  | grep -E 'BG7V_HERO_RESTORE_REASON|hero-restore'

# Re-run acceptance
node frontend/scripts/mission-bg-7u-hero-persistence-verify.mjs
```

No manual production hotfixes. Use existing release pipeline only.

---

## Constraints honored

| Area | Modified? |
|------|-----------|
| Upload pipeline | ❌ |
| `/api/reels` | ❌ |
| Hero upload UX | ❌ |
| Feed shelves / BG-7T | ❌ |
| Database schema | ❌ |
| Hero manager model | ❌ |
| Episode attachment | ❌ |
| Readiness / Action Router | ❌ |

---

## Mission chain

```text
BG-7V  instrument → INVALID_URL identified
BG-7W  repair     → RESTORE_SUCCESS (local)
DEPLOY            → production bundle promotion
RA-01             → shared-state verification
```
