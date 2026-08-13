/**
 * Phase 4 — identity-backed editorial review (preparation layer).
 *
 * Separates three independent confidence axes:
 *   1) Media identity (physical EXACT match from forensics)
 *   2) Editorial metadata authority (coworker final list only)
 *   3) NLP / category suggestion (only when authority is AUTHORITATIVE)
 *
 * Does NOT invent titles/descriptions.
 * Does NOT write reel_titles_persistent from identity alone.
 * Does NOT PATCH category unless creator explicitly Accept/Override/Manual
 *   AND authoritative editorial metadata is present.
 */

import {
    canPersistCategoryForAsset,
    CREATOR_SHELF_OPTIONS,
    evaluateCategorySuggestionReview,
    persistCreatorCategoryChoice
} from './categorySuggestionReview.js';
import { hydrateCatalogItemWithCreatorMetadata } from './creatorCatalogMetadata.js';

export { CREATOR_SHELF_OPTIONS };

/** @typedef {'EXACT'|'HIGH_CONFIDENCE'|'AMBIGUOUS'|'NO_MATCH'} IdentityConfidence */
/** @typedef {'AUTHORITATIVE'|'MISSING'|'PROVISIONAL'} EditorialMetadataStatus */

/**
 * Frozen EXACT identity registry from Phase 4 local media forensics.
 * Evidence: R2 ETag (object MD5) + Content-Length. Not editorial titles.
 */
export const PHASE4_EXACT_MEDIA_IDENTITY = Object.freeze([
    Object.freeze({
        productionId: '03ef898a-989f-42c3-bdbb-67f37338df65',
        currentProductionTitleAtForensics: '01 ARRIVAL OPEN v1',
        matchedLocalFiles: Object.freeze(['01_ARRIVAL_OPEN_v1.mp4']),
        identityConfidence: /** @type {IdentityConfidence} */ ('EXACT'),
        identityEvidence: Object.freeze([
            'R2 ETag MD5 == local MD5',
            'Content-Length == byteSize (215934975)'
        ])
    }),
    Object.freeze({
        productionId: 'd2aafde7-d7ba-492c-a860-20b51f7f4033',
        currentProductionTitleAtForensics: '03 CLUB POOM POOM V1',
        matchedLocalFiles: Object.freeze(['03_CLUB POOM POOM_V1.mp4']),
        identityConfidence: /** @type {IdentityConfidence} */ ('EXACT'),
        identityEvidence: Object.freeze([
            'R2 ETag MD5 == local MD5',
            'Content-Length == byteSize (476595206)'
        ])
    }),
    Object.freeze({
        productionId: '615e0eae-47b4-468a-b6dd-a6846b464846',
        currentProductionTitleAtForensics: 'MICROS STIRRED V1',
        matchedLocalFiles: Object.freeze(['MICROS_STIRRED_V1.mp4']),
        identityConfidence: /** @type {IdentityConfidence} */ ('EXACT'),
        identityEvidence: Object.freeze([
            'R2 ETag MD5 == local MD5',
            'Content-Length == byteSize (204661178)'
        ])
    }),
    Object.freeze({
        productionId: '9a1251a2-d6a6-42e5-9fcd-4eca17dcd6ef',
        currentProductionTitleAtForensics: 'MICROS Motherland V1(1)',
        matchedLocalFiles: Object.freeze([
            'MICROS_Motherland_V1(1).mp4',
            'MICROS_Motherland_V1.mp4'
        ]),
        identityConfidence: /** @type {IdentityConfidence} */ ('EXACT'),
        identityEvidence: Object.freeze([
            'R2 ETag MD5 == local MD5',
            'Content-Length == byteSize (76000493)',
            'local V1 and V1(1) byte-identical'
        ])
    }),
    Object.freeze({
        productionId: '3894107e-ae44-43c5-af72-b3f5d5e0ad90',
        currentProductionTitleAtForensics: 'condo v1 2',
        matchedLocalFiles: Object.freeze(['condo_v1_2.mp4', '06_CONDO_HIGH RISE_V1.mp4']),
        identityConfidence: /** @type {IdentityConfidence} */ ('EXACT'),
        identityEvidence: Object.freeze([
            'R2 ETag MD5 == local MD5',
            'Content-Length == byteSize (362155056)',
            'condo_v1_2 and 06_CONDO_HIGH RISE byte-identical'
        ])
    }),
    Object.freeze({
        productionId: '201ec6ee-6822-4bda-9295-080beb6f4e35',
        currentProductionTitleAtForensics: '07 AMP JAM V1',
        matchedLocalFiles: Object.freeze(['07_AMP_JAM_V1.mp4']),
        identityConfidence: /** @type {IdentityConfidence} */ ('EXACT'),
        identityEvidence: Object.freeze([
            'R2 ETag MD5 == local MD5',
            'Content-Length == byteSize (395703090)'
        ])
    })
]);

/** Episode-guide / Phase 3B provisional labels — NEVER treated as authoritative. */
export const PHASE4_PROVISIONAL_EPISODE_GUIDE = Object.freeze([
    Object.freeze({
        productionId: '03ef898a-989f-42c3-bdbb-67f37338df65',
        provisionalTitle: 'ARRIVAL',
        source: 'LA_Episode_Guide.pdf (context only)'
    }),
    Object.freeze({
        productionId: 'd2aafde7-d7ba-492c-a860-20b51f7f4033',
        provisionalTitle: 'POOM POOM TUESDAY',
        source: 'LA_Episode_Guide.pdf (context only)'
    }),
    Object.freeze({
        productionId: '615e0eae-47b4-468a-b6dd-a6846b464846',
        provisionalTitle: 'SOUNDSTAGE SHOOT: PART ONE',
        source: 'Phase 3B provisional mapping (not identity-proven to SET PT1)'
    }),
    Object.freeze({
        productionId: '9a1251a2-d6a6-42e5-9fcd-4eca17dcd6ef',
        provisionalTitle: 'SOUNDSTAGE SHOOT: PART TWO',
        source: 'Phase 3B provisional mapping (not identity-proven to SET PT2)'
    }),
    Object.freeze({
        productionId: '3894107e-ae44-43c5-af72-b3f5d5e0ad90',
        provisionalTitle: 'CONDO WIND DOWN',
        source: 'LA_Episode_Guide.pdf (context only)'
    }),
    Object.freeze({
        productionId: '201ec6ee-6822-4bda-9295-080beb6f4e35',
        provisionalTitle: 'MY SOCIETY + AMP',
        source: 'LA_Episode_Guide.pdf (context only)'
    })
]);

/**
 * @param {string} productionId
 */
export function getExactMediaIdentity(productionId) {
    const id = String(productionId || '').trim();
    return PHASE4_EXACT_MEDIA_IDENTITY.find((row) => row.productionId === id) || null;
}

/**
 * Resolve editorial metadata authority.
 * Filenames, local source names, episode-guide titles, and inferred mappings
 * are NEVER AUTHORITATIVE.
 *
 * @param {{
 *   productionId?: string;
 *   authoritativeTitle?: string;
 *   authoritativeDescription?: string;
 *   editorialAuthority?: string;
 *   provisionalTitle?: string;
 *   provisionalDescription?: string;
 * }} input
 * @returns {{
 *   status: EditorialMetadataStatus;
 *   workflowState: string;
 *   editorialTitle: string;
 *   editorialDescription: string;
 *   provisionalTitle: string;
 *   reason: string;
 * }}
 */
export function resolveEditorialMetadataStatus(input = {}) {
    const authority = String(input.editorialAuthority || '').trim().toLowerCase();
    const authTitle = String(input.authoritativeTitle || '').trim();
    const authDesc = String(input.authoritativeDescription || '').trim();

    if (authority === 'authoritative' && authTitle && authDesc) {
        return {
            status: 'AUTHORITATIVE',
            workflowState: 'READY_FOR_CREATOR_REVIEW',
            editorialTitle: authTitle,
            editorialDescription: authDesc,
            provisionalTitle: '',
            reason: 'Coworker/final authoritative title + description supplied'
        };
    }

    const provisional =
        String(input.provisionalTitle || '').trim() ||
        (PHASE4_PROVISIONAL_EPISODE_GUIDE.find(
            (p) => p.productionId === String(input.productionId || '').trim()
        )?.provisionalTitle || '');

    if (provisional || String(input.provisionalDescription || '').trim()) {
        return {
            status: 'PROVISIONAL',
            workflowState: 'WAITING_FOR_AUTHORITATIVE_METADATA',
            editorialTitle: '',
            editorialDescription: '',
            provisionalTitle: provisional,
            reason:
                'Episode-guide / inferred labels are provisional only — not production metadata'
        };
    }

    return {
        status: 'MISSING',
        workflowState: 'WAITING_FOR_AUTHORITATIVE_METADATA',
        editorialTitle: '',
        editorialDescription: '',
        provisionalTitle: '',
        reason: 'No authoritative editorial title/description supplied'
    };
}

/**
 * Whether creator Accept/Override/Manual may persist for this row.
 * @param {{ metadataStatus?: string; identityConfidence?: string; productionId?: string; isPlaceholder?: boolean }} row
 */
export function canEnableEditorialCategoryActions(row = {}) {
    if (String(row.metadataStatus || '') !== 'AUTHORITATIVE') return false;
    if (String(row.identityConfidence || '') !== 'EXACT') return false;
    const gate = canPersistCategoryForAsset({
        id: row.productionId,
        isPlaceholder: row.isPlaceholder
    });
    return gate.ok;
}

/**
 * Build one identity-backed review row. NLP runs only when AUTHORITATIVE.
 *
 * @param {{
 *   productionId: string;
 *   currentProductionTitle?: string;
 *   category?: string;
 *   authoritativeTitle?: string;
 *   authoritativeDescription?: string;
 *   editorialAuthority?: string;
 *   isPlaceholder?: boolean;
 * }} asset
 * @param {{ storage?: unknown }} [options]
 */
export async function buildIdentityBackedEditorialRow(asset, options = {}) {
    const productionId = String(asset?.productionId || asset?.id || '').trim();
    const identity = getExactMediaIdentity(productionId);
    const identityConfidence = identity?.identityConfidence || 'NO_MATCH';
    const matchedLocalFiles = identity?.matchedLocalFiles ? [...identity.matchedLocalFiles] : [];
    const identityEvidence = identity?.identityEvidence ? [...identity.identityEvidence] : [];

    const meta = resolveEditorialMetadataStatus({
        productionId,
        authoritativeTitle: asset?.authoritativeTitle,
        authoritativeDescription: asset?.authoritativeDescription,
        editorialAuthority: asset?.editorialAuthority
    });

    let currentCategory = String(asset?.category || 'Trending').trim() || 'Trending';
    let creatorLocked = false;
    try {
        const hydrated = hydrateCatalogItemWithCreatorMetadata(
            { id: productionId, category: currentCategory },
            options
        );
        if (hydrated.creatorCategory) {
            currentCategory = String(hydrated.creatorCategory);
            creatorLocked = String(hydrated.categorySource || '') === 'creator';
        }
    } catch {
        /* ignore */
    }

    /** @type {Record<string, unknown>} */
    const base = {
        productionId,
        currentProductionTitle:
            String(asset?.currentProductionTitle || asset?.title || '').trim() ||
            identity?.currentProductionTitleAtForensics ||
            '',
        matchedLocalFile: matchedLocalFiles[0] || '',
        matchedLocalFiles,
        identityConfidence,
        identityEvidence,
        editorialTitle: meta.editorialTitle,
        editorialDescription: meta.editorialDescription,
        provisionalTitle: meta.provisionalTitle,
        metadataStatus: meta.status,
        workflowState: meta.workflowState,
        metadataReason: meta.reason,
        currentCategory,
        creatorLocked,
        suggestedCategory: '',
        alternativeCategory: '',
        nlpConfidence: null,
        confidenceBand: '',
        ambiguous: false,
        signals: [],
        taxonomyFit: '',
        classificationState: '',
        shelfFitReason: '',
        nlpRan: false,
        actionsEnabled: false,
        actionsBlockedReason: ''
    };

    if (meta.status !== 'AUTHORITATIVE') {
        base.actionsBlockedReason = 'WAITING_FOR_AUTHORITATIVE_METADATA';
        return base;
    }

    // AUTHORITATIVE only — reuse existing review path (no second classifier).
    const review = await evaluateCategorySuggestionReview(
        {
            id: productionId,
            mediaAssetId: productionId,
            title: meta.editorialTitle,
            persistentTitle: meta.editorialTitle,
            creatorTitle: meta.editorialTitle,
            description: meta.editorialDescription,
            category: currentCategory,
            creatorCategory: creatorLocked ? currentCategory : undefined,
            categorySource: creatorLocked ? 'creator' : undefined
        },
        options
    );

    base.nlpRan = true;
    base.suggestedCategory = review.suggestedCategory || review.recommendedShelf || '';
    base.alternativeCategory = review.alternativeCategory || '';
    base.nlpConfidence = review.confidence;
    base.confidenceBand = review.confidenceBand || '';
    base.ambiguous = Boolean(review.ambiguous);
    base.signals = Array.isArray(review.signals) ? review.signals.map(String) : [];
    base.taxonomyFit = review.taxonomyFit || '';
    base.classificationState = review.classificationState || '';
    base.shelfFitReason = review.shelfFitReason || '';
    base.creatorLocked = Boolean(review.creatorLocked) || creatorLocked;
    base.currentCategory = review.currentCategory || currentCategory;
    base.actionsEnabled = canEnableEditorialCategoryActions({
        metadataStatus: meta.status,
        identityConfidence,
        productionId,
        isPlaceholder: asset?.isPlaceholder
    });
    if (!base.actionsEnabled) {
        base.actionsBlockedReason = base.creatorLocked
            ? 'CREATOR_LOCKED'
            : 'ACTIONS_BLOCKED';
    }
    if (base.creatorLocked) {
        // Explicit Accept of NLP remains blocked; Manual/Override intentional path still gated.
        base.actionsEnabled = canEnableEditorialCategoryActions({
            metadataStatus: meta.status,
            identityConfidence,
            productionId
        });
    }

    return base;
}

/**
 * Build rows for all six EXACT production identities.
 * @param {Record<string, { title?: string; category?: string; authoritativeTitle?: string; authoritativeDescription?: string; editorialAuthority?: string }>} [overridesById]
 * @param {{ storage?: unknown }} [options]
 */
export async function buildPhase4IdentityBackedReview(overridesById = {}, options = {}) {
    const rows = [];
    for (const identity of PHASE4_EXACT_MEDIA_IDENTITY) {
        const override = overridesById[identity.productionId] || {};
        rows.push(
            await buildIdentityBackedEditorialRow(
                {
                    productionId: identity.productionId,
                    currentProductionTitle:
                        override.title || identity.currentProductionTitleAtForensics,
                    category: override.category || 'Trending',
                    authoritativeTitle: override.authoritativeTitle,
                    authoritativeDescription: override.authoritativeDescription,
                    editorialAuthority: override.editorialAuthority
                },
                options
            )
        );
    }
    return {
        builtAt: new Date().toISOString(),
        readOnlyDefault: true,
        exactIdentityCount: PHASE4_EXACT_MEDIA_IDENTITY.length,
        waitingCount: rows.filter((r) => r.workflowState === 'WAITING_FOR_AUTHORITATIVE_METADATA')
            .length,
        authoritativeCount: rows.filter((r) => r.metadataStatus === 'AUTHORITATIVE').length,
        rows
    };
}

/**
 * Persist category only when identity EXACT + editorial AUTHORITATIVE + explicit action.
 *
 * @param {Record<string, unknown>} row
 * @param {{ action: 'accept'|'override'|'manual'; category: string; title?: string }} decision
 * @param {{ storage?: unknown; patchCategory?: boolean }} [options]
 */
export function applyIdentityBackedCategoryDecision(row, decision, options = {}) {
    if (!canEnableEditorialCategoryActions(row)) {
        return {
            ok: false,
            skipped: true,
            reason: row.actionsBlockedReason || 'WAITING_FOR_AUTHORITATIVE_METADATA'
        };
    }
    const action = String(decision?.action || '').trim();
    if (!['accept', 'override', 'manual'].includes(action)) {
        return { ok: false, skipped: true, reason: 'invalid-action' };
    }
    if (action === 'accept' && row.creatorLocked) {
        return { ok: false, skipped: true, reason: 'creator-lock' };
    }
    const category = String(decision.category || '').trim();
    if (!CREATOR_SHELF_OPTIONS.includes(category)) {
        return { ok: false, skipped: true, reason: 'invalid-category' };
    }
    const saved = persistCreatorCategoryChoice(
        String(row.productionId),
        {
            title: decision.title || row.editorialTitle,
            description: row.editorialDescription,
            category
        },
        {
            storage: options.storage,
            patchCategory: options.patchCategory === true, // default false in prep; caller opts in
            asset: { id: row.productionId }
        }
    );
    if (!saved) return { ok: false, skipped: true, reason: 'persist-failed' };
    return { ok: true, skipped: false, saved };
}

/**
 * Safety: identity evidence alone must never imply a title/category write.
 */
export function identityAloneMustNotPersist() {
    return {
        writesTitle: false,
        writesDescription: false,
        patchesCategory: false,
        inventsEditorialMetadata: false
    };
}
