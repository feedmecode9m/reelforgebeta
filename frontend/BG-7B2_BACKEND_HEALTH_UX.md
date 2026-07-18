# BG-7B.2 — Offline & Backend Health UX

**Mission:** BG-7B.2 — Offline & Backend Health UX  
**Date:** 2026-07-17  
**Resolves:** BG-7B.0 **P1** — backend availability, degraded mode, reconnect attempts, and offline conditions invisible to users  
**Scope:** Presentation layer only — no business logic, API, upload, delete, sync, or Hero changes

---

## Summary

Added a single reusable connectivity banner that subscribes to the existing `backendConnectionStatus` store and browser online/offline events. Users now see when the app is connecting, offline, backend-unavailable, or has recovered — without duplicate polling or a second health system.

| Criterion | Result |
|-----------|--------|
| One backend health component | ✅ `BackendHealthBanner.svelte` |
| Zero new health systems | ✅ Reads `backendConnectionStatus` + existing events only |
| Zero business logic changes | ✅ No edits to `api.js`, `viewerContext.js`, sync, upload |
| Does not replace GlobalOperationStatus | ✅ Top connectivity banner vs bottom operation banner |
| Mounted once at Viewer root | ✅ `Viewer.svelte` |
| Build | ✅ `npm run build` (2026-07-17) |

---

## Component architecture

```
backendConnectionStatus (writable — api.js)
        │  state: 'online' | 'degraded' | 'offline'
        │  lastOkAt, lastAttemptAt, lastError
        │
        ├── window 'online' / 'offline'  (navigator.onLine)
        └── window 'reelforge:backend-reconnecting'  (fetchWithRetry retries)
                │
                │  subscribe + event listeners (read-only)
                ▼
        BackendHealthBanner.svelte
                │
                ├── deriveBackendHealthPresentation()  ← backendHealthPresentation.js (pure)
                ├── recoveryPresentation() on online transition from degraded/offline
                │
                └── Render by level:
                      hidden       → (no DOM)
                      connecting   → subtle cyan pill + spinner
                      offline      → warning yellow pill (browser offline)
                      unavailable  → error red pill (backend down, browser online)
                      recovery     → brief green success (~2.4s auto-fade)
```

### Separation from GlobalOperationStatus (BG-7B.1)

| Concern | Component | Store / source | Position | Z-index |
|---------|-----------|----------------|----------|---------|
| User operations (upload, sync messages) | `GlobalOperationStatus` | `uploadStatus` | Bottom center | 1250 |
| App connectivity (backend / network) | `BackendHealthBanner` | `backendConnectionStatus` + browser events | Top center | 1240 |

Both can appear simultaneously without conflict (different vertical position and semantic role).

---

## State sources (discovery)

### Primary — single source of truth

| Source | Location | Fields / values | Updated by |
|--------|----------|-----------------|------------|
| `backendConnectionStatus` | `src/lib/api.js` | `state`, `lastOkAt`, `lastAttemptAt`, `lastError` | `setBackendConnectionStatus()` inside `checkBackendHealth()`, `fetchWithRetry()` |

State transitions (existing, unchanged):

- **`online`** — health check OK or successful fetch
- **`degraded`** — health check failed mid-probe, or HTTP 5xx/429 on final retry attempt
- **`offline`** — network failure during `fetchWithRetry` (after `notifyBackendReconnecting()`)

### Secondary signals (subscribed, not duplicated)

| Signal | Location | Used for |
|--------|----------|----------|
| `navigator.onLine` + `window` `online`/`offline` | Browser API | Browser-offline warning (overrides backend state in UI) |
| `reelforge:backend-reconnecting` | `api.js` → `notifyBackendReconnecting()` | Short “Reconnecting…” window during fetch retries |
| `reelforge:backend-connection` | `api.js` → `setBackendConnectionStatus()` | Dispatched for other listeners; banner reads store directly |

### Intentionally not wired (avoid duplicate systems)

| Source | Reason |
|--------|--------|
| `syncStatus` (`studioSync.js`) | Studio-scoped sync state; operation feedback already via `uploadStatus` / GlobalOperationStatus |
| WebSocket reel events (`wsReelEvents.js`) | No exported connection store; not part of backend health contract |
| New polling / health requests | Would violate “no additional API requests” |

### JSON / API cache fallback

When GET requests fail, `readApiCache()` in `api.js` serves cached JSON. The banner does not detect cache hits separately — it reflects the same `degraded` / `offline` state that `fetchWithRetry` already sets, with copy mentioning “saved content when possible” for unavailable states.

---

## Render conditions

Pure mapping in `backendHealthPresentation.js`:

| Level | Condition | Message (summary) | `aria-live` | Dismissible |
|-------|-----------|-------------------|-------------|-------------|
| **hidden** | `state === 'online'` && browser online && !reconnecting | — | — | — |
| **connecting** | `state === 'degraded'` OR `reconnectingActive` | Degraded / reconnecting copy | `polite` | No |
| **offline** | `!browserOnline` | “You appear to be offline…” | `polite` | Yes (Escape / button) |
| **unavailable** | browser online && `state === 'offline'` | “Backend unavailable…” + `lastError` | `assertive` | Yes |
| **recovery** | Transition `degraded`/`offline` → `online` while browser online | “Back online — connection restored.” | `polite` | No (auto-fade ~2.4s) |

Priority when multiple signals apply: **browser offline** wins over backend state (user cannot reach network). **Recovery flash** temporarily overrides hidden state after successful reconnection.

`reconnectingActive` is set for 5s when `reelforge:backend-reconnecting` fires (matches retry window in `fetchWithRetry`).

---

## Files

### Added

| File | Role |
|------|------|
| `src/components/viewer/BackendHealthBanner.svelte` | Banner UI, subscriptions, recovery flash, dismiss |
| `src/lib/backendHealthPresentation.js` | Pure state → presentation mapping |

### Modified

| File | Change |
|------|--------|
| `src/Viewer.svelte` | Import + single mount above `GlobalOperationStatus` |

### Intentionally untouched

- `src/lib/api.js` — health checks, retries, store updates
- `src/viewer/viewerContext.js` — sync, upload producers
- `src/lib/sync/studioSync.js`
- Upload / delete / Hero / release tooling

---

## Integration point

```svelte
<!-- Viewer.svelte -->
<ObservabilityBridge />
<BackendHealthBanner />
<GlobalOperationStatus {uploadStatus} />
```

- **Pointer events:** outer wrapper `pointer-events: none`; inner pill `pointer-events: auto` so only the banner is interactive, not the full viewport width
- **Never blocks uploads:** no overlays, no modal capture, no changes to upload handlers

---

## Validation scenarios

### Automated — presentation mapping

Node script (2026-07-17) against `deriveBackendHealthPresentation()`:

```
PASS healthy: hidden
PASS browser offline: offline
PASS backend offline: unavailable
PASS degraded: connecting
PASS reconnecting: connecting
recovery: recovery
```

### Manual / runtime matrix

| Scenario | Expected banner | How to trigger |
|----------|-----------------|----------------|
| Backend stopped | `unavailable` (error) | Stop local backend on `:8080`; load app — `fetchWithRetry` sets `offline` |
| Backend restored | `recovery` then hidden | Restart backend; next successful fetch sets `online` |
| Temporary network loss | `connecting` then `unavailable` | Throttle network in DevTools during API call |
| Offline browser mode | `offline` (warning) | DevTools → Network → Offline |
| JSON fallback | `connecting` or `unavailable` with “saved content” copy | Same as backend stopped if cache populated from prior session |
| Railway unavailable | `unavailable` with `lastError` (e.g. HTTP 503) | Point `VITE_API_BASE_URL` at dead host or simulate 5xx |
| Recovery | Green “Back online” ~2.4s | Restore connectivity after any degraded/offline period |

### Build / bundle evidence

Production build succeeded (`index-BOCa0EvJ.js`, `index-WDwIGsUF.css`).

Bundle contains banner strings and styles:

- `Reconnecting to backend…`
- `Back online — connection restored.`
- `Backend unavailable`
- CSS class prefix `backend-health-banner`

Example DOM when visible (from component markup):

```html
<div
  class="backend-health-banner backend-health-banner--connecting"
  role="status"
  aria-live="polite"
  aria-atomic="true"
  data-backend-health="connecting"
>
  <div class="backend-health-banner__inner">
    <span class="backend-health-banner__spinner" aria-hidden="true"></span>
    <p class="backend-health-banner__message">Reconnecting to backend…</p>
  </div>
</div>
```

---

## Accessibility verification

| Requirement | Implementation |
|-------------|----------------|
| `aria-live` | `polite` for connecting/offline/recovery; `assertive` for backend unavailable |
| `role="status"` | On banner root |
| `aria-atomic="true"` | Full message announced as one unit |
| Keyboard dismiss | Escape + dismiss button when `dismissible` (offline, unavailable) |
| `prefers-reduced-motion` | Spinner animation disabled; recovery fade transition removed |
| Focus-safe | Dismiss button `:focus-visible` outline; banner at top — does not steal focus on appear |
| Decorative icons | `aria-hidden="true"` on spinner/icons |

---

## Regression assessment

| Area | Risk | Verification |
|------|------|--------------|
| Upload logic | None | No upload files modified |
| Delete logic | None | No delete files modified |
| Sync logic | None | `studioSync.js`, `syncFromVault` untouched |
| API contracts | None | `api.js` unchanged |
| Polling / health checks | None | Banner only subscribes to existing store |
| Duplicate indicators | Low | Single mount in `Viewer.svelte`; grep shows no other `BackendHealthBanner` |
| GlobalOperationStatus | None | Still mounted separately for `uploadStatus` |
| Hero behavior | None | No HeroExperience changes for BG-7B.2 |
| Z-index conflicts | Low | 1240 (health) vs 1250 (operations) vs Studio 1500+ |

**Diff scope for BG-7B.2:** 2 new files + 2 lines in `Viewer.svelte` (import + mount).

---

## Success criteria

- ✅ One backend health component
- ✅ Zero new health systems
- ✅ Zero business logic changes
- ✅ Existing health state visible to users
- ✅ Automatic hide when healthy
- ✅ Non-blocking presentation layer
