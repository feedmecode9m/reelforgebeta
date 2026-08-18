# PRODUCT-08B — Netlify Replay Gate

**Status:** Local containment verified · Production replay **pending deploy**  
**Classification:** Pattern B · Exit criterion 3 · Confidence High  
**App:** `https://strong-lolly-a9fcb4.netlify.app/`

## Diff review (pre-merge)

`git diff -- frontend/src/lib/sync/studioSync.js` — **PASS**

| Check | Result |
|-------|--------|
| Unrelated formatting | None |
| Sync ownership changes | None |
| Interval timing (`SYNC_INTERVAL_MS=15000`) | Unchanged |
| Debounce (`PUSH_DEBOUNCE_MS=1200`) | Unchanged |
| Manual / direct `scheduleSyncPush` | Preserved |
| Periodic / startup / online `performSync` | Preserved |
| Only apply-triggered schedule events suppressed | Yes |

## Before reference (Event 2)

```text
157 pushes / 277s
≈1.8s cadence
```

Artifact: `artifacts/product-08b-reconnect-capture-event2.json`

## After expected (post-deploy)

```text
Reconnect event
        ↓
fallback sync
        ↓
no apply-triggered storm
        ↓
sync cadence returns toward ~15s
```

## Replay capture fields

1. Total `/api/sync/push` count  
2. First timestamp  
3. Last timestamp  
4. Average spacing  
5. Any `SYNC_SCHEDULE_SUPPRESSED` diagnostics  
6. Banner behavior (secondary only)

## Close rule

If production confirms `157 → normal cadence`, **PRODUCT-08B closes**.

Stale bottom operation status → **PRODUCT-08C** (separate). Do not combine unless a future measurement ties it to the same defect.

## Command (after deploy)

```bash
cd frontend
EVENT_ID=3 WAIT_MS=300000 node scripts/mission-product-08b-reconnect-capture.mjs
```

Compare `artifacts/product-08b-reconnect-capture-event3.json` against Event 2 baseline.
