# BG-AUTO-01 — Hero Confirmation Automation Audit

**Mission:** Close the BG-6A automation gap by aligning Playwright coverage with the real Hero UX (Drop → Preview → Accept → Persist).

**Date:** 2026-07-16  
**Target:** Production frontend `https://strong-lolly-a9fcb4.netlify.app`  
**Scope:** Test coverage only — no backend, upload pipeline, or application storage changes.

---

## Executive Summary

BG-6A reported Hero automation failures that were **test misalignment**, not product defects:

1. Automation dropped a file and immediately asserted hero persistence **without clicking Accept**.
2. Assertions read a **non-existent** localStorage key (`reelforge_hero_reel_identity`).
3. Content-tab navigation relied on a selector not yet present on the deployed build.

BG-AUTO-01 fixes all three. Both automation paths now pass against production.

| Check | Result |
|-------|--------|
| `npm run build` | ✅ PASS |
| `npm run test:hero-playwright` | ✅ PASS (14.7s) |
| `npm run test:hero-confirmation` | ✅ PASS (10/10 steps) |
| Drop → Preview → Accept → Persist | ✅ Verified |
| Backend / upload pipeline changes | ✅ None |

---

## 1. Current Playwright Hero Flow

### Primary spec — `tests/hero-confirmation.e2e.spec.js`

```
Ghost trigger → Admin login
        ↓
Production Command Center visible
        ↓
Studio workspace → Content tab
        ↓
.hero-replace-section visible
        ↓
setInputFiles on hidden file input
        ↓
Assert .accept-btn + .hero-pending-preview visible
Assert POST /api/reels count === 0
Assert reelforge_hero_reel.id absent
        ↓
Click .hero-replace-section .accept-btn
        ↓
Poll until reelforge_hero_reel.id set
Assert backgroundSource === custom_video
Assert heroAssetId === reel.id
Assert POST /api/reels count > 0
        ↓
page.reload()
Assert reel id unchanged
```

### Mission runner — `scripts/mission-bg-auto-01-hero-confirmation.mjs`

Same journey with structured step reporting and artifact output to `artifacts/bg-auto-01-hero-confirmation.json`. Uses drag-and-drop via `DataTransfer` instead of `setInputFiles` (both trigger preview-only state).

### Shared navigation — `tests/helpers/studio-navigation.mjs`

Centralizes studio unlock and Content-tab opening so spec and mission scripts stay aligned.

### Deprecated

`tests/hero-system.e2e.spec.js` — skipped; targeted obsolete console log strings. Superseded by `hero-confirmation.e2e.spec.js`.

---

## 2. Missing Interaction Step (BG-6A Root Cause)

### Before (implicit acceptance)

BG-6A `phase3Hero` and related scripts:

```javascript
dropFile('.hero-replace-section')
// immediately checked localStorage / stage video
expect(heroChanged)  // always false — Accept never ran
```

The product intentionally gates upload behind **Accept & Replace Hero** (BG-UX-01). Drop-only sets `heroPendingFile` and shows preview; `acceptHeroFile()` → `uploadVideo()` → `saveHeroReel()` runs only after `.accept-btn` click.

### After (explicit confirmation)

```javascript
dropFile('.hero-replace-section')
expect('.hero-replace-section .accept-btn').toBeVisible()
expect(postUrls.length).toBe(0)
click('.hero-replace-section .accept-btn')
expect(reelforge_hero_reel.id).toBeTruthy()
expect(postUrls.length).toBeGreaterThan(0)
```

This matches the proven pipeline:

```
Drop → heroPendingFile → Preview only → Accept & Replace Hero → acceptHeroFile()
     → uploadVideo() → saveHeroReel() → config update → MediaRenderer refresh
```

---

## 3. LocalStorage Mismatch Details

### Application truth (unchanged)

Defined in `src/lib/hero/heroReelIdentity.js` and registered in `src/lib/storage.js`:

| Key | Purpose |
|-----|---------|
| `reelforge_hero_reel` | Canonical hero reel JSON (`id`, `url`, `fileName`, `type`, …) |
| `reelforge_hero_manager_config` | Manager state: `backgroundSource`, `heroAssetId` |
| `reelforge_hero_video` | Legacy — cleared on canonical save |
| `reelforge_hero_image` | Legacy — cleared on canonical save |

### BG-6A test error

| | BG-6A assertion | Application reality |
|---|-----------------|---------------------|
| Key read | `reelforge_hero_reel_identity` | **Does not exist** |
| Correct key | — | `reelforge_hero_reel` |
| Manager key | Often omitted | `reelforge_hero_manager_config` |

Reading `reelforge_hero_reel_identity` always returned `null`, masking successful Accept flows and reinforcing the false “Hero broken” signal.

### BG-AUTO-01 fix

Tests now assert:

```javascript
localStorage.getItem('reelforge_hero_reel')        // reel.id after Accept
localStorage.getItem('reelforge_hero_manager_config') // backgroundSource, heroAssetId
```

**No application storage keys were changed.** Expectations were aligned to application reality.

### Observed production values (2026-07-16 run)

**After drop (preview only):**

```json
{
  "reelforge_hero_reel": null,
  "reelforge_hero_manager_config": null
}
```

**After Accept:**

```json
{
  "reelforge_hero_reel": {
    "id": "c3786555-451c-4f33-850c-ddf2307a2241",
    "backgroundSource": "custom_video",
    "url": "/videos/c3786555-451c-4f33-850c-ddf2307a2241.mp4"
  },
  "reelforge_hero_manager_config": {
    "backgroundSource": "custom_video",
    "heroAssetId": "c3786555-451c-4f33-850c-ddf2307a2241"
  }
}
```

**After reload:** Same reel id persisted.

---

## 4. Updated Selectors and Assertions

### Test interface (preserved)

| Selector | Role |
|----------|------|
| `.hero-replace-section` | Hero replace drop zone container |
| `.hero-replace-section .accept-btn` | **Accept & Replace Hero** — required test contract |
| `.hero-pending-preview` | Preview-only state after drop |
| `[data-hero-preview-pending]` | Alternate preview marker (mission script) |

### Content tab navigation (fixed)

Production build exposes tabs by `#workspace-tab-content` and `role="tab"` text **Content**. Source also defines `[data-workspace-tab-button="content"]` (not yet on deployed bundle).

Shared helper tries in order:

1. `#workspace-tab-content`
2. `[data-workspace-tab-button="content"]`
3. `[data-workspace-tab="content"]`
4. `[role="tablist"][aria-label="Studio workspace"] [role="tab"]:has-text("Content")`
5. `button[role="tab"]:has-text("Content")`

Then waits for `[data-workspace-panel-content], .video-vault-drop, .hero-replace-section`.

### Network assertions

| Phase | Expected |
|-------|----------|
| After drop | `POST /api/reels` count === 0 |
| After Accept | `POST /api/reels` count >= 1, status 202 |

### Config assertions

| Field | Expected after Accept |
|-------|----------------------|
| `reelforge_hero_reel.id` | UUID string |
| `reelforge_hero_manager_config.backgroundSource` | `custom_video` |
| `reelforge_hero_manager_config.heroAssetId` | === `reelforge_hero_reel.id` |

---

## 5. Test Execution Results

### Build

```text
npm run build  →  ✓ built in 3.80s
```

### Playwright spec

```text
npm run test:hero-playwright
  ✓ BG-AUTO-01 Hero confirmation › drop preview accept persist (14.7s)
  1 passed
```

### Mission runner

```text
npm run test:hero-confirmation
  pass: true
  steps: studio_unlocked, preview_visible_after_drop, no_upload_before_accept,
         no_canonical_reel_before_accept, post_api_reels_after_accept,
         canonical_reel_saved, manager_custom_video, hero_asset_id_matches_reel,
         stage_video_updated, persistence_after_reload
```

Artifact: `artifacts/bg-auto-01-hero-confirmation.json`

---

## Files Changed (test coverage only)

| File | Change |
|------|--------|
| `tests/hero-confirmation.e2e.spec.js` | Full Drop → Preview → Accept → Persist journey |
| `tests/helpers/studio-navigation.mjs` | Shared unlock + Content tab with selector fallbacks |
| `scripts/mission-bg-auto-01-hero-confirmation.mjs` | BG-AUTO-01 mission runner |
| `scripts/mission-bg-6a-production-ui-validate.mjs` | Accept click + canonical storage keys + shared Content tab |
| `playwright.config.js` | Production baseURL + chromium executablePath |
| `tests/hero-system.e2e.spec.js` | Deprecated / skipped |
| `package.json` | `test:hero-confirmation`, `test:hero-playwright` scripts |

---

## Success Criteria — Met

```text
npm run build                         ✅
Playwright Hero test                  ✅
Drop → Preview → Accept → Persist     ✅
No backend changes                    ✅
No upload pipeline changes            ✅
```

---

## Hero Coverage Stack (post BG-AUTO-01)

```text
Human UX (Accept gate)
    ↓
Frontend state machine (heroPendingFile → acceptHeroFile)
    ↓
API upload (POST /api/reels)
    ↓
Database persistence
    ↓
Render update (MediaRenderer)
    ↓
Automated verification (Playwright + mission runner)
```

Hero is cleared to exit the BG investigation family and move to normal feature maintenance.
