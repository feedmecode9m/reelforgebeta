# RC3-RECONNECT-01 — Worksheet (FILLED)

Filled from `frontend/artifacts/rc3-reconnect-01-attribution.json` (run2, 2026-07-20).

## Identity

| Field | Value |
|-------|-------|
| Mission | RC3-RECONNECT-01 |
| Production URL | https://strong-lolly-a9fcb4.netlify.app/ |
| Bundle | `/assets/index-Btl25zBV.js` (RC1/RC2 freeze) |
| Capture start | 2026-07-20T03:59:37.630Z |
| Capture end | ~2026-07-20T04:00:08Z |
| Occurrences seen | 7 CustomEvent dispatches in window (burst); primary attributed below |
| Confidence | **High** |

## Per-occurrence record

### Occurrence 1 (primary)

| Field | Value |
|-------|-------|
| timestamp | 2026-07-20T03:59:55.533Z |
| event source | `notifyBackendReconnecting()` (minified `mg` in bundle) |
| call stack (top frames) | `mg` → `Ml` (`fetchWithRetry`) → async callers in `index-Btl25zBV.js` |
| custom event name | `reelforge:backend-reconnecting` |
| backendConnectionStatus | flips `online` → `offline` (`lastError: signal timed out`) → `online` |
| navigator.onLine | `true` |
| /api/health result | 200 (last health ~4s earlier) |
| last successful API call | `GET /api/notifications?userId=user-owner-1` 200 @ 03:59:52.178Z |
| WebSocket state | `CLOSED` (`wss://…/ws/control-center`) — not the emitter |
| current upload status | `Backend reconnecting...` (emoji stripped by presentation) |
| active upload? | no |
| hero upload active? | no |
| sync running? | no (prior status was empty; not `Syncing with backend...`) |
| retry count | `fetchWithRetry` retries:0 on notifications/status; still emits reconnect on throw |
| cleared at | 2026-07-20T03:59:56.304Z (~771 ms later) |
| clear event | `reelforge:backend-connection:online` (08C clear path) |
| final state | connection restored to online; status cleared |

### Trigger API (correlated within 4 ms)

```
GET /api/notifications/status
→ network_error: "signal timed out"  (AbortSignal.timeout(4000))
→ fetchWithRetry catch
→ notifyBackendReconnecting() + backendConnectionStatus=offline
```

Source owner: `frontend/src/lib/api/notificationApi.js` → `fetchNotificationApiStatus()` → `fetchWithRetry` in `frontend/src/lib/api.js`.

### Timeline

```
2026-07-20T03:59:55.529Z
  /api/notifications/status → signal timed out

↓

2026-07-20T03:59:55.533Z
  notifyBackendReconnecting()  [mg]
  ← called from fetchWithRetry catch [Ml]
  CustomEvent: reelforge:backend-reconnecting

↓

backendConnectionStatus: offline (lastError: signal timed out)
banner: Backend unavailable — signal timed out…
op status: Backend reconnecting...

↓

API: health was already 200; browser online; WS CLOSED
(not syncFromVault; not upload; not health-banner-only string)

↓

2026-07-20T03:59:56.304Z
  clear: reelforge:backend-connection:online

↓

final: online restored; classification API retry path
(additional notify bursts continued from other timed-out polls)
```

### Classification (exactly one)

```
[x] API retry path
[ ] WebSocket reconnect path
[ ] Health monitor
[ ] Upload retry
[ ] Sync retry
[ ] Unknown
```

Confidence: **High**

Notes:

- PRODUCT-08C clear lifecycle is still working (~0.8 s clear on online).
- The remaining UX issue is a **different producer burst**: `fetchWithRetry` catch on short-timeout polls (notifications/status, and similarly other `AbortSignal.timeout(4000)` API helpers), not the stale sync lifecycle fixed in 08C.
- Static P2 (`syncFromVault` direct write) was **not** the emitter in this capture.
- Health monitor banner string `Reconnecting to backend…` was **not** the primary surface; offline banner was shown instead.

---

## Static producers (reference)

- **P1** `api.js` `fetchWithRetry` catch → `notifyBackendReconnecting()` → **API retry path** ← **THIS CAPTURE**
- **P2** `viewerContext.js` `syncFromVault` unhealthy → direct `uploadStatus` + notify → **Sync retry** (not observed here)
- Banner `Reconnecting to backend…` → **Health monitor** (different string; not primary here)
