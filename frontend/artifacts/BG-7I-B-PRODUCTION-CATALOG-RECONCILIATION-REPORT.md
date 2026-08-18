# BG-7I-B — Production Catalog Reconciliation Report

**Mode:** Diagnostic only (no code changes)  
**Branch:** `main`  
**Generated:** 2026-07-25T01:30:00Z  
**Production URL:** https://strong-lolly-a9fcb4.netlify.app/  
**Live bundle:** `index-Dv1Hvx_O.js`

**Evidence artifacts:**

| Artifact | Path |
|----------|------|
| Playwright trace (fresh session) | `frontend/artifacts/bg-7i-b-production-reconciliation-trace.json` |
| Backend catalog snapshot | `frontend/artifacts/bg-7i-b-catalog-snapshot.json` |

---

## Executive summary

Production phantom cards are **not** caused by UI placeholder injection (`VITE_ALLOW_UI_PLACEHOLDERS=false` is baked into the live bundle). On a fresh Netlify session, **47 feed cards** are created directly from **`GET /api/reels` → `buildHomeFeed()`**, while the **thumbnail vault store stays empty** (`personal_thumbnails: 0`) because empty-vault hydration requires prior `personal_thumbnail_reel_ids` membership.

The “four repeated placeholder/image cards” symptom matches **duplicate catalog image reels** (notably **5× `bg7k-prod-thumb.jpg`**) rendered as **`isCatalogImage` feed cards** with `isPlaceholder: false`. These are authoritative backend rows, not synthetic demo placeholders.

**Root cause classification:** **B) stale/noisy backend catalog** + **E) frontend feed/vault source mismatch**  
Secondary for returning browsers after video deletes: **A) stale localStorage feed** + **C) orphan thumbnail records** (partially addressed by BG-7I-A once deployed).

---

## Production reproduction steps

1. Open https://strong-lolly-a9fcb4.netlify.app/ in a fresh browser profile (or clear site data).
2. Wait for bootstrap (`mediaBootstrap` → `syncFromVault`).
3. Observe homepage feed shelves populate with dozens of cards including repeated `bg7k-prod-thumb.jpg` thumbnails.
4. Open Studio → Vault:
   - **Thumbnail grid:** empty on fresh session (`personal_thumbnails: 0`).
   - **Video grid:** populated from backend merge (`personal_video_vault: 20` after sync).
5. Compare to user report: if the user previously deleted MP4s from the vault UI, feed cards can remain while vault tabs look empty — feed and vault use different stores and hydration rules.

**Local non-reproduction:** Local dev catalog is typically smaller/cleaner; production Postgres retains mission test uploads (`bg7k-prod-thumb`, `bg7k-test`, playwright probes, etc.).

---

## 1. Rendered card source trace

```
mountViewer / mediaBootstrap
  ↓ GET /api/reels (47 rows)
  ↓ normalizeReels → rawData
syncFromVault
  ↓ upgradeThumbnailVaultFromBackendReels (no-op hydrate when personal_thumbnail_reel_ids empty)
  ↓ reloadVaultStoresFromStorage (personal_thumbnails stays 0)
  ↓ reconcileStaleThumbnailsOnStartup (examined: 0, backendThumbReels: 25)
  ↓ buildHomeFeed(rawData) → 47 cards
  ↓ feed.set + storageSet(reelforge_feed)
  ↓ reelsToVideoVaultEntries → personalVideos (20, hero-filtered)
Card rendering
  ↓ FeedExperience / ReelshortExperience reads feed store
  ↓ VaultExperience reads personalThumbnailCollection + personalVideos (split surfaces)
```

### Captured card provenance (fresh production session)

| Metric | Value | Source |
|--------|-------|--------|
| Catalog rows | 47 | `GET /api/reels` |
| Feed cards after sync | 47 | `buildHomeFeed` (`[BUILD_HOME_FEED] cardCount: 47`) |
| `DEMO_FEED_INJECTED` | **0 events** | Placeholder injection inactive |
| `personal_thumbnails` | 0 | Empty vault; hydrate gated on `personal_thumbnail_reel_ids` |
| `personal_video_vault` | 20 | Backend video merge (non-hero) |
| `reelforge_feed` persisted | 47 | Post-sync localStorage |

### Repeated feed groups (same display name, distinct IDs)

| Display key | Count | Catalog type |
|-------------|-------|--------------|
| `bg7k-prod-thumb.jpg` | **5** | `image` (`/thumbs/…`) |
| `bg7k-test` | 2 | `image` |
| `IMG_0121.JPEG` | 2 | `image` |
| `bg7h-transport-test` | 2 | `video` (paired MP4 + thumb) |
| `vh03-playwright-thumb.jpg` | 2 | `image` |

These are **catalog duplicates**, not renderer clones. User-reported “four repeated” cards align with the **`bg7k-prod-thumb.jpg` cluster** (observed 5× on live catalog).

### Card flags (from `buildHomeFeed` contract)

| Catalog kind | Feed flags | Synthetic placeholder? |
|--------------|------------|-------------------------|
| `type: image`, url `/thumbs/…` | `isCatalogImage: true`, `isPlaceholder: false` | No |
| `type: video`, url `/videos/…` | `isPersonalVideo: true`, `isPlaceholder: false` | No |
| Misclassified MP4 (`type: image`, url `.mp4`) | Treated as **image card** (`thumbnail_card`) | No |

Example misclassified rows still in production catalog:

| ID | Name | DB type | URL |
|----|------|---------|-----|
| `6060c258-a3f6-40ba-b642-c758562c7cb7` | PIPELINE-TRACE-LARGE | `image` | R2 `.mp4` |
| `1aaaa063-a877-4268-8aeb-7343831c1752` | Vault Test Hero… | `image` | R2 `.mp4` |

These render as static image-style feed cards even though the underlying asset is video — contributing to “MP4 placeholder thumbnail” perception.

---

## 2. Production localStorage audit

### Fresh session (Playwright, 2026-07-25)

| Key | Count | Notes |
|-----|-------|-------|
| `personal_video_vault` | 20 | Synced from backend catalog |
| `personal_thumbnails` | **0** | No hydrate without `personal_thumbnail_reel_ids` |
| `personal_thumbnail_index` | 0 | Mirror of above |
| `reelforge_feed` | 47 cards | Full catalog mirror |
| `reel_vault` | 0 | Legacy vault unused on fresh boot |
| `reelforge_deleted_media_ids` | 0 | No tombstones on fresh profile |

### Returning-session hypothesis (not live-captured; supported by prior traces)

From `bg-7j-deploy-validation.json` and BG-7I delete investigations:

| Key | Risk |
|-----|------|
| `reelforge_feed` | Stale cards survive video deletes until next full resync |
| `personal_thumbnails` | Orphan `.mp4` fileName entries → `syncThumbnailsToFeed` inserts `personal-thumb-*` cards |
| `personal_thumbnail_reel_ids` | Membership list may reference deleted reel IDs |

BG-7I-A (committed `7b2be4e`) fixes **future** video-delete tombstoning; it does not retroactively clean existing production browser storage or Postgres catalog noise.

---

## 3. Backend catalog audit (`GET /api/reels`)

**Endpoint:** `https://strong-lolly-a9fcb4.netlify.app/api/reels` (same-origin proxy → Railway)

| Metric | Count |
|--------|-------|
| Total reels | 47 |
| `type: video` | 20 |
| `type: image` | 27 |
| Rows with `.mp4` in URL | 22 (includes 2 misclassified as `image`) |
| Standalone thumb/image rows | 25+ |

**Catalog is not empty** — production ghosts on the feed are **backed by live DB rows**, not invented client-side.

Notable duplicate test uploads (should be considered catalog hygiene candidates):

- 5× `bg7k-prod-thumb.jpg` (IDs `1d422a2f…`, `6a96ae14…`, `55725261…`, `2fdd1918…`, `e9a359dc…`)
- 2× `bg7k-test` PNG
- Multiple `vh03-playwright-thumb`, `VAULT_TEST_THUMB_*`, transport probes

**Deleted/stale records:** No `status: deleted` rows observed in sample; stale content persists as `status: ready`.

---

## 4. Placeholder feature state (production build)

| Setting | Config source | Live bundle evidence |
|---------|---------------|----------------------|
| `VITE_ALLOW_UI_PLACEHOLDERS` | `netlify.toml` = `"false"`, `.env.production` = `false` | Baked as `Iu=!1` (`ALLOW_UI_PLACEHOLDERS: false`) |
| `VITE_USE_SAME_ORIGIN_API` | `true` | Present in bundle |
| `DEMO_FEED_INJECTED` runtime | N/A | **Not observed** on fresh prod session |
| `via.placeholder.com` strings | Gated markup | 9 literal strings in bundle (inactive when flag false) |

**Verdict:** **Placeholder injection (class D) is NOT the active path** on current Netlify production.

---

## 5. First divergence boundary

### Primary boundary (proven on fresh production)

```
syncFromVault → buildHomeFeed(rawData)
  viewerContext.js (~1183–1218)
  buildHomeFeed.js evaluateFeedEligibility + prepareFeedCard
```

**Failure mode:** Every eligible catalog row becomes a homepage feed card **independent of vault UI state**. Thumbnail vault hydration (`thumbnailVault.js:231-233`) returns **0** when `personal_thumbnail_reel_ids` is empty, creating a **feed-rich / vault-empty** split that matches the user’s “cards visible but not in Vault” report.

**Exact log proof:**

```
[VAULT_SYNC] personal_thumbnails: 0 → 0
[STARTUP_RECONCILE] backendThumbReels: 25, examined: 0, remaining: 0
[BUILD_HOME_FEED] catalogCount: 47, cardCount: 47
```

### Secondary boundary (returning sessions / post-delete)

```
Video delete → applyCanonicalDeleteClientEffects (feed + video vault only)
  ✗ pre-BG-7I-A: no deleteThumbnailVaultEntries for video path
  ↓ stale personal_thumbnails + reelforge_feed
AI_CLEANUP_AGENT.syncThumbnailsToFeed → PERSONAL_THUMBNAIL_INSERT
```

Documented in `BG-7I-DELETE_THUMBNAIL_TRACE.md`. BG-7I-A addresses forward deletes; existing orphans remain until manual clear or reconcile.

### Tertiary boundary (catalog data quality)

Postgres retains duplicate mission uploads and 2 MP4 rows stored as `type: image`. `buildHomeFeed` faithfully surfaces them.

---

## Root cause classification

| Class | Verdict | Evidence |
|-------|---------|----------|
| **A) Stale browser storage** | **Secondary** | Returning profiles; `reelforge_feed` persists across deletes |
| **B) Stale backend catalog** | **Primary** | 47 ready rows incl. 5× duplicate test thumbs |
| **C) Orphan thumbnail records** | **Secondary** | Pre-BG-7I-A delete path; `syncThumbnailsToFeed` |
| **D) Placeholder injection enabled** | **Ruled out** | `ALLOW_UI_PLACEHOLDERS=false`, no `DEMO_FEED_INJECTED` |
| **E) Frontend rendering mismatch** | **Primary** | Feed uses full catalog; vault uses gated local stores |

**Combined diagnosis:** Production “phantom” cards are **real catalog-backed feed cards** (B) rendered through a **feed/vault hydration split** (E). Legacy browser state can amplify after deletes (A+C).

---

## Source of the four phantom cards

Most likely identity: **the `bg7k-prod-thumb.jpg` duplicate cluster** (5 catalog IDs, same visible title) promoted to Trending feed cards via `buildHomeFeed`, while **not appearing in the thumbnail vault grid** on fresh sessions because `personal_thumbnails` never hydrates without `personal_thumbnail_reel_ids`.

If the user refers to **MP4-associated thumb ghosts** after deleting videos, those are **`personal-thumb-{id}` feed cards** or **catalog image rows** whose companion video was removed from `personal_video_vault` but whose catalog/feed entries remain.

---

## Recommended minimal fix (proposal only — do not implement in BG-7I-B)

### Priority 1 — Catalog hygiene (ops, no frontend behavior change)

- Delete or archive duplicate mission reels from production Postgres (`bg7k-prod-thumb.jpg` ×5, stale playwright probes).
- Fix misclassified rows (`6060c258…`, `1aaaa063…`) — set `type: video` or delete if obsolete.

**Risk:** Low for frontend; requires backend/admin action.

### Priority 2 — Align feed with vault contract (surgical frontend)

Option A (smallest behavioral change for “My Vault” parity):

- In `buildHomeFeed`, **do not emit standalone `isCatalogImage` cards** unless the reel id is present in `personal_thumbnail_reel_ids` OR user is in admin/catalog mode.

Files: `frontend/src/lib/feed/buildHomeFeed.js`, possibly `viewerContext.js` (pass membership set).

Option B (hydrate vault to match catalog):

- Change `hydrateEmptyThumbnailVaultFromBackendReels` to seed from backend thumb reels on first sync (not only `personal_thumbnail_reel_ids`).

Files: `frontend/src/lib/viewer/thumbnailVault.js`  
**Risk:** Higher — reverses intentional membership gate; may repopulate vault user thought was empty.

### Priority 3 — Returning-session cleanup (user ops)

- Hard refresh after BG-7I-A deploy.
- Clear `reelforge_feed` + `personal_thumbnails` once, allow resync.
- Documented in BG-7I promotion notes.

### Priority 4 — Deploy BG-7I-A

- Ensures **future** video deletes tombstone thumbnail vault entries (`7b2be4e`).
- Does not remove existing catalog duplicates.

---

## Files that would require modification (if patching)

| Priority | File | Change |
|----------|------|--------|
| P1 | Backend admin / cleanup script | Remove duplicate test reels |
| P2A | `frontend/src/lib/feed/buildHomeFeed.js` | Gate `isCatalogImage` cards on vault membership |
| P2A | `frontend/src/viewer/viewerContext.js` | Pass membership context into feed build |
| P2B | `frontend/src/lib/viewer/thumbnailVault.js` | Relax empty-vault hydrate policy (not recommended) |
| P3 | Docs / support runbook | localStorage reset steps |
| P4 | Already committed | `aiCleanupAgent.js`, `VaultExperience.svelte`, `viewerContext.js` (BG-7I-A) |

---

## Success criteria check

| Criterion | Status |
|-----------|--------|
| No code changes during investigation | ✅ |
| Source of phantom cards identified | ✅ Catalog → `buildHomeFeed` (+ optional stale localStorage) |
| First failing boundary named | ✅ `syncFromVault` → `buildHomeFeed` / vault hydrate split |
| Placeholder injection ruled in/out | ✅ Ruled **out** on live bundle |
| Surgical patch proposed | ✅ Catalog cleanup + optional feed gating |

---

## Why local does not reproduce

| Factor | Local | Production |
|--------|-------|--------------|
| Catalog size | Smaller dev dataset | 47 rows with mission duplicates |
| Test uploads | Fewer / cleaned | `bg7k-prod-thumb` cluster |
| Browser profile | Often warm / same origin dev | Netlify users accumulate stale `reelforge_feed` |
| Bundle flags | Dev may default placeholders on | `VITE_ALLOW_UI_PLACEHOLDERS=false` enforced |

---

## Next mission recommendation

**BG-7I-C (proposed):** Catalog cleanup on Railway + optional `buildHomeFeed` gate for standalone image cards tied to `personal_thumbnail_reel_ids`, with Playwright proof that fresh production feed no longer shows duplicate `bg7k-prod-thumb` cards when vault is empty.
