# LOCAL-THEATER-MOBILE-CHROME-1

Presentation only. Video element attach/play path unchanged.

## Baseline (production)

Video plays, landscape fills, mute and play/pause work. Remaining issue: chrome covering the picture.

## Change

| Layer | Change |
|-------|--------|
| Overlay | Play + Mute in a bottom safe-area pill |
| Behavior | Tap canvas toggles chrome; idle hide while playing; Play stays when paused |
| Native controls | Off on mobile (`controls={!isMobileTheater}`) so iOS bar does not cover the frame |
| Header | Fades with chrome; close/framing only when chrome is shown |
| Removed from canvas | Volume slider, bottom CLOSE THEATER, meta panel on mobile |

Untouched: `startTheaterPlayback`, `handleTheaterPlayPointerUp`, `<source>`, R2, derivatives.
