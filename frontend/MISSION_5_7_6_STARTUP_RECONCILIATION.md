# MISSION_5_7_6_STARTUP_RECONCILIATION

Generated: 2026-07-13T06:44:14.383Z

## Result: PASS



## First failure (pre-fix)

| Field | Value |
|-------|-------|
| File | `frontend/src/viewer/viewerContext.js` |
| Function | `syncFromVault` |
| Line | ~944 |
| Reason | purgeStaleOrphanThumbnails never ran on startup; reconcileStaleThumbnailsOnStartup added after backend sync |

## Patch

`reconcileStaleThumbnailsOnStartup()` in `viewerContext.js` runs after `syncFromVault` backend reconciliation when `backendReachable === true`. Uses `filterStaleOrphanEntries` (preserves canonical, active upload, recoverable). Secondary path in `VaultExperience.ensureThumbnailCanonicalization`.

## Startup timeline

| Step | Caller | Notes |
|------|--------|-------|
| 1 | main.js → App | Svelte bootstrap |
| 2 | viewerContext createPersistentStore | Loads personal_thumbnail_index → immediate render risk |
| 3 | reloadVaultStoresFromStorage | Syncs index from personal_thumbnails |
| 4 | bootstrapMediaFromBackend | ingest only (no new entries) |
| 5 | syncFromVault | GET /api/reels, backendReachable flag |
| 6 | reconcileStaleThumbnailsOnStartup | **NEW** — purges stale orphans when backend reachable |
| 7 | VaultExperience ensureThumbnailCanonicalization | Canonicalize + secondary reconcile |
| 8 | VaultExperience #each render | Final card count |

## purgeStaleOrphanThumbnails on startup?

**Pre-fix: NO** — guarded by `if (!deletedIds?.length) return` in VaultExperience only called post-delete.

**Post-fix: YES** — via `reconcileStaleThumbnailsOnStartup` after successful backend sync.

## Checks

| Scenario | Result |
|----------|--------|
| Scenario A | PASS |
| Scenario B | PASS |
| Scenario C | PASS |
| Scenario D | PASS |
| Scenario E | PASS |

## Evidence

```json
{
  "Scenario A": {
    "heading": "Your Thumbnails (0)",
    "thumbs": 0,
    "index": 0,
    "cards": 0,
    "placeholders": 0,
    "withId": 0,
    "stale": 0,
    "activeBlob": 0,
    "reconcileLogs": [
      {
        "tag": "[STARTUP_RECONCILE]",
        "payload": {
          "action": "noop",
          "examined": 20,
          "purgedCount": 0,
          "remaining": 20,
          "backendThumbReels": 0,
          "ts": "2026-07-13T06:41:29.845Z"
        }
      },
      {
        "tag": "[STARTUP_RECONCILE]",
        "payload": {
          "action": "noop",
          "source": "VaultExperience.ensureThumbnailCanonicalization",
          "examined": 0,
          "purgedCount": 0,
          "remaining": 0,
          "ts": "2026-07-13T06:41:36.275Z"
        }
      }
    ]
  },
  "Scenario B": {
    "heading": "Your Thumbnails (15)",
    "thumbs": 15,
    "index": 15,
    "cards": 15,
    "placeholders": 10,
    "withId": 5,
    "stale": 10,
    "activeBlob": 0,
    "reconcileLogs": []
  },
  "Scenario C": {
    "heading": "Your Thumbnails (1)",
    "thumbs": 1,
    "index": 1,
    "cards": 1,
    "placeholders": 1,
    "withId": 1,
    "stale": 0,
    "activeBlob": 0,
    "reconcileLogs": []
  },
  "Scenario D": {
    "heading": "Your Thumbnails (6)",
    "thumbs": 6,
    "index": 6,
    "cards": 6,
    "placeholders": 5,
    "withId": 0,
    "stale": 5,
    "activeBlob": 1,
    "reconcileLogs": []
  },
  "Scenario E": {
    "heading": "Your Thumbnails (0)",
    "thumbs": 0,
    "index": 0,
    "cards": 0,
    "placeholders": 0,
    "withId": 0,
    "stale": 0,
    "activeBlob": 0,
    "reconcileLogs": []
  }
}
```
