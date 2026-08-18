# PRODUCT-08 — Connectivity UX + Large Hero Upload Acceptance

**Release context:** RC1-2026-07-18-001 (`RC1-STABLE`)  
**Date opened:** 2026-07-18  
**Classification:** Post-RC1 product/UX — **not an RC1 blocker**

---

## Executive summary

RC1 acceptance (BG-7W, RA-01, RA-02) passed on production with standard test assets. A follow-on characterization with `condo_v1_2.mp4` (~346–362 MB) exposed two **separate** production weaknesses that were hidden by smaller files:

1. **Connectivity state accuracy** — transient fetch aborts and initial `degraded` state surface as "Backend reconnecting…" while REST health is OK.
2. **Large hero upload characterization** — upload/ingest timing assumptions (120s ingest poll, 10–15m UI timeouts) are weak for 346MB assets.

Neither invalidates `RC1-STABLE`. Both require tracked post-RC1 work.

### Primary transport finding (2026-07-18 — interim)

Characterization run on `condo_v1_2.mp4` (362,155,056 bytes) through production hero vault:

| Phase | Result |
|-------|--------|
| `UPLOAD_STARTED` | ✅ |
| `UPLOAD_BYTES_SENT` | ✅ (26ms — file dispatched to pipeline) |
| `POST_COMPLETE` | ❌ **HTTP 502** at **elapsedMs: 300105** (~5m 0s), `reelId: null` |
| `INGESTION_STARTED` | ⏭ not reached (no reel id) |
| `RESTORE_COMPLETE` | ⏭ not reached |

**Classification:** **Case 1 — upload transport / gateway timeout**, not vault identity, not ingestion, not Svelte render loop.

Likely chain:

```text
Browser → POST /api/reels (346MB)
       → Netlify same-origin proxy (~300s boundary)
       → 502 Bad Gateway
       → backend never receives completed upload → no reelId
```

**RC1 impact:** None. RC1 gates used smaller assets; this is a post-release transport boundary.

Log: `/tmp/rc1-large-hero-char.log`  
Final artifact: `frontend/artifacts/rc1-large-hero-upload-characterization.json` (completed 2026-07-18T20:47:55Z)

---

## Independent PRODUCT-08 tracks (do not conflate)

```text
Track A — Large upload transport
--------------------------------
346MB POST /api/reels → 502 @ 300105ms → reelId=null
Classification: gateway/proxy lifetime boundary

Track B — Runtime connectivity UX
--------------------------------
"Backend reconnecting..." → recovered shortly after
Classification: frontend reconnect detection + fallback sync — backend available during event
```

**Timeline note (2026-07-18):** Reconnect banner appeared while characterization script was in its **post-502 wait window** (upload already finished; no ingestion in flight). Treat Track B as **likely unrelated** to Track A.

### Track B — captured evidence (2026-07-18)

**Observed:** Frontend displayed `"Backend reconnecting..."`, then recovered shortly after.

**Network during event:**

| Request | Result | Notes |
|---------|--------|-------|
| `POST https://strong-lolly-a9fcb4.netlify.app/api/sync/push` | **HTTP 200** | `x-railway-edge: lax1`, `x-railway-request-id` present |

**What this proves:**

```text
Netlify → Railway edge → backend → 200 OK
```

During the reconnect banner:

- ✅ Netlify routing worked
- ✅ Railway responded
- ✅ Sync push completed successfully

**Less likely:** backend outage, Railway crash, global network failure.

**Interpretation:** Banner reflects **frontend connection-state detection / fallback synchronization**, not backend unavailability. Likely sequence:

```text
Connection monitor detects missing/failed channel (possibly WS)
        → "Backend reconnecting..."
        → fallback sync (pushSyncState → POST /api/sync/push)
        → 200 OK
        → UI recovers
```

Code path (read-only reference): `frontend/src/lib/api/syncApi.js` → `pushSyncState()` → `POST /api/sync/push` via `fetchWithRetry`.

**Session volume clue (investigate next):** DevTools reported ~**1,914 requests / 44.51 MB / 3.07 min** during session. Question: normal page load vs reconnect/retry churn?

### Track B — next checks (no code changes)

1. **Filter Network → `sync`** — count `/api/sync/push` entries; note spacing (burst vs occasional).
2. **Network → WS** — confirm `wss://…/ws/control-center` failed/closed/reconnecting (Netlify WS limitation).
3. **`navigator.onLine`** when banner appears — expect `true`.
4. **API churn** — `performance.getEntriesByType("resource")` twice, 10s apart (see below).

No new entries between samples → HERO reactive diagnostics only. New `/api/` entries repeating → sync/retry storm (PRODUCT-08 Fix 1 territory).

Recovery after banner confirms retry/fallback path works — not permanent outage.

---

## Production architecture (clarified)

```text
Railway Backend (REST ✅, WS optional ❌ on Netlify)
        │
        ▼
Netlify Frontend (same-origin /api proxy)
        │
        ├── Hero upload: POST /api/reels (REST — not WS)
        └── Connectivity UI: fetchWithRetry + health store (retry-driven)
```

---

## Finding 1 — Connectivity state accuracy

### Symptom

UI shows `Backend reconnecting…` / `Reconnecting to backend…` while:

- `GET /api/health` → 200
- `GET /api/reels` → 200

### Root cause class

| Source | File | Mechanism |
|--------|------|-----------|
| Retry → reconnect event | `frontend/src/lib/api.js` | `fetchWithRetry()` catch → `notifyBackendReconnecting()` |
| Upload status mirror | `frontend/src/viewer/viewerContext.js` | Listens `reelforge:backend-reconnecting` → `uploadStatus` |
| Sync health gate | `frontend/src/viewer/viewerContext.js` | `syncFromVault()` → failed `checkBackendHealth()` → reconnecting copy |
| Initial degraded state | `frontend/src/lib/api.js` | `backendConnectionStatus` starts as `degraded` |
| Banner window | `frontend/src/components/viewer/BackendHealthBanner.svelte` | 5s reconnecting window per event |

**Key bug class:** `ERR_ABORTED` / navigation cancellation ≠ backend unavailable.

### Fix 1 (recommended)

In `fetchWithRetry()`, do **not** call `notifyBackendReconnecting()` for:

- `AbortError`
- `ERR_ABORTED`
- navigation teardown

### Fix 2 (recommended)

In `connectReelEventSocket()` (`frontend/src/lib/wsReelEvents.js`), skip WebSocket on Netlify static hosts (same guard as `USE_SAME_ORIGIN_API`). Netlify cannot maintain `wss://…/ws/control-center` (upgrade returns HTTP 400).

---

## Finding 2 — Large hero upload acceptance

### Asset

| Field | Value |
|-------|-------|
| File | `/home/youloose2dafish/Downloads/condo_v1_2.mp4` |
| Size | ~362,155,056 bytes (~346 MB) |
| Pipeline | Hero Background Vault → `POST /api/reels` → ingestion → hero restore |

### Dangerous window

```text
POST completes (may take many minutes for 346MB)
      │
      ▼
202 Accepted (async ingest)
      │
      ▼
ffmpeg processing (may exceed 120s default poll)
      │
      ▼
reel status = ready → hero identity + RESTORE_SUCCESS
```

### Current weak assumptions

| Layer | Assumption | Risk at 346MB |
|-------|------------|---------------|
| `pollIngestionUntilReady()` | 120s default timeout | Ingest may need minutes |
| `acceptHeroFile()` upload `withTimeout` | 10 min | POST through Netlify proxy may exceed |
| Mission validators | 15 min blind poll on localStorage | No phase visibility |

### Fix 3 (recommended)

Large upload acceptance should emit phased evidence:

```text
UPLOAD_STARTED
UPLOAD_BYTES_SENT
POST_COMPLETE
INGESTION_STARTED
INGESTION_COMPLETE
RESTORE_COMPLETE
```

Script: `frontend/scripts/mission-rc1-large-hero-upload-characterization.mjs`  
Artifact: `frontend/artifacts/rc1-large-hero-upload-characterization.json`

### Fix 4 (recommended — transport limit baseline)

Before changing upload handlers, establish a **size → outcome** ladder on production:

| Target size | Expected if ~300s proxy limit |
|-------------|----------------------------------|
| 20 MB | success |
| 50 MB | success |
| 100 MB | success |
| 200 MB | borderline |
| 346 MB (`condo_v1_2.mp4`) | **502 @ ~300s** (observed) |

Use same hero vault path; record `POST_COMPLETE.status` and `elapsedMs` only. No app patches until ladder confirms boundary.

---

## RC1 gate impact

| Gate | Status |
|------|--------|
| RC1-STABLE | ✅ Unchanged |
| BG-7W | ✅ |
| RA-01 | ✅ |
| RA-02 | ✅ |
| condo large-file characterization | ✅ **502 @ ~300s** — artifact complete (`pass: false`, expected) |

---

## Forensic signals (separate tracks — not one root cause)

| Signal | Status | Safe read |
|--------|--------|-----------|
| A) HERO_* log frequency | Investigating | Svelte `$:` diagnostic churn — **not proven infinite render loop** |
| B) THUMB_OWNER_VIOLATION | Investigating | `payloadSize: 0` → empty `[]` write outside vault guard — **not proven corruption**; need caller stack |
| C) fetchWithRetry timeout / reconnect UX | **Partially captured** | `POST /api/sync/push` **200** during banner — backend available; trigger likely WS/state + fallback sync |
| D) Empty hero IDs + mediaLoaded | Deferred | Resolver vs carousel measure different truths — **after transport baseline** |

---

## Recommended execution order (post-RC1)

1. ✅ Large upload characterization JSON — **complete** (`pass: false`, 502 @ 300105ms, ingest/restore blocked).
2. **Sync/push frequency measurement** — controlled run; record count, spacing, payload (see `PRODUCT-08B_SYNC_PUSH_MEASUREMENT.md`). Pattern A vs B discriminator — not a debugging session.
3. **Confirm WS state** — DevTools → WS → `wss://…/ws/control-center` (101/closed/reconnect vs none).
4. Capture `THUMB_OWNER_VIOLATION` caller + stack.
5. **Then** run size ladder (20→346 MB) — 346MB @ 300105ms already strong; reconnect UX affects normal users first.
6. Only then scope PRODUCT-08 patches. **No changes to `frontend/src/**`, `api.js`, `wsReelEvents.js` before steps 2–5.**

### Scoped hardening items

**PRODUCT-08A — Large hero upload transport**

Evidence: 346MB → `POST /api/reels` → 502 @ 300105ms → no reelId  
Likely fix class: upload strategy that avoids single long-lived edge request (not “fix vault pipeline”).

**PRODUCT-08B — Connectivity UX**

Evidence: “Backend reconnecting…” → `POST /api/sync/push` 200 → recovered  
Unknown: WS failure? sync churn? health monitor sensitivity?

---

## Related artifacts

| Artifact | Purpose |
|----------|---------|
| `frontend/RC1_LARGE_HERO_UPLOAD_CHARACTERIZATION.md` | Characterization report |
| `frontend/artifacts/rc1-large-hero-upload-characterization.json` | Timed phase evidence |
| `frontend/artifacts/mission-rc1-hero-vault-condo-v1-2.json` | Prior attempt (cancelled ~14m) |
