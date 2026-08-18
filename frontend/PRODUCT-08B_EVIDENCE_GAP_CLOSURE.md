# PRODUCT-08B — Evidence Gap Closure

**Release context:** RC1-2026-07-18-001 (`RC1-STABLE`)  
**Phase:** Criterion **3** confirmed (Pattern B) — containment patch local; **Netlify replay gate open**  
**Classification:** Pattern **B** · Exit criterion **3** · Confidence **High**  
**Evidence source:** Netlify live only — `https://strong-lolly-a9fcb4.netlify.app/`  
**Patch:** `frontend/src/lib/sync/studioSync.js` only (apply-triggered schedule suppression)  
**Split-out (do not combine):** PRODUCT-08C — GlobalOperationStatus stale reconnect message

### Topology under test

```text
Browser
  ↓
Netlify frontend (strong-lolly-a9fcb4.netlify.app)
  ↓
Netlify routing/proxy
  ↓
Railway backend
  ↓
WS fallback + sync/push recovery
```

Suspected path:

```text
wss://strong-lolly-a9fcb4.netlify.app/ws/control-center
        ↓
(Netlify does not maintain this WebSocket path)
        ↓
frontend detects unavailable realtime channel
        ↓
"Backend reconnecting..."
        ↓
fallback POST /api/sync/push
```

**Do not use localhost for PRODUCT-08B evidence.** Local lacks Netlify edge/WS limitations and yields a different reconnect topology. Local is reserved for post-classification patch + verify, then re-measure on Netlify.

### Event 1 interpretation (corrected)

```text
08B Evidence Event 1
        |
        ├── Environment: ✅ valid (Netlify → Railway)
        ├── Sync fallback signal: ✅ /api/sync/push → 200 (observed)
        ├── WS correlation: incomplete for classification
        ├── Sync frequency: incomplete for classification
        ├── Banner timing (appear→clear): incomplete (clear not observed)
        └── Classification: Low confidence
```

Weakness was **missing correlated observability**, not the environment. Event 2 must close correlation using **browser-local timestamps and Network timestamps from the same event**.

### Event 2 required signals

| Signal | Needed |
|--------|--------|
| App URL | `https://strong-lolly-a9fcb4.netlify.app/` |
| Banner appeared | Required |
| First `/api/sync/push` 200 | Required |
| Banner cleared | Required |
| `/api/sync/push` count | Required |
| First → last sync spacing | Required |
| WS open/close/error lifecycle | Required |
| Dual clock | browser local ISO + Network/performance from same event |

---

## 1. Evidence gap analysis

| Missing field | Why prior attempt failed | Closure method |
|---------------|--------------------------|----------------|
| Banner appeared / disappeared | No shared DOM clock | Console MutationObserver on `.global-operation-status__message` |
| Sync/push count + spacing | No isolated event window / no HAR | DevTools Network + HAR; window = banner appear→disappear |
| First/last timestamps + durations | Aggregate session traffic only | Per-request `startedDateTime` / duration from HAR |
| Payload byte sample | Not captured | Request body size / Content-Length from DevTools (not transferSize) |
| WS lifecycle + banner correlation | Historical probe only (`ws_http=400`) | Same-tab WS pane + Playwright `page.on('websocket')` timestamps |
| Pattern A/B + confidence | Incomplete inputs | Frozen exit criteria after complete worksheet |

**Immutable 08A baseline (out of scope):** `346MB POST /api/reels → 502 @ 300105ms`.

---

## 2. Exact capture procedure

Preferred order (no production behavior changes):

1. **DevTools Network + WS** — Preserve log, Disable cache, clear log, shared timeline, export HAR
2. **Console observer** — paste [`scripts/product-08b-console-observer.snippet.js`](scripts/product-08b-console-observer.snippet.js); copy `window.__product08bCapture.out`
3. **Existing debug flags** — use `VITE_DEBUG_API` logs **only if already present** in the frozen deploy; do not rebuild
4. **Temporary diagnostic logging** — **not required** for the next attempt

Optional automation (still read-only vs application code):

```bash
cd frontend
node scripts/mission-product-08b-reconnect-capture.mjs
```

Full checklist lives in [`PRODUCT-08B_SYNC_PUSH_MEASUREMENT.md`](PRODUCT-08B_SYNC_PUSH_MEASUREMENT.md) under **Evidence gap closure**.

### Source map (inspect only)

| Concern | Location |
|---------|----------|
| Reconnect emit | `src/lib/api.js` `notifyBackendReconnecting` / `fetchWithRetry` catch |
| Vault path emit | `src/viewer/viewerContext.js` health-fail → `Backend reconnecting...` |
| Banner visibility | `src/components/viewer/BackendHealthBanner.svelte` `markReconnecting` + `RECONNECT_WINDOW_MS=5000` |
| Operation status UI | `src/components/viewer/GlobalOperationStatus.svelte` |
| Sync push start/complete | `src/lib/sync/studioSync.js` `performSync` → `pushSyncState` |
| Sync HTTP | `src/lib/api/syncApi.js` `POST /api/sync/push` |
| WS failure detect | `src/lib/wsReelEvents.js` `onerror` / `onclose` (no banner coupling) |

---

## 3. Missing observability

| Signal | Available without code change? | Notes |
|--------|--------------------------------|-------|
| Operation-status timestamps | Yes | Console observer |
| Health-banner timestamps | Yes | Console observer (secondary) |
| Sync/push timing + status | Yes | Network / HAR |
| Request payload bytes | Usually yes | DevTools body size; mark unavailable if missing |
| WS URL / attempt / close | Yes | Network WS pane |
| WS close code/reason | Sometimes unavailable | Handshake fail before close frame → record `unavailable` |
| Compile-time `[WS_DEBUG]` / `[API_DEBUG]` | Only if baked into RC1 bundle | Do not rebuild to enable |

**Conclusion:** No application logging is required before the next measurement.

---

## 4. Event results

### Event 1 (corrected)

Topology **valid**. Classification **Low** — correlated observability incomplete.

### Event 2 (Netlify, dual clocks)

| Signal | Result |
|--------|--------|
| App URL | `https://strong-lolly-a9fcb4.netlify.app/` ✅ |
| Banner appeared | `2026-07-19T10:42:27.467Z` ✅ |
| First `/api/sync/push` 200 | `2026-07-19T10:42:50.700Z` ✅ |
| Banner cleared | **❌ not observed** (still visible at `10:47:28.791Z`) |
| Sync count (open window) | 157 (observation only) |
| First → last spacing | avg 1777 ms / min 62 / max 6087 (observation only) |
| WS lifecycle | attempt→error→close @ `10:42:24.2xxZ`, code/reason unavailable ✅ |
| Dual clock | browserLocalISO + performanceNowMs + timeOrigin on capture start and sync/push ✅ |
| Confidence | **Low** |
| Exit criterion | deferred |

Artifact: `artifacts/product-08b-reconnect-capture-event2.json` + `.har`

## 5. Confirmation — no code fixes justified yet

Banner clear remains the blocking required signal. Until a Netlify event records appear **and** clear on the same timeline, do not promote Pattern A/B to sign-off or patch product code.

```text
Netlify Event 2 (Low — missing clear)
        ↓
Need closed banner window on Netlify
        ↓
Exit criterion match
        ↓
Confidence High/Medium
        ↓
Smallest PRODUCT-08B scope
        ↓
Local patch only
        ↓
Deploy
        ↓
Repeat Netlify measurement
```

---

## Artifacts

| Path | Role |
|------|------|
| `scripts/product-08b-console-observer.snippet.js` | DevTools paste observer (dual clock) |
| `scripts/mission-product-08b-reconnect-capture.mjs` | Automated Netlify-only capture |
| `scripts/measure-sync-push-frequency.mjs` | Post-hoc Performance helper |
| `artifacts/product-08b-reconnect-capture.json` | Event 1 partial (Low) |
| `artifacts/product-08b-reconnect-capture-event2.json` | Event 2 (Low — clear missing) |
| `artifacts/product-08b-reconnect-capture-event2.har` | Event 2 HAR |
| `PRODUCT-08B_SYNC_PUSH_MEASUREMENT.md` | Worksheet + checklist |
