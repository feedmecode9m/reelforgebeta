/**
 * ReelForge layered architecture (Creator Truth + Intelligence Interpretation).
 *
 * ┌────────────────────────────────────────────────────────────┐
 * │ 1. CREATOR TRUTH LAYER (authoritative)                     │
 * │                                                            │
 * │   Hero Vault upload                                        │
 * │     → Asset metadata normalization                         │
 * │     → Creator title edits                                  │
 * │     → Explicit episode bindings                            │
 * │     → seriesCatalog                                        │
 * │     → Public Series pages                                  │
 * │     → Theater playback resolution                          │
 * │                                                            │
 * │ Rule: No public content exists unless it originates from   │
 * │ creator uploads, metadata edits, explicit bindings, or     │
 * │ stored creator records. Empty/missing is valid.            │
 * └────────────────────────────────────────────────────────────┘
 *
 * ┌────────────────────────────────────────────────────────────┐
 * │ 2. INTELLIGENCE INTERPRETATION LAYER (non-authoritative)   │
 * │                                                            │
 * │   AI/NLP may: analyze titles, extract themes, suggest      │
 * │   organization, summarize, recommend paths, explain        │
 * │   context, assist creators with metadata proposals.        │
 * │                                                            │
 * │   AI/NLP must NOT: create series identity, invent episode  │
 * │   names/seasons, assign fake marketing descriptions,       │
 * │   replace missing creator metadata, or populate public     │
 * │   catalogs as truth.                                       │
 * └────────────────────────────────────────────────────────────┘
 *
 * ┌────────────────────────────────────────────────────────────┐
 * │ 3. DISCOVERY LAYER (ranking / grouping only)               │
 * │                                                            │
 * │   Classifiers may group similar content, suggest shelves,  │
 * │   improve search, and personalize recommendations.         │
 * │                                                            │
 * │   They must NOT become Series truth, create public episode │
 * │   structures, or override creator bindings.                │
 * └────────────────────────────────────────────────────────────┘
 *
 * ┌────────────────────────────────────────────────────────────┐
 * │ 4. DEMO / TEST LAYER (explicit opt-in only)                │
 * │                                                            │
 * │   mockSeriesData + resetSeriesCatalogToMock() under        │
 * │   allowDemoCatalogSession. Never production catalog seed.  │
 * └────────────────────────────────────────────────────────────┘
 *
 * Preferred parallel flow:
 *
 *   Creator Catalog Truth → AI/NLP Interpretation →
 *     Viewer explanation / recommendations / assistance
 *
 * The AI layer is a guide, not the author of content.
 *
 * @see ../series/seriesCatalogTruth.js
 * @see ../intelligence/contentIdentityGuard.js
 * @see ../series/seriesStore.js
 */

/** Layer ids for diagnostics / validation */
export const ARCHITECTURE_LAYERS = Object.freeze({
    CREATOR_TRUTH: 'creator_truth',
    INTELLIGENCE: 'intelligence_interpretation',
    DISCOVERY: 'discovery',
    DEMO: 'demo_test'
});

/**
 * Soft fields that intelligence may *propose* without becoming public truth until creator accept.
 * Mirror of contentIdentityGuard.ENRICHABLE_FIELDS intent for cross-module docs.
 */
export const INTELLIGENCE_PROPOSAL_FIELDS = Object.freeze([
    'suggestedDescription',
    'suggestedSubtitle',
    'keywords',
    'mood',
    'discoveryTags',
    'audienceSignal'
]);

export {
    PROVENANCE_SOURCE_TYPES,
    TRUTH_PROVENANCE_SOURCES,
    INTERPRETATION_PROVENANCE_SOURCES,
    CREATOR_TRUTH_PROSE_FIELDS,
    normalizeProvenanceSource,
    isTruthProvenanceSource,
    isInterpretationProvenanceSource,
    buildProvenanceRecord,
    provenanceLabel,
    formatIntelligenceExplanation,
    resolvePublicGenreDisplay,
    sanitizeCreatorTruthMetadataWrite,
    guardIntelligenceMetadataWrite
} from './intelligenceProvenance.js';