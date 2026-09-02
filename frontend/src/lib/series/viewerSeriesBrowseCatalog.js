import { episodeIsPubliclyPlayable } from './seriesTypes.js';
import { episodeIsViewerDiscoverable } from './publishingLifecycle.js';
import { resolveSeriesPosterSrc } from './seriesCatalogTruth.js';
import { publicSeriesPath } from './publicSeriesHydration.js';
import { resolveEpisodeMedia } from './episodeVaultBindingResolver.js';

/**
 * @param {unknown} value
 * @returns {number}
 */
function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {import('./seriesTypes.js').Series | null | undefined} series
 * @returns {import('./seriesTypes.js').Episode[]}
 */
function collectViewerEpisodes(series) {
    if (!series || !Array.isArray(series.seasons)) return [];
    return series.seasons
        .flatMap((season) => (Array.isArray(season?.episodes) ? season.episodes : []))
        .filter((episode) => episodeIsViewerDiscoverable(episode));
}

/**
 * @param {import('./seriesTypes.js').Series} series
 * @param {import('./seriesTypes.js').Episode[]} episodes
 * @param {Record<string, unknown>[]} readyVaultAssets
 * @param {string} placeholder
 * @returns {string}
 */
function resolveProductionPoster(series, episodes, readyVaultAssets, placeholder) {
    const episodeThumbnails = episodes.map((episode) => {
        const resolved = resolveEpisodeMedia({
            episode,
            readyVaultAssets
        });
        return text(
            resolved?.thumbnail ||
                episode?.thumbnailUrl ||
                episode?.poster ||
                resolved?.mediaUrl ||
                ''
        );
    });
    return text(
        resolveSeriesPosterSrc({
            seriesPoster: series.poster,
            episodeThumbnails,
            placeholder
        })
    );
}

/**
 * @param {import('./seriesTypes.js').Series[]} catalog
 * @param {{
 *   readyVaultAssets?: Record<string, unknown>[];
 *   placeholder?: string;
 *   sectionLimit?: number;
 * }} [options]
 */
export function buildViewerSeriesBrowseCatalog(catalog, options = {}) {
    const list = Array.isArray(catalog) ? catalog : [];
    const readyVaultAssets = Array.isArray(options.readyVaultAssets) ? options.readyVaultAssets : [];
    const placeholder = text(options.placeholder);
    const sectionLimit = Math.max(1, toNumber(options.sectionLimit) || 12);

    /** @type {Map<string, {
     *   seriesId: string;
     *   title: string;
     *   path: string;
     *   posterSrc: string;
     *   seasonCount: number;
     *   episodeCount: number;
     *   playableCount: number;
     *   latestTimestamp: number;
     * }>}
     */
    const bySeriesId = new Map();

    for (const series of list) {
        const seriesId = text(series?.id);
        if (!seriesId || bySeriesId.has(seriesId)) continue;

        const episodes = collectViewerEpisodes(series);
        if (episodes.length === 0) continue;

        const playableCount = episodes.filter((episode) => episodeIsPubliclyPlayable(episode)).length;
        const latestTimestamp = episodes.reduce((max, episode) => {
            const publishedAt = Date.parse(text(episode?.publishedAt || episode?.releaseDate || ''));
            return Number.isFinite(publishedAt) ? Math.max(max, publishedAt) : max;
        }, 0);
        const path = publicSeriesPath(series) || '';
        if (!path) continue;

        const seasonCount = (series.seasons || []).filter(
            (season) =>
                Array.isArray(season?.episodes) &&
                season.episodes.some((episode) => episodeIsViewerDiscoverable(episode))
        ).length;
        bySeriesId.set(seriesId, {
            seriesId,
            title: text(series.title) || seriesId,
            path,
            posterSrc: resolveProductionPoster(series, episodes, readyVaultAssets, placeholder),
            seasonCount: Math.max(1, seasonCount || (series.seasons || []).length || 1),
            episodeCount: episodes.length,
            playableCount,
            latestTimestamp
        });
    }

    const all = [...bySeriesId.values()];
    const newestCandidates = [...all]
        .sort((a, b) => {
            if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
            if (b.episodeCount !== a.episodeCount) return b.episodeCount - a.episodeCount;
            return a.title.localeCompare(b.title);
        });
    const trendingCandidates = [...all]
        .sort((a, b) => {
            if (b.playableCount !== a.playableCount) return b.playableCount - a.playableCount;
            if (b.episodeCount !== a.episodeCount) return b.episodeCount - a.episodeCount;
            if (b.latestTimestamp !== a.latestTimestamp) return b.latestTimestamp - a.latestTimestamp;
            return a.title.localeCompare(b.title);
        });

    const used = new Set();
    /** @param {Array<{seriesId:string}>} source @param {number} limit */
    const takeUnique = (source, limit) => {
        /** @type {Array<any>} */
        const out = [];
        for (const item of source) {
            if (out.length >= limit) break;
            if (!item?.seriesId || used.has(item.seriesId)) continue;
            used.add(item.seriesId);
            out.push(item);
        }
        return out;
    };
    const originalCandidates = [...all].sort((a, b) => a.title.localeCompare(b.title));
    /** @type {ReturnType<typeof takeUnique>} */
    let original = [];
    /** @type {ReturnType<typeof takeUnique>} */
    let trending = [];
    /** @type {ReturnType<typeof takeUnique>} */
    let newest = [];

    if (all.length <= sectionLimit) {
        original = originalCandidates;
    } else {
        const originalLimit = Math.min(sectionLimit, Math.ceil(all.length * 0.5));
        original = takeUnique(originalCandidates, originalLimit);
        trending = takeUnique(trendingCandidates, sectionLimit);
        newest = takeUnique(newestCandidates, sectionLimit);
    }

    return {
        all,
        sections: {
            original,
            trending,
            newest
        }
    };
}
