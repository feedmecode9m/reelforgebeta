/**
 * Creator/catalog Series Poster Card catalog — one card per canonical Series row.
 *
 * Unlike buildViewerSeriesBrowseCatalog, this includes zero-episode shells.
 * Production browse remains gated by buildViewerProductionProjection.
 */
import { publicSeriesPath } from './publicSeriesHydration.js';
import { episodeIsViewerDiscoverable } from './publishingLifecycle.js';
import { buildViewerProductionProjection } from './viewerProductionProjection.js';
import { stripDemoSeriesFromCatalog } from './seriesCatalogTruth.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {import('./seriesTypes.js').Series | null | undefined} series
 */
function countAllEpisodes(series) {
    return (series?.seasons || []).flatMap((season) =>
        Array.isArray(season?.episodes) ? season.episodes : []
    ).length;
}

/**
 * @param {import('./seriesTypes.js').Series | null | undefined} series
 */
function countDiscoverableEpisodes(series) {
    return (series?.seasons || [])
        .flatMap((season) => (Array.isArray(season?.episodes) ? season.episodes : []))
        .filter((episode) => episodeIsViewerDiscoverable(episode)).length;
}

/**
 * @param {import('./seriesTypes.js').Series | null | undefined} series
 */
function resolvePrimarySeasonNumber(series) {
    const seasons = Array.isArray(series?.seasons) ? series.seasons : [];
    if (!seasons.length) return 1;
    const sorted = [...seasons].sort(
        (a, b) => Number(a?.seasonNumber) - Number(b?.seasonNumber)
    );
    const sn = Number(sorted[0]?.seasonNumber);
    return Number.isFinite(sn) && sn >= 1 ? sn : 1;
}

/**
 * @param {import('./seriesTypes.js').Series[]} catalog
 * @param {{
 *   readyVaultAssets?: Record<string, unknown>[];
 *   reelMetadataMap?: Record<string, import('./seriesMetadataStorage.js').ReelSeriesMetadata>;
 *   placeholder?: string;
 * }} [options]
 */
export function buildCreatorSeriesPosterCatalog(catalog, options = {}) {
    const list = stripDemoSeriesFromCatalog(Array.isArray(catalog) ? catalog : []);
    /** @type {Array<{
     *   seriesId: string;
     *   title: string;
     *   path: string;
     *   posterSrc: string;
     *   seasonCount: number;
     *   primarySeasonNumber: number;
     *   episodeCount: number;
     *   discoverableEpisodeCount: number;
     *   developmentState: 'in-development' | 'production';
     *   productionEligible: boolean;
     * }>} */
    const items = [];

    for (const series of list) {
        const seriesId = text(series?.id);
        if (!seriesId) continue;

        const episodeCount = countAllEpisodes(series);
        const discoverableEpisodeCount = countDiscoverableEpisodes(series);
        const seasonCount = Math.max(1, (series.seasons || []).length);
        const primarySeasonNumber = resolvePrimarySeasonNumber(series);
        const projection = buildViewerProductionProjection(series, options);
        const productionEligible = projection != null;

        items.push({
            seriesId,
            title: text(series.title) || seriesId,
            path: publicSeriesPath(series) || '',
            posterSrc: text(projection?.posterSrc || series.poster || ''),
            seasonCount,
            primarySeasonNumber,
            episodeCount,
            discoverableEpisodeCount,
            developmentState: productionEligible ? 'production' : 'in-development',
            productionEligible
        });
    }

    return items.sort((a, b) => a.title.localeCompare(b.title));
}
