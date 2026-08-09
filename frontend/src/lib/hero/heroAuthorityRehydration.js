/**
 * Hero Authority Rehydration — server is single source of lifecycle truth (Phase 7).
 *
 * Client: request + cache + display
 * Server: grant final publication
 *
 * @see ./heroAuthoritySync.js
 * @see ./heroServerAuthorityEngine.js
 */

import { API_BASE_URL, fetchWithRetry } from '../api.js';
import { getAdminAuthHeaders, maybeHandleInvalidAdminSession } from '../adminSession.js';
import {
    buildServerAuthorityState,
    CURRENT_SIGNATURE_VERSION,
    HERO_AUTHORITY_EVENTS_PATH,
    isServerGrantedPublished,
    normalizeServerAuthorityReceipt,
    normalizeServerAuthorityState,
    validateServerEventOrdering,
    verifyServerSignature
} from './heroServerAuthorityEngine.js';
import {
    applyServerAuthorityReceipt,
    prepareAuthoritySubmission,
    submitAuthorityEvent
} from './heroAuthoritySync.js';
import {
    approveHeroPresentation,
    normalizeHeroPresentation,
    publishHeroPresentation,
    submitHeroPresentationForReview
} from './heroPresentationAuthority.js';
import { resolveAuthorityIdentity } from '../auth/authorityIdentity.js';
import { createHeroAuditEvent } from './heroAuditEvents.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * GET /api/hero/authority/events/:heroId
 *
 * @param {string} heroId
 * @param {{
 *   engine?: { rehydrate: (id: string) => Record<string, unknown> };
 *   fetchFn?: typeof fetch;
 * }} [options]
 */
export async function fetchHeroAuthorityEvents(heroId, options = {}) {
    const id = text(heroId);
    if (!id) {
        return { ok: false, error: 'missing_hero_id', payload: null };
    }

    if (options.engine && typeof options.engine.rehydrate === 'function') {
        const payload = options.engine.rehydrate(id);
        return { ok: true, error: '', payload };
    }

    const fetchFn = options.fetchFn || globalThis.fetch;
    if (typeof fetchFn !== 'function') {
        return { ok: false, error: 'fetch_unavailable', payload: null };
    }

    const url = `${API_BASE_URL || ''}${HERO_AUTHORITY_EVENTS_PATH}/${encodeURIComponent(id)}`;
    try {
        const res = await (fetchWithRetry
            ? fetchWithRetry(
                  url,
                  {
                      method: 'GET',
                      headers: {
                          Accept: 'application/json',
                          ...getAdminAuthHeaders()
                      }
                  },
                  { retries: 1, notifyReconnectOnFailure: false }
              )
            : fetchFn(url, {
                  method: 'GET',
                  headers: {
                      Accept: 'application/json',
                      ...getAdminAuthHeaders()
                  }
              }));
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            maybeHandleInvalidAdminSession(res, body, 'fetchHeroAuthorityEvents');
            return {
                ok: false,
                error: text(body.error) || `http_${res.status}`,
                payload: null
            };
        }
        return { ok: true, error: '', payload: body };
    } catch (err) {
        return {
            ok: false,
            error: text(/** @type {any} */ (err)?.message) || 'network_error',
            payload: null
        };
    }
}

/**
 * Apply rehydrated server history onto a HeroRecord (cache layers only).
 * Server state overwrites local lifecycle claims for public trust surfaces.
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {Record<string, unknown> | null | undefined} payload
 */
export function applyHeroAuthorityRehydration(record, payload) {
    if (!record || typeof record !== 'object') {
        return { ok: false, record: null, errors: ['record_missing'] };
    }
    if (!payload || typeof payload !== 'object') {
        return { ok: false, record: { ...record }, errors: ['rehydration_payload_missing'] };
    }

    const events = Array.isArray(payload.events) ? payload.events : [];
    const order = validateServerEventOrdering(events);
    if (!order.ok) {
        return {
            ok: false,
            record: { ...record },
            errors: order.errors
        };
    }

    for (const evt of events) {
        const row = /** @type {Record<string, unknown>} */ (evt || {});
        const check = verifyServerSignature({
            serverSignature: text(row.serverSignature),
            authorityEventId: text(row.eventId),
            heroId: text(row.heroId),
            action: text(row.action),
            clientHash: text(row.clientHash)
        });
        if (!check.ok) {
            return {
                ok: false,
                record: { ...record },
                errors: [check.reason || 'signature_unverified']
            };
        }
    }

    const rawState =
        payload.serverAuthorityState ||
        (events.length
            ? {
                  status: text(/** @type {any} */ (events[events.length - 1]).newStatus),
                  authorityEventId: text(/** @type {any} */ (events[events.length - 1]).eventId),
                  serverTimestamp: Number(
                      /** @type {any} */ (events[events.length - 1]).serverTimestamp
                  ),
                  verified: true,
                  signatureVersion:
                      text(/** @type {any} */ (events[events.length - 1]).signatureVersion) ||
                      CURRENT_SIGNATURE_VERSION
              }
            : null);

    const state = normalizeServerAuthorityState(rawState);
    let next = { ...record };

    if (state) {
        next.serverAuthorityState = state;
        const lastPub = [...events]
            .reverse()
            .find((e) => text(/** @type {any} */ (e).action) === 'published');
        if (lastPub || state.status === 'published') {
            const src = lastPub || events[events.length - 1];
            const receipt = normalizeServerAuthorityReceipt({
                authorityEventId: state.authorityEventId,
                serverTimestamp: state.serverTimestamp,
                serverSignature: text(/** @type {any} */ (src)?.serverSignature),
                signatureVersion: state.signatureVersion
            });
            if (receipt) {
                next.serverAuthorityReceipt = receipt;
            }
        }

        // Align local presentation status to server grant only when verified.
        const presentation = normalizeHeroPresentation(record.heroPresentation);
        if (state.status === 'published' && next.serverAuthorityReceipt) {
            next.heroPresentation = {
                ...presentation,
                status: 'published',
                visibility: 'public'
            };
        } else if (state.verified) {
            // Server not published → strip local publish claim
            next.heroPresentation = {
                ...presentation,
                status: state.status || presentation.status || 'draft',
                visibility: state.status === 'published' ? 'public' : 'draft'
            };
            if (state.status !== 'published') {
                // Explicit: local publish without grant becomes non-public.
                if (presentation.status === 'published') {
                    next.heroPresentation = {
                        ...presentation,
                        status: state.status || 'approved',
                        visibility: 'draft'
                    };
                }
            }
        }
    } else {
        // No trusted server history → cannot claim published.
        const presentation = normalizeHeroPresentation(record.heroPresentation);
        if (presentation.status === 'published') {
            next.heroPresentation = {
                ...presentation,
                status: 'draft',
                visibility: 'draft'
            };
            next.serverAuthorityReceipt = null;
            next.serverAuthorityState = null;
        }
    }

    // auditLog remains cache — leave as-is.
    next.authorityCacheOnly = true;

    return {
        ok: true,
        errors: [],
        record: next,
        serverAuthorityState: state,
        isPublished: isServerGrantedPublished(next)
    };
}

/**
 * Fetch + apply rehydration.
 * @param {Record<string, unknown>} record
 * @param {{ engine?: any; fetchFn?: typeof fetch }} [options]
 */
export async function rehydrateHeroAuthorityFromServer(record, options = {}) {
    const heroId =
        text(record?.assetId) ||
        text(/** @type {any} */ (record)?.id) ||
        text(/** @type {any} */ (record)?.heroId);
    const fetched = await fetchHeroAuthorityEvents(heroId, options);
    if (!fetched.ok || !fetched.payload) {
        return {
            ok: false,
            reason: fetched.error || 'rehydration_failed',
            record,
            payload: null
        };
    }
    const applied = applyHeroAuthorityRehydration(record, fetched.payload);
    return {
        ok: applied.ok,
        reason: applied.errors[0] || '',
        record: applied.record,
        payload: fetched.payload,
        isPublished: applied.isPublished
    };
}

/**
 * Server-first publish request (no optimistic published local write).
 *
 * Flow:
 *   create authority request → POST events (review→approved→published as needed)
 *   → persist verified receipt + serverAuthorityState → update UI
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {{
 *   publicTitle?: string;
 *   publicDescription?: string;
 *   publicTheme?: string;
 *   showIntelligence?: boolean;
 *   sourceType?: string;
 *   actor?: string;
 *   actorType?: string;
 *   approvedBy?: string;
 *   engine?: any;
 *   fetchFn?: typeof fetch;
 *   identity?: import('../auth/authorityIdentity.js').AuthorityIdentity;
 * }} [draft]
 */
export async function requestHeroAuthorityPublish(record, draft = {}) {
    const base = record && typeof record === 'object' ? { ...record } : {};
    const identity =
        draft.identity ||
        resolveAuthorityIdentity({
            session: /** @type {any} */ (draft).session
        });
    const actor = text(draft.actor) || text(draft.approvedBy) || identity.actorId;
    const actorType = text(draft.actorType) || identity.role || 'admin';
    const sourceType = text(draft.sourceType) || 'creator';

    // Build local candidate patches without treating them as authority grants.
    const prev = normalizeHeroPresentation(base.heroPresentation);
    let working = { ...base };

    if (prev.status === 'draft' || !prev.status) {
        const reviewed = submitHeroPresentationForReview(working, {
            publicTitle: draft.publicTitle,
            publicDescription: draft.publicDescription,
            publicTheme: draft.publicTheme,
            showIntelligence: draft.showIntelligence,
            actor,
            actorType,
            sourceType
        });
        if (!reviewed.ok || !reviewed.recordPatch) {
            return {
                ok: false,
                reason: 'review_prepare_failed',
                errors: reviewed.errors || [],
                record: base
            };
        }
        working = { ...working, ...reviewed.recordPatch };
    }

    const approved = approveHeroPresentation(working, {
        publicTitle: draft.publicTitle,
        publicDescription: draft.publicDescription,
        publicTheme: draft.publicTheme,
        showIntelligence: draft.showIntelligence,
        approvedBy: actor,
        actor,
        actorType,
        sourceType,
        publish: false
    });
    if (!approved.ok || !approved.recordPatch) {
        return {
            ok: false,
            reason: 'approve_prepare_failed',
            errors: approved.errors || [],
            record: base
        };
    }
    working = { ...working, ...approved.recordPatch };

    const published = publishHeroPresentation(working, {
        actor,
        actorType,
        sourceType,
        approvedBy: actor
    });
    if (!published.ok || !published.recordPatch) {
        return {
            ok: false,
            reason: 'publish_prepare_failed',
            errors: published.errors || [],
            record: base
        };
    }

    // Do NOT save yet — only after server grants.
    const candidate = {
        ...working,
        ...published.recordPatch
    };

    // Build server-legal chain: review → approved → published (client audit is cache only).
    const heroId = text(base.assetId) || 'hero-unknown';
    const ts = Date.now();
    const reviewEvt = createHeroAuditEvent({
        heroId,
        action: 'submitted_for_review',
        previousStatus: 'draft',
        newStatus: 'review',
        actor,
        actorType,
        sourceType,
        timestamp: ts - 2,
        changedFields: ['status']
    });
    const approveEvt = createHeroAuditEvent({
        heroId,
        action: 'approved',
        previousStatus: 'review',
        newStatus: 'approved',
        actor,
        actorType,
        sourceType,
        timestamp: ts - 1,
        changedFields: ['status', 'publicTitle', 'publicDescription', 'publicTheme']
    });
    const publishEvt = createHeroAuditEvent({
        heroId,
        action: 'published',
        previousStatus: 'approved',
        newStatus: 'published',
        actor,
        actorType,
        sourceType,
        timestamp: ts,
        changedFields: ['status']
    });
    if (!reviewEvt.ok || !approveEvt.ok || !publishEvt.ok) {
        return {
            ok: false,
            reason: 'audit_event_prepare_failed',
            errors: [
                ...(reviewEvt.errors || []),
                ...(approveEvt.errors || []),
                ...(publishEvt.errors || [])
            ],
            record: base,
            published: false
        };
    }

    const eventsToSubmit = [reviewEvt.event, approveEvt.event, publishEvt.event];

    // Candidate cache trail (not authority)
    candidate.auditLog = eventsToSubmit;

    let current = { ...base };
    /** @type {ReturnType<typeof normalizeServerAuthorityReceipt>} */
    let lastReceipt = null;

    for (const evt of eventsToSubmit) {
        const row = /** @type {Record<string, unknown>} */ (evt);
        const action = text(row.action);
        const body = {
            eventId: text(row.eventId),
            heroId,
            action,
            previousStatus: text(row.previousStatus),
            newStatus: text(row.newStatus),
            actorId: actor,
            actorRole: actorType === 'admin' || actorType === 'master_hero_admin' ? 'admin' : actorType,
            sourceType,
            changedFields: Array.isArray(row.changedFields) ? row.changedFields : ['status'],
            clientIntegrityHash: text(row.integrityHash || row.clientIntegrityHash)
        };
        if (!body.clientIntegrityHash) {
            return {
                ok: false,
                reason: 'missing_client_integrity_hash',
                errors: ['missing_client_integrity_hash'],
                record: base,
                published: false
            };
        }

        const submitted = await submitAuthorityEvent(body, {
            engine: draft.engine,
            fetchFn: draft.fetchFn,
            record: current,
            expectedPublish: action === 'published'
        });
        if (!submitted.ok || !submitted.receipt) {
            return {
                ok: false,
                reason: submitted.reason || 'server_rejected',
                errors: submitted.errors || [],
                record: base,
                published: false
            };
        }
        lastReceipt = submitted.receipt;
        current = submitted.record || current;
    }

    if (!lastReceipt) {
        return {
            ok: false,
            reason: 'no_server_receipt',
            errors: ['no_server_receipt'],
            record: base,
            published: false
        };
    }

    const withReceipt = applyServerAuthorityReceipt(candidate, lastReceipt);
    if (!withReceipt.ok || !withReceipt.record) {
        return {
            ok: false,
            reason: 'receipt_apply_failed',
            errors: withReceipt.errors || [],
            record: base,
            published: false
        };
    }

    const state = buildServerAuthorityState({
        status: 'published',
        receipt: lastReceipt
    });
    const finalRecord = {
        ...withReceipt.record,
        serverAuthorityState: state,
        // Local audit is cache of the request trail
        auditLog: candidate.auditLog,
        heroPresentation: candidate.heroPresentation
    };

    return {
        ok: true,
        reason: '',
        errors: [],
        record: finalRecord,
        receipt: lastReceipt,
        serverAuthorityState: state,
        published: isServerGrantedPublished(finalRecord) === true,
        recordPatch: {
            creatorTruth: finalRecord.creatorTruth,
            adminContext: finalRecord.adminContext,
            heroPresentation: finalRecord.heroPresentation,
            visibility: finalRecord.visibility,
            auditLog: finalRecord.auditLog,
            serverAuthorityReceipt: finalRecord.serverAuthorityReceipt,
            serverAuthorityState: finalRecord.serverAuthorityState
        }
    };
}

// Re-export for callers
export {
    isServerGrantedPublished,
    prepareAuthoritySubmission
};
