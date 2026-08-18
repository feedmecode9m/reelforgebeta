# VIDEO-SYNC Tombstone Verification

**Run:** 2026-07-24T07:22:33.952Z  
**Frontend:** https://strong-lolly-a9fcb4.netlify.app/  
**Harness:** TEST-HARNESS-01

## Delete identity binding (TEST-HARNESS-01)

| Field | Value |
|-------|-------|
| Upload reel id | `d16cb0c5-7d87-4b89-aca7-8010d70af47a` |
| Selected row id | `80e6bd3d-f707-4436-9a54-a734d32955a8` |
| DELETE request id | `80e6bd3d-f707-4436-9a54-a734d32955a8` |
| Verification id | `80e6bd3d-f707-4436-9a54-a734d32955a8` |
| IDs aligned | YES |

## Questions (bound to verification id)

| Question | Result |
|----------|--------|
| Verification id | `80e6bd3d-f707-4436-9a54-a734d32955a8` |
| DELETE returns 200? | YES |
| Catalog entry removed immediately? | YES |
| Tombstone in `reelforge_deleted_media_ids`? | YES |
| Guard skipped (`!token` / `!diskName`)? | !diskName |
| Resurrected in `personal_video_vault` after delete? | NO |

## First `personal_video_vault` writer after delete

```json
{
  "ts": 1784877760825,
  "count": 18,
  "ids": [
    "0c335922-ef31-450b-b4d3-9d24a08210cf",
    "cfa72ff1-0e07-4d6d-aafc-59a7d6ebabc7",
    "bbfe2e70-404a-4635-97ca-7fbd0196030b",
    "010ff031-cd44-41ad-8d61-fd3cf3ac054a",
    "b8bd9cee-899a-45b6-8671-5bd5165aaaf1",
    "4e67d1b3-f6c9-4ac4-bd75-7807978d26f3",
    "61c56ffe-f17b-42cd-b338-00fca6799c83",
    "eb081031-a03f-4f21-957e-9c196617225f",
    "e6573dc5-f5cc-4f2e-b74f-4f09980b260e",
    "6d4e8087-0ffa-4077-a1b9-4c69858ac2de"
  ],
  "stack": [
    "    at Storage.setItem (<anonymous>:18:18)",
    "    at Hc (https://strong-lolly-a9fcb4.netlify.app/assets/index-DxM0FwvJ.js:9:5061)",
    "    at RF (https://strong-lolly-a9fcb4.netlify.app/assets/index-DxM0FwvJ.js:9:6176)",
    "    at Object.u [as persistVault] (https://strong-lolly-a9fcb4.netlify.app/assets/index-DxM0FwvJ.js:10:74000)",
    "    at https://strong-lolly-a9fcb4.netlify.app/assets/index-DxM0FwvJ.js:10:5585"
  ]
}
```

## VIDEO-SYNC-01 console lines

(none captured)

## Relevant console lines

- [THUMB_STORE_WRITE] {timestamp: 2026-07-24T07:22:35.192Z, function: safeStorageSet, store: reelforge_feed, previousCount: 1, newCount: 1}
- [THUMB_STORE_WRITE] {timestamp: 2026-07-24T07:22:38.219Z, function: syncCollectionStore, store: personalThumbnailCollection, previousCount: 0, newCount: 0}
- [VAULT-DELETE-TRACE] hydrateVaultFromReels:bootstrap_reload {catalogCount: 35, ids: Array(20), ts: 2026-07-24T07:22:38.311Z}
- [VAULT-DELETE-TRACE] hydrateVaultFromReels:video_reconcile {localBefore: 1, backendVideos: 19, prunedLocal: 0, pendingLocal: 0, reconciled: 19}
- [THUMB_STORE_WRITE] {timestamp: 2026-07-24T07:22:38.389Z, function: reloadVaultStoresFromStorage:clear, store: personalThumbnailCollection, previousCount: 0, newCount: 0}
- [VAULT-DELETE-TRACE] deleteReelById:request {method: DELETE, url: /api/reels/80e6bd3d-f707-4436-9a54-a734d32955a8, hasAuth: true, ts: 2026-07-24T07:22:40.479Z}
- [VAULT-DELETE-TRACE] deleteReelById:response {status: 200, ok: true, body: Object, ts: 2026-07-24T07:22:40.821Z}
- [VAULT-DELETE-TRACE] applyCanonicalDeleteClientEffects:tombstone {reelIds: Array(1), filename: 80e6bd3d-f707-4436-9a54-a734d32955a8.mp4, ts: 2026-07-24T07:22:40.822Z}
- [THUMB_STORE_WRITE] {timestamp: 2026-07-24T07:22:40.823Z, function: safeStorageSet, store: reelforge_feed, previousCount: 1, newCount: 1}
- [THUMB_STORE_WRITE] {timestamp: 2026-07-24T07:22:40.824Z, function: safeStorageSet, store: reelforge_feed, previousCount: 1, newCount: 1}
- [VAULT-DELETE-TRACE] syncFromVault:bootstrap_reload {source: GET /api/reels, catalogCount: 34, ids: Array(20), ts: 2026-07-24T07:22:41.566Z}
- [BG7K_CATALOG_RECEIVE] {count: 34, sampleIds: Array(8), source: syncFromVault:GET /api/reels, timestamp: 2026-07-24T07:22:41.566Z}
- [Vault Field Audit] GET /api/reels response (syncFromVault) (34 items)
- [Vault Field Audit] GET /api/reels response (syncFromVault)[0]
- [Vault Field Audit] GET /api/reels response (syncFromVault)[1]
- [Vault Field Audit] GET /api/reels response (syncFromVault)[2]
- [VAULT_SYNC] {action: syncFromVault:pre-upgrade, backendReels: 34, personal_thumbnails: 0, ts: 2026-07-24T07:22:41.568Z}
- [THUMB_STORE_WRITE] {timestamp: 2026-07-24T07:22:41.568Z, function: reloadVaultStoresFromStorage:clear, store: personalThumbnailCollection, previousCount: 0, newCount: 0}
- [VAULT_SYNC] {action: syncFromVault:post-reload, personal_thumbnails: 0, collectionStore: 0, ts: 2026-07-24T07:22:41.570Z}
- [THUMB_STORE_WRITE] {timestamp: 2026-07-24T07:22:41.570Z, function: syncCollectionStore, store: personalThumbnailCollection, previousCount: 0, newCount: 0}

## DELETE network

```json
[
  {
    "phase": "response",
    "status": 200,
    "url": "https://strong-lolly-a9fcb4.netlify.app/api/reels/80e6bd3d-f707-4436-9a54-a734d32955a8",
    "body": "{\"id\":\"80e6bd3d-f707-4436-9a54-a734d32955a8\",\"success\":true}"
  }
]
```

**Overall probe pass:** PASS
