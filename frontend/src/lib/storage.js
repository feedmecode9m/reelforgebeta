/** @typedef {{ ok: boolean; recovered?: boolean; error?: Error }} StorageResult */

import { traceThumbStoreWrite } from './viewer/thumbStoreWriteTrace.js';
import {
  isThumbnailVaultWriteActive,
  logThumbOwnerViolation,
  enterThumbnailVaultWrite,
  exitThumbnailVaultWrite
} from './viewer/thumbnailOwnerGuard.js';

const STORAGE_DEBUG = false;

function isPersonalThumbnailsKey(key, options = {}) {
    return key === 'personal_thumbnails' || options.thumbnailKey === 'personal_thumbnails';
}

function guardPersonalThumbnailsWrite(caller, key, value, options = {}) {
    if (!isPersonalThumbnailsKey(key, options) || isThumbnailVaultWriteActive()) return;
    logThumbOwnerViolation(caller, value);
}

export const STORAGE_LIMITS = Object.freeze({
    MAX_TOTAL_BYTES: 5 * 1024 * 1024,
    WARN_BYTES: 3.5 * 1024 * 1024,
    MAX_WRITE_BYTES: 4 * 1024 * 1024,
    MAX_THUMBNAILS: 20
});

export const PRESERVED_KEYS = new Set([
    'reelforge_admin_session_token',
    'admin_mode',
    'reelforge_category_names',
    'reel_titles_persistent',
    'reelforge_hero_manager_config',
    'reelforge_hero_reel',
    'reelforge_hero_video',
    'reelforge_hero_image',
    'heroBackgroundState',
    'reelforge_series_metadata',
    'reelforge_publishing_profile'
]);

export const THUMBNAIL_RELATED_KEYS = [
    'personal_thumbnails',
    'reelforge_feed',
    'reel_vault',
    'personal_video_vault',
    'video_vault_index',
    'recently_viewed',
    'reel_titles',
    'last_ai_cleanup_report'
];

export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function getLocalStorageSize() {
    if (typeof window === 'undefined' || !window.localStorage) return 0;

    let total = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || '';
        const value = localStorage.getItem(key) || '';
        total += (key.length + value.length) * 2;
    }
    return total;
}

export function logStorageState(label = 'state') {
    if (!STORAGE_DEBUG || typeof window === 'undefined') return getLocalStorageSize();

    const total = getLocalStorageSize();
    console.log(`[storage:${label}] total=${formatBytes(total)} keys=${localStorage.length}`);
    return total;
}

export function estimateJsonSize(value) {
    try {
        const json = typeof value === 'string' ? value : JSON.stringify(value);
        return json.length * 2;
    } catch {
        return Number.MAX_SAFE_INTEGER;
    }
}

export function wouldExceedQuota(key, value) {
    const writeSize = estimateJsonSize(value);
    const current = getLocalStorageSize();
    const existing = ((localStorage.getItem(key) || '').length) * 2;
    const projected = current - existing + writeSize;
    return projected > STORAGE_LIMITS.MAX_TOTAL_BYTES;
}

export function isStorageFull() {
    return getLocalStorageSize() >= STORAGE_LIMITS.MAX_TOTAL_BYTES * 0.95;
}

export function hasStorageSpaceFor(value) {
    return !wouldExceedQuota('__probe__', value);
}

/** Metadata only — never persist base64, blob, or preview image bytes. */
export function stripHeavyThumbnailEntries(entries = [], keep = STORAGE_LIMITS.MAX_THUMBNAILS) {
    if (!Array.isArray(entries)) return [];

    const normalized = entries
        .map((item) => {
            if (!item || typeof item !== 'object') return item;
            let url = '';
            if (typeof item.url === 'string' && (item.url.startsWith('data:') || item.url.startsWith('blob:'))) {
                url = item.url.trim();
            } else if (typeof item.url === 'string') {
                // Lazy import avoided — normalize absolute URLs to /thumbs/ paths for storage
                const raw = item.url.trim();
                if (/^https?:\/\//i.test(raw)) {
                    try {
                        url = new URL(raw).pathname;
                    } catch {
                        url = raw;
                    }
                } else {
                    url = raw.startsWith('/') ? raw : `/thumbs/${raw.replace(/^\/+/, '')}`;
                }
            }
            const fileName =
                String(item.fileName || item.file_name || '').trim() ||
                (url ? url.split('/').pop()?.split('?')[0] || '' : '');
            const displayName = String(item.title || item.name || fileName || '').trim();
            return {
                id: item.id ? String(item.id) : undefined,
                fileName,
                name: displayName,
                title: item.title || item.name,
                url,
                size: item.size,
                type: item.type,
                addedAt: item.addedAt || new Date().toISOString(),
                orphaned: item.orphaned === true ? true : undefined
            };
        })
        .filter((item) => item?.fileName || item?.url);

    // Deduplicate thumbnails by canonical URL or fileName — never display name.
    const deduped = [];
    const seen = new Set();
    for (const item of normalized) {
        const urlKey = String(item?.url || '').trim();
        const fileKey = String(item?.fileName || '').trim();
        const key = urlKey || fileKey;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }
    return deduped
        .sort((a, b) => {
            const aTs = new Date(a?.addedAt || 0).getTime();
            const bTs = new Date(b?.addedAt || 0).getTime();
            return bTs - aTs;
        })
        .slice(0, keep);
}

/**
 * Persist thumbnail vault index (paths only). Images live on the backend.
 * @param {string} thumbnailKey
 * @param {unknown[]} entries
 * @returns {StorageResult}
 */
export function storeThumbnailMetadata(thumbnailKey, entries) {
    guardPersonalThumbnailsWrite('storeThumbnailMetadata', thumbnailKey, entries, { thumbnailKey });
    const light = stripHeavyThumbnailEntries(entries);
    let prev = [];
    try {
        prev = JSON.parse(localStorage.getItem(thumbnailKey) || '[]');
    } catch {
        prev = [];
    }
    traceThumbStoreWrite('storeThumbnailMetadata', thumbnailKey, prev, light);
    return safeStorageSet(thumbnailKey, light, { thumbnailKey, skipEviction: true });
}

export function clearOldestThumbnailData(thumbnailKey, keep = STORAGE_LIMITS.MAX_THUMBNAILS) {
    if (typeof window === 'undefined') return [];

    try {
        const stored = JSON.parse(localStorage.getItem(thumbnailKey) || '[]');
        if (!Array.isArray(stored)) {
            localStorage.removeItem(thumbnailKey);
            return [];
        }

        const trimmed = stripHeavyThumbnailEntries(stored, keep);
        enterThumbnailVaultWrite();
        try {
            const writeResult = safeStorageSet(thumbnailKey, trimmed, { skipEviction: true });
            if (!writeResult.ok) {
                try {
                    localStorage.removeItem(thumbnailKey);
                } catch {
                    // ignore
                }
            }
        } finally {
            exitThumbnailVaultWrite();
        }
        console.warn(`[storage] evicted thumbnails, kept ${trimmed.length}`);
        return trimmed;
    } catch (error) {
        console.error('[storage] failed to evict thumbnails:', error);
        try {
            localStorage.removeItem(thumbnailKey);
        } catch {
            // ignore
        }
        return [];
    }
}

export function clearThumbnailRelatedData() {
    if (typeof window === 'undefined') return;

    THUMBNAIL_RELATED_KEYS.forEach((key) => {
        if (PRESERVED_KEYS.has(key)) return;
        try {
            localStorage.removeItem(key);
        } catch {
            // ignore
        }
    });
    console.warn('[storage] cleared thumbnail/feed related keys, preserved auth/settings');
}

export function clearNonPreservedStorageBySize() {
    if (typeof window === 'undefined') return;

    const entries = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || '';
        if (!key || PRESERVED_KEYS.has(key)) continue;
        const value = localStorage.getItem(key) || '';
        entries.push({ key, size: (key.length + value.length) * 2 });
    }

    entries.sort((a, b) => b.size - a.size);
    entries.forEach(({ key }) => {
        if (getLocalStorageSize() <= STORAGE_LIMITS.MAX_TOTAL_BYTES) return;
        try {
            localStorage.removeItem(key);
        } catch {
            // ignore
        }
    });
}

/**
 * Run before startup sync to prevent quota crash loops.
 * @returns {number} storage size after cleanup
 */
export function prepareStorageOnStartup(thumbnailKey) {
    logStorageState('before-startup-cleanup');
    let size = getLocalStorageSize();

    if (size > STORAGE_LIMITS.MAX_TOTAL_BYTES) {
        console.warn('[storage] over 5MB at startup — clearing oldest thumbnail data');
        clearOldestThumbnailData(thumbnailKey, 10);
        size = getLocalStorageSize();
    }

    if (size > STORAGE_LIMITS.MAX_TOTAL_BYTES) {
        console.warn('[storage] still over 5MB — clearing thumbnail-related keys');
        clearThumbnailRelatedData();
        clearOldestThumbnailData(thumbnailKey, 5);
        size = getLocalStorageSize();
    }

    if (size > STORAGE_LIMITS.MAX_TOTAL_BYTES) {
        console.warn('[storage] still over 5MB — evicting largest non-preserved keys');
        clearNonPreservedStorageBySize();
    }

    return logStorageState('after-startup-cleanup');
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {{ skipEviction?: boolean; thumbnailKey?: string }} [options]
 * @returns {StorageResult}
 */
export function safeStorageSet(key, value, options = {}) {
    if (typeof window === 'undefined') return { ok: true };

    let payload = value;
    if (key === 'personal_thumbnails' || key === options.thumbnailKey) {
        payload = stripHeavyThumbnailEntries(Array.isArray(value) ? value : []);
    }

    const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const size = json.length * 2;
    const totalBefore = getLocalStorageSize();

    if (STORAGE_DEBUG) {
        console.log(
            `[storage:set] key=${key} write=${formatBytes(size)} totalBefore=${formatBytes(totalBefore)}`
        );
        if (size > STORAGE_LIMITS.WARN_BYTES) {
            console.warn(`[storage:set] write for ${key} is approaching storage limit`);
        }
    }

    if (!options.skipEviction && size > STORAGE_LIMITS.MAX_WRITE_BYTES) {
        if (key === options.thumbnailKey || key === 'personal_thumbnails') {
            clearOldestThumbnailData(options.thumbnailKey || key, 10);
        }
    }

    guardPersonalThumbnailsWrite('safeStorageSet', key, payload, options);

    try {
        if (key === 'personal_thumbnails' || key === 'personal_thumbnail_index' || key === 'reelforge_feed' || key === options.thumbnailKey) {
            let prev = [];
            try {
                prev = JSON.parse(localStorage.getItem(key) || (key === 'reelforge_feed' ? '{}' : '[]'));
            } catch {
                prev = key === 'reelforge_feed' ? {} : [];
            }
            const prevCount = key === 'reelforge_feed'
                ? Object.values(prev).flat().filter((r) => r?.isPersonalThumbnail).length
                : (Array.isArray(prev) ? prev.length : 0);
            const newCount = key === 'reelforge_feed'
                ? Object.values(payload).flat().filter((r) => r?.isPersonalThumbnail).length
                : (Array.isArray(payload) ? payload.length : 0);
            traceThumbStoreWrite('safeStorageSet', key, prevCount, key === 'reelforge_feed' ? payload : payload, {
                personalThumbPlaceholders: key === 'reelforge_feed' ? newCount : undefined
            });
        }
        localStorage.setItem(key, json);
        if (key === 'personal_video_vault' || key === 'video_vault_index') {
            console.info('[BG7G_STORE]', {
                ts: new Date().toISOString(),
                component: 'safeStorageSet',
                file: 'storage.js',
                fileName: null,
                fileSize: size,
                uploadUrl: null,
                state: 'success',
                key,
                itemCount: Array.isArray(payload) ? payload.length : null
            });
        }
        if (STORAGE_DEBUG) {
            console.log(`[storage:set] ok key=${key} totalAfter=${formatBytes(getLocalStorageSize())}`);
        }
        return { ok: true };
    } catch (error) {
        if (error?.name !== 'QuotaExceededError') {
            console.error('[storage:set] error', key, error);
            return { ok: false, error };
        }

        console.error('[storage:set] quota exceeded for', key);
        if (!PRESERVED_KEYS.has(key)) {
            clearThumbnailRelatedData();
            if (options.thumbnailKey) {
                clearOldestThumbnailData(options.thumbnailKey, 5);
            }
        }

        try {
            localStorage.setItem(key, json);
            logStorageState(`recovered-after-quota-${key}`);
            return { ok: true, recovered: true };
        } catch (retryError) {
            console.error('[storage:set] recovery failed for', key, retryError);
            return { ok: false, error: retryError };
        }
    }
}

export function safeLocalStorageSet(key, data, options = {}) {
    const minimalFields = options.minimalFields || ['id', 'name', 'type', 'size', 'addedAt', 'thumbnail'];
    const maxItems = options.maxItems || STORAGE_LIMITS.MAX_THUMBNAILS;

    let sanitized = Array.isArray(data) ? data.slice(-maxItems) : [];
    const minimal = sanitized.map((item) => {
        const kept = {};
        minimalFields.forEach((field) => {
            if (item?.[field] !== undefined) kept[field] = item[field];
        });
        if (item?.thumbnail && !String(item.thumbnail).startsWith('video') && !String(item.thumbnail).startsWith('blob:')) {
            kept.thumbnail = item.thumbnail;
        }
        if (typeof item?.url === 'string' && !item.url.startsWith('data:')) {
            kept.url = item.url;
        }
        return kept;
    });

    return safeStorageSet(key, minimal, options);
}

export function resetLocalData() {
    logStorageState('before-reset');
    localStorage.clear();
    window.location.reload();
}
