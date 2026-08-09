/**
 * In-memory / offline mirror of backend hero_authority validation + signing.
 * Production grants still come from POST /api/hero/authority/events (Rust).
 *
 * Signature versioning:
 *   srv1 — FNV-1a 64 (current)
 *   srv2 — HMAC-SHA256 (prepared; not minted yet)
 *
 * @see ../../../../backend/src/api/hero_authority.rs
 */

export const HERO_AUTHORITY_EVENTS_PATH = '/api/hero/authority/events';

export const HERO_AUTHORITY_SIGNING_PREFIX = 'REELFORGE_HERO_AUTHORITY_V1';

/** Must match backend DEFAULT_DEV_SECRET when env is unset. */
export const HERO_AUTHORITY_DEV_SECRET = 'reelforge-dev-hero-authority';

export const SIGNATURE_VERSION_SRV1 = 'srv1';
/** Reserved for future HMAC-SHA256 migration — not minted/trusted yet. */
export const SIGNATURE_VERSION_SRV2 = 'srv2';

/** Active mint version until srv2 lands. */
export const CURRENT_SIGNATURE_VERSION = SIGNATURE_VERSION_SRV1;

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {string} sig
 * @returns {string}
 */
export function signatureVersionOf(sig) {
    const s = text(sig);
    if (s.startsWith('srv2:')) return SIGNATURE_VERSION_SRV2;
    if (s.startsWith('srv1:')) return SIGNATURE_VERSION_SRV1;
    return 'unknown';
}

/**
 * FNV-1a 64-bit — matches backend mint_server_signature (srv1).
 * @param {string} secret
 * @param {string} authorityEventId
 * @param {string} heroId
 * @param {string} action
 * @param {string} clientHash
 */
export function mintServerSignature(
    secret,
    authorityEventId,
    heroId,
    action,
    clientHash
) {
    const material = [
        HERO_AUTHORITY_SIGNING_PREFIX,
        text(secret) || HERO_AUTHORITY_DEV_SECRET,
        text(authorityEventId),
        text(heroId),
        text(action).toLowerCase(),
        text(clientHash)
    ].join('|');
    let h = 0xcbf29ce484222325n;
    const bytes = new TextEncoder().encode(material);
    for (const b of bytes) {
        h ^= BigInt(b);
        h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return `srv1:${h.toString(16).padStart(16, '0')}`;
}

/**
 * Shape gate for known signature versions.
 * srv2 shape accepted for forward-compat storage, but verify never trusts it yet.
 * @param {string} sig
 */
export function isServerSignatureShape(sig) {
    const s = text(sig);
    if (/^srv1:[0-9a-f]{16}$/i.test(s)) return true;
    // Prepared migration shape (HMAC-SHA256 hex = 64 chars)
    if (/^srv2:[0-9a-f]{64}$/i.test(s)) return true;
    return false;
}

/**
 * Verify a signature when secret is available (engine/offline).
 * Without secret: only shape + srv1 version gate (public clients).
 *
 * @param {{
 *   serverSignature?: string;
 *   authorityEventId?: string;
 *   heroId?: string;
 *   action?: string;
 *   clientIntegrityHash?: string;
 *   clientHash?: string;
 *   secret?: string;
 * }} input
 */
export function verifyServerSignature(input = {}) {
    const sig = text(input.serverSignature);
    if (!isServerSignatureShape(sig)) {
        return { ok: false, reason: 'invalid_signature_shape', signatureVersion: 'unknown' };
    }
    const version = signatureVersionOf(sig);
    if (version === SIGNATURE_VERSION_SRV2) {
        return {
            ok: false,
            reason: 'srv2_not_active',
            signatureVersion: version
        };
    }
    if (version !== SIGNATURE_VERSION_SRV1) {
        return { ok: false, reason: 'unknown_signature_version', signatureVersion: version };
    }
    const secret = text(input.secret);
    if (!secret) {
        // Public client: shape + version gate is the verify surface without secret material.
        return { ok: true, reason: '', signatureVersion: version, weak: true };
    }
    const expected = mintServerSignature(
        secret,
        text(input.authorityEventId),
        text(input.heroId),
        text(input.action) || 'published',
        text(input.clientIntegrityHash || input.clientHash)
    );
    if (expected !== sig) {
        return { ok: false, reason: 'signature_mismatch', signatureVersion: version };
    }
    return { ok: true, reason: '', signatureVersion: version, weak: false };
}

/**
 * @param {unknown} raw
 * @returns {{
 *   authorityEventId: string;
 *   serverTimestamp: number;
 *   serverSignature: string;
 *   signatureVersion: string;
 * } | null}
 */
export function normalizeServerAuthorityReceipt(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const authorityEventId = text(row.authorityEventId || row.eventId);
    const serverTimestamp = Number(row.serverTimestamp);
    const serverSignature = text(row.serverSignature);
    const signatureVersion =
        text(row.signatureVersion) || signatureVersionOf(serverSignature) || CURRENT_SIGNATURE_VERSION;
    if (!authorityEventId) return null;
    if (!Number.isFinite(serverTimestamp) || serverTimestamp <= 0) return null;
    if (!isServerSignatureShape(serverSignature)) return null;
    // srv2 not active as grant yet
    if (signatureVersion === SIGNATURE_VERSION_SRV2 || signatureVersionOf(serverSignature) === SIGNATURE_VERSION_SRV2) {
        return null;
    }
    const check = verifyServerSignature({
        serverSignature,
        authorityEventId,
        signatureVersion
    });
    if (!check.ok) return null;
    return {
        authorityEventId,
        serverTimestamp,
        serverSignature,
        signatureVersion: SIGNATURE_VERSION_SRV1
    };
}

/**
 * Canonical server-granted lifecycle snapshot (Phase 7 single source of truth).
 * @param {unknown} raw
 * @returns {{
 *   status: string;
 *   authorityEventId: string;
 *   serverTimestamp: number;
 *   verified: boolean;
 *   signatureVersion?: string;
 * } | null}
 */
export function normalizeServerAuthorityState(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const status = text(row.status).toLowerCase();
    const authorityEventId = text(row.authorityEventId || row.eventId);
    const serverTimestamp = Number(row.serverTimestamp);
    const verified = row.verified === true;
    if (!status || !authorityEventId) return null;
    if (!Number.isFinite(serverTimestamp) || serverTimestamp <= 0) return null;
    if (!verified) return null;
    return {
        status,
        authorityEventId,
        serverTimestamp,
        verified: true,
        signatureVersion: text(row.signatureVersion) || CURRENT_SIGNATURE_VERSION
    };
}

/**
 * Build serverAuthorityState from a grant receipt + lifecycle status.
 * @param {{
 *   status?: string;
 *   receipt?: unknown;
 *   authorityEventId?: string;
 *   serverTimestamp?: number;
 * }} input
 */
export function buildServerAuthorityState(input = {}) {
    const receipt = normalizeServerAuthorityReceipt(input.receipt);
    const authorityEventId =
        text(input.authorityEventId) || receipt?.authorityEventId || '';
    const serverTimestamp =
        Number(input.serverTimestamp) || receipt?.serverTimestamp || 0;
    const status = text(input.status).toLowerCase() || 'draft';
    if (!authorityEventId || !serverTimestamp || !receipt) return null;
    return {
        status,
        authorityEventId,
        serverTimestamp,
        verified: true,
        signatureVersion: receipt.signatureVersion || CURRENT_SIGNATURE_VERSION
    };
}

/**
 * @param {unknown} record
 */
export function hasValidServerAuthorityReceipt(record) {
    return Boolean(
        normalizeServerAuthorityReceipt(
            /** @type {any} */ (record)?.serverAuthorityReceipt
        )
    );
}

/**
 * True when server (not local cache) grants published lifecycle.
 * @param {unknown} record
 */
export function isServerGrantedPublished(record) {
    const receipt = normalizeServerAuthorityReceipt(
        /** @type {any} */ (record)?.serverAuthorityReceipt
    );
    const state = normalizeServerAuthorityState(
        /** @type {any} */ (record)?.serverAuthorityState
    );
    return Boolean(
        receipt &&
            state &&
            state.verified === true &&
            state.status === 'published' &&
            state.authorityEventId === receipt.authorityEventId
    );
}

/**
 * @param {string} previous
 * @param {string} next
 */
function lifecycleAllowed(previous, next) {
    const p = text(previous).toLowerCase();
    const n = text(next).toLowerCase();
    /** @type {Record<string, string[]>} */
    const graph = {
        draft: ['draft', 'review', 'approved'],
        review: ['review', 'draft', 'approved'],
        approved: ['approved', 'published', 'draft', 'archived'],
        published: ['published', 'archived', 'draft'],
        archived: ['archived', 'draft']
    };
    return (graph[p] || []).includes(n);
}

function isEditorialAction(action) {
    return [
        'created',
        'edited',
        'submitted_for_review',
        'approved',
        'published',
        'archived'
    ].includes(text(action).toLowerCase());
}

function isAiOrDiscovery(source, role) {
    const s = text(source).toLowerCase();
    const r = text(role).toLowerCase();
    return (
        ['ai', 'nlp', 'intelligence', 'discovery', 'system', 'unknown', ''].includes(s) ||
        ['intelligence', 'system', 'ai', 'nlp', 'discovery', 'unknown', ''].includes(r)
    );
}

function isAuthenticatedActor(actorId, actorRole) {
    if (!text(actorId)) return false;
    return ['admin', 'creator', 'master_hero_admin', 'studio', 'user'].includes(
        text(actorRole).toLowerCase()
    );
}

function touchesCreatorTruth(fields, flag) {
    if (flag === true) return true;
    const list = Array.isArray(fields) ? fields : [];
    return list.some((f) => {
        const l = text(f).toLowerCase();
        return (
            l.includes('creatortruth') ||
            l === 'creator_truth' ||
            l.startsWith('creatortruth.') ||
            l.startsWith('creator_truth.')
        );
    });
}

/**
 * Pure validation — mirrors backend validate_authority_event.
 * @param {Record<string, unknown>} req
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
export function validateServerAuthorityEventRequest(req = {}) {
    const heroId = text(req.heroId);
    const action = text(req.action).toLowerCase();
    const previous = text(req.previousStatus).toLowerCase();
    const next = text(req.newStatus).toLowerCase();
    const actorId = text(req.actorId);
    const actorRole = text(req.actorRole);
    const sourceType = text(req.sourceType).toLowerCase();
    const clientHash = text(req.clientIntegrityHash);

    if (!heroId) return { ok: false, reason: 'missing_hero_id' };
    if (!action || !isEditorialAction(action)) {
        return { ok: false, reason: 'missing_audit_metadata' };
    }
    if (!previous || !next || !clientHash || !sourceType) {
        return { ok: false, reason: 'missing_audit_metadata' };
    }
    if (isAiOrDiscovery(sourceType, actorRole)) {
        return { ok: false, reason: 'ai_discovery_editorial_rejected' };
    }
    if (!isAuthenticatedActor(actorId, actorRole)) {
        return { ok: false, reason: 'unauthenticated_actor' };
    }
    if (touchesCreatorTruth(req.changedFields, req.creatorTruthMutation === true)) {
        return { ok: false, reason: 'creator_truth_mutation' };
    }
    if (
        (action === 'published' || next === 'published') &&
        previous !== 'approved' &&
        previous !== 'published'
    ) {
        return { ok: false, reason: 'publish_without_approval' };
    }
    if (
        (action === 'approved' || next === 'approved') &&
        previous !== 'review' &&
        previous !== 'approved'
    ) {
        return { ok: false, reason: 'approval_without_review_state' };
    }
    if (!lifecycleAllowed(previous, next)) {
        return { ok: false, reason: 'invalid_lifecycle_transition' };
    }
    return { ok: true };
}

/**
 * Enforce chronological + lifecycle chain on trusted server events.
 * @param {unknown[]} events
 */
export function validateServerEventOrdering(events) {
    const list = Array.isArray(events) ? events : [];
    /** @type {string[]} */
    const errors = [];
    let chainStatus = '';
    for (let i = 0; i < list.length; i += 1) {
        const row = /** @type {Record<string, unknown>} */ (list[i] || {});
        const ts = Number(row.serverTimestamp);
        if (!Number.isFinite(ts) || ts <= 0) {
            errors.push('invalid_server_timestamp');
        }
        if (i > 0) {
            const prev = /** @type {Record<string, unknown>} */ (list[i - 1] || {});
            const pts = Number(prev.serverTimestamp);
            if (Number.isFinite(pts) && ts < pts) {
                errors.push('server_event_order_invalid');
            }
        }
        const prevStatus = text(row.previousStatus).toLowerCase();
        const nextStatus = text(row.newStatus).toLowerCase();
        if (chainStatus && prevStatus && prevStatus !== chainStatus) {
            errors.push('server_lifecycle_chain_break');
        }
        if (prevStatus && nextStatus && !lifecycleAllowed(prevStatus, nextStatus)) {
            errors.push('server_lifecycle_edge_invalid');
        }
        if (nextStatus) chainStatus = nextStatus;
        if (row.verified === false) {
            errors.push('unverified_server_event');
        }
    }
    return {
        ok: errors.length === 0,
        errors: Array.from(new Set(errors)),
        terminalStatus: chainStatus || 'draft'
    };
}

/**
 * @param {{
 *   authorityEventId?: string;
 *   heroId?: string;
 *   action?: string;
 *   clientIntegrityHash?: string;
 *   secret?: string;
 *   serverTimestamp?: number;
 * }} [input]
 */
export function mintServerAuthorityReceipt(input = {}) {
    const authorityEventId =
        text(input.authorityEventId) ||
        `haevt-test-${Date.now().toString(36)}`;
    const action = text(input.action) || 'published';
    const heroId = text(input.heroId) || 'hero';
    const clientHash = text(input.clientIntegrityHash) || 'fnv1a32_test';
    const secret = text(input.secret) || HERO_AUTHORITY_DEV_SECRET;
    return {
        authorityEventId,
        serverTimestamp:
            Number.isFinite(Number(input.serverTimestamp)) && Number(input.serverTimestamp) > 0
                ? Number(input.serverTimestamp)
                : Date.now(),
        serverSignature: mintServerSignature(
            secret,
            authorityEventId,
            heroId,
            action,
            clientHash
        ),
        signatureVersion: CURRENT_SIGNATURE_VERSION
    };
}

/**
 * Test / offline helper: attach receipt + state for a published record.
 * @param {Record<string, unknown>} record
 * @param {{
 *   authorityEventId?: string;
 *   heroId?: string;
 *   clientIntegrityHash?: string;
 *   secret?: string;
 * }} [input]
 */
export function attachTestServerPublishGrant(record, input = {}) {
    const receipt = mintServerAuthorityReceipt({
        authorityEventId: input.authorityEventId,
        heroId: input.heroId || /** @type {any} */ (record)?.assetId,
        action: 'published',
        clientIntegrityHash: input.clientIntegrityHash,
        secret: input.secret
    });
    const state = buildServerAuthorityState({
        status: 'published',
        receipt
    });
    return {
        ...record,
        serverAuthorityReceipt: receipt,
        serverAuthorityState: state
    };
}
export function createInMemoryHeroAuthorityEngine(options = {}) {
    const secret = text(options.secret) || HERO_AUTHORITY_DEV_SECRET;
    /** @type {Map<string, Record<string, unknown>>} */
    const byId = new Map();
    /** @type {Record<string, unknown>[]} */
    const chronological = [];

    /**
     * @param {Record<string, unknown>} req
     */
    function process(req) {
        const validated = validateServerAuthorityEventRequest(req);
        if (!validated.ok) {
            return { accepted: false, reason: validated.reason };
        }

        const eventId = text(req.eventId || req.authorityEventId);
        const authorityEventId =
            eventId ||
            `haevt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

        if (byId.has(authorityEventId)) {
            return { accepted: false, reason: 'duplicate_authority_event' };
        }

        const action = text(req.action).toLowerCase();
        const heroId = text(req.heroId);
        const clientHash = text(req.clientIntegrityHash);
        const serverSignature = mintServerSignature(
            secret,
            authorityEventId,
            heroId,
            action,
            clientHash
        );
        const serverTimestamp = Date.now();
        const row = {
            eventId: authorityEventId,
            id: authorityEventId,
            heroId,
            action,
            previousStatus: text(req.previousStatus).toLowerCase(),
            newStatus: text(req.newStatus).toLowerCase(),
            actorId: text(req.actorId),
            actorRole: text(req.actorRole).toLowerCase(),
            sourceType: text(req.sourceType).toLowerCase(),
            changedFields: Array.isArray(req.changedFields)
                ? req.changedFields.map((f) => text(f)).filter(Boolean)
                : [],
            createdAt: new Date(serverTimestamp).toISOString(),
            clientHash,
            serverTimestamp,
            serverSignature,
            signatureVersion: CURRENT_SIGNATURE_VERSION,
            verified: true
        };
        byId.set(authorityEventId, row);
        chronological.push(row);

        return {
            accepted: true,
            authorityEventId,
            serverTimestamp,
            serverSignature,
            signatureVersion: CURRENT_SIGNATURE_VERSION
        };
    }

    /**
     * Rehydration payload for a hero (mirrors GET /events/:heroId trusted view).
     * @param {string} heroId
     */
    function rehydrate(heroId) {
        const events = chronological
            .filter((e) => e.heroId === text(heroId))
            .map((e) => {
                const ok = verifyServerSignature({
                    serverSignature: /** @type {string} */ (e.serverSignature),
                    authorityEventId: /** @type {string} */ (e.eventId || e.id),
                    heroId: /** @type {string} */ (e.heroId),
                    action: /** @type {string} */ (e.action),
                    clientHash: /** @type {string} */ (e.clientHash),
                    secret
                });
                if (!ok.ok) return null;
                return {
                    eventId: e.eventId || e.id,
                    heroId: e.heroId,
                    actorId: e.actorId,
                    actorRole: e.actorRole,
                    action: e.action,
                    previousStatus: e.previousStatus,
                    newStatus: e.newStatus,
                    changedFields: e.changedFields,
                    serverTimestamp: e.serverTimestamp,
                    serverSignature: e.serverSignature,
                    signatureVersion: e.signatureVersion || CURRENT_SIGNATURE_VERSION,
                    verified: true
                };
            })
            .filter(Boolean);
        const order = validateServerEventOrdering(events);
        const last = events[events.length - 1];
        return {
            heroId: text(heroId),
            trusted: order.ok,
            orderValid: order.ok,
            events,
            serverAuthorityState: last
                ? {
                      status: text(/** @type {any} */ (last).newStatus),
                      authorityEventId: text(/** @type {any} */ (last).eventId),
                      serverTimestamp: Number(/** @type {any} */ (last).serverTimestamp),
                      verified: true,
                      signatureVersion:
                          text(/** @type {any} */ (last).signatureVersion) ||
                          CURRENT_SIGNATURE_VERSION
                  }
                : null,
            signatureVersion: CURRENT_SIGNATURE_VERSION
        };
    }

    return {
        secret,
        process,
        rehydrate,
        get: (id) => byId.get(text(id)) || null,
        listByHero: (heroId) =>
            chronological.filter((e) => e.heroId === text(heroId)),
        all: () => [...chronological]
    };
}
