/**
 * Shared content identity resolver — single read model for Hero, Vault, and Theater.
 * Creator-owned fields always win; AI/NLP is enrichment only.
 */

import { getStoredReelSeriesMetadata } from '../series/seriesMetadataStorage.js';
import { resolvePresentationTitle, resolveDiscoverySignals } from '../intelligence/contentIdentityGuard.js';

export const HERO_MANAGER_STORAGE_KEY = 'reelforge_hero_manager_config';
export const REEL_TITLES_PERSISTENT_KEY = 'reel_titles_persistent';

/**
 * @typedef {Object} ResolvedContentIdentity
 * @property {string} reelId
 * @property {string} title
 * @property {string} episodeTitle
 * @property {string} seriesName
 * @property {number | null} seasonNumber
 * @property {number | null} episodeNumber
 * @property {string} description
 * @property {string[]} tags
 * @property {string[]} keywords
 * @property {string} source - creator | episode | reel | mixed | unknown
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function asStringList(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.map((v) => text(v)).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .split(/[,|]/)
            .map((v) => v.trim())
            .filter(Boolean);
    }
    return [];
}

/**
 * @param {string} key
 * @param {unknown} fallback
 */
function readLocalJson(key, fallback = null) {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

/**
 * @param {string} reelId
 * @returns {Record<string, unknown> | null}
 */
export function loadHeroManagerConfigForReel(reelId) {
    const id = text(reelId);
    const config = readLocalJson(HERO_MANAGER_STORAGE_KEY, null);
    if (!config || typeof config !== 'object') return null;
    const heroAssetId = text(config.heroAssetId);
    if (id && heroAssetId && heroAssetId !== id) {
        // Still return config when mismatched — caller may pass overrides for that reel.
        // Identity title for a non-active asset comes from other stores.
        return /** @type {Record<string, unknown>} */ (config);
    }
    return /** @type {Record<string, unknown>} */ (config);
}

/**
 * @param {string} reelId
 */
function loadPersistentTitle(reelId) {
    const map = readLocalJson(REEL_TITLES_PERSISTENT_KEY, {});
    if (!map || typeof map !== 'object') return '';
    const row = map[reelId];
    if (typeof row === 'string') return text(row);
    if (row && typeof row === 'object') return text(row.title || row.value);
    return '';
}

/**
 * Look up reel row from vault / feed localStorage.
 * @param {string} reelId
 * @returns {Record<string, unknown> | null}
 */
export function loadReelObject(reelId) {
    const id = text(reelId);
    if (!id || typeof window === 'undefined') return null;

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
        if (Array.isArray(feed)) {
            const hit = feed.find(matches);
            if (hit) return /** @type {Record<string, unknown>} */ (hit);
        } else if (feed && typeof feed === 'object') {
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
 * Extract creator-facing title from governed contentIdentity graph.
 * @param {Record<string, unknown> | null | undefined} identity
 * @param {string} [fallback]
 */
function creatorTitleFromIdentity(identity, fallback = '') {
    const fromGuard = resolvePresentationTitle(identity, '');
    if (fromGuard) return fromGuard;
    return text(fallback);
}

/**
 * @param {Record<string, unknown> | null | undefined} identity
 * @returns {{ tags: string[]; keywords: string[] }}
 */
function tagsFromIdentity(identity) {
    const signals = resolveDiscoverySignals(identity);
    const keywords = [
        ...asStringList(signals.storyKeywords),
        ...asStringList(signals.discoveryTags),
        text(signals.category),
        text(signals.mood),
        text(signals.location)
    ].filter(Boolean);
    const tags = [...new Set(keywords.map((k) => k.toLowerCase()))];
    return { tags, keywords: [...new Set(keywords)] };
}

/**
 * Canonical content identity for a reel / hero asset.
 *
 * Priority:
 *   creator source > existing reel metadata > approved metadata > AI proposals (keywords only)
 *
 * @param {string} reelId
 * @param {{
 *   heroConfig?: Record<string, unknown> | null;
 *   reel?: Record<string, unknown> | null;
 *   contentIdentity?: Record<string, unknown> | null;
 * }} [options]
 * @returns {ResolvedContentIdentity}
 */
export function resolveContentIdentity(reelId, options = {}) {
    const id = text(reelId);
    const heroConfig =
        options.heroConfig ||
        (id ? loadHeroManagerConfigForReel(id) : null) ||
        readLocalJson(HERO_MANAGER_STORAGE_KEY, null);
    const heroIsActive =
        id &&
        heroConfig &&
        text(/** @type {Record<string, unknown>} */ (heroConfig).heroAssetId) === id;

    const contentIdentity =
        options.contentIdentity ||
        (heroIsActive
            ? /** @type {Record<string, unknown>} */ (heroConfig)?.contentIdentity
            : null) ||
        null;

    const seriesMeta = id ? getStoredReelSeriesMetadata(id) : null;
    const reel = options.reel || (id ? loadReelObject(id) : null);
    const persistentTitle = id ? loadPersistentTitle(id) : '';

    const creatorTitle = creatorTitleFromIdentity(
        contentIdentity,
        heroIsActive
            ? text(/** @type {Record<string, unknown>} */ (heroConfig)?.heroTitle) ||
                  text(/** @type {Record<string, unknown>} */ (heroConfig)?.heroAssetTitle)
            : ''
    );

    const story =
        heroIsActive && heroConfig
            ? /** @type {Record<string, unknown>} */ (
                  /** @type {Record<string, unknown>} */ (heroConfig).heroStoryContext || {}
              )
            : {};

    const intelligence =
        heroIsActive && heroConfig
            ? /** @type {Record<string, unknown>} */ (
                  /** @type {Record<string, unknown>} */ (heroConfig).heroTitleIntelligence || {}
              )
            : {};

    const identityTags = tagsFromIdentity(contentIdentity);
    const intelKeywords = asStringList(intelligence.storyKeywords || intelligence.keywords);
    const aiOnlyKeywords = asStringList(intelligence.discoveryTags);

    /**
     * Master Edit durable authority: reel_titles_persistent outranks sticky
     * contentIdentity / package episode snapshots for the same reel id.
     * Creator truth remains preferred when no persistent Master Edit exists.
     */
    const title =
        persistentTitle ||
        creatorTitle ||
        text(seriesMeta?.episodeTitle) ||
        text(reel?.title) ||
        text(reel?.name) ||
        '';

    const episodeTitle =
        persistentTitle ||
        creatorTitle ||
        text(seriesMeta?.episodeTitle) ||
        text(reel?.episodeTitle) ||
        title;

    const description =
        text(/** @type {Record<string, unknown>} */ (heroConfig)?.heroDescription) ||
        text(story.description) ||
        text(seriesMeta?.description) ||
        text(reel?.description) ||
        '';

    const tags = [
        ...new Set([
            ...asStringList(seriesMeta?.tags),
            ...identityTags.tags,
            ...asStringList(reel?.tags),
            ...intelKeywords.map((k) => k.toLowerCase())
        ])
    ];

    // AI proposals contribute keywords only — never creator title/description above.
    const keywords = [
        ...new Set([...identityTags.keywords, ...intelKeywords, ...aiOnlyKeywords, ...tags])
    ];

    const seriesName =
        text(seriesMeta?.seriesName) ||
        text(reel?.seriesName) ||
        text(reel?.series_title) ||
        '';

    const seasonNumber =
        seriesMeta?.seasonNumber != null
            ? Number(seriesMeta.seasonNumber)
            : reel?.seasonNumber != null
              ? Number(reel.seasonNumber)
              : null;

    const episodeNumber =
        seriesMeta?.episodeNumber != null
            ? Number(seriesMeta.episodeNumber)
            : reel?.episodeNumber != null
              ? Number(reel.episodeNumber)
              : null;

    let source = 'unknown';
    if (creatorTitle || (heroIsActive && text(/** @type {Record<string, unknown>} */ (heroConfig)?.heroTitle))) {
        source = 'creator';
    } else if (seriesMeta?.episodeTitle) {
        source = 'episode';
    } else if (text(reel?.title) || text(reel?.name)) {
        source = 'reel';
    } else if (persistentTitle) {
        source = 'creator';
    }

    return {
        reelId: id,
        title,
        episodeTitle,
        seriesName,
        seasonNumber: Number.isFinite(seasonNumber) ? /** @type {number} */ (seasonNumber) : null,
        episodeNumber: Number.isFinite(episodeNumber) ? /** @type {number} */ (episodeNumber) : null,
        description,
        tags,
        keywords,
        source
    };
}

/**
 * Overlay resolved creator identity onto a seriesContext shape (Theater menus).
 * Never invents series / seasons; only rewrites display fields.
 *
 * @param {{
 *   series: { id?: string; title: string; genre?: string; description?: string };
 *   season: { seasonNumber: number };
 *   episode: {
 *     episodeId: string;
 *     episodeNumber: number;
 *     title: string;
 *     runtime?: number;
 *     genre?: string;
 *     description?: string;
 *     status?: string;
 *     reelId?: string | null;
 *     tags?: string[];
 *   };
 * } | null | undefined} seriesContext
 * @param {ResolvedContentIdentity | null | undefined} identity
 */
export function applyContentIdentityToSeriesContext(seriesContext, identity) {
    if (!seriesContext) return seriesContext || null;
    if (!identity) return seriesContext;

    const episodeTitle = text(identity.episodeTitle || identity.title);
    const seriesName = text(identity.seriesName);

    return {
        ...seriesContext,
        series: {
            ...seriesContext.series,
            title: seriesName || seriesContext.series.title,
            description: text(identity.description) || seriesContext.series.description
        },
        season: {
            ...seriesContext.season,
            seasonNumber:
                identity.seasonNumber != null
                    ? identity.seasonNumber
                    : seriesContext.season.seasonNumber
        },
        episode: {
            ...seriesContext.episode,
            title: episodeTitle || seriesContext.episode.title,
            description: text(identity.description) || seriesContext.episode.description,
            episodeNumber:
                identity.episodeNumber != null
                    ? identity.episodeNumber
                    : seriesContext.episode.episodeNumber,
            tags: identity.tags?.length ? identity.tags : seriesContext.episode.tags,
            reelId: identity.reelId || seriesContext.episode.reelId
        }
    };
}
