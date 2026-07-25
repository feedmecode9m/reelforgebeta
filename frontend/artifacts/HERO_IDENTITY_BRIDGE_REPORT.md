# HERO Identity Bridge Report — BG-HERO-IDENTITY-BRIDGE-01

**Mission:** Deterministic Episode → Reel → Media identity for Hero candidates.  
**Date:** 2026-07-25

---

## Regression Scenarios

### Scenario A — `ep-neon-s01e04` (draft, no catalog reel)

**Catalog (`mockSeriesData.js`):**

```json
{
  "episodeId": "ep-neon-s01e04",
  "title": "Zero Day",
  "reelId": null,
  "status": "draft"
}
```

#### Before

| Step | Result |
|------|--------|
| Episode exists in catalog | ✓ |
| `episode.reelId` | `null` |
| Feed lookup by synthetic id | N/A |
| Feed lookup by `episodeId` | miss (no bound reel) |
| Upload registry | not consulted |
| `[HERO_IDENTITY_BRIDGE]` | `resolvedReelId: ""`, `hasVideoUrl: false` |
| Hero candidate | **REJECTED** — `reason: missing_playable_media` |

#### After (no upload anywhere)

Same as before — gate correctly rejects draft episode with no playable asset. **No fake URLs added.**

#### After (playable asset in upload registry)

Simulated state: vault entry `{ id: "a1b2-…", episodeId: "ep-neon-s01e04", url: "/videos/a1b2….mp4" }`

| Step | Result |
|------|--------|
| Priority 1–3 | miss |
| Priority 4 `uploadRegistry.episodeId` | **match** |
| `[HERO_IDENTITY_RESOLUTION]` | `matchedSource: uploadRegistry.episodeId`, `matchedVideoUrl` set |
| Hero candidate | **VALID** — `{ episodeId, reelId, videoUrl }` |

---

### Scenario B — `ep-neon-s01e02` (synthetic reelId, UUID feed)

**Catalog:** `reelId: "reel-neon-s01e02"`  
**Feed:** `{ id: "dff70497-…", episodeId: "ep-neon-s01e02", url: "/videos/….mp4" }`

#### Before

| Step | Result |
|------|--------|
| `findReelInFeedList("reel-neon-s01e02")` | **null** (UUID mismatch) |
| Hero candidate | empty `videoUrl` or rejected |

#### After

| Step | Result |
|------|--------|
| Priority 1 catalog.reelId | miss (synthetic id not in feed) |
| Priority 3 feed.episodeId | **match** UUID reel |
| `[HERO_IDENTITY_RESOLUTION]` | `matchedSource: feed.episodeId` |
| Hero candidate | **VALID** |

Verified offline: `node frontend/scripts/mission-hero-identity-bridge-01.mjs`

---

## Diagnostic Contract

### Resolution (episodeBridge)

```javascript
[HERO_IDENTITY_RESOLUTION] {
  episodeId: "ep-neon-s01e04",
  attemptedSources: ["feed.episodeId:ep-neon-s01e04", "uploadRegistry.episodeId", …],
  matchedSource: "uploadRegistry.episodeId",  // or "" on miss
  matchedReelId: "uuid-or-empty",
  matchedVideoUrl: "/videos/….mp4-or-empty"
}
```

### Candidate gate (heroIntelligence)

**Accepted:**

```javascript
[HERO_IDENTITY_BRIDGE] {
  episodeId, resolvedReelId, foundInFeed: true, hasVideoUrl: true,
  source: "candidateFromEpisode"
}
```

**Rejected:**

```javascript
[HERO_IDENTITY_BRIDGE] {
  episodeId, resolvedReelId: "", foundInFeed: false, hasVideoUrl: false,
  reason: "missing_playable_media",
  source: "candidateFromEpisode_rejected"
}
```

---

## Build Verification

```bash
cd frontend && npm run build
grep -r "HERO_IDENTITY_RESOLUTION" dist/
grep -r "candidateFromEpisode_rejected" dist/
grep -r "missing_playable_media" dist/
```

Both diagnostic strings must appear in the production bundle.

---

## Remaining Blockers

1. **Backend episode binding on legacy uploads** — Reels created before `episode_id` migration remain `episodeId: null` until studio attach or re-finalize with `episodeId`.
2. **Catalog synthetic IDs** — Mock `reel-neon-*` placeholders are not production UUIDs; rely on metadata bridge + feed `episodeId` until catalog is synced post-attach.
3. **Fallback candidates without video** — `buildFeaturedSeriesCandidate` poster-only fallback can still enter scoring without `videoUrl`; out of scope for this bridge (episode path is gated).
4. **Upload registry staleness** — `personal_video_vault` / `reelforge_feed` localStorage may contain tombstoned entries; feed sync remains authoritative for shelf display.

---

## Files Changed (This Mission)

| File | Why |
|------|-----|
| `frontend/src/lib/series/episodeBridge.js` | Priority-4 upload registry + `[HERO_IDENTITY_RESOLUTION]` |
| `frontend/src/lib/hero/heroIntelligence.js` | `reason: missing_playable_media` on rejection |
| `frontend/artifacts/HERO_IDENTITY_AUDIT.md` | Identity source audit |
| `frontend/artifacts/HERO_IDENTITY_BRIDGE_REPORT.md` | This regression report |
