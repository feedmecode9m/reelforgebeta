/**
 * Live hero “truth”: viewer copy and studio metadata stay aligned with the
 * active Vault Hero background (edited MP4 / thumbnail title), not stock demo text.
 */

import {
    buildHeroAssetRegistry,
    isVideoHeroAssetType,
    normalizeHeroAssetRecord,
    resolveHeroAssetById
} from './heroAssetBridge.js';
import {
    analyzeHeroTitle,
    buildHeroManagerPatchFromTitleIntel,
    isUnsafeHeroFilenameTitle,
    resolveCanonicalHeroTitle,
    UNTITLED_CREATOR_EXPERIENCE
} from './heroTitleIntelligence.js';
import { isLegacyHeroDemoCopy } from './heroCtaIntent.js';

/** @type {ReadonlyArray<string>} */
export const STOCK_HERO_TITLES = [
    'Black Warrior: Land, Legacy & Liberation',
    'Featured Story',
    'Featured on ReelForge',
    'Story Title',
    'ReelForge',
    UNTITLED_CREATOR_EXPERIENCE
];

/** @type {ReadonlyArray<string>} */
export const STOCK_HERO_SUBTITLES = [
    'A cinematic spotlight on generational Black land ownership.',
    'A cinematic spotlight on generational Black land stewardship.',
    'A cinematic spotlight from ReelForge.',
    'A cinematic spotlight from your latest hero upload.',
    'Discover the featured story.',
    'Story-first subtitle',
    'Story subtitle appears here.'
];

/** @type {ReadonlyArray<string>} */
export const STOCK_HERO_DESCRIPTIONS = [
    'Discover the families preserving generations of Black land ownership in Alabama.',
    'Editorial content now reflects the newly accepted hero asset.',
    'Describe the story viewers should feel.',
    'Story description appears here.'
];

/**
 * @param {string} value
 * @param {ReadonlyArray<string>} stock
 */
function matchesStockList(value, stock) {
    const norm = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    if (!norm) return false;
    return stock.some((item) => item.trim().toLowerCase() === norm);
}

/**
 * True when title looks like an auto-catalog dump rather than a deliberate edit.
 * @param {string} value
 */
export function isGenericCatalogHeroTitle(value) {
    const text = String(value || '').trim();
    if (!text) return false;
    return (
        /^personal content\s*\d+/i.test(text) ||
        /\s[-–—]\s*(trending|featured|spotlight|most watched)\s*$/i.test(text) ||
        /^untitled(\s+video|\s+reel)?$/i.test(text)
    );
}

/**
 * @param {string} value
 * @param {'title' | 'subtitle' | 'description' | 'any'} [kind]
 */
export function isStockHeroViewerCopy(value, kind = 'any') {
    const text = String(value || '').trim();
    if (!text) return false;
    if (isUnsafeHeroFilenameTitle(text)) return true;
    if (isLegacyHeroDemoCopy(text)) return true;
    if (kind === 'title' || kind === 'any') {
        if (matchesStockList(text, STOCK_HERO_TITLES)) return true;
        if (kind === 'title' && isGenericCatalogHeroTitle(text)) return true;
    }
    if (kind === 'subtitle' || kind === 'any') {
        if (matchesStockList(text, STOCK_HERO_SUBTITLES)) return true;
    }
    if (kind === 'description' || kind === 'any') {
        if (matchesStockList(text, STOCK_HERO_DESCRIPTIONS)) return true;
        if (/black land ownership in alabama/i.test(text)) return true;
    }
    return false;
}

/**
 * Prefer a real vault title over stock / empty / filenames.
 * @param {string} preferred
 * @param {string} assetTitle
 * @param {string} [softFallback]
 */
export function resolveTruthLabel(preferred, assetTitle, softFallback = '') {
    return resolveCanonicalHeroTitle({
        editedTitle: preferred,
        assetTitle,
        nlpTitle: softFallback,
        persistentTitle: preferred
    });
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 * @param {Record<string, unknown>[] | null} [vaultItems]
 */
export function resolveHeroAssetTruth(assetOrId, vaultItems = null) {
    if (assetOrId && typeof assetOrId === 'object') {
        const normalized =
            assetOrId.assetId && assetOrId.mediaUrl
                ? assetOrId
                : normalizeHeroAssetRecord(/** @type {Record<string, unknown>} */ (assetOrId), {
                      storageSource: 'truth'
                  });
        if (!normalized) return null;
        const safeTitle = resolveCanonicalHeroTitle({
            assetTitle: normalized.title,
            fileName: assetOrId.fileName || assetOrId.file_name
        });
        return {
            assetId: String(normalized.assetId || '').trim(),
            title: safeTitle,
            mediaUrl: String(normalized.mediaUrl || '').trim(),
            thumbnailUrl: String(normalized.thumbnailUrl || '').trim(),
            assetType: String(normalized.assetType || '').trim(),
            isVideo: isVideoHeroAssetType(normalized.assetType),
            mimeType: String(normalized.mimeType || '')
        };
    }
    const id = String(assetOrId || '').trim();
    if (!id) return null;
    const items = Array.isArray(vaultItems) ? vaultItems : [];
    const resolved = resolveHeroAssetById(id, items) ||
        (items.length === 0
            ? null
            : buildHeroAssetRegistry(items).find((row) => row.assetId === id));
    if (!resolved) return null;
    return resolveHeroAssetTruth(resolved, items);
}

/**
 * Build manager config patch so landscape / studio match the background file + NLP story.
 * @param {HeroTruth | null} truth
 * @param {Partial<{ heroTitle?: string; heroSubtitle?: string; heroDescription?: string; heroLabel?: string; heroCopySourceAssetId?: string; force?: boolean; _previousAssetTitle?: string }>} current
 */
export function buildViewerCopyPatchFromTruth(truth, current = {}) {
    if (!truth?.assetId || !truth.title) return {};
    const intelBundle = buildHeroManagerPatchFromTitleIntel(truth.assetId, truth.title, {
        isVideo: truth.isVideo,
        force: Boolean(current.force),
        previous: {
            heroTitle: current.heroTitle,
            heroSubtitle: current.heroSubtitle,
            heroDescription: current.heroDescription
        }
    });

    // Still honor previous-title matching for sourced re-bind.
    const prevTitle = String(current.heroTitle || '').trim();
    const sourcedHere =
        String(current.heroCopySourceAssetId || '').trim() === truth.assetId ||
        prevTitle === String(current._previousAssetTitle || '').trim();
    if (
        !current.force &&
        !sourcedHere &&
        prevTitle &&
        !isStockHeroViewerCopy(prevTitle, 'title') &&
        !isUnsafeHeroFilenameTitle(prevTitle)
    ) {
        // Preserve intentional custom headline if user overrode intelligence.
        const { heroTitle: _drop, ...rest } = intelBundle.patch;
        return rest;
    }

    return intelBundle.patch;
}

/**
 * Seed Content Intelligence models from hero background truth (non-destructive fill).
 * @param {{
 *   series?: Record<string, unknown>;
 *   episode?: Record<string, unknown>;
 *   discovery?: Record<string, unknown>;
 *   rights?: Record<string, unknown>;
 * }} models
 * @param {HeroTruth | null} truth
 * @param {{ heroTitle?: string; heroSubtitle?: string; heroDescription?: string; force?: boolean }} [viewer]
 */
export function seedContentIntelligenceFromHeroTruth(models, truth, viewer = {}) {
    if (!truth?.assetId) {
        return {
            series: models.series || {},
            episode: models.episode || {},
            discovery: models.discovery || {},
            rights: models.rights || {}
        };
    }

    const force = viewer.force === true;
    const intelligence =
        viewer.intelligence ||
        analyzeHeroTitle(viewer.heroTitle || truth.title, { isVideo: truth.isVideo });
    const title = intelligence.normalizedTitle;
    // Presentation description: creator/approved only — not raw NLP dump.
    const approvedDesc =
        viewer.contentIdentity?.accepted?.suggestedDescription?.value ||
        viewer.contentIdentity?.accepted?.heroDescription?.value ||
        (viewer.heroDescription && !isStockHeroViewerCopy(viewer.heroDescription, 'description')
            ? String(viewer.heroDescription).trim()
            : '');
    const safeDescription = approvedDesc || '';
    // Discovery side-channel may still use NLP proposals (tags ≠ identity).
    const proposalKeywords = intelligence.storyKeywords || [];
    const proposalTags = intelligence.discoveryTags || [];


    const series = { ...(models.series || {}) };
    const episode = { ...(models.episode || {}) };
    const discovery = {
        mood: Array.isArray(models.discovery?.mood) ? [...models.discovery.mood] : [],
        topics: Array.isArray(models.discovery?.topics) ? [...models.discovery.topics] : [],
        audienceInterests: Array.isArray(models.discovery?.audienceInterests)
            ? [...models.discovery.audienceInterests]
            : [],
        searchKeywords: Array.isArray(models.discovery?.searchKeywords)
            ? [...models.discovery.searchKeywords]
            : [],
        sponsorshipCategories: Array.isArray(models.discovery?.sponsorshipCategories)
            ? [...models.discovery.sponsorshipCategories]
            : [],
        collectionCategories: Array.isArray(models.discovery?.collectionCategories)
            ? [...models.discovery.collectionCategories]
            : []
    };
    const rights = { ...(models.rights || {}) };

    const fill = (obj, key, value) => {
        const next = String(value || '').trim();
        if (!next) return;
        const cur = String(obj[key] || '').trim();
        if (force || !cur || isStockHeroViewerCopy(cur, 'any') || isUnsafeHeroFilenameTitle(cur)) {
            obj[key] = next;
        }
    };

    fill(series, 'seriesTitle', title);
    if (safeDescription) fill(series, 'seriesDescription', safeDescription);
    // Genre stays creator-owned — NLP category is discovery/interpretation only.
    if (truth.mediaUrl && (force || !String(series.seriesTrailer || '').trim())) {
        if (truth.isVideo) series.seriesTrailer = truth.mediaUrl;
    }
    if (truth.thumbnailUrl && (force || !String(series.seriesCoverImage || '').trim())) {
        series.seriesCoverImage = truth.thumbnailUrl || truth.mediaUrl;
    }
    const tagSeed = [
        ...(Array.isArray(series.tags) ? series.tags : []),
        ...proposalTags,
        'hero-background'
    ];
    if (!Array.isArray(series.tags) || series.tags.length === 0 || force) {
        series.tags = Array.from(new Set(tagSeed.map((t) => String(t).trim()).filter(Boolean)));
    }

    fill(episode, 'episodeTitle', title);
    if (safeDescription) fill(episode, 'episodeDescription', safeDescription);
    if (intelligence.location) fill(episode, 'location', intelligence.location);
    if (!Array.isArray(episode.keywords) || episode.keywords.length === 0 || force) {
        episode.keywords = Array.from(
            new Set([
                ...(Array.isArray(episode.keywords) ? episode.keywords : []),
                ...proposalKeywords,
                'hero',
                'vault'
            ])
        );
    }

    const pushUnique = (list, value) => {
        const v = String(value || '').trim();
        if (!v) return list;
        if (list.some((item) => String(item).toLowerCase() === v.toLowerCase())) return list;
        return [...list, v];
    };
    discovery.searchKeywords = pushUnique(discovery.searchKeywords, title);
    for (const tag of intelligence.discoveryTags) {
        discovery.topics = pushUnique(discovery.topics, tag);
    }
    discovery.mood = pushUnique(discovery.mood, intelligence.mood);
    discovery.audienceInterests = pushUnique(discovery.audienceInterests, intelligence.audienceSignal);
    discovery.collectionCategories = pushUnique(discovery.collectionCategories, 'Hero Background');
    // NLP shelf classification → discovery only (never series.genre truth).
    if (intelligence.category) {
        discovery.collectionCategories = pushUnique(
            discovery.collectionCategories,
            String(intelligence.category)
        );
        discovery.topics = pushUnique(discovery.topics, String(intelligence.category));
    }

    if (force || !String(rights.copyrightOwner || '').trim()) {
        rights.copyrightOwner = rights.copyrightOwner || 'Studio vault owner';
    }
    if (force || !String(rights.licensingStatus || '').trim()) {
        rights.licensingStatus = rights.licensingStatus || 'internal_vault';
    }

    return {
        series,
        episode,
        discovery,
        rights,
        heroAssetId: truth.assetId,
        heroTitle: title,
        intelligence
    };
}

/**
 * @typedef {{
 *   assetId: string;
 *   title: string;
 *   mediaUrl: string;
 *   thumbnailUrl: string;
 *   assetType: string;
 *   isVideo: boolean;
 *   mimeType: string;
 * }} HeroTruth
 */
