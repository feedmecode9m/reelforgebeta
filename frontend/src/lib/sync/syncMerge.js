export const SYNC_DOMAINS = /** @type {const} */ ([
    'seriesMetadata',
    'workflowTasks',
    'releaseSchedule',
    'publishingState'
]);

/** @param {Record<string, unknown>} entry */
export function entryUpdatedAt(entry) {
    const value = entry?.updatedAt;
    return Number.isFinite(value) ? Number(value) : 0;
}

/**
 * @param {Record<string, Record<string, unknown>>} base
 * @param {Record<string, Record<string, unknown>>} incoming
 */
export function mergeEntryMaps(base, incoming) {
    /** @type {Record<string, Record<string, unknown>>} */
    const merged = { ...base };
    for (const [key, incomingEntry] of Object.entries(incoming || {})) {
        const baseEntry = merged[key];
        if (!baseEntry || entryUpdatedAt(incomingEntry) >= entryUpdatedAt(baseEntry)) {
            merged[key] = incomingEntry;
        }
    }
    return merged;
}

/**
 * Detect conflicts and merge with last-write-wins.
 * @param {Record<string, Record<string, unknown>>} localEntries
 * @param {Record<string, Record<string, unknown>>} remoteEntries
 */
export function mergeEntryMapsWithConflicts(localEntries, remoteEntries) {
    /** @type {Record<string, Record<string, unknown>>} */
    const merged = {};
    /** @type {Array<{ domain?: string; key: string; localUpdatedAt: number; remoteUpdatedAt: number; winner: 'local' | 'remote' }>} */
    const conflicts = [];
    const keys = new Set([
        ...Object.keys(localEntries || {}),
        ...Object.keys(remoteEntries || {})
    ]);

    for (const key of keys) {
        const localEntry = localEntries?.[key];
        const remoteEntry = remoteEntries?.[key];

        if (!localEntry) {
            merged[key] = remoteEntry;
            continue;
        }
        if (!remoteEntry) {
            merged[key] = localEntry;
            continue;
        }

        const localAt = entryUpdatedAt(localEntry);
        const remoteAt = entryUpdatedAt(remoteEntry);
        if (localAt !== remoteAt) {
            conflicts.push({
                key,
                localUpdatedAt: localAt,
                remoteUpdatedAt: remoteAt,
                winner: localAt >= remoteAt ? 'local' : 'remote'
            });
        }
        merged[key] = localAt >= remoteAt ? localEntry : remoteEntry;
    }

    return { merged, conflicts };
}

/**
 * @param {Record<string, unknown>} localPayload
 * @param {Record<string, unknown>} remotePayload
 */
export function mergeSyncPayloads(localPayload, remotePayload) {
    /** @type {Record<string, unknown>} */
    const merged = {
        version: 1,
        ...(remotePayload || {}),
        ...(localPayload || {})
    };

    /** @type {Array<{ domain: string; key: string; localUpdatedAt: number; remoteUpdatedAt: number; winner: 'local' | 'remote' }>} */
    const allConflicts = [];

    for (const domain of SYNC_DOMAINS) {
        const localDomain = /** @type {Record<string, unknown>} */ (localPayload?.[domain] || {});
        const remoteDomain = /** @type {Record<string, unknown>} */ (remotePayload?.[domain] || {});
        const localEntries = /** @type {Record<string, Record<string, unknown>>} */ (
            localDomain.entries || {}
        );
        const remoteEntries = /** @type {Record<string, Record<string, unknown>>} */ (
            remoteDomain.entries || {}
        );
        const { merged: entries, conflicts } = mergeEntryMapsWithConflicts(localEntries, remoteEntries);
        for (const conflict of conflicts) {
            allConflicts.push({ domain, ...conflict });
        }
        const updatedAt = Object.values(entries).reduce(
            (max, entry) => Math.max(max, entryUpdatedAt(entry)),
            0
        );
        merged[domain] = { entries, updatedAt };
    }

    merged.__conflicts = allConflicts;
    return merged;
}
