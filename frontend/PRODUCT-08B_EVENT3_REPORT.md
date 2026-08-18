# PRODUCT-08B Event 3 Report

**Gate:** Netlify Replay after alleged deploy of `94c66674538f3e255ca1ad963c2c7e53665ed2c9`  
**Verdict:** **FAIL** — containment did not reach production

---

## Deployment confirmation

| Field | Value |
|-------|-------|
| Requested commit | `94c66674538f3e255ca1ad963c2c7e53665ed2c9` |
| Commit subject | `RC1-2026-07-18-001: Gate 7 RA-02 stress evidence` |
| Commit date | 2026-07-18 15:42:05 -0400 |
| Containment in that commit? | **No** (`applySyncPayloadToLocal` still used; no `suppressApplyTriggeredSchedules`) |
| Containment in working tree? | Yes — **staged only**, not on `origin/main` |
| Production URL | `https://strong-lolly-a9fcb4.netlify.app/` |
| Probe time (UTC) | 2026-07-19T11:22:56Z |
| Netlify edge | `cache-status: "Netlify Edge"; hit`, `age: 3264`, `etag: e176004a96dcee6ee4cc157c4288f637-ssl` |
| Bundle | `assets/index-DQeGd3cl.js` (+ `assets/vendor-BRLD7tzm.js`) |
| Bundle containment markers | **Absent** (`SYNC_SCHEDULE_SUPPRESSED` / `applyRemoteSyncPayload` not found) |

**Conclusion:** Netlify is serving the pre-patch RC1 bundle. Commit `94c6667` is not a containment deploy.

---

## Capture artifact

- JSON: `frontend/artifacts/product-08b-reconnect-capture-event3.json`
- HAR: `frontend/artifacts/product-08b-reconnect-capture-event3.har`
- Capture window: `2026-07-19T11:23:50.696Z` → `2026-07-19T11:29:09.649Z`

---

## Sync / Network (`/api/sync/push`)

| Metric | Event 3 |
|--------|---------|
| Total push count | **182** |
| First request | `2026-07-19T11:24:21.936Z` |
| Last request | `2026-07-19T11:29:08.948Z` |
| First→last duration | **287012 ms** |
| Average interval | **1586 ms** |
| Min / max gap | 18 / 2264 ms |
| Gaps &lt; 5s | 181 / 181 |
| Status sequence | **200 only** |
| Payload sample | **18168** bytes |

## WS

| Field | Value |
|-------|-------|
| URL | `wss://strong-lolly-a9fcb4.netlify.app/ws/control-center` |
| State | **failed** (attempt → error/close; close code unavailable) |
| Correlation | Temporal only; same as Event 2 (not evaluated for this gate) |

## Banner (secondary only — not scored)

- Operation status appeared; clear not observed within WAIT_MS
- Top health banner brief appear/disappear (not scored)

---

## Comparison vs Event 2

| Metric | Event 2 | Event 3 | Delta |
|--------|---------|---------|-------|
| Pushes | 157 | 182 | +25 |
| Window | 277164 ms | 287012 ms | similar |
| Avg interval | 1777 ms | 1586 ms | still ~1.6–1.8s |
| Pattern | B | B | unchanged |
| Amplification | present | present | **not fixed in prod** |

## Classification

- Pattern: **B**
- Apply-triggered sync amplification: **still present on Netlify**
- Gate classification: **FAIL** — containment not in production

## PASS/FAIL

# **FAIL**

Reason: sustained 1–2s `/api/sync/push` burst remains; production bundle lacks containment; requested commit does not include the patch.

### Required next step (no code change in this gate)

1. Commit + deploy the staged `studioSync.js` containment to Netlify  
2. Confirm live bundle contains `SYNC_SCHEDULE_SUPPRESSED` / new hash ≠ `index-DQeGd3cl.js`  
3. Re-run Event 3 (or Event 4) against that deploy
