# MISSION BG-5B — Canonical Reel Resolution Forensics

**Date:** 2026-07-13  
**Scope:** Diagnostics only — no repairs, no refactors, no state/architecture changes  
**Premise:** POST `/api/reels` succeeds (202), backend emits `ReelEvent::Created`, placeholder never becomes canonical video.

---

## Executive Verdict (One Function · One Line · One Condition)

### MP4 Vault (grid ▶ placeholder)

| | |
|---|---|
| **Function** | `VaultExperience.svelte` template branch |
| **Line** | **1579** `{#if isVideo(reel) && reel.url}` → **1608** `{:else}` ▶ placeholder |
| **Condition** | `!(isVideo(reel) && reel.url)` evaluates **true** |
| **Why it never executes canonical attach** | `getVaultVideoReel()` → `isVideoReel()` returns **false** when `reel.url` is empty **or** lacks `/videos/` + video extension (e.g. `/thumbs/...` only). `MediaRenderer` + `VIDEO_ATTACHED` never mount. |

### Hero (background / “Processing hero asset…” / fallback)

| | |
|---|---|
| **Function** | `HeroExperience.svelte` reactive `$: heroRenderVideo` |
| **Line** | **134–140** |
| **Condition** | `heroUsesImageBackground === true` → **`heroRenderVideo = ''`** |
| **Why canonical video never attaches** | `heroManagerConfig` is initialized once (`let heroManagerConfig = loadHeroManagerConfig()` line **64**) and **not reassigned** after `saveHeroManagerConfig()` in `acceptHeroFile()`. Stale `backgroundSource: 'custom_image'` keeps `heroUsesImageBackground` true even though `HERO_BACKGROUND_VIDEO.set(reel.url)` ran. Downstream **`prioritizedHeroVideo`** empty → **`activeHeroMediaMode !== 'video'`** → hero `<MediaRenderer>` never mounts → **`VIDEO_ATTACHED` never fires**. |

---

## 1. Timeline: 202 Accepted → VIDEO_ATTACHED

```text
T0  POST /api/reels
      └─ 202 Accepted { id, status:"pending", videoUrl, pollUrl }
      └─ [REEL_RES] ENTRY createReel → pollIngestionUntilReady(reelId)

T1  pollIngestionUntilReady (ingestPoll.js)
      └─ GET /api/reels/{id}  every 800ms, max 120_000ms
      └─ [REEL_RES] REEL pollBody { parsedStatus, nestedReelStatus, bodyKeys }
      └─ Loop until body.status === "ready" | "failed" | timeout

T2  Backend worker (parallel)
      └─ ffmpeg thumbnail → mark_ready → publish_reel_ready
      └─ [PIPELINE] EVENT_EMITTED event_type=CREATED
      └─ WebSocket /ws/control-center → eventType CREATED

T3  poll sees status === "ready"
      └─ pollPayload { id, url: body.url, ... }  ← ONLY top-level body.url (no videoUrl fallback)
      └─ [REEL_RES] ENTRY normalizeReel endpoint=ingest-poll
      └─ [REEL_RES] EXIT normalizeReel { url, thumbnailUrl, status }
      └─ createReel returns normalized reel

T4a HERO PATH                          T4b MP4 VAULT PATH
      acceptHeroFile                         handleVaultVideoDrop
      heroReelFromUploadResponse             resolvedUrl = response.url || videoUrl
      saveHeroReel + HERO_BACKGROUND_VIDEO   reelToVaultEntry → personalVideos.update
      heroRenderVideo STALE (line 134)       {#if isVideo(reel) && reel.url} (line 1579)

T5  WebSocket (may arrive before/after T3)
      connectReelEventSocket.onmessage
      normalizeReel(msg, "WS CREATED")
      viewerContext onCreated → syncFromVault(true)
      └─ Does NOT set HERO_BACKGROUND_VIDEO
      └─ Filters hero assets from personal_video_vault merge

T6  VIDEO_ATTACHED (expected)
      Hero: on:loadedmetadata → handleHeroVideoLoad     ← SKIPPED if heroRenderVideo ""
      Vault: on:loadeddata on grid MediaRenderer         ← SKIPPED if isVideo(reel) false
```

---

## 2. pollIngestionUntilReady() — Inspection

| Question | Answer |
|----------|--------|
| **Endpoint** | `GET ${API_BASE_URL}/api/reels/${reelId}` (`ingestPoll.js:35`) |
| **Frequency** | **800ms** default (`DEFAULT_POLL_MS`) |
| **Stop conditions** | `body.status === 'ready'` → return normalized; `'failed'` → throw; else sleep and repeat |
| **Timeout** | **Yes — 120_000ms** (`DEFAULT_TIMEOUT_MS`) → throws *"Ingestion timed out waiting for ready status"* |
| **Receives READY?** | When backend `row.status == "ready"`. Backend flattens `ReelV1` into JSON via `ReelStatusResponse` (`reel_contract.rs:30-36`). Poll reads **`body.status` at top level only** — logs `nestedReelStatus` for forensics if mismatch. |
| **Who consumes READY?** | `createReel()` → caller (`acceptHeroFile` / `handleVaultVideoDrop`) |
| **If READY never arrives on poll but CREATED fires** | Client may have **already thrown timeout** at T1 while worker completes at T2. WS `onCreated` runs `syncFromVault` but **does not patch Hero store** and **may not fix vault entries** already inserted with empty `url`. |

### Poll → normalize payload gap (diagnostic)

When `status === 'ready'`, poll builds payload using **`body.url` only** (`ingestPoll.js:67-76`). It does **not** map `body.videoUrl`. If poll body ever lacks top-level `url` (contract drift), `normalizeReel` → `fromLegacy` may still recover via `video_url`/`videoUrl` **only if those fields exist on `body`**. Instrumentation logs `preNormalize` vs `postNormalize` snapshots.

---

## 3. WebSocket — ReelEvent::Created

| Item | Detail |
|------|--------|
| **Emitter** | `reel_contract.rs::publish_reel_ready` → `event_bus.publish(Created)` |
| **Payload** | Full `ReelV1` + `eventType: "CREATED"` (`reel_created_ws_json`) |
| **Listener** | `connectReelEventSocket` → `handlers.onCreated` registered in `viewerContext.js:1636` |
| **Ignores Hero?** | **No** — `onCreated` always runs. `isHeroAsset(reel)` logged but **does not return early**. |
| **Ignores MP4?** | **No** — same handler for all CREATED events. |
| **What it does** | `syncFromVault(true)` + `dispatchEvent('reelforge:upload-updated')` |
| **What it does NOT do** | Does **not** call `HERO_BACKGROUND_VIDEO.set`, does **not** replace vault card DOM directly, does **not** refresh in-memory `heroManagerConfig` |

3s cooldown per reelId may skip duplicate sync (`wsCreatedSyncCooldownByReel`).

---

## 4. normalizeReel() — Early Returns & Empty Fields

| Branch | Line | Returns | When |
|--------|------|---------|------|
| `early_return_null_not_object` | ~178 | `null` | `!raw \|\| typeof raw !== 'object'` |
| `direct_contract_path` | ~186 | merged | `raw.url && (raw.name \|\| raw.title)` |
| `fromLegacy_path` | ~205 | merged | otherwise — maps `videoUrl`, `video_url`, `url`, etc. |
| `early_return_null_status_gate` | ~218 | `null` | `status !== 'ready'` AND endpoint not in `ingest-poll` / `WS CREATED` / `GET /api/reels` |

### Can normalizeReel produce empty fields?

| Field | Yes? | Mechanism |
|-------|------|-----------|
| `url=""` | **Yes** | `resolveMediaUrl('')` → `''`; legacy path with no video/thumb fields |
| `url=null` | Coerced to `""` in contract strings |
| `thumbnailUrl=""` | **Yes** | Video type with no thumb raw → `thumbnailUrl: ''` (line ~196-200) |
| `videoSrc undefined` | N/A at normalize layer; UI reads `reel.url` |
| `missing id` | **fromLegacy** generates `crypto.randomUUID()` if absent; direct path requires `raw.id` |
| `category mismatch` | Defaults `'Trending'`; Hero upload sends `'HERO'` — affects `isHeroAsset()` vault block only |

All branches logged via `[REEL_RES] NORMALIZE_BRANCH` and `[REEL_RES] REEL normalizeReel:result`.

---

## 5. Store Mutations After Upload

| Store / LS key | Hero trigger | MP4 Vault trigger | WS/sync trigger |
|----------------|-------------|---------------------|-----------------|
| `HERO_BACKGROUND_VIDEO` | `acceptHeroFile` L1152 `.set(reel.url)` | — | **None** |
| `reelforge_hero_reel` | `saveHeroReel(reel)` | — | **None** |
| `reelforge_hero_manager_config` | `saveHeroManagerConfig()` | — | **None** (in-memory `heroManagerConfig` **stale**) |
| `personalVideos` | — | `handleVaultVideoDrop` L914 `.update` | `syncFromVault` merge |
| `personal_video_vault` | — | `persistPersonalVault` | `syncFromVault` |
| `reelforge_feed` | — | `distributeVideoToFeed` | `syncFromVault` |

Instrumentation: `[REEL_RES] STORE {label}` with oldValue/newValue/trigger.

---

## 6. Placeholder Replacement — Expected vs Actual

### What *should* replace the placeholder?

| Surface | Function | Line | Condition for canonical media |
|---------|----------|------|------------------------------|
| **MP4 vault grid** | Template `{#if isVideo(reel) && reel.url}` | **1579** | `isVideoReel(reel) && reel.url` truthy |
| **Hero stage** | Reactive `$: activeHeroMediaMode = 'video'` | **280–281** | `prioritizedHeroVideo` truthy + not failed |
| **Feed cards** | `AI_CLEANUP_AGENT.distributeVideoToFeed` | aiCleanupAgent.js ~195 | Inserts non-placeholder reel — **does not control vault ▶** |

### Why replacement never executes

**Vault:** Entry reaches `personalVideos` but **`reel.url` empty** or **`isVideoReel` false** → branch at **1579** false → **1608** ▶ persists.

**Hero:** `HERO_BACKGROUND_VIDEO` updated but **`heroRenderVideo` reactive (134–140)** returns `''` because stale **`heroManagerConfig.backgroundSource === 'custom_image'`** → **`activeHeroMediaMode`** stays `'fallback'/'image'` → video node not in DOM.

---

## 7. Deliverables Summary

| # | Item | Finding |
|---|------|---------|
| **1** | Timeline | See §1 above |
| **2** | First missing **event** | **`VIDEO_ATTACHED`** — neither Hero `loadedmetadata` nor Vault `loadeddata` fires because canonical `<MediaRenderer>` never mounts |
| **3** | First missing **store mutation** | Store writes **occur** (`HERO_BACKGROUND_VIDEO`, `personalVideos`). **Missing reactive propagation:** in-memory **`heroManagerConfig` not refreshed** after `saveHeroManagerConfig` |
| **4** | First missing **UI update** | **`activeHeroMediaMode` / vault `{#if isVideo(reel) && reel.url}`** — render gate stays on placeholder branch |
| **5** | Canonicalization stop point | **Hero:** `HeroExperience.svelte:138-139` `heroUsesImageBackground ? ''`. **Vault:** `VaultExperience.svelte:1579` `isVideo(reel) && reel.url` |

---

## 8. Ranked Root Causes (given POST + CREATED confirmed)

1. **Hero render gate uses stale `heroManagerConfig`** (line 64 init, no reload after accept) → `heroRenderVideo=""` despite store update.
2. **Vault grid gate `isVideo(reel) && reel.url`** — empty or non-`/videos/` url in vault entry after upload normalize path.
3. **Poll/client timeout before READY** while WS CREATED arrives later — upload path aborted; WS sync doesn't repair Hero or empty-url vault rows.
4. **Poll `body.url`-only extraction** — if status poll JSON lacks top-level `url`, normalize yields empty url (logged via `[REEL_RES]`).
5. **`isHeroAsset` vault block** (line 901) — only when category/id matches hero domain; blocks vault insert, not hero path.

---

## 9. Instrumentation Added (BG-5B)

| Module | Prefix | Purpose |
|--------|--------|---------|
| `reelResolutionTrace.js` | `[REEL_RES]` | ENTRY / EXIT / EXCEPTION / STORE / REEL snapshots |
| `ingestPoll.js` | `[REEL_RES]` | Poll loop body + pre/post normalize |
| `reelContract.js` | `[REEL_RES]` | normalizeReel branches + results |
| `wsReelEvents.js` | `[REEL_RES]` | WS payload + normalize + delivery |
| `heroReelIdentity.js` | `[REEL_RES]` | heroReelFromUploadResponse |
| `VaultExperience.svelte` | `[REEL_RES]` | upload response, vaultEntry, personalVideos |
| `HeroExperience.svelte` | `[REEL_RES]` | created reel, HERO_BACKGROUND_VIDEO mutation |
| `viewerContext.js` | `[REEL_RES]` | onCreated + hero filter audit |
| `api/reels.rs` | `[PIPELINE] POLL_STATUS_RESPONSE` | backend poll payload |
| `reel_contract.rs` | `[PIPELINE] EVENT_EMITTED` | CREATED payload fields |

### Operator trace command

```bash
# Browser console filter:
[REEL_RES]

# Backend:
tail -f .dev-logs/backend-latest.log | rg 'POLL_STATUS_RESPONSE|EVENT_EMITTED'
```

**Success criterion:** Reproduce upload; last `[REEL_RES]` before UI stall identifies exact gate. Expected last logs before failure:

- Hero stall: `STORE HERO_BACKGROUND_VIDEO` (new url set) → **no** `VIDEO_ATTACHED` → check `heroManagerConfigInMemory` in STORE log.
- Vault stall: `STORE personalVideos` with `entryUrl:""` OR `vaultEntry.isVideoUrl:false` → `{#if isVideo(reel) && reel.url}` false.

---

## 10. Validation

- `cargo check` ✅
- `npm run build` ✅
- No business logic, state, or architecture changes — logging only (+ read-only poll body field logging)
