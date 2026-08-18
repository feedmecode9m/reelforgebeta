/**
 * Viewer-safe vault card metadata projection (pure mapper — not a store).
 *
 * Authority:
 *   title       → reel_titles_persistent + resolveLinkedAssetDisplayTitle
 *   description → creator-authored fields only (never NLP/Suggested/Trending)
 *   artwork     → real enrichment / thumbnail / image URL only
 *
 * Blank fields stay blank. No second title/description storage key.
 *
 * Node-safe: avoid modules that import Vite/browser config (validators run in Node).
 */

import { getStoredReelSeriesMetadata } from '../series/seriesMetadataStorage.js';
import {
    isUnsafeHeroFilenameTitle,
    lookupPersistentHeroTitle,
    resolveLinkedAssetDisplayTitle,
    UNTITLED_CREATOR_EXPERIENCE,
    REEL_TITLES_PERSISTENT_KEY
} from '../hero/heroTitleIntelligence.js';
import { lookupPersistentTitleEntry } from './persistentTitleMap.js';

/**
 * @typedef {Object} VaultCardProjection
 * @property {string} assetId
 * @property {'video' | 'image'} kind
 * @property {string} title
 * @property {string} description
 * @property {string} posterUrl
 * @property {string} mediaUrl
 * @property {string} seriesLine
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Stock / demo hero body copy (mirrors heroViewerTruth — no heavy imports).
 * @param {string} value
 */
function isStockDescription(value) {
    const raw = text(value).toLowerCase();
    if (!raw) return false;
    if (raw.includes('black land ownership in alabama')) return true;
    if (raw.includes('describe the story viewers should feel')) return true;
    if (raw.includes('story description appears here')) return true;
    if (raw.includes('editorial content now reflects')) return true;
    return false;
}

/**
 * Marketing / NLP / placeholder text that must never appear as creator description.
 * @param {string} value
 */
export function isManufacturedViewerDescription(value) {
    const raw = text(value);
    if (!raw) return false;
    if (/^suggested\s*:/i.test(raw)) return true;
    if (/^trending\b/i.test(raw)) return true;
    if (/trending local experience/i.test(raw)) return true;
    if (/captured from the creator vault/i.test(raw)) return true;
    if (/feature(d)? still from the creator vault/i.test(raw)) return true;
    if (/discover a .+ travel moment/i.test(raw)) return true;
    if (/explore a live city experience/i.test(raw)) return true;
    if (/grounded documentary spotlight/i.test(raw)) return true;
    if (isStockDescription(raw)) return true;
    return false;
}

/**
 * Titles invented for empty space — never use on viewer cards.
 * @param {string} value
 */
export function isManufacturedViewerTitle(value) {
    const raw = text(value);
    if (!raw) return false;
    if (raw === UNTITLED_CREATOR_EXPERIENCE) return true;
    if (/^untitled(\s+video|\s+reel|\s+item)?$/i.test(raw)) return true;
    if (/^personal content(\s+\d+)?(\s*[-–—].*)?$/i.test(raw)) return true;
    if (/^coming soon$/i.test(raw)) return true;
    if (/^episode\s+\d+$/i.test(raw)) return true;
    if (/^suggested\s*:/i.test(raw)) return true;
    if (/^copy\s+[0-9a-f]{8}/i.test(raw)) return true;
    if (isUnsafeHeroFilenameTitle(raw)) return true;
    return false;
}

/**
 * Lightweight vault/feed lookup (avoids config-coupled modules).
 * @param {string} reelId
 * @returns {Record<string, unknown> | null}
 */
function loadReelObjectLite(reelId) {
    const id = text(reelId);
    if (!id || typeof localStorage === 'undefined') return null;
    /** @param {unknown} entry */
    const matches = (entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const e = /** @type {Record<string, unknown>} */ (entry);
        return text(e.id) === id || text(e.reelId) === id || text(e.assetId) === id;
    };
    try {
        const vault = JSON.parse(localStorage.getItem('personal_video_vault') || '[]');
        if (Array.isArray(vault)) {
            const hit = vault.find(matches);
            if (hit) return /** @type {Record<string, unknown>} */ (hit);
        }
    } catch {
        /* ignore */
    }
    try {
        const feed = JSON.parse(localStorage.getItem('reelforge_feed') || '{}');
        if (feed && typeof feed === 'object' && !Array.isArray(feed)) {
            for (const shelf of Object.values(feed)) {
                if (!Array.isArray(shelf)) continue;
                const hit = shelf.find(matches);
                if (hit) return /** @type {Record<string, unknown>} */ (hit);
            }
        }
    } catch {
        /* ignore */
    }
    return null;
}

/**
 * Same fields as readVaultEpisodeEnrichment without its vault inference import chain.
 * @param {Record<string, unknown> | null | undefined} asset
 */
function readEnrichmentLite(asset) {
    if (!asset || typeof asset !== 'object') {
        return { title: '', description: '', artworkUrl: '' };
    }
    const nested =
        asset.episodeEnrichment && typeof asset.episodeEnrichment === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.episodeEnrichment)
            : null;
    return {
        title: text(nested?.title || asset.enrichmentTitle || asset.episodePresentationTitle || ''),
        description: text(
            nested?.description || asset.enrichmentDescription || asset.episodeDescription || ''
        ),
        artworkUrl: text(
            nested?.artworkUrl ||
                nested?.artwork ||
                nested?.posterUrl ||
                asset.enrichmentArtworkUrl ||
                asset.episodeArtworkUrl ||
                ''
        )
    };
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @returns {'video' | 'image'}
 */
function resolveKind(reel) {
    const type = text(reel?.type || reel?.mediaType || reel?.assetType).toLowerCase();
    if (type.includes('image') || type === 'img' || type === 'thumb' || type === 'thumbnail') {
        return 'image';
    }
    const url = text(reel?.url || reel?.mediaUrl || reel?.video_url || reel?.src);
    if (/\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url)) return 'image';
    return 'video';
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 */
function safeAssetTitleCandidate(reel) {
    if (!reel || typeof reel !== 'object') return '';
    const candidates = [reel.title, reel.name, reel.displayTitle];
    for (const c of candidates) {
        const t = text(c);
        if (!t || isManufacturedViewerTitle(t) || isUnsafeHeroFilenameTitle(t)) continue;
        return t;
    }
    return '';
}

/**
 * @param {{
 *   reel?: Record<string, unknown> | null;
 *   enrichment?: { description?: string };
 *   seriesMeta?: { description?: string } | null;
 *   isActiveHero?: boolean;
 *   heroDescription?: string;
 * }} opts
 */
function resolveCreatorDescription(opts) {
    const enrichDesc = text(opts.enrichment?.description);
    if (enrichDesc && !isManufacturedViewerDescription(enrichDesc)) return enrichDesc;

    const reelDesc = text(opts.reel?.description);
    if (reelDesc && !isManufacturedViewerDescription(reelDesc)) return reelDesc;

    const seriesDesc = text(opts.seriesMeta?.description);
    if (seriesDesc && !isManufacturedViewerDescription(seriesDesc)) return seriesDesc;

    if (opts.isActiveHero) {
        const heroDesc = text(opts.heroDescription);
        if (heroDesc && !isManufacturedViewerDescription(heroDesc) && !isStockDescription(heroDesc)) {
            return heroDesc;
        }
    }
    return '';
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {{ artworkUrl?: string }} enrichment
 */
function resolvePosterUrl(reel, enrichment) {
    const enrichArt = text(enrichment?.artworkUrl);
    if (enrichArt) return enrichArt;

    const thumb = text(
        reel?.thumbnailUrl ||
            reel?.thumbnail_url ||
            reel?.posterUrl ||
            reel?.poster_url ||
            reel?.poster
    );
    if (thumb) return thumb;

    if (resolveKind(reel) === 'image') {
        const img = text(reel?.url || reel?.mediaUrl || reel?.src);
        if (img) return img;
    }
    return '';
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 */
function resolveMediaUrl(reel) {
    return text(
        reel?.url ||
            reel?.mediaUrl ||
            reel?.video_url ||
            reel?.videoUrl ||
            reel?.src ||
            reel?.playbackUrl ||
            ''
    );
}

/**
 * @param {{
 *   seriesLabel?: string;
 *   seasonNumber?: number | null;
 *   episodeNumber?: number | null;
 *   seriesMeta?: { seriesName?: string; seasonNumber?: number; episodeNumber?: number } | null;
 * }} opts
 */
function resolveSeriesLine(opts) {
    const seriesLabel = text(opts.seriesLabel || opts.seriesMeta?.seriesName);
    const seasonNumber =
        opts.seasonNumber != null && Number.isFinite(Number(opts.seasonNumber))
            ? Number(opts.seasonNumber)
            : opts.seriesMeta?.seasonNumber != null &&
                Number.isFinite(Number(opts.seriesMeta.seasonNumber))
              ? Number(opts.seriesMeta.seasonNumber)
              : null;
    const episodeNumber =
        opts.episodeNumber != null && Number.isFinite(Number(opts.episodeNumber))
            ? Number(opts.episodeNumber)
            : opts.seriesMeta?.episodeNumber != null &&
                Number.isFinite(Number(opts.seriesMeta.episodeNumber))
              ? Number(opts.seriesMeta.episodeNumber)
              : null;

    if (!seriesLabel && seasonNumber == null && episodeNumber == null) return '';

    /** @type {string[]} */
    const parts = [];
    if (seasonNumber != null && episodeNumber != null) {
        parts.push(`S${seasonNumber} · E${episodeNumber}`);
    } else if (seasonNumber != null) {
        parts.push(`S${seasonNumber}`);
    } else if (episodeNumber != null) {
        parts.push(`E${episodeNumber}`);
    }
    if (seriesLabel) parts.push(seriesLabel);
    return parts.join(' · ');
}

/**
 * Viewer-facing card projection for a vault/reel asset.
 *
 * @param {string} assetId
 * @param {{
 *   reel?: Record<string, unknown> | null;
 *   persistentTitle?: string;
 *   episodeTitle?: string;
 *   seriesLabel?: string;
 *   seasonNumber?: number | null;
 *   episodeNumber?: number | null;
 *   isActiveHero?: boolean;
 *   heroDescription?: string;
 *   heroAssetId?: string;
 *   titlesStorageKey?: string;
 *   seriesMeta?: Record<string, unknown> | null;
 *   enrichment?: { title?: string; description?: string; artworkUrl?: string };
 * }} [sources]
 * @returns {VaultCardProjection}
 */
export function resolveVaultCardProjection(assetId, sources = {}) {
    const id = text(assetId);
    const storageKey = sources.titlesStorageKey || REEL_TITLES_PERSISTENT_KEY;

    /** @type {Record<string, unknown> | null} */
    let reel =
        sources.reel && typeof sources.reel === 'object'
            ? /** @type {Record<string, unknown>} */ (sources.reel)
            : null;
    if (!reel && id) {
        try {
            reel = loadReelObjectLite(id);
        } catch {
            reel = null;
        }
    }

    const enrichment = sources.enrichment || readEnrichmentLite(reel);

    let seriesMeta =
        sources.seriesMeta && typeof sources.seriesMeta === 'object'
            ? sources.seriesMeta
            : null;
    if (!seriesMeta && id) {
        try {
            seriesMeta = getStoredReelSeriesMetadata(id) || null;
        } catch {
            seriesMeta = null;
        }
    }

    const persistentTitle =
        sources.persistentTitle !== undefined
            ? text(sources.persistentTitle)
            : (() => {
                  if (typeof localStorage === 'undefined') {
                      return id ? lookupPersistentHeroTitle(id, storageKey) : '';
                  }
                  try {
                      const map = JSON.parse(localStorage.getItem(storageKey) || '{}');
                      const saved = lookupPersistentTitleEntry(map, reel || { id });
                      const fromAlias = text(saved?.title || saved?.title_original);
                      if (fromAlias) return fromAlias;
                  } catch {
                      /* fall through */
                  }
                  return id ? lookupPersistentHeroTitle(id, storageKey) : '';
              })();

    const linkedEpisodeTitle = text(sources.episodeTitle || seriesMeta?.episodeTitle || '');
    const assetTitle =
        safeAssetTitleCandidate(reel) ||
        (text(enrichment?.title) && !isManufacturedViewerTitle(text(enrichment.title))
            ? text(enrichment.title)
            : '');

    let title = '';
    if (id || persistentTitle || linkedEpisodeTitle || assetTitle) {
        const resolved = resolveLinkedAssetDisplayTitle(id, {
            persistentTitle,
            episodeTitle: linkedEpisodeTitle || undefined,
            assetTitle: assetTitle || undefined,
            titlesStorageKey: storageKey
        });
        title = text(resolved);
        if (isManufacturedViewerTitle(title) || isUnsafeHeroFilenameTitle(title)) {
            title = '';
        }
    }

    const heroAssetId = text(sources.heroAssetId);
    const isActiveHero =
        sources.isActiveHero === true ||
        (Boolean(id) && Boolean(heroAssetId) && id === heroAssetId);

    const description = resolveCreatorDescription({
        reel,
        enrichment,
        seriesMeta: seriesMeta ? { description: text(seriesMeta.description) } : null,
        isActiveHero,
        heroDescription: sources.heroDescription
    });

    const hasSeriesBinding =
        Boolean(text(sources.seriesLabel)) ||
        Boolean(text(seriesMeta?.seriesName)) ||
        Boolean(text(seriesMeta?.episodeId)) ||
        sources.seasonNumber != null ||
        sources.episodeNumber != null ||
        (seriesMeta &&
            (seriesMeta.seasonNumber != null || seriesMeta.episodeNumber != null));

    const seriesLine = hasSeriesBinding
        ? resolveSeriesLine({
              seriesLabel: sources.seriesLabel,
              seasonNumber: sources.seasonNumber,
              episodeNumber: sources.episodeNumber,
              seriesMeta: seriesMeta
                  ? {
                        seriesName: text(seriesMeta.seriesName),
                        seasonNumber:
                            seriesMeta.seasonNumber != null
                                ? Number(seriesMeta.seasonNumber)
                                : undefined,
                        episodeNumber:
                            seriesMeta.episodeNumber != null
                                ? Number(seriesMeta.episodeNumber)
                                : undefined
                    }
                  : null
          })
        : '';

    return {
        assetId: id,
        kind: resolveKind(reel),
        title,
        description,
        posterUrl: resolvePosterUrl(reel, enrichment),
        mediaUrl: resolveMediaUrl(reel),
        seriesLine
    };
}

export default resolveVaultCardProjection;
