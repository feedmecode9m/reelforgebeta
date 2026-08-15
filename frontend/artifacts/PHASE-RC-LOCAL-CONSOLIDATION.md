# PHASE-RC-LOCAL-CONSOLIDATION

**Mission type:** Validation only  
**When:** 2026-08-15T02:27Z  
**Frontend:** http://127.0.0.1:5173  
**Local build bundle:** `dist/assets/index-BEiDgrWY.js`  
**Dev runtime:** Vite `src/main.js`

```
PHASE-RC-LOCAL-CONSOLIDATION

Gate 1:
PASS

Gate 2:
PASS

Gate 3:
PASS

Gate 4:
PASS

Gate 5:
PASS

Gate 6:
PASS

Regression found:
NO

Code changes:
NONE

Commit:
NOT CREATED

Deploy:
NOT RUN
```

Supporting unit validators (unchanged sources): Phase 6.6.2 PASS, PHASE-HERO-LOCK-1 PASS.

JSON: `frontend/artifacts/PHASE-RC-LOCAL-CONSOLIDATION.json`

---

## Gate 1 — Fresh local runtime

Application HTTP 200 after hard refresh. **0 page exceptions.**

Non-blocking noise (not treated as product regression): Vite HMR `wss://127.0.0.1` refused (tunnel clientPort 443 in dev), some 401s before Studio auth, missing thumbs for older local fixture IDs.

## Gate 2 — Viewer identity + cards

| Shelf | Cards | Titles | Dupes | IMG_/UUID |
|-------|-------|--------|-------|-----------|
| Featured | 1 | `01 ARRIVAL OPEN v1` (1) | 0 | 0 |
| Trending | 7 | one title each | 0 | 0 |
| Browse | 0 residual | — | 0 | 0 |

Featured/Trending may share Arrival as intentional promo remount. No MP4+thumb twins, no filename titles.

## Gate 3 — Vault MP4

Vault 7 → 8. Hero stayed `fdc0295a-…`. No filename-title leak. New MP4 did **not** become Hero.

## Gate 4 — Hero protection + replace + timeout

- Vault did not change Hero (refresh held `fdc0295a-…`).
- Explicit Replace: `fdc0295a-…` → `f33e55ff-…`; refresh kept replacement.
- Timeout + late 200: UI `preview_pending`; Hero remained `f33e55ff-…` (not the late fake id).

## Gate 5 — Studio

Studio, Media Vault drop, Replace Hero visible. Tabs responded. **0** `#each` duplicate-key errors. **0** new page exceptions. `GET /api/reels` during studio window: 10 (below storm threshold).

## Gate 6 — Mutation audit

Automatic: category **0**, title **0**, description **0**, reel metadata PATCH **0**.  
Expected from this gate’s tests only: reel_create 3, hero presentation PUT 3.
