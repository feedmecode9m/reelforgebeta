/**
 * Video Vault workspace membership (soft hide / restore).
 *
 * Separate from permanent deletion tombstones (`reelforge_deleted_media_ids`).
 * Soft-hidden assets remain durable on the backend and in local vault stores;
 * they are only filtered from the Video Vault presentation surface.
 *
 * Does not touch HeroRecord, PUBLIC APPROVED, or DELETE /api/reels.
 *
 * IMPORTANT: Being the active Hero asset must not reclassify a durable
 * personalVideos row as "ghost chrome". Soft-remove hides from Video Vault only.
 */

/** @type {string} */
export const VIDEO_VAULT_HIDDEN_STORAGE_KEY = 'reelforge_video_vault_hidden_ids';

/** Cap hidden-id list (newest first). */
export const VIDEO_VAULT_HIDDEN_CAP = 200;

/**
 * Durable workspace asset: eligible for soft-remove (hide) only.
 * True ghosts / failed / local-pending never pass this gate.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
export function isDurableVideoVaultWorkspaceAsset(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const row = /** @type {Record<string, unknown>} */ (entry);
    const state = String(row.uploadState || '').trim();
    if (
        row.isOptimisticLocal ||
        state === 'pending_accept' ||
        state === 'uploading' ||
        state === 'interrupted' ||
        state === 'failed'
    ) {
        return false;
    }
    if (row.urlExpired === true) return false;
    const id = String(row.id || row.assetId || row.mediaAssetId || '').trim();
    if (!id || id.startsWith('local-upload-') || id.startsWith('local-pending-')) {
        return false;
    }
    const url = String(row.url || row.video_url || row.src || '').trim();
    if (!url) return false;
    // In-memory blob chrome is not a durable workspace asset for soft-remove.
    if (url.startsWith('blob:') || url.startsWith('data:')) return false;
    return true;
}

/**
 * Stub / ghost purge targets only (NOT soft-remove).
 * Hero-bound durable assets must return false so soft-remove can run instead.
 *
 * @param {unknown} entry
 * @param {{ isHeroInjected?: boolean; isGhost?: boolean }} [flags]
 * @returns {boolean}
 */
export function isVideoVaultStubPurgeTarget(entry, flags = {}) {
    if (isDurableVideoVaultWorkspaceAsset(entry)) return false;
    if (flags.isGhost === true) return true;
    if (flags.isHeroInjected === true) return true;
    if (!entry || typeof entry !== 'object') return true;
    const row = /** @type {Record<string, unknown>} */ (entry);
    const state = String(row.uploadState || '').trim();
    if (state === 'failed' || state === 'interrupted' || state === 'pending_accept') return true;
    if (row.isHeroBackground === true) return true;
    if (row.urlExpired === true) return true;
    const url = String(row.url || row.video_url || row.src || '').trim();
    if (!url || url.startsWith('blob:')) return true;
    return false;
}

/**
 * @returns {string[]}
 */
export function readVideoVaultHiddenIds() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(VIDEO_VAULT_HIDDEN_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((id) => String(id || '').trim()).filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * @param {string[]} ids
 */
export function writeVideoVaultHiddenIds(ids) {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
        const next = (Array.isArray(ids) ? ids : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
            .slice(0, VIDEO_VAULT_HIDDEN_CAP);
        localStorage.setItem(VIDEO_VAULT_HIDDEN_STORAGE_KEY, JSON.stringify(next));
    } catch {
        // ignore quota
    }
}

/**
 * @param {unknown} id
 * @returns {boolean}
 */
export function isVideoVaultHidden(id) {
    const key = String(id || '').trim();
    if (!key) return false;
    return readVideoVaultHiddenIds().includes(key);
}

/**
 * Mark asset hidden from Video Vault presentation only.
 * @param {unknown} id
 * @returns {{ hidden: boolean; ids: string[] }}
 */
export function hideVideoVaultAsset(id) {
    const key = String(id || '').trim();
    if (!key) return { hidden: false, ids: readVideoVaultHiddenIds() };
    const existing = readVideoVaultHiddenIds();
    if (existing.includes(key)) {
        return { hidden: true, ids: existing };
    }
    const next = [key, ...existing.filter((x) => x !== key)].slice(0, VIDEO_VAULT_HIDDEN_CAP);
    writeVideoVaultHiddenIds(next);
    return { hidden: true, ids: next };
}

/**
 * Restore a soft-hidden asset to the Video Vault presentation.
 * @param {unknown} id
 * @returns {{ restored: boolean; ids: string[] }}
 */
export function restoreVideoVaultAsset(id) {
    const key = String(id || '').trim();
    if (!key) return { restored: false, ids: readVideoVaultHiddenIds() };
    const existing = readVideoVaultHiddenIds();
    if (!existing.includes(key)) {
        return { restored: false, ids: existing };
    }
    const next = existing.filter((x) => x !== key);
    writeVideoVaultHiddenIds(next);
    return { restored: true, ids: next };
}

/**
 * Filter vault items that should appear in the Video Vault UI.
 * Does not mutate the underlying list (personalVideos stays intact).
 *
 * @template T
 * @param {T[] | null | undefined} items
 * @param {string[] | null | undefined} [hiddenIds]
 * @returns {T[]}
 */
export function filterVideoVaultVisible(items, hiddenIds = null) {
    const list = Array.isArray(items) ? items : [];
    const hidden = new Set(
        (Array.isArray(hiddenIds) ? hiddenIds : readVideoVaultHiddenIds())
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    );
    if (hidden.size === 0) return list;
    return list.filter((item) => {
        if (!item || typeof item !== 'object') return true;
        const row = /** @type {Record<string, unknown>} */ (item);
        const id = String(row.id || row.assetId || row.mediaAssetId || '').trim();
        if (id && hidden.has(id)) return false;
        return true;
    });
}

/**
 * Soft-remove is never a permanent media delete.
 * @param {unknown} action
 * @returns {boolean}
 */
export function isReversibleVaultRemoveAction(action) {
    return String(action || '').trim() === 'soft-remove-from-vault';
}
