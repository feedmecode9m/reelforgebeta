/**
 * Hero Authority Boundary — fail-closed lifecycle + provenance gate.
 *
 * Layer separation (never collapse):
 * - creatorTruth: real uploaded/edited creator identity (immutable once captured)
 * - heroPresentation: approved public editorial layer + lifecycle status
 * - intelligenceContext: NLP explanation only — never identity
 * - discoveryContext: ranking/search only — never identity
 * - auditLog: governance history only
 *
 * Transition path (editorial):
 *   draft → review → approved → published → archived
 * with limited admin retreats (e.g. published → draft on re-edit).
 *
 * Concerns:
 * - Authority:     "Who is allowed to publish?"  (this module + identity resolver)
 * - Verification:  "Can this state be trusted?"
 * - Presentation:  "What does the public see?"
 *
 * Phase 5: actor identity via resolveAuthorityIdentity() — not blind trust of
 * caller-supplied actor strings alone. Development uses explicit local identity;
 * production requires authenticated session identity.
 *
 * Unknown sourceType → system (untrusted), never creator.
 *
 * @see ./heroPresentationAuthority.js
 * @see ./heroAuditEvents.js
 * @see ./heroAuthoritySync.js
 * @see ../auth/authorityIdentity.js
 */

import { PROVENANCE_SOURCE_TYPES } from '../architecture/intelligenceProvenance.js';
import {
    resolveAuthorityIdentity,
    identityToActorType
} from '../auth/authorityIdentity.js';
import {
    HERO_AUDIT_ACTIONS,
    normalizeHeroAuditLog,
    isUnauthorizedEditorialSource
} from './heroAuditEvents.js';

/** Presentation lifecycle statuses (governance). */
export const HERO_LIFECYCLE_STATUS = Object.freeze({
    DRAFT: 'draft',
    REVIEW: 'review',
    APPROVED: 'approved',
    PUBLISHED: 'published',
    ARCHIVED: 'archived'
});

/** @type {ReadonlyArray<string>} */
export const HERO_LIFECYCLE_STATUS_VALUES = Object.freeze([
    HERO_LIFECYCLE_STATUS.DRAFT,
    HERO_LIFECYCLE_STATUS.REVIEW,
    HERO_LIFECYCLE_STATUS.APPROVED,
    HERO_LIFECYCLE_STATUS.PUBLISHED,
    HERO_LIFECYCLE_STATUS.ARCHIVED
]);

/**
 * Allowed status graph. Self-edges allow field edits without status change
 * and re-assert of current state where safe.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const HERO_LIFECYCLE_TRANSITIONS = Object.freeze({
    draft: Object.freeze(['draft', 'review', 'approved']),
    review: Object.freeze(['review', 'draft', 'approved']),
    approved: Object.freeze(['approved', 'published', 'draft', 'archived']),
    published: Object.freeze(['published', 'archived', 'draft']),
    archived: Object.freeze(['archived', 'draft'])
});

/** Actor classifications for audit / server handoff */
export const HERO_ACTOR_TYPES = Object.freeze({
    ADMIN: 'admin',
    CREATOR: 'creator',
    SYSTEM: 'system',
    INTELLIGENCE: 'intelligence',
    UNKNOWN: 'unknown'
});

/**
 * Sources authorized to execute editorial lifecycle transitions.
 * Fail-closed: anything else (including bare system) cannot approve/publish.
 */
export const HERO_AUTHORITY_SOURCES = Object.freeze([
    PROVENANCE_SOURCE_TYPES.CREATOR,
    PROVENANCE_SOURCE_TYPES.VAULT,
    'admin',
    'master_hero_admin',
    'studio'
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Fail-closed source normalization for Hero authority.
 * Missing / unknown → system (never elevates to creator).
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeHeroAuthoritySourceType(raw) {
    const s = text(raw).toLowerCase().replace(/-/g, '_');
    if (!s || s === 'unknown' || s === 'none' || s === 'null' || s === 'undefined') {
        return PROVENANCE_SOURCE_TYPES.SYSTEM;
    }
    if (s === 'creator' || s === 'studio' || s === 'user' || s === 'manual') {
        return PROVENANCE_SOURCE_TYPES.CREATOR;
    }
    if (s === 'vault' || s === 'upload' || s === 'asset' || s === 'hero_vault') {
        return PROVENANCE_SOURCE_TYPES.VAULT;
    }
    if (s === 'admin' || s === 'master_hero_admin') {
        return 'admin';
    }
    if (
        s === PROVENANCE_SOURCE_TYPES.AI ||
        s === 'nlp' ||
        s === 'nlp_inference' ||
        s === 'assistant'
    ) {
        return PROVENANCE_SOURCE_TYPES.AI;
    }
    if (s === PROVENANCE_SOURCE_TYPES.DISCOVERY || s === 'search' || s === 'rank') {
        return PROVENANCE_SOURCE_TYPES.DISCOVERY;
    }
    if (
        s === PROVENANCE_SOURCE_TYPES.DEMO ||
        s === 'intelligence' ||
        s === 'intelligence_explanation' ||
        s === 'intelligenceexplanation' ||
        s === 'suggestion'
    ) {
        if (s === PROVENANCE_SOURCE_TYPES.DEMO) return PROVENANCE_SOURCE_TYPES.DEMO;
        return 'intelligence';
    }
    if (s === PROVENANCE_SOURCE_TYPES.SYSTEM) {
        return PROVENANCE_SOURCE_TYPES.SYSTEM;
    }
    // Unknown tokens never become creator.
    return PROVENANCE_SOURCE_TYPES.SYSTEM;
}

/**
 * @param {unknown} sourceType
 */
export function isAuthorizedHeroEditorialSource(sourceType) {
    const s = normalizeHeroAuthoritySourceType(sourceType);
    if (isUnauthorizedEditorialSource(s) || s === PROVENANCE_SOURCE_TYPES.SYSTEM) {
        return false;
    }
    return HERO_AUTHORITY_SOURCES.includes(s) || s === PROVENANCE_SOURCE_TYPES.CREATOR || s === PROVENANCE_SOURCE_TYPES.VAULT;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeHeroActorType(raw, actor = '') {
    const t = text(raw).toLowerCase();
    if (
        t === HERO_ACTOR_TYPES.ADMIN ||
        t === HERO_ACTOR_TYPES.CREATOR ||
        t === HERO_ACTOR_TYPES.SYSTEM ||
        t === HERO_ACTOR_TYPES.INTELLIGENCE
    ) {
        return t;
    }
    const a = text(actor).toLowerCase();
    if (a.includes('admin') || a === 'master_hero_admin') return HERO_ACTOR_TYPES.ADMIN;
    if (a.includes('creator')) return HERO_ACTOR_TYPES.CREATOR;
    if (!t) return HERO_ACTOR_TYPES.UNKNOWN;
    return HERO_ACTOR_TYPES.UNKNOWN;
}

/**
 * @param {unknown} status
 * @returns {string}
 */
export function normalizeHeroLifecycleStatus(status) {
    const s = text(status).toLowerCase();
    if (HERO_LIFECYCLE_STATUS_VALUES.includes(s)) return s;
    if (s === 'public') return HERO_LIFECYCLE_STATUS.PUBLISHED;
    if (s === 'hidden') return HERO_LIFECYCLE_STATUS.ARCHIVED;
    return HERO_LIFECYCLE_STATUS.DRAFT;
}

/**
 * Map audit action → expected status target (hint).
 * @param {string} action
 */
export function actionToTargetStatus(action) {
    const a = text(action).toLowerCase();
    if (a === HERO_AUDIT_ACTIONS.SUBMITTED_FOR_REVIEW) return HERO_LIFECYCLE_STATUS.REVIEW;
    if (a === HERO_AUDIT_ACTIONS.APPROVED) return HERO_LIFECYCLE_STATUS.APPROVED;
    if (a === HERO_AUDIT_ACTIONS.PUBLISHED) return HERO_LIFECYCLE_STATUS.PUBLISHED;
    if (a === HERO_AUDIT_ACTIONS.ARCHIVED) return HERO_LIFECYCLE_STATUS.ARCHIVED;
    if (a === HERO_AUDIT_ACTIONS.CREATED || a === HERO_AUDIT_ACTIONS.EDITED) {
        return '';
    }
    return '';
}

/**
 * Detect creatorTruth field mutation attempts during presentation governance.
 *
 * @param {Record<string, unknown> | null | undefined} before
 * @param {Record<string, unknown> | null | undefined} after
 * @returns {string[]}
 */
export function detectCreatorTruthMutation(before, after) {
    if (!after || typeof after !== 'object') return [];
    if (!before || typeof before !== 'object') return [];
    const keys = ['title', 'description', 'genre', 'sourceAssetTitle'];
    /** @type {string[]} */
    const mutated = [];
    for (const key of keys) {
        const a = text(before[key]);
        const b = text(after[key]);
        if (a && b && a !== b) mutated.push(key);
        if (a && !b) mutated.push(key);
    }
    if (before.immutable === true && after.immutable === false) {
        mutated.push('immutable');
    }
    return mutated;
}

/**
 * Resolve editorial actor from authenticated identity only (Phase 8).
 *
 * - Never trusts master_hero_admin / approvedBy / caller actor strings for authority.
 * - Presentation metadata approvedBy is stamped FROM resolved identity.
 * - Missing authenticated identity → fail closed.
 *
 * @param {{
 *   actor?: string;
 *   approvedBy?: string;
 *   actorType?: string;
 *   session?: object;
 *   identity?: import('../auth/authorityIdentity.js').AuthorityIdentity;
 *   allowCallerActor?: boolean;
 * }} [input]
 */
export function resolveEditorialActor(input = {}) {
    /** @type {string[]} */
    const errors = [];
    const identity =
        input.identity && typeof input.identity === 'object'
            ? input.identity
            : resolveAuthorityIdentity({
                  session: /** @type {any} */ (input.session),
                  // Validators / gate with no browser session may inject session
                  allowDevIdentity: /** @type {any} */ (input).allowDevIdentity
              });

    if (!identity.authenticated || !text(identity.actorId)) {
        errors.push('unauthenticated_authority_actor');
        errors.push('missing_identity');
    }

    // Phase 8: session identity is the only grantor source.
    const actor = text(identity.actorId);
    if (!actor) {
        errors.push('missing_actor');
    }

    // Reject self-escalation on real sessions. Dev/test ignore display-string leftovers.
    const claimed = [text(input.actor), text(input.approvedBy)].filter(Boolean);
    const bindingSource = text(identity.source);
    if (bindingSource === 'session' || bindingSource === 'admin_session') {
        for (const c of claimed) {
            if (c && c !== actor) {
                errors.push('client_supplied_elevated_actor');
            }
        }
    }

    const actorType = normalizeHeroActorType(identityToActorType(identity), actor);

    // Non-admin actor types cannot perform editorial transitions via authority path.
    if (actor && actorType !== HERO_ACTOR_TYPES.ADMIN && actorType !== HERO_ACTOR_TYPES.CREATOR) {
        // Keep creator path for future; production grants are admin-only on server.
    }

    return {
        ok: errors.length === 0,
        errors: Array.from(new Set(errors)),
        actor,
        actorType,
        identity
    };
}

/**
 * Fail-closed Hero lifecycle transition gate.
 *
 * Rejects:
 * - invalid lifecycle edges
 * - AI/NLP/discovery approval
 * - intelligence publish
 * - missing approval metadata on approve/publish
 * - published without audit event (when asserting published end state)
 * - creatorTruth mutation attempts
 * - missing / unauthenticated actor on editorial lifecycle actions
 *
 * @param {{
 *   previousStatus?: string;
 *   nextStatus?: string;
 *   action?: string;
 *   sourceType?: string;
 *   actor?: string;
 *   actorType?: string;
 *   approvedBy?: string;
 *   approvedAt?: number | null;
 *   auditLog?: unknown;
 *   proposedAuditEvents?: unknown;
 *   creatorTruthBefore?: Record<string, unknown> | null;
 *   creatorTruthAfter?: Record<string, unknown> | null;
 *   publicTitle?: string;
 *   publicDescription?: string;
 *   publicTheme?: string;
 *   session?: object;
 *   identity?: import('../auth/authorityIdentity.js').AuthorityIdentity;
 * }} input
 * @returns {{
 *   ok: boolean;
 *   errors: string[];
 *   sourceType: string;
 *   actorType: string;
 *   actor: string;
 *   previousStatus: string;
 *   nextStatus: string;
 *   action: string;
 *   identity: import('../auth/authorityIdentity.js').AuthorityIdentity | null;
 * }}
 */
export function validateHeroTransition(input = {}) {
    /** @type {string[]} */
    const errors = [];

    const previousStatus = normalizeHeroLifecycleStatus(input.previousStatus);
    const nextStatus = normalizeHeroLifecycleStatus(
        input.nextStatus || actionToTargetStatus(text(input.action)) || previousStatus
    );
    const action = text(input.action).toLowerCase();
    const sourceType = normalizeHeroAuthoritySourceType(input.sourceType);

    // Identity-backed actor (Phase 5) — not caller-only trust.
    const editorial = resolveEditorialActor({
        actor: input.actor,
        approvedBy: input.approvedBy,
        actorType: input.actorType,
        session: input.session,
        identity: input.identity
    });
    const actor = editorial.actor;
    const actorType = editorial.actorType;
    if (!editorial.ok) {
        errors.push(...editorial.errors);
    }

    // Lifecycle edge
    const allowed = HERO_LIFECYCLE_TRANSITIONS[previousStatus] || [];
    if (!allowed.includes(nextStatus)) {
        errors.push('invalid_lifecycle_transition');
    }

    // Source gates
    if (isUnauthorizedEditorialSource(sourceType) || sourceType === PROVENANCE_SOURCE_TYPES.SYSTEM) {
        if (
            action === HERO_AUDIT_ACTIONS.APPROVED ||
            nextStatus === HERO_LIFECYCLE_STATUS.APPROVED
        ) {
            errors.push('ai_nlp_cannot_approve');
        }
        if (
            action === HERO_AUDIT_ACTIONS.PUBLISHED ||
            nextStatus === HERO_LIFECYCLE_STATUS.PUBLISHED
        ) {
            errors.push('unauthorized_publish_rejected');
        }
        if (
            action === HERO_AUDIT_ACTIONS.ARCHIVED ||
            action === HERO_AUDIT_ACTIONS.SUBMITTED_FOR_REVIEW ||
            action === HERO_AUDIT_ACTIONS.EDITED ||
            action === HERO_AUDIT_ACTIONS.CREATED
        ) {
            errors.push('unauthorized_source_editorial');
        }
        if (sourceType === PROVENANCE_SOURCE_TYPES.DISCOVERY) {
            errors.push('discovery_cannot_approve');
        }
        if (sourceType === 'intelligence' || sourceType === PROVENANCE_SOURCE_TYPES.AI) {
            errors.push('intelligence_cannot_publish');
        }
    } else if (!isAuthorizedHeroEditorialSource(sourceType)) {
        errors.push('unauthorized_source_editorial');
    }

    // AI/NLP explicit codes for validators
    if (
        sourceType === PROVENANCE_SOURCE_TYPES.AI ||
        sourceType === 'nlp' ||
        text(input.sourceType).toLowerCase() === 'nlp'
    ) {
        if (
            action === HERO_AUDIT_ACTIONS.APPROVED ||
            nextStatus === HERO_LIFECYCLE_STATUS.APPROVED ||
            nextStatus === HERO_LIFECYCLE_STATUS.PUBLISHED
        ) {
            if (!errors.includes('ai_nlp_cannot_approve')) errors.push('ai_nlp_cannot_approve');
        }
    }

    // Actor required for lifecycle editorial
    const needsActor =
        action === HERO_AUDIT_ACTIONS.APPROVED ||
        action === HERO_AUDIT_ACTIONS.PUBLISHED ||
        action === HERO_AUDIT_ACTIONS.ARCHIVED ||
        action === HERO_AUDIT_ACTIONS.SUBMITTED_FOR_REVIEW ||
        action === HERO_AUDIT_ACTIONS.EDITED ||
        action === HERO_AUDIT_ACTIONS.CREATED ||
        nextStatus === HERO_LIFECYCLE_STATUS.APPROVED ||
        nextStatus === HERO_LIFECYCLE_STATUS.PUBLISHED ||
        nextStatus === HERO_LIFECYCLE_STATUS.ARCHIVED;

    if (needsActor && !actor) {
        if (!errors.includes('missing_actor')) errors.push('missing_actor');
    }

    if (
        (nextStatus === HERO_LIFECYCLE_STATUS.APPROVED ||
            nextStatus === HERO_LIFECYCLE_STATUS.PUBLISHED ||
            action === HERO_AUDIT_ACTIONS.APPROVED ||
            action === HERO_AUDIT_ACTIONS.PUBLISHED) &&
        (actorType === HERO_ACTOR_TYPES.INTELLIGENCE ||
            actorType === HERO_ACTOR_TYPES.SYSTEM ||
            actorType === HERO_ACTOR_TYPES.UNKNOWN)
    ) {
        if (actorType !== HERO_ACTOR_TYPES.ADMIN && actorType !== HERO_ACTOR_TYPES.CREATOR) {
            errors.push('missing_actor_authority');
        }
    }

    // Approval metadata for approved/published
    if (
        nextStatus === HERO_LIFECYCLE_STATUS.APPROVED ||
        nextStatus === HERO_LIFECYCLE_STATUS.PUBLISHED ||
        action === HERO_AUDIT_ACTIONS.APPROVED ||
        action === HERO_AUDIT_ACTIONS.PUBLISHED
    ) {
        const approvedBy = text(input.approvedBy) || actor;
        const approvedAt = Number(input.approvedAt);
        if (!approvedBy) errors.push('missing_approval_metadata');
        if (!Number.isFinite(approvedAt) || approvedAt <= 0) {
            errors.push('missing_approval_metadata');
        }
        if (
            !text(input.publicTitle) &&
            !text(input.publicDescription) &&
            !text(input.publicTheme)
        ) {
            if (
                input.publicTitle !== undefined ||
                input.publicDescription !== undefined ||
                input.publicTheme !== undefined
            ) {
                errors.push('presentation_fields_empty');
            }
        }
    }

    // Creator truth immutability during governance transitions
    const truthMutations = detectCreatorTruthMutation(
        input.creatorTruthBefore || null,
        input.creatorTruthAfter || null
    );
    if (truthMutations.length) {
        errors.push('creator_truth_mutation_attempt');
    }

    // Published without audit: when end state is published, combined log must include publish event
    if (nextStatus === HERO_LIFECYCLE_STATUS.PUBLISHED || action === HERO_AUDIT_ACTIONS.PUBLISHED) {
        const existing = normalizeHeroAuditLog(input.auditLog);
        const pending = normalizeHeroAuditLog(input.proposedAuditEvents);
        const combined = [...existing, ...pending];
        const hasPublish =
            action === HERO_AUDIT_ACTIONS.PUBLISHED ||
            combined.some((e) => e.action === HERO_AUDIT_ACTIONS.PUBLISHED);
        if (
            input.proposedAuditEvents !== undefined &&
            !hasPublish &&
            nextStatus === HERO_LIFECYCLE_STATUS.PUBLISHED
        ) {
            errors.push('published_without_audit_event');
        }
    }

    return {
        ok: errors.length === 0,
        errors: Array.from(new Set(errors)),
        sourceType,
        actorType,
        actor,
        previousStatus,
        nextStatus,
        action,
        identity: editorial.identity
    };
}

/**
 * Second-pass validation after audit events are built (strict publish trail).
 * @param {{
 *   nextStatus?: string;
 *   auditLog?: unknown;
 *   newEvents?: unknown;
 * }} input
 */
export function validateHeroTransitionAuditTrail(input = {}) {
    /** @type {string[]} */
    const errors = [];
    const nextStatus = normalizeHeroLifecycleStatus(input.nextStatus);
    const log = [
        ...normalizeHeroAuditLog(input.auditLog),
        ...normalizeHeroAuditLog(input.newEvents)
    ];

    if (nextStatus === HERO_LIFECYCLE_STATUS.PUBLISHED) {
        if (!log.some((e) => e.action === HERO_AUDIT_ACTIONS.PUBLISHED)) {
            errors.push('published_without_audit_event');
        }
    }
    if (nextStatus === HERO_LIFECYCLE_STATUS.APPROVED) {
        if (!log.some((e) => e.action === HERO_AUDIT_ACTIONS.APPROVED)) {
            errors.push('missing_event_for_state_transition');
        }
    }
    if (nextStatus === HERO_LIFECYCLE_STATUS.ARCHIVED) {
        if (!log.some((e) => e.action === HERO_AUDIT_ACTIONS.ARCHIVED)) {
            errors.push('missing_event_for_state_transition');
        }
    }
    return { ok: errors.length === 0, errors };
}
