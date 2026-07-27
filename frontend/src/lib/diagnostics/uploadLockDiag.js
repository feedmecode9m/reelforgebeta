/**
 * BG7X-UPLOAD-DEDUPE-01 — in-flight upload lock diagnostics + active lock registry.
 * Tracks module-scoped dedupe keys from VaultExperience.handleVaultVideoDrop.
 */

/** @typedef {'registered' | 'blocked' | 'removed' | 'superseded'} UploadLockState */

/** @type {Map<string, { key: string; existingId: string; state: UploadLockState; createdAt: string; removedAt: string | null; reason: string }>} */
const lockRegistry = new Map();

/** @type {Map<string, { startedAt: number; lastStageAt: number; existingId: string }>} */
const inFlightLocks = new Map();

/** No upload stage progress for this long → treat lock as stale and allow supersede. */
export const UPLOAD_LOCK_STALE_MS = 45_000;

/**
 * @param {Record<string, unknown>} payload
 */
export function logUploadLock(payload) {
    console.info('[UPLOAD_LOCK]', payload);
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function hasActiveUploadLock(key) {
    return inFlightLocks.has(key);
}

/**
 * @param {string} key
 * @returns {number}
 */
export function getUploadLockAgeMs(key) {
    const entry = inFlightLocks.get(key);
    if (!entry) return 0;
    return Date.now() - entry.startedAt;
}

/**
 * @param {string} key
 * @returns {number}
 */
export function getUploadLockIdleMs(key) {
    const entry = inFlightLocks.get(key);
    if (!entry) return 0;
    return Date.now() - entry.lastStageAt;
}

/** @returns {number} */
export function getActiveUploadLockCount() {
    return inFlightLocks.size;
}

/**
 * @param {string} key
 */
export function touchUploadLockProgress(key) {
    const entry = inFlightLocks.get(key);
    if (entry) entry.lastStageAt = Date.now();
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isUploadLockStale(key) {
    const entry = inFlightLocks.get(key);
    if (!entry) return false;
    return Date.now() - entry.lastStageAt >= UPLOAD_LOCK_STALE_MS;
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} [meta]
 * @returns {boolean}
 */
export function supersedeStaleUploadLock(key, meta = {}) {
    if (!inFlightLocks.has(key)) return false;
    const ageMs = getUploadLockAgeMs(key);
    const idleMs = getUploadLockIdleMs(key);
    inFlightLocks.delete(key);
    console.info('[UPLOAD_LOCK_STALE_SUPERSEDE]', {
        key,
        ageMs,
        idleMs,
        ...meta
    });
    trackUploadLockRemove(key, { reason: 'stale_supersede' });
    return true;
}

/**
 * @param {string} key
 * @param {{ existingId?: string; reason?: string }} [meta]
 */
export function trackUploadLockRegister(key, meta = {}) {
    const createdAt = new Date().toISOString();
    const now = Date.now();
    const entry = {
        key,
        existingId: String(meta.existingId || '').trim(),
        state: /** @type {UploadLockState} */ ('registered'),
        createdAt,
        removedAt: null,
        reason: String(meta.reason || 'upload_start')
    };
    lockRegistry.set(key, entry);
    inFlightLocks.set(key, {
        startedAt: now,
        lastStageAt: now,
        existingId: entry.existingId
    });
    logUploadLock(entry);
    return entry;
}

/**
 * @param {string} key
 * @param {{ existingId?: string; reason?: string }} [meta]
 */
export function trackUploadLockBlock(key, meta = {}) {
    const prior = lockRegistry.get(key);
    const inFlight = inFlightLocks.get(key);
    const entry = {
        key,
        existingId: String(meta.existingId || prior?.existingId || inFlight?.existingId || '').trim(),
        state: /** @type {UploadLockState} */ ('blocked'),
        createdAt: prior?.createdAt || new Date(inFlight?.startedAt || Date.now()).toISOString(),
        removedAt: null,
        reason: String(meta.reason || 'in_flight_name_and_size_match'),
        ageMs: getUploadLockAgeMs(key),
        idleMs: getUploadLockIdleMs(key)
    };
    logUploadLock(entry);
    return entry;
}

/**
 * @param {string} key
 * @param {{ existingId?: string; reason?: string }} [meta]
 */
export function trackUploadLockRemove(key, meta = {}) {
    const prior = lockRegistry.get(key);
    const removedAt = new Date().toISOString();
    const entry = {
        key,
        existingId: String(meta.existingId || prior?.existingId || '').trim(),
        state: /** @type {UploadLockState} */ ('removed'),
        createdAt: prior?.createdAt || removedAt,
        removedAt,
        reason: String(meta.reason || 'finally')
    };
    inFlightLocks.delete(key);
    lockRegistry.delete(key);
    logUploadLock(entry);
    return entry;
}

/**
 * @param {string} key
 * @param {string} existingId
 */
export function noteUploadLockReelId(key, existingId) {
    const prior = lockRegistry.get(key);
    if (prior) {
        prior.existingId = String(existingId || '').trim();
        lockRegistry.set(key, prior);
    }
    const inFlight = inFlightLocks.get(key);
    if (inFlight) {
        inFlight.existingId = String(existingId || '').trim();
        inFlight.lastStageAt = Date.now();
    }
}

/** @returns {Array<Record<string, unknown>>} */
export function snapshotUploadLocks() {
    return Array.from(inFlightLocks.entries()).map(([key, entry]) => ({
        key,
        existingId: entry.existingId,
        ageMs: Date.now() - entry.startedAt,
        idleMs: Date.now() - entry.lastStageAt,
        stale: Date.now() - entry.lastStageAt >= UPLOAD_LOCK_STALE_MS
    }));
}
