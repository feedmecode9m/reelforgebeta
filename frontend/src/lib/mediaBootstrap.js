import { API_BASE_URL, checkBackendHealth, fetchWithRetry } from './api.js';
import {
    normalizeReels,
    isVideoReel,
    isImageReel,
    reelToVaultEntry,
    resolveMediaUrl
} from './api/reelContract.js';
import { resolveUserPosterUrl } from './vaultMedia.js';
import { safeStorageSet } from './storage.js';
import { toRelativeMediaPath } from './config.js';
import { isHeroAsset } from './hero/heroDomainGuard.js';

/** Canvas/Black Stories placeholders — enabled in dev or when explicitly opted in for production demos. */
export const ALLOW_UI_PLACEHOLDERS =
    import.meta.env.VITE_ALLOW_UI_PLACEHOLDERS === 'true' ||
    (import.meta.env.DEV && import.meta.env.VITE_ALLOW_UI_PLACEHOLDERS !== 'false');

const THUMBNAIL_KEY = 'personal_thumbnails';
const VIDEO_VAULT_KEY = 'personal_video_vault';

function readVaultJson(key) {
    if (typeof window === 'undefined') return [];
    try {
        const raw = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

/** @param {Array<Record<string, unknown>>} entries */
function dedupeThumbEntries(entries) {
    const seen = new Set();
    return entries.filter((entry) => {
        const url = String(entry?.url || '').trim();
        const name = String(entry?.name || '').trim();
        const fileName = String(entry?.fileName || '').trim();
        const key = url || fileName || name;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** @param {Array<Record<string, unknown>>} entries */
function dedupeVideoEntries(entries) {
    const seen = new Set();
    return entries.filter((entry) => {
        const rawUrl = String(entry?.url || '').trim();
        const canonicalUrl = rawUrl ? toRelativeMediaPath(rawUrl) : '';
        const key = canonicalUrl || String(entry?.fileName || entry?.name || '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Bootstrap vault cache from GET /api/reels only (Postgres catalog).
 * @param {{ thumbnailKey?: string; videoVaultKey?: string }} [config]
 */
export async function bootstrapMediaFromBackend(config = {}) {
    const thumbnailKey = config.thumbnailKey || THUMBNAIL_KEY;
    const videoVaultKey = config.videoVaultKey || VIDEO_VAULT_KEY;

    const healthy = await checkBackendHealth();
    if (!healthy) {
        console.log('[mediaBootstrap] backend unavailable — skipping');
        return { source: 'none', thumbnails: 0, videos: 0, reels: 0 };
    }

    const fromReels = await hydrateVaultFromReels(thumbnailKey, videoVaultKey);
    const source = fromReels.thumbnails || fromReels.videos ? 'api-reels' : 'none';
    return {
        source,
        thumbnails: fromReels.thumbnails,
        videos: fromReels.videos,
        reels: fromReels.thumbnails + fromReels.videos
    };
}

/**
 * Populate vault localStorage from GET /api/reels (canonical DB-backed catalog).
 * @param {string} thumbnailKey
 * @param {string} videoVaultKey
 * @param {{ thumbsOnly?: boolean; videosOnly?: boolean }} [options]
 */
export async function hydrateVaultFromReels(thumbnailKey, videoVaultKey, options = {}) {
    const { thumbsOnly = false, videosOnly = false } = options;
    let thumbnailCount = 0;
    let videoCount = 0;

    try {
        const res = await fetchWithRetry(`${API_BASE_URL}/api/reels`, {}, { retries: 2 });
        if (!res.ok) return { thumbnails: 0, videos: 0 };

        const reels = normalizeReels(await res.json(), 'GET /api/reels (vault hydrate)');
        const thumbEntries = [];
        const videoEntries = [];

        for (const reel of reels) {
            const url = String(reel?.url || '');
            const displayName = String(reel?.name || 'Untitled');
            const fileName = String(reel?.fileName || reel?.file_name || '');
            const isThumb = !videosOnly && isImageReel(reel);
            const isVideo = !thumbsOnly && isVideoReel(reel);

            if (isThumb) {
                if (isHeroAsset(reel)) continue;
                thumbEntries.push({
                    name: displayName,
                    fileName: fileName || displayName,
                    url: resolveMediaUrl(url, 'thumbnail'),
                    addedAt: reel.createdAt || new Date().toISOString()
                });
            } else if (isVideo) {
                const entry = reelToVaultEntry(reel);
                if (isHeroAsset(reel) || isHeroAsset(entry)) continue;
                entry.thumbnail = reel.thumbnailUrl
                    ? resolveUserPosterUrl(reel.thumbnailUrl) || entry.thumbnail
                    : entry.thumbnail;
                videoEntries.push(entry);
            }
        }

        if (!videosOnly && thumbEntries.length > 0) {
            const merged = dedupeThumbEntries([...readVaultJson(thumbnailKey), ...thumbEntries]);
            safeStorageSet(thumbnailKey, merged);
            thumbnailCount = merged.length;
            console.log(`[mediaBootstrap] Hydrated ${thumbnailCount} thumbnails from [GET /api/reels]`);
        }
        if (!thumbsOnly && videoEntries.length > 0) {
            const merged = dedupeVideoEntries([...readVaultJson(videoVaultKey), ...videoEntries]);
            safeStorageSet(videoVaultKey, merged);
            videoCount = merged.length;
            console.log(`[mediaBootstrap] Hydrated ${videoCount} videos from [GET /api/reels]`);
        }
    } catch (error) {
        console.warn('[mediaBootstrap] reels vault hydrate failed', error);
    }

    return { thumbnails: thumbnailCount, videos: videoCount };
}

/** @deprecated Use isVideoReel from reelContract.js */
export function isBackendVideoReel(reel) {
    return isVideoReel(reel);
}

/** @deprecated Use isImageReel from reelContract.js */
export function isBackendThumbReel(reel) {
    return isImageReel(reel) && String(reel?.url || '').includes('/thumbs/');
}

/**
 * Thumbnail reels from API → vault only.
 * @param {Record<string, unknown>[]} reels
 * @param {string} thumbnailKey
 */
export function ingestThumbReelsToVault(reels, thumbnailKey) {
    const existing = readVaultJson(thumbnailKey);
    const entries = [...existing];

    for (const reel of reels || []) {
        if (!isBackendThumbReel(reel)) continue;
        if (isHeroAsset(reel)) continue;
        const url = String(reel?.url || '');
        const resolvedUrl = resolveMediaUrl(url, 'thumbnail');
        const name = String(reel?.name || 'thumb');
        const fileName = String(reel?.fileName || reel?.file_name || name);
        if (
            entries.some(
                (e) =>
                    e?.fileName === fileName ||
                    e?.name === name ||
                    String(e?.url || '').trim() === resolvedUrl
            )
        ) {
            continue;
        }
        entries.push({
            name,
            fileName,
            url: resolvedUrl,
            addedAt: reel?.createdAt || reel?.created_at || new Date().toISOString()
        });
    }

    if (entries.length > existing.length) {
        safeStorageSet(thumbnailKey, dedupeThumbEntries(entries));
    }
    return entries.length;
}

export function reelsToVideoVaultEntries(reels) {
    const entries = [];
    for (const reel of reels || []) {
        if (!isVideoReel(reel)) continue;
        if (isHeroAsset(reel)) continue;
        const entry = reelToVaultEntry(reel);
        if (isHeroAsset(entry)) continue;
        entry.thumbnail =
            resolveUserPosterUrl(reel?.thumbnailUrl || reel?.thumbnail_url) || entry.thumbnail;
        entries.push(entry);
    }
    return dedupeVideoEntries(entries);
}

export function hasLocalMediaCache(thumbnailKey = THUMBNAIL_KEY, videoVaultKey = VIDEO_VAULT_KEY) {
    if (typeof window === 'undefined') return false;
    try {
        const thumbs = JSON.parse(localStorage.getItem(thumbnailKey) || '[]');
        const videos = JSON.parse(localStorage.getItem(videoVaultKey) || '[]');
        return (Array.isArray(thumbs) && thumbs.length > 0) || (Array.isArray(videos) && videos.length > 0);
    } catch {
        return false;
    }
}

/**
 * @param {Record<string, unknown[]>} feed
 */
export function feedHasRealContent(feed) {
    return Object.values(feed || {}).some((items) =>
        Array.isArray(items) && items.some((item) => item && !item.isPlaceholder && !item.isBlackStoriesPlaceholder)
    );
}
