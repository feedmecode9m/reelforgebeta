/**
 * Canonical Viewer Production Projection
 *
 * Boundary between Smart Production Studio truth and public viewer surfaces.
 * Editorial metadata is authoritative; NLP is enrichment-only; diagnostics and
 * runtime state never become viewer copy.
 *
 * @see ../architecture/creatorTruthLayers.js
 * @see ./seriesCatalogTruth.js
 * @see ../viewer/viewerIntelligencePresentation.js
 */

import { episodeIsPubliclyPlayable } from './seriesTypes.js';
import { episodeIsViewerDiscoverable } from './publishingLifecycle.js';
import {
    creatorFacingDescription,
    creatorFacingGenre,
    resolveEditorialProsePrecedence,
    isInternalCatalogTag,
    isTestFixtureDescription,
    isTestFixtureGenre
} from './seriesCatalogTruth.js';
import { resolvePublicGenreDisplay } from '../architecture/intelligenceProvenance.js';
import { buildViewerIntelligencePresentation } from '../viewer/viewerIntelligencePresentation.js';
import { publicSeriesPath } from './publicSeriesHydration.js';
import { resolveViewerEpisodePosterUrl } from './viewerEpisodePoster.js';
import { resolveMediaUrl } from '../api/reelContract.js';

/** @typedef {import('./seriesTypes.js').Series} Series */
/** @typedef {import('./seriesTypes.js').Episode} Episode */
/** @typedef {import('./seriesMetadataStorage.js').ReelSeriesMetadata} ReelSeriesMetadata */
/** @typedef {import('../viewer/viewerIntelligencePresentation.js').ViewerIntelligencePresentation} ViewerIntelligencePresentation */

/**
 * @typedef {Object} ViewerProductionEnrichment
 * @property {string[]} themes Approved NLP-derived themes (never pipeline diagnostics)
 * @property {string[]} keywords Viewer-safe discovery keywords
 * @property {string[]} intelligenceLines Presentation-safe intelligence copy
 * @property {boolean} showIntelligence
 */

/**
 * @typedef {Object} ViewerProductionProjection
 * @property {string} seriesId
 * @property {string} title Editorial production title
 * @property {string} description Creator/studio synopsis
 * @property {string} genre Official genre when creator-assigned
 * @property {string} posterSrc
 * @property {string} path Public series path
 * @property {number} seasonCount
 * @property {number} episodeCount
 * @property {number} playableCount Internal runtime count — not viewer storytelling
 * @property {ViewerProductionEnrichment} viewerEnrichment
 * @property {ViewerIntelligencePresentation} presentation Partitioned creator vs intelligence display
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {Series | null | undefined} series
 * @returns {Episode[]}
 */
function collectViewerEpisodes(series) {
    if (!series || !Array.isArray(series.seasons)) return [];
    return series.seasons
        .flatMap((season) => (Array.isArray(season?.episodes) ? season.episodes : []))
        .filter((episode) => episodeIsViewerDiscoverable(episode));
}

/**
 * @param {Series} series
 * @param {Record<string, ReelSeriesMetadata>} reelMetadataMap
 * @returns {ReelSeriesMetadata[]}
 */
function collectBoundReelMetadata(series, reelMetadataMap) {
    const map = reelMetadataMap && typeof reelMetadataMap === 'object' ? reelMetadataMap : {};
    /** @type {ReelSeriesMetadata[]} */
    const out = [];
    const seen = new Set();
    for (const episode of collectViewerEpisodes(series)) {
        const reelId = text(episode?.reelId || episode?.mediaAssetId || episode?.heroVaultAssetId);
        if (!reelId || seen.has(reelId)) continue;
        const meta = map[reelId];
        if (meta) {
            seen.add(reelId);
            out.push(meta);
        }
    }
    return out;
}

/**
 * @param {Series} series
 * @param {Record<string, ReelSeriesMetadata>} reelMetadataMap
 */
function resolveProjectionDescription(series, reelMetadataMap) {
    const catalogDesc = creatorFacingDescription(series?.description);
    if (catalogDesc) return catalogDesc;

    /** @type {string} */
    let bestReelDesc = '';
    for (const episode of collectViewerEpisodes(series)) {
        const reelId = text(episode?.reelId);
        const meta = reelId ? reelMetadataMap?.[reelId] : null;
        const merged = resolveEditorialProsePrecedence(
            episode?.description,
            meta?.description
        );
        const facing = creatorFacingDescription(merged);
        if (facing.length > bestReelDesc.length) bestReelDesc = facing;
    }
    return bestReelDesc;
}

/**
 * @param {Series} series
 * @param {Record<string, ReelSeriesMetadata>} reelMetadataMap
 */
function resolveProjectionGenre(series, reelMetadataMap) {
    const seriesGenre = creatorFacingGenre(series?.genre);
    if (seriesGenre) {
        const resolved = resolvePublicGenreDisplay(seriesGenre, 'creator');
        if (resolved.official) return resolved.display;
    }
    for (const episode of collectViewerEpisodes(series)) {
        const epGenre = creatorFacingGenre(episode?.genre);
        if (epGenre) {
            const resolved = resolvePublicGenreDisplay(epGenre, 'creator');
            if (resolved.official) return resolved.display;
        }
    }
    for (const meta of collectBoundReelMetadata(series, reelMetadataMap)) {
        const metaGenre = creatorFacingGenre(meta?.genre);
        if (metaGenre) {
            const resolved = resolvePublicGenreDisplay(metaGenre, 'creator');
            if (resolved.official) return resolved.display;
        }
    }
    return '';
}

/**
 * @param {unknown} theme
 */
function isViewerSafeTheme(theme) {
    const t = text(theme);
    if (!t) return false;
    if (isInternalCatalogTag(t)) return false;
    if (isTestFixtureDescription(t)) return false;
    if (isTestFixtureGenre(t)) return false;
    if (/^themes detected:/i.test(t)) return false;
    if (/^this story highlights validation/i.test(t)) return false;
    return true;
}

/**
 * Strip title-echo and other non-substantive NLP scaffolding from viewer intelligence.
 *
 * @param {string[]} lines
 * @param {string} title
 */
export function filterPresentationSafeIntelligenceLines(lines, title) {
    const normalizedTitle = text(title);
    const titleEchoPattern = normalizedTitle
        ? new RegExp(`^Exploring\\s+${normalizedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')
        : null;

    return (Array.isArray(lines) ? lines : [])
        .map((line) => text(line))
        .filter(Boolean)
        .filter((line) => {
            if (/themes detected:\s*validation\b/i.test(line)) return false;
            if (titleEchoPattern?.test(line)) return false;
            if (/^this story highlights validation\b/i.test(line)) return false;
            return true;
        });
}

/**
 * Approved NLP enrichment from Studio reel metadata — never raw catalog tags.
 *
 * @param {Series} series
 * @param {Record<string, ReelSeriesMetadata>} reelMetadataMap
 * @param {string} officialGenre
 */
function collectApprovedNlpEnrichment(series, reelMetadataMap, officialGenre) {
    /** @type {string[]} */
    const themes = [];
    /** @type {string[]} */
    const keywords = [];
    /** @type {string[]} */
    const rawExplanations = [];

    for (const meta of collectBoundReelMetadata(series, reelMetadataMap)) {
        const suggested = text(meta?.suggestedGenre);
        if (suggested && suggested.toLowerCase() !== officialGenre.toLowerCase() && isViewerSafeTheme(suggested)) {
            themes.push(suggested);
        }
        const explanation = text(meta?.intelligenceExplanation);
        if (explanation && !isTestFixtureDescription(explanation)) {
            rawExplanations.push(explanation);
        }
        for (const tag of meta?.tags || []) {
            const label = text(tag);
            if (label && isViewerSafeTheme(label)) keywords.push(label);
        }
    }

    for (const tag of series?.tags || []) {
        const label = text(tag);
        if (label && isViewerSafeTheme(label)) keywords.push(label);
    }

    const unique = (items) =>
        [...new Set(items.map((item) => text(item)).filter(Boolean))];

    return {
        themes: unique(themes),
        keywords: unique(keywords),
        rawExplanation: rawExplanations[0] || ''
    };
}

/**
 * @param {Series} series
 * @param {Episode[]} episodes
 * @param {Record<string, unknown>[]} readyVaultAssets
 * @param {string} placeholder
 */
function resolveProjectionPoster(series, episodes, readyVaultAssets, placeholder) {
    const seriesPoster = text(series.poster);
    if (seriesPoster) {
        return text(
            resolveMediaUrl(seriesPoster, 'thumbnail', 'viewerProductionProjection') || seriesPoster
        );
    }

    /** @type {Episode[]} */
    const withEditorial = [];
    /** @type {Episode[]} */
    const withoutEditorial = [];
    for (const episode of episodes) {
        const editorial = text(episode?.thumbnailUrl || episode?.poster || '');
        if (editorial) withEditorial.push(episode);
        else withoutEditorial.push(episode);
    }

    for (const episode of [...withEditorial, ...withoutEditorial]) {
        const poster = resolveViewerEpisodePosterUrl({ episode, readyVaultAssets });
        if (poster) return poster;
    }

    return text(placeholder);
}

/**
 * Build the canonical viewer-safe production projection for a catalog series.
 *
 * @param {Series | null | undefined} series
 * @param {{
 *   reelMetadataMap?: Record<string, ReelSeriesMetadata>;
 *   readyVaultAssets?: Record<string, unknown>[];
 *   placeholder?: string;
 * }} [options]
 * @returns {ViewerProductionProjection | null}
 */
export function buildViewerProductionProjection(series, options = {}) {
    if (!series || !text(series?.id)) return null;

    const reelMetadataMap =
        options.reelMetadataMap && typeof options.reelMetadataMap === 'object'
            ? options.reelMetadataMap
            : {};
    const readyVaultAssets = Array.isArray(options.readyVaultAssets) ? options.readyVaultAssets : [];
    const placeholder = text(options.placeholder);
    const episodes = collectViewerEpisodes(series);
    if (episodes.length === 0) return null;

    const path = publicSeriesPath(series) || '';
    if (!path) return null;

    const seasonCount = (series.seasons || []).filter(
        (season) =>
            Array.isArray(season?.episodes) &&
            season.episodes.some((episode) => episodeIsViewerDiscoverable(episode))
    ).length;
    const playableCount = episodes.filter((episode) => episodeIsPubliclyPlayable(episode)).length;
    const title = text(series.title) || text(series.id);
    const description = resolveProjectionDescription(series, reelMetadataMap);
    const genre = resolveProjectionGenre(series, reelMetadataMap);
    const posterSrc = resolveProjectionPoster(series, episodes, readyVaultAssets, placeholder);
    const nlp = collectApprovedNlpEnrichment(series, reelMetadataMap, genre);

    const presentation = buildViewerIntelligencePresentation({
        title,
        description,
        genre,
        themes: nlp.themes,
        intelligenceExplanation: nlp.rawExplanation,
        discoveryKeywords: nlp.keywords
    });

    /** @type {ViewerProductionEnrichment} */
    const intelligenceLines = filterPresentationSafeIntelligenceLines(
        presentation.display.intelligenceLines,
        title
    );
    const viewerEnrichment = {
        themes: nlp.themes,
        keywords: nlp.keywords,
        intelligenceLines,
        showIntelligence: intelligenceLines.length > 0
    };

    return {
        seriesId: text(series.id),
        title,
        description,
        genre,
        posterSrc,
        path,
        seasonCount: Math.max(1, seasonCount || (series.seasons || []).length || 1),
        episodeCount: episodes.length,
        playableCount,
        viewerEnrichment,
        presentation: {
            ...presentation,
            display: {
                ...presentation.display,
                officialDescription: description,
                primaryTitle: title,
                officialGenre: genre,
                showIntelligence: viewerEnrichment.showIntelligence,
                intelligenceLines: viewerEnrichment.intelligenceLines
            }
        }
    };
}

/**
 * @param {Series[]} catalog
 * @param {{
 *   reelMetadataMap?: Record<string, ReelSeriesMetadata>;
 *   readyVaultAssets?: Record<string, unknown>[];
 *   placeholder?: string;
 * }} [options]
 * @returns {Map<string, ViewerProductionProjection>}
 */
export function buildViewerProductionProjectionMap(catalog, options = {}) {
    /** @type {Map<string, ViewerProductionProjection>} */
    const out = new Map();
    for (const series of Array.isArray(catalog) ? catalog : []) {
        const projection = buildViewerProductionProjection(series, options);
        if (projection?.seriesId) out.set(projection.seriesId, projection);
    }
    return out;
}
