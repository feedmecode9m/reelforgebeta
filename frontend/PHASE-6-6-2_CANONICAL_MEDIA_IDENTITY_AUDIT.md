# PHASE 6.6.2 — Canonical Media Identity Audit

**Status:** Implementation complete · validators A–E PASS · **no deploy**  
**Date:** 2026-08-13  
**Deploy:** none  
**Production mutations:** 0  

---

## 1. Identity map report

### Contract (proposed)

```json
{
  "canonicalId": "assetId | personal_video_id | url:<normalized> | file:<hash> | ph:<id>",
  "assetId": "",
  "mediaType": "video|image|…",
  "mediaUrl": "",
  "normalizedMediaUrl": "",
  "posterUrl": "",
  "titleSource": "persistent_or_local_edit|creator_persistent|row_title_or_name|none",
  "shelfEligibility": "Trending|…"
}
```

**Identity priority (never title):**

1. `assetId` / `id`  
2. `personal_video_id`  
3. `normalizedMediaUrl`  
4. filename hash  
5. explicit `placeholderId`  

Module (audit helpers only): `frontend/src/lib/feed/canonicalMediaIdentity.js`

### Paths that create viewer/discovery items

```text
/api/reels
   → buildHomeFeed.js (prepareFeedCard / projectCatalogCard)
   → feed.set

personal video vault (localStorage)
   → syncVideoVaultToFeed
   → distributeVideoToFeed   ← can INSERT twin if identity match fails

thumbnail sync
   → poster on video (Phase 6.5) OR publishable image card only

reel_titles_persistent + StudioExperience.updateReelTitle
   → mutates same row + durable map (does not intentionally clone)

demo / empty catalog
   → applyPlaceholderFallbackIfEmpty (isPlaceholder:true)

Coming Soon pads
   → fillShelfPresentation (presentation-only; skipped when real assets exist)

Viewer projection
   → Featured (promo remount OK)
   → Trending / shelves (one row per identity required)
   → Browse (residual only — Phase 6.6)
```

---

## 2. Duplicate report

### Confirmed failure mode

`DUPLICATE_IDENTITY_FOUND` when **buildHomeFeed** and **syncVideoVaultToFeed / distributeVideoToFeed** both emit a Trending row for the same media:

| Field | Catalog card | Vault redistribute card |
|-------|--------------|-------------------------|
| `id` / `assetId` | same UUID | same UUID |
| `url` | often absolute (`http://127.0.0.1:8080/videos/…`) | often relative (`/videos/…`) |
| Removal check in distribute | exact `url` string **or** `isPersonalVideo && personal_video_id` | — |
| Result | twin survives if URL strings differ and flags differ | `unshift` second object |
| Titles | filename stem e.g. `01 ARRIVAL OPEN v1` | edited e.g. `Arrival: First Contact` |

Validator fixture output shape:

```json
{
  "tag": "DUPLICATE_IDENTITY_FOUND",
  "assetId": "73adb67a-6d97-43fd-8fc6-3a4b4ce0b3ee",
  "records": 2,
  "sameShelfDuplicate": true,
  "titleDivergence": true,
  "sources": ["buildHomeFeed", "syncVideoVaultToFeed"]
}
```

### What is NOT the bug

| Observation | Classification |
|-------------|----------------|
| Featured + Trending same Arrival | Allowed layout remount (Phase 6.6) |
| `isPlaceholder:true` demo cards | Only when feed empty |
| Filename-looking title alone | Presentation quality issue, not identity key |
| Thumbnail as separate card | Phase 6.5 suppresses unless publishable |

### Viewer dedupe gap

`dedupeViewerFeedIdentities` collapses **video↔image** pairs; it does **not** collapse **same-id / same-shelf** twins when iterating the shelf list. Same-shelf duplicates therefore reach the DOM.

---

## 3. Source ownership table

| Concern | Owner (write) | Owner (read/project) | Must not |
|---------|---------------|----------------------|----------|
| Canonical asset id | Backend `/api/reels` + vault entry `id` | `canonicalMediaIdentity` | Invent new ids on redistribute |
| Durable title | `reel_titles_persistent` via `updateReelTitle` | `applyPersistedTitlesOverlay`, vault projection | Use title as identity |
| Feed row assembly | `buildHomeFeed` (catalog authority) | Viewer shelves | Blind `unshift` without identity upsert |
| Vault→feed sync | `distributeVideoToFeed` | should **update** existing canonical row | Insert twin |
| Poster | video `thumbnailUrl` / absorbed artwork | MediaThumbnail / resolvedMedia.poster | Independent discovery card |
| Featured remount | `viewerShelfComposition` | ReelshortExperience | Remount Browse residuals |
| Demo placeholders | `applyPlaceholderFallbackIfEmpty` | empty-feed only | Mix with real catalog |

---

## 4. Proposed minimal patch (NOT applied)

**Scope:** identity upsert only — no UI, no category, no styling.

1. **`distributeVideoToFeed`**  
   - Match existing rows via `sameCanonicalMediaIdentity` (id / personal_video_id / `normalizeMediaUrl`).  
   - **Update** the existing row (merge title/poster/url); do not `unshift` a second object when a match exists.  
   - Prefer persistent / `_localModified` title over filename stem.

2. **Post-`feed.set` guard (optional belt)**  
   - Run `collapseSameShelfDuplicateIdentities` once after `buildHomeFeed` + vault sync in `syncFromVault` so any residual same-shelf twins collapse before persist.

3. **Do not change**  
   - Phase 6.5 poster/artifact rules  
   - Phase 6.6 Featured/Browse residual policy  
   - Upload lifecycle validation UI  
   - Metadata / category writers  

4. **Approval gate**  
   - Wire only after explicit approval of this audit.

Pure collapse helper already exists for tests: `collapseSameShelfDuplicateIdentities` in `canonicalMediaIdentity.js`.

---

## 5. Validators

| Command | Purpose |
|---------|---------|
| `npm run validate:phase-6-6-2-canonical-media-identity` | Contract + duplicate detection + title-collapse expectation + layout residual check |

Artifact: `frontend/artifacts/phase-6-6-2-canonical-media-identity-report.json`

### Regression matrix (detection coverage)

| Case | Expected | Validator |
|------|----------|-----------|
| A New MP4 | 1 identity | covered |
| B MP4 + thumb distinct ids | no same-assetId shelf twin | covered (Phase 6.5 still owns thumb→poster) |
| C Title edit | 1 row | covered |
| D Hard refresh | same identity after collapse | covered via normalize URL + collapse |
| E Local + production-shaped | absolute/relative URL collide | covered |

### Upload lifecycle

Manual / existing Phase 6.3 lifecycle browser validator remains authority for drop→progress→catalog. This audit adds identity assertions for the feed twin failure mode; full browser lifecycle re-run deferred until patch is approved.

---

## Local visual approval (2026-08-13)

Automated browser pass against `http://127.0.0.1:5173` (no deploy, no commit).

| Check | Verdict |
|-------|---------|
| Trending: one Arrival card + poster | **PASS** |
| No IMG_/UUID title leakage | **PASS** |
| Title edit → `Arrival Opening Sequence` once | **PASS** |
| Reload / sync → no filename twin | **PASS** |
| Featured remount OK; Browse = 0 repeats | **PASS** |
| Interactive MP4 drop lifecycle | **DEFER** (studio PCC freeze risk; Phase 6.3 still covers progress UI) |

Artifacts:
- `frontend/artifacts/phase-6-6-2-local-visual-approval.json`
- `frontend/artifacts/phase-6-6-2-visual-01-trending.png`
- `frontend/artifacts/phase-6-6-2-visual-02-title-edit.png`
- `frontend/artifacts/phase-6-6-2-visual-03-after-sync.png`

**Overall local visual:** PASS (lifecycle drop left for human confirmation if desired). Ready for commit when you approve; do not deploy until release mission.

- ❌ same asset twice in same shelf  
- ❌ filename becomes permanent title when persistent title exists  
- ❌ title edit creates second object  
- ❌ thumbnail independent card without publish intent  
- ❌ vault sync inserts instead of updates  

---

## Milestone state

```
PHASE-6-6-2-CANONICAL-MEDIA-IDENTITY
Implementation: AUDIT COMPLETE (validators + helpers; feed wire NOT STARTED)
Release: NOT STARTED
Release Process: v1.0
Production mutations: 0
Awaiting: approval to apply minimal distributeVideoToFeed upsert patch
```
