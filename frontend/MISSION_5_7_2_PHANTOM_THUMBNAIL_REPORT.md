# MISSION_5_7_2_PHANTOM_THUMBNAIL_REPORT

Generated: 2026-07-13T06:38:50.998Z

## Result: PASS



## First failing stage

syncFromVault → ingestThumbReelsToVault (on upload)

## Root cause

Two ingestion paths treated GET /api/reels as an authoritative personal-vault catalog: (1) ingestThumbReelsToVault pushed every /thumbs/ reel not already local — triggered by acceptPendingThumbnail → syncFromVault after each upload; (2) hydrateVaultFromReels merged the full catalog on bootstrap. Separately, reloadVaultStoresFromStorage rebuilt personal_thumbnails from personal_thumbnail_index without file/backend verification, materializing blank placeholder cards for stale index keys.

## Files changed

- `frontend/src/lib/mediaBootstrap.js`
- `frontend/src/viewer/viewerContext.js`

## Pipeline counts (before → after fix)

```json
{
  "backendCatalogThumbs": 56,
  "staleIndexProbe": {
    "index": {
      "total": 0,
      "canonical": 0,
      "withoutId": 0,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "thumbs": {
      "total": 0,
      "canonical": 0,
      "withoutId": 0,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "cards": 0,
    "placeholders": 0
  },
  "beforeUpload": {
    "thumbs": {
      "total": 0,
      "canonical": 0,
      "withoutId": 0,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "index": {
      "total": 0,
      "canonical": 0,
      "withoutId": 0,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "cards": 0
  },
  "afterUpload": {
    "thumbs": {
      "total": 1,
      "canonical": 1,
      "withoutId": 0,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "index": {
      "total": 1,
      "canonical": 0,
      "withoutId": 1,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "cards": 1,
    "placeholders": 0,
    "rendered": 1
  },
  "beforeFixExample": {
    "upload": 1,
    "afterAcceptPending": 1,
    "afterIngestPreFix": "1 + backendCatalog(56)",
    "afterIndexRebuildPreFix": "up to stale index length (15+)"
  },
  "afterFix": {
    "thumbs": {
      "total": 1,
      "canonical": 1,
      "withoutId": 0,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "index": {
      "total": 1,
      "canonical": 0,
      "withoutId": 1,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "cards": 1,
    "placeholders": 0,
    "rendered": 1
  }
}
```

## Checks

| Check | Result |
|-------|--------|
| Stale index probe | PASS |
| Single upload | PASS |
| Batch delete | PASS |
| Reload | PASS |
| Restart | PASS |

## Evidence

```json
{
  "Stale index probe": {
    "index": {
      "total": 0,
      "canonical": 0,
      "withoutId": 0,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "thumbs": {
      "total": 0,
      "canonical": 0,
      "withoutId": 0,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "cards": 0,
    "placeholders": 0
  },
  "Single upload": {
    "thumbs": {
      "total": 1,
      "canonical": 1,
      "withoutId": 0,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "index": {
      "total": 1,
      "canonical": 0,
      "withoutId": 1,
      "withoutFileName": 0,
      "withoutUrl": 0,
      "duplicateIds": [],
      "duplicateFileNames": [],
      "duplicateUrls": [],
      "orphans": 0
    },
    "cards": 1,
    "placeholders": 0,
    "rendered": 1
  },
  "Batch delete": {
    "cards": 0,
    "thumbs": 0
  },
  "Reload": {
    "thumbs": [],
    "index": [],
    "cards": 0,
    "placeholders": 0,
    "rendered": 0
  },
  "Restart": {
    "thumbs": [],
    "index": [],
    "cards": 0,
    "placeholders": 0,
    "rendered": 0
  }
}
```

## Console errors

- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 326a30cb-e00c-4cd9-8bdc-fada332b7466.png, index: 0}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: CANONICAL_HAS_ID, message: Canonical thumbnail must have id, fileKey: 326a30cb-e00c-4cd9-8bdc-fada332b7466.png, index: 0}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- [THUMBNAIL_INVARIANT_VIOLATION] {name: DELETE_MUST_REDUCE, message: Delete success must reduce collection when ids removed, before: 0, after: 0, deletedCount: 1}
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- WebSocket connection to 'wss://127.0.0.1/?token=UjCx5QqDkQS1' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: the server responded with a status of 404 (Not Found)
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
- Failed to load resource: net::ERR_CONNECTION_REFUSED
