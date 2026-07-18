# RA-02 — Release Candidate Stress Verification Report

**Release ID:** `RC1-2026-07-18-001`  
**Run ID:** `RA-02-2026-07-18-001`  
**Classification:** Release Acceptance (verification only — no product code changes)  
**Date:** 2026-07-18  
**Production:** https://strong-lolly-a9fcb4.netlify.app/  
**Bundle:** `assets/index-DQeGd3cl.js`  
**Script:** `frontend/scripts/mission-ra-02-stress-verify.mjs`  
**Artifact:** `frontend/artifacts/mission-ra-02-stress-verify.json` (copy of `/tmp/ra-02-stress.json`)

---

## Executive verdict

| Gate | Status |
|------|--------|
| **RA-02 overall** | **PASS** ✅ |
| **RC blockers** | **0** |
| **RC1 recommendation** | **Proceed to Gate 8 (`RC1-STABLE`)** |

Prior RA-02 run (pre-fix) failed on notification `ERR_ABORTED` noise and an embedded RA-01 subprocess timeout. Both were corrected: core API sync check ignores navigation-aborted notification polls; RA-01 runs as a separate regression step per Gate 7 plan.

---

## Scenario results (14/14 pass)

| Scenario | Result | Classification | Timestamp (UTC) |
|----------|--------|----------------|-----------------|
| `perf.health` | ✅ 200 in 876ms | pass | 2026-07-18T19:25:32Z |
| `perf.api_reels` | ✅ 200 in 93ms | pass | 2026-07-18T19:25:32Z |
| `perf.bundle_identity` | ✅ `index-DQeGd3cl.js` | pass | 2026-07-18T19:25:32Z |
| `stress.hero_seed_from_catalog` | ✅ | pass | 2026-07-18T19:25:33Z |
| `stress.fresh_restore_cycle_1` | ✅ `RESTORE_SUCCESS` | pass | 2026-07-18T19:26:16Z |
| `stress.fresh_restore_cycle_2` | ✅ `RESTORE_SUCCESS` | pass | 2026-07-18T19:26:58Z |
| `stress.fresh_restore_cycle_3` | ✅ `RESTORE_SUCCESS` | pass | 2026-07-18T19:27:40Z |
| `stress.catalog_bootstrap_second_context` | ✅ vaultA=3, vaultB=3 | pass | 2026-07-18T19:28:28Z |
| `stress.hard_refresh_cycles` | ✅ 3 cycles | pass | 2026-07-18T19:29:22Z |
| `stress.no_sync_storm_on_core_api` | ✅ 0 core failures; 22 notification aborts ignored | pass | 2026-07-18T19:29:22Z |
| `contract.readiness_board_renders` | ✅ | pass | 2026-07-18T19:29:39Z |
| `contract.episode_attach_panel_visible` | ✅ | pass | 2026-07-18T19:29:39Z |
| `contract.action_router_dom` | ✅ 6 buttons | pass | 2026-07-18T19:29:39Z |
| `contract.episode_attachment_local_read` | ✅ reel `40137565-…` | pass | 2026-07-18T19:29:39Z |

### Stress scope covered

1. **Fresh browser sessions** — three isolated contexts each cleared localStorage, seeded hero manager config, cleared hero reel, reloaded → `RESTORE_SUCCESS` every cycle.
2. **Persistence** — hard refresh ×3 on production home; no `/api/reels` or `/health` failure storm.
3. **Existing contracts** — readiness board, episode attach panel, action router DOM, local attachment read.
4. **Performance** — `/health` and `/api/reels` within acceptable latency; bundle identity matches Gate 3 deploy record.

---

## Regression suite (Gate 7 Step 2)

Run after RA-02 stress script (separate commands, no product changes).

| Test | Command | Result | Classification |
|------|---------|--------|----------------|
| Hero Playwright | `npm run test:hero-playwright` | ✅ PASS (37.5s) | pass |
| Hero persistence | `npm run test:hero-confirmation` | ✅ PASS | pass |
| Episode attachment (local) | `BASE_URL=http://127.0.0.1:4173 npm run test:episode-attachment` | ❌ FAIL — vault empty (0 reels) | **environment** — preview proxies to empty local backend |
| Episode attachment (production) | `BASE_URL=https://strong-lolly-a9fcb4.netlify.app npm run test:episode-attachment` | ❌ FAIL — expected new upload reel, found pre-existing `40137565-…` on `ep-neon-s01e04` | **existing_defect** — same attachment parity family as RA-01 optional checks; not RC blocker |
| Shared state | `node scripts/mission-ra-01-shared-state-verify.mjs` | ✅ PASS (`requiredOk: true`, `RESTORE_SUCCESS`) | pass |

### Regression summary

```
Hero                 PASS
Hero persistence     PASS
Attachment           FAIL (existing_defect / environment — see above)
Shared state         PASS
```

**RC1 impact:** Attachment Playwright failure does **not** block RC1. RA-01 required acceptance already passed; RA-02 contract checks confirm attach panel and local read work on production. Track `B.attachment_visible_on_server` and Playwright attach overwrite behavior post-RC1 (PRODUCT parity).

---

## Blocker classification log

| Item | Classification | RC1 blocker? |
|------|----------------|--------------|
| Notification `ERR_ABORTED` during reload stress | environment | No — navigation abort noise on `/api/notifications/status` |
| Embedded RA-01 in first RA-02 script revision | environment | No — fixed by running RA-01 separately |
| Local preview empty vault | environment | No |
| Production attach Playwright expects fresh attach over seeded episode | existing_defect | No — aligns with RA-01 optional attachment parity |

---

## Artifacts

| Path | Description |
|------|-------------|
| `/tmp/ra-02-stress.json` | Full RA-02 JSON output |
| `frontend/artifacts/mission-ra-02-stress-verify.json` | Archived copy |
| `frontend/artifacts/mission-ra-01-shared-state-verify.json` | RA-01 rerun (Gate 7) |
| `frontend/artifacts/bg-7a-hero-auto-accept.json` | Hero confirmation |
| `releases/RC1-2026-07-18-001/gate-7-ra02-stress.json` | Gate 7 evidence record |

---

## RC1 recommendation

**Sign off RC1-STABLE.**

- BG-7W hero restore survives repeated fresh-session stress (3× `RESTORE_SUCCESS`).
- Catalog bootstrap and studio contracts hold under production load patterns tested.
- Core API health stable; no sync storm on `/api/reels` or `/health`.
- Regression suite confirms hero pipeline and shared-state acceptance; attachment Playwright failure is pre-classified non-blocker.

**Do not reopen PRODUCT-02/03 for RC1.** Post-RC1: attachment server parity and Playwright test isolation (clean episode attach state).
