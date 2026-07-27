# VIDEO-DELETE-RESURRECTION-01

**Mission:** Eliminate resurrection of deleted videos in `personal_video_vault` after refresh.

**Verdict:** PASS

| Step | Result |
|------|--------|
| R2 upload | PASS (`e296e21b-e03c-45df-b6d9-31236e439332`) |
| Refresh persists vault | PASS |
| Hard refresh (informational) | PASS |
| API DELETE + catalog gone | PASS |
| Post-delete refresh (no resurrection) | PASS (resurrected=false) |
| Second refresh | PASS |
| Browser restart | PASS |

## Root cause

`hydrateVaultFromReels()` merged stale `personal_video_vault` rows with backend catalog entries on every bootstrap reload. Deleted reel ids absent from `GET /api/reels` were kept from localStorage, resurrecting ghosts after API-only deletes (no browser tombstone).

## Patch (smallest scope)

1. `deletionSync.js` — `pruneGhostVideoVaultEntries()` + `isPendingLocalVideoVaultEntry()` (keeps blob: in-flight uploads).
2. `mediaBootstrap.js` — bootstrap video reconcile: backend catalog wins; prune local ghosts before persist.
3. `viewerContext.js` — `filterOutDeletedMedia` on video reload + `persistPersonalVault`.

**Not modified:** thumbnailVault, hero pipeline, signed upload, Railway routes, thumbnail hydration.

## Lifecycle trace

```
DELETE /api/reels/{id}  →  catalog row removed (backend correct)
       ↓
page reload  →  bootstrapMediaFromBackend()
       ↓
hydrateVaultFromReels  →  GET /api/reels (deleted id absent)
       ↓
[BUG] merge local + backend  →  stale id re-written to personal_video_vault
       ↓
[FIX] pruneGhostVideoVaultEntries  →  drop ids not in catalog; persist reconciled vault
       ↓
onMount reads LS  →  syncFromVault reinforces backend projection
```

## Production

- Frontend: http://127.0.0.1:4173/
- Backend: https://reelforge-deploy-production.up.railway.app
- Validated: 2026-07-27T15:35:10.165Z


Raw JSON: `artifacts/video-delete-resurrection-01.json`
