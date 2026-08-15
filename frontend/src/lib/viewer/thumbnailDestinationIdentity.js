/**
 * Canonical identity for thumbnail destination surfaces (feed shelves, Hero Vault picks).
 *
 * Canonical asset id = backend reel/thumbnail id when present.
 * Synthetic feed cards use `personal-thumb-{reelId}` and must not count as a second asset.
 */

/**
 * @param {unknown} entry
 * @returns {string}
 */
export function canonicalThumbnailAssetId(entry) {
    if (entry == null) return '';
    if (typeof entry === 'string') {
        const raw = String(entry).trim();
        const fromSynthetic = stripPersonalThumbPrefix(raw);
        return fromSynthetic || '';
    }
    if (typeof entry !== 'object') return '';
    const rawId = String(
        /** @type {Record<string, unknown>} */ (entry).id ||
            /** @type {Record<string, unknown>} */ (entry).assetId ||
            /** @type {Record<string, unknown>} */ (entry).personal_video_id ||
            ''
    ).trim();
    return stripPersonalThumbPrefix(rawId) || rawId;
}

/**
 * @param {string} id
 * @returns {string}
 */
export function stripPersonalThumbPrefix(id) {
    const raw = String(id || '').trim();
    const match = raw.match(/^personal-thumb-(.+)$/i);
    return match ? String(match[1] || '').trim() : raw;
}

/**
 * Synthetic personal-thumbnail feed card (legacy local injection path).
 * @param {unknown} entry
 * @returns {boolean}
 */
export function isSyntheticPersonalThumbnailFeedCard(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const row = /** @type {Record<string, unknown>} */ (entry);
    if (row.isPersonalThumbnail === true) return true;
    const id = String(row.id || '').trim();
    return /^personal-thumb-/i.test(id);
}

/**
 * True when a shelf already has a non-synthetic card for the same thumbnail asset id
 * (typically buildHomeFeed catalog image with vault membership).
 * @param {Record<string, unknown[]>} feedMap
 * @param {string} assetId
 * @returns {boolean}
 */
export function feedHasCatalogOwnedThumbnailCard(feedMap, assetId) {
    const target = stripPersonalThumbPrefix(assetId);
    if (!target) return false;
    for (const items of Object.values(feedMap || {})) {
        if (!Array.isArray(items)) continue;
        for (const row of items) {
            if (!row || typeof row !== 'object') continue;
            if (isSyntheticPersonalThumbnailFeedCard(row)) continue;
            const type = String(/** @type {Record<string, unknown>} */ (row).type || '').toLowerCase();
            const url = String(/** @type {Record<string, unknown>} */ (row).url || '');
            const isVideo =
                type.startsWith('video') ||
                url.includes('/videos/') ||
                /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
            if (isVideo) continue;
            const id = String(/** @type {Record<string, unknown>} */ (row).id || '').trim();
            if (!id) continue;
            if (id === target || canonicalThumbnailAssetId(row) === target) return true;
        }
    }
    return false;
}

/**
 * Whether syncThumbnailsToFeed / distributeThumbnail should inject a synthetic card.
 * Skip when catalog authority already owns this asset id in the feed.
 * @param {unknown} thumb
 * @param {Record<string, unknown[]>} feedMap
 * @returns {boolean}
 */
export function shouldSynthesizePersonalThumbnailFeedCard(thumb, feedMap) {
    if (!thumb) return false;
    const reelId =
        typeof thumb === 'string'
            ? ''
            : String(/** @type {Record<string, unknown>} */ (thumb).id || '').trim();
    if (reelId && feedHasCatalogOwnedThumbnailCard(feedMap, reelId)) {
        return false;
    }
    return true;
}

/**
 * Group destination cards by canonical thumbnail asset id (ignores real presentation placeholders).
 * @param {Array<Record<string, unknown>>} cards
 * @returns {Map<string, Array<Record<string, unknown>>>}
 */
export function groupDestinationCardsByThumbnailAssetId(cards) {
    /** @type {Map<string, Array<Record<string, unknown>>>} */
    const map = new Map();
    for (const card of cards || []) {
        if (!card || typeof card !== 'object') continue;
        // Layout-only / demo shelf pads are not dual representations of a vault thumbnail.
        if (card.isPresentationOnly || card.layoutOnly) continue;
        if (card.isPlaceholder === true && !card.isPersonalThumbnail && !card.isCatalogImage) continue;
        const key = canonicalThumbnailAssetId(card);
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(card);
    }
    return map;
}

/**
 * Invariant: at most one destination card per canonical thumbnail asset id.
 * @param {Array<Record<string, unknown>>} cards
 * @param {string} [destinationLabel]
 * @returns {{ ok: boolean, violations: Array<{ assetId: string, count: number, ids: string[] }> }}
 */
export function assertAtMostOneCardPerThumbnailAsset(cards, destinationLabel = 'destination') {
    const groups = groupDestinationCardsByThumbnailAssetId(cards);
    /** @type {Array<{ assetId: string, count: number, ids: string[] }>} */
    const violations = [];
    for (const [assetId, group] of groups) {
        if (group.length > 1) {
            violations.push({
                assetId,
                count: group.length,
                ids: group.map((c) => String(c?.id || ''))
            });
        }
    }
    return {
        ok: violations.length === 0,
        destination: destinationLabel,
        violations
    };
}
