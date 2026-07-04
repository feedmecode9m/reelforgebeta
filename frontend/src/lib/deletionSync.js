import { get } from 'svelte/store';
import { toRelativeMediaPath } from './config.js';
import { filenameFromMediaRef } from './vaultMedia.js';

/** Canonical `/videos/...` key for backend/feed URL comparison. */
function videoInventoryKey(url) {
    const relative = toRelativeMediaPath(String(url || '').split('?')[0]);
    if (!relative.startsWith('/videos/')) return relative;
    return relative;
}

const DEBUG_DELETE = import.meta.env.DEV;

/** @param {string} stage @param {Record<string, unknown>} [details] */
export function logDeletionPropagation(stage, details = {}) {
    if (!DEBUG_DELETE) return;
    console.log(`[delete-propagate] ${stage}`, {
        ts: new Date().toISOString(),
        ...details
    });
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {{ filename?: string; reelId?: string; videoUrl?: string }} match
 */
export function reelMatchesDeletedMedia(reel, { filename = '', reelId = '', videoUrl = '' } = {}) {
    if (!reel) return false;
    const disk = filename ? String(filename).split('/').pop()?.toLowerCase() : '';
    const reelDisk = filenameFromMediaRef(reel)?.toLowerCase() || '';
    const url = String(reel.url || reel.video_url || '').toLowerCase();
    const needle = videoUrl ? String(videoUrl).toLowerCase() : disk ? `/videos/${disk}` : '';

    if (reelId && (reel.id === reelId || reel.personal_video_id === reelId)) return true;
    if (disk && reelDisk === disk) return true;
    if (disk && url.includes(disk)) return true;
    if (needle && url.includes(needle.replace(/^\/+/, ''))) return true;
    if (disk && String(reel.personal_thumbnail || '').toLowerCase().includes(disk)) return true;
    return false;
}

/**
 * Purge client-side feed/vault/theater state after a media delete.
 * @param {object} ctx
 * @param {import('svelte/store').Writable<Record<string, unknown[]>>} ctx.feed
 * @param {import('svelte/store').Writable<unknown[]>} ctx.personalVideos
 * @param {import('svelte/store').Writable<unknown | null>} ctx.activeReel
 * @param {{ closeTheater?: () => void; persistFeed?: (feed: Record<string, unknown[]>) => void; persistVault?: (vault: unknown[]) => void }} ctx.actions
 * @param {{ filename?: string; reelId?: string; videoUrl?: string }} match
 * @returns {{ feedRemoved: number; vaultRemoved: number; theaterClosed: boolean }}
 */
export function purgeMediaFromClientState(ctx, match) {
    const { feed, personalVideos, activeReel, actions } = ctx;
    let feedRemoved = 0;
    let vaultRemoved = 0;
    let theaterClosed = false;

    const active = get(activeReel);
    if (active && reelMatchesDeletedMedia(active, match)) {
        actions.closeTheater?.();
        activeReel.set(null);
        theaterClosed = true;
        logDeletionPropagation('theater-closed', { reelId: active.id, filename: match.filename });
    }

    feed.update((currentFeed) => {
        const newFeed = {};
        Object.keys(currentFeed || {}).forEach((cat) => {
            const before = (currentFeed[cat] || []).length;
            newFeed[cat] = (currentFeed[cat] || []).filter((reel) => !reelMatchesDeletedMedia(reel, match));
            feedRemoved += before - newFeed[cat].length;
        });
        actions.persistFeed?.(newFeed);
        return newFeed;
    });

    personalVideos.update((vault) => {
        const before = (vault || []).length;
        const next = (vault || []).filter((entry) => !reelMatchesDeletedMedia(entry, match));
        vaultRemoved = before - next.length;
        actions.persistVault?.(next);
        return next;
    });

    logDeletionPropagation('client-purge', {
        ...match,
        feedRemoved,
        vaultRemoved,
        theaterClosed
    });

    return { feedRemoved, vaultRemoved, theaterClosed };
}

/**
 * Drop feed reels whose playable video URL is absent from backend inventory.
 * @param {Record<string, unknown[]>} feedMap
 * @param {Set<string>} backendVideoUrls
 */
export function pruneFeedAgainstBackendVideos(feedMap, backendVideoUrls) {
    const pruned = {};
    let removed = 0;
    Object.keys(feedMap || {}).forEach((cat) => {
        pruned[cat] = (feedMap[cat] || []).filter((reel) => {
            if (reel?.isPlaceholder || reel?.isBlackStoriesPlaceholder || reel?.isPersonalThumbnail) {
                return true;
            }
            const url = String(reel?.url || reel?.video_url || '');
            if (!url.includes('/videos/')) return true;
            const key = videoInventoryKey(url);
            const keep = backendVideoUrls.has(key);
            if (!keep) removed += 1;
            return keep;
        });
    });
    if (removed > 0) {
        logDeletionPropagation('feed-pruned-stale-videos', { removed, backendCount: backendVideoUrls.size });
    }
    return { feed: pruned, removed };
}

/** @param {Record<string, unknown[]>} feedMap */
export function diagnoseStalePlaceholders(feedMap) {
    if (!DEBUG_DELETE) return;
    const stale = [];
    Object.entries(feedMap || {}).forEach(([cat, reels]) => {
        (reels || []).forEach((reel) => {
            if (!reel?.isPlaceholder && !reel?.isBlackStoriesPlaceholder) return;
            const hasUrl = Boolean(reel.url || reel.thumbnailUrl || reel.thumbnail_url);
            const hasThumbName = Boolean(reel.personal_thumbnail);
            if (!hasUrl && !hasThumbName) {
                stale.push({ cat, id: reel.id, title: reel.title || reel.name });
            }
        });
    });
    if (stale.length) {
        console.warn('[delete-propagate] stale placeholder nodes (no url/thumb name):', stale);
    }
}
