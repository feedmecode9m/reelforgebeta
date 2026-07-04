/**
 * @deprecated Import from `./studioSync.js` — re-export for backward compatibility.
 */
export {
    syncStatus,
    lastSyncAt,
    collectLocalSyncPayload,
    applySyncPayloadToLocal,
    performSync,
    scheduleSyncPush,
    initStudioSync as initSyncManager,
    stopStudioSync as stopSyncManager,
    logStudioSyncDiag as logSyncDiag
} from './studioSync.js';

export { mergeEntryMaps, mergeSyncPayloads, SYNC_DOMAINS } from './syncMerge.js';
