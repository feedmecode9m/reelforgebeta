/**
 * Phase 6.6 — Viewer shelf diversity / presentation composition.
 *
 * Media identity stays canonical (Phase 6.4/6.5). This layer only decides
 * which designed placements remount an identity on one page.
 *
 * Policy:
 *   Featured  — allowed one promotional remount (first priority identity)
 *   Shelves   — discovery rows keep their inventory (Trending etc. unchanged)
 *   Browse    — residual only: identities not already on Featured/shelf rows
 *
 * Does NOT mutate catalog, metadata, posters, upload lifecycle, or NLP.
 */

import { resolveViewerAssetId } from './viewerIdentityDedupe.js';
import {
    collectIdentityDedupedFeedMap,
    collectRealViewerReels
} from './viewerSemanticShell.js';

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
function isRealDiscoveryReel(reel) {
    if (!reel || typeof reel !== 'object') return false;
    if (reel.isPresentationOnly || reel.layoutOnly || reel.isPlaceholder) return false;
    if (reel.isBlackStoriesPlaceholder) return false;
    return true;
}

/**
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @returns {Set<string>}
 */
export function collectShelfConsumedIdentityIds(feedMap) {
    /** @type {Set<string>} */
    const ids = new Set();
    const map = feedMap && typeof feedMap === 'object' ? feedMap : {};
    for (const [shelf, items] of Object.entries(map)) {
        if (shelf === 'Auto-Detect' || shelf === 'HERO') continue;
        for (const reel of items || []) {
            if (!isRealDiscoveryReel(/** @type {Record<string, unknown>} */ (reel))) continue;
            const id = resolveViewerAssetId(/** @type {Record<string, unknown>} */ (reel));
            if (id) ids.add(id);
        }
    }
    return ids;
}

/**
 * Compose Featured / shelf / Browse placements from unique media identities.
 *
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @param {{
 *   uniqueItems?: ReturnType<typeof collectRealViewerReels>;
 *   identityFeedMap?: Record<string, unknown[]>;
 * }} [options]
 * @returns {{
 *   featuredItem: { reel: Record<string, unknown>; shelf: string; resolvedMedia?: unknown } | null;
 *   featuredItems: Array<{ reel: Record<string, unknown>; shelf: string; resolvedMedia?: unknown }>;
 *   shelfFeedMap: Record<string, unknown[]>;
 *   browseItems: Array<{ reel: Record<string, unknown>; shelf: string; resolvedMedia?: unknown }>;
 *   consumedByFeatured: Set<string>;
 *   consumedByShelves: Set<string>;
 *   projectedDomCardCount: number;
 *   uniqueIdentityCount: number;
 *   diagnostics: Record<string, unknown>;
 * }}
 */
export function composeViewerShelfLayouts(feedMap, options = {}) {
    const deduped =
        options.identityFeedMap != null
            ? {
                  feedMap: options.identityFeedMap,
                  suppressedIds: new Set(),
                  pairs: [],
                  resolvedById: new Map()
              }
            : collectIdentityDedupedFeedMap(feedMap);

    const shelfFeedMap =
        deduped.feedMap && typeof deduped.feedMap === 'object' ? deduped.feedMap : {};

    const uniqueItems =
        options.uniqueItems ||
        collectRealViewerReels(feedMap);

    const featuredItem = uniqueItems[0] || null;
    const featuredId = featuredItem
        ? resolveViewerAssetId(/** @type {Record<string, unknown>} */ (featuredItem.reel))
        : '';

    /** @type {Set<string>} */
    const consumedByFeatured = new Set();
    if (featuredId) consumedByFeatured.add(featuredId);

    const consumedByShelves = collectShelfConsumedIdentityIds(shelfFeedMap);

    /** Browse = residual identities not already shown on shelf rows (or featured). */
    const browseItems = uniqueItems.filter((item) => {
        const id = resolveViewerAssetId(/** @type {Record<string, unknown>} */ (item.reel));
        if (!id) return false;
        if (consumedByShelves.has(id)) return false;
        if (consumedByFeatured.has(id)) return false;
        return true;
    });

    const shelfRealCount = [...consumedByShelves].length;
    const featuredRemount = featuredId && consumedByShelves.has(featuredId) ? 1 : featuredId ? 1 : 0;
    const projectedDomCardCount = featuredRemount + shelfRealCount + browseItems.length;

    return {
        featuredItem,
        featuredItems: featuredItem ? [featuredItem] : [],
        shelfFeedMap,
        browseItems,
        consumedByFeatured,
        consumedByShelves,
        projectedDomCardCount,
        uniqueIdentityCount: uniqueItems.length,
        diagnostics: {
            policy: 'featured_promo_remount_browse_residual',
            featuredId: featuredId || null,
            featuredTitle: featuredItem
                ? text(featuredItem.reel?.title || featuredItem.reel?.name)
                : '',
            shelfIdentityCount: shelfRealCount,
            browseIdentityCount: browseItems.length,
            uniqueIdentityCount: uniqueItems.length,
            projectedDomCardCount,
            note: 'Featured may remount one shelf identity; Browse never repeats shelf/Featured identities.'
        }
    };
}

/**
 * Project which layouts would render each identity (presentation audit helper).
 *
 * @param {ReturnType<typeof composeViewerShelfLayouts>} composition
 * @returns {Array<{
 *   assetId: string;
 *   title: string;
 *   Featured: boolean;
 *   shelves: string[];
 *   Browse: boolean;
 *   placementCount: number;
 * }>}
 */
export function auditViewerShelfCompositionPlacements(composition) {
    /** @type {Map<string, { assetId: string; title: string; Featured: boolean; shelves: string[]; Browse: boolean }>} */
    const byId = new Map();

    const ensure = (reel, shelfHint = '') => {
        const id = resolveViewerAssetId(reel);
        if (!id) return null;
        if (!byId.has(id)) {
            byId.set(id, {
                assetId: id,
                title: text(reel.title || reel.name),
                Featured: false,
                shelves: [],
                Browse: false
            });
        }
        const row = byId.get(id);
        if (shelfHint && !row.shelves.includes(shelfHint)) row.shelves.push(shelfHint);
        return row;
    };

    if (composition.featuredItem?.reel) {
        const row = ensure(/** @type {Record<string, unknown>} */ (composition.featuredItem.reel));
        if (row) row.Featured = true;
    }

    for (const [shelf, items] of Object.entries(composition.shelfFeedMap || {})) {
        if (shelf === 'Auto-Detect' || shelf === 'HERO') continue;
        for (const reel of items || []) {
            if (!isRealDiscoveryReel(/** @type {Record<string, unknown>} */ (reel))) continue;
            const row = ensure(/** @type {Record<string, unknown>} */ (reel), shelf);
            void row;
        }
    }

    for (const item of composition.browseItems || []) {
        const row = ensure(/** @type {Record<string, unknown>} */ (item.reel));
        if (row) row.Browse = true;
    }

    return [...byId.values()].map((row) => ({
        ...row,
        placementCount: (row.Featured ? 1 : 0) + row.shelves.length + (row.Browse ? 1 : 0)
    }));
}
