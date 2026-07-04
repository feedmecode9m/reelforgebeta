# REELFORGE SURGICAL DEBUG — MP4 Vault Ingestion & Duplicate Render Audit

## Phase 1 — MP4 lifecycle trace (evidence-first)

Reference upload used in trace: `263ebd51-d879-4ab8-ab2d-30442150bc17`

- `[MP4_UPLOAD]` → `POST /api/reels` returned `202` with one `id`.
- `[MP4_DB_INSERT]` → `GET /api/reels/:id` transitioned to `status=ready`.
- `[MP4_STORE_ADD]` → `personal_video_vault` contained exactly one matching entry.
- `[MP4_RENDER]` → vault rendered exactly one matching video card.
- `[MP4_PLACEHOLDER]` → `posterUrl` and `mediaUrl` populated; `previewFrame` null.
- `[MP4_HERO]` → hero remained on default `hero-background.mp4` (did not switch).
- `[MP4_THEATER]` → search-open event did not open theater for uploaded reel id.

### File map requested

1. Upload handler file: `frontend/src/components/experiences/VaultExperience.svelte` + `frontend/src/lib/api/media.js`
2. Media persistence file: `backend/src/ingestion/upload.rs` + `backend/src/db/reels.rs`
3. Store update file: `frontend/src/viewer/viewerContext.js` + `frontend/src/lib/viewer/aiCleanupAgent.js`
4. Vault rendering file: `frontend/src/components/experiences/VaultExperience.svelte`
5. Placeholder rendering file: `frontend/src/lib/viewer/vaultUtils.js`
6. Hero rendering file: `frontend/src/components/experiences/HeroExperience.svelte` + `frontend/src/lib/hero/heroIntelligence.js`
7. Theater rendering file: `frontend/src/components/theater/TheaterExperience.svelte` + `frontend/src/viewer/viewerContext.js`

## Phase 2 — duplicate detection

Initial evidence (pre-fix) for uploaded MP4 `49100cf6-3d20-4914-9696-371dc93c139d`:

- API/DB count = 1 (`GET /api/reels` had one matching record)
- Vault store count = 1
- Vault card count = 1
- Feed count = 4 (same reel appeared in `Trending`, `Romance`, `Cyber-Action`, `Suspense`)

Root duplicate source: `frontend/src/lib/viewer/aiCleanupAgent.js` function `distributeVideoToFeed()` explicitly inserted one copy per category.

### A-G cause table

- A. Duplicate upload requests: **No** (single POST observed)
- B. Duplicate DB inserts: **No** (single reel id in API list)
- C. Duplicate store pushes: **Vault no**, **Feed yes (intentional multi-category insertion)**
- D. Duplicate reactive subscriptions: **Not primary source in this trace**
- E. Duplicate Svelte keyed loops: **Risk found** (vault loops previously unkeyed)
- F. Multiple mount cycles: **Not required to reproduce**
- G. Hydration/render duplication: **Secondary risk**, not root trigger for 4-card symptom

## Phase 3 — placeholder validation (MP4)

For `263ebd51-d879-4ab8-ab2d-30442150bc17`:

- `thumbnailUrl`: populated
- `posterUrl`: populated
- `mediaUrl`: populated
- `previewFrame`: null

Classification:

- undefined: none
- null: `previewFrame`
- empty string: none

Failure point for placeholder complaint was not MP4 URL loss in this run; MP4 poster/media values were present.

## Phase 4 — vault card `{#each}` audit

Vault loops audited in `frontend/src/components/experiences/VaultExperience.svelte`:

- Images loop had no stable key (fixed in this pass)
- Videos loop had no stable key (fixed in this pass)

## Patch diff (applied after evidence)

### 1) Stop multi-category MP4 duplication in feed
- File: `frontend/src/lib/viewer/aiCleanupAgent.js`
- Change: `distributeVideoToFeed()` now:
  - removes existing copies of the same personal video across categories
  - inserts one canonical record into one primary category only
  - uses canonical reel id `String(videoData.id)`

### 2) Stabilize vault render loops
- File: `frontend/src/components/experiences/VaultExperience.svelte`
- Change:
  - keyed image loop
  - keyed video loop
  - updated hint text from "auto-distributes to all categories" to "auto-categorizes into feed"

## Post-fix validation evidence

MP4 test reel: `607e6f14-ce33-427d-b1b4-41789b7ded2e`

- Vault store count: 1
- Vault card count: 1
- Feed count: 1 (`Trending: 1`)

Image test reel: `39d959a2-254e-4d34-bdf1-0cea45586d1c`

- Thumbnail store count: 1
- Image vault card count: 1

Backend restart persistence check (sample reel `263ebd51-d879-4ab8-ab2d-30442150bc17`):

- `GET /api/reels/:id` = `200` before restart
- `GET /api/reels/:id` = `200` after restart

## Outstanding findings

- Hero binding remains unresolved in automation path:
  - `resolveHeroBackgroundAsset()` resolves uploaded id correctly
  - rendered hero source still shows default `hero-background.mp4`
- `reelforge:search-open-reel` did not open theater for newly uploaded reel id in this automated path, despite feed evidence.

These are tracked as integration gaps separate from the duplicate-card root cause fixed above.

