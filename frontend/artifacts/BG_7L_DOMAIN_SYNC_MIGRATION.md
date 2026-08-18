# BG-7L-DOMAIN-SYNC — Migration Report

**Mission:** Replace monolithic `syncFromVault()` rebuilds with domain-scoped synchronization.

**Date:** 2026-07-24

---

## Architecture Change

### Before

```
Any ingestion event → syncFromVault(true)
  → GET /api/reels
  → upgradeThumbnailVaultFromBackendReels
  → reloadVaultStoresFromStorage (all stores)
  → reconcileThumbnailVault (ghost purge)
  → buildHomeFeed
  → personalVideos merge
```

### After

```
syncDomain(domains, options)
  → syncFromVaultWithDomains (domain gates)
  → hero-only: syncHeroDomainOnly (no catalog fetch, no reconcile, no feed/video)
  → thumbnail: upgrade + reload thumbnail + reconcile (only when requested)
  → feed: buildHomeFeed + feed.set (only when requested)
  → video: reelsToVideoVaultEntries + personalVideos (only when requested)
```

`syncFromVault()` remains as `syncDomain('all')` for bootstrap, manual refresh, and multi-domain mutations.

---

## New Module

| File | Purpose |
|------|---------|
| `src/lib/viewer/domainSync.js` | `SYNC_DOMAIN`, `resolveSyncDomains`, `domainsForReelIngestion`, ownership tracing |

---

## Call Site Inventory

| Location | Trigger | Previous | Migrated To | Rationale |
|----------|---------|----------|-------------|-----------|
| `viewerContext.js:2113` | WebSocket `CREATED` | `syncFromVault(true)` | `syncDomain(domainsForReelIngestion(reel))` | **Root fix:** hero → hero only |
| `viewerContext.js:1767` | `refreshContent()` | `syncFromVault(true, true)` | unchanged (full) | Manual refresh — all domains |
| `viewerContext.js:2057` | `mountViewer()` bootstrap | `syncFromVault(true, true)` | unchanged (full) | Cold start hydration |
| `VaultExperience.svelte:648` | Accept thumbnail | `syncFromVault(true, true)` | `syncDomain([thumbnail, feed])` | Thumbnail accept |
| `VaultExperience.svelte:741` | Video vault delete | `syncFromVault(true, true)` | `syncDomain([video, feed])` | Video domain only |
| `VaultExperience.svelte:1479` | Batch thumbnail delete | `syncFromVault(true, true)` | `syncDomain([thumbnail, feed])` | Thumbnail domain |
| `VaultExperience.svelte:1577` | Batch thumbnail delete (alt) | `syncFromVault(true, true)` | `syncDomain([thumbnail, feed])` | Thumbnail domain |
| `VaultExperience.svelte:1668` | Batch video delete | `syncFromVault(true, true)` | `syncDomain([video, feed])` | Video domain |
| `StudioExperience.svelte:723` | Studio video file upload | `syncFromVault(true)` | `syncDomain([video, feed])` | Video ingest |
| `StudioExperience.svelte:758` | Studio URL upload | `syncFromVault(true)` | `syncDomain([video, feed])` | Video ingest |
| `StudioExperience.svelte:1050` | `unveilToCloud` | `syncFromVault(true)` | `syncDomain([video, feed])` | Video ingest |
| `StudioExperience.svelte:415` | Bulk production delete | `syncFromVault(true)` | unchanged (full) | Cross-domain inventory |
| `StudioExperience.svelte:502` | Bulk category PATCH | `syncFromVault(true)` | unchanged (full) | Catalog-wide metadata |
| `StudioExperience.svelte:1014` | Title rename (synced) | `syncFromVault(true)` | unchanged (full) | Feed + catalog titles |
| `StudioExperience.svelte:1177` | Refresh button | `syncFromVault(true)` | unchanged (full) | Explicit full refresh |
| `HeroManagerPanel.svelte:426` | Hero asset delete | `syncFromVault(true)` | `syncDomain(hero)` | Hero domain only |
| `contentAgents.js:292` | Quick upload | `syncFromVault(true)` | `syncDomain([video, feed])` | Video ingest |
| `contentAgents.js:304` | Batch upload | `syncFromVault(true)` | `syncDomain([video, feed])` | Video ingest |
| `aiCleanupAgent.js:645` | Single video delete | `syncFromVault(true)` | `syncDomain([video, feed])` | Video + feed cards |
| `uiAgent.js:126` | Studio feed delete confirm | `syncFromVault(true)` | `syncDomain([feed, video])` | Feed card removal (+ vault if video) |

---

## Hero Upload Path (Critical)

```
Hero upload (HeroExperience.acceptHeroFile)
  → backend ingest
  → WebSocket CREATED
  → domainsForReelIngestion(reel, isHeroAsset) → ['hero']
  → syncHeroDomainOnly(reel)
      → handleHeroManagerUpdated()
      → [BG7L_DOMAIN_SYNC_VIOLATION] if thumbnail/video stores mutate
```

**Does NOT execute on hero-only path:**

- `upgradeThumbnailVaultFromBackendReels`
- `reloadThumbnailStoreFromStorage`
- `reconcileThumbnailVault` / `reconcileStaleThumbnailsOnStartup`
- `buildHomeFeed` / `feed.set`
- `personalVideos.set` / video vault merge

---

## Store Ownership Tracing

`traceAssetOwnership()` logs on:

- Hero domain sync (`syncDomain:hero`)
- Video vault merge (`syncFromVault:video`)

Fields: `assetId`, `category`, `surface`, `store`, `source`, `owner`, `isHero`, `isVideoVault`, `isPlaceholder`

Use `[BG7L_ASSET_OWNERSHIP]` logs to detect duplicate hero (registry + video vault).

---

## Public API

| API | Semantics |
|-----|-----------|
| `syncFromVault(preserveLocal?, force?)` | Full sync — all domains |
| `syncDomain(domain \| domain[], { preserveLocal?, force?, reel? })` | Narrow sync |

Both exported from `createViewerContext()` and threaded through `Viewer.svelte` → `StudioLauncher` → `StudioExperience` → child panels.

---

## Regression Gate

```bash
node scripts/mission-bg-7l-domain-sync-validate.mjs
```

Validates:

- Hero reel routes to `[hero]` only
- Thumbnail/video reels include feed when appropriate
- WebSocket handler uses `syncDomain`, not `syncFromVault(true)`
- `syncHeroDomainOnly` does not call `reconcileThumbnailVault`
- Thumbnail reconcile gated behind `syncThumbnail`

---

## Rejected Alternatives (per architectural review)

| Proposal | Status |
|----------|--------|
| `skipThumbnailReconcile: true` flag | Rejected — symptom patch |
| Protect `personal_thumbnail_reel_ids` from ghost purge | Rejected — stale data |
| Change `normalizeReel()` contract | Rejected — large regression surface |

---

## Files Modified

- `src/lib/viewer/domainSync.js` (new)
- `src/viewer/viewerContext.js`
- `src/Viewer.svelte`
- `src/components/viewer/StudioLauncher.svelte`
- `src/components/experiences/StudioExperience.svelte`
- `src/components/experiences/VaultExperience.svelte`
- `src/components/studio/HeroManagerPanel.svelte`
- `src/lib/viewer/contentAgents.js`
- `src/lib/viewer/aiCleanupAgent.js`
- `src/lib/viewer/uiAgent.js`
- `scripts/mission-bg-7l-domain-sync-validate.mjs` (new)
