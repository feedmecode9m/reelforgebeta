/**
 * Creator Intent Context Layer (Phase 11)
 *
 * Creators and Master Hero Admin may preserve the meaning behind a Hero.
 * AI / NLP / discovery must not invent intent.
 *
 * Shape (HeroRecord.creatorIntentContext):
 * {
 *   privateNotes: string[],
 *   publicStatement: { text, approved, approvedBy, approvedAt, hidden? },
 *   provenance: { source, suppliedBy, updatedAt }
 * }
 *
 * Allowed:
 *   - creator supplied intent
 *   - master hero admin editorial approval
 *
 * Blocked:
 *   - NLP generated intent
 *   - discovery generated intent
 *   - AI cultural / history claims as intent
 *   - automatic public publishing
 *
 * @see ./heroRecord.js
 * @see ./heroPresentationAuthority.js
 * @see ../architecture/intelligenceProvenance.js
 */

import { PROVENANCE_SOURCE_TYPES, normalizeProvenanceSource } from '../architecture/intelligenceProvenance.js';

/** Provenance sources allowed to *author* intent. */
export const CREATOR_INTENT_ALLOWED_SOURCES = Object.freeze({
    CREATOR: 'creator',
    ADMIN: 'admin'
});

/** Provenance sources that may never invent intent. */
export const CREATOR_INTENT_BLOCKED_SOURCES = Object.freeze([
    'nlp',
    'ai',
    'discovery',
    'assistant',
    'copilot',
    'generated',
    'system',
    'demo',
    'classifier',
    'recommendation'
]);

/**
 * Keys that must never appear on public creator intent.
 * @type {ReadonlyArray<string>}
 */
export const FORBIDDEN_PUBLIC_INTENT_KEYS = Object.freeze([
    'privateNotes',
    'privateNote',
    'notes',
    'approvedBy',
    'approvedAt',
    'sourceType',
    'source',
    'actor',
    'actorId',
    'adminContext',
    'editorialNotes',
    'identityNotes',
    'confidence',
    'nlpConfidence',
    'discoveryContext',
    'rawPayload',
    'modelId'
]);

/**
 * @typedef {Object} CreatorIntentPublicStatement
 * @property {string} text
 * @property {boolean} approved
 * @property {string} approvedBy
 * @property {number | null} approvedAt
 * @property {boolean} [hidden]
 */

/**
 * @typedef {Object} CreatorIntentProvenance
 * @property {string} source  creator | admin (never nlp/discovery/ai)
 * @property {string} suppliedBy
 * @property {number | null} updatedAt
 */

/**
 * @typedef {Object} CreatorIntentContextBlock
 * @property {string[]} privateNotes
 * @property {CreatorIntentPublicStatement} publicStatement
 * @property {CreatorIntentProvenance} provenance
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
function listNotes(value) {
    if (Array.isArray(value)) {
        return value.map((n) => text(n)).filter(Boolean);
    }
    const single = text(value);
    return single ? [single] : [];
}

/**
 * Normalize intent provenance source. Fail-closed: unknown → blocked as system.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeCreatorIntentSource(raw) {
    const s = text(raw)
        .toLowerCase()
        .replace(/-/g, '_');
    if (
        s === 'creator' ||
        s === 'studio' ||
        s === 'user' ||
        s === 'manual' ||
        s === 'author'
    ) {
        return CREATOR_INTENT_ALLOWED_SOURCES.CREATOR;
    }
    if (
        s === 'admin' ||
        s === 'master_hero_admin' ||
        s === 'editorial' ||
        s === 'human'
    ) {
        return CREATOR_INTENT_ALLOWED_SOURCES.ADMIN;
    }
    // Map known AI / discovery tokens for rejection checks
    const normalized = normalizeProvenanceSource(raw);
    if (
        normalized === PROVENANCE_SOURCE_TYPES.AI ||
        normalized === PROVENANCE_SOURCE_TYPES.DISCOVERY ||
        normalized === PROVENANCE_SOURCE_TYPES.DEMO ||
        normalized === PROVENANCE_SOURCE_TYPES.SYSTEM
    ) {
        return normalized;
    }
    return normalized || PROVENANCE_SOURCE_TYPES.SYSTEM;
}

/**
 * True when source may author creator intent context.
 * @param {unknown} raw
 */
export function isAllowedCreatorIntentSource(raw) {
    const s = normalizeCreatorIntentSource(raw);
    return (
        s === CREATOR_INTENT_ALLOWED_SOURCES.CREATOR ||
        s === CREATOR_INTENT_ALLOWED_SOURCES.ADMIN
    );
}

/**
 * @returns {CreatorIntentPublicStatement}
 */
export function createEmptyPublicStatement() {
    return {
        text: '',
        approved: false,
        approvedBy: '',
        approvedAt: null,
        hidden: false
    };
}

/**
 * @returns {CreatorIntentProvenance}
 */
export function createEmptyIntentProvenance() {
    return {
        source: CREATOR_INTENT_ALLOWED_SOURCES.CREATOR,
        suppliedBy: '',
        updatedAt: null
    };
}

/**
 * Empty context (safe default — never public).
 * @returns {CreatorIntentContextBlock}
 */
export function createEmptyCreatorIntentContext() {
    return {
        privateNotes: [],
        publicStatement: createEmptyPublicStatement(),
        provenance: createEmptyIntentProvenance()
    };
}

/**
 * @param {unknown} raw
 * @returns {CreatorIntentPublicStatement}
 */
export function normalizePublicStatement(raw) {
    if (!raw || typeof raw !== 'object') {
        return createEmptyPublicStatement();
    }
    const row = /** @type {Record<string, unknown>} */ (raw);
    const statementText = text(row.text || row.statement || row.body);
    const approvedBy = text(row.approvedBy);
    const approvedAtRaw = Number(row.approvedAt);
    const approved =
        row.approved === true &&
        Boolean(statementText) &&
        Boolean(approvedBy) &&
        Number.isFinite(approvedAtRaw) &&
        approvedAtRaw > 0;

    return {
        text: statementText,
        approved,
        approvedBy: approved ? approvedBy : '',
        approvedAt: approved ? approvedAtRaw : null,
        hidden: row.hidden === true
    };
}

/**
 * @param {unknown} raw
 * @returns {CreatorIntentProvenance}
 */
export function normalizeIntentProvenance(raw) {
    if (!raw || typeof raw !== 'object') {
        return createEmptyIntentProvenance();
    }
    const row = /** @type {Record<string, unknown>} */ (raw);
    const source = normalizeCreatorIntentSource(row.source || row.sourceType);
    const updatedAtRaw = Number(row.updatedAt);
    return {
        // Keep nominal source token when allowed; else system (will fail validate if used for public)
        source: isAllowedCreatorIntentSource(source)
            ? source
            : source || PROVENANCE_SOURCE_TYPES.SYSTEM,
        suppliedBy: text(row.suppliedBy || row.actor || row.actorId),
        updatedAt:
            Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : null
    };
}

/**
 * Normalize storage shape without granting public approval.
 * @param {unknown} raw
 * @returns {CreatorIntentContextBlock}
 */
export function normalizeCreatorIntentContext(raw) {
    if (!raw || typeof raw !== 'object') {
        return createEmptyCreatorIntentContext();
    }
    const row = /** @type {Record<string, unknown>} */ (raw);
    return {
        privateNotes: listNotes(row.privateNotes || row.notes),
        publicStatement: normalizePublicStatement(row.publicStatement || row.statement),
        provenance: normalizeIntentProvenance(row.provenance)
    };
}

/**
 * Create creator intent context (draft by default).
 * Rejects NLP / AI / discovery sources.
 *
 * @param {{
 *   privateNotes?: string[] | string;
 *   publicStatementText?: string;
 *   publicText?: string;
 *   text?: string;
 *   source?: string;
 *   suppliedBy?: string;
 *   provenance?: { source?: string; suppliedBy?: string };
 * }} [input]
 * @returns {{ ok: boolean; context: CreatorIntentContextBlock | null; errors: string[] }}
 */
export function createCreatorIntentContext(input = {}) {
    const sourceRaw =
        input.source ||
        input.provenance?.source ||
        CREATOR_INTENT_ALLOWED_SOURCES.CREATOR;

    if (!isAllowedCreatorIntentSource(sourceRaw)) {
        return {
            ok: false,
            context: null,
            errors: ['ai_cannot_create_intent', `blocked_source:${normalizeCreatorIntentSource(sourceRaw)}`]
        };
    }

    const source = normalizeCreatorIntentSource(sourceRaw);
    const publicText = text(
        input.publicStatementText || input.publicText || input.text || ''
    );
    const privateNotes = listNotes(input.privateNotes);
    const suppliedBy = text(input.suppliedBy || input.provenance?.suppliedBy);

    // Create never auto-approves public statement.
    const context = normalizeCreatorIntentContext({
        privateNotes,
        publicStatement: {
            text: publicText,
            approved: false,
            approvedBy: '',
            approvedAt: null,
            hidden: false
        },
        provenance: {
            source,
            suppliedBy,
            updatedAt: Date.now()
        }
    });

    const validation = validateCreatorIntentContext(context);
    if (!validation.ok) {
        return { ok: false, context: null, errors: validation.errors };
    }

    // Empty draft (no notes, no statement) is still valid for structure — allow create
    return { ok: true, context, errors: [] };
}

/**
 * Validate structure + source + approval invariants.
 * @param {unknown} raw
 * @returns {{ ok: boolean; errors: string[]; context: CreatorIntentContextBlock }}
 */
export function validateCreatorIntentContext(raw) {
    const context = normalizeCreatorIntentContext(raw);
    /** @type {string[]} */
    const errors = [];

    if (!isAllowedCreatorIntentSource(context.provenance.source)) {
        errors.push('ai_cannot_create_intent');
        errors.push(`blocked_source:${context.provenance.source}`);
    }

    // Nested AI/discovery markers on raw payload
    if (raw && typeof raw === 'object') {
        const row = /** @type {Record<string, unknown>} */ (raw);
        const claimed =
            text(row.generatedBy || row.model || row.engine || row.discoverySource).toLowerCase();
        if (
            claimed &&
            (claimed.includes('nlp') ||
                claimed.includes('ai') ||
                claimed.includes('discovery') ||
                claimed.includes('llm'))
        ) {
            errors.push('ai_cannot_create_intent');
        }
        if (row.autoPublish === true || row.autoApproved === true) {
            errors.push('intent_cannot_auto_publish');
        }
    }

    if (context.publicStatement.approved) {
        if (!context.publicStatement.text) errors.push('approved_requires_text');
        if (!context.publicStatement.approvedBy) errors.push('approved_requires_approvedBy');
        if (!context.publicStatement.approvedAt) errors.push('approved_requires_approvedAt');
        if (!isAllowedCreatorIntentSource(context.provenance.source)) {
            errors.push('approved_requires_creator_or_admin_provenance');
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        context
    };
}

/**
 * Draft / replace public statement text (clears prior approval).
 * @param {unknown} raw
 * @param {{ text?: string; privateNotes?: string[] | string; suppliedBy?: string; source?: string }} [edit]
 */
export function draftCreatorIntentContext(raw, edit = {}) {
    const base = normalizeCreatorIntentContext(raw);
    const source = normalizeCreatorIntentSource(
        edit.source || base.provenance.source || CREATOR_INTENT_ALLOWED_SOURCES.CREATOR
    );
    if (!isAllowedCreatorIntentSource(source)) {
        return {
            ok: false,
            context: base,
            errors: ['ai_cannot_create_intent']
        };
    }

    const next = normalizeCreatorIntentContext({
        privateNotes:
            edit.privateNotes !== undefined ? edit.privateNotes : base.privateNotes,
        publicStatement: {
            text: edit.text !== undefined ? text(edit.text) : base.publicStatement.text,
            approved: false,
            approvedBy: '',
            approvedAt: null,
            hidden: false
        },
        provenance: {
            source,
            suppliedBy: text(edit.suppliedBy) || base.provenance.suppliedBy,
            updatedAt: Date.now()
        }
    });

    const validation = validateCreatorIntentContext(next);
    return {
        ok: validation.ok,
        context: validation.ok ? next : base,
        errors: validation.errors
    };
}

/**
 * Master Hero Admin: approve public statement.
 * @param {unknown} raw
 * @param {{ approvedBy?: string; actorId?: string }} [options]
 */
export function approveCreatorIntentContext(raw, options = {}) {
    const base = normalizeCreatorIntentContext(raw);
    const approvedBy = text(options.approvedBy || options.actorId);
    if (!approvedBy) {
        return { ok: false, context: base, errors: ['approvedBy_required'] };
    }
    if (!base.publicStatement.text) {
        return { ok: false, context: base, errors: ['text_required'] };
    }
    if (!isAllowedCreatorIntentSource(base.provenance.source)) {
        return {
            ok: false,
            context: base,
            errors: ['ai_cannot_create_intent', 'cannot_approve_ai_intent']
        };
    }

    const context = normalizeCreatorIntentContext({
        privateNotes: base.privateNotes,
        publicStatement: {
            text: base.publicStatement.text,
            approved: true,
            approvedBy,
            approvedAt: Date.now(),
            hidden: false
        },
        provenance: {
            ...base.provenance,
            // Approval preserves original creator supply when present; admin is approver only.
            source: base.provenance.source || CREATOR_INTENT_ALLOWED_SOURCES.ADMIN,
            updatedAt: Date.now()
        }
    });

    const validation = validateCreatorIntentContext(context);
    return {
        ok: validation.ok,
        context: validation.ok ? context : base,
        errors: validation.errors
    };
}

/**
 * Hide public statement (does not expose private notes).
 * @param {unknown} raw
 */
export function hideCreatorIntentContext(raw) {
    const base = normalizeCreatorIntentContext(raw);
    return {
        ok: true,
        context: {
            ...base,
            publicStatement: {
                ...base.publicStatement,
                hidden: true
            }
        },
        errors: []
    };
}

/**
 * Public resolver — approved public statement text only.
 * Never returns privateNotes, approvedBy, actors, or AI provenance internals.
 *
 * @param {unknown} recordOrContext HeroRecord or bare context
 * @returns {{
 *   visible: boolean;
 *   text: string;
 *   authoritative: false;
 *   reason: string;
 * }}
 */
export function resolvePublicCreatorIntent(recordOrContext) {
    /** @type {CreatorIntentContextBlock} */
    let context;
    if (
        recordOrContext &&
        typeof recordOrContext === 'object' &&
        'creatorIntentContext' in /** @type {object} */ (recordOrContext)
    ) {
        context = normalizeCreatorIntentContext(
            /** @type {Record<string, unknown>} */ (recordOrContext).creatorIntentContext
        );
    } else {
        context = normalizeCreatorIntentContext(recordOrContext);
    }

    if (!isAllowedCreatorIntentSource(context.provenance.source)) {
        return {
            visible: false,
            text: '',
            authoritative: false,
            reason: 'ai_cannot_create_intent'
        };
    }

    const statement = context.publicStatement;
    if (statement.hidden) {
        return {
            visible: false,
            text: '',
            authoritative: false,
            reason: 'intent_hidden'
        };
    }

    if (!statement.approved || !statement.approvedBy || !statement.approvedAt) {
        return {
            visible: false,
            text: '',
            authoritative: false,
            reason: 'intent_requires_approval'
        };
    }

    if (!statement.text) {
        return {
            visible: false,
            text: '',
            authoritative: false,
            reason: 'no_public_statement'
        };
    }

    // Explicitly omit privateNotes / approvedBy / provenance internals
    return {
        visible: true,
        text: statement.text,
        authoritative: false,
        reason: ''
    };
}

/**
 * Hard block: NLP / AI inventing intent.
 * @param {unknown} payload
 */
export function createIntentFromAi(payload) {
    void payload;
    return {
        ok: false,
        context: null,
        errors: ['ai_cannot_create_intent']
    };
}

/**
 * Hard block: discovery inventing intent.
 * @param {unknown} payload
 */
export function createIntentFromDiscovery(payload) {
    void payload;
    return {
        ok: false,
        context: null,
        errors: ['discovery_cannot_create_intent']
    };
}

/**
 * AI auto-publish of intent — always blocked.
 * @param {unknown} _context
 */
export function autoPublishCreatorIntent(_context) {
    void _context;
    return {
        ok: false,
        errors: ['intent_cannot_auto_publish'],
        context: null
    };
}

/**
 * Deep-scan public intent payload for forbidden leakage.
 * @param {unknown} value
 * @param {string[]} [path]
 * @returns {string[]}
 */
export function findForbiddenPublicIntentLeaks(value, path = []) {
    /** @type {string[]} */
    const leaks = [];
    if (value == null) return leaks;
    if (Array.isArray(value)) {
        value.forEach((item, i) => {
            leaks.push(...findForbiddenPublicIntentLeaks(item, [...path, String(i)]));
        });
        return leaks;
    }
    if (typeof value !== 'object') return leaks;
    for (const [key, child] of Object.entries(value)) {
        const nextPath = [...path, key];
        if (FORBIDDEN_PUBLIC_INTENT_KEYS.includes(key)) {
            leaks.push(nextPath.join('.'));
            continue;
        }
        leaks.push(...findForbiddenPublicIntentLeaks(child, nextPath));
    }
    return leaks;
}
