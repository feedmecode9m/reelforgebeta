# MISSION_5_7_BATCH_DELETE_VALIDATION

Generated: 2026-07-13T06:41:00.898Z

## Result: PASS



## Root cause

Batch delete stored selection and delete targets as fileName/display-name keys (`selectedThumbnailNames`), resolved reels by name matching, and fell back to `deleteThumbnailFileByName` — violating Mission 5.5 canonical id-only delete.

## First failing stage

Selection / API payload

## Minimal patch

Use `selectedThumbnailIds` (reel.id), resolve id from stored entry at checkbox time, `deleteReelById(id)` only, tombstone by id.

## Files changed

- `frontend/src/components/experiences/VaultExperience.svelte`

## Checks

| Stage | Result |
|-------|--------|
| Upload | PASS |
| API | PASS |
| UI | PASS |
| Storage | PASS |
| Backend | PASS |
| VaultStore | PASS |
| Reload | PASS |
| Render | PASS |
| Network | PASS |

## Before/after delete pipeline

### Before (broken)
```
Checkbox → selectedThumbnailNames (fileName/display)
  → batchDeleteSelectedThumbnails()
  → resolveThumbnailDeleteKey() (fileName/name)
  → fetchReadyReels() + name match OR deleteThumbnailFileByName()
  → applyThumbnailDeleteTombstone(deletedNames) by fileName/name/url
```

### After (fixed)
```
Checkbox → selectedThumbnailIds (reel.id)
  → batchDeleteSelectedThumbnails()
  → deleteReelById(reel.id) for each selected id
  → applyThumbnailDeleteTombstone(deletedIds) by reel.id
  → syncFromVault()
```

## Pipeline evidence

```json
{
  "afterUpload": {
    "storeCount": 5,
    "localStorageCount": 5,
    "uiCards": 5,
    "sample": {
      "id": "72d06f14-e192-49c3-8d2e-41306634bafd",
      "fileName": "72d06f14-e192-49c3-8d2e-41306634bafd.png",
      "name": "mission57-mriurjle-thumb-5.png",
      "title": "mission57-mriurjle-thumb-5.png",
      "url": "/thumbs/72d06f14-e192-49c3-8d2e-41306634bafd.png",
      "size": 70,
      "type": "image",
      "addedAt": "2026-07-13T06:40:32.502Z"
    }
  },
  "afterDelete": {
    "localStorageCount": 2,
    "missionRemaining": 2,
    "indexCount": 2,
    "uiCards": 2,
    "staleSelection": 0,
    "deletedIds": [
      "72d06f14-e192-49c3-8d2e-41306634bafd",
      "94211bd1-030f-4662-948d-f3eb810d3fc6",
      "d08016c8-5302-4ae8-9809-2cd46552cd52"
    ],
    "missionIds": [
      "2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2",
      "7a28a7d6-f15d-49b9-86be-8b1c84f12b21"
    ]
  }
}
```

## Delete API requests

- `DELETE http://127.0.0.1:5173/api/reels/72d06f14-e192-49c3-8d2e-41306634bafd` → 200
- `DELETE http://127.0.0.1:5173/api/reels/94211bd1-030f-4662-948d-f3eb810d3fc6` → 200
- `DELETE http://127.0.0.1:5173/api/reels/d08016c8-5302-4ae8-9809-2cd46552cd52` → 200

## Evidence

```json
{
  "Upload": {
    "count": 5,
    "ids": [
      "72d06f14-e192-49c3-8d2e-41306634bafd",
      "94211bd1-030f-4662-948d-f3eb810d3fc6",
      "d08016c8-5302-4ae8-9809-2cd46552cd52",
      "2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2",
      "7a28a7d6-f15d-49b9-86be-8b1c84f12b21"
    ]
  },
  "API": {
    "deletes": [
      {
        "method": "DELETE",
        "url": "http://127.0.0.1:5173/api/reels/72d06f14-e192-49c3-8d2e-41306634bafd",
        "id": "72d06f14-e192-49c3-8d2e-41306634bafd",
        "payloadIsIdOnly": true,
        "status": 200
      },
      {
        "method": "DELETE",
        "url": "http://127.0.0.1:5173/api/reels/94211bd1-030f-4662-948d-f3eb810d3fc6",
        "id": "94211bd1-030f-4662-948d-f3eb810d3fc6",
        "payloadIsIdOnly": true,
        "status": 200
      },
      {
        "method": "DELETE",
        "url": "http://127.0.0.1:5173/api/reels/d08016c8-5302-4ae8-9809-2cd46552cd52",
        "id": "d08016c8-5302-4ae8-9809-2cd46552cd52",
        "payloadIsIdOnly": true,
        "status": 200
      }
    ]
  },
  "UI": {
    "remaining": 2,
    "staleSelection": 0
  },
  "Storage": {
    "localStorage": 2,
    "index": 2
  },
  "Backend": {
    "before": 62,
    "after": 59
  },
  "VaultStore": {
    "indexCount": 2
  },
  "Reload": {
    "missionCount": 2,
    "restored": [],
    "rendered": 2
  },
  "Render": {
    "missionRendered": 2,
    "total": 2
  },
  "Network": {
    "delete404s": 0
  }
}
```

## Console errors

- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- 404:http://127.0.0.1:5173/thumbs/IMG_0113.JPEG
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 0}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 0}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: d08016c8-5302-4ae8-9809-2cd46552cd52.png, index: 2}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: d08016c8-5302-4ae8-9809-2cd46552cd52.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 2}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: d08016c8-5302-4ae8-9809-2cd46552cd52.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 2}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 94211bd1-030f-4662-948d-f3eb810d3fc6.png, index: 3}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 94211bd1-030f-4662-948d-f3eb810d3fc6.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: d08016c8-5302-4ae8-9809-2cd46552cd52.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 2}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 3}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 94211bd1-030f-4662-948d-f3eb810d3fc6.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: d08016c8-5302-4ae8-9809-2cd46552cd52.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 2}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: HAS_STATE, message: Every thumbnail must have vaultState, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 3}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 72d06f14-e192-49c3-8d2e-41306634bafd.png, index: 4}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 72d06f14-e192-49c3-8d2e-41306634bafd.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 94211bd1-030f-4662-948d-f3eb810d3fc6.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: d08016c8-5302-4ae8-9809-2cd46552cd52.png, index: 2}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 3}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 4}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 1}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: DELETE_MUST_REDUCE, message: Delete success must reduce collection when ids removed, before: 2, after: 2, deletedCount: 3}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- 404:http://127.0.0.1:5173/thumbs/IMG_0113.JPEG
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 1}
- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- 404:http://127.0.0.1:5173/thumbs/IMG_0113.JPEG
- Failed to load resource: the server responded with a status of 404 (Not Found)
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 2c3761ba-b6fa-4fc2-9dd3-39dff34cfbb2.png, index: 0}
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 7a28a7d6-f15d-49b9-86be-8b1c84f12b21.png, index: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
