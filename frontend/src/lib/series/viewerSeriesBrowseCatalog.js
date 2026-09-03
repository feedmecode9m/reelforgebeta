import { episodeIsViewerDiscoverable } from './publishingLifecycle.js';
import { VIC_G_SERIES_ID } from './vicGSeriesPackage.js';
import { buildViewerProductionProjection } from './viewerProductionProjection.js';

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
 * Prefer multi-episode / creator-backed series as the Browse representative when
 * the same reelId appears on a vault-inferred singleton production.
 *
 * @param {import('./seriesTypes.js').Series | null | undefined} series
 * @param {import('./seriesTypes.js').Episode[]} episodes
 */
function scoreBrowseCanonicalSeries(series, episodes) {
    const seriesId = text(series?.id);
    const tags = Array.isArray(series?.tags) ? series.tags.map(String) : [];
    let score = episodes.length * 10;
    if (seriesId === VIC_G_SERIES_ID) score += 1000;
    if (tags.includes('creator-package')) score += 500;
    if (tags.includes('creator-confirmed')) score += 200;
    if (/^series-\d{2}-/.test(seriesId) && episodes.length <= 1) score -= 50;
    if (tags.includes('vault-inferred') && episodes.length <= 1) score -= 20;
    return score;
}

/**
 * @param {import('./seriesTypes.js').Series[]} catalog
 * @returns {Map<string, string>} reelId → canonical browse seriesId
 */
function buildReelCanonicalBrowseOwnerMap(catalog) {
    /** @type {Map<string, { seriesId: string; score: number }>} */
    const reelOwners = new Map();
    for (const series of catalog) {
        const seriesId = text(series?.id);
        if (!seriesId) continue;
        const episodes = collectViewerEpisodes(series);
        if (episodes.length === 0) continue;
        const score = scoreBrowseCanonicalSeries(series, episodes);
        for (const episode of episodes) {
            const reelId = text(episode?.reelId || episode?.mediaAssetId || episode?.heroVaultAssetId);
            if (!reelId) continue;
            const prev = reelOwners.get(reelId);
            if (!prev || score > prev.score) {
                reelOwners.set(reelId, { seriesId, score });
            }
        }
    }
    return new Map([...reelOwners.entries()].map(([reelId, row]) => [reelId, row.seriesId]));
}

/**
 * Collapse vault-inferred singleton productions whose media already belongs to a
 * canonical multi-episode series (e.g. Vic G). Presentation-only — no catalog mutation.
 *
 * @param {Array<{
 *   seriesId: string;
 *   title: string;
 *   path: string;
 *   posterSrc: string;
 *   seasonCount: number;
 *   episodeCount: number;
 *   playableCount: number;
 *   latestTimestamp: number;
 *   relatedMaterialCount?: number;
 *   stackLayers?: number;
 * }>} items
 * @param {import('./seriesTypes.js').Series[]} catalog
 * @param {Map<string, string>} reelOwnerMap
 */
function collapseRelatedBrowseProductions(items, catalog, reelOwnerMap) {
    /** @type {Map<string, Set<string>>} */
    const collapsedInto = new Map();
    const seriesById = new Map(catalog.map((series) => [text(series?.id), series]).filter(([id]) => id));

    for (const item of items) {
        const series = seriesById.get(item.seriesId);
        if (!series) continue;
        const episodes = collectViewerEpisodes(series);
        const reelIds = episodes
            .map((episode) => text(episode?.reelId || episode?.mediaAssetId || episode?.heroVaultAssetId))
            .filter(Boolean);
        if (reelIds.length === 0) continue;

        const owners = new Set(reelIds.map((reelId) => reelOwnerMap.get(reelId)).filter(Boolean));
        if (owners.size !== 1) continue;

        const owner = [...owners][0];
        if (owner === item.seriesId) continue;

        if (!collapsedInto.has(owner)) collapsedInto.set(owner, new Set());
        collapsedInto.get(owner).add(item.seriesId);
    }

    const satelliteIds = new Set();
    for (const satellites of collapsedInto.values()) {
        for (const id of satellites) satelliteIds.add(id);
    }

    return items
        .filter((item) => !satelliteIds.has(item.seriesId))
        .map((item) => {
            const satellites = collapsedInto.get(item.seriesId);
            if (!satellites || satellites.size === 0) return item;
            const relatedMaterialCount = satellites.size;
            return {
                ...item,
                relatedMaterialCount,
                stackLayers: Math.min(2, relatedMaterialCount)
            };
        });
}

/**
 * @param {import('./seriesTypes.js').Series[]} catalog
 * @param {{
 *   readyVaultAssets?: Record<string, unknown>[];
 *   reelMetadataMap?: Record<string, import('./seriesMetadataStorage.js').ReelSeriesMetadata>;
 *   placeholder?: string;
 *   sectionLimit?: number;
 * }} [options]
 */
export function buildViewerSeriesBrowseCatalog(catalog, options = {}) {
    const list = Array.isArray(catalog) ? catalog : [];
    const readyVaultAssets = Array.isArray(options.readyVaultAssets) ? options.readyVaultAssets : [];
    const reelMetadataMap =
        options.reelMetadataMap && typeof options.reelMetadataMap === 'object'
            ? options.reelMetadataMap
            : {};
    const placeholder = text(options.placeholder);
    const sectionLimit = Math.max(1, toNumber(options.sectionLimit) || 12);

    /** @type {Map<string, ReturnType<typeof buildViewerProductionProjection> & { latestTimestamp: number }>} */
    const bySeriesId = new Map();

    for (const series of list) {
        const seriesId = text(series?.id);
        if (!seriesId || bySeriesId.has(seriesId)) continue;

        const episodes = collectViewerEpisodes(series);
        if (episodes.length === 0) continue;

        const projection = buildViewerProductionProjection(series, {
            reelMetadataMap,
            readyVaultAssets,
            placeholder
        });
        if (!projection) continue;

        const latestTimestamp = episodes.reduce((max, episode) => {
            const publishedAt = Date.parse(text(episode?.publishedAt || episode?.releaseDate || ''));
            return Number.isFinite(publishedAt) ? Math.max(max, publishedAt) : max;
        }, 0);
        bySeriesId.set(seriesId, {
            ...projection,
            latestTimestamp
        });
    }

    const reelOwnerMap = buildReelCanonicalBrowseOwnerMap(list);
    const all = collapseRelatedBrowseProductions([...bySeriesId.values()], list, reelOwnerMap);
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
