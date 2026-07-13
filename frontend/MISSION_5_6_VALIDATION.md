# MISSION 5.6 — Canonical Hero Identity Validation

Generated: 2026-07-13T06:33:08.456Z

## Result: PASS

| Check | Result |
|-------|--------|
| Restart backend | PASS |
| Restart frontend | PASS |
| Upload hero (UUID reel) | PASS |
| heroAssetId === reel.id | PASS |
| No duplicate legacy storage | PASS |
| Replace hero | PASS |
| Survive reload | PASS |
| Remove hero | PASS |
| Survive restart | PASS |
| Surface URL unity | PASS |

## Identity table

| Stage | id | fileName | url | heroAssetId | legacy image? | legacy video? | background src |
|-------|-----|----------|-----|-------------|---------------|---------------|----------------|
| after-upload | 2711170d-dd84-4bbb-841b-2cb05f9fde36 | 2711170d-dd84-4bbb-841b-2cb05f9fde36.png | /thumbs/2711170d-dd84-4bbb-841b-2cb05f9fde36.png | 2711170d-dd84-4bbb-841b-2cb05f9fde36 | no | no | — |
| after-upload-vault | 2711170d-dd84-4bbb-841b-2cb05f9fde36 | 2711170d-dd84-4bbb-841b-2cb05f9fde36.png | /thumbs/2711170d-dd84-4bbb-841b-2cb05f9fde36.png | 2711170d-dd84-4bbb-841b-2cb05f9fde36 | no | no | — |
| after-replace | 781391d1-6ef6-4aa9-ad06-52e373b2c89c | 781391d1-6ef6-4aa9-ad06-52e373b2c89c.png | /thumbs/781391d1-6ef6-4aa9-ad06-52e373b2c89c.png | 781391d1-6ef6-4aa9-ad06-52e373b2c89c | no | no | — |
| after-reload | 781391d1-6ef6-4aa9-ad06-52e373b2c89c | 781391d1-6ef6-4aa9-ad06-52e373b2c89c.png | /thumbs/781391d1-6ef6-4aa9-ad06-52e373b2c89c.png | 781391d1-6ef6-4aa9-ad06-52e373b2c89c | no | no | — |
| after-remove | — | — | — | — | no | no | — |
| after-restart | — | — | — | — | no | no | — |

## Investigation — Hero storage keys (pre-fix)

| Key / object | Role | Canonical? |
|--------------|------|------------|
| `reelforge_hero_reel` | **Single canonical reel** (id, fileName, url) | ✓ |
| `reelforge_hero_manager_config.heroAssetId` | Pointer to `reel.id` only | ✓ |
| `reelforge_hero_image` | Legacy duplicate URL/data | ✗ removed on save |
| `reelforge_hero_video` | Legacy duplicate URL/data | ✗ removed on save |
| `HERO_POSTER_IMAGE` store | Runtime render path (derived from reel.url) | presentation |
| `HERO_BACKGROUND_VIDEO` store | Runtime render path (derived from reel.url) | presentation |
| `heroPreviewUrl` store | Upload preview blob only | transient |
| `heroBackgroundState` | Video playback position | non-identity |

## Pipeline trace

| Stage | id | fileName | url | Changes |
|-------|-----|----------|-----|---------|
| Backend response | UUID | UUID.ext | /thumbs/UUID.ext | Set by API |
| acceptHeroFile | reel.id | reel.fileName | reel.url | Saves `reelforge_hero_reel` |
| saveHeroManagerConfig | heroAssetId=reel.id | — | — | Pointer only |
| loadHeroVaultItems | reel.id | reel.fileName | reel.url | Reads canonical reel |
| resolveHeroBackgroundAsset | reel.id | — | reel.url | id→fileName→url |
| Viewer / Banner / Featured | — | — | reel.url | All surfaces derive same path |

## Errors

None
