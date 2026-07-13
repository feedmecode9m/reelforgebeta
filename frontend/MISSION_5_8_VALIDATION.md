# MISSION_5_8_VALIDATION

Generated: 2026-07-13T06:49:30.346Z

## Result: FAIL

**Stopped at:** 5.8-F window 0 pre-delete

**Reason:** backend divergence: backend=22 vaultIds=10


## Permanent repair

Single owner: `thumbnailVault.js`. Source of truth: `personal_thumbnails`. Collection derived via `syncCollectionStore`.

## Prior mission regression

| Mission | Result |
|---------|--------|
| mission-5.5-validate.mjs | PASS |
| mission-5.6-validate.mjs | PASS |
| mission-5.6.5-validate.mjs | PASS |
| mission-5.7-validate.mjs | PASS |
| mission-5.7.1-validate.mjs | PASS |
| mission-5.7.2-validate.mjs | PASS |
| mission-5.7.3-validate.mjs | SKIP (missing) |
| mission-5.7.4-validate.mjs | PASS |
| mission-5.7.5-render-audit.mjs | PASS |
| mission-5.7.6-validate.mjs | PASS |
| mission-5.7.7-live-delete-audit.mjs | PASS |

## 5.8 checks

| Check | Result |
|-------|--------|
| 5.8-A ghost purge | PASS |
| 5.8-B index sync | PASS |
| 5.8-C hard refresh | PASS |
| 5.8-D stress uploads | PASS |
| 5.8-E offline | PASS |
| 5.8-F window 0 pre-delete | FAIL |

## Invariant violations

None

## Evidence

```json
{
  "5.8-A ghost purge": {
    "thumbs": 0,
    "index": 0,
    "cards": 0,
    "withId": 0,
    "ghostCanonical": 0,
    "indexMatches": true
  },
  "5.8-B index sync": {
    "thumbs": 1,
    "index": 1,
    "cards": 1,
    "withId": 1,
    "ghostCanonical": 0,
    "indexMatches": true,
    "backendThumbs": 1
  },
  "5.8-C hard refresh": {
    "pre": {
      "thumbs": 1,
      "index": 1,
      "cards": 1,
      "withId": 1,
      "ghostCanonical": 0,
      "indexMatches": true
    },
    "post": {
      "thumbs": 1,
      "index": 1,
      "cards": 1,
      "withId": 1,
      "ghostCanonical": 0,
      "indexMatches": true
    }
  },
  "5.8-D stress uploads": {
    "stressTarget": 10,
    "windowSize": 20,
    "maxCapacity": 20,
    "totalUploads": 10,
    "totalDeletes": 0,
    "totalProcessed": 10,
    "windowCycles": 1,
    "failures": 0,
    "lastWindow": {
      "window": 0,
      "phase": "upload",
      "uploaded": 10,
      "metrics": {
        "localStorageCount": 10,
        "indexCount": 10,
        "renderCount": 10,
        "withId": 10,
        "uniqueIdCount": 10,
        "duplicateIds": 0,
        "orphanCount": 0,
        "canonicalCount": 0,
        "phantomCards": 0,
        "storageAligned": true,
        "storageDivergence": false
      },
      "backend": 12,
      "duplicateIds": 0,
      "orphanCount": 0,
      "renderCount": 10,
      "localStorageCount": 10
    }
  },
  "5.8-E offline": {
    "thumbs": 1,
    "index": 1,
    "cards": 1,
    "withId": 1,
    "ghostCanonical": 0,
    "indexMatches": true
  },
  "5.8-F window 0 pre-delete": {
    "metrics": {
      "localStorageCount": 10,
      "indexCount": 10,
      "renderCount": 10,
      "withId": 10,
      "uniqueIdCount": 10,
      "duplicateIds": 0,
      "orphanCount": 0,
      "canonicalCount": 0,
      "phantomCards": 0,
      "storageAligned": true,
      "storageDivergence": false
    },
    "backendCount": 22
  }
}
```
