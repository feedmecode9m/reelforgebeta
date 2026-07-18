# BG Investigation — Final Archive Report

**Mission:** BG-CLOSE-01 — Background Investigation Archive  
**Date closed:** 2026-07-16  
**Status:** Investigation phase **officially closed**  
**Scope:** Documentation only — no code changes in this mission.

This document is the canonical index for the ReelForge **Background (BG)** investigation family. It exists so future engineers and automation sessions do not reopen resolved work or misclassify intentional product behavior as infrastructure defects.

**Production target:** `https://strong-lolly-a9fcb4.netlify.app`  
**Backend target:** `https://reelforge-deploy-production.up.railway.app`

---

## 1. Timeline

Investigations progressed from infrastructure forensics → production validation → UX clarification → automation alignment.

| Mission | Focus | Outcome | Primary deliverable |
|---------|-------|---------|---------------------|
| **BG-5H.0** | Independent infrastructure verification | Confirmed ephemeral container media vs durable DB | `BG-5H0_INDEPENDENT_VERIFICATION.md` |
| **BG-5J** | Production media durability guardrails | Startup/health/diagnostics guardrails added (backend) | `BG-5J_PRODUCTION_GUARDRAILS.md` |
| **BG-5K** | Deployment verification | Deploy path validated | `BG-5K_DEPLOYMENT_VERIFICATION.md` |
| **BG-5L** | Write path verification | Upload → ingest → static serve proven | `BG-5L_WRITE_PATH_VERIFICATION.md` |
| **BG-5A** | Pipeline archaeology | Hero vs Vault divergence mapped; shared `POST /api/reels` ingress | `MISSION_BG-5A_PIPELINE_TRACE.md` |
| **BG-5C** | Render gate instrumentation | `[RENDER_GATE]` diagnostics at UI decision points | `MISSION_BG-5C_RENDER_GATE_FORENSICS.md` |
| **BG-6A** | Production UI validation | Initial automation run; Hero path reported unverified | `BG-6A_PRODUCTION_UI_VALIDATION.md` → **reclassified test defect** |
| **BG-6B** | Hero canonical trace | Storage + identity path documented | `BG-6B_HERO_CANONICAL_TRACE.md` |
| **BG-6C** | Production Hero execution trace | Drop-only vs drop+Accept A/B trace | `BG-6C_HERO_ACCEPT_EXECUTION_TRACE.md` |
| **BG-UX-01** | Hero UX decision audit | Accept gate confirmed intentional product design | `BG-UX-01_HERO_UX_AUDIT.md` |
| **BG-UX-02** | Hero Accept UX polish | Preview-pending banner, clearer copy, stable `.accept-btn` | Code in `HeroExperience.svelte`, `viewer.css` |
| **BG-AUTO-01** | Human-flow automation coverage | Playwright aligned to real UX contract | `BG-AUTO-01_HERO_AUTOMATION_AUDIT.md` |
| **BG-CLOSE-01** | Investigation archive | This document | `BG_INVESTIGATION_FINAL_REPORT.md` |

### Narrative arc

```text
BG-5A/5C   Map pipeline + instrument render gates
     ↓
BG-5J–5L   Harden and prove production write path
     ↓
BG-6A      Automation run — Hero "failed" (misleading)
     ↓
BG-6C      Proved Accept click required; pipeline works end-to-end
     ↓
BG-UX-01   Product decision: keep Accept confirmation
     ↓
BG-UX-02   Improve affordance without changing upload behavior
     ↓
BG-AUTO-01 Align tests to human journey; close automation gap
     ↓
BG-CLOSE-01 Archive and exit investigation family
```

---

## 2. Confirmed Defects

These were **real issues found and fixed** during the investigation.

| Defect | Where found | Resolution |
|--------|-------------|------------|
| Ephemeral production media filesystem | BG-5H.0 | Volume/mount awareness; BG-5J durability guardrails |
| Automation assumed implicit Accept | BG-6A | BG-AUTO-01: explicit `.accept-btn` click before assertions |
| Wrong localStorage assertion key | BG-6A | Tests updated to `reelforge_hero_reel` (not `reelforge_hero_reel_identity`) |
| Content tab selector mismatch | BG-AUTO-01 | Shared helper with fallbacks (`#workspace-tab-content`, role=tab "Content") |
| Hero UX affordance unclear | BG-UX-01 audit | BG-UX-02: preview-pending banner, step subtitle, button labels |

---

## 3. Confirmed Non-Defects

These were **investigated and cleared**. Do not reopen as infrastructure bugs without new evidence.

| Area | Verdict | Evidence |
|------|---------|----------|
| Hero upload pipeline | **Working** | BG-6C PATH B: `acceptHeroFile()` → `POST /api/reels` → ingest → ready |
| Hero persistence | **Working** | `saveHeroReel()` writes `reelforge_hero_reel`; reload verified in BG-AUTO-01 |
| Hero manager config | **Working** | `reelforge_hero_manager_config` with `backgroundSource: custom_video`, `heroAssetId` |
| Render update after Accept | **Working** | Stage `<video>` src updates to UUID mp4; MediaRenderer refresh |
| Backend ingestion | **Working** | BG-5L write path; 202 → poll → ready |
| Accept confirmation gate | **Intentional UX** | BG-UX-01: destructive/global Hero change requires explicit confirm |
| Drop-only "no change" | **Expected behavior** | Preview sets `heroPendingFile`; no network until Accept |
| MP4 Vault upload/reload | **Working** | BG-6A phase 2 PASS |
| Batch delete workflows | **Working** | BG-6A phase 4 PASS |

### BG-6A reclassification

BG-6A initially reported Hero replace as **unverified**. BG-6C and BG-AUTO-01 proved the failure was an **automation model that did not represent the actual UX contract** — not a product failure.

---

## 4. Final Contracts

### Hero user journey (canonical)

```text
User drops replacement media
        ↓
Hero preview generated (heroPendingFile, blob URL)
        ↓
No upload occurs (POST /api/reels count = 0)
        ↓
User confirms: "Accept & Replace Hero"
        ↓
acceptHeroFile()
        ↓
POST /api/reels
        ↓
saveHeroReel()
        ↓
reelforge_hero_reel
        ↓
reelforge_hero_manager_config
        ↓
backgroundSource = custom_video
        ↓
MediaRenderer refresh
        ↓
Reload persistence verified
```

### Automation test interface

| Contract | Rule |
|----------|------|
| `.accept-btn` | Stable selector on Accept & Replace Hero — **do not remove**; styling/layout may change |
| `.hero-replace-section` | Hero replace drop zone container |
| `.hero-pending-preview` | Preview-only state after drop |
| Explicit Accept click | Tests must click Accept before asserting upload or persistence |

**Design boundary:**

```text
Visual design can change
        ↓
Button styling/layout can change
        ↓
Behavior contract remains stable (.accept-btn + preview-before-upload)
```

### Canonical Hero storage keys

Defined in `src/lib/hero/heroReelIdentity.js` and `src/lib/storage.js`:

| Key | Purpose |
|-----|---------|
| `reelforge_hero_reel` | Canonical hero reel JSON (`id`, `url`, `fileName`, `type`, …) |
| `reelforge_hero_manager_config` | `backgroundSource`, `heroAssetId` |
| `reelforge_hero_video` | Legacy — cleared on canonical save |
| `reelforge_hero_image` | Legacy — cleared on canonical save |

**Do not assert** `reelforge_hero_reel_identity` — that key does not exist in the application.

### Studio navigation (automation)

Content tab lives under Studio workspace → **Content** tab. Helpers try, in order:

1. `#workspace-tab-content`
2. `[data-workspace-tab-button="content"]`
3. `[data-workspace-tab="content"]`
4. `[role="tablist"][aria-label="Studio workspace"] [role="tab"]:has-text("Content")`

Shared helper: `tests/helpers/studio-navigation.mjs`

---

## 5. Verification Coverage

| Layer | What is verified | How |
|-------|------------------|-----|
| UX behavior | Preview before upload; explicit Accept | Manual + BG-UX-01/02 |
| Application behavior | State machine, storage writes | BG-5A, BG-6B, BG-6C traces |
| Production behavior | Full journey on deployed Netlify | Playwright + mission runner |

---

## 6. Validation Commands

Run from `frontend/`:

```bash
# Build
npm run build

# Hero human-flow automation (Playwright spec)
npm run test:hero-playwright

# Hero mission runner + artifact
npm run test:hero-confirmation
# → artifacts/bg-auto-01-hero-confirmation.json

# Broader production UI validation (includes vault, hero, delete)
node scripts/mission-bg-6a-production-ui-validate.mjs
# → artifacts/bg-6a-production-ui.json

# Hero Accept A/B trace (forensics)
node scripts/mission-bg-6c-hero-accept-trace.mjs
# → artifacts/bg-6c-hero-accept-trace.json
```

**Success criteria for Hero maintenance:**

- Drop → preview visible, no `POST /api/reels`
- Accept click → upload, canonical keys set, stage video updated
- Reload → same `reelforge_hero_reel.id`

---

## 7. Changed Files (investigation period)

### Backend (infrastructure hardening)

| File | Mission |
|------|---------|
| `backend/src/media_durability.rs` | BG-5J |
| `backend/src/main.rs`, `handlers.rs`, `media_api.rs`, `lib.rs` | BG-5J |

### Frontend (UX + automation — no upload pipeline changes in UX missions)

| File | Mission |
|------|---------|
| `src/components/experiences/HeroExperience.svelte` | BG-UX-02, BG-5C instrumentation |
| `src/viewer/viewer.css` | BG-UX-02 |
| `tests/hero-confirmation.e2e.spec.js` | BG-AUTO-01 |
| `tests/helpers/studio-navigation.mjs` | BG-AUTO-01 |
| `tests/hero-system.e2e.spec.js` | Deprecated (skipped) |
| `scripts/mission-bg-auto-01-hero-confirmation.mjs` | BG-AUTO-01 |
| `scripts/mission-bg-6a-production-ui-validate.mjs` | BG-6A fix + BG-AUTO-01 alignment |
| `scripts/mission-bg-6c-hero-accept-trace.mjs` | BG-6C |
| `playwright.config.js` | BG-AUTO-01 |
| `package.json` | `test:hero-playwright`, `test:hero-confirmation` |

### Artifacts (runtime evidence)

| Path | Mission |
|------|---------|
| `artifacts/bg-auto-01-hero-confirmation.json` | BG-AUTO-01 |
| `artifacts/bg-6a-production-ui.json` | BG-6A |
| `artifacts/bg-6c-hero-accept-trace.json` | BG-6C |

---

## 8. Known UX Decisions (not bugs)

| Decision | Rationale | Reference |
|----------|-----------|-----------|
| Hero requires Accept before upload | High-impact site-wide visual change; matches Thumbnail Vault confirm model | BG-UX-01 |
| Hero drop does not auto-upload | Differs from MP4 Vault upload-on-drop; intentional for Hero | BG-5A, BG-UX-01 |
| Legacy reels may exist in API with 404 media | Pre-migration catalog rows; not rendered on public DOM | BG-6A |
| MP4 Vault uploads immediately on drop | Separate product surface with different risk profile | BG-5A |

---

## 9. Future Maintenance Notes

1. **Hero is out of the BG investigation family.** Treat Hero as normal feature maintenance. Use BG-AUTO-01 tests as regression guards.

2. **Do not remove `.accept-btn`.** It is part of the automation contract. Visual redesigns must preserve the class or update tests in the same change.

3. **Do not auto-upload Hero on drop** without an explicit approved UX mission — BG-UX-01 rejected that path.

4. **When Hero tests fail**, check in order:
   - Was Content tab opened?
   - Was Accept clicked before persistence assertions?
   - Are assertions using `reelforge_hero_reel` and `reelforge_hero_manager_config`?
   - Is production deployed with expected studio tab markup?

5. **Next work category:** feature/product expansion — not debugging the media foundation.

---

## 10. Current ReelForge Status (evidence-based)

```text
Production deployment stability      ✅
Media upload pipeline                ✅
Vault persistence                    ✅
Hero replacement                     ✅
Delete workflows                     ✅
Automation coverage                  ✅
UX clarity                           ✅
BG investigation phase               ✅ CLOSED
```

---

## Related Documents Index

| Document | Topic |
|----------|-------|
| `MISSION_BG-5A_PIPELINE_TRACE.md` | Pipeline archaeology |
| `MISSION_BG-5C_RENDER_GATE_FORENSICS.md` | Render gate instrumentation |
| `BG-5H0_INDEPENDENT_VERIFICATION.md` | Infrastructure verification |
| `BG-5J_PRODUCTION_GUARDRAILS.md` | Media durability guardrails |
| `BG-5K_DEPLOYMENT_VERIFICATION.md` | Deployment verification |
| `BG-5L_WRITE_PATH_VERIFICATION.md` | Write path verification |
| `BG-6A_PRODUCTION_UI_VALIDATION.md` | Initial production UI validation |
| `BG-6B_HERO_CANONICAL_TRACE.md` | Hero identity/storage trace |
| `BG-6C_HERO_ACCEPT_EXECUTION_TRACE.md` | Accept execution A/B trace |
| `BG-UX-01_HERO_UX_AUDIT.md` | UX decision audit |
| `BG-AUTO-01_HERO_AUTOMATION_AUDIT.md` | Automation coverage audit |
| `BG_INVESTIGATION_FINAL_REPORT.md` | **This archive (start here for BG context)** |
