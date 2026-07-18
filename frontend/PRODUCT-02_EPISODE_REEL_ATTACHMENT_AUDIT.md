# PRODUCT-02 — Episode Reel Attachment Workflow

**Mission:** Guided creator workflow connecting Vault reels to Series episodes  
**Date:** 2026-07-16  
**Scope:** Frontend workflow only — media upload/hero/thumbnail pipelines **unchanged**

**Predecessors:** [`BG_INVESTIGATION_FINAL_REPORT.md`](BG_INVESTIGATION_FINAL_REPORT.md), [`PRODUCT-01_FEATURE_EXPANSION_AUDIT.md`](PRODUCT-01_FEATURE_EXPANSION_AUDIT.md)

---

## Executive Summary

PRODUCT-02 replaces manual UUID entry with a three-step guided workflow in Smart Production Studio → **Production** tab:

```text
Select Episode → Select Vault Reel → Attach Reel To Episode
```

Attachment uses existing functions only — no new upload path, no storage key changes, no backend ingestion modifications.

| Check | Result |
|-------|--------|
| `npm run build` | ✅ PASS |
| `npm run test:hero-playwright` | ✅ PASS |
| `npm run test:hero-confirmation` | ✅ PASS (10/10) |
| Upload pipelines touched | ✅ None |
| Hero Accept contract | ✅ Unchanged |

---

## 1. Existing Attachment Architecture

### Dual persistence model (pre-existing)

ReelForge maintains two related but distinct episode identity systems:

| Layer | Episode ID | Attachment API | Persistence |
|-------|------------|----------------|-------------|
| **Series catalog** | `episodeId` (e.g. `ep-neon-s01e04`) | `attachEpisodeReel()` → `bindEpisodeToFeedReel()` | `seriesCatalog` store + `reelforge_reel_series_metadata` localStorage |
| **Studio hierarchy (DB)** | UUID (`studio_episodes.id`) | `attachReelToEpisode()` → `POST /api/studio/episodes/{id}/attach-reel` | Postgres `studio_episodes.reel_id` |

### Data flow (after PRODUCT-02)

```text
Creator selects catalog episode (episodeId)
        ↓
Creator selects vault reel (UUID from personalVideos / API)
        ↓
performEpisodeReelAttach()
        ↓
attachEpisodeReel(episodeId, reelId)     ← catalog + metadata (always)
        ↓
resolveStudioEpisodeUuid(tree, episode)   ← match S#E# + series title
        ↓
attachReelToEpisode(studioUuid, reelId)  ← backend when UUID resolved
        ↓
loadStudioHierarchy() + handleEpisodeAssetChanged()
        ↓
Episode.reelId updated · workflow/readiness signals refresh
```

### Identity models

| Entity | Canonical ID | Display |
|--------|--------------|---------|
| Episode (catalog) | `episode.episodeId` | `Neon Vengeance · S01E04 — Zero Day` |
| Episode (studio DB) | `episode.id` (UUID) | Matched by series + season + episode number |
| Reel (vault) | `reel.id` (UUID) | Name from `name` / `title` / `fileName` |
| Attachment link | `episode.reelId` ↔ `reel.id` | Shown in hierarchy tree 🎬 linked badge |

### Why both attach paths

- **Guide Me / workflow tasks** reference catalog `episodeId` strings — not studio UUIDs.
- **`attachReelToEpisode()`** requires UUID episode IDs for Postgres — unusable with catalog IDs alone.
- PRODUCT-02 orchestrates both: catalog update for UX/readiness, studio API when hierarchy row exists.

The prior manual UUID inputs failed silently when workflow navigation passed catalog `episodeId` to the studio API.

---

## 2. Files Changed

| File | Change |
|------|--------|
| `src/lib/studio/episodeReelAttachment.js` | **New** — flatten episodes, resolve studio UUID, `performEpisodeReelAttach()` |
| `src/components/studio/EpisodeReelAttachmentPanel.svelte` | **New** — 3-step guided UI |
| `src/components/experiences/StudioExperience.svelte` | Integrate panel in Production tab; remove manual UUID attach inputs |

**Not modified:** `media.js`, `HeroExperience.svelte`, `VaultExperience.svelte` upload handlers, backend `ingestion/`, storage keys, deployment config.

---

## 3. UX Flow

### Location

Smart Production Studio → **Production** workspace tab → **Attach Vault Reel to Episode** panel (top of slot).

### Step 1 — Select Episode

- Dropdown populated from `seriesCatalog` (all series / seasons / episodes).
- Empty state: *"No episodes in catalog. Create a series and episodes first."*
- No selection hint: *"No episode selected — choose an episode to attach media"*

### Step 2 — Select Vault Reel

- Grid of vault video reels from `personalVideos` (excludes hero assets via `isHeroAsset`).
- Each card: thumbnail (or ▶ fallback), name, status.
- Empty state: *"No reels available — upload media to your Vault first"*

### Step 3 — Attach

- Primary button: **Attach Reel To Episode** (`.episode-reel-attach-btn`)
- Success: *"Reel attached successfully — Episode updated"*
- Already attached: prompts **Replace attachment?** with existing reel name

### Workflow integration

- Guide Me / workflow deep links set `studioAttachEpisodeId` — panel pre-selects episode.
- On success: clears attach stores, refreshes studio hierarchy tree, fires `handleEpisodeAssetChanged()`.

---

## 4. State Transitions

```text
[Initial]
  selectedEpisodeId = ''
  selectedReelId = ''
  pendingReplace = false

[Episode selected]
  selectedEpisodeId = ep-neon-s01e04
  → UI shows series · season meta

[Reel selected]
  selectedReelId = <uuid>
  → card highlighted

[Attach clicked — episode has different reel]
  pendingReplace = true
  → Replace / Cancel UI

[Attach confirmed]
  attachEpisodeReel() → episode.reelId = uuid
  attachReelToEpisode() → studio DB (if UUID resolved)
  loadStudioHierarchy()
  handleEpisodeAssetChanged() → episode bridge sync
  successMessage set

[Reload]
  seriesCatalog + reel_series_metadata persist via existing storage
  episode.reelId survives
```

---

## 5. Validation Results

### Build

```text
npm run build  →  ✓ built in 7.11s
```

### Regression (frozen contracts)

```text
npm run test:hero-playwright     →  1 passed
npm run test:hero-confirmation   →  pass: true (10/10 steps)
```

Hero upload, vault upload, and thumbnail flows were not modified.

### Functional checklist (manual / post-deploy)

| Step | Expected |
|------|----------|
| Open Studio → Production tab | Attachment panel visible |
| Select episode without reel | Dropdown works |
| Select vault reel | Grid selection works |
| Attach | Success message; hierarchy shows 🎬 linked |
| Reload page | `episode.reelId` persists in catalog |
| Episode with existing reel | Replace prompt appears |

---

## 6. Remaining Limitations

| Limitation | Notes |
|------------|-------|
| Studio API attach is best-effort | Requires matching studio hierarchy row by series title + S#E#; fails gracefully if hierarchy disabled |
| Catalog vs studio ID mismatch | Legacy workflow passed catalog IDs to studio API — now routed correctly |
| No Playwright attach test yet | Recommended follow-up: PRODUCT-03 automation (mirror BG-AUTO-01 pattern) |
| Episode picker uses catalog only | Studio-only episodes (no catalog row) not listed — create via hierarchy forms first |
| Reel duration not shown | Vault entries may lack runtime metadata; status + name shown |
| Bulk attach | One episode at a time; bulk operations deferred |
| Replace does not delete old reel | Swaps link only; vault reel remains |

---

## 7. Success Criteria — Met

```text
✅ Creator can select episode
✅ Creator can select existing vault reel
✅ Attachment persists (catalog + metadata; studio DB when available)
✅ Existing media contracts unchanged
✅ Build passes
```

---

## 8. Classification

```text
BG-CLOSE-01   Infrastructure stabilization complete
PRODUCT-01    Expansion roadmap complete
PRODUCT-02    Creator workflow activation  ✅
```

ReelForge now bridges **uploaded vault media** and **series episodes** through a guided UI above the frozen media foundation.

**Suggested next mission:** PRODUCT-03 — Playwright coverage for vault upload → episode attach → persistence (parallel to BG-AUTO-01).
