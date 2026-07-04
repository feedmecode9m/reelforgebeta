# PHASE 66 — HERO VAULT REGISTRY FORENSIC AUDIT

Mode: FORENSIC ONLY  
Scope: No fixes/refactors/features applied in this phase.

---

## [HERO_ACCEPT_PIPELINE]

### A) `handleHeroFileSelect()` trace

- **File**: `frontend/src/components/experiences/HeroExperience.svelte`
- **Function**: `handleHeroFileSelect(event)`
- **Call flow**:
  1. Reads selected file from input/drop.
  2. Classifies file with `isProbablyVideo(file)`.
  3. Writes pending state:
     - `heroPendingFile.set({ file, preview, name, size, type })`
     - `heroPreviewUrl.set(preview)`
  4. Updates status text (`uploadStatus`) for preview confirmation.
- **Registry impact**: none (no `heroAssetRegistry` write; no manager config write).

### B) `acceptHeroFile()` trace (image)

- **File**: `frontend/src/components/experiences/HeroExperience.svelte`
- **Function**: `acceptHeroFile()`
- **Call flow**:
  1. Reads `$heroPendingFile`.
  2. Builds `imageDataUrl`.
  3. Creates `heroAssetId` (`hero-image-${Date.now()}`).
  4. Writes stage stores:
     - `HERO_POSTER_IMAGE.set(imageDataUrl)`
     - `HERO_BACKGROUND_VIDEO.set('')`
  5. Persists config:
     - `saveHeroManagerConfig({ backgroundSource: 'custom_image', heroAssetId, backgroundStyle: 'image' })`
  6. Clears pending:
     - `heroPendingFile.set(null)`
     - `heroPreviewUrl.set(null)`

### C) `acceptHeroFile()` trace (video)

- **File**: `frontend/src/components/experiences/HeroExperience.svelte`
- **Function**: `acceptHeroFile()`
- **Call flow**:
  1. Reads `$heroPendingFile`.
  2. Validates file via `validateVideoFile(file)`.
  3. Builds `videoDataUrl`.
  4. Creates `heroAssetId` (`hero-video-${Date.now()}`).
  5. Writes stage store:
     - `HERO_BACKGROUND_VIDEO.set(videoDataUrl)`
  6. Persists config:
     - `saveHeroManagerConfig({ backgroundSource: 'custom_video', heroAssetId, backgroundStyle: 'video' })`
  7. Clears pending:
     - `heroPendingFile.set(null)`
     - `heroPreviewUrl.set(null)`

### D) `saveHeroManagerConfig()` and event/render path

- **File**: `frontend/src/lib/hero/heroIntelligence.js`
- **Function**: `saveHeroManagerConfig(patch)`
- **Effects**:
  - Writes `localStorage['reelforge_hero_manager_config']`.
  - Dispatches `window.dispatchEvent(new CustomEvent('reelforge:hero-manager-updated', { detail: next }))`.
- **Event consumers**:
  - `HeroExperience.svelte`: listens `reelforge:hero-manager-updated`, reloads manager config, reapplies background.
  - `viewerContext.js`: listens same event, runs `handleHeroManagerUpdated()`, reapplies hero background logic.

### E) Registry construction after accept

- **File**: `frontend/src/components/studio/HeroManagerPanel.svelte`
- Reactive source:
  - `$: heroAssetRegistry = buildHeroAssetRegistry(loadHeroVaultItems());`
- This is a computed view only; not a direct mutable store.

---

## [HERO_REGISTRY_WRITES]

`heroAssetRegistry` has **no direct writes** (no `set/update/push` on `heroAssetRegistry` symbol).  
It is recomputed from `loadHeroVaultItems()` output.

### Effective registry-entry creation points

1. **Hero vault item creation (image/video objects)**
   - **File**: `frontend/src/lib/hero/heroIntelligence.js`
   - **Function**: `loadHeroVaultItems()`
   - **Line range (approx)**: 733–773
   - **Write behavior**:
     - `items.push({ ...image entry... })` when `reelforge_hero_image` exists
     - `items.push({ ...video entry... })` when `reelforge_hero_video` exists

2. **Registry array assembly**
   - **File**: `frontend/src/lib/hero/heroAssetBridge.js`
   - **Function**: `buildHeroAssetRegistry(vaultItems)`
   - **Line range (approx)**: 109–121
   - **Behavior**:
     - Normalizes entries via `normalizeHeroAssetRecord()`
     - Dedupe by `assetId`
     - Returns computed normalized array

---

## [HERO_REGISTRY_READERS]

Readers/subscribers of registry output:

1. **Hero Manager dropdown**
   - **File**: `frontend/src/components/studio/HeroManagerPanel.svelte`
   - **Purpose**: render selectable hero assets and derive background source.
   - Usage:
     - `heroAssetRegistry.find(...)` in `handleHeroAssetChange()`
     - `{#each heroAssetRegistry as item (item.assetId)}` for dropdown options

2. **Config-save legacy resolver (indirect reader)**
   - **File**: `frontend/src/lib/hero/heroIntelligence.js`
   - **Purpose**: in `saveHeroManagerConfig()`, uses `buildHeroAssetRegistry(loadHeroVaultItems())` to backfill/migrate `heroAssetId` when absent.

No other component directly subscribes to `heroAssetRegistry` symbol.

---

## [HERO_REGISTRY_INSERTION]

Question: On user accept (image/video), is an object with `{assetId, assetType, label, preview, source}` explicitly inserted into `heroAssetRegistry`?

**Answer: NO (not directly).**

Evidence:
- `acceptHeroFile()` never writes `heroAssetRegistry`.
- Accept writes stores (`HERO_POSTER_IMAGE`, `HERO_BACKGROUND_VIDEO`) and manager config (`saveHeroManagerConfig()`).
- `heroAssetRegistry` is derived later from `loadHeroVaultItems()` + `buildHeroAssetRegistry()`.

Question: Does accept still result in registry entries?

**Answer: YES (indirectly), but shape/ID depends on `loadHeroVaultItems()` logic and current `backgroundSource`.**

Evidence:
- `loadHeroVaultItems()` creates items from hero localStorage keys.
- IDs are conditional:
  - image id = `heroAssetId` only when `backgroundSource === 'custom_image'`, else `'hero-image'`
  - video id = `heroAssetId` only when `backgroundSource === 'custom_video'`, else `'hero-video'`

---

## [HERO_VAULT_RENDER]

Exact UI block rendering Hero vault inventory:

- **Component**: `frontend/src/components/studio/HeroManagerPanel.svelte`
- **Block**:
  - `Vault Hero Asset` select
  - `{#each heroAssetRegistry as item (item.assetId)}`
- **Source store/computed list**:
  - `heroAssetRegistry` reactive value from:
    - `buildHeroAssetRegistry(loadHeroVaultItems())`

There is no separate card/grid-style Hero vault inventory component in current code; the inventory is rendered as dropdown options.

---

## [HERO_DROPDOWN_SOURCE]

Dropdown options originate from:

1. `loadHeroVaultItems()` (`heroIntelligence.js`)
   - Reads:
     - `localStorage['reelforge_hero_image']`
     - `localStorage['reelforge_hero_video']`
     - `loadHeroManagerConfig().heroAssetId` and `backgroundSource`
   - Produces raw item list

2. `buildHeroAssetRegistry()` (`heroAssetBridge.js`)
   - Normalizes raw items -> `{ assetId, assetType, mediaUrl, thumbnailUrl, ... }`

3. `HeroManagerPanel.svelte`
   - `heroAssetRegistry` reactive assignment and `{#each}` render

---

## [HERO_RUNTIME_COUNTS]

Runtime simulation artifact:
- `hero-vault-registry-runtime.json`
- Method: module-level simulation matching current accept persistence path.

### Counts observed

- **Before**
  - registry count: 2
  - dropdown options: 3
  - asset IDs: `hero-image`, `hero-video`

- **After simulated image accept**
  - registry count: 1
  - dropdown options: 2
  - asset IDs: `hero-image-audit-...` (accepted image ID present)

- **After simulated video accept**
  - registry count: 2
  - dropdown options: 3
  - asset IDs: `hero-image`, `hero-video-audit-...`

Key observation:
- After video accept, image entry ID reverts to generic `hero-image` rather than preserving accepted image asset ID.

---

## [ROOT_CAUSE]

A–E evaluation:

- **A. Accept never inserts into registry** -> **FALSE (indirect insertion occurs)**
  - Accept writes sources that registry derives from.

- **B. Registry inserts but render uses wrong source** -> **FALSE**
  - Render source is `heroAssetRegistry` itself in dropdown.

- **C. Registry inserts but sync clears it** -> **No evidence in this trace**
  - Registry derived from hero localStorage keys; not shown cleared by sync in this audit run.

- **D. Registry inserts but assetId mismatch prevents render** -> **TRUE (primary)**
  - `loadHeroVaultItems()` conditionally assigns generic IDs (`hero-image`/`hero-video`) when background source differs.
  - This causes accepted IDs to not consistently appear in dropdown identity.

- **E. Multiple competing Hero stores** -> **TRUE (secondary)**
  - Registry identity depends on:
    - `reelforge_hero_manager_config` (`heroAssetId`, `backgroundSource`)
    - `reelforge_hero_image`
    - `reelforge_hero_video`
  - ID mapping changes based on current source mode.

Conclusion:
- **Primary forensic root cause: D**
- **Contributing condition: E**

---

## STEP 9 — FIX PLAN ONLY (DO NOT IMPLEMENT)

### MINIMAL FIX
- File: `frontend/src/lib/hero/heroIntelligence.js`
- In `loadHeroVaultItems()`, keep stable asset IDs for both hero image and hero video entries (avoid fallback to generic IDs when source mode changes).

### SAFE FIX
- Files:
  - `frontend/src/lib/hero/heroIntelligence.js`
  - `frontend/src/components/studio/HeroManagerPanel.svelte`
- Ensure registry entry model is source-agnostic and always includes stable ID + label metadata for accepted assets.
- Keep dropdown rendering on same source, but avoid identity mutation across source toggles.

### RECOMMENDED FIX
- Files:
  - `frontend/src/lib/hero/heroIntelligence.js`
  - `frontend/src/lib/hero/heroAssetBridge.js`
  - `frontend/src/components/studio/HeroManagerPanel.svelte`
- Define deterministic Hero registry contract:
  - stable `assetId`
  - explicit `assetType`
  - stable display label
  - canonical media/preview mapping
- Preserve compatibility with current storage keys and manager config while removing ID-mode coupling.

