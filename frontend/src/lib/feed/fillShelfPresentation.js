/** BG-7S — presentation-only shelf padding (never mutates feed data). */

export const MIN_SHELF_PRESENTATION_COUNT = 5;

/** BG-7K — layout-only shelf slots (never counted as episodes/assets). */
export function isLayoutOnlyCard(item) {
    return Boolean(item?.isPresentationOnly || item?.layoutOnly);
}

/**
 * @param {string} shelf
 * @param {number} index
 * @returns {Record<string, unknown>}
 */
export function createPresentationPlaceholder(shelf, index) {
    return {
        id: `presentation-placeholder-${shelf}-${index}`,
        isPresentationOnly: true,
        layoutOnly: true,
        isPlaceholder: true,
        selectable: false,
        playable: false,
        title: 'Coming Soon',
        name: 'Coming Soon',
        category: shelf,
        url: null,
        thumbnailUrl: null
    };
}

/**
 * @param {unknown} item
 * @returns {boolean}
 */
export function isRealShelfCard(item) {
    return Boolean(
        item &&
            !item.isPresentationOnly &&
            !item.layoutOnly &&
            !item.isPlaceholder &&
            !item.isBlackStoriesPlaceholder
    );
}

/**
 * First candidate list that still has real (non-placeholder) cards.
 * Empty arrays are not used as a successful source (`[] || fallback` is a trap).
 * @param {Array<unknown[] | null | undefined>} candidates
 * @returns {unknown[]}
 */
export function pickFirstListWithRealCards(candidates) {
    for (const list of candidates) {
        if (!Array.isArray(list) || list.length === 0) continue;
        if (list.some((item) => isRealShelfCard(item))) return list;
    }
    return [];
}

/**
 * @param {unknown} reel
 * @returns {boolean}
 */
export function isPlayableShelfVideo(reel) {
    if (!isRealShelfCard(reel)) return false;
    const url = String(reel?.url || reel?.mediaUrl || reel?.video_url || reel?.playbackUrl || '');
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return false;
    const type = String(reel?.type || reel?.mediaType || '');
    return (
        reel?.isPersonalVideo === true ||
        type.startsWith('video') ||
        url.includes('/videos/') ||
        /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)
    );
}

/**
 * Playable video cards across a feed map (for Trending discovery fallback).
 * @param {Record<string, unknown[]> | null | undefined} feedMap
 * @returns {unknown[]}
 */
export function collectPlayableVideosFromFeedMap(feedMap) {
    const map = feedMap && typeof feedMap === 'object' ? feedMap : {};
    /** @type {unknown[]} */
    const out = [];
    const seen = new Set();
    for (const [shelf, items] of Object.entries(map)) {
        if (shelf === 'Auto-Detect' || shelf === 'HERO') continue;
        for (const reel of items || []) {
            if (!isPlayableShelfVideo(reel)) continue;
            const id = String(reel?.id || '');
            if (id && seen.has(id)) continue;
            if (id) seen.add(id);
            out.push(reel);
        }
    }
    return out;
}

/**
 * Identity-first shelves can already have videos and therefore skip $feed.
 * Reattach creator thumbnail-vault stills that identity dropped.
 * @param {unknown[]} primary
 * @param {Array<unknown[] | null | undefined>} extraLists
 * @returns {unknown[]}
 */
export function mergeMissingVaultImageCards(primary, extraLists = []) {
    const out = Array.isArray(primary) ? [...primary] : [];
    const seenIds = new Set(
        out.map((row) => String(row?.id || '').trim()).filter(Boolean)
    );
    for (const list of extraLists) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (!isRealShelfCard(item)) continue;
            const id = String(item?.id || '').trim();
            if (id && seenIds.has(id)) continue;
            const type = String(item?.type || item?.mediaType || '').toLowerCase();
            const url = String(item?.url || item?.thumbnailUrl || item?.posterUrl || '');
            const isVaultImage =
                item?.isPersonalThumbnail === true ||
                type === 'image' ||
                type === 'thumbnail' ||
                type.startsWith('image/') ||
                (url.includes('/thumbs/') && !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url));
            if (!isVaultImage) continue;
            if (id) seenIds.add(id);
            out.push(item);
        }
    }
    return out;
}

/**
 * Stills on Trending must not skip the vault-video recovery path.
 * Append playable MP4s that are not already on the shelf (by id or playback URL).
 * @param {unknown[]} primary
 * @param {Array<unknown[] | null | undefined>} extraLists
 * @returns {unknown[]}
 */
export function mergeMissingPlayableVideos(primary, extraLists = []) {
    const out = Array.isArray(primary) ? [...primary] : [];
    const seenIds = new Set(
        out.map((row) => String(row?.id || '').trim()).filter(Boolean)
    );
    const seenUrls = new Set(
        out
            .map((row) =>
                String(row?.url || row?.mediaUrl || row?.video_url || row?.playbackUrl || '')
                    .split('?')[0]
                    .toLowerCase()
            )
            .filter(Boolean)
    );
    for (const list of extraLists) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (!isPlayableShelfVideo(item)) continue;
            const id = String(item?.id || '').trim();
            const url = String(item?.url || item?.mediaUrl || item?.video_url || item?.playbackUrl || '')
                .split('?')[0]
                .toLowerCase();
            if (id && seenIds.has(id)) continue;
            if (url && seenUrls.has(url)) continue;
            if (id) seenIds.add(id);
            if (url) seenUrls.add(url);
            out.push(item);
        }
    }
    return out;
}

/**
 * Pad a shelf row for visual composition without altering feed data.
 *
 * Empty-rail policy: when global real catalog inventory exists, never pad empty
 * shelves with Coming Soon — omit fillers (UI skips empty rails).
 * When the entire feed is empty (or caller omits globalRealCount), legacy
 * Coming Soon padding may still apply for onboarding/empty-state.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} items
 * @param {string} shelf
 * @param {number} [minimumCount]
 * @param {{ globalRealCount?: number }} [options]
 * @returns {Array<Record<string, unknown>>}
 */
export function fillShelfPresentation(
    items,
    shelf,
    minimumCount = MIN_SHELF_PRESENTATION_COUNT,
    options = {}
) {
    const real = (items || []).filter(isRealShelfCard);
    const realCount = real.length;
    const globalRealCount =
        options.globalRealCount != null ? Number(options.globalRealCount) : null;

    // BG-7K: once any real asset exists on this shelf, do not pad.
    if (realCount > 0) {
        console.info('[BG7S_SHELF_FILL]', {
            shelf,
            realCount,
            displayCount: realCount,
            fillerCount: 0,
            branch: 'bg7k_real_assets_no_padding'
        });
        return real;
    }

    // Smart catalog: global inventory exists → leave empty shelf empty (no Coming Soon).
    if (globalRealCount != null && globalRealCount > 0) {
        console.info('[BG7S_SHELF_FILL]', {
            shelf,
            realCount: 0,
            displayCount: 0,
            fillerCount: 0,
            branch: 'omit_empty_shelf_global_inventory'
        });
        return [];
    }

    if (realCount >= minimumCount) {
        console.info('[BG7S_SHELF_FILL]', {
            shelf,
            realCount,
            displayCount: realCount,
            fillerCount: 0
        });
        return real;
    }

    const fillerCount = minimumCount - realCount;
    const fillers = Array.from({ length: fillerCount }, (_, i) =>
        createPresentationPlaceholder(shelf, realCount + i)
    );
    const display = [...real, ...fillers];

    console.info('[BG7S_SHELF_FILL]', {
        shelf,
        realCount,
        displayCount: display.length,
        fillerCount
    });

    return display;
}
