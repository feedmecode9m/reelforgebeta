/**
 * Phase 3A — production smart-category audit (read-only by default).
 *
 * Evaluates durable catalog assets with the existing Phase 1–2.5 classification
 * path. Does NOT PATCH, write localStorage, or mutate reels.category.
 *
 * Persistence happens only when callers explicitly invoke
 * persistCreatorCategoryChoice / saveCreatorCatalogMetadata after Accept.
 */

import {
    DISCOVERY_SHELVES,
    EXPLICIT_SHELF_CATEGORIES,
    SOFT_DEFAULT_CATEGORIES,
    hasExplicitCreatorCategoryLock,
    normalizeDiscoveryShelf,
    resolveClassificationTitle,
    classifyContent
} from './contentClassifier.js';
import {
    canPersistCategoryForAsset,
    CREATOR_SHELF_OPTIONS,
    persistCreatorCategoryChoice
} from './categorySuggestionReview.js';
import { confidenceBand, suggestShelfClassification } from './titleNlpProvider.js';
import {
    hydrateCatalogItemWithCreatorMetadata,
    loadCreatorCatalogMetadata,
    normalizeCreatorCategory
} from './creatorCatalogMetadata.js';
import { overlayLaProductionForClassification } from '../series/laProductionStudioEnrichment.js';

/** @typedef {'MATCH'|'RECOMMEND_CHANGE'|'REVIEW'|'AMBIGUOUS'|'MANUAL'|'CREATOR_LOCK'|'FALLBACK_TRENDING'|'EXCLUDED'} AuditState */

export const AUDIT_STATES = Object.freeze([
    'MATCH',
    'RECOMMEND_CHANGE',
    'REVIEW',
    'AMBIGUOUS',
    'MANUAL',
    'CREATOR_LOCK',
    'FALLBACK_TRENDING',
    'EXCLUDED'
]);

export { CREATOR_SHELF_OPTIONS, DISCOVERY_SHELVES };

/**
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {{ eligible: boolean; reason: string; assetId: string }}
 */
export function isAuditEligibleAsset(asset) {
    const gate = canPersistCategoryForAsset(asset);
    if (!gate.ok) {
        return { eligible: false, reason: gate.reason, assetId: gate.assetId };
    }
    const row = asset && typeof asset === 'object' ? asset : {};
    // Demo placeholders injected by fetchReadyReels when catalog empty
    if (row.isPlaceholder || row.isBlackStoriesPlaceholder) {
        return { eligible: false, reason: 'placeholder', assetId: gate.assetId };
    }
    return { eligible: true, reason: 'ok', assetId: gate.assetId };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function resolveCurrentCategory(row) {
    const raw = String(
        row.creatorCategory || row.studioCategory || row.category || row.shelfCategory || 'Trending'
    ).trim();
    // Soft placement — keep visible in CURRENT DISTRIBUTION (not a genre shelf)
    if (raw === 'HERO') return 'HERO';
    if (!raw || SOFT_DEFAULT_CATEGORIES.has(raw)) {
        const soft = normalizeDiscoveryShelf(raw || 'Trending');
        return soft || 'Trending';
    }
    return normalizeDiscoveryShelf(raw);
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
function resolveCategorySourceLabel(row) {
    const src = String(row.categorySource || '').trim();
    if (src) return src;
    if (String(row.creatorCategory || '').trim()) return 'creator';
    if (String(row.studioCategory || '').trim()) return 'studio';
    const cat = String(row.category || '').trim();
    if (cat && !SOFT_DEFAULT_CATEGORIES.has(cat) && EXPLICIT_SHELF_CATEGORIES.has(cat)) {
        return 'existing-category';
    }
    return 'catalog';
}

/**
 * Deterministic audit state from current + NLP suggestion.
 *
 * @param {{
 *   creatorLocked: boolean;
 *   currentCategory: string;
 *   suggestedCategory: string;
 *   confidence: number;
 *   ambiguous: boolean;
 *   confidenceBand: string;
 * }} input
 * @returns {AuditState}
 */
export function deriveAuditState(input) {
    if (input.creatorLocked) return 'CREATOR_LOCK';

    const suggested = String(input.suggestedCategory || '').trim();
    const current = normalizeDiscoveryShelf(input.currentCategory || 'Trending');
    const conf = Number(input.confidence) || 0;
    const band = input.confidenceBand || confidenceBand(conf);
    const genreSuggested = EXPLICIT_SHELF_CATEGORIES.has(suggested);

    if (input.ambiguous && genreSuggested) return 'AMBIGUOUS';

    if (!genreSuggested || conf < 0.5 || band === 'manual') {
        if (current === 'Trending' || SOFT_DEFAULT_CATEGORIES.has(current)) {
            return 'FALLBACK_TRENDING';
        }
        return 'MANUAL';
    }

    if (suggested === current) return 'MATCH';

    if (conf >= 0.85 && band === 'strong') return 'RECOMMEND_CHANGE';
    if (conf >= 0.5) return 'REVIEW';

    return 'MANUAL';
}

/**
 * What NLP would assign if recommendations were applied (creator locks kept).
 * @param {{ auditState: AuditState; currentCategory: string; suggestedCategory: string; confidence?: number; suggestedConfidence?: number }} row
 */
export function resolveRecommendedShelf(row) {
    const confidence = Number(
        row.suggestedConfidence != null ? row.suggestedConfidence : row.confidence
    );
    if (row.auditState === 'CREATOR_LOCK') return row.currentCategory;
    if (row.auditState === 'MATCH') return row.currentCategory;
    if (
        (row.auditState === 'RECOMMEND_CHANGE' || row.auditState === 'REVIEW' || row.auditState === 'AMBIGUOUS') &&
        EXPLICIT_SHELF_CATEGORIES.has(row.suggestedCategory) &&
        confidence >= 0.5
    ) {
        return row.suggestedCategory;
    }
    if (row.auditState === 'FALLBACK_TRENDING' || row.auditState === 'MANUAL') {
        return 'Trending';
    }
    return row.currentCategory || 'Trending';
}

/**
 * Audit a single catalog asset — suggestion only, no writes.
 *
 * @param {Record<string, unknown>} asset
 * @param {{ storage?: unknown }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function auditCatalogAsset(asset, options = {}) {
    const eligibility = isAuditEligibleAsset(asset);
    if (!eligibility.eligible) {
        return {
            id: eligibility.assetId || String(asset?.id || ''),
            eligible: false,
            exclusionReason: eligibility.reason,
            auditState: 'EXCLUDED',
            canonicalTitle: '',
            currentCategory: '',
            currentCategorySource: '',
            suggestedCategory: '',
            suggestedConfidence: 0,
            confidenceBand: 'none',
            alternativeCategory: '',
            ambiguous: false,
            signals: [],
            creatorLocked: false,
            manualReviewRequired: false,
            eligibleForPersistence: false,
            eligibleForApproval: false
        };
    }

    const hydrated = hydrateCatalogItemWithCreatorMetadata(
        { ...(asset && typeof asset === 'object' ? asset : {}), id: eligibility.assetId },
        options
    );
    const classified = overlayLaProductionForClassification(hydrated, [hydrated]);
    const titleResolved = resolveClassificationTitle(classified);
    const authored = classifyContent(classified);
    const creatorLocked = hasExplicitCreatorCategoryLock(classified, authored);

    const classification = await suggestShelfClassification({
        ...classified,
        title: titleResolved.title,
        persistentTitle: titleResolved.title,
        creatorTitle: titleResolved.title
    });

    const currentCategory = resolveCurrentCategory(classified);
    const currentCategorySource = resolveCategorySourceLabel(classified);

    // NLP suggestion fields (non-authoritative when locked)
    let suggestedCategory = String(
        classification.suggestedCategory || classification.primaryCategory || ''
    ).trim();
    if (creatorLocked) {
        suggestedCategory = String(classification.suggestedCategory || '').trim();
    }
    if (!EXPLICIT_SHELF_CATEGORIES.has(suggestedCategory) && suggestedCategory !== 'Trending') {
        suggestedCategory = normalizeDiscoveryShelf(suggestedCategory);
    }

    const suggestedConfidence = Number(
        classification.suggestedConfidence != null
            ? classification.suggestedConfidence
            : classification.confidence
    );
    const band = String(classification.confidenceBand || confidenceBand(suggestedConfidence));
    const ambiguous = Boolean(classification.ambiguous);
    const alternativeCategory = String(classification.alternativeCategory || '').trim();

    const auditState = deriveAuditState({
        creatorLocked,
        currentCategory,
        suggestedCategory,
        confidence: Number.isFinite(suggestedConfidence) ? suggestedConfidence : 0,
        ambiguous,
        confidenceBand: band
    });

    const manualReviewRequired =
        auditState === 'MANUAL' ||
        auditState === 'REVIEW' ||
        auditState === 'AMBIGUOUS' ||
        auditState === 'FALLBACK_TRENDING';

    const eligibleForApproval =
        auditState === 'RECOMMEND_CHANGE' &&
        !creatorLocked &&
        EXPLICIT_SHELF_CATEGORIES.has(suggestedCategory) &&
        suggestedConfidence >= 0.85;

    return {
        id: eligibility.assetId,
        eligible: true,
        exclusionReason: '',
        auditState,
        canonicalTitle: titleResolved.title,
        titleSource: titleResolved.titleSource,
        mediaKind: String(hydrated.mediaKind || hydrated.type || '').toLowerCase() || 'unknown',
        currentCategory,
        currentCategorySource,
        suggestedCategory,
        suggestedConfidence: Number.isFinite(suggestedConfidence) ? suggestedConfidence : 0,
        confidenceBand: band,
        alternativeCategory,
        ambiguous,
        signals: Array.isArray(classification.signals) ? classification.signals.map(String) : [],
        scoreBreakdown: classification.scoreBreakdown || undefined,
        classificationSource: classification.classificationSource,
        creatorLocked,
        manualReviewRequired,
        eligibleForPersistence: true,
        eligibleForApproval,
        recommendedShelf: resolveRecommendedShelf({
            auditState,
            currentCategory,
            suggestedCategory,
            confidence: Number.isFinite(suggestedConfidence) ? suggestedConfidence : 0
        })
    };
}

/**
 * Audit a catalog list. Pure evaluation — no persistence.
 *
 * @param {unknown[]} catalog
 * @param {{ storage?: unknown; videosOnly?: boolean }} [options]
 */
export async function auditProductionCatalog(catalog, options = {}) {
    const list = Array.isArray(catalog) ? catalog : [];
    /** @type {Record<string, unknown>[]} */
    const rows = [];

    for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const asset = /** @type {Record<string, unknown>} */ (raw);
        if (options.videosOnly) {
            const kind = String(asset.mediaKind || asset.type || '').toLowerCase();
            const isVideo =
                kind === 'video' ||
                Boolean(asset.isPersonalVideo) ||
                /\.(mp4|webm|mov|m4v)(\?|$)/i.test(String(asset.url || asset.video_url || ''));
            if (!isVideo) continue;
        }
        rows.push(await auditCatalogAsset(asset, options));
    }

    const eligible = rows.filter((r) => r.eligible);
    const excluded = rows.filter((r) => !r.eligible);

    /** @type {Record<string, number>} */
    const currentDistribution = { Trending: 0, Romance: 0, 'Cyber-Action': 0, Suspense: 0, HERO: 0 };
    /** @type {Record<string, number>} */
    const recommendedDistribution = { Trending: 0, Romance: 0, 'Cyber-Action': 0, Suspense: 0 };

    for (const row of eligible) {
        const cur = String(row.currentCategory || 'Trending');
        if (cur === 'HERO') currentDistribution.HERO += 1;
        else if (currentDistribution[cur] != null) currentDistribution[cur] += 1;
        else currentDistribution.Trending += 1;

        const rec = String(row.recommendedShelf || 'Trending');
        if (recommendedDistribution[rec] != null) recommendedDistribution[rec] += 1;
        else recommendedDistribution.Trending += 1;
    }

    /** @type {Record<string, number>} */
    const byState = {};
    for (const state of AUDIT_STATES) byState[state] = 0;
    for (const row of rows) {
        const s = String(row.auditState || 'EXCLUDED');
        byState[s] = (byState[s] || 0) + 1;
    }

    return {
        auditedAt: new Date().toISOString(),
        totalInput: list.length,
        eligibleCount: eligible.length,
        excludedCount: excluded.length,
        approvalEligibleCount: eligible.filter((r) => r.eligibleForApproval).length,
        currentDistribution,
        recommendedDistribution,
        byState,
        rows,
        eligible,
        excluded
    };
}

/**
 * Explicit approval — only path that may persist. Uses existing creator metadata + PATCH.
 *
 * @param {string} assetId
 * @param {{ title?: string; category: string; action: 'accept'|'override'|'manual'|'leave' }} fields
 * @param {{ storage?: unknown; patchCategory?: boolean; asset?: Record<string, unknown> }} [options]
 */
export function applyAuditCategoryDecision(assetId, fields, options = {}) {
    const action = String(fields.action || '').trim();
    if (action === 'leave') {
        return { ok: true, skipped: true, reason: 'leave-current' };
    }
    if (!['accept', 'override', 'manual'].includes(action)) {
        return { ok: false, skipped: true, reason: 'invalid-action' };
    }
    const gate = canPersistCategoryForAsset(options.asset || { id: assetId });
    if (!gate.ok) return { ok: false, skipped: true, reason: gate.reason };

    // Creator lock: accept must not overwrite — only override/manual allowed intentionally
    if (action === 'accept' && options.asset) {
        const hydrated = hydrateCatalogItemWithCreatorMetadata(
            { ...options.asset, id: gate.assetId },
            options
        );
        const authored = classifyContent(hydrated);
        if (hasExplicitCreatorCategoryLock(hydrated, authored)) {
            return { ok: false, skipped: true, reason: 'creator-lock' };
        }
    }

    const saved = persistCreatorCategoryChoice(
        gate.assetId,
        { title: fields.title, category: fields.category },
        options
    );
    if (!saved) return { ok: false, skipped: true, reason: 'persist-failed' };
    return { ok: true, skipped: false, saved };
}

/**
 * Summarize why a Trending record stayed Trending (for operator report).
 * @param {Record<string, unknown>} auditRow
 */
export function explainTrendingReason(auditRow) {
    const state = String(auditRow.auditState || '');
    if (state === 'FALLBACK_TRENDING') {
        return 'C — insufficient title/metadata for NLP genre assignment';
    }
    if (state === 'MANUAL' || state === 'REVIEW') {
        return 'D — ambiguous/weak signals require manual review';
    }
    if (state === 'AMBIGUOUS') {
        return 'D — competing genre signals require creator choice';
    }
    if (state === 'CREATOR_LOCK') {
        return 'A/B — creator-authored category is authoritative';
    }
    if (state === 'RECOMMEND_CHANGE') {
        return 'B — missing creator categorization; strong NLP recommendation available';
    }
    if (state === 'MATCH') {
        return 'A — current category already matches semantic recommendation';
    }
    return 'unknown';
}
