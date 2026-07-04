# Hero Render Flow

Audited functions:
- `resolveHeroBackgroundPresentation()`
- `resolveHeroBackgroundAsset()`
- `applyHeroManagerBackground()`
- `HeroExperience.svelte` render branches

## 1) Resolve Chain

1. `HeroExperience` loads manager config (`loadHeroManagerConfig()`).
2. Reactive presentation state is produced by `resolveHeroBackgroundPresentation(config)`.
3. Presentation delegates media resolution to `resolveHeroBackgroundAsset(config, vaultItems)`.
4. On manager updates, `applyHeroManagerBackground(config, stores)` mutates:
   - `HERO_BACKGROUND_VIDEO`
   - `HERO_POSTER_IMAGE`
   - `heroVideoFailed`

## 2) Asset Resolution Logic

`resolveHeroBackgroundAsset()` lookup order:
- by `backgroundAsset` in vault items (`id`, `name`, URL contains)
- by direct `backgroundVideo` URL match in vault
- by direct `backgroundImage` URL match in vault

Branching by source:
- `custom_video`:
  - prefers matched vault `url`, else direct `backgroundVideo`
  - optional poster from vault thumbnail
- `custom_image`:
  - prefers matched vault thumbnail/url, else direct `backgroundImage`
- `selection`:
  - only uses vault match if present; otherwise leaves empty and selection pipeline is used elsewhere

Vault item authority used here:
- `loadHeroVaultItems()` reads localStorage keys:
  - `personal_video_vault`
  - `personal_thumbnails`

## 3) Presentation Model

`resolveHeroBackgroundPresentation()` returns:
- style flags (`ambientMotion`, `cinematicBlur`, `gradientOverlay`)
- booleans (`useVideo`, `useImage`)
- resolved URLs (`videoUrl`, `imageUrl`)
- source metadata (`backgroundSource`, `backgroundAsset`, `assetType`, `vaultMatch`)

## 4) HeroExperience Render Branches

Effective render values:
- `heroRenderVideo`:
  - custom video URL when source is `custom_video`
  - otherwise fallback to `$HERO_BACKGROUND_VIDEO` unless custom image mode suppresses
- `heroRenderImage`:
  - custom image URL when source is `custom_image`
  - otherwise fallback to `$HERO_POSTER_IMAGE`

Final stage branch:
- **Video path:** `MediaRenderer` with `type="video"` when `heroSlideVideo` exists and source is not `custom_image`.
- **Image path:** `MediaPoster` when image exists and source is not `custom_video`.
- **Fallback path:** gradient fallback `<div class="hero-fallback-image hero-gradient hero-gradient-fallback active">`.

Loading placeholder path:
- While video is loading/restoring, renders `MediaPoster` placeholder with loading text.

## 5) Path Classification Requested in Audit

### Image path
- `custom_image` -> `resolveHeroBackgroundAsset().imageUrl` -> `heroRenderImage` -> `MediaPoster`
- or slide image (`activeHeroSlide.imageUrl`) when carousel is active

### Video path
- `custom_video` -> `resolveHeroBackgroundAsset().videoUrl` -> `heroRenderVideo` -> `MediaRenderer`
- or slide video (`activeHeroSlide.videoUrl`) based on active carousel slide

### Fallback path
- No resolvable media / failed conditions -> gradient fallback block

### Placeholder path
- Video render branch before `loadeddata` or during restore -> poster placeholder + loading indicator

## 6) Render Failure Paths

- Missing/invalid URL in custom source -> fallback gradient.
- `heroVideoFailed` true -> video branch suppressed, fallback behavior activated.
- Local vault mismatch (stale `backgroundAsset` reference) -> unresolved media URL.
- Source conflict: custom source + autoplay slide context can produce mixed visual expectations.

