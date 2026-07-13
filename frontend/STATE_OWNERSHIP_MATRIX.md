# MISSION BG-1 — State Ownership Matrix

**Date:** 2026-07-13  
**Skill:** `reelforge-build-governance`  
**Principle:** Each state domain must have one owner. Duplicate writers are flagged.

---

## Summary

| Domain | Declared owner | Duplicate writers flagged | Risk |
|--------|---------------|---------------------------|------|
| Hero | `heroReelIdentity.js` + `heroIntelligence.js` | **Yes** — `viewerContext.js`, `HeroExperience.svelte` | Medium |
| Thumbnail | `thumbnailVault.js` | **Yes** — `viewerContext.js` reload path | Medium |
| Video | `viewerContext.js` (`personal_video_vault`) | **Yes** — `mediaBootstrap.js` | Medium |
| Feed | `aiCleanupAgent.js` (mutations) | **Yes** — multiple `feed.update` callers | High |

---

## Hero State

### Canonical storage keys

| Key | Purpose |
|-----|---------|
| `reelforge_hero_reel` | Canonical hero reel identity (`heroReelIdentity.js`) |
| `reelforge_hero_manager_config` | Hero manager selection/config (`heroIntelligence.js`) |
| `reelforge_hero_video` | **Legacy** — migrated to `reelforge_hero_reel` |
| `reelforge_hero_image` | **Legacy** — migrated to `reelforge_hero_reel` |

### Single owner (declared)

| Module | Responsibility |
|--------|----------------|
| `src/lib/hero/heroReelIdentity.js` | `saveHeroReel`, `loadHeroReel`, `clearHeroReel` |
| `src/lib/hero/heroIntelligence.js` | `saveHeroManagerConfig`, `loadHeroManagerConfig`, `resolveHeroBackgroundPresentation`, `applyHeroManagerBackground` |

### Runtime stores (derived, not persisted alone)

| Store | Module |
|-------|--------|
| `HERO_BACKGROUND_VIDEO` | `viewerContext.js` writable |
| `HERO_POSTER_IMAGE` | `viewerContext.js` writable |
| `heroSelection` | `viewerContext.js` writable |

### Path matrix

| Path | Read | Write |
|------|------|-------|
| **Startup** | `viewerContext.js` onMount → `loadHeroReel`, `loadHeroManagerConfig`, `hydrateHeroBackgroundStores` | `applyHeroManagerBackground` → `HERO_BACKGROUND_VIDEO.set` |
| **Upload** | `HeroExperience.svelte` → upload response | `saveHeroReel` + `saveHeroManagerConfig` + `HERO_BACKGROUND_VIDEO.set` |
| **Delete** | Hero manager clear actions | `clearHeroReel`, `saveHeroManagerConfig` patch |
| **Reload** | `loadHeroReel`, `loadHeroManagerConfig` from localStorage | `migrateLegacyHeroStorageIfNeeded` |

### Duplicate writers (FLAGGED)

| Writer | File | What it writes | Violation |
|--------|------|----------------|-----------|
| `HERO_BACKGROUND_VIDEO.set` | `viewerContext.js` | Runtime store + legacy key side effects via subscribe | Parallel to `applyHeroManagerBackground` |
| `HERO_BACKGROUND_VIDEO.set` | `HeroExperience.svelte` | Direct store mutation after upload | Should flow through `saveHeroReel` → `applyHeroManagerBackground` only |
| `setVideo` / `setPoster` callbacks | `viewerContext.js` `getHeroBackgroundStores()` | Exposed mutators on hero stores | Bypasses `heroIntelligence` resolver |
| Legacy keys | `viewerContext.js` subscribe handlers | Clears `reelforge_hero_video` on empty | Legacy path still active |

### Read paths

- `heroIntelligence.js` → `loadHeroVaultItems`, `resolveHeroBackgroundAsset`
- `HeroExperience.svelte` → `resolveHeroBackgroundPresentation`
- `viewerContext.js` → `hydrateHeroBackgroundStores`, HEAD probe on `CONFIG.HERO_VIDEO_PATHS`

---

## Thumbnail State

### Canonical storage keys

| Key | Purpose |
|-----|---------|
| `personal_thumbnails` | **Source of truth** (metadata array) |
| `personal_thumbnail_index` | Mirror index — written only by `writeThumbnailVault` |

### Single owner (declared)

| Module | Responsibility |
|--------|----------------|
| `src/lib/viewer/thumbnailVault.js` | `writeThumbnailVault`, `appendThumbnailVaultEntry`, `deleteThumbnailVaultEntries`, `reconcileThumbnailVault` |
| `src/lib/storage.js` | `storeThumbnailMetadata` (guarded), `guardPersonalThumbnailsWrite` |

### Derived store (not authoritative)

| Store | Module |
|-------|--------|
| `personalThumbnailCollection` | `viewerContext.js` — derived via `syncCollectionStore` only |

### Path matrix

| Path | Read | Write |
|------|------|-------|
| **Startup** | `readThumbnailVault` → `reloadVaultStoresFromStorage` → `syncCollectionStore` | `writeThumbnailVault` in reload when filtering hero assets |
| **Upload** | `VaultExperience.svelte` | `appendThumbnailVaultEntry` → `writeThumbnailVault` |
| **Delete** | `VaultExperience.svelte` | `deleteThumbnailVaultEntries` → `writeThumbnailVault` |
| **Reload** | `readThumbnailVault` | `syncCollectionStore` (derived only) |

### Duplicate writers (FLAGGED)

| Writer | File | What it writes | Violation |
|--------|------|----------------|-----------|
| `writeThumbnailVault` | `viewerContext.js` `reloadVaultStoresFromStorage` | Filters + rewrites `personal_thumbnails` on reload | Secondary writer outside vault reconcile API |
| `writeThumbnailVault([], ...)` | `viewerContext.js` demo/clear paths | Clears vault | Should use `deleteThumbnailVaultEntries` or vault reconcile |
| `personalThumbnailCollection.set` | `viewerContext.js` `setPersonalThumbnailCollection` | Direct collection mutation | Allowed only as derived sync; traced but risky |
| `upgradeThumbnailVaultFromBackendReels` | `mediaBootstrap.js` → `thumbnailVault.js` | Upgrade-only path | **Not** a violation if local vault non-empty (read-not-create) |

### Read paths

- `thumbnailVault.js` → `readThumbnailVault`
- `viewerContext.js` → `syncFromVault`, `reloadVaultStoresFromStorage`
- `VaultExperience.svelte` → renders `personalThumbnailCollection`

---

## Video State

### Canonical storage key

| Key | Purpose |
|-----|---------|
| `personal_video_vault` | Video vault metadata array |

### Single owner (declared)

| Module | Responsibility |
|--------|----------------|
| `src/viewer/viewerContext.js` | Primary read/write via `safeLocalStorageSet`, `storageSet`, `personalVideos` store |

### Path matrix

| Path | Read | Write |
|------|------|-------|
| **Startup** | `localStorage.getItem(VIDEO_VAULT_KEY)` → `bootstrapMediaFromBackend` | `mediaBootstrap.hydrateVaultFromReels` → `safeStorageSet` |
| **Upload** | `VaultExperience.svelte` / upload handlers | `viewerContext.js` insert + `distributeVideoToFeed` |
| **Delete** | Vault UI + cleanup agent | `aiCleanupAgent` + vault handlers |
| **Reload** | `reloadVaultStoresFromStorage` | `personalVideos.set` from storage |

### Duplicate writers (FLAGGED)

| Writer | File | What it writes | Violation |
|--------|------|----------------|-----------|
| `safeStorageSet(videoVaultKey, merged)` | `mediaBootstrap.js` `hydrateVaultFromReels` | Merges API reels into vault | Parallel bootstrap writer |
| `storageSet(VIDEO_VAULT_KEY, [])` | `viewerContext.js` | Clears vault on demo path | Secondary clear path |
| `safeLocalStorageSet` | `viewerContext.js` | Filtered video writes | Primary — OK |
| `aiCleanupAgent` | `aiCleanupAgent.js` | Reads/writes vault during cleanup | Maintenance writer |

### Read paths

- `viewerContext.js` → `personalVideos`, `personalVideoCollection`
- `mediaBootstrap.js` → `readVaultJson`, `hasLocalMediaCache`
- `VaultExperience.svelte` → video grid render

---

## Feed State

### Canonical storage key

| Key | Purpose |
|-----|---------|
| `reelforge_feed` | Persisted category → reel[] map |

### Single owner (declared)

| Module | Responsibility |
|--------|----------------|
| `src/lib/viewer/aiCleanupAgent.js` | `syncThumbnailsToFeed`, `distributeVideoToFeed` (primary mutations) |
| `src/viewer/viewerContext.js` | Owns `feed` writable store |

### Path matrix

| Path | Read | Write |
|------|------|-------|
| **Startup** | `feed` store init + `syncThumbnailsToFeed` after bootstrap | `aiCleanupAgent.syncThumbnailsToFeed` |
| **Upload** | `distributeVideoToFeed` | `aiCleanupAgent` + `viewerContext` upload handler |
| **Delete** | `aiCleanupAgent` purge | `feed.update` filter by id |
| **Reload** | `localStorage reelforge_feed` via `safeStorageSet` | `syncThumbnailsToFeed` rebuild |

### Duplicate writers (FLAGGED)

| Writer | File | What it writes | Violation |
|--------|------|----------------|-----------|
| `feed.set(demoFeed)` | `viewerContext.js` | Demo placeholder feed | Overwrites catalog-derived feed |
| `feed.set(prunedFeed)` | `viewerContext.js` | Prune on maintenance | Secondary |
| `feed.update` | `VaultExperience.svelte` | Force refresh | UI-triggered mutation |
| `feed.update` | `StudioExperience.svelte` | Admin refresh | UI-triggered mutation |
| `feed.update` | `uiAgent.js` | Category rename | UI-triggered mutation |
| `feed.update` | `aiCleanupAgent.js` | Multiple cleanup paths | Primary — OK |
| `feed.update` | `deletionSync.js` | Delete sync | Secondary sync path |
| Discovery engines | `discoveryFeedEngine.js`, etc. | **Read-only** `reelforge_feed` | OK |

### Read paths

- `viewerContext.js` → `feed` store
- `aiCleanupAgent.js` → reads vault + backend for merge
- Discovery/search modules → read `reelforge_feed` (no writes)

---

## Call Graph (simplified)

### Thumbnail upload

```text
VaultExperience.svelte
  → appendThumbnailVaultEntry (thumbnailVault.js)
    → writeThumbnailVault
      → storeThumbnailMetadata (storage.js)
        → localStorage personal_thumbnails
  → syncCollectionStore
    → personalThumbnailCollection (derived)
  → aiCleanupAgent.syncThumbnailsToFeed
    → feed.update
```

### Video upload

```text
VaultExperience / viewerContext upload handler
  → POST /api/reels (ingestion)
  → personal_video_vault write (viewerContext)
  → aiCleanupAgent.distributeVideoToFeed
    → feed.update
```

### Hero selection

```text
HeroExperience.svelte upload
  → saveHeroReel (heroReelIdentity.js)
  → saveHeroManagerConfig (heroIntelligence.js)
  → HERO_BACKGROUND_VIDEO.set (viewerContext)  ⚠ duplicate
  → applyHeroManagerBackground (heroIntelligence.js)
    → HeroExperience render
```

### Startup bootstrap

```text
viewerContext onMount
  → bootstrapMediaFromBackend (mediaBootstrap.js)
    → GET /api/reels
    → hydrateVaultFromReels (video write ⚠)
    → upgradeThumbnailVaultFromBackendReels (thumbnail notify)
  → reloadVaultStoresFromStorage
    → writeThumbnailVault (⚠ duplicate)
  → hydrateHeroBackgroundStores
  → syncThumbnailsToFeed
```

---

## Duplicate Writer Priority

| Priority | Domain | Issue |
|----------|--------|-------|
| P1 | Feed | 6+ modules call `feed.update` / `feed.set` |
| P2 | Hero | Runtime store writes bypass `heroIntelligence` resolver |
| P3 | Thumbnail | `viewerContext.reloadVaultStoresFromStorage` rewrites vault |
| P4 | Video | `mediaBootstrap` merges into `personal_video_vault` independently |

---

## Audit Constraints

- Documentation only — no ownership repairs implemented
- For thumbnail forensic repair workflow see `.cursor/skills/reelforge-state-forensics/SKILL.md`
