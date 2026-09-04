/**
 * Purge local video vault + feed ghost picks when backend catalog is reachable.
 * Ghost picks: ids absent from GET /api/reels, outline-only stubs, malformed `.playback` ids.
 */

import { isVideoReel } from '../api/reelContract.js';
import {
    pruneGhostVideoVaultEntries,
    pruneFeedAgainstBackendVideos,
    videoInventoryKey,
    recordDeletedMediaIds
} from '../deletionSync.js';

const LEGACY_HERO_KEYS = ['reelforge_hero_video', 'reelforge_hero_image'];
const UUID_IN_TEXT =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
export function extractVaultPickUuids(text) {
    return [...(String(text || '').match(UUID_IN_TEXT) || [])];
}

let reconcileInFlight = null;
let lastReconcileAt = 0;
const RECONCILE_COOLDOWN_MS = 5000;

/**
 * Strip transcoder suffix accidentally stored as a vault id (`{uuid}.playback`).
 * @param {string | null | undefined} id
 */
export function normalizeVaultPickId(id) {
    const raw = String(id || '').trim();
    if (!raw) return '';
    return raw.replace(/\.playback(?:\.mp4)?$/i, '');
}

/**
 * Derivative filenames must not appear as standalone vault pick ids.
 * @param {Record<string, unknown> | null | undefined} entry
 */
export function isMalformedDerivativeVaultPick(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const fields = [
        entry.id,
        entry.assetId,
        entry.personal_video_id,
        entry.fileName,
        entry.file_name,
        entry.name,
        entry.title,
        entry.url,
        entry.video_url,
        entry.mediaUrl,
        entry.src
    ];
    for (const field of fields) {
        if (/\.playback/i.test(String(field || ''))) return true;
    }
    return false;
}

/**
 * Collect every id variant tied to a Hero Manager vault card (assetId + playback twins).
 * @param {Record<string, unknown> | null | undefined} item
 * @returns {Set<string>}
 */
export function collectVaultPickPurgeIdsFromHeroItem(item) {
    const mediaUrl = String(item?.mediaUrl || item?.thumbnailUrl || '').trim();
    const ids = collectVaultPickPurgeIds([item?.assetId, item?.id], mediaUrl);
    const fields = [
        item?.title,
        item?.name,
        item?.fileName,
        item?.file_name,
        item?.mediaUrl,
        item?.thumbnailUrl
    ];
    for (const field of fields) {
        const text = String(field || '').trim();
        if (!text) continue;
        for (const id of collectVaultPickPurgeIds([text], '')) ids.add(id);
        for (const uuid of extractVaultPickUuids(text)) {
            ids.add(uuid);
            ids.add(`${uuid}.playback`);
        }
    }
    return ids;
}

/**
 * @param {string | string[] | null | undefined} rawIds
 * @param {string} [mediaUrl]
 * @returns {Set<string>}
 */
export function collectVaultPickPurgeIds(rawIds, mediaUrl = '') {
    const ids = new Set();
    const list = Array.isArray(rawIds) ? rawIds : [rawIds];
    for (const raw of list) {
        const assetId = String(raw || '').trim();
        if (!assetId) continue;
        ids.add(assetId);
        const normalized = normalizeVaultPickId(assetId);
        if (normalized) ids.add(normalized);
    }
    const url = String(mediaUrl || '').trim();
    if (url) {
        const tail = url.split('/').pop()?.split('?')[0] || '';
        if (tail) {
            ids.add(tail);
            const fromFile = normalizeVaultPickId(tail.replace(/\.mp4$/i, ''));
            if (fromFile) ids.add(fromFile);
        }
    }
    return ids;
}

/**
 * @param {Record<string, unknown> | null | undefined} entry
 * @param {Set<string>} purgeIds
 * @param {string} [mediaUrl]
 */
function entryMatchesVaultPickPurge(entry, purgeIds, mediaUrl = '', purgeAllDerivatives = true) {
    if (!entry || typeof entry !== 'object') return false;
    if (purgeAllDerivatives && isMalformedDerivativeVaultPick(entry)) return true;
    const entryId = String(entry.id || entry.assetId || entry.personal_video_id || '').trim();
    if (entryId) {
        if (purgeIds.has(entryId)) return true;
        const normalized = normalizeVaultPickId(entryId);
        if (normalized && purgeIds.has(normalized)) return true;
    }
    const textFields = [
        entry.fileName,
        entry.file_name,
        entry.name,
        entry.title,
        entry.url,
        entry.video_url,
        entry.mediaUrl,
        entry.src
    ];
    for (const field of textFields) {
        for (const uuid of extractVaultPickUuids(String(field || ''))) {
            if (purgeIds.has(uuid)) return true;
        }
        if (/\.playback/i.test(String(field || ''))) {
            for (const id of collectVaultPickPurgeIds([String(field || '')], '')) {
                if (purgeIds.has(id)) return true;
            }
        }
    }
    const url = String(entry.url || entry.video_url || entry.mediaUrl || entry.src || '').trim();
    if (mediaUrl && url && url === mediaUrl) return true;
    if (url) {
        const tail = url.split('/').pop()?.split('?')[0] || '';
        if (tail && purgeIds.has(tail)) return true;
        const fromUrl = normalizeVaultPickId(tail.replace(/\.mp4$/i, ''));
        if (fromUrl && purgeIds.has(fromUrl)) return true;
        for (const uuid of extractVaultPickUuids(url)) {
            if (purgeIds.has(uuid)) return true;
        }
    }
    return false;
}

/**
 * @param {unknown[] | null | undefined} entries
 * @param {Set<string>} purgeIds
 * @param {string} [mediaUrl]
 * @param {boolean} [purgeAllDerivatives]
 */
export function filterVaultPickEntries(entries, purgeIds, mediaUrl = '', purgeAllDerivatives = true) {
    return (Array.isArray(entries) ? entries : []).filter(
        (entry) => !entryMatchesVaultPickPurge(entry, purgeIds, mediaUrl, purgeAllDerivatives)
    );
}

/**
 * Hard local purge for a vault pick id (Hero + Video vault delete path).
 * Writes localStorage directly so hero retain-merge cannot resurrect tombstoned rows.
 *
 * @param {string | string[] | null | undefined} rawAssetIds
 * @param {{
 *   videoVaultKey?: string;
 *   feedStorageKey?: string;
 *   mediaUrl?: string;
 *   persistVideoVault?: (entries: unknown[]) => void;
 *   persistFeed?: (feedMap: Record<string, unknown[]>) => void;
 *   onPersonalVideosUpdate?: (entries: unknown[]) => void;
 *   onFeedUpdate?: (feedMap: Record<string, unknown[]>) => void;
 *   feedSnapshot?: Record<string, unknown[]>;
 *   purgeAllDerivatives?: boolean;
 *   source?: string;
 * }} [options]
 */
export function purgeVaultPickLocally(rawAssetIds, options = {}) {
    const {
        videoVaultKey = 'personal_video_vault',
        feedStorageKey = 'reelforge_feed',
        mediaUrl = '',
        persistVideoVault,
        persistFeed,
        onPersonalVideosUpdate,
        onFeedUpdate,
        feedSnapshot = null,
        purgeAllDerivatives = true,
        source = 'purgeVaultPickLocally'
    } = options;

    if (typeof window === 'undefined') {
        return { changed: false, purgedIds: [], feedRemoved: 0, videoVaultRemoved: 0 };
    }

    const purgeIds =
        rawAssetIds instanceof Set
            ? rawAssetIds
            : collectVaultPickPurgeIds(rawAssetIds, mediaUrl);
    if (!purgeIds.size) {
        return { changed: false, purgedIds: [], feedRemoved: 0, videoVaultRemoved: 0 };
    }

    recordDeletedMediaIds([...purgeIds]);

    const vaultBefore = readJsonArray(videoVaultKey);
    const vaultAfter = filterVaultPickEntries(vaultBefore, purgeIds, mediaUrl, purgeAllDerivatives);
    const videoVaultRemoved = vaultBefore.length - vaultAfter.length;
    if (videoVaultRemoved > 0) {
        writeJsonArray(videoVaultKey, vaultAfter);
    }

    const feedBefore =
        feedSnapshot && typeof feedSnapshot === 'object'
            ? /** @type {Record<string, unknown[]>} */ (feedSnapshot)
            : readFeedMap(feedStorageKey);
    let feedRemoved = 0;
    /** @type {Record<string, unknown[]>} */
    const feedAfter = {};
    const usingFeedSnapshot = Boolean(feedSnapshot && typeof feedSnapshot === 'object');
    for (const [cat, rows] of Object.entries(feedBefore)) {
        const before = Array.isArray(rows) ? rows.length : 0;
        feedAfter[cat] = filterVaultPickEntries(rows, purgeIds, mediaUrl, purgeAllDerivatives);
        feedRemoved += before - feedAfter[cat].length;
    }
    if (feedRemoved > 0 || usingFeedSnapshot) {
        try {
            localStorage.setItem(feedStorageKey, JSON.stringify(feedAfter));
        } catch {
            /* ignore */
        }
        if (typeof onFeedUpdate === 'function') onFeedUpdate(feedAfter);
        if (typeof persistFeed === 'function') persistFeed(feedAfter);
    }

    purgeLegacyHeroKeysForIds(purgeIds);

    if (videoVaultRemoved > 0) {
        if (typeof onPersonalVideosUpdate === 'function') onPersonalVideosUpdate(vaultAfter);
        if (typeof persistVideoVault === 'function') persistVideoVault(vaultAfter);
    }

    const changed = videoVaultRemoved > 0 || feedRemoved > 0;
    console.info('[VAULT_PICK_LOCAL_PURGE]', {
        source,
        purgedIds: [...purgeIds],
        videoVaultRemoved,
        feedRemoved,
        changed,
        ts: new Date().toISOString()
    });

    return {
        changed,
        purgedIds: [...purgeIds],
        feedRemoved,
        videoVaultRemoved
    };
}

/** @param {string} key */
function readJsonArray(key) {
    if (typeof window === 'undefined') return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

/** @param {string} key @param {unknown[]} value */
function writeJsonArray(key, value) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* ignore quota */
    }
}

/** @param {string} key */
function readFeedMap(key) {
    if (typeof window === 'undefined') return {};
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * @param {unknown[] | null | undefined} backendReels
 */
export function buildVideoCatalogIndex(backendReels) {
    const videoCatalog = (backendReels || []).filter(isVideoReel);
    const backendIds = new Set(
        videoCatalog.map((reel) => String(reel?.id || '').trim()).filter(Boolean)
    );
    const backendVideoUrls = new Set();
    for (const reel of videoCatalog) {
        for (const raw of [reel?.url, reel?.video_url, reel?.playbackUrl, reel?.playback_url]) {
            const key = videoInventoryKey(String(raw || ''));
            if (key) backendVideoUrls.add(key);
        }
    }
    return { videoCatalog, backendIds, backendVideoUrls };
}

/**
 * @param {Set<string>} purgedIds
 */
function purgeLegacyHeroKeysForIds(purgedIds) {
    if (typeof window === 'undefined' || !purgedIds?.size) return;
    for (const key of LEGACY_HERO_KEYS) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            const entryId = String(parsed?.id || parsed?.assetId || '').trim();
            const canonical = normalizeVaultPickId(entryId) || entryId;
            if ((entryId && purgedIds.has(entryId)) || (canonical && purgedIds.has(canonical))) {
                localStorage.removeItem(key);
            }
        } catch {
            /* ignore */
        }
    }
}

/**
 * @param {unknown[] | null | undefined} backendReels
 * @param {{
 *   backendReachable?: boolean;
 *   videoVaultKey?: string;
 *   feedStorageKey?: string;
 *   persistVideoVault?: (entries: unknown[]) => void;
 *   persistFeed?: (feedMap: Record<string, unknown[]>) => void;
 *   onPersonalVideosUpdate?: (entries: unknown[]) => void;
 *   source?: string;
 * }} [options]
 */
export function reconcileVaultGhostPicks(backendReels, options = {}) {
    const {
        backendReachable = true,
        videoVaultKey = 'personal_video_vault',
        feedStorageKey = 'reelforge_feed',
        persistVideoVault,
        persistFeed,
        onPersonalVideosUpdate,
        source = 'vaultGhostPickCleanup'
    } = options;

    if (!backendReachable || typeof window === 'undefined') {
        return {
            skipped: 'offline',
            purgedVideoIds: [],
            feedRemoved: 0,
            videoVaultBefore: 0,
            videoVaultAfter: 0,
            changed: false
        };
    }

    const { videoCatalog, backendVideoUrls } = buildVideoCatalogIndex(backendReels);
    const localBefore = readJsonArray(videoVaultKey);
    const purgedVideoIds = [];

    const withoutDerivatives = localBefore.filter((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        if (isMalformedDerivativeVaultPick(entry)) {
            const id = String(entry.id || entry.assetId || '').trim();
            if (id) purgedVideoIds.push(normalizeVaultPickId(id) || id);
            return false;
        }
        return true;
    });

    const pruned = pruneGhostVideoVaultEntries(withoutDerivatives, videoCatalog);
    const keptIds = new Set(
        pruned.map((entry) => String(entry?.id || '').trim()).filter(Boolean)
    );
    for (const entry of localBefore) {
        const id = String(entry?.id || '').trim();
        if (!id || keptIds.has(id)) continue;
        if (!purgedVideoIds.includes(id)) purgedVideoIds.push(id);
    }

    const videoChanged = pruned.length !== localBefore.length;
    if (videoChanged) {
        writeJsonArray(videoVaultKey, pruned);
        if (typeof persistVideoVault === 'function') persistVideoVault(pruned);
        if (typeof onPersonalVideosUpdate === 'function') onPersonalVideosUpdate(pruned);
    }

    const feedBefore = readFeedMap(feedStorageKey);
    const { feed: prunedFeed, removed: feedRemoved } = pruneFeedAgainstBackendVideos(
        feedBefore,
        backendVideoUrls
    );
    const feedChanged = feedRemoved > 0;
    if (feedChanged && typeof persistFeed === 'function') {
        persistFeed(prunedFeed);
    } else if (feedChanged) {
        try {
            localStorage.setItem(feedStorageKey, JSON.stringify(prunedFeed));
        } catch {
            /* ignore */
        }
    }

    if (purgedVideoIds.length) {
        purgeLegacyHeroKeysForIds(new Set(purgedVideoIds));
    }

    const result = {
        skipped: null,
        purgedVideoIds,
        feedRemoved,
        videoVaultBefore: localBefore.length,
        videoVaultAfter: pruned.length,
        changed: videoChanged || feedChanged,
        source
    };

    console.info('[VAULT_GHOST_RECONCILE]', {
        ...result,
        backendVideos: videoCatalog.length,
        ts: new Date().toISOString()
    });

    return result;
}

/**
 * Fetch-aware reconcile with in-flight dedupe + cooldown (safe for Vault + Hero Manager mount).
 * @param {() => Promise<unknown[]>} fetchReels
 * @param {Parameters<typeof reconcileVaultGhostPicks>[1] & { force?: boolean; backendReels?: unknown[] }} [options]
 */
export async function reconcileVaultGhostPicksAsync(fetchReels, options = {}) {
    const source = options.source || 'vaultGhostPickCleanup';
    console.info('[VAULT_GHOST_RECONCILE_START]', {
        source,
        force: Boolean(options.force),
        ts: new Date().toISOString()
    });
    const now = Date.now();
    if (!options.force && now - lastReconcileAt < RECONCILE_COOLDOWN_MS) {
        console.info('[VAULT_GHOST_RECONCILE]', {
            action: 'skipped',
            reason: 'cooldown',
            source,
            ts: new Date().toISOString()
        });
        return { skipped: 'cooldown', changed: false, purgedVideoIds: [], feedRemoved: 0 };
    }
    if (reconcileInFlight) return reconcileInFlight;

    reconcileInFlight = (async () => {
        try {
            const backendReels =
                options.backendReels ??
                (typeof fetchReels === 'function' ? await fetchReels() : []);
            lastReconcileAt = Date.now();
            return reconcileVaultGhostPicks(backendReels, options);
        } catch (error) {
            console.info('[VAULT_GHOST_RECONCILE]', {
                action: 'skipped',
                reason: 'fetch_failed',
                error: String(error?.message || error),
                source: options.source || 'vaultGhostPickCleanup',
                ts: new Date().toISOString()
            });
            return {
                skipped: 'fetch_failed',
                changed: false,
                purgedVideoIds: [],
                feedRemoved: 0
            };
        } finally {
            reconcileInFlight = null;
        }
    })();

    return reconcileInFlight;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
    /** @type {typeof reconcileVaultGhostPicksAsync | undefined} */
    window.__reelforgeReconcileVaultGhosts = reconcileVaultGhostPicksAsync;
    window.__reelforgePurgeVaultPick = purgeVaultPickLocally;
}
