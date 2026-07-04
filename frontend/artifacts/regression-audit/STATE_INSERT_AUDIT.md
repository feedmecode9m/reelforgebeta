# State Insert Audit

## Instrumentation

- Hooked `localStorage.setItem` for:
  - `personal_thumbnails`
  - `personal_video_vault`
  - `reelforge_feed`
- Emitted `[ASSET_INSERT]` with key/count/timestamp and stack snapshot.

Sample emitted diagnostics included:

```json
{
  "assetId": "0a8a80dc-23c8-46b0-a8a7-e681cb405218",
  "assetName": "dup-audit-1781398557136.png",
  "source": "VaultExperience.acceptPendingThumbnail -> storeThumbnailMetadata",
  "stack": "at storeThumbnailMetadata ... at acceptPendingThumbnail ..."
}
```

```json
{
  "assetId": "383de3a5-5c32-41f6-9bb2-578d0ba9a11f",
  "assetName": "383de3a5-5c32-41f6-9bb2-578d0ba9a11f",
  "source": "viewerContext.syncFromVault -> mergeVideoVaultEntries",
  "stack": "at mergeVideoVaultEntries ... at syncFromVault ..."
}
```

## Observed insertion sources

### Thumbnail pipeline

1. `VaultExperience.acceptPendingThumbnail()`
   - writes immediate thumbnail entry via `storeThumbnailMetadata(...)`
2. `viewerContext.syncFromVault(...)`
   - rehydrates from backend (`ingestThumbReelsToVault` + `reloadVaultStoresFromStorage`)

### Video pipeline

1. `VaultExperience.handleVaultVideoDrop()`
   - immediate insert into `personalVideos`
2. `viewerContext.syncFromVault(...)`
   - backend merge into vault (`mergeVideoVaultEntries`)

## Root duplicate insertion mechanism (confirmed)

- Same uploaded asset URL was inserted via two sources with non-canonical identity:
  - thumbnail: same URL under two different names
  - video: same asset under absolute and relative URL variants

## Post-fix verification counts per upload id

- `jpg`: `[ASSET_INSERT] count = 1`
- `png`: `[ASSET_INSERT] count = 1`
- `webp`: `[ASSET_INSERT] count = 1`
- `gif`: `[ASSET_INSERT] count = 1`
- `mp4`: `[ASSET_INSERT] count = 1` (after URL canonical dedupe fix)

## Conclusion

- Duplicate state insertions were caused by non-canonical dedupe keys, not repeated upload invocation.
