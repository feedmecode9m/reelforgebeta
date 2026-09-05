/**
 * Effective shelf distribution — shared contract between Studio SCD and Viewer rails.
 *
 * Physical feed buckets can duplicate genre items onto Trending. Creator-locked
 * categories may not yet be re-bucketed after save. SCD counts and viewer tab
 * filters must use the same effective shelf (creator > persisted > row > bucket).
 */

import {
    getActiveDiscoveryShelves,
    shelfVisibleForViewerRail,
    VIEWER_PRIMARY_RAIL
} from './discoveryTaxonomy.js';
import {
    EXPLICIT_SHELF_CATEGORIES,
    normalizeDiscoveryShelf,
    SOFT_DEFAULT_CATEGORIES
} from './contentClassifier.js';
import { loadCreatorCatalogMetadata } from './creatorCatalogMetadata.js';
import { resolveViewerAssetId } from './viewerIdentityDedupe.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {boolean}
 */
function isCountableReel(reel) {
    if (!reel || typeof reel !== 'object') return false;
    if (reel.isPresentationOnly || reel.isPlaceholder || reel.isBlackStoriesPlaceholder) return false;
    return true;
}

/**
 * Effective primary shelf for one reel (matches audit resolveCurrentCategory intent).
 *
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {{ feedShelf?: string; storage?: ReturnType<typeof import('./creatorCatalogMetadata.js').defaultStorage> }} [options]
 * @returns {string}
 */
export function resolveEffectiveShelfForReel(reel, options = {}) {
    const row = reel && typeof reel === 'object' ? reel : {};
    const id = resolveViewerAssetId(row);

    if (String(row.categorySource || '') === 'creator' || String(row.categorySource || '') === 'studio') {
        const locked = normalizeDiscoveryShelf(
            text(row.creatorCategory || row.studioCategory || row.category)
        );
        if (EXPLICIT_SHELF_CATEGORIES.has(locked)) return locked;
    }

    if (id) {
        const meta = loadCreatorCatalogMetadata(id, options);
        if (meta.category) {
            const persisted = normalizeDiscoveryShelf(meta.category);
            if (EXPLICIT_SHELF_CATEGORIES.has(persisted)) return persisted;
        }
    }

    const raw = text(row.creatorCategory || row.studioCategory || row.category || row.shelfCategory);
    if (raw && !SOFT_DEFAULT_CATEGORIES.has(raw)) {
        const fromRow = normalizeDiscoveryShelf(raw);
        if (EXPLICIT_SHELF_CATEGORIES.has(fromRow)) return fromRow;
    }

    const bucket = normalizeDiscoveryShelf(options.feedShelf || '');
    if (EXPLICIT_SHELF_CATEGORIES.has(bucket)) return bucket;

    return 'Trending';
}

/**
 * Deduped reel id → all shelves that should surface this asset (effective + buckets).
 *
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @param {{ storage?: ReturnType<typeof import('./creatorCatalogMetadata.js').defaultStorage> }} [options]
 * @returns {Map<string, Set<string>>}
 */
export function buildReelEffectiveShelvesMap(feedMap, options = {}) {
    /** @type {Map<string, Set<string>>} */
    const map = new Map();
    const root = feedMap && typeof feedMap === 'object' ? feedMap : {};

    const add = (reelId, shelf) => {
        const id = text(reelId);
        const cat = normalizeDiscoveryShelf(shelf);
        if (!id || !cat) return;
        if (!map.has(id)) map.set(id, new Set());
        map.get(id).add(cat);
    };

    for (const [bucket, items] of Object.entries(root)) {
        if (bucket === 'Auto-Detect' || bucket === 'HERO') continue;
        for (const reel of Array.isArray(items) ? items : []) {
            if (!isCountableReel(reel)) continue;
            const row = /** @type {Record<string, unknown>} */ (reel);
            const id = resolveViewerAssetId(row);
            if (!id) continue;
            add(id, bucket);
            add(id, resolveEffectiveShelfForReel(row, { ...options, feedShelf: bucket }));
        }
    }

    return map;
}

/**
 * One count per unique reel on its effective primary shelf (SCD + viewer handshake).
 *
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @param {{ storage?: ReturnType<typeof import('./creatorCatalogMetadata.js').defaultStorage> }} [options]
 * @returns {Record<string, number>}
 */
export function computeEffectiveShelfCounts(feedMap, options = {}) {
    /** @type {Record<string, number>} */
    const counts = Object.fromEntries(getActiveDiscoveryShelves().map((shelf) => [shelf, 0]));
    /** @type {Set<string>} */
    const seen = new Set();
    const root = feedMap && typeof feedMap === 'object' ? feedMap : {};

    for (const items of Object.values(root)) {
        for (const reel of Array.isArray(items) ? items : []) {
            if (!isCountableReel(reel)) continue;
            const row = /** @type {Record<string, unknown>} */ (reel);
            const id = resolveViewerAssetId(row);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const effective = resolveEffectiveShelfForReel(row, options);
            const canonical = normalizeDiscoveryShelf(effective) || 'Trending';
            if (counts[canonical] != null) counts[canonical] += 1;
            else counts.Trending += 1;
        }
    }

    return counts;
}

/**
 * @param {string} reelId
 * @param {string} railKey
 * @param {Map<string, Set<string>>} shelvesByReel
 */
export function reelMatchesViewerRail(reelId, railKey, shelvesByReel) {
    const key = text(railKey) || 'home';
    if (key === 'home') return true;
    const shelves = shelvesByReel.get(text(reelId));
    if (!shelves || shelves.size === 0) return false;
    for (const shelf of shelves) {
        if (shelfVisibleForViewerRail(shelf, key)) return true;
    }
    return false;
}

/**
 * Reels whose effective primary shelf matches a viewer rail tab (SCD count handshake).
 *
 * @param {string} railKey
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @param {{ storage?: ReturnType<typeof import('./creatorCatalogMetadata.js').defaultStorage> }} [options]
 * @returns {Array<{ reel: Record<string, unknown>; shelf: string }>}
 */
export function collectEffectiveShelfReelsForRail(railKey, feedMap, options = {}) {
    const key = text(railKey) || 'home';
    if (key === 'home') return [];
    const slot = VIEWER_PRIMARY_RAIL.find((row) => row.key === key);
    if (!slot?.shelfId) return [];
    const targetShelf = normalizeDiscoveryShelf(slot.shelfId);
    /** @type {Array<{ reel: Record<string, unknown>; shelf: string }>} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    const root = feedMap && typeof feedMap === 'object' ? feedMap : {};

    for (const items of Object.values(root)) {
        for (const reel of Array.isArray(items) ? items : []) {
            if (!isCountableReel(reel)) continue;
            const row = /** @type {Record<string, unknown>} */ (reel);
            const id = resolveViewerAssetId(row);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const effective = normalizeDiscoveryShelf(resolveEffectiveShelfForReel(row, options));
            if (effective === targetShelf) {
                out.push({ reel: row, shelf: effective });
            }
        }
    }

    return out;
}

/**
 * Viewer rail feed rows — bucket + effective shelf union (SCD counts must match).
 *
 * @param {string} railKey
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @param {{ storage?: ReturnType<typeof import('./creatorCatalogMetadata.js').defaultStorage> }} [options]
 * @param {Map<string, Record<string, unknown>>} [resolvedById]
 */
export function collectViewerRailFeedItems(railKey, feedMap, options = {}, resolvedById = new Map()) {
    const key = text(railKey) || 'home';
    if (key === 'home') return [];

    const shelvesByReel = buildReelEffectiveShelvesMap(feedMap, options);
    const byBucket = collectShelfFeedItemsForViewerRail(railKey, feedMap, shelvesByReel, resolvedById);
    const byEffective = collectEffectiveShelfReelsForRail(railKey, feedMap, options);

    /** @type {Map<string, { reel: Record<string, unknown>; shelf: string; resolvedMedia?: Record<string, unknown> }>} */
    const merged = new Map();

    for (const item of byBucket) {
        const id = resolveViewerAssetId(item.reel);
        if (!id) continue;
        merged.set(id, item);
    }
    for (const item of byEffective) {
        const id = resolveViewerAssetId(item.reel);
        if (!id || merged.has(id)) continue;
        merged.set(id, {
            reel: item.reel,
            shelf: item.shelf,
            resolvedMedia: resolvedById.get(id) || undefined
        });
    }

    return [...merged.values()];
}

/**
 * Feed rows for a viewer primary rail tab (bucket placement filter).
 *
 * @param {string} railKey
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @param {Map<string, Set<string>>} shelvesByReel
 * @param {Map<string, Record<string, unknown>>} [resolvedById]
 * @returns {Array<{ reel: Record<string, unknown>; shelf: string; resolvedMedia?: Record<string, unknown> }>}
 */
export function collectShelfFeedItemsForViewerRail(
    railKey,
    feedMap,
    shelvesByReel,
    resolvedById = new Map()
) {
    const key = text(railKey) || 'home';
    if (key === 'home') return [];
    const slot = VIEWER_PRIMARY_RAIL.find((row) => row.key === key);
    if (!slot?.shelfId) return [];

    /** @type {Array<{ reel: Record<string, unknown>; shelf: string; resolvedMedia?: Record<string, unknown> }>} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    const root = feedMap && typeof feedMap === 'object' ? feedMap : {};

    for (const items of Object.values(root)) {
        for (const reel of Array.isArray(items) ? items : []) {
            if (!isCountableReel(reel)) continue;
            const row = /** @type {Record<string, unknown>} */ (reel);
            const id = resolveViewerAssetId(row);
            if (!id || seen.has(id)) continue;
            if (!reelMatchesViewerRail(id, key, shelvesByReel)) continue;
            seen.add(id);
            const shelves = shelvesByReel.get(id) || new Set();
            const primary =
                [...shelves].find((shelf) => shelfVisibleForViewerRail(shelf, key)) ||
                resolveEffectiveShelfForReel(row) ||
                slot.shelfId;
            out.push({
                reel: row,
                shelf: primary,
                resolvedMedia: resolvedById.get(id) || undefined
            });
        }
    }

    return out;
}

/**
 * Compare physical bucket counts vs effective counts (Studio diagnostics).
 *
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @param {{ storage?: ReturnType<typeof import('./creatorCatalogMetadata.js').defaultStorage> }} [options]
 */
export function describeShelfDistributionHandshake(feedMap, options = {}) {
    const root = feedMap && typeof feedMap === 'object' ? feedMap : {};
    /** @type {Record<string, number>} */
    const bucketCounts = Object.fromEntries(getActiveDiscoveryShelves().map((shelf) => [shelf, 0]));
    for (const shelf of getActiveDiscoveryShelves()) {
        const rows = Array.isArray(root[shelf]) ? root[shelf] : [];
        bucketCounts[shelf] = rows.filter((row) => isCountableReel(row)).length;
    }
    const effectiveCounts = computeEffectiveShelfCounts(root, options);
    const viewerRailPosterCounts = Object.fromEntries(
        VIEWER_PRIMARY_RAIL.filter((slot) => slot.shelfId).map((slot) => [
            slot.key,
            collectViewerRailFeedItems(slot.key, root, options).length
        ])
    );
    return {
        bucketCounts,
        effectiveCounts,
        viewerRailPosterCounts,
        viewerRailMap: Object.fromEntries(
            VIEWER_PRIMARY_RAIL.filter((slot) => slot.shelfId).map((slot) => [
                slot.key,
                {
                    shelfId: slot.shelfId,
                    effectiveCount: effectiveCounts[slot.shelfId] || 0,
                    bucketCount: bucketCounts[slot.shelfId] || 0,
                    posterCount: viewerRailPosterCounts[slot.key] || 0
                }
            ])
        )
    };
}
