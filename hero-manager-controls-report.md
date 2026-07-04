# Hero Manager Controls Report

Audited file: `frontend/src/components/studio/HeroManagerPanel.svelte`

## Control Inventory

| Control | Config Field / Storage Key | Default | Expected Behavior | Actual Behavior (from code trace) |
|---|---|---|---|---|
| Hero Type | `heroType` in `reelforge_hero_manager_config` | `TRENDING` | Choose discovery mode for hero selection | `applyConfig()` writes config and recomputes selection. |
| Background Source | `backgroundSource` in manager config | `selection` | Switch between selection/custom image/custom video authority | Applies immediately; custom modes route through `applyHeroManagerBackground`. |
| Background Style | `backgroundStyle` in manager config | `video` | Toggle visual treatment (image/video/blur/motion/gradient) | Applied through presentation resolver and CSS class mapping. |
| Background Video | `backgroundVideo` in manager config | `/videos/hero-background.mp4` | Direct video URL override | Text input accepts raw path, applied on change. |
| Background Image | `backgroundImage` in manager config | `''` | Direct image URL override | On change, forcibly clears `backgroundAsset` then applies. |
| Vault Image Asset | `backgroundAsset` in manager config | `''` | Pick vault asset to bind hero image | Selector filters to image-like vault entries only; no video asset selector. |
| Auto Rotate | `autoRotate` in manager config | `false` | Enable periodic hero type rotation | Starts/stops timer via `updateHeroManagerConfig` -> `startHeroRotation`/`stopHeroRotation`. |
| Carousel Autoplay | `autoplayEnabled` in manager config | `true` | Auto-advance hero carousel slides | `HeroExperience` timer honors this; pause/resume controls exist. |
| Rotate Every (sec) | `rotateIntervalMs` in manager config | `30000` | Rotation interval for hero type cycling | Enforced min 10s in UI and timer setup. |
| Carousel Duration (sec) | `carouselDurationMs` in manager config | `8000` | Base slide duration | Enforced min 3s in UI; slide override can supersede per slide. |
| Carousel Priority | `carouselPriority` in manager config | `video` | Promote selected slide type | Rank logic sets preferred type to highest precedence. |
| Transition Style | `carouselTransitionStyle` in manager config | `fade` | Transition animation style | Applied as class flags on hero background container. |
| Hero Typography | `heroTypography` in manager config | `cinematic` | Hero title typography profile | Applied via `hero-typography--*` class in stage markup. |
| Spotlight Priority (list only) | `spotlightPriority` in manager config | Discovery type order | Define rotation order | Display-only in panel; not directly editable in this UI. |
| Slide Enabled toggle | `carouselSlideOverrides[].enabled` | `true` | Include/exclude slide type | Works; filtered during `buildHeroCarouselSlides`. |
| Slide Duration | `carouselSlideOverrides[].durationMs` | `8000` | Per-slide duration override | Works; min 2500ms enforced in logic. |
| Slide Up/Down | `carouselSlideOverrides[].order` | index+1 | Reorder slide precedence | Works; reorders array and persists through apply. |
| Seasonal campaign checkbox | `seasonalCampaigns[].active` | all false | Activate one campaign at a time | Toggle logic sets selected active and deactivates others. |
| Seasonal schedule start/end | `seasonalCampaigns[].scheduleStart/.scheduleEnd` | `''` | Date-bounded campaign activation | Persisted in config; active campaign used during selection. |
| Apply Hero Settings button | n/a (`applyConfig`) | n/a | Commit all panel edits | Executes update flow; status message updated. |
| Rotate Now button | n/a (`rotateHeroSelection`) | n/a | Manual one-step rotate | Rotates hero type and refreshes local panel state. |

## Persistence Audit (Part 3)

Traced functions:
- `saveHeroManagerConfig()`
- `loadHeroManagerConfig()`
- `viewerContext` subscriptions for `HERO_BACKGROUND_VIDEO` / `HERO_POSTER_IMAGE`
- `hydrateHeroBackgroundStores()`

Persistence outcomes:
- **Refresh:** survives (manager config + hero keys in localStorage are rehydrated).
- **Frontend restart:** survives in same browser profile (localStorage-backed).
- **Backend restart:** generally survives for persisted URLs/assets; may fail if media paths no longer resolve server-side.
- **Rotation:** survives config-wise; visual presentation may shift due carousel/rotation interplay.
- **Sync (`syncFromVault`)**: does not directly overwrite manager config, but vault cache inputs used by resolver can influence asset resolution if stale.

Key storage paths:
- `reelforge_hero_manager_config` (manager object)
- `reelforge_hero_video` (video URL/path)
- `reelforge_hero_image` (poster URL/data URL)
- `heroBackgroundState` (playback continuity only; not asset authority)

## Control-Level Risks

- No direct panel control for vault video selection by asset ID/name.
- Spotlight priority is shown but not editable in panel.
- Custom background presentation can be affected by carousel slide context during autoplay/rotation.
- Manager resolver reads vault from localStorage (`personal_video_vault`, `personal_thumbnails`), so stale cache can bias resolution.

