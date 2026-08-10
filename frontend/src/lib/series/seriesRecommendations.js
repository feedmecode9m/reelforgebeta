/**
 * Simple non-AI recommendations from published seriesIdentity + viewer history.
 */

import { get } from 'svelte/store';
import { seriesCatalog } from './seriesStore.js';
import { episodeIsViewerDiscoverable } from './publishingLifecycle.js';
import { loadWatchProgressMap } from './seriesWatchProgress.js';

/**
 * @typedef {{
 *   seriesId: string;
 *   title: string;
 *   poster?: string;
 *   reason: string;
 * }} SeriesRecommendation
 */

/**
 * @param {{
 *   seedSeriesLabel?: string;
 *   seedSeriesId?: string;
 *   watchedReelIds?: string[];
 *   limit?: number;
 * }} [options]
 * @returns {SeriesRecommendation[]}
 */
export function recommendSeries(options = {}) {
    const limit = Math.max(1, Math.min(12, Number(options.limit) || 6));
    const seedLabel = String(options.seedSeriesLabel || '').trim().toLowerCase();
    const seedId = String(options.seedSeriesId || '').trim();
    const catalog = get(seriesCatalog) || [];
    const progress = loadWatchProgressMap();
    const watchedReels = new Set(
        (Array.isArray(options.watchedReelIds) ? options.watchedReelIds : []).map((id) =>
            String(id || '').trim()
        ).filter(Boolean)
    );

    /** @type {SeriesRecommendation[]} */
    const out = [];
    for (const series of catalog) {
        if (!series?.id || series.id === seedId) continue;
        const publishedEps = (series.seasons || [])
            .flatMap((s) => s.episodes || [])
            .filter((ep) => episodeIsViewerDiscoverable(ep));
        if (!publishedEps.length) continue;

        const tags = (series.tags || []).map((t) => String(t).toLowerCase());
        const title = String(series.title || '').toLowerCase();
        let score = 0;
        let reason = 'Published series';

        if (seedLabel && (title.includes(seedLabel) || tags.some((t) => t.includes(seedLabel)))) {
            score += 50;
            reason = `Because you watched ${options.seedSeriesLabel || seedLabel}`;
        }

        // Prefer series the viewer has partial progress on (similar watch overlap)
        for (const ep of publishedEps) {
            const rid = String(ep.reelId || ep.mediaAssetId || '').trim();
            if (rid && (watchedReels.has(rid) || Number(progress[rid]) > 0)) {
                score += 20;
                reason = 'Continue exploring similar releases';
                break;
            }
        }

        // Shared tag affinity with seed series
        if (seedId) {
            const seed = catalog.find((s) => s.id === seedId);
            const seedTags = new Set((seed?.tags || []).map((t) => String(t).toLowerCase()));
            const overlap = tags.filter((t) => seedTags.has(t)).length;
            if (overlap) {
                score += overlap * 10;
                if (!reason.startsWith('Because')) reason = 'Similar tags';
            }
        }

        if (score <= 0) {
            score = 1; // cold start published catalog
            reason = 'Recommended for you';
        }

        out.push({
            seriesId: series.id,
            title: series.title || series.id,
            poster: series.poster || '',
            reason,
            /** @type {any} */ _score: score
        });
    }

    return out
        .sort((a, b) => (/** @type {any} */ (b)._score || 0) - (/** @type {any} */ (a)._score || 0))
        .slice(0, limit)
        .map(({ seriesId, title, poster, reason }) => ({ seriesId, title, poster, reason }));
}
