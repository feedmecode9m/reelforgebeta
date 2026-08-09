/**
 * Hero Audit Integrity Layer.
 *
 * Immutable, append-only trail for Hero Vault editorial decisions.
 *
 * Layer roles (do not collapse):
 * - creatorTruth: real uploaded/edited creator identity
 * - heroPresentation: approved public editorial layer
 * - intelligenceContext: NLP explanation only — never identity
 * - discoveryContext: ranking/search only — never identity
 * - auditLog: governance history only
 *
 * Events: created | edited | submitted_for_review | approved | published | archived
 *
 * Rules:
 * - Editorial actions require actor + sourceType provenance + timestamp.
 * - AI / NLP / discovery / intelligence cannot create editorial lifecycle events.
 * - History is append-only; prior events are never overwritten or mutated.
 * - integrityHash is client-safe fingerprint for future server verification.
 *
 * @see ./heroAuthorityBoundary.js
 * @see ./heroPresentationAuthority.js
 * @see ./heroRecord.js
 */

import { PROVENANCE_SOURCE_TYPES } from '../architecture/intelligenceProvenance.js';

/** @typedef {'created' | 'edited' | 'submitted_for_review' | 'approved' | 'published' | 'archived'} HeroAuditAction */

/**
 * @typedef {Object} HeroAuditEvent
 * @property {string} eventId
 * @property {string} heroId
 * @property {HeroAuditAction} action
 * @property {string} previousStatus
 * @property {string} newStatus
 * @property {string} actor
 * @property {string} actorType
 * @property {string} sourceType
 * @property {string} source legacy alias of sourceType
 * @property {number} timestamp
 * @property {string[]} changedFields
 * @property {string} integrityHash
 */

export const HERO_AUDIT_ACTIONS = Object.freeze({
    CREATED: 'created',
    EDITED: 'edited',
    SUBMITTED_FOR_REVIEW: 'submitted_for_review',
    APPROVED: 'approved',
    PUBLISHED: 'published',
    ARCHIVED: 'archived'
});

/** @type {ReadonlyArray<HeroAuditAction>} */
export const HERO_AUDIT_ACTION_VALUES = Object.freeze([
    HERO_AUDIT_ACTIONS.CREATED,
    HERO_AUDIT_ACTIONS.EDITED,
    HERO_AUDIT_ACTIONS.SUBMITTED_FOR_REVIEW,
    HERO_AUDIT_ACTIONS.APPROVED,
    HERO_AUDIT_ACTIONS.PUBLISHED,
    HERO_AUDIT_ACTIONS.ARCHIVED
]);

/** Lifecycle editorial actions that require admin/creator provenance */
export const HERO_EDITORIAL_LIFECYCLE_ACTIONS = Object.freeze([
    HERO_AUDIT_ACTIONS.SUBMITTED_FOR_REVIEW,
    HERO_AUDIT_ACTIONS.APPROVED,
    HERO_AUDIT_ACTIONS.PUBLISHED,
    HERO_AUDIT_ACTIONS.ARCHIVED
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Fail-closed editorial source: missing/unknown → system (untrusted).
 * Does not elevate unknown to creator.
 * @param {unknown} raw
 */
export function normalizeAuditSourceType(raw) {
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
    if (s === 'admin' || s === 'master_hero_admin') return 'admin';
    if (s === 'ai' || s === 'nlp' || s === 'nlp_inference' || s === 'assistant') {
        return PROVENANCE_SOURCE_TYPES.AI;
    }
    if (s === 'discovery' || s === 'search' || s === 'rank') {
        return PROVENANCE_SOURCE_TYPES.DISCOVERY;
    }
    if (s === 'demo') return PROVENANCE_SOURCE_TYPES.DEMO;
    if (
        s === 'intelligence' ||
        s === 'intelligenceexplanation' ||
        s === 'intelligence_explanation' ||
        s === 'intelligence_suggestion' ||
        s === 'suggestion'
    ) {
        return 'intelligence';
    }
    if (s === 'system') return PROVENANCE_SOURCE_TYPES.SYSTEM;
    return PROVENANCE_SOURCE_TYPES.SYSTEM;
}

/**
 * Sources that must never create editorial audit / lifecycle events.
 * @param {unknown} source
 */
export function isUnauthorizedEditorialSource(source) {
    const s = normalizeAuditSourceType(source);
    return (
        s === PROVENANCE_SOURCE_TYPES.AI ||
        s === PROVENANCE_SOURCE_TYPES.DISCOVERY ||
        s === PROVENANCE_SOURCE_TYPES.DEMO ||
        s === PROVENANCE_SOURCE_TYPES.SYSTEM ||
        s === 'intelligence' ||
        s === 'nlp'
    );
}

/**
 * Client-safe FNV-1a 32-bit hex fingerprint (not a cryptographic signature).
 * Server can recompute/reject when authority handoff is enforced.
 *
 * @param {string} payload
 * @returns {string}
 */
export function computeClientIntegrityHash(payload) {
    const str = String(payload || '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Stable integrity hash over canonical event fields (excludes hash itself).
 * @param {{
 *   eventId: string;
 *   heroId: string;
 *   action: string;
 *   previousStatus: string;
 *   newStatus: string;
 *   actor: string;
 *   actorType: string;
 *   sourceType: string;
 *   timestamp: number;
 *   changedFields: string[];
 * }} fields
 */
export function computeHeroAuditIntegrityHash(fields) {
    const changed = Array.isArray(fields.changedFields)
        ? [...fields.changedFields].map((f) => text(f)).filter(Boolean).sort()
        : [];
    const payload = [
        text(fields.eventId),
        text(fields.heroId),
        text(fields.action),
        text(fields.previousStatus),
        text(fields.newStatus),
        text(fields.actor),
        text(fields.actorType),
        text(fields.sourceType),
        String(Number(fields.timestamp) || 0),
        changed.join(',')
    ].join('|');
    return computeClientIntegrityHash(payload);
}

/**
 * @param {HeroAuditEvent} event
 * @returns {boolean}
 */
export function verifyHeroAuditIntegrityHash(event) {
    if (!event || typeof event !== 'object') return false;
    const expected = computeHeroAuditIntegrityHash(event);
    return text(event.integrityHash) === expected;
}

/**
 * Transition integrity: actor, source, action, statuses consistent enough to append.
 * @param {unknown} event
 * @returns {{ ok: boolean; errors: string[] }}
 */
export function validateAuditEventTransitionIntegrity(event) {
    /** @type {string[]} */
    const errors = [];
    const row = normalizeHeroAuditEvent(event);
    if (!row) {
        return { ok: false, errors: ['invalid_audit_event'] };
    }
    if (!row.actor) errors.push('missing_actor');
    if (!row.sourceType || row.sourceType === 'unknown') errors.push('missing_source_provenance');
    if (isUnauthorizedEditorialSource(row.sourceType) && HERO_EDITORIAL_LIFECYCLE_ACTIONS.includes(row.action)) {
        errors.push('unauthorized_source_cannot_create_editorial_event');
    }
    if (!row.timestamp) errors.push('missing_timestamp');
    if (row.integrityHash && !verifyHeroAuditIntegrityHash(row)) {
        errors.push('integrity_hash_mismatch');
    }
    if (HERO_EDITORIAL_LIFECYCLE_ACTIONS.includes(row.action) && !row.actorType) {
        errors.push('missing_actor_metadata');
    }
    return { ok: errors.length === 0, errors };
}

/**
 * @param {unknown} action
 * @returns {HeroAuditAction | ''}
 */
export function normalizeHeroAuditAction(action) {
    const a = text(action).toLowerCase();
    return HERO_AUDIT_ACTION_VALUES.includes(/** @type {HeroAuditAction} */ (a))
        ? /** @type {HeroAuditAction} */ (a)
        : '';
}

/**
 * @param {unknown} raw
 * @returns {HeroAuditEvent | null}
 */
export function normalizeHeroAuditEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const action = normalizeHeroAuditAction(row.action);
    if (!action) return null;
    const eventId = text(row.eventId);
    const timestamp = Number(row.timestamp);
    if (!eventId || !Number.isFinite(timestamp) || timestamp <= 0) return null;
    const actor = text(row.actor);
    const sourceType = normalizeAuditSourceType(row.sourceType ?? row.source);
    const actorType = text(row.actorType) || 'unknown';
    const changedFields = Array.isArray(row.changedFields)
        ? row.changedFields.map((f) => text(f)).filter(Boolean)
        : [];
    const base = {
        eventId,
        heroId: text(row.heroId),
        action,
        previousStatus: text(row.previousStatus),
        newStatus: text(row.newStatus),
        actor,
        actorType,
        sourceType,
        source: sourceType,
        timestamp,
        changedFields
    };
    const integrityHash =
        text(row.integrityHash) || computeHeroAuditIntegrityHash(base);
    return {
        ...base,
        integrityHash
    };
}

/**
 * Normalize audit history (drops invalid rows; preserves order).
 * @param {unknown} raw
 * @returns {HeroAuditEvent[]}
 */
export function normalizeHeroAuditLog(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {HeroAuditEvent[]} */
    const out = [];
    const seen = new Set();
    for (const row of raw) {
        const event = normalizeHeroAuditEvent(row);
        if (!event) continue;
        if (seen.has(event.eventId)) continue;
        seen.add(event.eventId);
        out.push(event);
    }
    return out;
}

/**
 * Stable id for a new audit row.
 * @param {string} action
 * @param {number} timestamp
 */
export function createHeroAuditEventId(action, timestamp = Date.now()) {
    const rand =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID().slice(0, 8)
            : Math.random().toString(36).slice(2, 10);
    return `hero-audit-${text(action) || 'event'}-${timestamp}-${rand}`;
}

/**
 * Resolve stable hero id for audit linkage.
 * @param {Record<string, unknown> | null | undefined} record
 */
export function resolveHeroAuditHeroId(record) {
    if (!record || typeof record !== 'object') return 'hero-unknown';
    const assetId = text(record.assetId);
    if (assetId) return assetId;
    const mode = text(record.mode) || 'selection';
    return `hero-${mode}`;
}

/**
 * Diff public presentation fields for `changedFields`.
 * @param {Record<string, unknown> | null | undefined} previous
 * @param {Record<string, unknown> | null | undefined} next
 * @returns {string[]}
 */
export function computePresentationChangedFields(previous, next) {
    const keys = [
        'publicTitle',
        'publicDescription',
        'publicTheme',
        'status',
        'showIntelligence',
        'approvedBy',
        'approvedAt'
    ];
    /** @type {string[]} */
    const changed = [];
    const prev = previous && typeof previous === 'object' ? previous : {};
    const nxt = next && typeof next === 'object' ? next : {};
    for (const key of keys) {
        const a = prev[key] == null ? '' : String(prev[key]);
        const b = nxt[key] == null ? '' : String(nxt[key]);
        if (a !== b) changed.push(key);
    }
    return changed;
}

/**
 * Attempt to create an editorial audit event with provenance enforcement.
 *
 * PASS when actor + authorized sourceType + timestamp + known action.
 * FAIL for AI/NLP/discovery/intelligence/system sources.
 *
 * @param {{
 *   heroId?: string;
 *   action: string;
 *   previousStatus?: string;
 *   newStatus?: string;
 *   actor?: string;
 *   actorType?: string;
 *   source?: string;
 *   sourceType?: string;
 *   timestamp?: number;
 *   changedFields?: string[];
 *   eventId?: string;
 * }} input
 * @returns {{ ok: boolean; event: HeroAuditEvent | null; errors: string[] }}
 */
export function createHeroAuditEvent(input = /** @type {any} */ ({})) {
    /** @type {string[]} */
    const errors = [];
    const action = normalizeHeroAuditAction(input.action);
    if (!action) {
        errors.push('invalid_audit_action');
    }

    const sourceType = normalizeAuditSourceType(input.sourceType ?? input.source);
    if (isUnauthorizedEditorialSource(sourceType)) {
        errors.push('unauthorized_source_cannot_create_editorial_event');
    }

    const actor = text(input.actor);
    if (!actor) {
        errors.push('missing_actor');
    }

    const actorType = text(input.actorType) || 'unknown';
    if (
        HERO_EDITORIAL_LIFECYCLE_ACTIONS.includes(/** @type {HeroAuditAction} */ (action)) &&
        (!actorType || actorType === 'unknown' || actorType === 'intelligence' || actorType === 'system')
    ) {
        // Allow admin/creator only for lifecycle
        if (actorType !== 'admin' && actorType !== 'creator') {
            errors.push('missing_actor_metadata');
        }
    }

    if (!sourceType || sourceType === 'unknown') {
        errors.push('missing_source_provenance');
    }

    const timestamp = Number(input.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        errors.push('missing_timestamp');
    }

    if (errors.length || !action) {
        return { ok: false, event: null, errors };
    }

    const eventId = text(input.eventId) || createHeroAuditEventId(action, timestamp);
    const changedFields = Array.isArray(input.changedFields)
        ? input.changedFields.map((f) => text(f)).filter(Boolean)
        : [];

    const base = {
        eventId,
        heroId: text(input.heroId) || 'hero-unknown',
        action,
        previousStatus: text(input.previousStatus),
        newStatus: text(input.newStatus),
        actor,
        actorType,
        sourceType,
        source: sourceType,
        timestamp,
        changedFields
    };

    const event = Object.freeze({
        ...base,
        changedFields: Object.freeze([...changedFields]),
        integrityHash: computeHeroAuditIntegrityHash(base)
    });

    const integrity = validateAuditEventTransitionIntegrity(event);
    if (!integrity.ok) {
        return { ok: false, event: null, errors: integrity.errors };
    }

    return { ok: true, event: /** @type {HeroAuditEvent} */ (event), errors: [] };
}

/**
 * Append-only merge. Never overwrites prior events; never reorders history.
 * Duplicate eventIds are skipped (idempotent append).
 *
 * @param {unknown} existingLog
 * @param {unknown} incomingEvents
 * @returns {HeroAuditEvent[]}
 */
export function appendHeroAuditEvents(existingLog, incomingEvents) {
    const base = normalizeHeroAuditLog(existingLog);
    const seen = new Set(base.map((e) => e.eventId));
    /** @type {HeroAuditEvent[]} */
    const next = base.map((e) =>
        Object.freeze({ ...e, changedFields: Object.freeze([...e.changedFields]) })
    );

    const incoming = Array.isArray(incomingEvents)
        ? incomingEvents
        : incomingEvents
          ? [incomingEvents]
          : [];

    for (const raw of incoming) {
        const event = normalizeHeroAuditEvent(raw);
        if (!event) continue;
        if (seen.has(event.eventId)) continue;
        seen.add(event.eventId);
        next.push(
            Object.freeze({
                ...event,
                changedFields: Object.freeze([...event.changedFields])
            })
        );
    }
    return next;
}

/**
 * Detect overwrite attempts (shorter log replacing longer, or mutated historical rows).
 * @param {unknown} previousLog
 * @param {unknown} proposedLog
 * @returns {{ ok: boolean; errors: string[] }}
 */
export function assertAppendOnlyAuditHistory(previousLog, proposedLog) {
    /** @type {string[]} */
    const errors = [];
    const prev = normalizeHeroAuditLog(previousLog);
    const next = normalizeHeroAuditLog(proposedLog);

    if (next.length < prev.length) {
        errors.push('audit_history_overwrite_detected');
    }

    for (let i = 0; i < prev.length; i += 1) {
        const a = prev[i];
        const b = next[i];
        if (!b || b.eventId !== a.eventId) {
            errors.push('audit_history_mutation_detected');
            break;
        }
        if (
            b.action !== a.action ||
            b.timestamp !== a.timestamp ||
            b.actor !== a.actor ||
            b.sourceType !== a.sourceType ||
            b.source !== a.source ||
            b.integrityHash !== a.integrityHash
        ) {
            errors.push('audit_history_mutation_detected');
            break;
        }
    }

    return { ok: errors.length === 0, errors };
}

/**
 * Safe merge for persistence: keep history, append only new events.
 *
 * @param {unknown} previousLog
 * @param {unknown} proposedLog
 * @returns {{ auditLog: HeroAuditEvent[]; rejected: boolean; errors: string[] }}
 */
export function mergeHeroAuditLogForPersistence(previousLog, proposedLog) {
    const prev = normalizeHeroAuditLog(previousLog);
    if (proposedLog === undefined) {
        return { auditLog: prev, rejected: false, errors: [] };
    }
    const integrity = assertAppendOnlyAuditHistory(prev, proposedLog);
    if (!integrity.ok) {
        const proposed = normalizeHeroAuditLog(proposedLog);
        const prevIds = new Set(prev.map((e) => e.eventId));
        const onlyNew = proposed.filter((e) => !prevIds.has(e.eventId));
        return {
            auditLog: appendHeroAuditEvents(prev, onlyNew),
            rejected: true,
            errors: integrity.errors
        };
    }
    return {
        auditLog: normalizeHeroAuditLog(proposedLog),
        rejected: false,
        errors: []
    };
}

/**
 * Require publish/approval/archive trail when presentation is in those states.
 *
 * @param {{
 *   heroPresentation?: unknown;
 *   auditLog?: unknown;
 * }} record
 * @returns {{ ok: boolean; errors: string[] }}
 */
export function auditPublicHeroTransitionIntegrity(record) {
    /** @type {string[]} */
    const errors = [];
    const presentation =
        record?.heroPresentation && typeof record.heroPresentation === 'object'
            ? /** @type {Record<string, unknown>} */ (record.heroPresentation)
            : {};
    const status = text(presentation.status).toLowerCase();
    const log = normalizeHeroAuditLog(record?.auditLog);

    const hasAction = (/** @type {HeroAuditAction} */ action) =>
        log.some((e) => e.action === action);

    if (status === 'published') {
        if (!hasAction(HERO_AUDIT_ACTIONS.PUBLISHED)) {
            errors.push('public_hero_change_without_publish_audit');
        }
        const publishEvents = log.filter((e) => e.action === HERO_AUDIT_ACTIONS.PUBLISHED);
        for (const e of publishEvents) {
            if (!e.actor) errors.push('missing_actor');
            if (!e.timestamp) errors.push('missing_timestamp');
            if (!e.integrityHash) errors.push('missing_integrity_hash');
        }
    }

    if (status === 'approved') {
        if (!hasAction(HERO_AUDIT_ACTIONS.APPROVED)) {
            errors.push('missing_event_for_state_transition');
        }
    }

    if (status === 'archived') {
        if (!hasAction(HERO_AUDIT_ACTIONS.ARCHIVED)) {
            errors.push('missing_event_for_state_transition');
        }
    }

    for (const e of log) {
        if (HERO_EDITORIAL_LIFECYCLE_ACTIONS.includes(e.action)) {
            if (!e.actor) errors.push('missing_actor');
            if (!e.timestamp) errors.push('missing_timestamp');
            if (isUnauthorizedEditorialSource(e.sourceType || e.source)) {
                errors.push('unauthorized_source_publishing');
            }
            if (e.integrityHash && !verifyHeroAuditIntegrityHash(e)) {
                errors.push('integrity_hash_mismatch');
            }
        }
    }

    return { ok: errors.length === 0, errors: Array.from(new Set(errors)) };
}

/**
 * Build a single lifecycle event helper used by presentation authority.
 *
 * @param {{
 *   record?: Record<string, unknown> | null;
 *   action: HeroAuditAction | string;
 *   previousStatus: string;
 *   newStatus: string;
 *   actor?: string;
 *   actorType?: string;
 *   source?: string;
 *   sourceType?: string;
 *   changedFields?: string[];
 *   timestamp?: number;
 * }} input
 */
export function buildLifecycleAuditEvent(input) {
    const sourceType = normalizeAuditSourceType(input.sourceType ?? input.source);
    return createHeroAuditEvent({
        heroId: resolveHeroAuditHeroId(input.record || null),
        action: input.action,
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
        actor: input.actor || '',
        actorType: input.actorType || 'admin',
        sourceType,
        source: sourceType,
        timestamp: input.timestamp || Date.now(),
        changedFields: input.changedFields || ['status']
    });
}

/**
 * False if any audit event was minted by an unauthorized source.
 * @param {unknown} log
 */
export function auditLogHasUnauthorizedEditorialEvents(log) {
    return normalizeHeroAuditLog(log).some(
        (e) =>
            HERO_EDITORIAL_LIFECYCLE_ACTIONS.includes(e.action) &&
            isUnauthorizedEditorialSource(e.sourceType || e.source)
    );
}
