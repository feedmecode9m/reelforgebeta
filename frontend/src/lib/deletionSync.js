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

/** Persisted deleted media IDs — survives refresh; blocks vault/feed resurrection. */
export const DELETED_MEDIA_STORAGE_KEY = 'reelforge_deleted_media_ids';

/** Cap tombstone list to avoid unbounded localStorage growth (newest retained). */
export const DELETED_MEDIA_IDS_CAP = 200;

/**
 * @returns {string[]}
 */
function readDeletedMediaIds() {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(DELETED_MEDIA_STORAGE_KEY);
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
function writeDeletedMediaIds(ids) {
    if (typeof window === 'undefined') return;
    try {
        const capped = ids.slice(0, DELETED_MEDIA_IDS_CAP);
        localStorage.setItem(DELETED_MEDIA_STORAGE_KEY, JSON.stringify(capped));
    } catch {
        // ignore quota failures
    }
}

/**
 * Record successfully deleted media IDs (call only after DELETE /api/reels/{id} succeeds).
 * Newest IDs are prepended; list is capped.
 * @param {string | string[] | null | undefined} ids
 * @returns {string[]} current tombstone list
 */
export function recordDeletedMediaIds(ids) {
    const incoming = (Array.isArray(ids) ? ids : [ids])
        .map((id) => String(id || '').trim())
        .filter(Boolean);
    if (!incoming.length) return readDeletedMediaIds();

    const existing = readDeletedMediaIds();
    const seen = new Set();
    const next = [];
    for (const id of [...incoming, ...existing]) {
        if (seen.has(id)) continue;
        seen.add(id);
        next.push(id);
    }
    writeDeletedMediaIds(next);
    logDeletionPropagation('tombstone-record', { added: incoming, total: next.length });
    return next;
}

/**
 * Canonical post-DELETE client effects (shared by every UI delete caller):
 * recordDeletedMediaIds → purgeMediaFromClientState / runClientMediaPurge.
 * Call only after deleteReelById succeeds. Callers still own syncFromVault.
 *
 * @param {{
 *   purge?: (match: { filename?: string; reelId?: string; videoUrl?: string }) => unknown;
 *   ctx?: Parameters<typeof purgeMediaFromClientState>[0];
 * }} deps
 * @param {{ filename?: string; reelId?: string; reelIds?: string[]; videoUrl?: string }} match
 * @returns {{ tombstoned: string[]; feedRemoved: number; vaultRemoved: number; theaterClosed: boolean }}
 */
export function applyCanonicalDeleteClientEffects(deps = {}, match = {}) {
    const reelIds = [
        ...((Array.isArray(match.reelIds) ? match.reelIds : [])),
        match.reelId
    ]
        .map((id) => String(id || '').trim())
        .filter(Boolean);
    const uniqueIds = [...new Set(reelIds)];
    recordDeletedMediaIds(uniqueIds);

    const purgeOne = (oneMatch) => {
        if (typeof deps.purge === 'function') {
            deps.purge(oneMatch);
            return { feedRemoved: 0, vaultRemoved: 0, theaterClosed: false };
        }
        if (deps.ctx?.feed && deps.ctx?.personalVideos) {
            return purgeMediaFromClientState(deps.ctx, oneMatch);
        }
        logDeletionPropagation('canonical-client-effects-skipped-purge', {
            reelId: oneMatch?.reelId || null
        });
        return { feedRemoved: 0, vaultRemoved: 0, theaterClosed: false };
    };

    let feedRemoved = 0;
    let vaultRemoved = 0;
    let theaterClosed = false;
    const targets = uniqueIds.length
        ? uniqueIds.map((reelId) => ({
              filename: match.filename,
              videoUrl: match.videoUrl,
              reelId
          }))
        : [match];

    for (const one of targets) {
        const result = purgeOne(one) || {};
        feedRemoved += Number(result.feedRemoved || 0);
        vaultRemoved += Number(result.vaultRemoved || 0);
        theaterClosed = theaterClosed || Boolean(result.theaterClosed);
    }

    logDeletionPropagation('canonical-client-effects', {
        tombstoned: uniqueIds,
        feedRemoved,
        vaultRemoved,
        theaterClosed
    });
    return { tombstoned: uniqueIds, feedRemoved, vaultRemoved, theaterClosed };
}

/**
 * @param {string | null | undefined} id
 * @returns {boolean}
 */
export function isDeletedMediaId(id) {
    const key = String(id || '').trim();
    if (!key) return false;
    return readDeletedMediaIds().includes(key);
}

/**
 * Drop items whose id or personal_video_id is tombstoned.
 * @template T
 * @param {T[] | null | undefined} items
 * @returns {T[]}
 */
export function filterOutDeletedMedia(items) {
    if (!Array.isArray(items) || items.length === 0) return Array.isArray(items) ? items : [];
    const deleted = new Set(readDeletedMediaIds());
    if (deleted.size === 0) return items;
    return items.filter((item) => {
        if (!item || typeof item !== 'object') return true;
        const id = String(/** @type {Record<string, unknown>} */ (item).id || '').trim();
        const personalId = String(
            /** @type {Record<string, unknown>} */ (item).personal_video_id || ''
        ).trim();
        if (id && deleted.has(id)) return false;
        if (personalId && deleted.has(personalId)) return false;
        return true;
    });
}

/**
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @returns {Record<string, unknown[]>}
 */
export function filterDeletedFromFeedMap(feedMap) {
    const out = {};
    Object.keys(feedMap || {}).forEach((cat) => {
        out[cat] = filterOutDeletedMedia(feedMap[cat] || []);
    });
    return out;
}

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
