/**
 * Hero Intelligence Explanation Layer
 *
 * NLP may explain creator content. NLP does not become creator truth.
 *
 * Public surface requires approval metadata:
 *   intelligenceExplanation { source, approved, approvedBy, approvedAt, statements[] }
 *
 * Forbidden for NLP / AI writes:
 *   title, description, genre, identity, cultural region, creatorTruth
 *
 * @see ./heroPresentationAuthority.js
 * @see ./heroRecord.js
 * @see ../intelligence/identityLanguageResolver.js
 */

import { PROVENANCE_SOURCE_TYPES } from '../architecture/intelligenceProvenance.js';

/** Sources allowed to *generate* explanations (never silent public identity). */
export const INTELLIGENCE_EXPLANATION_SOURCES = Object.freeze({
    NLP: 'nlp',
    AI: 'ai',
    ADMIN: 'admin',
    SYSTEM: 'system'
});

/** Fields NLP must never write under the guise of explanation. */
export const NLP_FORBIDDEN_CREATOR_FIELDS = Object.freeze([
    'title',
    'description',
    'genre',
    'identity',
    'identityTerms',
    'culturalRegion',
    'communityRepresented',
    'creatorName',
    'heroIdentity',
    'creatorTruth',
    'publicTitle',
    'publicDescription',
    'publicTheme',
    'heroTitle',
    'heroDescription'
]);

/**
 * @typedef {Object} IntelligenceExplanationBlock
 * @property {string} source  nlp | ai | admin | system
 * @property {boolean} approved
 * @property {string} approvedBy
 * @property {number | null} approvedAt
 * @property {string[]} statements
 * @property {boolean} [hidden]
 * @property {false} authoritative
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
function listStatements(value) {
    if (Array.isArray(value)) {
        return value.map((s) => text(s)).filter(Boolean);
    }
    const single = text(value);
    return single ? [single] : [];
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeExplanationSource(raw) {
    const s = text(raw).toLowerCase().replace(/-/g, '_');
    if (s === 'nlp' || s === 'nlp_inference') return INTELLIGENCE_EXPLANATION_SOURCES.NLP;
    if (s === 'ai' || s === 'ai_suggestion' || s === 'assistant' || s === 'copilot') {
        return INTELLIGENCE_EXPLANATION_SOURCES.AI;
    }
    if (s === 'admin' || s === 'master_hero_admin' || s === 'editorial' || s === 'human') {
        return INTELLIGENCE_EXPLANATION_SOURCES.ADMIN;
    }
    if (s === 'system' || s === 'runtime') return INTELLIGENCE_EXPLANATION_SOURCES.SYSTEM;
    if (!s) return INTELLIGENCE_EXPLANATION_SOURCES.SYSTEM;
    return INTELLIGENCE_EXPLANATION_SOURCES.SYSTEM;
}

/**
 * Empty unapproved explanation (safe default).
 * @returns {IntelligenceExplanationBlock}
 */
export function createEmptyIntelligenceExplanation() {
    return {
        source: INTELLIGENCE_EXPLANATION_SOURCES.SYSTEM,
        approved: false,
        approvedBy: '',
        approvedAt: null,
        statements: [],
        hidden: false,
        authoritative: false
    };
}

/**
 * Normalize storage shape without granting public approval.
 * @param {unknown} raw
 * @returns {IntelligenceExplanationBlock}
 */
export function normalizeIntelligenceExplanation(raw) {
    if (!raw || typeof raw !== 'object') {
        return createEmptyIntelligenceExplanation();
    }
    const row = /** @type {Record<string, unknown>} */ (raw);
    // Legacy: lines[] was the old viewer-only shape
    const statements = listStatements(row.statements ?? row.lines);
    const approved = row.approved === true;
    const approvedBy = text(row.approvedBy);
    const approvedAtRaw = Number(row.approvedAt);
    const approvedAt =
        approved && Number.isFinite(approvedAtRaw) && approvedAtRaw > 0 ? approvedAtRaw : null;

    return {
        source: normalizeExplanationSource(row.source),
        approved: approved && Boolean(approvedBy) && Boolean(approvedAt),
        approvedBy: approved && approvedBy ? approvedBy : '',
        approvedAt: approved && approvedBy ? approvedAt : null,
        statements,
        hidden: row.hidden === true,
        authoritative: false
    };
}

/**
 * Detect forbidden identity / creatorTruth mutation keys on a candidate payload.
 * @param {unknown} payload
 * @returns {string[]}
 */
export function listForbiddenExplanationKeys(payload) {
    if (!payload || typeof payload !== 'object') return [];
    const row = /** @type {Record<string, unknown>} */ (payload);
    /** @type {string[]} */
    const found = [];
    for (const key of NLP_FORBIDDEN_CREATOR_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null && row[key] !== '') {
            found.push(key);
        }
    }
    // Nested creatorTruth object
    if (row.creatorTruth != null && typeof row.creatorTruth === 'object') {
        if (!found.includes('creatorTruth')) found.push('creatorTruth');
    }
    return found;
}

/**
 * Create an intelligence explanation (draft by default).
 * NLP may populate statements only — never creator identity fields.
 *
 * @param {{
 *   statements?: string[] | string;
 *   source?: string;
 *   approved?: boolean;
 *   approvedBy?: string;
 *   approvedAt?: number | null;
 *   hidden?: boolean;
 *   // Forbidden if present (validated):
 *   title?: unknown;
 *   description?: unknown;
 *   genre?: unknown;
 *   identity?: unknown;
 *   culturalRegion?: unknown;
 *   creatorTruth?: unknown;
 * }} [input]
 * @returns {{ ok: boolean; block: IntelligenceExplanationBlock | null; errors: string[] }}
 */
export function createIntelligenceExplanation(input = {}) {
    const forbidden = listForbiddenExplanationKeys(input);
    if (forbidden.length) {
        return {
            ok: false,
            block: null,
            errors: [
                'nlp_cannot_write_creator_identity',
                ...forbidden.map((k) => `forbidden_field:${k}`)
            ]
        };
    }

    const statements = listStatements(input.statements);
    if (!statements.length) {
        return {
            ok: false,
            block: null,
            errors: ['statements_required']
        };
    }

    // Creation never auto-approves — even if caller passes approved flags.
    // Use approveIntelligenceExplanation() for Master Hero Admin grant.
    const block = normalizeIntelligenceExplanation({
        source: input.source || INTELLIGENCE_EXPLANATION_SOURCES.NLP,
        statements,
        approved: false,
        approvedBy: '',
        approvedAt: null,
        hidden: input.hidden === true,
        authoritative: false
    });

    const validation = validateIntelligenceExplanation(block);
    if (!validation.ok) {
        return { ok: false, block: null, errors: validation.errors };
    }

    return { ok: true, block, errors: [] };
}

/**
 * Validate structure + approval invariants (does not grant approval).
 * @param {unknown} raw
 * @returns {{ ok: boolean; errors: string[]; block: IntelligenceExplanationBlock }}
 */
export function validateIntelligenceExplanation(raw) {
    const block = normalizeIntelligenceExplanation(raw);
    /** @type {string[]} */
    const errors = [];

    if (raw && typeof raw === 'object') {
        const forbidden = listForbiddenExplanationKeys(raw);
        if (forbidden.length) {
            errors.push('nlp_cannot_write_creator_identity');
            for (const k of forbidden) errors.push(`forbidden_field:${k}`);
        }
    }

    if (!Array.isArray(block.statements)) {
        errors.push('statements_must_be_array');
    }

    // Public approval requires full metadata
    if (block.approved) {
        if (!block.approvedBy) errors.push('approved_requires_approvedBy');
        if (!block.approvedAt) errors.push('approved_requires_approvedAt');
        if (!block.statements.length) errors.push('approved_requires_statements');
    }

    // Approval without intended identity claim is fine; authoritative always false
    if (/** @type {any} */ (raw)?.authoritative === true) {
        errors.push('intelligence_cannot_be_authoritative');
    }

    return {
        ok: errors.length === 0,
        errors,
        block
    };
}

/**
 * Master Hero Admin: approve explanation for public display.
 * @param {unknown} raw
 * @param {{ approvedBy?: string; actorId?: string }} [options]
 */
export function approveIntelligenceExplanation(raw, options = {}) {
    const base = normalizeIntelligenceExplanation(raw);
    const approvedBy = text(options.approvedBy || options.actorId);
    if (!approvedBy) {
        return {
            ok: false,
            block: base,
            errors: ['approvedBy_required']
        };
    }
    if (!base.statements.length) {
        return {
            ok: false,
            block: base,
            errors: ['statements_required']
        };
    }
    const block = {
        ...base,
        approved: true,
        approvedBy,
        approvedAt: Date.now(),
        hidden: false,
        authoritative: false
    };
    const validation = validateIntelligenceExplanation(block);
    return {
        ok: validation.ok,
        block: validation.ok ? block : base,
        errors: validation.errors
    };
}

/**
 * Edit explanation statements (clears public approval until re-approved).
 * @param {unknown} raw
 * @param {{ statements?: string[] | string }} edit
 */
export function editIntelligenceExplanation(raw, edit = {}) {
    const base = normalizeIntelligenceExplanation(raw);
    const statements = listStatements(edit.statements != null ? edit.statements : base.statements);
    const block = {
        ...base,
        statements,
        // Edits invalidate prior public grant
        approved: false,
        approvedBy: '',
        approvedAt: null,
        authoritative: false
    };
    if (!statements.length) {
        return { ok: false, block, errors: ['statements_required'] };
    }
    return { ok: true, block, errors: [] };
}

/**
 * Hide explanation from public (admin gate — not deletion of statements).
 * @param {unknown} raw
 */
export function hideIntelligenceExplanation(raw) {
    const base = normalizeIntelligenceExplanation(raw);
    return {
        ok: true,
        block: {
            ...base,
            hidden: true,
            // Hidden is not the same as unapproved; keep audit of who approved.
            authoritative: false
        },
        errors: []
    };
}

/**
 * Public resolver — only approved, non-hidden explanations surface.
 *
 * @param {unknown} recordOrExplanation HeroRecord or bare block
 * @param {{ showIntelligence?: boolean; forceShow?: boolean }} [options]
 * @returns {{
 *   visible: boolean;
 *   lines: string[];
 *   statements: string[];
 *   source: string;
 *   approved: boolean;
 *   authoritative: false;
 *   reason: string;
 * }}
 */
export function resolvePublicIntelligenceExplanation(recordOrExplanation, options = {}) {
    /** @type {IntelligenceExplanationBlock} */
    let block;
    if (
        recordOrExplanation &&
        typeof recordOrExplanation === 'object' &&
        'intelligenceExplanation' in /** @type {object} */ (recordOrExplanation)
    ) {
        block = normalizeIntelligenceExplanation(
            /** @type {Record<string, unknown>} */ (recordOrExplanation).intelligenceExplanation
        );
    } else {
        block = normalizeIntelligenceExplanation(recordOrExplanation);
    }

    const showToggle = options.showIntelligence !== false;
    const force = options.forceShow === true;

    if (!showToggle && !force) {
        return {
            visible: false,
            lines: [],
            statements: [],
            source: block.source,
            approved: false,
            authoritative: false,
            reason: 'intelligence_hidden_by_presentation'
        };
    }

    if (block.hidden) {
        return {
            visible: false,
            lines: [],
            statements: block.statements.slice(),
            source: block.source,
            approved: block.approved,
            authoritative: false,
            reason: 'explanation_hidden'
        };
    }

    if (!block.approved || !block.approvedBy || !block.approvedAt) {
        return {
            visible: false,
            lines: [],
            statements: block.statements.slice(),
            source: block.source,
            approved: false,
            authoritative: false,
            reason: 'explanation_requires_approval'
        };
    }

    if (!block.statements.length) {
        return {
            visible: false,
            lines: [],
            statements: [],
            source: block.source,
            approved: true,
            authoritative: false,
            reason: 'no_statements'
        };
    }

    return {
        visible: true,
        lines: block.statements.slice(),
        statements: block.statements.slice(),
        source: block.source,
        approved: true,
        authoritative: false,
        reason: ''
    };
}

/**
 * Hard block: NLP attempt to mutate creatorTruth.
 *
 * @param {Record<string, unknown> | null | undefined} creatorTruthBefore
 * @param {Record<string, unknown> | null | undefined} creatorTruthAfter
 * @param {unknown} nlpPayload
 * @returns {{ ok: boolean; errors: string[]; creatorTruth: Record<string, unknown> | null }}
 */
export function applyNlpToCreatorTruth(creatorTruthBefore, creatorTruthAfter, nlpPayload) {
    const forbidden = listForbiddenExplanationKeys(nlpPayload);
    /** @type {string[]} */
    const errors = ['nlp_cannot_modify_creatorTruth'];
    if (forbidden.length) {
        for (const k of forbidden) errors.push(`forbidden_field:${k}`);
    }

    // Detect any field drift between before/after when NLP-sourced
    if (creatorTruthBefore && creatorTruthAfter) {
        const keys = new Set([
            ...Object.keys(creatorTruthBefore),
            ...Object.keys(creatorTruthAfter)
        ]);
        for (const key of keys) {
            const a = JSON.stringify(creatorTruthBefore[key] ?? null);
            const b = JSON.stringify(creatorTruthAfter[key] ?? null);
            if (a !== b) {
                errors.push(`creatorTruth_mutated:${key}`);
            }
        }
    }

    return {
        ok: false,
        errors,
        // Always return prior truth — never apply after
        creatorTruth: creatorTruthBefore
            ? { ...creatorTruthBefore }
            : creatorTruthAfter
              ? { ...creatorTruthAfter }
              : null
    };
}

/**
 * Discovery category must never become identity / genre / title.
 * @param {string} category
 * @param {'genre' | 'title' | 'identity' | 'culturalRegion'} target
 */
export function promoteDiscoveryToIdentity(category, target) {
    return {
        ok: false,
        category: text(category),
        target: text(target),
        reason: 'discovery_cannot_become_identity'
    };
}

/**
 * AI auto-publish of intelligence explanation — always blocked.
 * @param {unknown} _block
 */
export function autoPublishIntelligenceExplanation(_block) {
    void _block;
    return {
        ok: false,
        errors: ['intelligence_cannot_auto_publish'],
        block: null
    };
}

export { PROVENANCE_SOURCE_TYPES };
