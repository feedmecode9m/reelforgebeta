# Asset Episode Binding Audit — BG-ASSET-EPISODE-BINDING-01

**Objective:** Uploaded production reels acquire `episode_id` during upload/finalize lifecycle.  
**Mode:** Audit + frontend identity propagation (no Hero/notification changes).

---

## Upload Lifecycle Map

```text
Frontend (Vault / Studio)
        │
        ├─ multipart (< 6 MB) ──► POST /api/reels (multipart)
        │                              handlers.rs::create_reel
        │                              media_api.rs::parse_reel_multipart
        │                              ingestion/upload.rs::ingest_from_reel_multipart
        │                              db/reels.rs::insert_pending_reel(episode_id)
        │
        └─ signed (≥ 6 MB) ─────► POST /api/uploads/sign
                                   PUT  R2/direct storage
                                   POST /api/reels/finalize
                                        signed_upload.rs::finalize_reel
                                        ingestion/upload.rs::ingest_stored_video
                                        db/reels.rs::insert_pending_reel(episode_id)
        │
        ▼
Ingestion worker → status=ready, validated=true
        │
        ▼
GET /api/reels → ReelV1 { id, episodeId, url, … }
        │
        ▼
Frontend sync → normalizedFeed / personal_video_vault
        │
        ▼
resolveReelForEpisode(episodeId) → Hero candidate (gate unchanged)
```

---

## Current Upload Paths

| Path | Entry | Identity fields today |
|------|-------|----------------------|
| Vault MP4 drop | `VaultExperience.handleVaultVideoDrop` → `uploadMedia(formData)` | `category`; **+episodeId when studio attach context set** |
| Studio faces upload | `StudioExperience.handleUploadWithFaces` → `uploadMedia(formData)` | `title`, `category`; **+episodeId when `studioAttachEpisodeId` set** |
| Studio unveil | `StudioExperience.unveilToCloud` → `uploadMedia(formData)` | none by default; **+episodeId when attach context set** |
| Signed large upload | `media.js::uploadVideoSigned` | sign + finalize JSON; **+episodeId propagated** |
| Multipart create | `media.js::createReel` | form field `episodeId` / `episode_id` |

---

## Where Episode Identity Exists

| Layer | Location | Field |
|-------|----------|-------|
| Studio UI context | `studioAttachEpisodeId` store | catalog `ep-neon-s01e02` |
| Series context | `studioSelectedSeriesId` store | `series-neon-vengeance` |
| Multipart parse | `media_api.rs` | `ParsedReelForm.episode_id` |
| Sign session | `signed_upload.rs::PendingUpload` | `episode_id` (from sign body) |
| Finalize body | `signed_upload.rs::FinalizeReelRequest` | `episode_id` (body or session) |
| DB insert | `db/reels.rs::insert_pending_reel` | `episode_id` column |
| API response | `reel_contract.rs::ReelV1` | `episodeId` (camelCase JSON) |
| Post-upload catalog | `bindEpisodeToFeedReel` (when vault upload has attach context) | `episode.reelId` + metadata map |

---

## Where Identity Was Lost (Pre-Fix)

| Gap | Cause |
|-----|-------|
| Frontend never sent `episodeId` | `media.js` sign/finalize/multipart omitted field despite backend support |
| Vault drop had no studio context | `VaultExperience` did not receive `studioAttachEpisodeId` |
| Studio uploads ignored attach store | `handleUploadWithFaces` / `unveilToCloud` omitted `episodeId` |
| Legacy rows | Uploads before migration / without attach → `episode_id NULL` in Postgres |

**Not a backend contract gap** — backend already accepted `episodeId` on all three ingress points.

---

## Backend Contract (Verified)

### POST /api/reels (multipart)

| Field | Accepted | Persisted |
|-------|----------|-----------|
| `episodeId` / `episode_id` | ✓ | `reels.episode_id` |
| `seriesId` | parsed but **not** persisted on reel row | diagnostics only |
| `video` | ✓ | `video_url` |
| `title`, `category`, `description` | ✓ | respective columns |

### POST /api/uploads/sign

| Field | Accepted | Stored in session |
|-------|----------|-------------------|
| `episodeId` | ✓ | `PendingUpload.episode_id` |

### POST /api/reels/finalize

| Field | Accepted | Used at ingest |
|-------|----------|----------------|
| `episodeId` | ✓ | body OR session fallback → `insert_pending_reel` |

### GET /api/reels

Returns `ReelV1`: `{ id, episodeId, url, … }`.

---

## Recommended Insertion Point (Implemented)

**Primary:** Frontend `media.js` — propagate optional `episodeId` through:

1. `appendUploadIdentityToFormData` → multipart  
2. Sign JSON body → session  
3. Finalize JSON body → ingest  

**Secondary:** Studio/Vault callers pass attach context when user is in episode-attach workflow.

**Diagnostics:** `[ASSET_IDENTITY_BIND] { uploadId, reelId, episodeId, seriesId, source, stage }`

**Post-upload (catalog only, no DB change):** When vault upload includes `uploadEpisodeId`, call `bindEpisodeToFeedReel(reelId, episodeId)` after success.

---

## Out of Scope (Per Mission)

- Automatic migration of legacy `episode_id NULL` rows  
- Title/filename episode guessing  
- Hero gate / scoring / rendering changes  
- Notification system changes  
- R2 upload transport changes  

---

## Files Reference

| File | Role |
|------|------|
| `frontend/src/lib/api/uploadIdentity.js` | Identity helpers + diagnostics |
| `frontend/src/lib/api/media.js` | Sign/finalize/multipart propagation |
| `frontend/src/components/experiences/VaultExperience.svelte` | Attach context on vault drop |
| `frontend/src/components/experiences/StudioExperience.svelte` | Attach context on studio uploads |
| `backend/src/signed_upload.rs` | Sign/finalize session + body |
| `backend/src/media_api.rs` | Multipart `episodeId` parse |
| `backend/src/db/reels.rs` | `insert_pending_reel`, `set_reel_episode_id` |
| `backend/src/reel_contract.rs` | `ReelV1.episodeId` response |
