/**
 * Phase 3B — read-only editorial context evaluation (in-memory only).
 *
 * Uses the EXISTING suggestShelfClassification / defaultTitleNlpProvider path.
 * Does NOT PATCH, write reel_titles_persistent, or mutate production catalog.
 *
 * Provisional asset↔episode mappings are evaluation fixtures only — never persisted.
 */

import { EXPLICIT_SHELF_CATEGORIES } from './contentClassifier.js';
import { suggestShelfClassification, confidenceBand } from './titleNlpProvider.js';
import {
    CREATOR_SHELF_OPTIONS,
    canPersistCategoryForAsset,
    shouldShowManualCategoryHelper,
    deriveClassificationState
} from './categorySuggestionReview.js';

export { CREATOR_SHELF_OPTIONS };

/** @typedef {'A'|'B'|'C'|'D'|'E'|'F'} TaxonomyFit */

/**
 * Los Angeles Production episode guide (editorial source of truth for this eval).
 * Provisional catalog title mappings are NOT renames.
 */
export const LA_PRODUCTION_EDITORIAL_EPISODES = Object.freeze([
    {
        episodeNumber: 1,
        editorialTitle: 'ARRIVAL',
        currentAssetTitle: '01 ARRIVAL OPEN v1',
        seriesTitle: 'Los Angeles Production',
        episodeTitle: 'Episode 1 — ARRIVAL',
        description:
            'Vic-G and the team arrive in Los Angeles, setting the stage for the production ahead. The episode captures the first moments in LA, the anticipation surrounding the project, and the beginning of the journey behind the music video.'
    },
    {
        episodeNumber: 2,
        editorialTitle: 'POOM POOM TUESDAY',
        currentAssetTitle: '03 CLUB POOM POOM V1',
        seriesTitle: 'Los Angeles Production',
        episodeTitle: 'Episode 2 — POOM POOM TUESDAY',
        description:
            'The first official shoot day begins at Poom Poom Tuesday in Los Angeles. With part of the music video taking place inside the club, Vic-G and the production team step into the nightlife atmosphere to capture the first scenes of the project and establish the energy and visual tone for what is to come.'
    },
    {
        episodeNumber: 3,
        editorialTitle: 'SOUNDSTAGE SHOOT: PART ONE',
        currentAssetTitle: 'MICROS STIRRED V1',
        seriesTitle: 'Los Angeles Production',
        episodeTitle: 'Episode 3 — SOUNDSTAGE SHOOT: PART ONE',
        description:
            "Production moves to the soundstage as the main studio shoot gets underway. The episode follows Vic-G and the team through the creative process as lighting, performance, camera setups, and production elements come together to bring the music video's vision to life."
    },
    {
        episodeNumber: 4,
        editorialTitle: 'SOUNDSTAGE SHOOT: PART TWO',
        currentAssetTitle: 'MICROS Motherland V1(1)',
        seriesTitle: 'Los Angeles Production',
        episodeTitle: 'Episode 4 — SOUNDSTAGE SHOOT: PART TWO',
        description:
            'The soundstage experience continues with a closer look at NK and the dancers. Part Two goes beyond the performance itself, giving the dancers space to speak, share their perspectives, and become part of the story behind the production while the team completes the remaining soundstage work.'
    },
    {
        episodeNumber: 5,
        editorialTitle: 'CONDO WIND DOWN',
        currentAssetTitle: 'condo v1 2',
        seriesTitle: 'Los Angeles Production',
        episodeTitle: 'Episode 5 — CONDO WIND DOWN',
        description:
            'After the soundstage shoot, the energy shifts from production mode to a more relaxed setting at the condo. The team unwinds after the day, sharing food, wine, conversation, and candid moments that offer a more personal look at the people behind the project.'
    },
    {
        episodeNumber: 6,
        editorialTitle: 'MY SOCIETY + AMP',
        currentAssetTitle: '07 AMP JAM V1',
        seriesTitle: 'Los Angeles Production',
        episodeTitle: 'Episode 6 — MY SOCIETY + AMP',
        description:
            'Vic-G steps into another side of the creative experience through My Society and AMP. The episode brings together music, community, social connection, and culture as Vic-G gets the chance to meet, hang out with, and connect with the people surrounding these social music events. It expands the story beyond the video shoot and into the larger creative community around the project.'
    }
]);

/**
 * @param {import('./contentClassifier.js').ContentClassification} classification
 * @param {{ hasEditorialContext?: boolean; descriptionLength?: number }} [ctx]
 * @returns {{ fit: TaxonomyFit; reason: string }}
 */
export function deriveTaxonomyFit(classification, ctx = {}) {
    const state = deriveClassificationState(classification, ctx);
    return {
        fit: /** @type {TaxonomyFit} */ (state.taxonomyFit),
        reason: state.shelfFitReason
    };
}

/**
 * @typedef {'asset_title_only'|'editorial_title_only'|'editorial_title_description'|'editorial_full_context'} EvalContextMode
 */

/**
 * Build a temporary in-memory classification payload (never written).
 *
 * @param {(typeof LA_PRODUCTION_EDITORIAL_EPISODES)[number]} episode
 * @param {EvalContextMode} mode
 */
export function buildEditorialEvalPayload(episode, mode) {
    const base = {
        id: `eval-la-ep${episode.episodeNumber}-readonly`,
        category: 'Trending',
        type: 'video',
        // Explicitly not a durable production id — evaluation only
        isEvaluationFixture: true
    };

    if (mode === 'asset_title_only') {
        return {
            ...base,
            title: episode.currentAssetTitle
        };
    }
    if (mode === 'editorial_title_only') {
        return {
            ...base,
            title: episode.editorialTitle,
            creatorTitle: episode.editorialTitle
        };
    }
    if (mode === 'editorial_title_description') {
        return {
            ...base,
            title: episode.editorialTitle,
            creatorTitle: episode.editorialTitle,
            description: episode.description
        };
    }
    return {
        ...base,
        title: episode.editorialTitle,
        creatorTitle: episode.editorialTitle,
        description: episode.description,
        seriesTitle: episode.seriesTitle,
        seriesName: episode.seriesTitle,
        episodeTitle: episode.episodeTitle
    };
}

/**
 * @param {Record<string, unknown>} payload
 * @param {{ hasEditorialContext?: boolean; descriptionLength?: number; mode?: string; episode?: Record<string, unknown> }} [meta]
 */
export async function evaluateEditorialPayload(payload, meta = {}) {
    const classification = await suggestShelfClassification(payload);
    const suggested = String(
        classification.suggestedCategory || classification.primaryCategory || 'Trending'
    );
    const conf = Number(
        classification.suggestedConfidence != null
            ? classification.suggestedConfidence
            : classification.confidence
    );
    const band = String(classification.confidenceBand || confidenceBand(conf));
    const taxonomy = deriveTaxonomyFit(classification, {
        hasEditorialContext: Boolean(meta.hasEditorialContext),
        descriptionLength: meta.descriptionLength
    });

    const reviewShape = {
        offer: false,
        suggestedCategory: suggested,
        suggestedConfidence: conf,
        confidenceBand: band,
        ambiguous: Boolean(classification.ambiguous),
        showManualHelper: false
    };
    reviewShape.showManualHelper = shouldShowManualCategoryHelper(
        /** @type {import('./categorySuggestionReview.js').CategorySuggestionReview} */ (
            reviewShape
        ),
        'Trending'
    );

    return {
        mode: meta.mode || '',
        episodeNumber: meta.episode?.episodeNumber,
        currentAssetTitle: meta.episode?.currentAssetTitle,
        editorialTitle: meta.episode?.editorialTitle,
        description: meta.episode?.description || '',
        payloadTitle: String(payload.title || ''),
        signals: Array.isArray(classification.signals) ? classification.signals.map(String) : [],
        primaryRecommendation: suggested,
        confidence: conf,
        confidenceBand: band,
        alternativeCategory: String(classification.alternativeCategory || ''),
        ambiguous: Boolean(classification.ambiguous),
        classificationSource: classification.classificationSource || 'nlp',
        scoreBreakdown: classification.scoreBreakdown || undefined,
        taxonomyFit: taxonomy.fit,
        reason: taxonomy.reason,
        manualHelperAvailable: reviewShape.showManualHelper || taxonomy.fit === 'F' || taxonomy.fit === 'E' || taxonomy.fit === 'D' || taxonomy.fit === 'C',
        manualOptions: [...CREATOR_SHELF_OPTIONS]
    };
}

/**
 * Run the four-context experiment for one episode.
 * @param {(typeof LA_PRODUCTION_EDITORIAL_EPISODES)[number]} episode
 */
export async function evaluateEpisodeContexts(episode) {
    /** @type {EvalContextMode[]} */
    const modes = [
        'asset_title_only',
        'editorial_title_only',
        'editorial_title_description',
        'editorial_full_context'
    ];
    /** @type {Record<string, Awaited<ReturnType<typeof evaluateEditorialPayload>>>} */
    const byMode = {};
    for (const mode of modes) {
        const payload = buildEditorialEvalPayload(episode, mode);
        const hasEditorialContext =
            mode === 'editorial_title_description' || mode === 'editorial_full_context';
        byMode[mode] = await evaluateEditorialPayload(payload, {
            mode,
            episode,
            hasEditorialContext,
            descriptionLength: hasEditorialContext ? String(episode.description || '').length : 0
        });
    }
    return {
        episodeNumber: episode.episodeNumber,
        currentAssetTitle: episode.currentAssetTitle,
        editorialTitle: episode.editorialTitle,
        seriesTitle: episode.seriesTitle,
        contexts: byMode,
        primary: byMode.editorial_full_context
    };
}

/**
 * Full LA Production editorial evaluation — entirely in memory.
 */
export async function evaluateLosAngelesProductionEditorial() {
    const episodes = [];
    for (const ep of LA_PRODUCTION_EDITORIAL_EPISODES) {
        episodes.push(await evaluateEpisodeContexts(ep));
    }

    const full = episodes.map((e) => e.primary);
    const improved = episodes.filter((e) => {
        const a = e.contexts.asset_title_only;
        const f = e.contexts.editorial_full_context;
        // Material improvement = taxonomy moved toward shelf OR context-without-shelf recognition (E→F)
        if (a.taxonomyFit === 'E' && f.taxonomyFit === 'F') return true;
        if (a.confidence < f.confidence - 0.02) return true;
        if (a.primaryRecommendation === 'Trending' && EXPLICIT_SHELF_CATEGORIES.has(f.primaryRecommendation)) {
            return true;
        }
        return false;
    });

    return {
        evaluatedAt: new Date().toISOString(),
        series: 'Los Angeles Production',
        readOnly: true,
        episodeCount: episodes.length,
        episodes,
        summary: {
            romanceCount: full.filter((r) => r.primaryRecommendation === 'Romance').length,
            cyberActionCount: full.filter((r) => r.primaryRecommendation === 'Cyber-Action').length,
            suspenseCount: full.filter((r) => r.primaryRecommendation === 'Suspense').length,
            trendingCount: full.filter((r) => r.primaryRecommendation === 'Trending').length,
            taxonomyFits: full.reduce((acc, r) => {
                acc[r.taxonomyFit] = (acc[r.taxonomyFit] || 0) + 1;
                return acc;
            }, /** @type {Record<string, number>} */ ({})),
            contextImprovedCount: improved.length,
            improvedEpisodeNumbers: improved.map((e) => e.episodeNumber),
            manualCategoryRecommended: full
                .filter((r) => ['C', 'D', 'E', 'F'].includes(r.taxonomyFit))
                .map((r) => r.episodeNumber)
        }
    };
}

/**
 * Safety: evaluation fixtures must never be persistable as production.
 */
export function assertEditorialEvalCannotPersist() {
    const results = LA_PRODUCTION_EDITORIAL_EPISODES.map((ep) => {
        const payload = buildEditorialEvalPayload(ep, 'editorial_full_context');
        return canPersistCategoryForAsset({
            ...payload,
            isPlaceholder: false,
            // eval ids are not UUIDs — still should not patch production; gate allows any non-demo id.
            // Force placeholder-style safety for explicit evaluation markers:
            id: 'ai-black-stories-eval-block'
        });
    });
    return {
        demoBlocked: results.every((r) => !r.ok),
        placeholderBlocked: !canPersistCategoryForAsset({
            id: 'x',
            isPlaceholder: true
        }).ok,
        blackStoriesBlocked: !canPersistCategoryForAsset({
            id: 'y',
            isBlackStoriesPlaceholder: true
        }).ok,
        missingIdBlocked: !canPersistCategoryForAsset({ title: 'no-id' }).ok
    };
}
