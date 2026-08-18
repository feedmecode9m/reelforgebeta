# LOCAL-MOBILE-PLAYBACK-TRACE-4

**Classification:** Case D — video readiness / startup after Theater mount  
**Do not touch:** MP4 pipeline, R2, derivatives, PLAY-2 architecture

## Proven

```
CLICK → … → OPEN_THEATER_REEL_AFTER_TICK
theaterNode=true  videoMounted=true  viewerOpen=true
videoReadyState=0  videoPaused=true
THEATER_PLAY_POINTER_UP playCalled=true
```

Handoff (Case B) is closed. The element exists; it has not become ready.

## What this pass captures

Each `[MOBILE_PLAY_TRACE]` row now includes:

* `currentSrc` — what the element selected
* `srcAttr` — `video[src]`
* `sourceSrc` — `<source src>`
* `networkState` — 0 empty / 1 idle / 2 loading / 3 no source
* `mediaErrorCode` / `mediaErrorMessage`
* `preload` / `hasSourceChild`

New phases:

| Phase | When |
|-------|------|
| `VIDEO_MOUNT` | Theater `<video>` action mount |
| `VIDEO_READY_POLL` | +1s after mount (did metadata arrive?) |
| `VIDEO_LOADED_METADATA` | `loadedmetadata` |
| `VIDEO_CANPLAY` | `canplay` |
| `VIDEO_ERROR` | media error |
| `VIDEO_LOAD_CALL` | `load()` because `currentSrc` empty with `<source>` |
| `PLAY_RESULT` | `play()` fulfilled |
| `PLAY_REJECT` | `play()` rejected |

## How to read the next phone tap

1. Hard refresh `http://10.0.0.115:5173`
2. Tap a card, then Play if Theater stays paused
3. Classify from the new fields — then fix only that layer
