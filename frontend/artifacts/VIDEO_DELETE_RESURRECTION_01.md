# VIDEO-DELETE-RESURRECTION-01

**Mission:** Eliminate resurrection of deleted videos in `personal_video_vault` after refresh.

**Verdict:** PASS

| Step | Result |
|------|--------|
| R2 upload | PASS (`b9d746b6-6303-430d-93ac-0b1751030537`) |
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
3. `viewerContext.js` — `filterOutDeletedMedia` on video reload + `persistPersonalVault`; `syncFromVault(true, true)` on boot (forces backend video projection).

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

- **Production Netlify deploy:** pending (`NETLIFY_AUTH_TOKEN` not set in this environment). Build artifact: `dist/assets/index-CAYxiokM.js` (post-fix bundle).
- **Local verification:** `FRONTEND_URL=http://127.0.0.1:4173/ node scripts/video-delete-resurrection-01.mjs` with Playwright same-origin `/api` proxy (simulates Netlify `_redirects`).
- Frontend target: https://strong-lolly-a9fcb4.netlify.app/
- Backend: https://reelforge-deploy-production.up.railway.app
- Validated: 2026-07-24T04:49:51.520Z
- Evidence: `prunedLocal: 22 → reconciled: 22` after ghost inject + reload (`hydrateVaultFromReels:video_reconcile`); `resurrected=false` on post-delete refresh, second refresh, and browser restart.
