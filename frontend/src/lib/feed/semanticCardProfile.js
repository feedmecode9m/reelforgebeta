/**
 * Semantic Card Profile — presentation derivation from existing ReelForge data.
 *
 * Separates shelf category from semantic identity (themes / contentType).
 * Does NOT invent titles, descriptions, or categories.
 * Does NOT persist — in-memory / derived only.
 */

import {
    classifyContentSemantic,
    normalizeClassificationMetadata,
    resolveClassificationTitle
} from './contentClassifier.js';
import { defaultTitleNlpProvider } from './titleNlpProvider.js';
import {
    gatherEditorialClassificationContext,
    deriveClassificationState,
    formatSuggestionConfidence,
    canPersistCategoryForAsset
} from './categorySuggestionReview.js';
import { hydrateCatalogItemWithCreatorMetadata } from './creatorCatalogMetadata.js';
import { extractSemanticThemes } from './semanticThemeSignals.js';
import { getExactMediaIdentity } from './identityBackedEditorialReview.js';

/**
 * Lightweight media-kind checks — avoid reelContract/config so profile
 * derivation stays Node-testable without Vite SSR.
 * @param {Record<string, unknown> | null | undefined} reel
 */
function isVideoAsset(reel) {
    if (!reel) return false;
    const url = String(reel.url || reel.video_url || '').trim();
    if (url.includes('/videos/') || /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(url)) {
        return true;
    }
    const type = String(reel.type || reel.mediaType || reel.media_type || '').toLowerCase();
    return type === 'video' || type.startsWith('video/');
}

/**
 * @param {Record<string, unknown> | null | undefined} reel
 */
function isImageAsset(reel) {
    if (!reel || isVideoAsset(reel)) return false;
    const type = String(reel.type || reel.mediaType || reel.media_type || '').toLowerCase();
    return type === 'image' || type === 'thumbnail' || Boolean(reel.url);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {Record<string, unknown>} asset
 * @returns {{ durationSec: number | null; aspectRatio: string; resolution: string; width: number | null; height: number | null }}
 */
export function deriveMediaPresentationFields(asset = {}) {
    const durationSec =
        numOrNull(asset.duration) ||
        numOrNull(asset.durationSec) ||
        numOrNull(asset.duration_seconds) ||
        null;
    const width = numOrNull(asset.width) || numOrNull(asset.videoWidth) || null;
    const height = numOrNull(asset.height) || numOrNull(asset.videoHeight) || null;
    let aspectRatio = text(asset.aspectRatio || asset.aspect_ratio);
    if (!aspectRatio && width && height) {
        const r = width / height;
        if (Math.abs(r - 16 / 9) < 0.08) aspectRatio = '16:9';
        else if (Math.abs(r - 9 / 16) < 0.08) aspectRatio = '9:16';
        else if (Math.abs(r - 1) < 0.08) aspectRatio = '1:1';
        else if (Math.abs(r - 4 / 3) < 0.08) aspectRatio = '4:3';
        else aspectRatio = `${width}:${height}`;
    }
    const resolution =
        text(asset.resolution) ||
        (width && height ? `${Math.round(width)}×${Math.round(height)}` : '');
    return { durationSec, aspectRatio, resolution, width, height };
}

/**
 * @param {number | null} durationSec
 * @returns {string}
 */
export function formatDurationLabel(durationSec) {
    const n = Number(durationSec);
    if (!Number.isFinite(n) || n <= 0) return '';
    const total = Math.round(n);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return `${h}:${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Human recommendation state for creators — not shelf truth.
 * @param {string} classificationState
 * @param {string} confidenceBand
 * @returns {'recommend-accept'|'recommend-review'|'human-review'|'human-category'}
 */
export function deriveHumanHandoffMode(classificationState, confidenceBand) {
    const state = String(classificationState || '');
    const band = String(confidenceBand || '');
    if (state === 'CREATOR_LOCKED') return 'human-review';
    if (state === 'STRONG_SHELF_MATCH' || band === 'strong') return 'recommend-accept';
    if (state === 'GOOD_SHELF_MATCH' || band === 'good') return 'recommend-review';
    if (state === 'WEAK_SHELF_MATCH' || band === 'weak') return 'human-review';
    if (
        state === 'UNDERSTOOD_NO_SHELF_FIT' ||
        state === 'INSUFFICIENT_INFORMATION' ||
        state === 'AMBIGUOUS' ||
        band === 'manual' ||
        band === 'none'
    ) {
        return 'human-category';
    }
    return 'human-review';
}

/**
 * @param {string} mode
 * @returns {string}
 */
export function humanHandoffLabel(mode) {
    switch (String(mode || '')) {
        case 'recommend-accept':
            return 'Recommend Accept';
        case 'recommend-review':
            return 'Recommend · review';
        case 'human-review':
            return 'Human review';
        case 'human-category':
            return 'Human decision required';
        default:
            return 'Human review';
    }
}

/**
 * Build a Semantic Card Profile from an existing catalog/feed asset.
 *
 * @param {Record<string, unknown>} asset
 * @param {{ storage?: unknown; nlpProvider?: Function }} [options]
 */
export async function buildSemanticCardProfile(asset, options = {}) {
    const row = asset && typeof asset === 'object' ? { ...asset } : {};
    const id = text(row.id || row.mediaAssetId || row.assetId || row.reelId);
    const hydrated = id
        ? hydrateCatalogItemWithCreatorMetadata(row, options)
        : row;
    const gathered = gatherEditorialClassificationContext(id, hydrated, options);
    const forClassify = {
        ...hydrated,
        ...gathered,
        id,
        title: gathered.title || hydrated.title || hydrated.name,
        description: gathered.description,
        tags: gathered.tags,
        seriesTitle: gathered.seriesTitle,
        seriesName: gathered.seriesName,
        episodeTitle: gathered.episodeTitle,
        creatorCategory: gathered.creatorCategory,
        categorySource: gathered.categorySource,
        category: gathered.category
    };

    const meta = normalizeClassificationMetadata(forClassify);
    const themePack = extractSemanticThemes(meta, forClassify);
    const mediaFields = deriveMediaPresentationFields(forClassify);
    const identity = id ? getExactMediaIdentity(id) : null;

    const classification = await classifyContentSemantic(forClassify, {
        nlpProvider: options.nlpProvider || defaultTitleNlpProvider
    });

    const creatorLocked =
        String(forClassify.categorySource || '') === 'creator' ||
        Boolean(text(forClassify.creatorCategory));
    const statePack = deriveClassificationState(classification, {
        hasEditorialContext: gathered.hasEditorialContext,
        descriptionLength: text(gathered.description).length,
        creatorLocked,
        currentCategory: text(forClassify.category || 'Trending') || 'Trending'
    });

    const titleResolved = resolveClassificationTitle(forClassify);
    const canonicalTitle = titleResolved.title || text(forClassify.name) || '';
    const artwork =
        text(forClassify.thumbnailUrl) ||
        text(forClassify.posterUrl) ||
        text(forClassify.imageUrl) ||
        (isImageAsset(forClassify) ? text(forClassify.url) : '');
    const mediaUrl = isVideoAsset(forClassify)
        ? text(forClassify.url || forClassify.video_url)
        : '';
    const mediaStatus = text(forClassify.status) || (id ? 'unknown' : 'missing');
    const category = text(forClassify.category || classification.primaryCategory || 'Trending') || 'Trending';
    const handoffMode = deriveHumanHandoffMode(
        statePack.classificationState,
        classification.confidenceBand || ''
    );
    const persistGate = canPersistCategoryForAsset({
        id,
        isPlaceholder: forClassify.isPlaceholder,
        type: forClassify.type
    });

    const isPlaceholder = Boolean(
        forClassify.isPlaceholder ||
            String(id).startsWith('ai-black-stories-') ||
            String(id).startsWith('presentation-placeholder-')
    );
    const isRealProductionVideo =
        !isPlaceholder &&
        Boolean(id) &&
        (isVideoAsset(forClassify) || /\.mp4($|\?)/i.test(mediaUrl)) &&
        persistGate.ok;

    return {
        identity: id,
        canonicalTitle,
        description: text(gathered.description),
        category,
        contentType: themePack.contentType,
        series: text(gathered.seriesTitle || gathered.seriesName),
        episode: text(gathered.episodeTitle),
        themes: themePack.themes,
        locationHints: themePack.locationHints,
        duration: mediaFields.durationSec,
        durationLabel: formatDurationLabel(mediaFields.durationSec),
        aspectRatio: mediaFields.aspectRatio,
        resolution: mediaFields.resolution,
        mediaStatus,
        artworkUrl: artwork,
        mediaUrl,
        editorialSignals: [
            ...themePack.editorialSignals,
            ...(Array.isArray(classification.signals)
                ? classification.signals.map(String).slice(0, 8)
                : [])
        ],
        semanticConfidence: Number(
            classification.suggestedConfidence != null
                ? classification.suggestedConfidence
                : classification.confidence
        ),
        confidenceBand: String(classification.confidenceBand || ''),
        confidenceLabel: formatSuggestionConfidence(
            classification.suggestedConfidence != null
                ? classification.suggestedConfidence
                : classification.confidence,
            classification.confidenceBand
        ),
        suggestedCategory: text(classification.suggestedCategory || ''),
        alternativeCategory: text(classification.alternativeCategory || ''),
        classificationState: statePack.classificationState,
        taxonomyFit: statePack.taxonomyFit,
        shelfFitReason: statePack.shelfFitReason,
        handoffMode,
        handoffLabel: humanHandoffLabel(handoffMode),
        creatorLocked,
        isPlaceholder,
        isRealProductionVideo,
        identityConfidence: identity?.identityConfidence || '',
        matchedLocalFile: identity?.matchedLocalFiles?.[0] || '',
        canAppearAsCard: isRealProductionVideo || (!isPlaceholder && Boolean(id)),
        // Shelf category stays independent from semantic themes
        shelfCategory: category
    };
}

/**
 * Build profiles for a catalog list (presentation only).
 * @param {Array<Record<string, unknown>>} catalog
 * @param {{ storage?: unknown }} [options]
 */
export async function buildSemanticCardProfiles(catalog, options = {}) {
    const rows = Array.isArray(catalog) ? catalog : [];
    /** @type {Awaited<ReturnType<typeof buildSemanticCardProfile>>[]} */
    const profiles = [];
    for (const row of rows) {
        profiles.push(await buildSemanticCardProfile(row, options));
    }
    return profiles;
}
