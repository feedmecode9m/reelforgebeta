# PHASE-HERO-REPLACE-VALIDATION — Report

**Mission:** Read-only validation that explicit Replace Hero still works under PHASE-HERO-LOCK-1 durable override.  
**Date:** 2026-08-13  
**Code changes:** none  
**Artifact:** `frontend/artifacts/PHASE-HERO-REPLACE-VALIDATION.json`

## Verdict

**PASS (local)** — Explicit Replace Hero updates `HeroRecord` while durable lock remains engaged; unrelated Vault MP4 upload does not swap Hero; refresh keeps the replacement.

`PHASE-HERO-REPLACE-1` is **not required** based on this local evidence. Keep it queued only if a large-file hang reproduces outside this matrix.

Do not merge REPLACE work into the LOCK-1 release until both have passed their own local validation (LOCK-1 already implemented; REPLACE validation now PASS).

---

## 1. Current Hero state (before replace)

| Field | Value |
|-------|--------|
| mode | `asset` |
| heroAssetId | `4bff26c9-29bb-4cd4-ac56-e5cc9b0d0590` |
| backgroundSource | `custom_video` |
| media URL | `http://localhost:8080/videos/4bff26c9-29bb-4cd4-ac56-e5cc9b0d0590.mp4` |
| title | Black Warrior: Land, Legacy & Liberation |
| durable lock | **true** |
| Replace panel | Current Hero Active |

Matches expected: Current Hero Active / mode asset / locked.

---

## 2. Explicit Replace Hero flow (observed)

| Marker | Result |
|--------|--------|
| REPLACE_HERO_START | old `4bff26c9-…` |
| FILE_SELECTED → auto-accept | `handleHeroFileSelect` → `beginHeroAutoAccept` → `acceptHeroFile` |
| UPLOAD_COMPLETE | POST `/api/reels` → **202** (~6s for 3KB fixture) |
| ASSET_CREATED / HERO_APPLY | `commitHeroVideoIdentity` → `selectHeroAsset` / `saveHeroRecord` |
| HERO_RECORD_UPDATED | new `b4398188-37b3-4ce5-b529-58f21430798a` |
| UI | phase `committed` → “Hero Updated Successfully” |

Expected outcomes met:

- old heroAssetId → new heroAssetId  
- mode remains `asset`  
- backgroundSource stays / remains `custom_video`  
- media URL points at new asset

Console path (no durable-lock block on commit):

```
[HERO_ACCEPT] stage: start
[HERO_IDENTITY_COMMIT] stage: commitHeroVideoIdentity  reelId: b4398188-…
[HERO_UPLOAD_FLOW] stage: identity_committed  verified
[HERO_ACCEPT] stage: complete
```

No `durable_hero_override` hits on the accept/commit path.

---

## 3. Failure-area trace (code + live)

```
Hero Manager / Content → Replace Background
   ↓
handleHeroFileSelect → beginHeroAutoAccept
   ↓
acceptHeroFile()          ← upload + apply (NOT applyHeroSelection)
   ↓
uploadMedia(..., category: HERO)
   ↓
commitHeroVideoIdentity() → selectHeroAsset() → saveHeroRecord()
   ↓
saveHeroManagerConfig() + applyHeroManagerBackground()
   ↓
HERO_BACKGROUND_VIDEO.set(reel.url)
   ↓
HeroExperience hydration / replace UX phase → committed
```

| Failure hypothesis | Finding |
|--------------------|---------|
| Durable lock blocks legitimate replacement | **Rejected.** Lock gates `applyHeroSelection` / intelligence / recovery. Intentional replace writes via `commitHeroVideoIdentity` → `selectHeroAsset`, then applies manager/record stores directly. |
| Upload succeeds but apply fails | **Not observed.** Commit + UI committed within ~6s on local fixture. |
| HeroRecord saves but UI does not refresh | **Not observed.** Replace panel showed success; record assetId updated. |
| Old hero reasserts after replacement | **Not observed** after replace, after refresh, or after Vault upload. |
| Stuck “Uploading and applying your new hero…” | That copy is **normal** `heroReplaceUxPhase === 'processing'` while `heroUploadProcessing` is true. It is not a lock message. Stuck state ⇒ upload/validate/watchdog still in flight or timed out — investigate transport/timeouts, not LOCK-1. |

### Latent timeout note (not hit in this run)

`acceptHeroFile` watchdog:

- file **> 12 MiB** → 15 minutes  
- file **≤ 12 MiB** → **45 seconds**  
- upload `withTimeout` can be up to 10–20 minutes  

A slow ≤12 MiB upload can therefore show “Uploading and applying…” then fail via `[HERO_ACCEPT_TIMEOUT]` even though LOCK-1 is healthy. Fixture used here was ~3 KB, so this path was not exercised. Large real heroes (>12 MiB) use the 15-minute watchdog.

---

## 4. Regression after replace

| Check | Result |
|-------|--------|
| Unrelated Vault MP4 upload | Vault grew 3 → 4 items |
| Hero after Vault | still `b4398188-…` |
| Refresh after Vault | still `b4398188-…` |
| Automatic hero swap | **none** |

Viewer cards / feed identity / categories: **not visually re-audited** in this mission; replace path does not PATCH categories or feed identity writers. No code change was made that would alter them.

---

## 5. Acceptance matrix

| Test | Expected | Result |
|------|----------|--------|
| Replace Hero upload | New hero becomes active | ✅ PASS |
| Refresh | New hero persists | ✅ PASS |
| New Vault MP4 upload | Hero unchanged | ✅ PASS |
| Viewer cards | unchanged | ⬜ not visually executed |
| Feed identity | unchanged | ⬜ not visually executed |
| Categories | unchanged | ⬜ not visually executed |

---

## Separation of missions

| Mission | Role | Status |
|---------|------|--------|
| **PHASE-HERO-LOCK-1** | Protect Hero from automatic Vault/intelligence swap | Implementation Complete (local); Release NOT STARTED |
| **PHASE-HERO-REPLACE-VALIDATION** | Prove intentional Replace still works under lock | **PASS (local)** |
| **PHASE-HERO-REPLACE-1** | Restore intentional replace if broken | **Not opened** — no local defect found |

Release order remains: validate both locally before bundling; do not treat REPLACE as a code fix until a failing case is reproduced (e.g. large-file hang with console `[HERO_ACCEPT_TIMEOUT]` / missing `HERO_IDENTITY_COMMIT`).
