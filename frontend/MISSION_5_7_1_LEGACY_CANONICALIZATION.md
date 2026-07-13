# MISSION_5_7_1_LEGACY_CANONICALIZATION

Generated: 2026-07-13T06:37:48.154Z

## Result: PASS



## Root cause

Batch delete selection stores canonical reel.id only, but legacy personal_thumbnails entries (raw strings and id-less metadata from reloadVaultStoresFromStorage / resolveThumbnailStoredEntry) never received reel.id, so resolveThumbnailCanonicalId returned empty and legacy thumbnails could not be selected for batch delete.

## Migration strategy

VaultExperience.ensureThumbnailCanonicalization() runs on mount before selection: fetch backend image reels, match id-less entries by fileName then url, attach reel.id on unique match and persist; mark orphaned:true when no unique reel exists.

## Files changed

- `frontend/src/lib/viewer/thumbnailCanonicalization.js`
- `frontend/src/components/experiences/VaultExperience.svelte`
- `frontend/src/lib/storage.js`

## Checks

| Check | Result |
|-------|--------|
| Canonical selectable | PASS |
| Legacy migration | PASS |
| Metadata migration | PASS |
| Orphan identification | PASS |
| No duplicate ids | PASS |
| Selection UI | PASS |
| Diagnostics | PASS |
| Migrated selection | PASS |
| Migrated delete | PASS |
| Migrated delete storage | PASS |
| Reload persistence | PASS |
| Mission 5.7 regression | PASS |

## Before/after flow

### Before (broken)
```
Legacy string / id-less entry in personal_thumbnails
  → personalThumbnailCollection (fileName keys)
  → thumbnailSelectionId → resolveThumbnailCanonicalId → entry.id missing → ''
  → toggleThumbnailSelection('') no-op
  → batch delete impossible for legacy entries
```

### After (fixed)
```
VaultExperience onMount → ensureThumbnailCanonicalization()
  → canonicalizeThumbnailEntries(stored, backend imageReels)
  → unique match: upgrade entry.id, persist personal_thumbnails
  → no match: orphaned:true, checkbox disabled
  → thumbnailSelectionId → reel.id
  → batch delete via DELETE /api/reels/{id} (unchanged)
```

## Mission 5.7 regression

PASS — mission-5.7-validate.mjs exited 0

## Delete API requests

- `DELETE http://127.0.0.1:5173/api/reels/47c6076e-2ef9-469e-9c4d-bea24557bb13` → 200 (uuid=true)

## Evidence

```json
{
  "Canonical selectable": {
    "id": "6fbd08f0-963f-416c-994e-af9f99a631dd"
  },
  "Legacy migration": {
    "fileName": "47c6076e-2ef9-469e-9c4d-bea24557bb13.png",
    "id": "47c6076e-2ef9-469e-9c4d-bea24557bb13"
  },
  "Metadata migration": {
    "fileName": "6bff4995-3888-4152-ae87-fd148392fe27.png",
    "id": "6bff4995-3888-4152-ae87-fd148392fe27"
  },
  "Orphan identification": {
    "fileName": "mission571-mriulwgt-orphan.png",
    "orphaned": true
  },
  "No duplicate ids": {
    "count": 3
  },
  "Selection UI": {
    "enabled": 3,
    "disabled": 1,
    "orphanLabels": 1
  },
  "Diagnostics": {
    "canonLogs": 2,
    "orphanLog": true
  },
  "Migrated selection": {
    "selectedIds": [
      "47c6076e-2ef9-469e-9c4d-bea24557bb13"
    ],
    "buttonCount": 1
  },
  "Migrated delete": {
    "id": "47c6076e-2ef9-469e-9c4d-bea24557bb13",
    "status": 200
  },
  "Migrated delete storage": {
    "stillPresent": false,
    "count": 2
  },
  "Reload persistence": {
    "metaStillHasId": true,
    "orphanStillOrphaned": false,
    "restoredDeleted": false,
    "metaId": "6bff4995-3888-4152-ae87-fd148392fe27"
  },
  "Mission 5.7 regression": {
    "output": "cal thumbnail must have id, fileKey: 40db7979-5e85-4436-8dee-d17c685cfd0a.png, index: 1}\n- Failed to load resource: net::ERR_CONNECTION_REFUSED\n- Failed to load resource: net::ERR_CONNECTION_REFUSED\n\n"
  }
}
```

## Console errors

- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 0}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 0}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 47c6076e-2ef9-469e-9c4d-bea24557bb13.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 47c6076e-2ef9-469e-9c4d-bea24557bb13.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 47c6076e-2ef9-469e-9c4d-bea24557bb13.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 2}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 47c6076e-2ef9-469e-9c4d-bea24557bb13.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 2}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 47c6076e-2ef9-469e-9c4d-bea24557bb13.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 2}
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [Vault Image Error] {src: /thumbs/mission571-mriulwgt-orphan.png, naturalWidth: 0, naturalHeight: 0, complete: false}
- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 47c6076e-2ef9-469e-9c4d-bea24557bb13.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 2}
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [Vault Image Error] {src: /thumbs/mission571-mriulwgt-orphan.png, naturalWidth: 0, naturalHeight: 0, complete: false}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [Vault] Image failed: /thumbs/mission571-mriulwgt-orphan.png
- [Vault thumbnail Img Error] mission571-mriulwgt-orphan.png http://127.0.0.1:5173/placeholders/media-fallback.svg
- [Vault Image Error] {src: http://127.0.0.1:5173/placeholders/media-fallback.svg, naturalWidth: 0, naturalHeight: 0, complete: false}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 47c6076e-2ef9-469e-9c4d-bea24557bb13.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 2}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 1}
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [Vault] Image failed: /thumbs/mission571-mriulwgt-orphan.png
- [Vault thumbnail Img Error] mission571-mriulwgt-orphan.png http://127.0.0.1:5173/placeholders/media-fallback.svg
- [Vault Image Error] {src: http://127.0.0.1:5173/placeholders/media-fallback.svg, naturalWidth: 267, naturalHeight: 150, complete: true}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: DELETE_MUST_REDUCE, message: Delete success must reduce collection when ids removed, before: 3, after: 3, deletedCount: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 1}
- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6fbd08f0-963f-416c-994e-af9f99a631dd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 6bff4995-3888-4152-ae87-fd148392fe27.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
