/**
 * Hero Authority production runtime (Phase 8).
 *
 * On load: load HeroRecord → fetch server history → verify → merge state → public resolve.
 * Draft stays local; approve/publish/archive require server grants.
 */

import {
    rehydrateHeroAuthorityFromServer,
    requestHeroAuthorityPublish
} from './heroAuthorityRehydration.js';
import {
    loadHeroRecord,
    loadHeroRecordUnverified,
    saveHeroRecord
} from './heroRecord.js';
import { isServerGrantedPublished } from './heroServerAuthorityEngine.js';
import {
    HERO_AUTHORITY_UI_STATE,
    resolveHeroAuthorityUiState
} from './heroAuthorityUiState.js';
import {
    assertNoClientActorEscalation,
    identityCanRequestServerGrant,
    resolveAuthorityIdentity
} from '../auth/authorityIdentity.js';
import { normalizeHeroPresentation } from './heroPresentationAuthority.js';
import { createHeroAuditEvent, appendHeroAuditEvents, normalizeHeroAuditLog } from './heroAuditEvents.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Hydrate local HeroRecord from server authority history.
 * Server state wins; missing server history ⇒ not published.
 *
 * @param {Record<string, unknown> | null | undefined} [record]
 * @param {{
 *   engine?: any;
 *   fetchFn?: typeof fetch;
 *   persist?: boolean;
 * }} [options]
 */
export async function hydrateHeroAuthorityRuntime(record, options = {}) {
    const local =
        record && typeof record === 'object'
            ? { ...record }
            : loadHeroRecordUnverified();

    try {
        const result = await rehydrateHeroAuthorityFromServer(local, {
            engine: options.engine,
            fetchFn: options.fetchFn
        });

        if (!result.ok || !result.record) {
            // No server history / unreachable: wipe local-only published claims.
            const presentation = normalizeHeroPresentation(local.heroPresentation);
            let next = { ...local };
            if (presentation.status === 'published' && !isServerGrantedPublished(local)) {
                next = {
                    ...next,
                    heroPresentation: {
                        ...presentation,
                        status: 'draft',
                        visibility: 'draft'
                    },
                    serverAuthorityReceipt: null,
                    serverAuthorityState: null
                };
            }

            const reason = result.reason || 'rehydration_failed';
            const serverUnavailable =
                reason.includes('network') ||
                reason.includes('unavailable') ||
                reason.includes('fetch') ||
                reason.includes('http_');

            if (options.persist !== false && typeof window !== 'undefined') {
                try {
                    const existingSource = text(local.source);
                    const keepClientCommit =
                        existingSource === 'commit_hero_asset_selection' ||
                        existingSource === 'commit_hero_video_identity' ||
                        existingSource === 'select_hero_asset' ||
                        existingSource === 'commit_hero_asset_clear' ||
                        existingSource.includes('commit_hero') ||
                        existingSource.includes('select_hero');
                    saveHeroRecord({
                        heroPresentation: next.heroPresentation,
                        serverAuthorityReceipt: next.serverAuthorityReceipt,
                        serverAuthorityState: next.serverAuthorityState,
                        ...(keepClientCommit ? {} : { source: 'hero_authority_rehydrate_fail_closed' })
                    });
                } catch {
                    /* ignore */
                }
            }

            return {
                ok: false,
                reason,
                record: next,
                ui: resolveHeroAuthorityUiState(next, {
                    lastError: reason,
                    serverReachable: !serverUnavailable
                }),
                isPublished: false
            };
        }

        const merged = result.record;
        if (options.persist !== false && typeof window !== 'undefined') {
            try {
                saveHeroRecord({
                    ...merged,
                    source: 'hero_authority_rehydrate'
                });
            } catch {
                /* ignore */
            }
        }

        return {
            ok: true,
            reason: '',
            record: merged,
            ui: resolveHeroAuthorityUiState(merged, { serverReachable: true }),
            isPublished: isServerGrantedPublished(merged)
        };
    } catch (err) {
        const reason = text(/** @type {any} */ (err)?.message) || 'server_unavailable';
        return {
            ok: false,
            reason,
            record: local,
            ui: resolveHeroAuthorityUiState(local, {
                lastError: reason,
                serverReachable: false
            }),
            isPublished: isServerGrantedPublished(local)
        };
    }
}

/**
 * Load + hydrate cycle for Hero Vault / Manager.
 * @param {{ engine?: any; fetchFn?: typeof fetch; persist?: boolean }} [options]
 */
export async function loadHydratedHeroAuthority(options = {}) {
    const local = loadHeroRecordUnverified();
    return hydrateHeroAuthorityRuntime(local, options);
}

/**
 * Public-safe record (uses verified load after hydrate when available).
 */
export function resolvePublicAuthorityRecord() {
    return loadHeroRecord();
}

/**
 * Draft-only local save — never grants publication.
 * @param {Record<string, unknown>} patch
 */
export function saveHeroDraftLocally(patch = {}) {
    const presentation = normalizeHeroPresentation(patch.heroPresentation);
    // Force non-public lifecycle for draft path
    if (presentation.status === 'published' || presentation.status === 'approved') {
        presentation.status = 'draft';
        presentation.visibility = 'draft';
    }
    return saveHeroRecord({
        ...patch,
        heroPresentation: presentation,
        // Never write grant fields from draft edits
        source: 'hero_authority_draft_local'
    });
}

/**
 * Request server grant for approve→publish. Requires authenticated identity.
 * Rejects client-supplied actor escalation.
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {Record<string, unknown>} [draft]
 */
export async function requestAuthenticatedHeroPublish(record, draft = {}) {
    const identity = resolveAuthorityIdentity({
        session: /** @type {any} */ (draft).session,
        allowDevIdentity: /** @type {any} */ (draft).allowDevIdentity
    });

    if (!identity.authenticated) {
        return {
            ok: false,
            reason: 'waiting_for_authentication',
            ui: resolveHeroAuthorityUiState(record, {
                identity,
                lastError: 'waiting_for_authentication'
            }),
            published: false,
            record
        };
    }

    if (!identityCanRequestServerGrant(identity)) {
        return {
            ok: false,
            reason: 'invalid_role',
            ui: resolveHeroAuthorityUiState(record, {
                identity,
                lastError: 'invalid_role'
            }),
            published: false,
            record
        };
    }

    const escalate = assertNoClientActorEscalation(identity, {
        actor: /** @type {any} */ (draft).actor,
        approvedBy: /** @type {any} */ (draft).approvedBy,
        actorId: /** @type {any} */ (draft).actorId,
        actorRole: /** @type {any} */ (draft).actorType || /** @type {any} */ (draft).actorRole
    });
    if (!escalate.ok) {
        return {
            ok: false,
            reason: escalate.errors[0] || 'client_supplied_elevated_actor',
            errors: escalate.errors,
            ui: resolveHeroAuthorityUiState(record, {
                identity,
                lastError: 'client_supplied_elevated_actor'
            }),
            published: false,
            record
        };
    }

    // Strip client actor fields — identity is sole grantor source.
    const safeDraft = {
        ...draft,
        actor: identity.actorId,
        approvedBy: identity.actorId,
        actorType: 'admin',
        identity
    };

    const result = await requestHeroAuthorityPublish(record, safeDraft);
    const ui = resolveHeroAuthorityUiState(result.record || record, {
        identity,
        lastError: result.ok ? '' : result.reason,
        pending: false,
        serverReachable: result.reason !== 'network_error' && result.reason !== 'fetch_unavailable'
    });

    return {
        ...result,
        ui,
        published: result.ok === true && result.published === true
    };
}

/**
 * Request server archive grant (server required — not local-only).
 *
 * @param {Record<string, unknown>} record
 * @param {{ engine?: any; fetchFn?: typeof fetch; session?: object }} [options]
 */
export async function requestAuthenticatedHeroArchive(record, options = {}) {
    const identity = resolveAuthorityIdentity({
        session: options.session,
        allowDevIdentity: /** @type {any} */ (options).allowDevIdentity
    });
    if (!identity.authenticated || !identityCanRequestServerGrant(identity)) {
        return {
            ok: false,
            reason: identity.authenticated ? 'invalid_role' : 'waiting_for_authentication',
            published: false,
            record
        };
    }

    const heroId = text(record?.assetId) || 'hero-unknown';
    const prev = normalizeHeroPresentation(record?.heroPresentation);
    const from = prev.status === 'published' ? 'published' : prev.status || 'approved';
    const evt = createHeroAuditEvent({
        heroId,
        action: 'archived',
        previousStatus: from,
        newStatus: 'archived',
        actor: identity.actorId,
        actorType: 'admin',
        sourceType: 'creator',
        timestamp: Date.now(),
        changedFields: ['status']
    });
    if (!evt.ok || !evt.event) {
        return { ok: false, reason: 'audit_event_failed', record };
    }

    const { submitAuthorityEvent, applyServerAuthorityReceipt } = await import(
        './heroAuthoritySync.js'
    );
    const body = {
        eventId: evt.event.eventId,
        heroId,
        action: 'archived',
        previousStatus: from,
        newStatus: 'archived',
        actorId: identity.actorId,
        actorRole: 'admin',
        sourceType: 'creator',
        changedFields: ['status'],
        clientIntegrityHash: evt.event.integrityHash
    };
    // Note: body.actorId must match session — backend binds principal.
    const submitted = await submitAuthorityEvent(body, {
        engine: options.engine,
        fetchFn: options.fetchFn,
        record,
        expectedPublish: false
    });
    if (!submitted.ok || !submitted.receipt) {
        return {
            ok: false,
            reason: submitted.reason || 'server_rejected',
            record
        };
    }

    const applied = applyServerAuthorityReceipt(
        {
            ...record,
            heroPresentation: {
                ...prev,
                status: 'archived',
                visibility: 'draft'
            },
            auditLog: appendHeroAuditEvents(normalizeHeroAuditLog(record?.auditLog), [evt.event])
        },
        submitted.receipt,
        { status: 'archived' }
    );

    return {
        ok: applied.ok,
        reason: '',
        record: applied.record,
        receipt: submitted.receipt
    };
}

export {
    HERO_AUTHORITY_UI_STATE,
    resolveHeroAuthorityUiState,
    requestHeroAuthorityPublish
};
