/**
 * Balanced discovery-shelf distribution — pure, Node-safe.
 *
 * Empty non-Trending shelves stay empty when global inventory exists.
 * Trending remains the broad fallback / discovery shelf.
 * Soft placement across unrelated shelves is avoided in this phase.
 */

import { DISCOVERY_SHELVES, normalizeDiscoveryShelf } from './contentClassifier.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {Record<string, unknown>} card
 * @returns {number}
 */
export function scoreShelfCandidate(card) {
    const confidence = Number(card.categoryConfidence) || 0;
    const playableBonus = card.playable ? 0.35 : 0;
    const poster = text(card.posterUrl || card.thumbnailUrl);
    const richBonus = poster ? 0.15 : 0;
    const titleBonus = text(card.title || card.name) ? 0.1 : 0;
    const descBonus = text(card.description) ? 0.05 : 0;
    let recency = 0;
    const created = Date.parse(String(card.created_at || card.createdAt || card.updated_at || ''));
    if (Number.isFinite(created)) {
        const ageDays = (Date.now() - created) / (86400000);
        recency = Math.max(0, 0.2 - Math.min(ageDays, 60) / 300);
    }
    const ranking = Number(card.ranking) || 0;
    const recommendation = Number(card.recommendationScore) || 0;
    return (
        confidence * 1.2 +
        playableBonus +
        richBonus +
        titleBonus +
        descBonus +
        recency +
        Math.min(0.25, ranking / 100) +
        Math.min(0.25, recommendation)
    );
}

/**
 * @returns {Record<string, Array<Record<string, unknown>>>}
 */
export function emptyShelfBuckets() {
    /** @type {Record<string, Array<Record<string, unknown>>>} */
    const out = {};
    for (const shelf of DISCOVERY_SHELVES) out[shelf] = [];
    return out;
}

/**
 * Distribute projected cards into FEED_SHELVES buckets.
 *
 * @param {Array<Record<string, unknown>>} cards
 * @param {{
 *   shelves?: string[];
 *   maxPerShelf?: number;
 *   allowSoftFallback?: boolean;
 * }} [options]
 * @returns {{
 *   shelves: Record<string, Array<Record<string, unknown>>>;
 *   globalRealCount: number;
 *   omittedEmptyShelves: string[];
 * }}
 */
export function distributeToShelves(cards, options = {}) {
    const shelves = options.shelves || [...DISCOVERY_SHELVES];
    const maxPerShelf = options.maxPerShelf ?? 48;
    const allowSoftFallback = options.allowSoftFallback === true;

    const buckets = emptyShelfBuckets();
    for (const s of shelves) {
        if (!buckets[s]) buckets[s] = [];
    }

    const list = (Array.isArray(cards) ? cards : []).filter(
        (c) => c && typeof c === 'object' && !c.isPlaceholder
    );
    const globalRealCount = list.length;

    /** @type {Array<{ card: Record<string, unknown>; score: number; primary: string }>} */
    const ranked = list
        .map((card) => {
            const primary = normalizeDiscoveryShelf(
                text(card.category) || text(/** @type {string[]} */ (card.categories)?.[0]) || 'Trending'
            );
            return { card, score: scoreShelfCandidate(card), primary };
        })
        .sort((a, b) => b.score - a.score);

    /** Prefer strong classifications into their primary shelf; Trending also collects overflow. */
    for (const row of ranked) {
        const { card, primary, score } = row;
        const target = shelves.includes(primary) ? primary : 'Trending';
        const copy = {
            ...card,
            category: target,
            _distributionScore: score,
            _distributionFallback: false
        };

        if (target !== 'Trending') {
            if (buckets[target].length < maxPerShelf) {
                buckets[target].push(copy);
            }
            // Also surface on Trending as discovery (same identity, not a second merge identity).
            if (buckets.Trending.length < maxPerShelf) {
                const trendingCopy = {
                    ...copy,
                    category: 'Trending',
                    _onTrendingAsDiscovery: true
                };
                // Avoid exact duplicate object id already placed if primary was Trending — here primary isn't.
                const already = buckets.Trending.some(
                    (c) => text(c.id) && text(c.id) === text(copy.id)
                );
                if (!already) buckets.Trending.push(trendingCopy);
            }
        } else if (buckets.Trending.length < maxPerShelf) {
            buckets.Trending.push(copy);
        }
    }

    // Soft fallback intentionally off by default — do not invent Romance/etc from unrelated inventory.
    if (allowSoftFallback && globalRealCount > 0) {
        for (const shelf of shelves) {
            if (shelf === 'Trending') continue;
            if (buckets[shelf].length > 0) continue;
            const donor = buckets.Trending.find(
                (c) => !c._distributionFallback && text(c.classificationSource) === 'fallback'
            );
            if (donor) {
                buckets[shelf].push({
                    ...donor,
                    category: shelf,
                    _distributionFallback: true
                });
            }
        }
    }

    /** @type {string[]} */
    const omittedEmptyShelves = [];
    for (const shelf of shelves) {
        if (shelf === 'Trending') continue;
        if (globalRealCount > 0 && buckets[shelf].length === 0) {
            omittedEmptyShelves.push(shelf);
        }
    }

    return { shelves: buckets, globalRealCount, omittedEmptyShelves };
}
