/**
 * Provenance + write guards for Creator Truth vs Intelligence Interpretation.
 *
 * Rule: "AI explains creator content. AI does not become the creator of content."
 *
 * @see ./creatorTruthLayers.js
 * @see ../intelligence/contentIdentityGuard.js
 */

/** @typedef {'creator' | 'vault' | 'binding' | 'ai' | 'discovery' | 'demo' | 'system'} ProvenanceSourceType */

/** Field origin taxonomy for displays / audits */
export const PROVENANCE_SOURCE_TYPES = Object.freeze({
    CREATOR: 'creator',
    VAULT: 'vault',
    BINDING: 'binding',
    AI: 'ai',
    DISCOVERY: 'discovery',
    DEMO: 'demo',
    SYSTEM: 'system'
});

/** Sources allowed to author public catalog-facing metadata */
export const TRUTH_PROVENANCE_SOURCES = Object.freeze([
    PROVENANCE_SOURCE_TYPES.CREATOR,
    PROVENANCE_SOURCE_TYPES.VAULT,
    PROVENANCE_SOURCE_TYPES.BINDING
]);

/** Sources that may only propose / explain (never silent public truth) */
export const INTERPRETATION_PROVENANCE_SOURCES = Object.freeze([
    PROVENANCE_SOURCE_TYPES.AI,
    PROVENANCE_SOURCE_TYPES.DISCOVERY
]);

/**
 * Public/series fields intelligence must not auto-write.
 * Binding keys (seriesId, episodeId) are structural, not creative prose.
 */
export const CREATOR_TRUTH_PROSE_FIELDS = Object.freeze([
    'title',
    'episodeTitle',
    'seriesName',
    'description',
    'genre',
    'runtime',
    'releaseYear'
]);

/**
 * Resolve write provenance. Fail-closed: empty / unknown → system (cannot author prose).
 * Only explicit truth tokens become creator | vault | binding.
 *
 * @param {unknown} raw
 * @returns {ProvenanceSourceType}
 */
export function normalizeProvenanceSource(raw) {
    const s = String(raw ?? '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_');
    // Fail closed: missing / unknown never elevates to creator.
    if (!s || s === 'unknown' || s === 'none' || s === 'null' || s === 'undefined') {
        return PROVENANCE_SOURCE_TYPES.SYSTEM;
    }
    if (s === 'creator' || s === 'studio' || s === 'user' || s === 'manual') {
        return PROVENANCE_SOURCE_TYPES.CREATOR;
    }
    if (s === 'vault' || s === 'upload' || s === 'asset' || s === 'hero_vault') {
        return PROVENANCE_SOURCE_TYPES.VAULT;
    }
    if (s === 'binding' || s === 'bind' || s === 'episode_bind' || s === 'catalog_bind') {
        return PROVENANCE_SOURCE_TYPES.BINDING;
    }
    if (
        s === 'ai' ||
        s === 'nlp' ||
        s === 'nlp_inference' ||
        s === 'ai_suggestion' ||
        s === 'assistant' ||
        s === 'copilot' ||
        s === 'repair_synthetic' ||
        s === 'generated'
    ) {
        return PROVENANCE_SOURCE_TYPES.AI;
    }
    if (
        s === 'discovery' ||
        s === 'classifier' ||
        s === 'category_detector' ||
        s === 'shelf' ||
        s === 'recommendation'
    ) {
        return PROVENANCE_SOURCE_TYPES.DISCOVERY;
    }
    if (s === 'demo' || s === 'fixture' || s === 'mock') {
        return PROVENANCE_SOURCE_TYPES.DEMO;
    }
    if (s === 'system' || s === 'runtime' || s === 'sync') {
        return PROVENANCE_SOURCE_TYPES.SYSTEM;
    }
    // Unrecognized token → system (fail closed; not creator, not ai alias)
    return PROVENANCE_SOURCE_TYPES.SYSTEM;
}

/**
 * True only for explicit truth tokens (never for empty / unknown / system).
 * @param {unknown} raw
 */
export function isExplicitTruthSourceToken(raw) {
    const s = String(raw ?? '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_');
    return (
        s === 'creator' ||
        s === 'studio' ||
        s === 'user' ||
        s === 'manual' ||
        s === 'vault' ||
        s === 'upload' ||
        s === 'asset' ||
        s === 'hero_vault' ||
        s === 'binding' ||
        s === 'bind' ||
        s === 'episode_bind' ||
        s === 'catalog_bind'
    );
}

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isTruthProvenanceSource(raw) {
    const s = normalizeProvenanceSource(raw);
    return TRUTH_PROVENANCE_SOURCES.includes(s);
}

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isInterpretationProvenanceSource(raw) {
    const s = normalizeProvenanceSource(raw);
    return INTERPRETATION_PROVENANCE_SOURCES.includes(s) || s === PROVENANCE_SOURCE_TYPES.DEMO;
}

/**
 * @param {string} field
 * @param {unknown} value
 * @param {unknown} sourceType
 */
export function buildProvenanceRecord(field, value, sourceType) {
    const source = normalizeProvenanceSource(sourceType);
    return {
        field: String(field || ''),
        value: value == null ? null : value,
        sourceType: source,
        isTruth: TRUTH_PROVENANCE_SOURCES.includes(source),
        isInterpretation: isInterpretationProvenanceSource(source),
        label: provenanceLabel(source),
        ts: Date.now()
    };
}

/**
 * @param {unknown} sourceType
 * @returns {string}
 */
export function provenanceLabel(sourceType) {
    const s = normalizeProvenanceSource(sourceType);
    switch (s) {
        case PROVENANCE_SOURCE_TYPES.CREATOR:
            return 'Creator';
        case PROVENANCE_SOURCE_TYPES.VAULT:
            return 'Hero Vault';
        case PROVENANCE_SOURCE_TYPES.BINDING:
            return 'Explicit binding';
        case PROVENANCE_SOURCE_TYPES.AI:
            return 'AI suggestion';
        case PROVENANCE_SOURCE_TYPES.DISCOVERY:
            return 'Discovery classification';
        case PROVENANCE_SOURCE_TYPES.DEMO:
            return 'Demo fixture';
        default:
            return 'System';
    }
}

/**
 * Viewer/creator-safe explanation (never presented as official genre/series).
 * @param {string} themeOrSignal
 * @param {{ fromTitle?: boolean }} [opts]
 */
export function formatIntelligenceExplanation(themeOrSignal, opts = {}) {
    const theme = String(themeOrSignal || '').trim();
    if (!theme) return '';
    if (opts.fromTitle) {
        return `Suggested theme detected from your uploaded title: ${theme}`;
    }
    return `Suggested insight (not official catalog metadata): ${theme}`;
}

/**
 * Public/studio genre display. Only truth sources may render as official "Genre".
 * @param {unknown} genreField
 * @param {unknown} [sourceType]
 * @returns {{ display: string; explanation: string; official: boolean }}
 */
export function resolvePublicGenreDisplay(genreField, sourceType = PROVENANCE_SOURCE_TYPES.CREATOR) {
    const genre = String(genreField || '').trim();
    // Display helper: only treat as official when caller explicitly claims a truth source.
    const explicitTruth = isExplicitTruthSourceToken(sourceType);
    const source = normalizeProvenanceSource(sourceType);
    if (!genre) {
        return { display: '', explanation: '', official: false };
    }
    if (!explicitTruth || !isTruthProvenanceSource(source)) {
        return {
            display: '',
            explanation: formatIntelligenceExplanation(genre, {
                fromTitle: source === PROVENANCE_SOURCE_TYPES.DISCOVERY
            }),
            official: false
        };
    }
    return { display: genre, explanation: '', official: true };
}

/**
 * Strip prose metadata when the write source is interpretation / demo.
 * Structural bind fields (seriesId, episodeId, status codes) pass through.
 *
 * @param {Record<string, unknown> | null | undefined} patch
 * @param {{ sourceType?: unknown; allowProseFromVault?: boolean }} [options]
 * @returns {{
 *   patch: Record<string, unknown>;
 *   blockedFields: string[];
 *   sourceType: ProvenanceSourceType;
 *   allowed: boolean;
 * }}
 */
export function sanitizeCreatorTruthMetadataWrite(patch, options = {}) {
    // Explicit options only — do not re-interpret missing as creator.
    const rawSource = options.sourceType;
    const sourceType = normalizeProvenanceSource(
        rawSource === undefined || rawSource === null || rawSource === ''
            ? PROVENANCE_SOURCE_TYPES.SYSTEM
            : rawSource
    );
    /** @type {Record<string, unknown>} */
    const next = patch && typeof patch === 'object' ? { ...patch } : {};
    delete next.provenanceSource;
    delete next.sourceType;
    // Intelligence proposal side-channels — never become official genre/title via this guard.
    // (suggestedGenre / intelligenceExplanation may persist for UI approval flows.)

    /** @type {string[]} */
    const blockedFields = [];

    // Only creator | vault | binding may author prose. system / ai / discovery / demo cannot.
    const allowProse = isTruthProvenanceSource(sourceType);

    if (!allowProse) {
        for (const field of CREATOR_TRUTH_PROSE_FIELDS) {
            if (field in next && next[field] !== undefined) {
                blockedFields.push(field);
                delete next[field];
            }
        }
    }

    return {
        patch: next,
        blockedFields: [...new Set(blockedFields)],
        sourceType,
        allowed: blockedFields.length === 0 || Object.keys(next).length > 0
    };
}

/**
 * Guard entry used by seriesStore / repair / sync.
 * Logs blocked attempts; returns sanitized patch.
 *
 * @param {Record<string, unknown> | null | undefined} patch
 * @param {{ sourceType?: unknown; context?: string }} [options]
 */
export function guardIntelligenceMetadataWrite(patch, options = {}) {
    const result = sanitizeCreatorTruthMetadataWrite(patch, options);
    if (result.blockedFields.length) {
        console.info('[INTELLIGENCE_PROVENANCE_GUARD]', {
            phase: 'blocked-prose-write',
            sourceType: result.sourceType,
            blockedFields: result.blockedFields,
            context: options.context || null,
            ts: new Date().toISOString()
        });
    }
    return result;
}
