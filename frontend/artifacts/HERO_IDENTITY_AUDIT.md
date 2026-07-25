# HERO Identity Audit — BG-HERO-IDENTITY-BRIDGE-01

**Mission:** Establish deterministic Episode → Reel → Media identity chain for Hero background resolution.  
**Mode:** Investigation artifact (no gate weakening).

---

## Executive Summary

Hero episode candidates resolve media through a layered identity chain. Production UUID reels from `GET /api/reels` do not match mock catalog synthetic IDs (`reel-neon-s01e02`). The bridge must join episodes to reels via persisted metadata, backend `episodeId` fields, and local upload caches — not title guessing alone.

**Canonical production source of truth for uploaded videos:** PostgreSQL `reels` table exposed as `ReelV1` via `GET /api/reels`, normalized by `frontend/src/lib/api/reelContract.js`.

---

## Current Identity Sources

| Source | Storage / API | Key fields | Role |
|--------|---------------|------------|------|
| Series catalog | `mockSeriesData.js` + `seriesStore` | `episodeId`, `reelId` (nullable synthetic) | Episode selection, initial reel pointer |
| Reel series metadata | `localStorage: reelforge_series_metadata` | `reelId` → `{ episodeId, seriesId, … }` | Studio attach / bridge persistence |
| Live feed (normalized) | Svelte `normalizedFeed` store | `id` (UUID), `url`, `episodeId` | Runtime playback + Hero lookup |
| Cached feed | `localStorage: reelforge_feed` | Same as feed reels | Offline / pre-sync registry |
| Personal video vault | `localStorage: personal_video_vault` | `id`, `url`, optional `episodeId` | Upload cache before feed hydration |
| Backend reels | `GET /api/reels`, `GET /api/reels/{id}` | `id`, `episodeId`, `url` | Authoritative uploaded media |
| Hero canonical reel | `localStorage: reelforge_hero_reel` | `id`, `url` | Custom hero override only (not episode chain) |
| Hero manager config | `localStorage: reelforge_hero_manager_config` | `heroAssetId`, `backgroundSource` | Custom vs selection mode |

---

## Lookup Order (Implemented)

`resolveReelForEpisode()` in `frontend/src/lib/series/episodeBridge.js`:

| Priority | Source | Match key | Diagnostic label |
|----------|--------|-----------|------------------|
| 1 | Catalog | `episode.reelId` → feed by id | `catalog.reelId` |
| 2 | Metadata map | `reelforge_series_metadata[reelId].episodeId === episodeId` → feed by id | `metadata.episodeId` |
| 3 | Live feed | `reel.episodeId \|\| reel.episode_id === episodeId` | `feed.episodeId` |
| 4 | Upload registry | `personal_video_vault` + `reelforge_feed` by `episodeId` or known `reelId` | `uploadRegistry.episodeId`, `uploadRegistry.reelId` |
| 5 | Title match (last resort) | Normalized title on feed, then registry | `feed.title`, `uploadRegistry.title` |

All matches require a **playable** reel (`id` + non-empty `url`/`video_url`/`videoUrl`).

Diagnostics: `[HERO_IDENTITY_RESOLUTION] { episodeId, attemptedSources, matchedSource, matchedReelId, matchedVideoUrl }`.

---

## Hero Candidate Gate (Preserved)

`candidateFromEpisode()` in `heroIntelligence.js`:

- **VALID:** `{ episodeId, reelId, videoUrl }` — enters scoring via `[HERO_IDENTITY_BRIDGE] source: candidateFromEpisode`
- **REJECTED:** `{ episodeId, reason: "missing_playable_media" }` — logged as `source: candidateFromEpisode_rejected`, returns `null`

Gate is **not** weakened. Episodes without resolved playable media never enter Hero scoring.

---

## Missing Links (Pre-Fix)

| Gap | Evidence | Impact |
|-----|----------|--------|
| Synthetic vs UUID reel IDs | `ep-neon-s01e02.reelId = "reel-neon-s01e02"`, feed id = UUID | Priority-1 feed lookup miss |
| Draft episodes with null reelId | `ep-neon-s01e04`: `reelId: null`, `status: "draft"` | No catalog pointer; relies on metadata/feed/registry |
| Backend episode binding sparse | Legacy reels: `episodeId: null` until finalize/attach | Priority 3 miss until HERO-ID-BRIDGE-02 bind |
| Upload registry not consulted | Vault/feed cache ignored by old resolver | Playable asset in localStorage invisible to Hero |
| Title-only as early fallback | Previously could mask missing identity | Now strictly Priority 5 |

---

## Recommended Canonical Mapping

```text
episodeId (catalog)
    ↓ bindEpisodeToFeedReel / studio attach / finalize { episodeId }
reelId (UUID, PostgreSQL reels.id)
    ↓ row_to_reel_v1
url (canonical media URL)
    ↓ resolveReelForEpisode → candidateFromEpisode
Hero candidate { episodeId, reelId, videoUrl }
```

**Write path:** Upload finalize or studio attach must persist `episode_id` on the reel row and update `reelforge_series_metadata` + catalog `episode.reelId`.

**Read path:** Hero uses `resolveReelForEpisode()` — never bare `findReelInFeedList(episode.reelId)` alone.

---

## Backend Contract (Document Only)

| Layer | Field | Notes |
|-------|-------|-------|
| DB `reels` | `id`, `episode_id`, `video_url` | Migration `20260725_reels_episode_id.sql` |
| `ReelV1` JSON | `id`, `episodeId`, `url` | `serde(rename_all = "camelCase")` |
| Frontend normalize | Preserves `episodeId`/`episode_id` from raw spread | `reelContract.js:normalizeReel` |

**Mismatch:** Frontend mock catalog uses synthetic `reel-neon-*` ids; backend uses UUIDs. Bridge metadata + `episodeId` on reel records is the join — not id string equality alone.

---

## Files Referenced

- `frontend/src/lib/series/episodeBridge.js` — resolution engine
- `frontend/src/lib/hero/heroIntelligence.js` — candidate gate
- `frontend/src/lib/series/seriesMetadataStorage.js` — metadata map
- `frontend/src/lib/series/seriesStore.js` — `bindEpisodeToFeedReel`
- `frontend/src/lib/api/reelContract.js` — feed normalization
- `backend/src/reel_contract.rs` — `ReelV1`
- `backend/src/db/reels.rs` — persistence
