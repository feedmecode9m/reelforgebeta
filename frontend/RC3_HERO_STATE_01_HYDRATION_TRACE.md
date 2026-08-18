# MISSION RC3-HERO-STATE-01 — Hero Registry Hydration Trace

**Status:** Evidence only  
**Baseline:** RC1-2026-07-19-POST-08C + RC2 MP4 Acceptance PASS  
**Out of scope:** upload transport, reconnect, thumbnails, 08A/08B/08C reopen

## Goal

Identify the **first place** a valid hero asset disappears (or is already absent) on the path:

```
localStorage
  → hero manager config
  → hero reel
  → loadHeroVaultItems()
  → buildHeroAssetRegistry()
  → resolveHeroBackgroundAsset()
  → HeroExperience / viewer render
```

## Static gates (source)

`loadHeroVaultItems()` (`heroIntelligence.js`):

1. `loadHeroReel()` missing `id` or `url` → `[]`
2. `manager.heroAssetId !== reel.id` → `[]`
3. else → `[heroReelToVaultItem(reel)]`

Default manager: `backgroundSource: "selection"`, `heroAssetId: ""`  
Viewer default fallback: `/videos/hero-background.mp4`

## Passes

| Pass | Setup |
|------|--------|
| A | Cold boot, all hero keys cleared |
| B | Seed matched `reelforge_hero_reel` + `heroAssetId`, hard reload |
| C | Seed reel + **mismatched** `heroAssetId`, hard reload |

## Run

```bash
cd frontend
node scripts/mission-rc3-hero-state-01.mjs
```

Artifact: `frontend/artifacts/rc3-hero-state-01.json`

## Result (2026-07-20)

**Verdict:** `EMPTY_AT_LOCALSTORAGE_BOOT`

| Pass | Result |
|------|--------|
| A cold boot | `heroAssetId=""`, `vaultItemsCount=0` — empty at localStorage |
| B matched seed + reload | Hydration **preserves** asset (`vaultItemsCount=1`, DOM plays seeded MP4) |
| C id mismatch | `loadHeroVaultItems()` returns `[]` — gate proven |

Also measured: `GET /videos/hero-background.mp4` → **404**; `GET /hero-background.mp4` → **200**.
