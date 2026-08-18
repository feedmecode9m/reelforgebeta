# BG-7I-A — Backend Reconnect Root Trace

**Mode:** Investigation only  
**Generated:** 2026-07-24  
**Production evidence:** `frontend/artifacts/rc3-reconnect-01-attribution.json` (2026-07-24T20:03:28Z capture)

---

## Config — `frontend/src/lib/config.js`

### Resolved values (production Netlify)

| Export | Production value | How resolved |
|--------|------------------|--------------|
| `API_BASE_URL` | `''` (same-origin) | `VITE_USE_SAME_ORIGIN_API=true` + `isNetlifyStaticHost()` → `shouldUseSameOriginApi()` |
| `BACKEND_URL` | `''` (same-origin relative media) | Same gate in `resolveBackendUrl()` |
| `USE_SAME_ORIGIN_API` | `true` | `.env.production` + hostname `.netlify.app` |
| `ASSET_BASE_URL` | `''` when `BACKEND_URL` empty | Falls through to relative `/videos`, `/thumbs` |
| `DIRECT_UPLOAD_BASE_URL` | `https://reelforge-deploy-production.up.railway.app` | Large PUT bypass (not involved in reconnect) |

**Netlify proxy:** `frontend/public/_redirects` maps `/api/*` → Railway `/api/:splat`.

### Environment variables used

| Variable | Purpose |
|----------|---------|
| `VITE_USE_SAME_ORIGIN_API` | Force same-origin API (prod Netlify) |
| `VITE_API_URL` / `VITE_API_BASE_URL` / `VITE_BACKEND_URL` | Configured API/media origin (sanitized; loopback stripped in prod) |
| `VITE_USE_CONFIGURED_API_URL_IN_DEV` | Opt-in remote backend during `npm run dev` |
| `VITE_FORCE_DIRECT_BACKEND_API` | Dev: skip Vite proxy for API |
| `VITE_USE_VITE_MEDIA_PROXY` | Dev: same-origin media via Vite |
| `VITE_ASSET_BASE_URL` | Optional dedicated media origin |
| `VITE_BACKEND_PORT` / `BACKEND_PORT` | Dev localhost port (default `8080`) |
| `VITE_USE_SIGNED_UPLOADS`, `VITE_SIGNED_UPLOADS_MIN_BYTES`, `VITE_DIRECT_UPLOAD_BASE_URL` | Upload path only |

### Production vs development

| Aspect | Production (Netlify) | Development (`npm run dev`) |
|--------|----------------------|-----------------------------|
| API fetches | `${API_BASE_URL}/api/...` → `/api/...` (Netlify → Railway) | `${API_BASE_URL}/api/...` → `/api/...` (Vite proxy) unless forced direct |
| `BACKEND_URL` | `''` — relative media | `http://localhost:8080` |
| Remote URL in build | Loopback origins stripped | Remote env URLs ignored unless `VITE_USE_CONFIGURED_API_URL_IN_DEV=true` |
| Health probes | Same-origin `/api/health` | Same-origin or direct per flags |

---

## Caller inventory

### `checkBackendHealth()` — definition: `frontend/src/lib/api.js:107`

| Caller | File | Context |
|--------|------|---------|
| `syncFromVault()` | `frontend/src/viewer/viewerContext.js:1039` | Vault/feed bootstrap sync |
| `bootstrapMediaFromBackend()` | `frontend/src/lib/mediaBootstrap.js:217` | Module-init media bootstrap |

**Behavior:** Probes `GET {base}/api/health`, `/health`, `/` with `AbortSignal.timeout(5000)`. Returns `false` only if all probes fail.

### `notifyBackendReconnecting()` — definition: `frontend/src/lib/api.js:99`

| Caller | File | Line | Mechanism |
|--------|------|------|-----------|
| `fetchWithRetry()` catch | `frontend/src/lib/api.js` | ~212 | Dispatches `reelforge:backend-reconnecting` |
| `syncFromVault()` unhealthy branch | `frontend/src/viewer/viewerContext.js` | ~1047 | Direct call when `checkBackendHealth()` false |

**Consumer (not producer):** `onBackendReconnecting` in `viewerContext.js:1685–1687` sets `uploadStatus`.

### `fetchWithRetry()` — definition: `frontend/src/lib/api.js:161`

**Direct callers (grep):**

| Module | Typical URLs |
|--------|--------------|
| `viewerContext.js` | `GET /api/reels?t=…` |
| `mediaBootstrap.js` | `GET /api/reels?t=…` |
| `api/media.js` | storage probe, `/api/videos`, `/api/thumbnails`, category PATCH |
| `api/notificationApi.js` | `/api/notifications/status`, `/api/notifications?…`, unread-count, etc. |
| `api/securityApi.js`, `analyticsApi.js`, `workflowApi.js`, `revenueApi.js`, `pipelineApi.js`, `teamApi.js`, `syncApi.js`, `seriesApi.js`, `watch.js`, `monetization.js`, `platformConfig.js`, `studio.js` | `${API_BASE_URL}${path}` |
| `VaultExperience.svelte` | `GET /api/reels` (vault refresh) |
| `api.js` `cachedFetch` | Generic cached GET |

**Only the `catch` path calls `notifyBackendReconnecting()`.**

---

## Trigger

**Production capture (first occurrence):**

| Field | Value |
|-------|-------|
| Time | `2026-07-24T20:03:35.621Z` |
| Prior `uploadStatus` | `Syncing with backend...` (syncFromVault in flight) |
| Emitter | `notifyBackendReconnecting()` via **P1** (`fetchWithRetry` catch) |
| Classification | Sync retry (concurrent with sync; not P2 health-fail) |

**Alternate path (not triggered in this capture):**

- **P2:** `syncFromVault` → `checkBackendHealth()` returns `false` → direct `uploadStatus.set('🔄 Backend reconnecting...')` + `notifyBackendReconnecting()` (`viewerContext.js:1046–1047`).

In this run, `checkBackendHealth()` **succeeded** (`GET /api/health` → 200, finished `20:03:37.272Z`).

---

## Call Stack

```
App boot
  ├─ viewerContext.js module init
  │    ├─ NotificationBridge.svelte → initNotificationCenter()     [parallel]
  │    │    └─ hydrateNotifications()
  │    │         └─ isNotificationApiAvailable()
  │    │              └─ fetchNotificationApiStatus()
  │    │                   └─ fetchWithRetry('/api/notifications/status', { signal: timeout 4s }, { retries: 0 })
  │    │                        └─ catch → notifyBackendReconnecting()  ← FIRST RECONNECT EMIT
  │    │                             └─ onBackendReconnecting → uploadStatus.set('🔄 Backend reconnecting...')
  │    └─ syncFromVault()                                            [parallel]
  │         ├─ uploadStatus.set('🔄 Syncing with backend...')
  │         ├─ checkBackendHealth()  → eventually 200
  │         └─ fetchWithRetry(GET /api/reels)  → succeeds separately
  └─ GlobalOperationStatus.svelte renders "Backend reconnecting..."
```

Minified stack from harness (`index-DxM0FwvJ.js`): frames `aH` → `oH` → `bu` → `o` align with notification hydration chain, not `syncFromVault` symbol names.

---

## Failed Request

| Property | Value |
|----------|-------|
| **First failing request before reconnect text** | `GET /api/notifications/status` |
| **Full URL (production browser)** | `https://strong-lolly-a9fcb4.netlify.app/api/notifications/status` |
| **Proxied target** | `https://reelforge-deploy-production.up.railway.app/api/notifications/status` |
| **HTTP status** | None — request aborted before response |
| **Browser error** | `signal timed out` |
| **Timeout** | `AbortSignal.timeout(4000)` in `fetchNotificationApiStatus()` (`notificationApi.js:47`) |
| **Timestamp** | `2026-07-24T20:03:35.619Z` (519ms before reconnect event at `.621Z`) |

**Context — same session, other calls succeeding:**

| URL | Result | Time |
|-----|--------|------|
| `GET /api/health` | **200** | started `20:03:32.339Z`, finished `20:03:37.272Z` |
| `GET /api/notifications?userId=user-owner-1` | **200** | `20:03:35.100Z` |
| `GET /api/notifications/status` | **timeout** | `20:03:35.619Z` |

---

## Failure classification

| Hypothesis | Verdict |
|------------|---------|
| Wrong URL | **No** — same-origin `/api/...` matches Netlify `_redirects`; list endpoint on same API succeeded |
| CORS | **No** — same-origin fetch |
| Auth | **No** — no auth header required; failure is abort timeout, not 401/403 |
| Timeout | **Yes** — `AbortSignal.timeout(4000)` fired on `/api/notifications/status` |
| Transient network / slow proxy | **Yes** — health and notifications list OK; status endpoint alone exceeded 4s |

**Root trigger class:** **Transient timeout on a non-critical ancillary endpoint**, incorrectly promoted to global reconnect UX via `fetchWithRetry` → `notifyBackendReconnecting()`.

**Second boundary (stuck UI):** After backend returns online (`reelforge:backend-connection`, state `online` at `20:03:36.032Z`), `uploadStatus` remains `"Backend reconnecting..."` because:

- `syncFromVault` `finally` (~1318–1321) only clears `✅` / `⚠️` / `❌` prefixes.
- No production listener clears reconnect text on connection online.

---

## Root Cause Classification

1. **Immediate:** `fetchWithRetry()` unconditionally calls `notifyBackendReconnecting()` on any network error, including swallowed ancillary calls (`notificationApi.js` catches locally but reconnect event already fired).
2. **Structural:** Global operation status conflates critical sync failures with optional notification status probe timeouts.
3. **Lifecycle:** Missing clear path for `🔄 … reconnecting…` after successful recovery.

**Not root cause in this capture:** `checkBackendHealth()` failure (P2), WebSocket, wrong `API_BASE_URL`, CORS.

---

## Smallest Fix Location

| Priority | File | Function | Surgical change |
|----------|------|----------|-----------------|
| 1 | `frontend/src/lib/api.js` | `fetchWithRetry()` catch (~212) | Do not call `notifyBackendReconnecting()` for non-critical paths, or add opt-out flag used by `fetchNotificationApiStatus` |
| 2 | `frontend/src/lib/api/notificationApi.js` | `fetchNotificationApiStatus()` (~45–49) | Use plain `fetch` (no global reconnect side effect) for 4s status probe |
| 3 | `frontend/src/viewer/viewerContext.js` | `syncFromVault()` `finally` (~1318–1321) | Clear loading/reconnecting statuses after successful sync |
| 3 | `frontend/src/viewer/viewerContext.js` | `onBackendReconnecting` / new online listener (~1685+) | Reset to `Standby` when `backendConnectionStatus.state === 'online'` and status contains `reconnecting` |

**First failing boundary (stop condition):** **`fetchWithRetry` catch → `notifyBackendReconnecting()` on `/api/notifications/status` timeout**, followed by **`uploadStatus` lifecycle failing to clear** after backend is online.

---

## fetchWithRetry caller classification (2026-07-24 verification)

| Caller | File | Endpoint(s) | Critical? | `notifyReconnectOnFailure` |
|--------|------|-------------|-----------|----------------------------|
| `syncFromVault` | `viewerContext.js:1058` | `GET /api/reels` | **Yes** | default `true` |
| `bootstrapMediaFromBackend` | `mediaBootstrap.js:258` | `GET /api/reels` | **Yes** | default `true` |
| Vault refresh | `VaultExperience.svelte:237` | `GET /api/reels` | **Yes** | default `true` |
| Storage / catalog | `media.js:548–559` | `/api/media/storage`, `/api/videos`, `/api/thumbnails` | **Yes** | default `true` |
| Category PATCH | `media.js:745` | `PATCH /api/reels/{id}/category` | **Yes** | default `true` |
| `cachedFetch` | `api.js:282` | varies | **Yes** | default `true` |
| Notifications | `notificationApi.js:30,45` | `/api/notifications/*` | **No** | **`false` (patched)** |
| Analytics | `analyticsApi.js` | `/api/analytics/*` | **No** | **`false` (patched)** |
| Workflow | `workflowApi.js` | `/api/workflow/*` | **No** | **`false` (patched)** |
| Pipeline | `pipelineApi.js` | `/api/pipeline/*` | **No** | **`false` (patched)** |
| Teams | `teamApi.js` | `/api/teams/*` | **No** | **`false` (patched)** |
| Series | `seriesApi.js` | `/api/series/*` | **No** | **`false` (patched)** |
| Sync | `syncApi.js` | `/api/sync/*` | **No** | **`false` (patched)** |
| Watch | `watch.js` | `/api/watch/*` | **No** | **`false` (patched)** |
| Security | `securityApi.js` | security paths | **No** | **`false` (patched)** |
| Revenue | `revenueApi.js` | revenue paths | **No** | **`false` (patched)** |
| Monetization | `monetization.js` | monetization paths | **No** | **`false` (patched)** |
| Platform config | `platformConfig.js` | config paths | **No** | **`false` (patched)** |
| Studio | `studio.js` | studio paths | **No** | **`false` (patched)** |

**Patch applied:** `fetchWithRetry` accepts `notifyReconnectOnFailure` (default `true`). Non-critical modules opt out — fixes signal source without hiding reconnect UI for real catalog/sync failures.
