# MISSION RC3-RECONNECT-01 — Event Source Attribution

**Status:** OPEN — evidence only  
**Baseline:** RC1-2026-07-19-POST-08C + RC2 MP4 Acceptance PASS  
**Production:** https://strong-lolly-a9fcb4.netlify.app/ (`assets/index-Btl25zBV.js`)

## Goal

Prove **which component emits** the current `Backend reconnecting...` operation-status event.

## Hard rules

- Do **not** fix reconnect behavior.
- Do **not** modify application reconnect / sync / upload / hero code.
- Do **not** reopen PRODUCT-08A / 08B / 08C as fix missions.
- Do **not** investigate large Hero transport in this mission.
- Evidence only: observer snippet + Playwright capture + worksheet.

## Why this mission exists

PRODUCT-08C fixed **one** stale reconnect lifecycle (verified clear in ~3–6 s on Netlify; RC1 freeze recorded fixed).

A later sighting of the **same status string** does **not** prove 08C regressed. It may be:

1. A **new, real** reconnect event from the same or another path, or  
2. A **different producer** writing the identical `uploadStatus` text.

This mission attributes the emitter before any fix.

---

## Static producer inventory (source truth, no runtime required)

Exact operation-status text: `🔄 Backend reconnecting...` / `Backend reconnecting...`

| # | Writer | File | Mechanism | Classification candidate |
|---|--------|------|-----------|--------------------------|
| P1 | `fetchWithRetry` catch | `frontend/src/lib/api.js` (~198) | `notifyBackendReconnecting()` → CustomEvent `reelforge:backend-reconnecting` → `viewerContext` listener sets `uploadStatus` | **API retry path** |
| P2 | `syncFromVault` unhealthy | `frontend/src/viewer/viewerContext.js` (~934–935) | Direct `uploadStatus.set('🔄 Backend reconnecting...')` **and** `notifyBackendReconnecting()` | **Sync retry** |
| P3 | Event consumer (not origin) | `viewerContext.js` (~1531–1534) | Listener on `reelforge:backend-reconnecting` writes `uploadStatus` | Downstream of P1 or P2 — **not an independent producer** |
| — | Health presentation | `backendHealthPresentation.js` | Banner text `Reconnecting to backend…` when `reconnectingActive` / degraded | **Health monitor** — **different string**; must not be confused with operation status |
| — | `BackendHealthBanner` | listens to same CustomEvent for 5 s `reconnectingActive` | Banner only | Health monitor surface |
| — | WebSocket (`wsReelEvents.js`) | no `notifyBackendReconnecting` / no reconnect status string | — | **WebSocket reconnect path** only if runtime proves otherwise |
| — | Upload / Hero paths | set other `uploadStatus` strings; no call to `notifyBackendReconnecting` in static search | — | **Upload retry** only if runtime proves otherwise |

**Clear path (08C):** `reelforge:backend-connection` with `state === 'online'` clears operation status back to `Standby` when it still matches the reconnect token (`viewerContext.js` ~1536–1541).

---

## Capture fields (every occurrence)

For each `Backend reconnecting...` appearance, record:

| Field | Source |
|-------|--------|
| timestamp | page `Date` ISO + `performance.now` |
| event source | attributed producer id (P1 / P2 / …) |
| call stack | `Error().stack` at CustomEvent dispatch (if fired) |
| custom event name | `reelforge:backend-reconnecting` or none |
| `backendConnectionStatus` | last `reelforge:backend-connection` detail |
| `navigator.onLine` | page |
| `/api/health` result | last health response in window |
| last successful API call | last 2xx `/api/*` before event |
| WebSocket state | control-center WS readyState / open-close timeline |
| current upload status | DOM `.global-operation-status__message` |
| active upload? | in-flight POST `/api/reels` or multipart |
| hero upload active? | status text / Hero-related POSTs |
| sync running? | prior status `Syncing with backend...` and/or `/api/reels` / sync traffic |
| retry count | fetch attempt index if available from stack/context |

---

## Classification (choose exactly one)

```
API retry path
WebSocket reconnect path
Health monitor
Upload retry
Sync retry
Unknown
```

### Decision hints (runtime)

| Signal | Lean toward |
|--------|-------------|
| Stack includes `fetchWithRetry`; no prior `Syncing with backend...` | API retry path |
| Prior op status `Syncing with backend...`; health fail; stack / order shows syncFromVault | Sync retry |
| Only banner `Reconnecting to backend…`; operation status never shows reconnect string | Health monitor (not this defect) |
| WS close/reopen correlated; no P1/P2 stack | WebSocket reconnect path |
| In-flight large POST / Hero upload correlated; no sync fingerprint | Upload retry |
| Insufficient stack + correlation | Unknown |

---

## Artifacts

| Artifact | Path |
|----------|------|
| Mission doc (this file) | `frontend/RC3_RECONNECT_01_EVENT_SOURCE_ATTRIBUTION.md` |
| Console / init attribution snippet | `frontend/scripts/rc3-reconnect-01-attribution.snippet.js` |
| Playwright capture | `frontend/scripts/mission-rc3-reconnect-01-attribution.mjs` |
| Worksheet template | `frontend/RC3_RECONNECT_01_WORKSHEET.md` |
| Capture output | `frontend/artifacts/rc3-reconnect-01-attribution.json` (+ `.har`) |

### Run

```bash
cd frontend
WAIT_MS=300000 node scripts/mission-rc3-reconnect-01-attribution.mjs
```

Or paste the snippet in DevTools on production, wait for one event, then:

```js
copy(JSON.stringify(window.__rc3Reconnect01.out, null, 2))
```

---

## Timeline format (required deliverable)

```
<ts>

<emitter: notifyBackendReconnecting | syncFromVault direct set | other>

↓

reason / stack fingerprint

↓

backendConnectionStatus

↓

API / health status

↓

clear event (reelforge:backend-connection online → Standby?)

↓

final state + classification
```

## Exit criteria

Mission closes when **one** live occurrence is classified with confidence ≥ Medium, **or** a bounded wait documents **zero** occurrences with proof the attribution harness was armed.

---

## Result (2026-07-20) — CLOSED for attribution

| Field | Value |
|-------|-------|
| Classification | **API retry path** |
| Confidence | **High** |
| Emitter | `notifyBackendReconnecting()` ← `fetchWithRetry` catch |
| Trigger | `GET /api/notifications/status` → `AbortSignal.timeout(4000)` → `signal timed out` |
| Not this emitter | Sync retry (P2), WebSocket, Upload retry, Health-monitor-only banner |
| 08C clear path | Still works (`reelforge:backend-connection:online` ~771 ms later) |
| Artifact | `frontend/artifacts/rc3-reconnect-01-attribution.json` |
| Worksheet | `frontend/RC3_RECONNECT_01_WORKSHEET.md` |

**Implication:** The post-08C sightings are consistent with **another producer** (API retry on short-timeout polls), not a regression of the 08C stale-lifecycle fix. No reconnect behavior was changed in this mission.
