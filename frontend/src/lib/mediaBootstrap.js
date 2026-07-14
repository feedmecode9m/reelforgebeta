import { API_BASE_URL, checkBackendHealth, fetchWithRetry, getAdminAuthorizationHeader } from './api.js';
import {
    normalizeReels,
    isVideoReel,
    isImageReel,
    reelToVaultEntry,
    resolveMediaUrl
} from './api/reelContract.js';
import { resolveUserPosterUrl } from './vaultMedia.js';
import { safeStorageSet } from './storage.js';
import { readThumbnailVault, upgradeThumbnailVaultFromBackendReels } from './viewer/thumbnailVault.js';
import { toRelativeMediaPath } from './config.js';
import { isHeroAsset } from './hero/heroDomainGuard.js';
import { pipelineDiag, pipelineCheckpoint } from './diagnostics/pipelineDiag.js';

/**
 * Media catalog bootstrap — reads authoritative catalog from GET /api/reels (Postgres).
 * Thumbnail vault metadata is owned exclusively by thumbnailVault.js.
 */

/** Canvas/Black Stories placeholders — enabled in dev or when explicitly opted in for production demos. */
export const ALLOW_UI_PLACEHOLDERS =
    import.meta.env.VITE_ALLOW_UI_PLACEHOLDERS === 'true' ||
    (import.meta.env.DEV && import.meta.env.VITE_ALLOW_UI_PLACEHOLDERS !== 'false');

const THUMBNAIL_KEY = 'personal_thumbnails';
const VIDEO_VAULT_KEY = 'personal_video_vault';

function getAdminToken() {
    return typeof window !== 'undefined' ? localStorage.getItem('reelforge_admin_session_token') : null;
}

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
    pipelineCheckpoint('VIEWER_BOOTSTRAP', { phase: 'bootstrapMediaFromBackend:start' });
    pipelineDiag('BOOTSTRAP', 'bootstrapMediaFromBackend', 'mediaBootstrap.js', { result: 'start' });
    const thumbnailKey = config.thumbnailKey || THUMBNAIL_KEY;
    const videoVaultKey = config.videoVaultKey || VIDEO_VAULT_KEY;

    const healthy = await checkBackendHealth();
    if (!healthy) {
        pipelineDiag('BOOTSTRAP', 'bootstrapMediaFromBackend', 'mediaBootstrap.js', { result: 'backend_unavailable' });
        console.log('[mediaBootstrap] backend unavailable — skipping');
        return { source: 'none', thumbnails: 0, videos: 0, reels: 0 };
    }

    const fromReels = await hydrateVaultFromReels(thumbnailKey, videoVaultKey);
    const source = fromReels.thumbnails || fromReels.videos ? 'api-reels' : 'none';
    console.info('[VAULT_BOOTSTRAP]', {
        action: 'bootstrapMediaFromBackend:complete',
        source,
        thumbnails: fromReels.thumbnails,
        videos: fromReels.videos,
        ts: new Date().toISOString()
    });
    pipelineDiag('BOOTSTRAP', 'bootstrapMediaFromBackend', 'mediaBootstrap.js', {
        result: source,
        detail: { thumbnails: fromReels.thumbnails, videos: fromReels.videos }
    });
    return {
        source,
        thumbnails: fromReels.thumbnails,
        videos: fromReels.videos,
        reels: fromReels.thumbnails + fromReels.videos
    };
}

/**
 * Populate video vault localStorage from GET /api/reels. Thumbnails: notify vault only.
 * @param {string} thumbnailKey
 * @param {string} videoVaultKey
 * @param {{ thumbsOnly?: boolean; videosOnly?: boolean }} [options]
 */
export async function hydrateVaultFromReels(thumbnailKey, videoVaultKey, options = {}) {
    const { thumbsOnly = false, videosOnly = false } = options;
    let thumbnailCount = 0;
    let videoCount = 0;

    try {
        pipelineDiag('BOOTSTRAP', 'hydrateVaultFromReels', 'mediaBootstrap.js', { result: 'fetch_reels_start' });
        const res = await fetchWithRetry(
            `${API_BASE_URL}/api/reels?t=${Date.now()}`,
            { headers: getAdminAuthorizationHeader(getAdminToken()) },
            { retries: 2 }
        );
        pipelineDiag('RESPONSE', 'hydrateVaultFromReels', 'mediaBootstrap.js', {
            result: `http_${res.status}`,
            detail: { ok: res.ok }
        });
        if (!res.ok) return { thumbnails: 0, videos: 0 };

        const reels = normalizeReels(await res.json(), 'GET /api/reels (vault hydrate)');
        const videoEntries = [];

        for (const reel of reels) {
            const isThumb = !videosOnly && isImageReel(reel);
            const isVideo = !thumbsOnly && isVideoReel(reel);

            if (isThumb) {
                continue;
            }
            if (isVideo) {
                const entry = reelToVaultEntry(reel);
                if (isHeroAsset(reel) || isHeroAsset(entry)) continue;
                entry.thumbnail = reel.thumbnailUrl
                    ? resolveUserPosterUrl(reel.thumbnailUrl) || entry.thumbnail
                    : entry.thumbnail;
                videoEntries.push(entry);
            }
        }

        if (!videosOnly) {
            const localCount = readThumbnailVault(thumbnailKey).length;
            console.info('[VAULT_BOOTSTRAP]', {
                action: 'hydrateVaultFromReels:thumbs',
                localCount,
                backendReels: reels.length,
                ts: new Date().toISOString()
            });
            if (localCount > 0) {
                const before = localCount;
                thumbnailCount = upgradeThumbnailVaultFromBackendReels(reels, thumbnailKey);
                console.info('[VAULT_BOOTSTRAP]', {
                    action: 'upgradeThumbnailVaultFromBackendReels:complete',
                    before,
                    after: thumbnailCount,
                    ts: new Date().toISOString()
                });
                console.log(`[mediaBootstrap] Notified thumbnailVault to refresh ${thumbnailCount} local thumbnails from [GET /api/reels]`);
            }
        }
        if (!thumbsOnly && videoEntries.length > 0) {
            const merged = dedupeVideoEntries([...readVaultJson(videoVaultKey), ...videoEntries]);
            safeStorageSet(videoVaultKey, merged);
            videoCount = merged.length;
            console.log(`[mediaBootstrap] Hydrated ${videoCount} videos from [GET /api/reels]`);
        }
    } catch (error) {
        pipelineDiag('BOOTSTRAP', 'hydrateVaultFromReels', 'mediaBootstrap.js', {
            result: 'error',
            detail: error?.message || String(error)
        });
        console.warn('[mediaBootstrap] reels vault hydrate failed', error);
    }

    pipelineDiag('BOOTSTRAP', 'hydrateVaultFromReels', 'mediaBootstrap.js', {
        result: 'complete',
        detail: { thumbnails: thumbnailCount, videos: videoCount }
    });

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

/** @deprecated Use upgradeThumbnailVaultFromBackendReels from thumbnailVault.js */
export { upgradeThumbnailVaultFromBackendReels as ingestThumbReelsToVault } from './viewer/thumbnailVault.js';

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
