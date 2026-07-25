/**
 * BG7X-UPLOAD-DEDUPE-01 — in-flight upload lock diagnostics (observability only).
 * Tracks module-scoped dedupe keys from VaultExperience.handleVaultVideoDrop.
 */

/** @typedef {'registered' | 'blocked' | 'removed'} UploadLockState */

/** @type {Map<string, { key: string; existingId: string; state: UploadLockState; createdAt: string; removedAt: string | null; reason: string }>} */
const lockRegistry = new Map();

/**
 * @param {Record<string, unknown>} payload
 */
export function logUploadLock(payload) {
    console.info('[UPLOAD_LOCK]', payload);
}

/**
 * @param {string} key
 * @param {{ existingId?: string; reason?: string }} [meta]
 */
export function trackUploadLockRegister(key, meta = {}) {
    const createdAt = new Date().toISOString();
    const entry = {
        key,
        existingId: String(meta.existingId || '').trim(),
        state: /** @type {UploadLockState} */ ('registered'),
        createdAt,
        removedAt: null,
        reason: String(meta.reason || 'upload_start')
    };
    lockRegistry.set(key, entry);
    logUploadLock(entry);
    return entry;
}

/**
 * @param {string} key
 * @param {{ existingId?: string; reason?: string }} [meta]
 */
export function trackUploadLockBlock(key, meta = {}) {
    const prior = lockRegistry.get(key);
    const entry = {
        key,
        existingId: String(meta.existingId || prior?.existingId || '').trim(),
        state: /** @type {UploadLockState} */ ('blocked'),
        createdAt: prior?.createdAt || new Date().toISOString(),
        removedAt: null,
        reason: String(meta.reason || 'in_flight_name_and_size_match')
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
    if (!prior) return;
    prior.existingId = String(existingId || '').trim();
    lockRegistry.set(key, prior);
}

/** @returns {Array<Record<string, unknown>>} */
export function snapshotUploadLocks() {
    return Array.from(lockRegistry.values());
}
