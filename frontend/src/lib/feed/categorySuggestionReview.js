/**
 * Phase 2 / 2.5 / 3C — creator category suggestion review helpers.
 *
 * Suggestion-only until Accept / Override / Manual. Persistence reuses
 * saveCreatorCatalogMetadata → patchReelCategory (existing path).
 * Does not invent durable fields beyond creatorCategory / categorySource.
 *
 * Phase 3C: after canonical title save, re-evaluate with durable description /
 * tags / series / episode from reel_titles_persistent (+ series mirror). Never
 * auto-PATCH category on suggestion display.
 */

import { EXPLICIT_SHELF_CATEGORIES, isGenericMediaLabel } from './contentClassifier.js';
import {
    CREATOR_SHELF_OPTIONS,
    loadCreatorCatalogMetadata,
    normalizeCreatorCategory,
    saveCreatorCatalogMetadata,
    createMemoryStorage
} from './creatorCatalogMetadata.js';
import { SERIES_METADATA_STORAGE_KEY } from '../series/seriesMetadataStorage.js';
import { confidenceBand, suggestShelfClassification } from './titleNlpProvider.js';

/** Minimum confidence to surface an Acceptable NLP genre suggestion. */
export const CATEGORY_SUGGESTION_OFFER_MIN_CONFIDENCE = 0.5;

export { CREATOR_SHELF_OPTIONS, confidenceBand };

/**
 * @typedef {Object} CategorySuggestionReview
 * @property {string} currentCategory
 * @property {string} suggestedCategory
 * @property {string} [alternativeCategory]
 * @property {number} confidence
 * @property {string} classificationSource
 * @property {string} [titleSource]
 * @property {boolean} offer
 * @property {boolean} ambiguous
 * @property {boolean} showManualHelper
 * @property {string} confidenceBand
 * @property {string[]} [signals]
 * @property {Record<string, number>} [scoreBreakdown]
 * @property {string} [taxonomyFit] A–F
 * @property {string} [classificationState]
 * @property {string} [recommendedShelf]
 * @property {string} [shelfFitReason]
 * @property {boolean} [creatorLocked]
 * @property {boolean} [hasEditorialContext]
 */

/**
 * Durable asset gate — placeholders / demo cards must not persist categories.
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {{ ok: boolean; reason: string; assetId: string }}
 */
export function canPersistCategoryForAsset(asset) {
    const row = asset && typeof asset === 'object' ? asset : {};
    if (row.isPlaceholder === true || row.isBlackStoriesPlaceholder === true) {
        return { ok: false, reason: 'placeholder', assetId: '' };
    }
    const assetId = String(
        row.id || row.mediaAssetId || row.assetId || row.reelId || ''
    ).trim();
    if (!assetId) {
        return { ok: false, reason: 'missing-durable-id', assetId: '' };
    }
    if (/^(ai-black-stories-|coming-soon-|placeholder-)/i.test(assetId)) {
        return { ok: false, reason: 'demo-id', assetId: '' };
    }
    return { ok: true, reason: 'ok', assetId };
}

/**
 * @param {{ storage?: unknown }} [options]
 */
function resolveReviewStorage(options = {}) {
    if (options.storage && typeof /** @type {{ getItem?: Function }} */ (options.storage).getItem === 'function') {
        return /** @type {{ getItem: Function; setItem?: Function }} */ (options.storage);
    }
    if (typeof localStorage !== 'undefined') return localStorage;
    return createMemoryStorage();
}

/**
 * Gather durable editorial context for NLP (no writes).
 * Description authority: reel_titles_persistent.description (via loadCreatorCatalogMetadata),
 * with series-metadata description as fill-hole — same path as Phase 17–19.
 *
 * @param {string} assetId
 * @param {Record<string, unknown>} [content]
 * @param {{ storage?: unknown }} [options]
 */
export function gatherEditorialClassificationContext(assetId, content = {}, options = {}) {
    const id = String(assetId || content.id || content.mediaAssetId || content.assetId || '').trim();
    const meta = id
        ? loadCreatorCatalogMetadata(id, options)
        : { title: '', description: '', tags: [], category: '' };

    let seriesName = String(content.seriesName || content.seriesTitle || '').trim();
    let episodeTitle = String(content.episodeTitle || '').trim();
    let seriesDescription = '';

    if (id) {
        try {
            const storage = resolveReviewStorage(options);
            const raw = storage.getItem(SERIES_METADATA_STORAGE_KEY);
            const map = raw ? JSON.parse(raw) : {};
            const row = map && typeof map === 'object' ? map[id] : null;
            if (row && typeof row === 'object') {
                if (!seriesName) seriesName = String(row.seriesName || '').trim();
                if (!episodeTitle) episodeTitle = String(row.episodeTitle || '').trim();
                seriesDescription = String(row.description || '').trim();
            }
        } catch {
            /* ignore */
        }
    }

    const descriptionFromContent =
        content.description !== undefined && content.description !== null
            ? String(content.description)
            : null;
    const description =
        descriptionFromContent != null
            ? descriptionFromContent
            : meta.description || seriesDescription || String(content.heroDescription || '');

    const tags =
        content.tags !== undefined
            ? content.tags
            : meta.tags && meta.tags.length
              ? meta.tags
              : content.keywords || [];

    const creatorCategory = String(meta.category || content.creatorCategory || '').trim();
    const categorySource = creatorCategory
        ? 'creator'
        : String(content.categorySource || '').trim();

    return {
        assetId: id,
        title: String(
            content.title || content.persistentTitle || content.creatorTitle || meta.title || ''
        ).trim(),
        description,
        tags,
        seriesName,
        seriesTitle: seriesName,
        episodeTitle,
        creatorCategory,
        categorySource,
        category: creatorCategory || String(content.category || 'Trending'),
        hasEditorialContext: Boolean(
            String(description || '').trim().length >= 40 ||
                seriesName ||
                (Array.isArray(tags) ? tags.length : String(tags || '').trim())
        )
    };
}

/**
 * Classification state for UI — Case F is first-class (not “NLP failed”).
 *
 * @param {import('./contentClassifier.js').ContentClassification | null | undefined} classification
 * @param {{ hasEditorialContext?: boolean; descriptionLength?: number; creatorLocked?: boolean; currentCategory?: string }} [ctx]
 */
export function deriveClassificationState(classification, ctx = {}) {
    const signals = Array.isArray(classification?.signals)
        ? classification.signals.map(String)
        : [];
    const suggestedRaw = String(
        classification?.suggestedCategory || classification?.primaryCategory || 'Trending'
    ).trim();
    const conf = Number(
        classification?.suggestedConfidence != null
            ? classification.suggestedConfidence
            : classification?.confidence
    );
    const band = String(classification?.confidenceBand || confidenceBand(conf || 0));
    const ambiguous = Boolean(classification?.ambiguous);
    const genre = EXPLICIT_SHELF_CATEGORIES.has(suggestedRaw);
    const descLen = Number(ctx.descriptionLength) || 0;
    const hasContext =
        Boolean(ctx.hasEditorialContext) ||
        descLen >= 80 ||
        signals.some((s) => s.includes('context-without-shelf-fit'));

    if (ctx.creatorLocked) {
        return {
            taxonomyFit: hasContext ? 'F' : genre ? 'C' : 'E',
            classificationState: 'CREATOR_LOCKED',
            recommendedShelf: String(ctx.currentCategory || 'Trending'),
            shelfFitReason:
                'Creator-authored category is authoritative; NLP suggestion is non-binding'
        };
    }

    if (ambiguous && genre) {
        return {
            taxonomyFit: 'D',
            classificationState: 'AMBIGUOUS',
            recommendedShelf: suggestedRaw,
            shelfFitReason: 'Competing shelf signals — Manual Category required'
        };
    }
    if (genre && conf >= 0.85 && band === 'strong') {
        return {
            taxonomyFit: 'A',
            classificationState: 'STRONG_SHELF_MATCH',
            recommendedShelf: suggestedRaw,
            shelfFitReason: `Strong valid shelf match → ${suggestedRaw}`
        };
    }
    if (genre && conf >= 0.7) {
        return {
            taxonomyFit: 'B',
            classificationState: 'GOOD_SHELF_MATCH',
            recommendedShelf: suggestedRaw,
            shelfFitReason: `Good valid shelf match → ${suggestedRaw}`
        };
    }
    if (genre && conf >= 0.5) {
        return {
            taxonomyFit: 'C',
            classificationState: 'WEAK_SHELF_MATCH',
            recommendedShelf: suggestedRaw,
            shelfFitReason: `Weak/uncertain shelf match → ${suggestedRaw}`
        };
    }
    if (genre) {
        return {
            taxonomyFit: 'C',
            classificationState: 'WEAK_SHELF_MATCH',
            recommendedShelf: suggestedRaw,
            shelfFitReason: `Weak genre suggestion → ${suggestedRaw}; prefer Manual Category`
        };
    }
    if (hasContext) {
        return {
            taxonomyFit: 'F',
            classificationState: 'UNDERSTOOD_NO_SHELF_FIT',
            recommendedShelf: 'Trending',
            shelfFitReason: 'No valid Romance/Cyber-Action/Suspense semantic fit'
        };
    }
    return {
        taxonomyFit: 'E',
        classificationState: 'INSUFFICIENT_INFORMATION',
        recommendedShelf: 'Trending',
        shelfFitReason: 'Insufficient title/metadata for genre assignment'
    };
}

/**
 * @param {import('./contentClassifier.js').ContentClassification | null | undefined} classification
 * @returns {{ category: string; confidence: number; alternativeCategory: string; ambiguous: boolean }}
 */
export function extractNlpSuggestion(classification) {
    if (!classification || typeof classification !== 'object') {
        return { category: '', confidence: 0, alternativeCategory: '', ambiguous: false };
    }
    const suggested = String(classification.suggestedCategory || '').trim();
    const primary = String(classification.primaryCategory || '').trim();
    const source = String(classification.classificationSource || '');
    const alternative = String(classification.alternativeCategory || '').trim();
    const ambiguous = Boolean(classification.ambiguous);

    if (source === 'metadata' || source === 'existing-category') {
        const conf = Number(classification.suggestedConfidence);
        return {
            category: EXPLICIT_SHELF_CATEGORIES.has(suggested) ? suggested : '',
            confidence: Number.isFinite(conf) ? conf : 0,
            alternativeCategory: EXPLICIT_SHELF_CATEGORIES.has(alternative) ? alternative : '',
            ambiguous
        };
    }

    if (source === 'nlp') {
        const cat = EXPLICIT_SHELF_CATEGORIES.has(suggested)
            ? suggested
            : EXPLICIT_SHELF_CATEGORIES.has(primary)
              ? primary
              : '';
        const conf = Number(
            classification.suggestedConfidence != null
                ? classification.suggestedConfidence
                : classification.confidence
        );
        return {
            category: cat,
            confidence: Number.isFinite(conf) ? conf : 0,
            alternativeCategory: EXPLICIT_SHELF_CATEGORIES.has(alternative) ? alternative : '',
            ambiguous
        };
    }

    return { category: '', confidence: 0, alternativeCategory: '', ambiguous: false };
}

/**
 * @param {string} title
 * @returns {boolean}
 */
export function isReviewableCanonicalTitle(title) {
    const t = title == null ? '' : String(title).trim();
    if (!t) return false;
    if (isGenericMediaLabel(t)) return false;
    return true;
}

/**
 * @param {import('./contentClassifier.js').ContentClassification | null | undefined} classification
 * @param {string} [currentCategory]
 * @returns {boolean}
 */
export function shouldOfferCategorySuggestion(classification, currentCategory = 'Trending') {
    const { category: suggested, confidence, ambiguous } = extractNlpSuggestion(classification);
    if (!suggested || !EXPLICIT_SHELF_CATEGORIES.has(suggested)) return false;
    if (confidence < CATEGORY_SUGGESTION_OFFER_MIN_CONFIDENCE) return false;
    const current = normalizeCreatorCategory(currentCategory) || 'Trending';
    if (current === suggested && !ambiguous) return false;
    return true;
}

/**
 * @param {CategorySuggestionReview} review
 * @param {string} [currentCategory]
 */
export function shouldShowManualCategoryHelper(review, currentCategory = 'Trending') {
    const current = normalizeCreatorCategory(currentCategory) || 'Trending';
    if (EXPLICIT_SHELF_CATEGORIES.has(current)) {
        return true;
    }
    if (review?.taxonomyFit === 'F' || review?.classificationState === 'UNDERSTOOD_NO_SHELF_FIT') {
        return true;
    }
    if (!review?.offer) return true;
    if (review.ambiguous) return true;
    if (review.confidence < 0.7) return true;
    if (review.confidenceBand === 'manual' || review.confidenceBand === 'weak') return true;
    return false;
}

/**
 * @param {{
 *   classification: import('./contentClassifier.js').ContentClassification | null | undefined;
 *   currentCategory?: string;
 *   hasEditorialContext?: boolean;
 *   descriptionLength?: number;
 *   creatorLocked?: boolean;
 * }} input
 * @returns {CategorySuggestionReview}
 */
export function buildCategorySuggestionReview(input) {
    const current = normalizeCreatorCategory(input.currentCategory) || 'Trending';
    const extracted = extractNlpSuggestion(input.classification);
    const band =
        (input.classification && input.classification.confidenceBand) ||
        confidenceBand(extracted.confidence);
    const offer = shouldOfferCategorySuggestion(input.classification, current);
    const creatorLocked = Boolean(input.creatorLocked);
    const state = deriveClassificationState(input.classification, {
        hasEditorialContext: Boolean(input.hasEditorialContext),
        descriptionLength: input.descriptionLength,
        creatorLocked,
        currentCategory: current
    });

    /** @type {CategorySuggestionReview} */
    const review = {
        currentCategory: current,
        suggestedCategory: extracted.category || '',
        alternativeCategory: extracted.alternativeCategory || undefined,
        confidence: extracted.confidence,
        classificationSource: String(input.classification?.classificationSource || ''),
        titleSource: input.classification?.titleSource
            ? String(input.classification.titleSource)
            : undefined,
        offer: creatorLocked ? false : offer,
        ambiguous: extracted.ambiguous,
        showManualHelper: false,
        confidenceBand: String(band || 'none'),
        signals: Array.isArray(input.classification?.signals)
            ? input.classification.signals.map(String)
            : undefined,
        scoreBreakdown: input.classification?.scoreBreakdown,
        taxonomyFit: state.taxonomyFit,
        classificationState: state.classificationState,
        recommendedShelf: state.recommendedShelf,
        shelfFitReason: state.shelfFitReason,
        creatorLocked,
        hasEditorialContext: Boolean(input.hasEditorialContext)
    };
    if (creatorLocked && extracted.category) {
        review.suggestedCategory = extracted.category;
    }
    review.showManualHelper = shouldShowManualCategoryHelper(review, current);
    return review;
}

/**
 * Run suggestion for review UI. Does not persist.
 *
 * @param {Record<string, unknown>} content
 * @param {{ storage?: unknown }} [options]
 * @returns {Promise<CategorySuggestionReview>}
 */
export async function evaluateCategorySuggestionReview(content = {}, options = {}) {
    const id = String(content.id || content.mediaAssetId || content.assetId || '').trim();
    const gathered = gatherEditorialClassificationContext(id, content, options);
    const title = String(
        content.title || content.persistentTitle || content.creatorTitle || gathered.title || ''
    ).trim();

    if (!isReviewableCanonicalTitle(title)) {
        const current =
            normalizeCreatorCategory(
                content.category || content.creatorCategory || gathered.creatorCategory
            ) || 'Trending';
        const emptyClass = {
            primaryCategory: 'Trending',
            suggestedCategory: 'Trending',
            confidence: 0,
            suggestedConfidence: 0,
            signals: ['nlp:empty-or-generic-title'],
            classificationSource: 'fallback',
            confidenceBand: 'manual'
        };
        return buildCategorySuggestionReview({
            classification: /** @type {import('./contentClassifier.js').ContentClassification} */ (
                emptyClass
            ),
            currentCategory: current,
            hasEditorialContext: gathered.hasEditorialContext,
            descriptionLength: String(gathered.description || '').length,
            creatorLocked: Boolean(gathered.creatorCategory)
        });
    }

    let creatorCategory = gathered.creatorCategory;
    let categorySource = gathered.categorySource;
    let category = gathered.category || 'Trending';

    const draftExplicit = normalizeCreatorCategory(content.draftCategory);
    if (draftExplicit) {
        category = draftExplicit;
        creatorCategory = draftExplicit;
        categorySource = categorySource || 'creator';
    }

    const creatorLocked = Boolean(
        creatorCategory &&
            (categorySource === 'creator' || categorySource === 'studio') &&
            EXPLICIT_SHELF_CATEGORIES.has(normalizeCreatorCategory(creatorCategory))
    );

    const classification = await suggestShelfClassification({
        ...content,
        title,
        persistentTitle: title,
        creatorTitle: title,
        category: creatorLocked ? creatorCategory : category,
        creatorCategory: creatorLocked ? creatorCategory : undefined,
        categorySource: creatorLocked ? categorySource : undefined,
        description: gathered.description,
        tags: gathered.tags,
        seriesName: gathered.seriesName,
        seriesTitle: gathered.seriesTitle,
        episodeTitle: gathered.episodeTitle
    });

    return buildCategorySuggestionReview({
        classification,
        currentCategory: creatorCategory || category,
        hasEditorialContext: gathered.hasEditorialContext,
        descriptionLength: String(gathered.description || '').length,
        creatorLocked
    });
}

/**
 * Phase 3C — after successful canonical title save, re-evaluate suggestion only.
 * Never PATCHes category.
 *
 * @param {string} assetId
 * @param {string} canonicalTitle
 * @param {Record<string, unknown>} [extraContent]
 * @param {{ storage?: unknown }} [options]
 */
export async function reevaluateAfterCanonicalTitleSave(
    assetId,
    canonicalTitle,
    extraContent = {},
    options = {}
) {
    const id = String(assetId || '').trim();
    const title = String(canonicalTitle || '').trim();
    return evaluateCategorySuggestionReview(
        {
            ...extraContent,
            id,
            mediaAssetId: id,
            assetId: id,
            title,
            persistentTitle: title,
            creatorTitle: title
        },
        options
    );
}

/**
 * Accept / Override / Manual persistence — creator-authored lock via existing metadata path.
 *
 * @param {string} assetId
 * @param {{ title?: string; description?: string; tags?: string[] | string; category: string }} fields
 * @param {{ storage?: unknown; patchCategory?: boolean; asset?: Record<string, unknown> }} [options]
 * @returns {ReturnType<typeof saveCreatorCatalogMetadata>}
 */
export function persistCreatorCategoryChoice(assetId, fields, options = {}) {
    const gate = canPersistCategoryForAsset(
        options.asset || { id: assetId, mediaAssetId: assetId, assetId }
    );
    if (!gate.ok) return null;

    const category = normalizeCreatorCategory(fields.category) || String(fields.category || '').trim();
    if (!gate.assetId || !category) return null;
    const allowed = CREATOR_SHELF_OPTIONS.includes(category)
        ? category
        : normalizeCreatorCategory(category);
    if (!allowed && category !== 'Trending') return null;
    const shelf = allowed || 'Trending';

    return saveCreatorCatalogMetadata(
        gate.assetId,
        {
            title: fields.title,
            description: fields.description,
            tags: fields.tags,
            category: shelf === 'Trending' ? '' : shelf
        },
        {
            storage: options.storage,
            patchCategory: options.patchCategory !== false
        }
    );
}

/**
 * @param {number} confidence
 * @param {string} [band]
 * @returns {string}
 */
export function formatSuggestionConfidence(confidence, band) {
    const n = Number(confidence);
    const b = band || confidenceBand(n);
    if (!Number.isFinite(n)) return 'unknown';
    if (b === 'strong') return `Strong (${Math.round(n * 100)}%)`;
    if (b === 'good') return `Good (${Math.round(n * 100)}%)`;
    if (b === 'weak') return `Uncertain (${Math.round(n * 100)}%)`;
    if (b === 'manual') return `Too low — choose manually (${Math.round(n * 100)}%)`;
    return `Low (${Math.round(n * 100)}%)`;
}
