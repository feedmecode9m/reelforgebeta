/**
 * Identity Language Resolver
 *
 * Separates historical / admin terminology from public viewer language.
 *
 * Rules:
 * - Never silently replace identity terms.
 * - Return suggested language only.
 * - Master Hero Admin approval required before public display.
 *
 * @see ./contentIdentityGuard.js
 * @see ../hero/heroIntelligenceExplanation.js
 * @see ../architecture/creatorTruthLayers.js
 */

/** Terms that may appear in admin / historical records but need care in public copy. */
export const HISTORICAL_ADMIN_TERMS = Object.freeze([
    'negro',
    'colored',
    'afro-american',
    'afro american',
    'minority farmer',
    'underserved demographic'
]);

/**
 * Optional known suggestions (never auto-applied).
 * Key = normalized historical/admin phrase.
 * @type {Readonly<Record<string, string>>}
 */
export const SUGGESTED_PUBLIC_LANGUAGE = Object.freeze({
    negro: 'Black',
    colored: 'Black',
    'afro-american': 'African American',
    'afro american': 'African American',
    'minority farmer': 'farmers of color',
    'underserved demographic': 'underrepresented community'
});

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeKey(value) {
    return text(value)
        .toLowerCase()
        .replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @typedef {Object} IdentityLanguageSuggestion
 * @property {string} originalTerm
 * @property {string} suggestedTerm
 * @property {boolean} requiresApproval
 * @property {false} applied
 * @property {string} context  admin | historical | proposed
 */

/**
 * @typedef {Object} IdentityLanguageResolution
 * @property {IdentityLanguageSuggestion[]} suggestions
 * @property {string[]} preservedTerms  never mutated originals
 * @property {boolean} applied  always false — never silent replace
 * @property {boolean} requiresMasterHeroAdminApproval
 * @property {string[]} errors
 */

/**
 * Build suggestions only — never mutates creator / public identity fields.
 *
 * @param {{
 *   adminTerms?: string[] | string;
 *   historicalTerms?: string[] | string;
 *   creatorIdentityTerms?: string[] | string;
 *   proposedPublicPhrases?: string[] | string;
 *   allowSilentReplace?: boolean;
 * }} [input]
 * @returns {IdentityLanguageResolution}
 */
export function resolveIdentityLanguageSuggestions(input = {}) {
    /** @type {string[]} */
    const errors = [];

    // Explicitly reject any attempt to silent-replace
    if (input.allowSilentReplace === true) {
        errors.push('silent_identity_replace_forbidden');
    }

    /** @type {IdentityLanguageSuggestion[]} */
    const suggestions = [];
    /** @type {string[]} */
    const preservedTerms = [];

    /**
     * @param {unknown} value
     * @returns {string[]}
     */
    function asList(value) {
        if (Array.isArray(value)) return value.map((v) => text(v)).filter(Boolean);
        const s = text(value);
        return s ? [s] : [];
    }

    /**
     * @param {string} original
     * @param {'admin' | 'historical' | 'proposed'} context
     */
    function consider(original, context) {
        const raw = text(original);
        if (!raw) return;
        preservedTerms.push(raw);

        const key = normalizeKey(raw);
        const known = SUGGESTED_PUBLIC_LANGUAGE[key];
        if (known && known.toLowerCase() !== key) {
            suggestions.push({
                originalTerm: raw,
                suggestedTerm: known,
                requiresApproval: true,
                applied: false,
                context
            });
            return;
        }

        // Historical catalog hits even without a hardcoded mapping
        if (
            context === 'historical' ||
            HISTORICAL_ADMIN_TERMS.some((t) => key.includes(normalizeKey(t)))
        ) {
            suggestions.push({
                originalTerm: raw,
                suggestedTerm: '', // admin must author
                requiresApproval: true,
                applied: false,
                context
            });
        }
    }

    for (const term of asList(input.adminTerms)) consider(term, 'admin');
    for (const term of asList(input.historicalTerms)) consider(term, 'historical');
    for (const term of asList(input.creatorIdentityTerms)) {
        // Creator identity is authoritative — preserve only, never suggest replacement as truth
        preservedTerms.push(text(term));
    }
    for (const phrase of asList(input.proposedPublicPhrases)) {
        // Proposed viewer phrases still require admin approval path (never auto)
        suggestions.push({
            originalTerm: '',
            suggestedTerm: text(phrase),
            requiresApproval: true,
            applied: false,
            context: 'proposed'
        });
    }

    return {
        suggestions,
        preservedTerms: Array.from(new Set(preservedTerms.filter(Boolean))),
        applied: false,
        requiresMasterHeroAdminApproval: suggestions.length > 0,
        errors
    };
}

/**
 * Single-term helper — suggestion only.
 *
 * @param {string} historicalOrAdminTerm
 * @param {{ proposed?: string }} [options]
 * @returns {{
 *   originalTerm: string;
 *   suggestedTerm: string;
 *   requiresApproval: true;
 *   applied: false;
 *   publicDisplayTerm: string;  always the original until approved elsewhere
 * }}
 */
export function suggestPublicIdentityLanguage(historicalOrAdminTerm, options = {}) {
    const original = text(historicalOrAdminTerm);
    const key = normalizeKey(original);
    const mapped = SUGGESTED_PUBLIC_LANGUAGE[key] || text(options.proposed);
    return {
        originalTerm: original,
        suggestedTerm: mapped,
        requiresApproval: true,
        applied: false,
        // Never silent replace: public display stays original until Master Hero Admin acts.
        publicDisplayTerm: original
    };
}

/**
 * Apply a proposed public phrase to creator identity — always blocked.
 * (Approval path for *explanations* is heroIntelligenceExplanation, not identity mutation.)
 *
 * @param {string} originalTerm
 * @param {string} suggestedTerm
 * @param {{ approved?: boolean; approvedBy?: string }} [meta]
 */
export function applySuggestedIdentityLanguage(originalTerm, suggestedTerm, meta = {}) {
    void originalTerm;
    void suggestedTerm;
    void meta;
    return {
        ok: false,
        applied: false,
        errors: ['identity_language_cannot_auto_apply', 'requires_master_hero_admin_and_creator_path'],
        value: text(originalTerm)
    };
}

/**
 * Detect if a candidate public string silently replaced a protected creator identity term.
 *
 * @param {string} creatorText
 * @param {string} candidatePublicText
 * @param {string[]} [identityTerms]
 */
export function detectSilentIdentityReplacement(creatorText, candidatePublicText, identityTerms = []) {
    const creator = text(creatorText);
    const candidate = text(candidatePublicText);
    const terms = Array.isArray(identityTerms)
        ? identityTerms.map((t) => text(t)).filter(Boolean)
        : [];

    /** @type {string[]} */
    const dropped = [];
    for (const term of terms) {
        const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (re.test(creator) && !re.test(candidate) && candidate.length > 0) {
            dropped.push(term);
        }
    }

    return {
        silentReplaceDetected: dropped.length > 0,
        droppedTerms: dropped,
        // Caller must keep creator text
        safePublicText: creator
    };
}

/**
 * Discovery label → identity term promotion is forbidden.
 * @param {string} discoveryLabel
 */
export function discoveryLabelAsIdentity(discoveryLabel) {
    return {
        ok: false,
        label: text(discoveryLabel),
        reason: 'discovery_cannot_become_identity',
        identityTerm: null
    };
}
