# VAULT-VERIFY-03 REPORT

- **Timestamp:** 2026-07-24T15:58:51.015Z
- **Frontend:** https://strong-lolly-a9fcb4.netlify.app/
- **Backend:** https://reelforge-deploy-production.up.railway.app
- **Netlify deploy:** 6a62f9d35a89dc03412d7f49
- **Railway deploy:** unknown
- **Browser bundle:** index-DxM0FwvJ.js
- **Test identity:** 20260724T155837Z

## Deploy Preconditions

| Component | Status |
|-----------|--------|
| Netlify (hydration frontend) | Deployed — bundle `index-DxM0FwvJ.js` |
| Railway (image-only delete handler) | Deploy `unknown` |

## Results Matrix

| Stage | Thumbnail | Video Small | Video Large (R2) | Hero |
|-------|-----------|-------------|------------------|------|
| Overall | PASS | PASS | FAIL | FAIL |

**VAULT-VERIFY-03: FAIL**

## Thumbnail Lifecycle

```json
{
  "pass": true,
  "tests": {
    "drop": {
      "pass": true,
      "acceptVisible": true,
      "countBefore": 0,
      "countAfterDrop": 0,
      "noBackendBeforeAccept": true
    },
    "accept": {
      "pass": true,
      "postStatus": 202,
      "reelId": "4c799d2f-5751-4fa5-8ece-d3e73f747d54",
      "idsUpdated": true,
      "thumbsUpdated": true
    },
    "refresh": {
      "pass": true,
      "survives": true,
      "duplicateCount": 1,
      "idsPresent": true,
      "catalogMatch": true,
      "count": 1
    },
    "delete": {
      "pass": true,
      "deleteStatus": 200,
      "catalogGone": true,
      "idsRemoved": true,
      "storageNetlify": {
        "ok": false,
        "status": 404,
        "url": "https://strong-lolly-a9fcb4.netlify.app/thumbs/4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg?_cb=1784909078608"
      },
      "storageOrigin": {
        "ok": false,
        "status": 404,
        "url": "https://reelforge-deploy-production.up.railway.app/thumbs/4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg?_cb=1784909079367"
      },
      "storageEventually404": true
    },
    "rerefresh": {
      "pass": true,
      "resurrected": false,
      "catalogGone": true
    }
  }
}
```

## Video Small

```json
{
  "pass": true,
  "tests": {
    "upload": {
      "pass": true,
      "reelId": "432b1c80-0671-4dc1-bd0e-93411919f116",
      "postStatus": 202
    },
    "refresh": {
      "pass": true,
      "survives": true
    },
    "delete": {
      "pass": true,
      "catalogGone": true
    },
    "rerefresh": {
      "pass": true,
      "resurrected": false
    }
  }
}
```

## Video Large (R2)

```json
{
  "pass": false,
  "fileSizeBytes": 30223729,
  "failureLayer": "R2 PUT / browser network",
  "stages": {
    "sign": {
      "status": 200,
      "ok": true,
      "uploadId": "116a01c8-6105-4e93-9679-d40045fbcc75",
      "reelId": "3909af4d-0546-4147-9a45-407801b1d07a",
      "ms": 2710
    },
    "r2Put": {
      "ok": false,
      "attempt": 3,
      "error": "fetch failed",
      "ms": 150615,
      "target": "https://f4531bb32bae84de2da9f682afed23e9.r2.cloudflarestorage.com/reelforge-medi"
    }
  },
  "persist": {
    "idsMatch": true
  },
  "refresh": {
    "survives": false,
    "playHead": {
      "ok": false,
      "status": 0
    }
  },
  "delete": {
    "catalogGone": true,
    "resurrected": false
  }
}
```

## Hero

```json
{
  "signedPath": {
    "signOk": false,
    "finalizeOk": false
  },
  "persist": {
    "heroAssetId": null,
    "notInMp4Vault": true,
    "hasHeroVideoKey": false
  },
  "refresh": {
    "survives": false
  },
  "delete": {
    "heroDeleted": false,
    "resurrected": null
  }
}
```

## Console Markers

```json
{
  "VAULT_BOOTSTRAP": [
    {
      "ts": 1784908812264,
      "text": "[VAULT_BOOTSTRAP] {action: hydrateVaultFromReels:thumbs, localCount: 0, backendReels: 34, ts: 2026-07-24T16:00:12.260Z}"
    },
    {
      "ts": 1784908812264,
      "text": "[VAULT_BOOTSTRAP] {action: upgradeThumbnailVaultFromBackendReels:complete, before: 0, after: 0, ts: 2026-07-24T16:00:12.261Z}"
    },
    {
      "ts": 1784908812265,
      "text": "[VAULT_BOOTSTRAP] {action: bootstrapMediaFromBackend:complete, source: api-reels, thumbnails: 0, videos: 18, ts: 2026-07-24T16:00:12.262Z}"
    },
    {
      "ts": 1784909051733,
      "text": "[VAULT_BOOTSTRAP] {action: hydrateVaultFromReels:thumbs, localCount: 1, backendReels: 35, ts: 2026-07-24T16:04:11.730Z}"
    },
    {
      "ts": 1784909051734,
      "text": "[VAULT_BOOTSTRAP] {action: upgradeThumbnailVaultFromBackendReels:complete, before: 1, after: 1, ts: 2026-07-24T16:04:11.731Z}"
    },
    {
      "ts": 1784909051734,
      "text": "[VAULT_BOOTSTRAP] {action: bootstrapMediaFromBackend:complete, source: api-reels, thumbnails: 1, videos: 18, ts: 2026-07-24T16:04:11.732Z}"
    },
    {
      "ts": 1784909142358,
      "text": "[VAULT_BOOTSTRAP] {action: hydrateVaultFromReels:thumbs, localCount: 0, backendReels: 34, ts: 2026-07-24T16:05:42.357Z}"
    },
    {
      "ts": 1784909142358,
      "text": "[VAULT_BOOTSTRAP] {action: upgradeThumbnailVaultFromBackendReels:complete, before: 0, after: 0, ts: 2026-07-24T16:05:42.357Z}"
    },
    {
      "ts": 1784909142360,
      "text": "[VAULT_BOOTSTRAP] {action: bootstrapMediaFromBackend:complete, source: api-reels, thumbnails: 0, videos: 18, ts: 2026-07-24T16:05:42.359Z}"
    },
    {
      "ts": 1784909274218,
      "text": "[VAULT_BOOTSTRAP] {action: hydrateVaultFromReels:thumbs, localCount: 0, backendReels: 36, ts: 2026-07-24T16:07:54.217Z}"
    },
    {
      "ts": 1784909274219,
      "text": "[VAULT_BOOTSTRAP] {action: upgradeThumbnailVaultFromBackendReels:complete, before: 0, after: 0, ts: 2026-07-24T16:07:54.218Z}"
    },
    {
      "ts": 1784909274220,
      "text": "[VAULT_BOOTSTRAP] {action: bootstrapMediaFromBackend:complete, source: api-reels, thumbnails: 0, videos: 20, ts: 2026-07-24T16:07:54.219Z}"
    },
    {
      "ts": 1784909292037,
      "text": "[VAULT_BOOTSTRAP] {action: hydrateVaultFromReels:thumbs, localCount: 0, backendReels: 35, ts: 2026-07-24T16:08:12.037Z}"
    },
    {
      "ts": 1784909292038,
      "text": "[VAULT_BOOTSTRAP] {action: upgradeThumbnailVaultFromBackendReels:complete, before: 0, after: 0, ts: 2026-07-24T16:08:12.037Z}"
    },
    {
      "ts": 1784909292039,
      "text": "[VAULT_BOOTSTRAP] {action: bootstrapMediaFromBackend:complete, source: api-reels, thumbnails: 0, videos: 19, ts: 2026-07-24T16:08:12.038Z}"
    },
    {
      "ts": 1784909512126,
      "text": "[VAULT_BOOTSTRAP] {action: hydrateVaultFromReels:thumbs, localCount: 0, backendReels: 35, ts: 2026-07-24T16:11:52.124Z}"
    },
    {
      "ts": 1784909512126,
      "text": "[VAULT_BOOTSTRAP] {action: upgradeThumbnailVaultFromBackendReels:complete, before: 0, after: 0, ts: 2026-07-24T16:11:52.125Z}"
    },
    {
      "ts": 1784909512127,
      "text": "[VAULT_BOOTSTRAP] {action: bootstrapMediaFromBackend:complete, source: api-reels, thumbnails: 0, videos: 19, ts: 2026-07-24T16:11:52.126Z}"
    },
    {
      "ts": 1784909536707,
      "text": "[VAULT_BOOTSTRAP] {action: hydrateVaultFromReels:thumbs, localCount: 0, backendReels: 35, ts: 2026-07-24T16:12:16.706Z}"
    },
    {
      "ts": 1784909536707,
      "text": "[VAULT_BOOTSTRAP] {action: upgradeThumbnailVaultFromBackendReels:complete, before: 0, after: 0, ts: 2026-07-24T16:12:16.706Z}"
    },
    {
      "ts": 1784909536708,
      "text": "[VAULT_BOOTSTRAP] {action: bootstrapMediaFromBackend:complete, source: api-reels, thumbnails: 0, videos: 19, ts: 2026-07-24T16:12:16.707Z}"
    },
    {
      "ts": 1784910532055,
      "text": "[VAULT_BOOTSTRAP] {action: hydrateVaultFromReels:thumbs, localCount: 0, backendReels: 37, ts: 2026-07-24T16:28:52.048Z}"
    },
    {
      "ts": 1784910532055,
      "text": "[VAULT_BOOTSTRAP] {action: upgradeThumbnailVaultFromBackendReels:complete, before: 0, after: 0, ts: 2026-07-24T16:28:52.049Z}"
    },
    {
      "ts": 1784910532056,
      "text": "[VAULT_BOOTSTRAP] {action: bootstrapMediaFromBackend:complete, source: api-reels, thumbnails: 0, videos: 20, ts: 2026-07-24T16:28:52.050Z}"
    }
  ],
  "VAULT_PERSIST": [
    {
      "ts": 1784908812460,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784908812460,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784908827471,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784908976897,
      "text": "[VAULT_PERSIST] {vaultType: thumbnail, assetId: 4c799d2f-5751-4fa5-8ece-d3e73f747d54, fileName: 4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784908991944,
      "text": "[VAULT_PERSIST] {vaultType: thumbnail, assetId: 4c799d2f-5751-4fa5-8ece-d3e73f747d54, fileName: 4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784908991948,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909051902,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909051904,
      "text": "[VAULT_PERSIST] {vaultType: thumbnail, assetId: 4c799d2f-5751-4fa5-8ece-d3e73f747d54, fileName: 4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909051906,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909066380,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909066382,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909066386,
      "text": "[VAULT_PERSIST] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909066914,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909143012,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909143016,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909158023,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 0c335922-ef31-450b-b4d3-9d24a08210cf, fileName: 8de95c34-a61a-4d24-988b-ba0c115624c9.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909232722,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 432b1c80-0671-4dc1-bd0e-93411919f116, fileName: 432b1c80-0671-4dc1-bd0e-93411919f116.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909232724,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 432b1c80-0671-4dc1-bd0e-93411919f116, fileName: 432b1c80-0671-4dc1-bd0e-93411919f116.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909274683,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909274687,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909292308,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909292308,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909307305,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909513013,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909513016,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909542353,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909542355,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909546550,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909546590,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909546590,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 6060c258-a3f6-40ba-b642-c758562c7cb7, fileName: 6060c258-a3f6-40ba-b642-c758562c7cb7.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784910532132,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 8e40f3ca-e220-40f7-a636-b828b4008f68, fileName: 8e40f3ca-e220-40f7-a636-b828b4008f68.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784910532135,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 8e40f3ca-e220-40f7-a636-b828b4008f68, fileName: 8e40f3ca-e220-40f7-a636-b828b4008f68.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784910534971,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 8e40f3ca-e220-40f7-a636-b828b4008f68, fileName: 8e40f3ca-e220-40f7-a636-b828b4008f68.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784910535010,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 8e40f3ca-e220-40f7-a636-b828b4008f68, fileName: 8e40f3ca-e220-40f7-a636-b828b4008f68.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784910535011,
      "text": "[VAULT_PERSIST] {vaultType: video, assetId: 8e40f3ca-e220-40f7-a636-b828b4008f68, fileName: 8e40f3ca-e220-40f7-a636-b828b4008f68.mp4, storageLocation: personal_video_vault, backendEndpoint: null}"
    }
  ],
  "VAULT_REFRESH_RESTORE": [
    {
      "ts": 1784908812460,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784908812460,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784908827469,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784908827473,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784908991919,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784908991948,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909051902,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909051906,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909066912,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909066915,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909143014,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909143016,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909158022,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909158025,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909274685,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909274687,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909292308,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909292308,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909307304,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909307306,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909513014,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909513016,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909542354,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909542355,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784909546550,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909546550,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784910532133,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784910532136,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    },
    {
      "ts": 1784910534970,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: thumbnail, assetId: null, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784910534971,
      "text": "[VAULT_REFRESH_RESTORE] {vaultType: video, assetId: null, fileName: null, storageLocation: personal_video_vault, backendEndpoint: null}"
    }
  ],
  "VAULT_RELOAD": [
    {
      "ts": 1784908812460,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:00:12.455Z}"
    },
    {
      "ts": 1784908812460,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:00:12.456Z}"
    },
    {
      "ts": 1784908827470,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:00:27.468Z}"
    },
    {
      "ts": 1784908827470,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:00:27.468Z}"
    },
    {
      "ts": 1784908991919,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 1, ts: 2026-07-24T16:03:11.918Z}"
    },
    {
      "ts": 1784908991948,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:mutate, personal_thumbnails: 1, ts: 2026-07-24T16:03:11.934Z}"
    },
    {
      "ts": 1784909051902,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 1, ts: 2026-07-24T16:04:11.901Z}"
    },
    {
      "ts": 1784909051905,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:mutate, personal_thumbnails: 1, ts: 2026-07-24T16:04:11.904Z}"
    },
    {
      "ts": 1784909066912,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:04:26.911Z}"
    },
    {
      "ts": 1784909066913,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:04:26.912Z}"
    },
    {
      "ts": 1784909143014,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:05:43.013Z}"
    },
    {
      "ts": 1784909143014,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:05:43.014Z}"
    },
    {
      "ts": 1784909158022,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:05:58.020Z}"
    },
    {
      "ts": 1784909158022,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:05:58.021Z}"
    },
    {
      "ts": 1784909274685,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:07:54.684Z}"
    },
    {
      "ts": 1784909274685,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:07:54.684Z}"
    },
    {
      "ts": 1784909292308,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:08:12.296Z}"
    },
    {
      "ts": 1784909292308,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:08:12.296Z}"
    },
    {
      "ts": 1784909307304,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:08:27.303Z}"
    },
    {
      "ts": 1784909307304,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:08:27.303Z}"
    },
    {
      "ts": 1784909513015,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:11:53.013Z}"
    },
    {
      "ts": 1784909513015,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:11:53.014Z}"
    },
    {
      "ts": 1784909542354,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:12:22.352Z}"
    },
    {
      "ts": 1784909542354,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:12:22.352Z}"
    },
    {
      "ts": 1784909546550,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:12:26.543Z}"
    },
    {
      "ts": 1784909546550,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:12:26.543Z}"
    },
    {
      "ts": 1784910532134,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:28:52.133Z}"
    },
    {
      "ts": 1784910532134,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:28:52.133Z}"
    },
    {
      "ts": 1784910534970,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:start, personal_thumbnails: 0, ts: 2026-07-24T16:28:54.960Z}"
    },
    {
      "ts": 1784910534971,
      "text": "[VAULT_RELOAD] {action: reloadVaultStoresFromStorage:clear, personal_thumbnails: 0, ts: 2026-07-24T16:28:54.961Z}"
    }
  ],
  "VAULT_ACCEPT": [
    {
      "ts": 1784908843711,
      "text": "[VAULT_ACCEPT] {vaultType: thumbnail, assetId: null, fileName: VAULT_TEST_THUMB_20260724T155837Z.jpg, storageLocation: personal_thumbnails, backendEndpoint: /api/reels}"
    }
  ],
  "VAULT_UPLOAD_SUCCESS": [
    {
      "ts": 1784908976919,
      "text": "[VAULT_UPLOAD_SUCCESS] {vaultType: thumbnail, assetId: 4c799d2f-5751-4fa5-8ece-d3e73f747d54, fileName: 4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, storageLocation: /thumbs/4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, backendEndpoint: /api/reels}"
    },
    {
      "ts": 1784909232770,
      "text": "[VAULT_UPLOAD_SUCCESS] {vaultType: video, assetId: 432b1c80-0671-4dc1-bd0e-93411919f116, fileName: 432b1c80-0671-4dc1-bd0e-93411919f116.mp4, storageLocation: /videos/432b1c80-0671-4dc1-bd0e-93411919f116.mp4, backendEndpoint: /api/reels}"
    }
  ],
  "VAULT_RENDER": [
    {
      "ts": 1784908976919,
      "text": "[VAULT_RENDER] {renderIndex: 0, storeOrigin: personalThumbnailCollection, componentOrigin: VaultExperience, collectionItem: 4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, displayName: VAULT_TEST_THUMB_20260724T155837Z.jpg}"
    },
    {
      "ts": 1784908993140,
      "text": "[VAULT_RENDER] {renderIndex: 0, storeOrigin: personalThumbnailCollection, componentOrigin: VaultExperience, collectionItem: 4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, displayName: VAULT_TEST_THUMB_20260724T155837Z.jpg}"
    },
    {
      "ts": 1784909049799,
      "text": "[VAULT_RENDER] {renderIndex: 0, storeOrigin: personalThumbnailCollection, componentOrigin: VaultExperience, collectionItem: 4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, displayName: VAULT_TEST_THUMB_20260724T155837Z.jpg}"
    },
    {
      "ts": 1784909051911,
      "text": "[VAULT_RENDER] {renderIndex: 0, storeOrigin: personalThumbnailCollection, componentOrigin: VaultExperience, collectionItem: 4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, displayName: VAULT_TEST_THUMB_20260724T155837Z.jpg}"
    }
  ],
  "VAULT_DELETE_START": [
    {
      "ts": 1784909059098,
      "text": "[VAULT_DELETE_START] {vaultType: thumbnail, assetId: 4c799d2f-5751-4fa5-8ece-d3e73f747d54, fileName: 4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, storageLocation: personal_thumbnails, backendEndpoint: /api/reels}"
    },
    {
      "ts": 1784909066384,
      "text": "[VAULT_DELETE_START] {vaultType: thumbnail, assetId: 4c799d2f-5751-4fa5-8ece-d3e73f747d54, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    }
  ],
  "VAULT_DELETE_SUCCESS": [
    {
      "ts": 1784909066386,
      "text": "[VAULT_DELETE_SUCCESS] {vaultType: thumbnail, assetId: 4c799d2f-5751-4fa5-8ece-d3e73f747d54, fileName: null, storageLocation: personal_thumbnails, backendEndpoint: null}"
    },
    {
      "ts": 1784909066391,
      "text": "[VAULT_DELETE_SUCCESS] {vaultType: thumbnail, assetId: 4c799d2f-5751-4fa5-8ece-d3e73f747d54, fileName: 4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg, storageLocation: personal_thumbnails, backendEndpoint: /api/reels}"
    }
  ]
}
```

## Network Summary

```json
{
  "sign": [],
  "finalize": [],
  "r2Put": [],
  "reelPost": [
    {
      "ts": 1784908886305,
      "url": "https://strong-lolly-a9fcb4.netlify.app/api/reels",
      "method": "POST",
      "status": 202,
      "ok": true,
      "kind": "response"
    },
    {
      "ts": 1784909190961,
      "url": "https://strong-lolly-a9fcb4.netlify.app/api/reels",
      "method": "POST",
      "status": 202,
      "ok": true,
      "kind": "response"
    }
  ],
  "reelDelete": [
    {
      "ts": 1784909065963,
      "url": "https://strong-lolly-a9fcb4.netlify.app/api/reels/4c799d2f-5751-4fa5-8ece-d3e73f747d54",
      "method": "DELETE",
      "status": 200,
      "ok": true,
      "kind": "response"
    }
  ]
}
```

## Storage Snapshots

```json
{
  "thumbnailAfterRefresh": {
    "thumbs": [
      {
        "id": "4c799d2f-5751-4fa5-8ece-d3e73f747d54",
        "fileName": "4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg",
        "name": "VAULT_TEST_THUMB_20260724T155837Z.jpg",
        "title": "VAULT_TEST_THUMB_20260724T155837Z.jpg",
        "url": "/thumbs/4c799d2f-5751-4fa5-8ece-d3e73f747d54.jpg",
        "size": 674,
        "type": "image",
        "addedAt": "2026-07-24T16:02:56.872Z"
      }
    ],
    "ids": [
      "4c799d2f-5751-4fa5-8ece-d3e73f747d54"
    ]
  },
  "thumbnailAfterDelete": {
    "thumbs": [],
    "ids": []
  },
  "thumbnailAfterReRefresh": [],
  "videoSmall": {
    "vault": [
      {
        "id": "432b1c80-0671-4dc1-bd0e-93411919f116",
        "name": "VAULT_TEST_VIDEO_SMALL_20260724T155837Z.mp4",
        "fileName": "432b1c80-0671-4dc1-bd0e-93411919f116.mp4",
        "type": "video/mp4",
        "size": 12302,
        "addedAt": "2026-07-24T16:06:08.945722+00:00",
        "thumbnail": "/thumbs/432b1c80-0671-4dc1-bd0e-93411919f116.jpg",
        "url": "/videos/432b1c80-0671-4dc1-bd0e-93411919f116.mp4"
      },
      {
        "id": "0c335922-ef31-450b-b4d3-9d24a08210cf",
        "name": "8de95c34-a61a-4d24-988b-ba0c115624c9",
        "fileName": "8de95c34-a61a-4d24-988b-ba0c115624c9.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-23T12:49:10.821676+00:00",
        "thumbnail": "/thumbs/0c335922-ef31-450b-b4d3-9d24a08210cf.jpg",
        "url": "/videos/8de95c34-a61a-4d24-988b-ba0c115624c9.mp4"
      },
      {
        "id": "cfa72ff1-0e07-4d6d-aafc-59a7d6ebabc7",
        "name": "bg7h-transport-test",
        "fileName": "cfa72ff1-0e07-4d6d-aafc-59a7d6ebabc7.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-23T04:49:39.184571+00:00",
        "thumbnail": "/thumbs/cfa72ff1-0e07-4d6d-aafc-59a7d6ebabc7.jpg",
        "url": "/videos/cfa72ff1-0e07-4d6d-aafc-59a7d6ebabc7.mp4"
      },
      {
        "id": "bbfe2e70-404a-4635-97ca-7fbd0196030b",
        "name": "bg7h-transport-test",
        "fileName": "bbfe2e70-404a-4635-97ca-7fbd0196030b.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-23T04:47:00.346791+00:00",
        "thumbnail": "/thumbs/bbfe2e70-404a-4635-97ca-7fbd0196030b.jpg",
        "url": "/videos/bbfe2e70-404a-4635-97ca-7fbd0196030b.mp4"
      },
      {
        "id": "010ff031-cd44-41ad-8d61-fd3cf3ac054a",
        "name": "010ff031-cd44-41ad-8d61-fd3cf3ac054a",
        "fileName": "010ff031-cd44-41ad-8d61-fd3cf3ac054a.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-23T04:34:17.995616+00:00",
        "thumbnail": "/thumbs/010ff031-cd44-41ad-8d61-fd3cf3ac054a.jpg",
        "url": "/videos/010ff031-cd44-41ad-8d61-fd3cf3ac054a.mp4"
      },
      {
        "id": "b8bd9cee-899a-45b6-8671-5bd5165aaaf1",
        "name": "probe10",
        "fileName": "b8bd9cee-899a-45b6-8671-5bd5165aaaf1.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-23T04:14:28.672845+00:00",
        "thumbnail": "/thumbs/b8bd9cee-899a-45b6-8671-5bd5165aaaf1.jpg",
        "url": "/videos/b8bd9cee-899a-45b6-8671-5bd5165aaaf1.mp4"
      },
      {
        "id": "4e67d1b3-f6c9-4ac4-bd75-7807978d26f3",
        "name": "PS02-05",
        "fileName": "4e67d1b3-f6c9-4ac4-bd75-7807978d26f3.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:55:17.890844+00:00",
        "thumbnail": "/thumbs/4e67d1b3-f6c9-4ac4-bd75-7807978d26f3.jpg",
        "url": "/videos/4e67d1b3-f6c9-4ac4-bd75-7807978d26f3.mp4"
      },
      {
        "id": "61c56ffe-f17b-42cd-b338-00fca6799c83",
        "name": "PS02-04",
        "fileName": "61c56ffe-f17b-42cd-b338-00fca6799c83.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:55:17.161873+00:00",
        "thumbnail": "/thumbs/61c56ffe-f17b-42cd-b338-00fca6799c83.jpg",
        "url": "/videos/61c56ffe-f17b-42cd-b338-00fca6799c83.mp4"
      },
      {
        "id": "eb081031-a03f-4f21-957e-9c196617225f",
        "name": "PS01-RENAME-TARGET",
        "fileName": "eb081031-a03f-4f21-957e-9c196617225f.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:47:33.838996+00:00",
        "thumbnail": "/thumbs/eb081031-a03f-4f21-957e-9c196617225f.jpg",
        "url": "/videos/eb081031-a03f-4f21-957e-9c196617225f.mp4"
      },
      {
        "id": "e6573dc5-f5cc-4f2e-b74f-4f09980b260e",
        "name": "PS01-08",
        "fileName": "e6573dc5-f5cc-4f2e-b74f-4f09980b260e.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:33.458346+00:00",
        "thumbnail": "/thumbs/e6573dc5-f5cc-4f2e-b74f-4f09980b260e.jpg",
        "url": "/videos/e6573dc5-f5cc-4f2e-b74f-4f09980b260e.mp4"
      },
      {
        "id": "6d4e8087-0ffa-4077-a1b9-4c69858ac2de",
        "name": "PS01-07",
        "fileName": "6d4e8087-0ffa-4077-a1b9-4c69858ac2de.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:32.901500+00:00",
        "thumbnail": "/thumbs/6d4e8087-0ffa-4077-a1b9-4c69858ac2de.jpg",
        "url": "/videos/6d4e8087-0ffa-4077-a1b9-4c69858ac2de.mp4"
      },
      {
        "id": "a29c0119-c570-4f5f-b522-fc2405696892",
        "name": "PS01-06",
        "fileName": "a29c0119-c570-4f5f-b522-fc2405696892.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:32.295488+00:00",
        "thumbnail": "/thumbs/a29c0119-c570-4f5f-b522-fc2405696892.jpg",
        "url": "/videos/a29c0119-c570-4f5f-b522-fc2405696892.mp4"
      },
      {
        "id": "b2efa08f-a1e5-4135-bf58-bc5539f9f920",
        "name": "PS01-05",
        "fileName": "b2efa08f-a1e5-4135-bf58-bc5539f9f920.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:31.522064+00:00",
        "thumbnail": "/thumbs/b2efa08f-a1e5-4135-bf58-bc5539f9f920.jpg",
        "url": "/videos/b2efa08f-a1e5-4135-bf58-bc5539f9f920.mp4"
      },
      {
        "id": "99070858-4567-4ef0-9ba5-9412aeb31120",
        "name": "PS01-04",
        "fileName": "99070858-4567-4ef0-9ba5-9412aeb31120.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:30.931700+00:00",
        "thumbnail": "/thumbs/99070858-4567-4ef0-9ba5-9412aeb31120.jpg",
        "url": "/videos/99070858-4567-4ef0-9ba5-9412aeb31120.mp4"
      },
      {
        "id": "96eccf6f-0165-47eb-a3c7-55db88bb29b2",
        "name": "PS01-02",
        "fileName": "96eccf6f-0165-47eb-a3c7-55db88bb29b2.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:29.649503+00:00",
        "thumbnail": "/thumbs/96eccf6f-0165-47eb-a3c7-55db88bb29b2.jpg",
        "url": "/videos/96eccf6f-0165-47eb-a3c7-55db88bb29b2.mp4"
      },
      {
        "id": "9c696259-99a3-411f-a1f5-f6a3fc3fb92a",
        "name": "PS01-01",
        "fileName": "9c696259-99a3-411f-a1f5-f6a3fc3fb92a.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:29.056404+00:00",
        "thumbnail": "/thumbs/9c696259-99a3-411f-a1f5-f6a3fc3fb92a.jpg",
        "url": "/videos/9c696259-99a3-411f-a1f5-f6a3fc3fb92a.mp4"
      },
      {
        "id": "49716f87-c489-4bd0-af7c-c50015e9b480",
        "name": "PU01-VideoProbe",
        "fileName": "49716f87-c489-4bd0-af7c-c50015e9b480.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:20:54.214416+00:00",
        "thumbnail": "/thumbs/49716f87-c489-4bd0-af7c-c50015e9b480.jpg",
        "url": "/videos/49716f87-c489-4bd0-af7c-c50015e9b480.mp4"
      },
      {
        "id": "eb4684cd-74ad-4763-ada8-347134ac1228",
        "name": "PD07-Regression",
        "fileName": "eb4684cd-74ad-4763-ada8-347134ac1228.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:04:52.555407+00:00",
        "thumbnail": "/thumbs/eb4684cd-74ad-4763-ada8-347134ac1228.jpg",
        "url": "/videos/eb4684cd-74ad-4763-ada8-347134ac1228.mp4"
      },
      {
        "id": "dff70497-d198-4ff5-84a4-1b7265d2f8eb",
        "name": "PD06F-Regression",
        "fileName": "dff70497-d198-4ff5-84a4-1b7265d2f8eb.mp4",
        "type": "video/mp4",
        "addedAt": "2026-07-22T18:44:53.482948+00:00",
        "thumbnail": "/thumbs/dff70497-d198-4ff5-84a4-1b7265d2f8eb.jpg",
        "url": "/videos/dff70497-d198-4ff5-84a4-1b7265d2f8eb.mp4"
      }
    ],
    "vaultAfter": [
      {
        "id": "6060c258-a3f6-40ba-b642-c758562c7cb7",
        "name": "PIPELINE-TRACE-LARGE",
        "fileName": "6060c258-a3f6-40ba-b642-c758562c7cb7.mp4",
        "url": "https://pub-cb178488b1d4413988778e56a7d51439.r2.dev/prod/6060c258-a3f6-40ba-b642-c758562c7cb7.mp4",
        "thumbnail": "/thumbs/6060c258-a3f6-40ba-b642-c758562c7cb7.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-24T16:06:10.223260+00:00"
      },
      {
        "id": "0c335922-ef31-450b-b4d3-9d24a08210cf",
        "name": "8de95c34-a61a-4d24-988b-ba0c115624c9",
        "fileName": "8de95c34-a61a-4d24-988b-ba0c115624c9.mp4",
        "url": "/videos/8de95c34-a61a-4d24-988b-ba0c115624c9.mp4",
        "thumbnail": "/thumbs/0c335922-ef31-450b-b4d3-9d24a08210cf.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-23T12:49:10.821676+00:00"
      },
      {
        "id": "cfa72ff1-0e07-4d6d-aafc-59a7d6ebabc7",
        "name": "bg7h-transport-test",
        "fileName": "cfa72ff1-0e07-4d6d-aafc-59a7d6ebabc7.mp4",
        "url": "/videos/cfa72ff1-0e07-4d6d-aafc-59a7d6ebabc7.mp4",
        "thumbnail": "/thumbs/cfa72ff1-0e07-4d6d-aafc-59a7d6ebabc7.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-23T04:49:39.184571+00:00"
      },
      {
        "id": "bbfe2e70-404a-4635-97ca-7fbd0196030b",
        "name": "bg7h-transport-test",
        "fileName": "bbfe2e70-404a-4635-97ca-7fbd0196030b.mp4",
        "url": "/videos/bbfe2e70-404a-4635-97ca-7fbd0196030b.mp4",
        "thumbnail": "/thumbs/bbfe2e70-404a-4635-97ca-7fbd0196030b.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-23T04:47:00.346791+00:00"
      },
      {
        "id": "010ff031-cd44-41ad-8d61-fd3cf3ac054a",
        "name": "010ff031-cd44-41ad-8d61-fd3cf3ac054a",
        "fileName": "010ff031-cd44-41ad-8d61-fd3cf3ac054a.mp4",
        "url": "/videos/010ff031-cd44-41ad-8d61-fd3cf3ac054a.mp4",
        "thumbnail": "/thumbs/010ff031-cd44-41ad-8d61-fd3cf3ac054a.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-23T04:34:17.995616+00:00"
      },
      {
        "id": "b8bd9cee-899a-45b6-8671-5bd5165aaaf1",
        "name": "probe10",
        "fileName": "b8bd9cee-899a-45b6-8671-5bd5165aaaf1.mp4",
        "url": "/videos/b8bd9cee-899a-45b6-8671-5bd5165aaaf1.mp4",
        "thumbnail": "/thumbs/b8bd9cee-899a-45b6-8671-5bd5165aaaf1.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-23T04:14:28.672845+00:00"
      },
      {
        "id": "4e67d1b3-f6c9-4ac4-bd75-7807978d26f3",
        "name": "PS02-05",
        "fileName": "4e67d1b3-f6c9-4ac4-bd75-7807978d26f3.mp4",
        "url": "/videos/4e67d1b3-f6c9-4ac4-bd75-7807978d26f3.mp4",
        "thumbnail": "/thumbs/4e67d1b3-f6c9-4ac4-bd75-7807978d26f3.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:55:17.890844+00:00"
      },
      {
        "id": "61c56ffe-f17b-42cd-b338-00fca6799c83",
        "name": "PS02-04",
        "fileName": "61c56ffe-f17b-42cd-b338-00fca6799c83.mp4",
        "url": "/videos/61c56ffe-f17b-42cd-b338-00fca6799c83.mp4",
        "thumbnail": "/thumbs/61c56ffe-f17b-42cd-b338-00fca6799c83.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:55:17.161873+00:00"
      },
      {
        "id": "eb081031-a03f-4f21-957e-9c196617225f",
        "name": "PS01-RENAME-TARGET",
        "fileName": "eb081031-a03f-4f21-957e-9c196617225f.mp4",
        "url": "/videos/eb081031-a03f-4f21-957e-9c196617225f.mp4",
        "thumbnail": "/thumbs/eb081031-a03f-4f21-957e-9c196617225f.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:47:33.838996+00:00"
      },
      {
        "id": "e6573dc5-f5cc-4f2e-b74f-4f09980b260e",
        "name": "PS01-08",
        "fileName": "e6573dc5-f5cc-4f2e-b74f-4f09980b260e.mp4",
        "url": "/videos/e6573dc5-f5cc-4f2e-b74f-4f09980b260e.mp4",
        "thumbnail": "/thumbs/e6573dc5-f5cc-4f2e-b74f-4f09980b260e.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:33.458346+00:00"
      },
      {
        "id": "6d4e8087-0ffa-4077-a1b9-4c69858ac2de",
        "name": "PS01-07",
        "fileName": "6d4e8087-0ffa-4077-a1b9-4c69858ac2de.mp4",
        "url": "/videos/6d4e8087-0ffa-4077-a1b9-4c69858ac2de.mp4",
        "thumbnail": "/thumbs/6d4e8087-0ffa-4077-a1b9-4c69858ac2de.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:32.901500+00:00"
      },
      {
        "id": "a29c0119-c570-4f5f-b522-fc2405696892",
        "name": "PS01-06",
        "fileName": "a29c0119-c570-4f5f-b522-fc2405696892.mp4",
        "url": "/videos/a29c0119-c570-4f5f-b522-fc2405696892.mp4",
        "thumbnail": "/thumbs/a29c0119-c570-4f5f-b522-fc2405696892.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:32.295488+00:00"
      },
      {
        "id": "b2efa08f-a1e5-4135-bf58-bc5539f9f920",
        "name": "PS01-05",
        "fileName": "b2efa08f-a1e5-4135-bf58-bc5539f9f920.mp4",
        "url": "/videos/b2efa08f-a1e5-4135-bf58-bc5539f9f920.mp4",
        "thumbnail": "/thumbs/b2efa08f-a1e5-4135-bf58-bc5539f9f920.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:31.522064+00:00"
      },
      {
        "id": "99070858-4567-4ef0-9ba5-9412aeb31120",
        "name": "PS01-04",
        "fileName": "99070858-4567-4ef0-9ba5-9412aeb31120.mp4",
        "url": "/videos/99070858-4567-4ef0-9ba5-9412aeb31120.mp4",
        "thumbnail": "/thumbs/99070858-4567-4ef0-9ba5-9412aeb31120.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:30.931700+00:00"
      },
      {
        "id": "96eccf6f-0165-47eb-a3c7-55db88bb29b2",
        "name": "PS01-02",
        "fileName": "96eccf6f-0165-47eb-a3c7-55db88bb29b2.mp4",
        "url": "/videos/96eccf6f-0165-47eb-a3c7-55db88bb29b2.mp4",
        "thumbnail": "/thumbs/96eccf6f-0165-47eb-a3c7-55db88bb29b2.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:29.649503+00:00"
      },
      {
        "id": "9c696259-99a3-411f-a1f5-f6a3fc3fb92a",
        "name": "PS01-01",
        "fileName": "9c696259-99a3-411f-a1f5-f6a3fc3fb92a.mp4",
        "url": "/videos/9c696259-99a3-411f-a1f5-f6a3fc3fb92a.mp4",
        "thumbnail": "/thumbs/9c696259-99a3-411f-a1f5-f6a3fc3fb92a.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:45:29.056404+00:00"
      },
      {
        "id": "49716f87-c489-4bd0-af7c-c50015e9b480",
        "name": "PU01-VideoProbe",
        "fileName": "49716f87-c489-4bd0-af7c-c50015e9b480.mp4",
        "url": "/videos/49716f87-c489-4bd0-af7c-c50015e9b480.mp4",
        "thumbnail": "/thumbs/49716f87-c489-4bd0-af7c-c50015e9b480.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:20:54.214416+00:00"
      },
      {
        "id": "eb4684cd-74ad-4763-ada8-347134ac1228",
        "name": "PD07-Regression",
        "fileName": "eb4684cd-74ad-4763-ada8-347134ac1228.mp4",
        "url": "/videos/eb4684cd-74ad-4763-ada8-347134ac1228.mp4",
        "thumbnail": "/thumbs/eb4684cd-74ad-4763-ada8-347134ac1228.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T19:04:52.555407+00:00"
      },
      {
        "id": "dff70497-d198-4ff5-84a4-1b7265d2f8eb",
        "name": "PD06F-Regression",
        "fileName": "dff70497-d198-4ff5-84a4-1b7265d2f8eb.mp4",
        "url": "/videos/dff70497-d198-4ff5-84a4-1b7265d2f8eb.mp4",
        "thumbnail": "/thumbs/dff70497-d198-4ff5-84a4-1b7265d2f8eb.jpg",
        "type": "video/mp4",
        "addedAt": "2026-07-22T18:44:53.482948+00:00"
      }
    ],
    "reelId": "432b1c80-0671-4dc1-bd0e-93411919f116"
  },
  "videoLargeR2": {
    "sign": {
      "status": 200,
      "ok": true,
      "uploadId": "116a01c8-6105-4e93-9679-d40045fbcc75",
      "reelId": "3909af4d-0546-4147-9a45-407801b1d07a",
      "ms": 2710
    },
    "r2Put": {
      "ok": false,
      "attempt": 3,
      "error": "fetch failed",
      "ms": 150615,
      "target": "https://f4531bb32bae84de2da9f682afed23e9.r2.cloudflarestorage.com/reelforge-medi"
    }
  },
  "hero": {
    "before": {
      "manager": null,
      "heroReel": null
    },
    "after": {
      "manager": null,
      "heroReel": null
    }
  }
}
```

## Identity Audit

```json
{
  "deleteUsesReelId": true,
  "legacyFallbackDocumented": "basename fallback only when metadata id missing in aiCleanupAgent.handleThumbnailRemove",
  "sampleLines": [
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/contentAgents.js:2:import { deleteReelById } from '../api/media.js';",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/contentAgents.js:187:  await deleteReelById(reelId, { Authorization: `Bearer ${token}` });",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/thumbnailVault.js:425:export function deleteThumbnailVaultEntries(deletedIds = [], imageReels = [], options = {}) {",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/thumbnailVault.js:538:export function removeThumbnailVaultByIndex(fileKey, storageKey = THUMBNAIL_KEY) {",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/aiCleanupAgent.js:3:import { deleteMediaFile, deleteReelById, fetchReadyReels } from '../api/media.js';",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/aiCleanupAgent.js:10:  deleteThumbnailVaultEntries,",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/aiCleanupAgent.js:12:  removeThumbnailVaultByIndex,",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/aiCleanupAgent.js:438:  async handleThumbnailRemove(index) {",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/aiCleanupAgent.js:495:  await deleteReelById(reelId, this.authHeaders());",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/aiCleanupAgent.js:511:  await deleteReelById(imageReel.id, this.authHeaders());",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/aiCleanupAgent.js:526:  deleteThumbnailVaultEntries([reelId], [], {",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/aiCleanupAgent.js:531:  removeThumbnailVaultByIndex(thumbnailKey, CONFIG.THUMBNAIL_STORAGE_KEY);",
    "/home/youloose2dafish/projects/reelforge/frontend/src/lib/viewer/aiCleanupAgent.js:616:  await deleteReelById(videoId, AI_CLEANUP_AGENT.authHeaders());",
    ""
  ]
}
```

## Defects / Root Causes

```json
[]
```
