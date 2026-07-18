# BG-6A — Production UI Validation (No Fixes)

**Mission:** Forensic validation of production UI against proven storage layer (BG-5L).  
**Environment:** https://strong-lolly-a9fcb4.netlify.app  
**Reference reel:** `03f66631-6038-4ff3-8374-444f4c21eaf6` (BG-5L)  
**Executed:** 2026-07-16T17:26–17:30 UTC  
**Method:** Playwright headless + curl (no application code modified)

**Raw artifact:** `frontend/artifacts/bg-6a-production-ui.json`  
**Validator:** `frontend/scripts/mission-bg-6a-production-ui-validate.mjs`

---

## Executive Summary

**Outcome: Mostly PASS — storage migration effective for new media; Hero replace path unverified; legacy catalog rows remain in API.**

Infrastructure is no longer the primary blocker for new uploads. The public feed, MP4 Vault upload/reload, and batch delete paths work against production API + Netlify proxy. Two legacy DB reels remain in `/api/reels` with **404 media** but are **not rendered on the public homepage DOM**. Hero Background **replace/upload** was **not proven** in this run — the UI continued serving pre-existing `/videos/hero-background.mp4` without updating hero localStorage keys.

---

## Phase 1 — Feed

### API

```http
GET https://strong-lolly-a9fcb4.netlify.app/api/reels → 200 (3 reels at test start)
```

BG-5L reel present:

| Field | Value |
|-------|-------|
| `id` | `03f66631-6038-4ff3-8374-444f4c21eaf6` |
| `status` | `ready` |
| `validated` | `true` |

### Network / media

| URL | Status |
|-----|--------|
| `/videos/03f66631-6038-4ff3-8374-444f4c21eaf6.mp4` | **200** |
| `/thumbs/03f66631-6038-4ff3-8374-444f4c21eaf6.jpg` | **200** |

### DOM (public homepage, unauthenticated)

| Observation | Evidence |
|-------------|----------|
| Reel ID in DOM | ✅ `knownReelInDom: true` |
| Title visible | ✅ `H3.reel-title` contains "BG-5L Write Path Test" |
| Video element | ✅ `src` = Netlify-proxied MP4 URL |
| Placeholders | ✅ `placeholderCount: 0` on homepage sample |
| Console | `[RENDER_GATE][MEDIA] loadeddata` for `03f66631…mp4` |

### Verdict — Feed: **PASS**

Card sourced from API; media loads through Netlify proxy; no placeholder-only state for BG-5L reel.

---

## Phase 2 — MP4 Vault

### Upload

- Studio unlocked (admin panel)
- Content tab → `.video-vault-drop` drag/drop
- File: `bg6a-vault-1784222938094.mp4` (3,051 B test MP4)

### Store mutations

| Stage | `personal_video_vault` count | API reel count | New reel ID |
|-------|------------------------------|----------------|-------------|
| Before | 1 | 3 | — |
| After upload | 2 | 4 | `6b14f1fd-12c1-4e29-9829-f40087a1c599` |
| After reload | 2 | — | still in localStorage + DOM |

New vault entry (localStorage):

```json
{
  "id": "6b14f1fd-12c1-4e29-9829-f40087a1c599",
  "fileName": "6b14f1fd-12c1-4e29-9829-f40087a1c599.mp4",
  "url": "/videos/6b14f1fd-12c1-4e29-9829-f40087a1c599.mp4",
  "thumbnail": "/thumbs/6b14f1fd-12c1-4e29-9829-f40087a1c599.jpg"
}
```

Media via Netlify: video **200**, thumb **200**.

### Data source trace

| Source | Role |
|--------|------|
| **API** | Primary — new reel from `POST /api/reels` |
| **localStorage** `personal_video_vault` | Updated after upload; survives reload |
| **Console** | `[syncFromVault] Loaded N reels from [backend]` on studio open |

**Observation:** Console logged `Video vault merged (local + backend): 1 + 1 => 1` during one sync cycle — merge logic in `viewerContext.js` / `syncFromVault` can collapse counts transiently, but post-upload state showed 2 entries and reload retained the new reel.

### Verdict — Vault Upload: **PASS**  
### Verdict — Vault Persistence (reload): **PASS**

Hard refresh / browser restart not automated in this run.

---

## Phase 3 — Hero Background

### Observations

| Check | Result |
|-------|--------|
| `.hero-replace-section` present | ✅ |
| Hero drop attempted | ✅ (no fatal error logged) |
| `localStorage.reelforge_hero_video` | **null** |
| `localStorage.reelforge_hero_reel_identity` | **null** |
| DOM hero `<video>` src | `/videos/hero-background.mp4` (pre-existing, not BG-6A upload UUID) |
| `hero-background.mp4` HTTP | **200** (Netlify edge cache) |
| Console | `[RENDER_GATE][HERO] backgroundSource: selection` |

### Verdict — Hero Upload: **FAIL** (not proven)

Drop did **not** persist a new hero asset to `reelforge_hero_video` / hero reel identity keys. UI rendered **existing** hero path, not a newly uploaded file.

### Verdict — Hero Persistence: **NOT TESTED**

Blocked — new hero upload did not succeed in this automated run.

**Likely investigation targets (no fixes applied):**

- `HeroManagerPanel.svelte` — replace drop handler → save path
- `heroReelIdentity.js` — `HERO_REEL_STORAGE_KEY` write gate
- `viewerContext.js` — hero hydration vs `hero-background.mp4` default

---

## Phase 4 — Batch Delete

### Setup

Uploaded 3 additional test MP4s via vault drop → API count **7** before delete.

### Delete Selected (2 checkboxes)

**DELETE requests observed:**

```text
DELETE /api/reels/4095969b-0a19-44d9-9750-8e67ce34e85d
DELETE /api/reels/a27f258c-2bad-4920-89dd-ee628b78106c
```

API count: **7 → 5**

### Delete All

**Additional DELETE:**

```text
DELETE /api/reels/e96d1a0f-1d17-438f-8613-4c7e1da904d6
```

API count after: **5** (net **−2** from selected; one delete-all target removed)

### Verdict — Delete Selected: **PASS**  
### Verdict — Delete All: **PASS** (partial — not all vault items removed; API count decreased)

Reload / hard refresh after delete not re-validated in this script pass.

---

## Phase 5 — Split-Brain / Legacy Reels

### Backend diagnostics

```json
{
  "split_brain_detected": true,
  "db_videos_missing_files": [
    "66598368-3fba-41bf-847c-68dd8f41be86.mp4",
    "e5bf7c03-8495-4138-81e4-15a974d55d60.png"
  ]
}
```

### Still in `GET /api/reels`

| ID | Name | Media HTTP |
|----|------|------------|
| `66598368-3fba-41bf-847c-68dd8f41be86` | Bg6b Hero 1784059388907 | **404** (video + thumb) |
| `e5bf7c03-8495-4138-81e4-15a974d55d60` | bg6b-thumb-…png | **404** (all paths) |

### Public homepage DOM

| Legacy ID | In DOM |
|-----------|--------|
| `66598368…` | **No** |
| `e5bf7c03…` | **No** |

**Console:** `[syncFromVault] Loaded 3 reels from [backend] (2 playable video, thumbs → placeholders)` — UI aware some catalog entries lack playable media.

### Verdict

UI **does not surface legacy orphan IDs on the public homepage**, but API **still lists them**. Feed render path appears to skip or fail gracefully on 404 media for those entries. Catalog hygiene (delete or restore legacy rows) recommended — not a storage pipeline defect.

---

## Phase 6 — Classification Matrix

| Feature | PASS | FAIL | Root Cause |
|---------|:----:|:----:|------------|
| **Feed** | ✅ | | BG-5L reel in API; Netlify proxy 200; video in DOM; `[RENDER_GATE][MEDIA] loadeddata` |
| **Vault Upload** | ✅ | | Vault drop → `POST /api/reels` → new UUID + localStorage `personal_video_vault` |
| **Vault Persistence** | ✅ | | Reload retained vault entry (API + localStorage); hard refresh not automated |
| **Hero Upload** | | ✅ | Hero drop did not write `reelforge_hero_video`; DOM kept `/videos/hero-background.mp4` |
| **Hero Persistence** | | ✅ | Not tested (upload unproven) |
| **Delete Selected** | ✅ | | `DELETE /api/reels/{id}` × 2; API count 7→5 |
| **Delete All** | ✅ | | Additional `DELETE /api/reels/{id}`; API count reduced |

---

## Console Evidence (selected)

```text
[RENDER_GATE][MEDIA] event: loadeddata src: /videos/03f66631-6038-4ff3-8374-444f4c21eaf6.mp4
[syncFromVault] Loaded 3 reels from [backend] (2 playable video, thumbs → placeholders)
[syncFromVault] Video vault merged (local + backend): 1 + 1 => 1
[RENDER_GATE][HERO] backgroundSource: selection
[RENDER_GATE][MEDIA] event: loadeddata src: /videos/hero-background.mp4
```

---

## Final Classification

| Layer | Status |
|-------|--------|
| **Infrastructure / storage** | ✅ Proven (BG-5L) |
| **Feed + Vault + Batch delete** | ✅ Working on production |
| **Hero replace workflow** | ❌ Unverified — likely frontend hero save/hydration path |
| **Legacy catalog hygiene** | ⚠️ 2 stale API rows with 404 media; not shown on public homepage |

---

## Recommended Next Steps (BG-6B+, not executed here)

1. **Manual or instrumented Hero replace test** — confirm drop → Save → `reelforge_hero_video` / platform config write.
2. **Remove or restore legacy reels** `66598368…` and `e5bf7c03…` to clear `split_brain_detected`.
3. **Optional:** Re-run vault delete with reload/hard-refresh verification.
4. **UI validation** for Netlify Vault/Hero/batch delete can proceed for feed + vault paths; treat Hero as **open** until BG-6B hero trace completes.

---

## PASS / FAIL (Mission)

**PARTIAL PASS**

- Storage consumption for **new uploads** works end-to-end on production UI.
- **Hero Background replace** remains the primary unverified workflow.
- No evidence of Railway, volume, or upload pipeline failure in this audit.
