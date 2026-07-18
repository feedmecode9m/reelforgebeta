# PRODUCT-03 — Vault → Episode Attachment Automation Audit

**Mission:** Playwright coverage for PRODUCT-02 creator attachment workflow  
**Date:** 2026-07-16  
**Scope:** Test coverage + stable selectors only — **no media pipeline changes**

**Predecessors:** [`PRODUCT-02_EPISODE_REEL_ATTACHMENT_AUDIT.md`](PRODUCT-02_EPISODE_REEL_ATTACHMENT_AUDIT.md), [`BG-AUTO-01_HERO_AUTOMATION_AUDIT.md`](BG-AUTO-01_HERO_AUTOMATION_AUDIT.md)

---

## Executive Summary

PRODUCT-03 adds a protected automation contract for the full creator attachment journey, mirroring BG-AUTO-01 discipline: **validate the user path, not isolated functions**.

| Check | Result |
|-------|--------|
| `npm run build` | ✅ PASS |
| `npm run test:episode-attachment` (local preview) | ✅ PASS (25.2s) |
| `npm run test:episode-attachment:mission` (local preview) | ✅ PASS (7/7 steps) |
| `npm run test:hero-playwright` | ✅ PASS |
| `npm run test:hero-confirmation` (production) | ✅ PASS |
| Upload / Hero / ingestion code changed | ✅ None |

**Production Netlify note:** Default `test:episode-attachment` targets production until PRODUCT-02/03 UI is deployed. Panel not yet on live bundle — use local preview (see Validation).

---

## 1. User Flow Tested

```text
Ghost trigger → Admin login
        ↓
Smart Production Studio open
        ↓
Production tab
        ↓
[data-testid="episode-reel-attach-panel"] visible
        ↓
(If vault empty) Content tab → vault drop → return Production
        ↓
Select episode (ep-neon-s01e04 — Zero Day)
        ↓
Select vault reel [data-testid="vault-reel-option"]
        ↓
Click [data-testid="attach-reel-to-episode"]
        ↓
(Optional) [data-testid="attach-reel-replace"] if episode had reel
        ↓
[data-testid="attach-reel-success"] visible
        ↓
reelforge_series_metadata[reelId].episodeId === ep-neon-s01e04
        ↓
page.reload()
        ↓
Re-open Production → episode option shows "(has reel)"
        ↓
Metadata reelId unchanged
```

---

## 2. Selectors Used (Stable Contracts)

| Selector | Element | Purpose |
|----------|---------|---------|
| `data-testid="episode-reel-attach-panel"` | Section root | Navigation gate |
| `data-testid="episode-reel-select"` | Episode `<select>` | Step 1 |
| `data-testid="vault-reel-select"` | Reel listbox | Step 2 container |
| `data-testid="vault-reel-option"` | Reel card button | Step 2 selection |
| `data-reel-id="{uuid}"` | Reel identity | Stable reel reference |
| `data-testid="attach-reel-to-episode"` | Primary CTA | Step 3 |
| `data-action="attach-reel-to-episode"` | Action contract | Semantic hook |
| `data-testid="attach-reel-replace"` | Replace confirm | Already-attached UX |
| `data-testid="attach-reel-success"` | Success status | Post-attach assertion |

### Navigation helpers (`tests/helpers/studio-navigation.mjs`)

| Helper | Tab / action |
|--------|----------------|
| `unlockStudio()` | Admin unlock |
| `openProductionTab()` | `#workspace-tab-production` + fallbacks |
| `openContentTab()` | Vault upload setup when empty |
| `readEpisodeAttachment(page, episodeId)` | `reelforge_series_metadata` persistence |
| `listVaultReelIds(page)` | `personal_video_vault` inventory |

### Preserved Hero contracts (unchanged)

| Selector | Mission |
|----------|---------|
| `.accept-btn` | BG-AUTO-01 |
| `.hero-replace-section` | Hero confirmation |

---

## 3. Test Coverage

### Playwright spec — `tests/episode-reel-attachment.e2e.spec.js`

| Area | Covered |
|------|---------|
| Studio → Production navigation | ✅ |
| Attachment panel visible | ✅ |
| Episode dropdown populated | ✅ |
| Episode selection | ✅ |
| Vault reels rendered | ✅ |
| Hero asset excluded from picker | ✅ (when hero reel in storage) |
| Attach action + success UI | ✅ |
| Replace flow | ✅ (when triggered) |
| `reelforge_series_metadata` update | ✅ |
| Reload persistence | ✅ |
| Episode dropdown "(has reel)" label | ✅ |

### Mission runner — `scripts/mission-product-03-episode-attach.mjs`

Structured steps → `artifacts/product-03-episode-attach.json`

### Target episode

| Field | Value |
|-------|-------|
| `episodeId` | `ep-neon-s01e04` |
| Title | Zero Day |
| Mock default | `reelId: null` (ideal attach target) |

---

## 4. Failures Discovered

| Issue | Severity | Resolution |
|-------|----------|------------|
| Production bundle lacks PRODUCT-02 panel | **Expected** | Deploy PRODUCT-02/03; until then run with `BASE_URL=http://127.0.0.1:4173` |
| Catalog vs studio UUID mismatch | Pre-existing | PRODUCT-02 orchestration; tests assert `reelforge_series_metadata` (catalog layer) |
| Empty vault on fresh session | Test setup | Spec drops MP4 on `.video-vault-drop` via Content tab (uses existing upload path, no code change) |
| Episode already attached | UX | Test clicks `attach-reel-replace` when replace UI appears |

No attachment architecture defects found during automation work.

---

## 5. Production / Local Validation Results

### Build

```text
npm run build  →  ✓ built in 8.25s
```

### Local preview (PRODUCT-02 + PRODUCT-03 bundle)

```bash
npx vite preview --port 4173 --host 127.0.0.1 --strictPort
BASE_URL=http://127.0.0.1:4173 npm run test:episode-attachment
BASE_URL=http://127.0.0.1:4173 npm run test:episode-attachment:mission
```

| Command | Result |
|---------|--------|
| `test:episode-attachment` | ✅ 1 passed (25.2s) |
| `test:episode-attachment:mission` | ✅ 7/7 steps |

Example artifact attachment:

```json
{
  "episodeId": "ep-neon-s01e04",
  "reelId": "6e420f7b-3ee4-42a4-8989-eecfcc2de1a2",
  "persistence_after_reload": true
}
```

### Production Netlify (default BASE_URL)

```text
npm run test:episode-attachment  →  FAIL (panel not deployed)
Timeout waiting for [data-testid="episode-reel-attach-panel"]
```

**Action:** Deploy frontend containing PRODUCT-02 + PRODUCT-03; re-run default command.

### Hero regression (unchanged)

| Command | Target | Result |
|---------|--------|--------|
| `npm run test:hero-playwright` | local preview | ✅ PASS |
| `npm run test:hero-confirmation` | production | ✅ PASS (10/10) |

---

## 6. Files Changed

| File | Change |
|------|--------|
| `tests/episode-reel-attachment.e2e.spec.js` | **New** — E2E spec |
| `scripts/mission-product-03-episode-attach.mjs` | **New** — mission runner |
| `tests/helpers/studio-navigation.mjs` | `openProductionTab`, `readEpisodeAttachment`, `listVaultReelIds` |
| `EpisodeReelAttachmentPanel.svelte` | `data-testid` / `data-action` hooks only |
| `package.json` | `test:episode-attachment`, `test:episode-attachment:mission` |

**Not modified:** `media.js`, upload handlers, Hero logic, ingestion, storage keys, `episodeReelAttachment.js` orchestration logic.

---

## 7. npm Scripts

```bash
npm run build
npm run test:episode-attachment              # Playwright (default: production BASE_URL)
npm run test:episode-attachment:mission      # Structured artifact runner

# Local validation before deploy:
npx vite preview --port 4173 --host 127.0.0.1 --strictPort
BASE_URL=http://127.0.0.1:4173 npm run test:episode-attachment
```

---

## 8. Success Criteria — Met

```text
✅ Vault reel attachable through UI (local preview)
✅ Attachment survives reload
✅ Playwright validates full workflow
✅ No media pipeline changes
✅ Hero tests remain green
```

---

## 9. Classification

```text
BG-CLOSE-01     Infrastructure stabilization
PRODUCT-01      Expansion roadmap
PRODUCT-02      Creator workflow activation
PRODUCT-03      Workflow reliability contract  ✅
```

After Netlify deploy, PRODUCT-03 completes the creator workflow stack:

```text
Human UX (PRODUCT-02)
    ↓
Attachment orchestration
    ↓
Automated verification (PRODUCT-03)
    ↓
Protected against UI regressions
```
