# MISSION_5_7_4_ORPHAN_LIFECYCLE

Generated: 2026-07-13T06:41:01.008Z

## Result: PASS



## Root cause (pre-fix)

`applyThumbnailDeleteTombstone` retained all id-less entries via `!id || !deletedSet.has(id)`. Orphan rows (`orphaned: true`) survived every successful backend delete; vault count never dropped for phantom cards.

## Patch

After successful backend delete, `purgeStaleOrphanThumbnails()` classifies entries (recoverable / stale / active_upload) and removes **stale** orphans only from `personal_thumbnails`, `personal_thumbnail_index`, and viewer collection.

## Files changed

- `frontend/src/lib/viewer/thumbnailCanonicalization.js`
- `frontend/src/components/experiences/VaultExperience.svelte`
- `frontend/src/viewer/viewerContext.js`
- `frontend/src/lib/storage.js`
- `frontend/src/lib/viewer/vaultUtils.js`

## Checks

| Check | Result |
|-------|--------|
| Setup | PASS |
| Canonical survive | PASS |
| Stale orphans removed | PASS |
| Active upload preserved | PASS |
| Count updates | PASS |
| Zero phantoms | PASS |
| Reload | PASS |
| Mission 5.7 regression | PASS |

## Mission 5.7 regression

PASS

## Evidence

```json
{
  "Setup": {
    "heading": "Your Thumbnails (8)",
    "thumbs": 8,
    "index": 8,
    "cards": 8,
    "placeholders": 5,
    "withId": 2,
    "stale": 5,
    "activeBlob": 1,
    "orphanLogs": []
  },
  "afterDelete": {
    "heading": "Your Thumbnails (2)",
    "thumbs": 2,
    "index": 2,
    "cards": 2,
    "placeholders": 0,
    "withId": 1,
    "stale": 0,
    "activeBlob": 1,
    "orphanLogs": [
      {
        "tag": "[ORPHAN_PURGE]",
        "payload": {
          "deletedIds": [
            "4983f174-f900-4a39-ac31-de7cf9a4b0f7"
          ],
          "purgedCount": 5,
          "purged": [
            {
              "fileKey": "stale-orphan-0.png",
              "reason": "orphaned",
              "type": "orphaned"
            },
            {
              "fileKey": "stale-orphan-1.png",
              "reason": "orphaned",
              "type": "orphaned"
            },
            {
              "fileKey": "stale-orphan-2.png",
              "reason": "orphaned",
              "type": "orphaned"
            },
            {
              "fileKey": "stale-orphan-3.png",
              "reason": "orphaned",
              "type": "orphaned"
            },
            {
              "fileKey": "stale-orphan-4.png",
              "reason": "orphaned",
              "type": "orphaned"
            }
          ],
          "remaining": 2
        }
      }
    ]
  },
  "Canonical survive": {
    "withId": 1
  },
  "Stale orphans removed": {
    "stale": 0
  },
  "Active upload preserved": {
    "activeBlob": 1
  },
  "Count updates": {
    "thumbs": 2,
    "cards": 2
  },
  "Zero phantoms": {
    "placeholders": 0
  },
  "Reload": {
    "heading": "Your Thumbnails (2)",
    "thumbs": 2,
    "index": 2,
    "cards": 2,
    "placeholders": 0,
    "withId": 1,
    "stale": 0,
    "activeBlob": 1,
    "orphanLogs": []
  }
}
```
