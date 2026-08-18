# PRODUCT-08B — Sync/Push Frequency Measurement

**Release context:** RC1-2026-07-18-001 (`RC1-STABLE`)  
**Phase:** Measurement (not debugging)  
**Purpose:** Discriminate Pattern A (noisy UX) vs Pattern B (sync/reconnect storm)

### Evidence source (mandatory)

```text
Browser → Netlify frontend → Netlify routing/proxy → Railway backend
         → WS fallback + sync/push recovery
```

| Allowed | Forbidden for 08B evidence |
|---------|----------------------------|
| `https://strong-lolly-a9fcb4.netlify.app/` | `localhost` / `127.0.0.1` frontend |
| `wss://strong-lolly-a9fcb4.netlify.app/ws/control-center` | Local WS or direct Railway-only topology |

Local is **implementation/verification only after** a classified, approved patch — not an evidence source for this phase.

### Single discriminating question

> **Is the reconnect event causing excessive synchronization activity?**

Out of scope for this run:

- Why is the app reconnecting?
- Should we rewrite sync?
- Should we change retry logic?

Those are downstream decisions after Pattern A/B + WS confirmation.

---

## Baselines (closed)

### PRODUCT-08A — Large hero transport ✅

```text
Input:     362,155,056 bytes (condo_v1_2.mp4)
Observed:  POST /api/reels → 502 @ 300105ms → reelId=null
Conclusion: Edge request lifetime exceeded
Artifact:  frontend/artifacts/rc1-large-hero-upload-characterization.json
Status:    Baseline complete
```

### PRODUCT-08B — Connectivity UX (measurement phase)

```text
Observed:  "Backend reconnecting..." → POST /api/sync/push 200 → recovery
Conclusion: Backend available during event; cause unknown
Status:    Measurement phase (this document)
```

**Do not conflate 08A with 08B.** Prior session `1,914 requests / 44.51 MB / 3.07 min` includes all page activity — sync count must be measured in isolation.

---

## Exit criteria (defined before measurement)

Evaluate the completed worksheet against this table. **Do not reinterpret after the fact** — pick the first matching row.

| If the measurement shows… | PRODUCT-08B scope |
|---------------------------|-------------------|
| Pattern A, quick recovery, low sync count, expected WS fallback | **1 — UX refinement only** (banner timing/messaging) |
| Pattern A, but banner remains visible well after successful `/api/sync/push` | **2 — Connection-state clearing logic** |
| Pattern B with frequent `/api/sync/push` bursts | **3 — Retry/sync coordination** (investigate before changing UX) |
| Unexpected WS behavior (not matching expectations) | **Investigate connection-state source** before modifying retries |

**Scope summary after sign-off:**

| # | Scope | Typical change class |
|---|-------|----------------------|
| 1 | Small UX adjustment | Banner copy, timing, sensitivity |
| 2 | Connection-state synchronization fix | Clear banner when backend confirmed |
| 3 | Retry/sync coordination issue | Throttle, debounce, ownership |

RC1 baseline remains frozen until scope is selected from evidence.

---

## Evidence gap closure (read-only)

Prior attempt lacked a shared event clock. Fill every worksheet field from **one** tab using:

1. DevTools Network + WS (authoritative HTTP/WS timing)
2. Console-only DOM observer (banner appear/disappear) — [`scripts/product-08b-console-observer.snippet.js`](scripts/product-08b-console-observer.snippet.js)
3. Optional post-hoc Performance resource count — [`scripts/measure-sync-push-frequency.mjs`](scripts/measure-sync-push-frequency.mjs)

**Do not** rebuild with `VITE_DEBUG_API`, patch `fetch`/`WebSocket`, or modify application files.

### Two UI signals (do not conflate)

| Signal | Exact text | Source |
|--------|------------|--------|
| Operation status (worksheet **banner**) | `Backend reconnecting...` | `viewerContext.js` → `GlobalOperationStatus` |
| Top health banner (secondary) | `Reconnecting to backend…` | `BackendHealthBanner` / `backendHealthPresentation.js` |

Worksheet rows 1 and 3 use the **operation status** signal.

### Capture checklist

#### Before event

- [x] One production tab only (Playwright capture)
- [x] Network log cleared (fresh context + HAR)
- [x] Preserve log enabled (HAR full mode)
- [x] Disable cache enabled (new context)
- [x] Start Time, Duration, Status, Size columns visible (script-recorded equivalents)
- [x] No Network text filter at start (HTTP + WS share one timeline)
- [x] WS request view ready for `wss://strong-lolly-a9fcb4.netlify.app/ws/control-center`
- [x] Console timestamps + Preserve log enabled (observer events)
- [x] Console observer pasted (`product-08b-console-observer.snippet.js`) → `window.__product08bCapture`
- [x] Capture start time recorded (`2026-07-19T10:28:32.341Z`)
- [x] Do **not** reload merely to force reconnect

#### During event

- [x] Exact operation-status appearance recorded (`Backend reconnecting...`)
- [x] Top health-banner state recorded separately if present
- [x] Filter Network to `sync` **without clearing**
- [x] Every `POST /api/sync/push`: start time, status, duration, request body size when shown
- [x] WS attempt / open / error / close (+ code/reason, or `unavailable`)
- [ ] Exact operation-status disappearance recorded (**not observed**; still visible at end)
- [x] No artificial reconnect introduced

#### After event

- [x] Export HAR with content
- [x] Save WS Headers/Timing/Messages (HAR may omit frames)
- [x] Copy `window.__product08bCapture.out`
- [x] Event window = operation-status appear → capture end (disappear pending)
- [x] Include only `/api/sync/push` whose **request start** falls in that window
- [x] Calculate count, first/last, first→last duration, first 200, gaps, avg/min/max (N/A if &lt;2 requests)
- [x] Correlate WS by timestamp to the same window
- [x] Fill template below; Pattern A/B + confidence only when thresholds match

### Automated capture helper (optional)

```bash
cd frontend
node scripts/mission-product-08b-reconnect-capture.mjs
# WAIT_MS=180000 optional
```

Writes `artifacts/product-08b-reconnect-capture.json` + `.har`. Still validate against this checklist before sign-off.

---

## Controlled measurement run (one event)

Collect **one complete, high-quality reconnect event** — not partial observations.

### Capture protocol

- Use **one browser tab** only (background tabs generate extra sync traffic).
- Start or **clear** the Network log immediately before the event so the request count reflects only that reconnect episode.
- Note **approximate local time** of the event (enables correlation with frontend logs, backend logs, or Railway request IDs later).

### Browser setup

DevTools → Network:

- [ ] Preserve log
- [ ] Disable cache
- [ ] Log cleared (or started fresh) for this event
- Start with **no** filter (shared HTTP+WS timeline); filter `sync` only after the event appears

Wait for:

```text
Backend reconnecting...
```

Then capture immediately.

### Single-event capture template

Fill all fields for **one** reconnect event:

| # | Metric | Timestamp / value |
|---|--------|-------------------|
| 1 | Banner appeared | `2026-07-19T10:28:45.873Z` (operation status: `Backend reconnecting...`) |
| 2 | First `POST /api/sync/push` 200 | `2026-07-19T10:28:57.129Z` (request start `10:28:56.996Z`) |
| 3 | Banner disappeared | **Not observed** — still visible at capture end `2026-07-19T10:31:48.040Z` |
| 4 | `/api/sync/push` count | **102** (event window: appear → capture end) |
| 5 | First request timestamp | `2026-07-19T10:28:56.996Z` |
| 6 | Last request timestamp | `2026-07-19T10:31:47.257Z` |
| 7 | Pattern | `[ ] A  [x] B` |
| 8 | WS state | `[ ] 101  [ ] closed  [x] failed  [ ] no WS activity` |

Secondary (not worksheet banner): top health banner `Reconnecting to backend…` appeared `10:28:51.595Z`, disappeared `10:28:53.405Z` (~1.8s).

#### Derived deltas

```text
Banner → first sync/push 200:  11123 ms
Banner → banner disappeared:   ≥182167 ms (minimum; natural clear not observed)
First → last sync/push:        170261 ms
Average interval:              1686 ms
Longest gap:                   2271 ms
Shortest gap:                  64 ms
Status codes in window:        200 only
Payload sample:                18168 bytes request body
```

| Delta | Why it helps |
|-------|--------------|
| Banner → first sync/push 200 | Was sync recovery immediate or delayed? |
| **Banner → banner disappeared** | Brief expected reconnect vs prolonged degraded state — objective baseline for future UX changes |
| First → last sync/push | Spread vs burst (Pattern A vs B) |

#### Optional context

| Field | Value |
|-------|-------|
| Event local time (approx) | 2026-07-19 ~10:28:45Z |
| Session start (UTC) | `2026-07-19T10:28:32.341Z` |
| `navigator.onLine` during banner | not recorded |
| Artifact | `artifacts/product-08b-reconnect-capture.json` |
| HAR | `artifacts/product-08b-reconnect-capture.har` |

#### Single request sample (optional)

Pick one `POST /api/sync/push`:

| Field | Value |
|-------|-------|
| Status | 200 |
| Request payload size (approx) | 18168 bytes |
| Response size (approx) | see HAR |
| Timing — Waiting (TTFB) | see HAR |
| Timing — Content Download | durationMs ≈ 133 (first in-window 200) |

---

## What this answers (no code changes required)

| Question | Field(s) |
|----------|----------|
| Is recovery immediate or prolonged? | Banner → first sync/push 200; banner → banner disappeared |
| Does sync activity spike? | Count + first → last spread |
| Is WebSocket failure correlated with the banner? | WS state (same event) |
| Is the banner lagging behind a successful recovery? | Compare banner disappeared vs first sync/push 200 |

---

## Interpretation matrix

| Pattern | Sync push count | Spacing | Classification | Priority |
|---------|-----------------|---------|----------------|----------|
| **A — Normal fallback** | 1–5 per reconnect | minutes apart | Noisy indicator; fallback works | Low — UX polish |
| **B — Reconnect storm** | tens–hundreds+ | seconds apart | Connection transition amplifies sync | High — PRODUCT-08 item |

---

## WS confirmation (same event)

Network → **WS** during the same reconnect:

| Field | Value |
|-------|-------|
| URL | `wss://strong-lolly-a9fcb4.netlify.app/ws/control-center` |
| Attempt | `2026-07-19T10:28:42.462Z` (~3411 ms **before** operation-status banner) |
| Open | attempted / ephemeral |
| Error | `2026-07-19T10:28:42.562Z` |
| Close | `2026-07-19T10:28:42.562Z` |
| Close code / reason | **unavailable** (no close frame exposed) |
| Outcome | **failed** (row 8) |
| Correlation | WS fail precedes banner by ~3.4s; HTTP `/api/sync/push` 200s continue during banner |

**Expected on Netlify:** connect attempt → close/fail → HTTP sync fallback succeeds.

---

## Post-measurement evaluation

1. Capture one complete reconnect event.
2. Fill the worksheet.
3. Match the predefined exit criterion.
4. Assign a confidence level (below).
5. If confidence is **High** → scope the smallest PRODUCT-08B change.
6. If confidence is **Medium** or **Low** → collect one more reconnect event before modifying code.

Apply [exit criteria](#exit-criteria-defined-before-measurement) to the completed template. Do not scope patches outside the matched row.

### Confidence assessment

Guards against patching from one atypical event.

| Confidence | Meaning | Next action |
|------------|---------|-------------|
| **High** | Event clearly matches one exit criterion with no conflicting evidence. | Proceed to scope PRODUCT-08B implementation. |
| **Medium** | Mostly matches one criterion, but one observation is ambiguous. | Capture one additional reconnect event before changing code. |
| **Low** | Conflicting or incomplete evidence. | Do not patch; investigate the missing signal first. |

**Patch boundary until sign-off complete:**

- Do not modify `frontend/src/lib/api.js`
- Do not modify `frontend/src/lib/wsReelEvents.js`
- Do not modify `frontend/src/lib/sync/studioSync.js`

---

## Optional: console post-hoc count (read-only)

After session, paste in DevTools Console:

```javascript
// See: frontend/scripts/measure-sync-push-frequency.mjs (reference output shape)
```

Or run from repo:

```bash
node frontend/scripts/measure-sync-push-frequency.mjs
```

(Helper for documenting methodology — does not patch application code.)

---

## Sign-off

| Measured by | Date (UTC) | Pattern A / B | Banner duration | WS outcome | Exit criteria match (1 / 2 / 3 / investigate) | Confidence (H / M / L) | Next action |
|-------------|------------|---------------|-----------------|------------|-----------------------------------------------|------------------------|-------------|
| Event 1 Netlify capture | 2026-07-19 | incomplete | clear not observed | partial | — | **L** | Topology valid; observability incomplete |
| Event 2 Netlify capture | 2026-07-19 | **B** (157 pushes / 277s ≈1.8s) | op-status clear not observed; health banner cleared | failed (temporal only) | **3** | **H** (post root-cause + containment) | Deploy patch → Netlify replay vs Event 2 |
| Synthetic containment verify | 2026-07-19 | — | — | — | supports 3 | — | 201→2 simulated pushes; suppress OK |

---

## Evidence snapshot (fill at next session start)

Concise synthesis before any implementation discussion. No new investigation — assemble the three artifacts only.

| Artifact | Finding | Confidence | Drives decision? |
|----------|---------|:----------:|:----------------:|
| 08A characterization JSON | 346 MB upload → HTTP 502 @ ~300 s, no `reelId`, ingest/restore blocked | High | ✅ |
| 08B worksheet | Pattern **B**: 102× `/api/sync/push` @ ~1.7s avg; banner ≥182s; natural clear not seen | Medium | ✅ |
| DevTools Network + WS / capture JSON+HAR | WS failed @ `10:28:42.562Z`; sync storm during open reconnect window | Medium | ✅ |

**08A baseline:** `frontend/artifacts/rc1-large-hero-upload-characterization.json`

### Evaluation (in order)

1. **Which exit criterion matched?**
2. **Why is the confidence High / Medium / Low?**
3. **What is the smallest component or module that must change?**
4. **How will success be verified against the original measurement?**

### Non-goals (if confidence is High)

- No changes to upload transport (08A)
- No changes to hero asset resolution
- No changes outside the identified PRODUCT-08B branch
- No behavioral changes to the validated RC1 pipeline

```text
Observation → Measurement → Classification → Confidence → Minimal implementation → Verification
```
