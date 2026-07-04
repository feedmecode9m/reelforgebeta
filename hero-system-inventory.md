# Hero Background System Inventory

Phase: `HERO-FORENSIC-001`  
Scope: frontend forensic mapping only, no code fixes.

## 1) Implemented Hero Capabilities

### Discovery/selection capabilities
- Featured Release (`FEATURED_RELEASE`)
- Continue Watching (`CONTINUE_WATCHING`)
- Trending (`TRENDING`)
- Upcoming Premiere (`UPCOMING_PREMIERE`)
- Team Spotlight (`TEAM_SPOTLIGHT`)
- Studio Priority (`STUDIO_PRIORITY`)
- Legacy mode normalization (`UPCOMING_RELEASE`, `TEAM_PICK`, etc. map into current types)

### Background source capabilities
- Selection-driven background (`backgroundSource: selection`)
- Custom image override (`backgroundSource: custom_image`)
- Custom video override (`backgroundSource: custom_video`)
- Vault image asset binding via `backgroundAsset`
- Direct path binding for `backgroundImage` and `backgroundVideo`

### Carousel / rotation capabilities
- Carousel slide generation (`buildHeroCarouselSlides`)
- Slide types currently generated:
  - `video`, `image`, `featured_release`, `admin_image`, `admin_video`, `upcoming_release`, `team_spotlight`, `marketplace_spotlight`, `revenue_milestone`, `creator_spotlight`, `discovery_recommendation`, `sentinel_recommendation`
- Manual rotate now (`rotateHeroSelection`)
- Auto rotate timer (`startHeroRotation`) using `spotlightPriority`
- Slide-level enable/disable + duration + order overrides (`carouselSlideOverrides`)
- Carousel autoplay pause/resume and timeline controls in `HeroExperience.svelte`

### Visual treatment capabilities
- Background styles:
  - `image`
  - `video`
  - `ambient_motion`
  - `cinematic_blur`
  - `gradient_overlay`
- Transition styles:
  - `fade`
  - `cinematic_blur`
  - `slide`
  - `zoom`
- Overlay/gradient/motion classes:
  - `.hero-overlay`
  - `.hero-gradient`
  - `.hero-motion-gradient`
  - style-based classes from `resolveHeroBackgroundPresentation`

### Campaign and priority capabilities
- Seasonal campaign model (toggle + date range)
- Campaign can temporarily steer hero source selection
- Spotlight priority list exists and drives rotate order

### Persistence + telemetry capabilities
- Hero manager config persisted in `localStorage` key:
  - `reelforge_hero_manager_config`
- Hero background media persisted in:
  - `reelforge_hero_video`
  - `reelforge_hero_image`
- Hero playback-state persistence (`heroBackgroundState`) via `attachHeroPersistence`
- Diagnostics emitted:
  - `HERO_BACKGROUND_SAVE`
  - `HERO_ASSET_RESOLVE`
  - `HERO_RENDER` / `HERO_RENDER_SUCCESS` / `HERO_RENDER_FAILURE`
  - `HERO_TRANSITION`
  - `HERO_ROTATION`
  - `HERO_IMAGE_PIPELINE`

## 2) Dependencies and Configuration Paths

### Core modules
- `frontend/src/lib/hero/heroIntelligence.js`
- `frontend/src/components/experiences/HeroExperience.svelte`
- `frontend/src/components/studio/HeroManagerPanel.svelte`
- `frontend/src/viewer/viewerContext.js`
- `frontend/src/stores/heroStore.js`

### Storage dependencies
- Hero manager config: `reelforge_hero_manager_config`
- Hero media stores:
  - `reelforge_hero_video`
  - `reelforge_hero_image`
- Hero playback state:
  - `heroBackgroundState`
- Vault lookup dependencies used by hero resolver:
  - `personal_video_vault`
  - `personal_thumbnails`

### Event dependencies
- `reelforge:hero-manager-updated`
- `reelforge:hero-intelligence-updated`
- `reelforge:metrics-updated`
- `reelforge:release-schedule-updated`

## 3) Persistence Path Map

- UI change in `HeroManagerPanel` -> `updateHeroManagerConfig`/`saveHeroManagerConfig` -> writes `reelforge_hero_manager_config` -> emits `reelforge:hero-manager-updated` -> viewer + hero stage apply updates.
- Hero media stores (`HERO_BACKGROUND_VIDEO`, `HERO_POSTER_IMAGE`) are mirrored to `reelforge_hero_video` / `reelforge_hero_image` via subscriptions in `viewerContext`.
- On mount, `hydrateHeroBackgroundStores` attempts restore in order:
  1) persisted image (`reelforge_hero_image`)
  2) manager custom config
  3) persisted video (`reelforge_hero_video`)
  4) server default video (`/videos/hero-background.mp4`)

## 4) Render Path Map

- Manager config -> `resolveHeroBackgroundPresentation` -> `resolveHeroBackgroundAsset`
- Presentation + active slide -> `heroSlideVideo` / `heroSlideImage`
- Render branches in `HeroExperience.svelte`:
  - Video renderer (`MediaRenderer`) for video path
  - Poster renderer (`MediaPoster`) for image path
  - Gradient fallback div when neither resolves

## 5) Failure Path Inventory

- **Vault lookup authority risk**: hero asset resolution reads vault from localStorage (`personal_video_vault`, `personal_thumbnails`) and can use stale entries.
- **Custom override drift risk**: rotation changes `heroType`; background handling depends on `backgroundSource` and active slide composition.
- **Custom image/video visual override risk**: carousel slide data can change displayed media context even when manager is set to custom.
- **Admin-gated controls risk**: Hero Manager panel is under studio/control-center + admin path, making settings unreachable in non-admin sessions.
- **Fallback masking risk**: missing video/image may visually degrade to gradient fallback without explicit user-facing hard failure.

## 6) Hero Vault Integration Matrix (Forensic)

Legend: PASS = implemented and traceable in code path; FAIL = missing or blocked behavior.

| Asset Type | Upload | Assign to Hero | Apply | Refresh | Rotate | Restart | Result |
|---|---|---|---|---|---|---|---|
| jpg | PASS (image branch) | PASS (custom image + vault image) | PASS | PASS (localStorage-backed) | PARTIAL (carousel can alter presentation) | PASS | PARTIAL |
| png | PASS | PASS | PASS | PASS | PARTIAL | PASS | PARTIAL |
| webp | PASS | PASS | PASS | PASS | PARTIAL | PASS | PARTIAL |
| gif | PASS (image MIME) | PASS (image path) | PASS | PASS | PARTIAL | PASS | PARTIAL |
| mp4 | PASS (video upload + validator) | PARTIAL (custom video path yes; vault video picker missing) | PASS | PASS | PARTIAL (rotation/carousel interactions) | PASS | PARTIAL |

## 7) Hero UI Audit Snapshot

Captured artifacts:
- `hero-manager-overview.png`
- `hero-manager-studio-region.png`

Observed:
- `HeroManagerPanel` DOM selector (`[data-hero-manager-panel]`) was not reachable in the captured unauthenticated/automation session.
- This aligns with admin/control-center gating in `StudioExperience.svelte` (`$controlCenterOpen` + `$adminMode` guarded sections).

Missing/hidden/unreachable controls (for current UX state):
- Hero manager controls are effectively hidden when not in admin mode.
- No explicit UI control for selecting a **vault video asset** by ID/name in Hero Manager (only vault image selector is present).

Requested enhancements (documented only, not implemented):
- Hero Playlist
- Image Carousel
- Mixed Video + Image Carousel
- Upcoming Events Overlay editor
- Release Countdown editor
- Featured Creator Banner slot
- Sponsor Banner slot
- Seasonal Campaign Manager (expanded controls, campaign type + targeting)

