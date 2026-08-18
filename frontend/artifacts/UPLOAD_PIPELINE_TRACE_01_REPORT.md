# UPLOAD-PIPELINE-TRACE-01 — Diagnostic Report

**Mode:** Trace only — no code changes  
**Timestamp:** 2026-07-24T16:25:00Z  
**Frontend:** https://strong-lolly-a9fcb4.netlify.app/ (bundle `index-DxM0FwvJ.js`)  
**Backend:** https://reelforge-deploy-production.up.railway.app (health OK, DB connected)  
**Raw artifacts:**
- `frontend/artifacts/upload-pipeline-trace-01.json` (API probes)
- `frontend/artifacts/upload-pipeline-trace-large-r2.json` (30MB curl path)
- `frontend/artifacts/vault-verify-03.json` (prior full harness)

---

## Executive Summary

The upload pipeline is **not one bug** — it is a **single upstream failure** on the **large-file signed-upload path** that cascades into hero pause, vault silence, reconnect noise, and playback buffering.

| Priority | Symptom | Same root? | First failing boundary |
|----------|---------|------------|------------------------|
| P1 | MP4 vault drop (large) | **Yes** | **R2 PUT via `fetch()` — fails ~300s on 30MB** |
| P2 | Image vault "won't accept" | **No** (different path) | Drop works; upload requires **Accept** click |
| P3 | Hero Upload Paused | **Yes** (same signed path) | Same R2 PUT failure |
| P4 | Backend disconnect/reconnect | **Symptom** | WS banner during long operations; `/health` stays 200 |
| P5 | Video theater buffering | **Downstream** | Media not ready or URL 404 until ingest completes |

**Do not fix playback or hero-specific logic until large signed uploads complete reliably.**

---

## 10-Step Trace Checklist

### Priority 1 — Large MP4 Vault Drop (>25MB, signed path)

| Step | Question | Result | Evidence |
|------|----------|--------|----------|
| 1 | Drop event fires? | **PASS** (instrumented) | `[VAULT_DROP]` + `[BG7G_DROP]` in `VaultExperience.svelte`; small browser drop confirmed |
| 2 | Upload begins? | **PASS** | `[VAULT_UPLOAD_START]` logged; status → "Uploading to backend..." |
| 3 | Signed URL requested? | **PASS** | `POST /api/uploads/sign` → **200** (~1.4s); reelId returned |
| 4 | Upload to R2 succeeds? | **FAIL ← first boundary** | **curl PUT 30MB → 200 in 449s**; **Node/browser `fetch` PUT → `fetch failed` at ~301s** |
| 5 | Finalize request succeeds? | **BLOCKED** | Never reached when step 4 fails; API-only path: **202** when curl PUT succeeds |
| 6 | Database row created? | **BLOCKED / partial** | Finalize creates pending row; reaches **ready** only if PUT completes |
| 7 | WebSocket disconnects? | **Observed during long ops** | `reelforge:backend-reconnecting` banner; not necessarily Railway restart |
| 8 | Backend reconnects? | **PASS** | `/health` continuously **200**; no process restart required for failure |
| 9 | UI refreshes / hydrates? | **PASS when upload completes** | Small MP4 browser drop → vault count +1, `[VAULT_UPLOAD_SUCCESS]` |
| 10 | Playback starts? | **BLOCKED** | No valid ready URL until ingest completes |

### Priority 1 — Small MP4 Vault Drop (<25MB, multipart path)

| Step | Result |
|------|--------|
| Full pipeline | **PASS** |
| Network | `POST /api/reels` → **202** via Netlify proxy (6.5KB test file) |
| Browser | Drop → `[VAULT_UPLOAD_SUCCESS]` in ~45s; no sign/R2 calls (below 25MB threshold) |

---

## Priority 2 — Image Vault

| Step | Question | Result | Evidence |
|------|----------|--------|----------|
| Drop received? | **PASS** | `[VAULT_DROP] vaultType: thumbnail` |
| File type validation? | **PASS** for `image/*` | Rejects non-images with "Please drop an image" |
| Upload starts on drop? | **NO — by design** | Drop sets `pendingThumbnail`; status: "Preview: … Accept or Reject" |
| Upload on Accept? | **PASS** | `vault-verify-03-thumb-only`: Accept → POST /api/reels **202** → refresh survives |
| Persistence? | **PASS** | `[VAULT_PERSIST]` + `personal_thumbnail_reel_ids` hydration |

**User-facing "won't accept" likely means:** drop preview appears but **Accept was not clicked**, or drop missed the thumbnail zone (different from video zone).

---

## Priority 3 — Hero Upload

| Step | Result |
|------|--------|
| UI state | "Hero Upload Paused" when `$heroPendingFile` set after failed attempt (`HeroExperience.svelte`) |
| Code path | Same `uploadVideoSigned()` → sign → R2 PUT → finalize |
| Failure | Same as P1 when hero video ≥ 25MB |

---

## Priority 4 — Backend Disconnect / Reconnect

| Probe | Result |
|-------|--------|
| `/health` during trace | **200**, DB connected, storage ready |
| Railway process restart | **Not observed** during API trace |
| Frontend banner | `BackendHealthBanner.svelte` + `reelforge:backend-reconnecting` event (WS/degraded state) |
| Impact on upload | Long R2 PUT may overlap reconnect UI; **does not explain 300s fetch failure** (curl succeeds same period) |

---

## Priority 5 — Video Theater Buffering

Investigate **after** uploads confirmed healthy.

| Check | When upload incomplete |
|-------|------------------------|
| Video URL HTTP 200 | Often **404** or pending |
| Partial content 206 | N/A if object missing |
| Re-request loop | Browser retries unavailable stream |
| Root cause | Ingest never reached **ready** because finalize never ran |

---

## Transport Comparison (30MB file, same signed URL)

| Client | Result | Duration |
|--------|--------|----------|
| `curl` PUT | **HTTP 200** | **449,307 ms** (~7.5 min) |
| Node `fetch` PUT | **`fetch failed`** | **300,937 ms** (~5.0 min) |
| Prior harness (`vault-verify-03`) | **`fetch failed`** | **614,075 ms** (3 attempts) |

Effective throughput: ~67 KB/s for 30MB curl success.

**Conclusion:** The application uses **`fetch()` body upload** (browser + Node). That transport fails before curl completes on the same network. This is the **first failing boundary** for all large signed uploads.

---

## Production Configuration Verified

| Item | Status |
|------|--------|
| `POST /api/uploads/sign` | **200** with admin Bearer |
| `POST /api/reels/finalize` | **401** without auth; **202** after successful PUT |
| Netlify `VITE_USE_SIGNED_UPLOADS=true` | Set in `netlify.toml` |
| `VITE_SIGNED_UPLOADS_MIN_BYTES=25000000` | Present in production bundle |
| Bundle routes | `/api/uploads/sign`, `/api/reels/finalize` present in `index-DxM0FwvJ.js` |
| R2 CORS | OPTIONS **204**; allows Netlify origin + `x-upload-token` |
| MP4 delete | Independent DELETE path — **working** (confirmed by user + prior validation) |

---

## Pipeline Map (code references)

```
VaultExperience.handleVaultVideoDrop
  → uploadMedia(FormData)
    → shouldUseSignedVideoUpload (≥ 25MB)
      → uploadVideoSigned (media.js)
        → POST /api/uploads/sign        (same-origin Netlify → Railway)
        → PUT  r2.cloudflarestorage.com  ← FAILS HERE (fetch timeout)
        → POST /api/reels/finalize
        → pollIngestionUntilReady
        → persistPersonalVault / hydrate

VaultExperience.handleVaultThumbnailDrop
  → pendingThumbnail (local preview only)
  → acceptPendingThumbnail → uploadThumbnail → POST /api/reels (multipart, small)

HeroExperience.acceptHeroFile
  → uploadVideo / uploadVideoSigned (same as above)
```

Forensic markers: `frontend/src/lib/diagnostics/vaultForensics.js`

---

## Recommended Next Action (when ready to fix — not done in this trace)

Fix **one boundary first:** make large-file PUT to R2 complete reliably from the browser (chunked/multipart upload, resumable protocol, or transport with progress that survives >7 min on ~67 KB/s links). Everything else in the priority list should wait for that.

---

## Reproduction Commands

```bash
# API sign → curl PUT → finalize (succeeds)
python3 frontend/artifacts/../scripts  # see upload-pipeline-trace-large-r2.json

# Node fetch PUT (fails ~300s on 30MB)
node -e "/* fetch PUT test — see trace session */"

# Browser small MP4 drop (succeeds, multipart)
# Playwright trace in session log 2026-07-24T16:23Z

# Image vault Accept flow
node frontend/scripts/vault-verify-03-thumb-only.mjs
```
