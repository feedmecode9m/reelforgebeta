/** BG-7P — homepage shelf assignment trace (instrumentation only). */

const FEED_SHELVES = ['Trending', 'Romance', 'Cyber-Action', 'Suspense'];

/** @param {string} [category] */
function mapFeedCategory(category) {
    const cat = String(category || 'Trending').trim();
    if (cat === 'Network') return 'Trending';
    if (cat === 'Love' || cat === 'Drama') return 'Romance';
    if (cat === 'Action') return 'Cyber-Action';
    if (FEED_SHELVES.includes(cat)) return cat;
    return 'Trending';
}

/**
 * @param {Record<string, unknown> | null | undefined} card
 */
function shelfFields(card) {
    return {
        id: String(card?.id || '').slice(0, 8),
        category: card?.category ?? null,
        shelf: mapFeedCategory(String(card?.category || 'Trending')),
        genre: card?.genre ?? card?.genres ?? null,
        lane: card?.lane ?? null,
        section: card?.section ?? null,
        type: card?.type ?? null,
        isHeroFeedCard: Boolean(card?.isHeroFeedCard),
        isCatalogImage: Boolean(card?.isCatalogImage)
    };
}

/**
 * @param {Record<string, unknown[]> | Record<string, unknown>[]} feedLike
 */
export function shelfCountsFromFeed(feedLike) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const shelf of FEED_SHELVES) counts[shelf] = 0;
    if (Array.isArray(feedLike)) {
        for (const card of feedLike) {
            const shelf = mapFeedCategory(String(card?.category || 'Trending'));
            counts[shelf] = (counts[shelf] || 0) + 1;
        }
        return counts;
    }
    for (const shelf of FEED_SHELVES) {
        counts[shelf] = (feedLike?.[shelf] || []).filter(Boolean).length;
    }
    return counts;
}

/**
 * @param {string} stage
 * @param {Record<string, unknown[]>} feedMap
 * @param {Record<string, unknown>[]} [flatCards]
 */
export function logBg7pShelfDistribution(stage, feedMap, flatCards = null) {
    const cards =
        flatCards ||
        Object.values(feedMap || {}).flat().filter((r) => r && !r?.isPlaceholder);
    const rows = cards.map((c) => shelfFields(c));
    const counts = shelfCountsFromFeed(feedMap || {});

    console.info('[BG7P_SHELF_DISTRIBUTION]', {
        stage,
        feedKeys: Object.keys(feedMap || {}),
        shelfCounts: counts,
        totalCards: cards.length,
        timestamp: new Date().toISOString()
    });

    if (rows.length > 0) {
        console.table(rows);
    }
}

/**
 * @param {Record<string, unknown>[]} catalog
 * @param {Record<string, unknown[]>} feedMap
 */
export function logBg7pCatalogToShelfMapping(catalog, feedMap) {
    /** @type {Record<string, string>} */
    const cardShelfById = {};
    for (const shelf of FEED_SHELVES) {
        for (const card of feedMap?.[shelf] || []) {
            cardShelfById[String(card?.id || '')] = shelf;
        }
    }

    const rows = (catalog || []).map((reel) => ({
        id: String(reel?.id || '').slice(0, 8),
        apiCategory: reel?.category ?? null,
        mappedShelf: mapFeedCategory(String(reel?.category || 'Trending')),
        assignedShelf: cardShelfById[String(reel?.id || '')] ?? '(not in feed)',
        type: reel?.type ?? null
    }));

    console.info('[BG7P_CATALOG_TO_SHELF]', {
        stage: 'buildHomeFeed:catalogMapping',
        timestamp: new Date().toISOString()
    });
    console.table(rows);
}
