/**
 * Phase 26.2 — shared Command Center refresh boundary.
 * Collapses nested ProductionCommandCenter + StudioWorkspaceLayout refresh storms
 * into one debounced cadence with a single interval owner.
 */

export const COMMAND_CENTER_REFRESH_DEBOUNCE_MS = 400;
export const COMMAND_CENTER_REFRESH_INTERVAL_MS = 5000;

/** @type {Set<(reason: string) => void>} */
const listeners = new Set();

/** @type {ReturnType<typeof setTimeout> | null} */
let debounceTimer = null;

/** @type {ReturnType<typeof setInterval> | null} */
let intervalId = null;

/** @type {string | null} */
let intervalOwnerId = null;

/** @type {number} */
let scheduledCount = 0;

/** @type {number} */
let flushedCount = 0;

/**
 * @param {(reason: string) => void} callback
 * @returns {() => void}
 */
export function registerCommandCenterRefreshListener(callback) {
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
}

/**
 * Debounced fan-out — many events coalesce into one refresh wave.
 * @param {string} [reason]
 */
export function scheduleCommandCenterRefresh(reason = 'event') {
    scheduledCount += 1;
    if (typeof window === 'undefined') {
        flushCommandCenterRefresh(reason);
        return;
    }
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        flushCommandCenterRefresh(reason);
    }, COMMAND_CENTER_REFRESH_DEBOUNCE_MS);
}

/** @param {string} [reason] */
function flushCommandCenterRefresh(reason = 'flush') {
    flushedCount += 1;
    for (const listener of [...listeners]) {
        try {
            listener(reason);
        } catch {
            /* ignore listener errors */
        }
    }
}

/**
 * Only one owner may hold the shared interval (PCC preferred when nested).
 * Secondary callers receive a no-op disposer.
 * @param {string} ownerId
 * @param {number} [intervalMs]
 * @returns {() => void}
 */
export function startCommandCenterRefreshInterval(
    ownerId,
    intervalMs = COMMAND_CENTER_REFRESH_INTERVAL_MS
) {
    if (typeof window === 'undefined') {
        return () => {};
    }
    if (intervalId && intervalOwnerId && intervalOwnerId !== ownerId) {
        return () => {};
    }
    if (intervalId && intervalOwnerId === ownerId) {
        return () => stopCommandCenterRefreshInterval(ownerId);
    }
    intervalOwnerId = ownerId;
    intervalId = window.setInterval(() => {
        scheduleCommandCenterRefresh('interval');
    }, intervalMs);
    return () => stopCommandCenterRefreshInterval(ownerId);
}

/** @param {string} ownerId */
export function stopCommandCenterRefreshInterval(ownerId) {
    if (intervalOwnerId !== ownerId) return;
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    intervalOwnerId = null;
}

/** @returns {{ scheduledCount: number; flushedCount: number; listenerCount: number; intervalOwnerId: string | null }} */
export function getCommandCenterRefreshStats() {
    return {
        scheduledCount,
        flushedCount,
        listenerCount: listeners.size,
        intervalOwnerId
    };
}

/** Test helper — reset module state between assertions. */
export function resetCommandCenterRefreshForTests() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    intervalOwnerId = null;
    listeners.clear();
    scheduledCount = 0;
    flushedCount = 0;
}
