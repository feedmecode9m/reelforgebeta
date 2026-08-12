/**
 * Session-stable shelf rotation — pure, Node-safe.
 * Does not reshuffle every render; order is deterministic for a given seed.
 */

/**
 * @param {string} input
 * @returns {number}
 */
export function hashString(input) {
    let h = 2166136261;
    const s = String(input || '');
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/**
 * @param {string | number | null | undefined} sessionSeed
 * @returns {string}
 */
export function resolveRotationSeed(sessionSeed) {
    if (sessionSeed != null && String(sessionSeed).trim()) {
        return String(sessionSeed).trim();
    }
    // Day bucket — stable across reloads within the same UTC day.
    return new Date().toISOString().slice(0, 10);
}

/**
 * @param {string} seed
 * @param {string} shelf
 * @param {string} cardId
 * @returns {number}
 */
export function rotationRank(seed, shelf, cardId) {
    return hashString(`${seed}|${shelf}|${cardId}`);
}

/**
 * Rotate/rank cards within each shelf. Playable items sort ahead within the rotated order.
 * Limits adjacent-rail repetition via a seen-set (demote already-seen ids on later shelves).
 *
 * @param {Record<string, Array<Record<string, unknown>>>} shelfMap
 * @param {{
 *   sessionSeed?: string | number | null;
 *   shelfOrder?: string[];
 *   limitRepetition?: boolean;
 * }} [options]
 * @returns {Record<string, Array<Record<string, unknown>>>}
 */
export function applyShelfRotation(shelfMap, options = {}) {
    const seed = resolveRotationSeed(options.sessionSeed);
    const shelfOrder = options.shelfOrder || Object.keys(shelfMap || {});
    const limitRepetition = options.limitRepetition !== false;
    /** @type {Set<string>} */
    const seenAcross = new Set();

    /** @type {Record<string, Array<Record<string, unknown>>>} */
    const out = {};

    for (const shelf of shelfOrder) {
        const items = Array.isArray(shelfMap?.[shelf]) ? [...shelfMap[shelf]] : [];
        const decorated = items.map((card, index) => {
            const id = String(card?.id || card?._catalogTempKey || `idx-${index}`);
            const rank = rotationRank(seed, shelf, id);
            const playableBoost = card?.playable ? 1e12 : 0;
            const repetitionPenalty =
                limitRepetition && seenAcross.has(id) && shelf !== 'Trending' ? 1e11 : 0;
            return {
                card,
                id,
                sortKey: playableBoost + rank - repetitionPenalty
            };
        });

        decorated.sort((a, b) => {
            if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
            return a.id.localeCompare(b.id);
        });

        out[shelf] = decorated.map((row) => {
            if (limitRepetition && row.id) seenAcross.add(row.id);
            return {
                ...row.card,
                _rotationSeed: seed,
                _rotationRank: row.sortKey
            };
        });
    }

    // Preserve any shelves not listed in shelfOrder.
    for (const key of Object.keys(shelfMap || {})) {
        if (!out[key]) out[key] = [...(shelfMap[key] || [])];
    }

    return out;
}
