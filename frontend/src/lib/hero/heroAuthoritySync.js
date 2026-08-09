/**
 * Hero Authority Sync — production handoff layer for server authority grants.
 *
 * Client verification remains required. Server is the final source of publish truth.
 *
 * Flow:
 *   validateHeroTransition → createHeroAuditEvent → prepareAuthoritySubmission
 *   → submitAuthorityEvent (POST /api/hero/authority/events)
 *   → validateAuthorityResponse → persist serverAuthorityReceipt on HeroRecord
 *
 * Roles:
 * - Frontend authority: requests publication
 * - Backend authority: grants publication (signed receipt)
 * - Viewer: only displays verified publication
 *
 * @see ./heroAuthorityContract.js
 * @see ./heroAuthorityBoundary.js
 * @see ./heroAuditEvents.js
 * @see ./heroServerAuthorityEngine.js
 * @see ../auth/authorityIdentity.js
 */

import { API_BASE_URL, fetchWithRetry } from '../api.js';
import {
    getAdminAuthHeaders,
    maybeHandleInvalidAdminSession
} from '../adminSession.js';
import {
    normalizeHeroAuditEvent,
    normalizeHeroAuditLog,
    verifyHeroAuditIntegrityHash
} from './heroAuditEvents.js';
import { normalizeHeroAuthoritySourceType } from './heroAuthorityBoundary.js';
import {
    HERO_AUTHORITY_EVENT_SCHEMA_VERSION,
    toHeroAuthorityContractEvent,
    validateHeroAuthorityEvent
} from './heroAuthorityContract.js';
import {
    resolveAuthorityIdentity,
    identityToActorType
} from '../auth/authorityIdentity.js';
import {
    HERO_AUTHORITY_EVENTS_PATH,
    normalizeServerAuthorityReceipt,
    buildServerAuthorityState,
    CURRENT_SIGNATURE_VERSION
} from './heroServerAuthorityEngine.js';

/**
 * @typedef {Object} PendingHeroAuthoritySync
 * @property {string} syncId
 * @property {'pending' | 'ready' | 'rejected'} status
 * @property {number} createdAt
 * @property {Record<string, unknown>} payload
 * @property {string[]} validationErrors
 */

/**
 * @typedef {{
 *   authorityEventId: string;
 *   serverTimestamp: number;
 *   serverSignature: string;
 * }} ServerAuthorityReceipt
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Serialize a single audit event for transport (stable field set + contract fields).
 * @param {unknown} event
 * @returns {Record<string, unknown> | null}
 */
export function serializeHeroAuthorityEvent(event) {
    const row = normalizeHeroAuditEvent(event);
    if (!row) return null;
    const contract = toHeroAuthorityContractEvent(row);
    if (contract.ok && contract.event) {
        return {
            ...contract.event,
            // Legacy mirrors for older readers
            actor: contract.event.actorId,
            actorType: contract.event.actorRole,
            integrityHash: contract.event.clientIntegrityHash,
            schemaVersion: HERO_AUTHORITY_EVENT_SCHEMA_VERSION
        };
    }
    return {
        eventId: row.eventId,
        heroId: row.heroId,
        action: row.action,
        previousStatus: row.previousStatus,
        newStatus: row.newStatus,
        actor: row.actor,
        actorId: row.actor,
        actorType: row.actorType,
        actorRole: row.actorType,
        sourceType: normalizeHeroAuthoritySourceType(row.sourceType),
        timestamp: row.timestamp,
        changedFields: [...row.changedFields],
        integrityHash: row.integrityHash,
        clientIntegrityHash: row.integrityHash,
        serverSignature: null,
        schemaVersion: HERO_AUTHORITY_EVENT_SCHEMA_VERSION
    };
}

/**
 * Build a pending sync envelope for backend authority enforcement.
 *
 * @param {{
 *   heroId?: string;
 *   record?: Record<string, unknown> | null;
 *   events?: unknown[];
 *   heroPresentation?: unknown;
 *   creatorTruth?: unknown;
 *   lifecycleStatus?: string;
 * }} input
 * @returns {PendingHeroAuthoritySync}
 */
export function createPendingAuthoritySync(input = {}) {
    const events = Array.isArray(input.events) ? input.events : [];
    const serialized = events.map(serializeHeroAuthorityEvent).filter(Boolean);
    const heroId =
        text(input.heroId) ||
        text(input.record?.assetId) ||
        (serialized[0] && text(/** @type {any} */ (serialized[0]).heroId)) ||
        'hero-unknown';

    /** @type {string[]} */
    const validationErrors = [];
    for (const evt of events) {
        const n = normalizeHeroAuditEvent(evt);
        if (!n) {
            validationErrors.push('invalid_event');
            continue;
        }
        if (!verifyHeroAuditIntegrityHash(n)) {
            validationErrors.push('integrity_hash_mismatch');
        }
    }

    const syncId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? `hero-sync-${crypto.randomUUID()}`
            : `hero-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return {
        syncId,
        status: validationErrors.length ? 'rejected' : 'pending',
        createdAt: Date.now(),
        payload: {
            heroId,
            lifecycleStatus: text(input.lifecycleStatus),
            heroPresentation: input.heroPresentation || null,
            creatorTruthFingerprint: input.creatorTruth
                ? {
                      title: text(/** @type {any} */ (input.creatorTruth).title),
                      immutable: /** @type {any} */ (input.creatorTruth).immutable !== false
                  }
                : null,
            intelligenceContext: null,
            discoveryContext: null,
            events: serialized,
            auditLogLength: normalizeHeroAuditLog(input.record?.auditLog).length + serialized.length,
            transport: {
                method: 'POST',
                path: HERO_AUTHORITY_EVENTS_PATH,
                contentType: 'application/json'
            }
        },
        validationErrors
    };
}

/**
 * Convert local events + transition into a backend-ready submission payload.
 *
 * @param {{
 *   record?: Record<string, unknown> | null;
 *   events?: unknown[];
 *   previousStatus?: string;
 *   nextStatus?: string;
 *   action?: string;
 *   sourceType?: string;
 *   heroPresentation?: unknown;
 *   creatorTruth?: unknown;
 *   identity?: import('../auth/authorityIdentity.js').AuthorityIdentity;
 *   session?: object;
 * }} input
 * @returns {{
 *   ok: boolean;
 *   payload: Record<string, unknown> | null;
 *   errors: string[];
 * }}
 */
export function prepareAuthoritySubmission(input = {}) {
    /** @type {string[]} */
    const errors = [];
    const identity =
        input.identity ||
        resolveAuthorityIdentity({
            session: /** @type {any} */ (input.session)
        });

    if (!identity.authenticated || !text(identity.actorId)) {
        errors.push('missing_actor');
    }

    const events = Array.isArray(input.events) ? input.events : [];
    if (!events.length) {
        errors.push('missing_events');
    }

    const heroId =
        text(input.record?.assetId) ||
        text(/** @type {any} */ (input.record)?.id) ||
        'hero-unknown';

    /** @type {import('./heroAuthorityContract.js').HeroAuthorityEvent[]} */
    const contractEvents = [];
    for (const evt of events) {
        const mapped = toHeroAuthorityContractEvent(evt, {
            heroId,
            actorId: identity.actorId,
            actorRole: identity.role || identityToActorType(identity)
        });
        if (!mapped.ok || !mapped.event) {
            errors.push(...(mapped.errors.length ? mapped.errors : ['invalid_event']));
            continue;
        }
        if (
            mapped.event.action === 'approved' ||
            mapped.event.action === 'published'
        ) {
            const role = mapped.event.actorRole.toLowerCase();
            const src = mapped.event.sourceType.toLowerCase();
            if (
                role === 'intelligence' ||
                src === 'ai' ||
                src === 'nlp' ||
                src === 'discovery'
            ) {
                errors.push('fake_approval');
            }
        }
        // Client submissions never carry a server signature.
        contractEvents.push({ ...mapped.event, serverSignature: null });
    }

    const previousStatus = text(input.previousStatus);
    const nextStatus = text(input.nextStatus);
    const action = text(input.action);

    if (errors.length) {
        return { ok: false, payload: null, errors: Array.from(new Set(errors)) };
    }

    return {
        ok: true,
        errors: [],
        payload: {
            schemaVersion: HERO_AUTHORITY_EVENT_SCHEMA_VERSION,
            preparedAt: Date.now(),
            heroRecordRef: {
                heroId,
                assetId: text(input.record?.assetId),
                revision: Number(input.record?.revision) || 0,
                updatedAt: Number(input.record?.updatedAt) || 0
            },
            lifecycleTransition: {
                action,
                previousStatus,
                nextStatus
            },
            provenance: {
                sourceType: normalizeHeroAuthoritySourceType(input.sourceType),
                actorId: identity.actorId,
                actorRole: identity.role,
                permissions: [...(identity.permissions || [])],
                identitySource: identity.source || 'unknown',
                authenticated: identity.authenticated === true
            },
            creatorTruthFingerprint: input.creatorTruth
                ? {
                      title: text(/** @type {any} */ (input.creatorTruth).title),
                      immutable: /** @type {any} */ (input.creatorTruth).immutable !== false
                  }
                : null,
            heroPresentation: input.heroPresentation || null,
            // Explicit non-authority layers
            intelligenceContext: null,
            discoveryContext: null,
            events: contractEvents,
            transport: {
                method: 'POST',
                path: HERO_AUTHORITY_EVENTS_PATH,
                contentType: 'application/json'
            }
        }
    };
}

/**
 * Flatten prepareAuthoritySubmission payload (or a contract event) into the POST body.
 *
 * @param {Record<string, unknown> | null | undefined} submission
 * @returns {Record<string, unknown> | null}
 */
export function buildAuthorityEventRequestBody(submission) {
    if (!submission || typeof submission !== 'object') return null;

    // Already flat wire format
    if (text(submission.heroId) && text(submission.clientIntegrityHash || submission.clientHash)) {
        return {
            eventId: text(submission.eventId) || undefined,
            heroId: text(submission.heroId),
            action: text(submission.action),
            previousStatus: text(submission.previousStatus),
            newStatus: text(submission.newStatus),
            actorId: text(submission.actorId),
            actorRole: text(submission.actorRole),
            sourceType: text(submission.sourceType),
            changedFields: Array.isArray(submission.changedFields)
                ? submission.changedFields.map((f) => text(f)).filter(Boolean)
                : [],
            clientIntegrityHash: text(submission.clientIntegrityHash || submission.clientHash),
            creatorTruthMutation: submission.creatorTruthMutation === true
        };
    }

    const events = Array.isArray(submission.events) ? submission.events : [];
    const primary =
        events.find((e) => {
            const a = text(/** @type {any} */ (e)?.action).toLowerCase();
            return a === 'published' || a === 'approved';
        }) || events[events.length - 1];

    if (!primary || typeof primary !== 'object') return null;
    const evt = /** @type {Record<string, unknown>} */ (primary);
    const lt =
        submission.lifecycleTransition && typeof submission.lifecycleTransition === 'object'
            ? /** @type {Record<string, unknown>} */ (submission.lifecycleTransition)
            : {};
    const prov =
        submission.provenance && typeof submission.provenance === 'object'
            ? /** @type {Record<string, unknown>} */ (submission.provenance)
            : {};
    const heroId =
        text(/** @type {any} */ (submission.heroRecordRef)?.heroId) ||
        text(evt.heroId) ||
        text(submission.heroId);

    return {
        eventId: text(evt.eventId) || undefined,
        heroId,
        action: text(lt.action) || text(evt.action),
        previousStatus: text(lt.previousStatus) || text(evt.previousStatus),
        newStatus: text(lt.nextStatus) || text(evt.newStatus),
        actorId: text(prov.actorId) || text(evt.actorId),
        actorRole: text(prov.actorRole) || text(evt.actorRole),
        sourceType: text(prov.sourceType) || text(evt.sourceType),
        changedFields: Array.isArray(evt.changedFields)
            ? evt.changedFields.map((f) => text(f)).filter(Boolean)
            : [],
        clientIntegrityHash: text(evt.clientIntegrityHash || evt.integrityHash),
        creatorTruthMutation: false
    };
}

/**
 * Fail-closed validation of a backend authority response.
 *
 * @param {unknown} response
 * @param {{ expectedPublish?: boolean }} [options]
 */
export function validateAuthorityResponse(response, options = {}) {
    /** @type {string[]} */
    const errors = [];
    if (!response || typeof response !== 'object') {
        return {
            ok: false,
            errors: ['invalid_server_response'],
            authorityEventId: '',
            serverTimestamp: null,
            serverSignature: '',
            receipt: null
        };
    }
    const row = /** @type {Record<string, unknown>} */ (response);

    const accepted = row.accepted === true || row.ok === true;
    if (!accepted) {
        errors.push('server_rejected_or_unconfirmed');
        if (text(row.reason)) errors.push(text(row.reason));
    }

    const authorityEventId =
        text(row.authorityEventId) ||
        text(row.eventId) ||
        (Array.isArray(row.acceptedEventIds) ? text(row.acceptedEventIds[0]) : '');

    if (accepted && !authorityEventId) {
        errors.push('accepted_without_authority_event_id');
    }

    const serverTimestamp = Number(row.serverTimestamp);
    if (!Number.isFinite(serverTimestamp) || serverTimestamp <= 0) {
        errors.push('missing_server_timestamp');
    }

    const serverSignature = text(row.serverSignature);
    if (!serverSignature) {
        errors.push('missing_signature');
        errors.push('unsigned_publish_response');
    }

    if (options.expectedPublish === true) {
        if (!accepted) {
            errors.push('published_without_server_confirmation');
        }
        if (accepted && !authorityEventId) {
            errors.push('published_without_server_confirmation');
        }
        if (accepted && !serverSignature) {
            errors.push('published_without_server_confirmation');
        }
    }

    if (row.intelligenceAsIdentity === true || row.promoteIntelligence === true) {
        errors.push('server_cannot_promote_intelligence_to_identity');
    }

    const receipt =
        accepted && authorityEventId && serverSignature && Number.isFinite(serverTimestamp)
            ? normalizeServerAuthorityReceipt({
                  authorityEventId,
                  serverTimestamp,
                  serverSignature,
                  signatureVersion:
                      text(row.signatureVersion) || CURRENT_SIGNATURE_VERSION
              })
            : null;

    if (accepted && !receipt) {
        errors.push('invalid_server_authority_receipt');
    }

    return {
        ok: errors.length === 0 && Boolean(receipt),
        errors: Array.from(new Set(errors)),
        authorityEventId,
        serverTimestamp: Number.isFinite(serverTimestamp) ? serverTimestamp : null,
        serverSignature,
        receipt
    };
}

/**
 * Persist server authority receipt onto a HeroRecord-shaped object (in memory).
 * Also stamps serverAuthorityState when lifecycle status is known.
 * @param {Record<string, unknown> | null | undefined} record
 * @param {ServerAuthorityReceipt | null | undefined} receipt
 * @param {{ status?: string }} [options]
 */
export function applyServerAuthorityReceipt(record, receipt, options = {}) {
    const normalized = normalizeServerAuthorityReceipt(receipt);
    if (!record || typeof record !== 'object' || !normalized) {
        return {
            ok: false,
            record: record && typeof record === 'object' ? { ...record } : null,
            errors: ['invalid_server_authority_receipt']
        };
    }
    const status =
        text(options.status) ||
        text(/** @type {any} */ (record)?.heroPresentation?.status) ||
        'published';
    const state = buildServerAuthorityState({
        status,
        receipt: normalized
    });
    return {
        ok: true,
        errors: [],
        record: {
            ...record,
            serverAuthorityReceipt: {
                ...normalized,
                signatureVersion: normalized.signatureVersion || CURRENT_SIGNATURE_VERSION
            },
            serverAuthorityState: state
        }
    };
}

/**
 * POST authority event → validate response → optional record merge.
 *
 * @param {Record<string, unknown> | null | undefined} submission
 *   prepareAuthoritySubmission payload OR flat wire body
 * @param {{
 *   engine?: { process: (req: Record<string, unknown>) => Record<string, unknown> };
 *   fetchFn?: typeof fetch;
 *   record?: Record<string, unknown> | null;
 *   expectedPublish?: boolean;
 *   skipNetwork?: boolean;
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean;
 *   accepted: boolean;
 *   reason: string;
 *   errors: string[];
 *   response: Record<string, unknown> | null;
 *   receipt: ServerAuthorityReceipt | null;
 *   record: Record<string, unknown> | null;
 * }>}
 */
export async function submitAuthorityEvent(submission, options = {}) {
    const body = buildAuthorityEventRequestBody(submission);
    if (!body || !text(body.heroId) || !text(body.clientIntegrityHash)) {
        return {
            ok: false,
            accepted: false,
            reason: 'invalid_submission',
            errors: ['invalid_submission'],
            response: null,
            receipt: null,
            record: options.record || null
        };
    }

    /** @type {Record<string, unknown> | null} */
    let response = null;

    if (options.engine && typeof options.engine.process === 'function') {
        response = /** @type {Record<string, unknown>} */ (options.engine.process(body));
    } else if (options.skipNetwork === true) {
        return {
            ok: false,
            accepted: false,
            reason: 'network_disabled',
            errors: ['network_disabled'],
            response: null,
            receipt: null,
            record: options.record || null
        };
    } else {
        const fetchFn = options.fetchFn || globalThis.fetch;
        if (typeof fetchFn !== 'function') {
            return {
                ok: false,
                accepted: false,
                reason: 'fetch_unavailable',
                errors: ['fetch_unavailable'],
                response: null,
                receipt: null,
                record: options.record || null
            };
        }
        const url = `${API_BASE_URL || ''}${HERO_AUTHORITY_EVENTS_PATH}`;
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...getAdminAuthHeaders()
        };
        try {
            const res = await (fetchWithRetry
                ? fetchWithRetry(
                      url,
                      {
                          method: 'POST',
                          headers,
                          body: JSON.stringify(body)
                      },
                      { retries: 1, notifyReconnectOnFailure: false }
                  )
                : fetchFn(url, {
                      method: 'POST',
                      headers,
                      body: JSON.stringify(body)
                  }));
            response = /** @type {Record<string, unknown>} */ (
                await res.json().catch(() => ({
                    accepted: false,
                    reason: `http_${res.status}`
                }))
            );
            if (!res.ok && response.accepted !== true) {
                maybeHandleInvalidAdminSession(res, response, 'submitAuthorityEvent');
                if (!text(response.reason)) {
                    response = {
                        accepted: false,
                        reason: text(response.error) || `http_${res.status}`
                    };
                }
            }
        } catch (err) {
            return {
                ok: false,
                accepted: false,
                reason: 'network_error',
                errors: ['network_error', text(/** @type {any} */ (err)?.message)],
                response: null,
                receipt: null,
                record: options.record || null
            };
        }
    }

    const expectedPublish =
        options.expectedPublish === true ||
        text(body.action).toLowerCase() === 'published' ||
        text(body.newStatus).toLowerCase() === 'published';

    const validated = validateAuthorityResponse(response, { expectedPublish });
    if (!validated.ok || !validated.receipt) {
        return {
            ok: false,
            accepted: response?.accepted === true,
            reason:
                text(response?.reason) ||
                validated.errors[0] ||
                'server_rejected_or_unconfirmed',
            errors: validated.errors,
            response,
            receipt: null,
            record: options.record || null
        };
    }

    let nextRecord = options.record || null;
    if (nextRecord) {
        const applied = applyServerAuthorityReceipt(nextRecord, validated.receipt, {
            status: text(body.newStatus) || 'published'
        });
        nextRecord = applied.record;
    }

    return {
        ok: true,
        accepted: true,
        reason: '',
        errors: [],
        response,
        receipt: validated.receipt,
        record: nextRecord
    };
}

/**
 * Legacy alias — maps older ok/acceptedEventIds envelope through fail-closed path when possible.
 * Prefer validateAuthorityResponse for Phase 5+ clients.
 *
 * @param {unknown} response
 * @returns {{ ok: boolean; errors: string[]; acceptedEventIds: string[] }}
 */
export function validateServerAuthorityResponse(response) {
    if (!response || typeof response !== 'object') {
        return { ok: false, errors: ['invalid_server_response'], acceptedEventIds: [] };
    }
    const row = /** @type {Record<string, unknown>} */ (response);

    // New contract shape
    if (
        row.authorityEventId !== undefined ||
        row.serverSignature !== undefined ||
        row.serverTimestamp !== undefined
    ) {
        const modern = validateAuthorityResponse(response);
        return {
            ok: modern.ok,
            errors: modern.errors,
            acceptedEventIds: modern.authorityEventId ? [modern.authorityEventId] : []
        };
    }

    // Legacy envelope (pre Phase 5 validators)
    /** @type {string[]} */
    const errors = [];
    if (row.ok !== true && row.accepted !== true) {
        errors.push('server_rejected_or_unconfirmed');
    }
    const acceptedEventIds = Array.isArray(row.acceptedEventIds)
        ? row.acceptedEventIds.map((id) => text(id)).filter(Boolean)
        : Array.isArray(row.eventIds)
          ? row.eventIds.map((id) => text(id)).filter(Boolean)
          : [];

    if ((row.ok === true || row.accepted === true) && acceptedEventIds.length === 0 && row.allowEmpty !== true) {
        errors.push('missing_accepted_event_ids');
    }
    if (row.intelligenceAsIdentity === true || row.promoteIntelligence === true) {
        errors.push('server_cannot_promote_intelligence_to_identity');
    }

    return {
        ok: errors.length === 0,
        errors,
        acceptedEventIds
    };
}

// Re-export contract helpers for callers that only import sync.
export { validateHeroAuthorityEvent };
