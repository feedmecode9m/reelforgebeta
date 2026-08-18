# LOCAL-MOBILE-PLAYBACK-FIX-B1

**Classification:** TRACE-2 Case B (activation handoff)  
**Do not touch:** MP4/R2, HTML5 `play()`, PLAY-2 chrome, autoplay policy

## Device evidence

```
CLICK ✅  resolver=ViewerSemanticCard.onActivate  viewerOpen=false
ACTIVATE_REEL ❌
OPEN_THEATER_REEL ❌
```

Hit-testing/overlays (Case A) ruled out. The tap reached the card.

## Why CLICK never became ACTIVATE_REEL

```
ViewerSemanticCard click
  → log CLICK
  → onActivate(reel)
      → activateReel()
          → logTheaterOpen()          ← ran first
              → recordTheaterOpen()
                  → recordMetric()
                      → crypto.randomUUID()  ← throws on iOS LAN HTTP
          → log ACTIVATE_REEL         ← never reached
          → onOpenTheater()           ← never reached
```

iPhone was on `http://10.0.0.115:5173`. That origin is **not a secure context**, so `crypto.randomUUID()` throws. Desktop `http://localhost:5173` is secure, which is why the same pipeline worked on desktop.

## Fix (handoff only)

1. Safe UUID fallback in `recordMetric` and `getOrCreateViewerId`
2. `logTheaterOpen` swallows diagnostics errors
3. `ACTIVATE_REEL` logs before diagnostics
4. `HANDOFF_INVOKE` / `HANDOFF_ERROR` around `onActivate`

## Re-verify on phone

Hard refresh `http://10.0.0.115:5173`, tap one card, expect:

```
CLICK
HANDOFF_INVOKE
ACTIVATE_REEL
VIEWER_HANDLE_CARD_CLICK
OPEN_THEATER_REEL
OPEN_THEATER_REEL_AFTER_TICK
```

If theater opens and video stays paused, that is Case D — a later milestone.
