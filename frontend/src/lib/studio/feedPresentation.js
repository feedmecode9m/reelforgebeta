/**
 * Studio presentation helpers — read-side only; never mutates feed persistence.
 */

/**
 * Feed shelves may list the same canonical reel.id in multiple categories.
 * @param {Record<string, unknown>[]} reels
 * @returns {Record<string, unknown>[]}
 */
export function dedupeFeedReelsById(reels) {
    const seen = new Set();
    const out = [];
    for (const row of reels || []) {
        const id = String(row?.id || '').trim();
        if (!id || row.isPlaceholder || seen.has(id)) continue;
        seen.add(id);
        out.push(row);
    }
    return out;
}
