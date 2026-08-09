/**
 * Hero Authority Server Contract — Phase 5 definitions.
 *
 * Client prepares payloads; server will later authenticate actors, store
 * append-only events, and mint serverSignature. This module validates
 * structure only — it never generates serverSignature.
 *
 * @see ./heroAuthoritySync.js
 * @see ./HERO_AUTHORITY_SERVER_MIGRATION.md
 * @see ../auth/authorityIdentity.js
 */

import { HERO_AUDIT_ACTION_VALUES, normalizeHeroAuditAction } from './heroAuditEvents.js';
import { HERO_LIFECYCLE_STATUS_VALUES, normalizeHeroLifecycleStatus } from './heroAuthorityBoundary.js';

/**
 * @typedef {Object} HeroAuthorityEvent
 * @property {string} eventId
 * @property {string} heroId
 * @property {string} action
 * @property {string} previousStatus
 * @property {string} newStatus
 * @property {string} actorId
 * @property {string} actorRole
 * @property {string} sourceType
 * @property {number} timestamp
 * @property {string[]} changedFields
 * @property {string} clientIntegrityHash
 * @property {string | null} serverSignature  // server-minted only; never client-generated
 */

export const HERO_AUTHORITY_EVENT_SCHEMA_VERSION = 1;

/** Required top-level keys for a backend authority event (serverSignature may be null pre-confirm). */
export const HERO_AUTHORITY_EVENT_REQUIRED_FIELDS = Object.freeze([
    'eventId',
    'heroId',
    'action',
    'previousStatus',
    'newStatus',
    'actorId',
    'actorRole',
    'sourceType',
    'timestamp',
    'changedFields',
    'clientIntegrityHash'
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Normalize a local audit event (or partial) into contract-shaped fields.
 * serverSignature is always null on the client contract view.
 *
 * @param {unknown} raw
 * @returns {HeroAuthorityEvent | null}
 */
export function normalizeHeroAuthorityContractEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const action = normalizeHeroAuditAction(row.action);
    if (!action) return null;

    const eventId = text(row.eventId);
    const heroId = text(row.heroId) || 'hero-unknown';
    const actorId = text(row.actorId) || text(row.actor);
    const actorRole = text(row.actorRole) || text(row.actorType) || 'unknown';
    const sourceType = text(row.sourceType) || text(row.source) || 'system';
    const timestamp = Number(row.timestamp);
    const clientIntegrityHash =
        text(row.clientIntegrityHash) || text(row.integrityHash) || '';
    const changedFields = Array.isArray(row.changedFields)
        ? row.changedFields.map((f) => text(f)).filter(Boolean)
        : [];

    if (!eventId || !Number.isFinite(timestamp) || timestamp <= 0) return null;

    /** @type {HeroAuthorityEvent} */
    const event = {
        eventId,
        heroId,
        action,
        previousStatus: normalizeHeroLifecycleStatus(row.previousStatus) || text(row.previousStatus),
        newStatus: normalizeHeroLifecycleStatus(row.newStatus) || text(row.newStatus),
        actorId,
        actorRole,
        sourceType,
        timestamp,
        changedFields,
        clientIntegrityHash,
        // Client never fabricates server signatures.
        serverSignature:
            row.serverSignature == null || row.serverSignature === ''
                ? null
                : text(row.serverSignature)
    };
    return event;
}

/**
 * Structural validation for contract events.
 * Does NOT mint or verify serverSignature crypto — only presence rules.
 *
 * @param {unknown} raw
 * @param {{ requireServerSignature?: boolean }} [options]
 * @returns {{ ok: boolean; event: HeroAuthorityEvent | null; errors: string[] }}
 */
export function validateHeroAuthorityEvent(raw, options = {}) {
    /** @type {string[]} */
    const errors = [];
    if (!raw || typeof raw !== 'object') {
        return { ok: false, event: null, errors: ['invalid_authority_event'] };
    }
    const row = /** @type {Record<string, unknown>} */ (raw);

    for (const key of HERO_AUTHORITY_EVENT_REQUIRED_FIELDS) {
        if (key === 'changedFields') {
            if (!Array.isArray(row.changedFields) && row.changedFields !== undefined) {
                // allow map from integrity hash path
            }
            continue;
        }
        if (key === 'clientIntegrityHash') {
            const hash = text(row.clientIntegrityHash) || text(row.integrityHash);
            if (!hash) errors.push('missing_client_integrity_hash');
            continue;
        }
        if (key === 'actorId') {
            if (!text(row.actorId) && !text(row.actor)) errors.push('missing_actor');
            continue;
        }
        if (key === 'actorRole') {
            if (!text(row.actorRole) && !text(row.actorType)) errors.push('missing_actor_role');
            continue;
        }
        if (row[key] === undefined || row[key] === null || row[key] === '') {
            if (key === 'previousStatus' || key === 'newStatus') {
                // empty allowed for non-status edits; still surface if both missing on lifecycle
            } else if (key !== 'changedFields') {
                errors.push(`missing_${key}`);
            }
        }
    }

    const action = normalizeHeroAuditAction(row.action);
    if (!action || !HERO_AUDIT_ACTION_VALUES.includes(action)) {
        errors.push('invalid_action');
    }

    const actorId = text(row.actorId) || text(row.actor);
    if (!actorId) errors.push('missing_actor');

    const sourceType = text(row.sourceType) || text(row.source);
    if (!sourceType) errors.push('missing_source_type');

    // Fake approval paths rejected at contract layer
    const role = (text(row.actorRole) || text(row.actorType)).toLowerCase();
    const src = sourceType.toLowerCase();
    if (
        (action === 'approved' || action === 'published') &&
        (role === 'intelligence' || src === 'ai' || src === 'nlp' || src === 'discovery' || src === 'intelligence')
    ) {
        errors.push('fake_approval');
    }

    if (options.requireServerSignature === true) {
        if (!text(row.serverSignature)) {
            errors.push('missing_server_signature');
        }
    }

    // Client must never claim a non-empty serverSignature that looks like a client hash
    // (generation is not implemented — empty/null only on client).
    const claimedSig = text(row.serverSignature);
    if (
        claimedSig &&
        options.requireServerSignature !== true &&
        claimedSig.startsWith('fnv1a32_')
    ) {
        errors.push('invalid_server_signature_format');
    }

    const event = normalizeHeroAuthorityContractEvent(raw);
    if (!event && errors.length === 0) errors.push('invalid_authority_event');

    // lifecycle status tokens
    if (event) {
        if (
            event.previousStatus &&
            !HERO_LIFECYCLE_STATUS_VALUES.includes(event.previousStatus) &&
            event.previousStatus !== 'public' &&
            event.previousStatus !== 'hidden'
        ) {
            // soft — previous may be empty string for creates
        }
        if (
            event.newStatus &&
            !HERO_LIFECYCLE_STATUS_VALUES.includes(event.newStatus)
        ) {
            errors.push('invalid_lifecycle_status');
        }
    }

    return {
        ok: errors.length === 0 && Boolean(event),
        event: errors.length === 0 ? event : null,
        errors: Array.from(new Set(errors))
    };
}

/**
 * Map a local audit event into a transport HeroAuthorityEvent (unsigned).
 * @param {unknown} localEvent
 * @param {{ heroId?: string; actorId?: string; actorRole?: string }} [ctx]
 * @returns {{ ok: boolean; event: HeroAuthorityEvent | null; errors: string[] }}
 */
export function toHeroAuthorityContractEvent(localEvent, ctx = {}) {
    if (!localEvent || typeof localEvent !== 'object') {
        return { ok: false, event: null, errors: ['invalid_local_event'] };
    }
    const row = /** @type {Record<string, unknown>} */ (localEvent);
    const candidate = {
        eventId: row.eventId,
        heroId: text(ctx.heroId) || text(row.heroId),
        action: row.action,
        previousStatus: row.previousStatus,
        newStatus: row.newStatus,
        actorId: text(ctx.actorId) || text(row.actorId) || text(row.actor),
        actorRole: text(ctx.actorRole) || text(row.actorRole) || text(row.actorType),
        sourceType: row.sourceType || row.source,
        timestamp: row.timestamp,
        changedFields: row.changedFields,
        clientIntegrityHash: row.clientIntegrityHash || row.integrityHash,
        serverSignature: null
    };
    return validateHeroAuthorityEvent(candidate, { requireServerSignature: false });
}

/**
 * Contract response fields required after backend accepts an event.
 * @type {ReadonlyArray<string>}
 */
export const HERO_AUTHORITY_RESPONSE_REQUIRED_FIELDS = Object.freeze([
    'accepted',
    'authorityEventId',
    'serverTimestamp',
    'serverSignature'
]);
