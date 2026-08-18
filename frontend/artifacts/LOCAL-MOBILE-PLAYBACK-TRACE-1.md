# LOCAL-MOBILE-PLAYBACK-TRACE-1

**Goal:** Identify where mobile play stops before any playback rewrite.  
**Scope:** Instrumentation + one chrome tap-blocker fix. No `playReel()` unification. No PLAY-2 rewrite.

## Canonical path (already exists — no duplicate `mobilePlay`)

```
ViewerSemanticCard (whole card = Play control; ▶ is decorative)
  → onActivate(reel)
  → ReelshortExperience.activateReel
  → onOpenTheater(reel)  [= viewerContext.handleCardClick]
  → openTheater → openTheaterReel
  → enrichReelForTheaterPlayback / resolveTheaterPlayback
  → activeReel + Theater <video>
  → autoplay and/or mobile Play chrome (PLAY-2 pointerup → startTheaterPlayback → video.play())
```

Desktop and mobile feed cards share this path. There is **no** separate `mobilePlay()` handler on semantic cards.

## Console contract

Filter: `[MOBILE_PLAY_TRACE]`

| Phase | Meaning if **missing** |
|-------|-------------------------|
| `CLICK` | Tap never reached the card (overlay / hit-test). Check `hitTop`. |
| `ACTIVATE_REEL` | Card fired but activateReel not called |
| `HANDOFF_ON_OPEN_THEATER` / `VIEWER_HANDLE_CARD_CLICK` | Feed → Viewer handoff broken |
| `VIEWER_OPEN_THEATER` / `OPEN_THEATER_REEL` | Theater open entry not reached |
| `OPEN_THEATER_REEL_ENRICH_FAILED` | Identity/URL enrich returned null |
| `OPEN_THEATER_REEL_AFTER_TICK` with `videoMounted: false` | Theater open but `<video>` not mounted |
| `THEATER_PLAY_POINTER_UP` | Theater chrome Play not receiving gesture |
| `START_THEATER_PLAYBACK` | Toggle ran but play() path not entered |
| `START_THEATER_PLAYBACK_DONE` `still-paused` | `play()` rejected or blocked |

Fields: `assetId`, `title`, `mediaUrl`, `resolver`, `viewerOpen`, `videoMounted`, `playCalled`, `source`, `hitTop`, `reason`.

## Surgical chrome fix (not playback)

Sticky discovery rail used `z-index: 8` with a full-bleed fade box that still captured pointer events over cards underneath. Rail container is now `pointer-events: none`; tabs/search are `pointer-events: auto`.

## Manual next step

1. Mobile (or DevTools device mode) → tap a feed card.  
2. Confirm phase sequence through `OPEN_THEATER_REEL_AFTER_TICK`.  
3. If Theater opens paused, tap Play → expect `THEATER_PLAY_POINTER_UP` → `START_THEATER_PLAYBACK`.  
4. Only then decide whether a `playReel()` consolidation is warranted.

## Validate

```bash
cd frontend && npm run validate:mobile-playback-trace && npm run build
```
