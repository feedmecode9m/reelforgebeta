/**
 * Hero Authority Read Verification (Phase 4).
 *
 * Separation of concerns:
 *
 * Authority:     "Who is allowed to publish?"   → heroAuthorityBoundary
 * Verification:  "Can this state be trusted?"   → this module
 * Presentation:  "What does the public see?"    → resolvePublicHeroViewerCopy
 * Intelligence:  "What does NLP suggest?"       → never identity
 * Discovery:     "How is content categorized?"  → never identity
 *
 * Fail closed: never silently repair localStorage. Invalid / tampered
 * records must not assert public publish lifecycle claims.
 *
 * @see ./heroAuditEvents.js
 * @see ./heroAuthorityBoundary.js
 * @see ./heroPresentationAuthority.js
 * @see ./heroIntegrityDiagnostics.js
 */

import {
    HERO_AUDIT_ACTIONS,
    HERO_EDITORIAL_LIFECYCLE_ACTIONS,
    computeHeroAuditIntegrityHash,
    isUnauthorizedEditorialSource,
    normalizeHeroAuditAction,
    normalizeAuditSourceType
} from './heroAuditEvents.js';
import {
    HERO_LIFECYCLE_STATUS,
    HERO_LIFECYCLE_STATUS_VALUES,
    HERO_LIFECYCLE_TRANSITIONS,
    normalizeHeroLifecycleStatus
} from './heroAuthorityBoundary.js';
import {
    hasValidServerAuthorityReceipt,
    isServerGrantedPublished,
    normalizeServerAuthorityState
} from './heroServerAuthorityEngine.js';

/**
 * @typedef {Object} HeroVerificationResult
 * @property {boolean} verified
 * @property {string} reason
 * @property {string[]} violations
 * @property {Record<string, unknown> | null} record
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Local creatorTruth snapshot (avoids circular import with presentationAuthority).
 * @param {unknown} raw
 */
function readCreatorTruth(raw) {
    if (!raw || typeof raw !== 'object') {
        return { title: '', description: '', immutable: true, present: false };
    }
    const row = /** @type {Record<string, unknown>} */ (raw);
    return {
        title: text(row.title),
        description: text(row.description),
        immutable: row.immutable !== false,
        present: true,
        rawImmutable: row.immutable
    };
}

/**
 * Local presentation snapshot.
 * @param {unknown} raw
 */
function readPresentation(raw) {
    if (!raw || typeof raw !== 'object') {
        return {
            status: HERO_LIFECYCLE_STATUS.DRAFT,
            approvedBy: '',
            approvedAt: null,
            publicTitle: '',
            publicDescription: '',
            publicTheme: ''
        };
    }
    const row = /** @type {Record<string, unknown>} */ (raw);
    const status = normalizeHeroLifecycleStatus(row.status || row.visibility);
    return {
        status,
        approvedBy: text(row.approvedBy),
        approvedAt:
            row.approvedAt == null || row.approvedAt === ''
                ? null
                : Number(row.approvedAt) || null,
        publicTitle: text(row.publicTitle),
        publicDescription: text(row.publicDescription),
        publicTheme: text(row.publicTheme)
    };
}

/**
 * Parse one audit row strictly for verification.
 * Does NOT recompute missing integrityHash (no silent repair).
 *
 * @param {unknown} raw
 * @returns {{ ok: true; event: import('./heroAuditEvents.js').HeroAuditEvent } | { ok: false; violations: string[] }}
 */
export function parseAuditEventStrict(raw) {
    /** @type {string[]} */
    const violations = [];
    if (!raw || typeof raw !== 'object') {
        return { ok: false, violations: ['invalid_audit_event'] };
    }
    const row = /** @type {Record<string, unknown>} */ (raw);
    const action = normalizeHeroAuditAction(row.action);
    if (!action) {
        return { ok: false, violations: ['invalid_audit_action'] };
    }
    const eventId = text(row.eventId);
    const timestamp = Number(row.timestamp);
    if (!eventId) violations.push('missing_event_id');
    if (!Number.isFinite(timestamp) || timestamp <= 0) violations.push('missing_timestamp');

    const actor = text(row.actor);
    const actorType = text(row.actorType) || 'unknown';
    const sourceType = normalizeAuditSourceType(row.sourceType ?? row.source);
    const previousStatus = text(row.previousStatus);
    const newStatus = text(row.newStatus);
    const heroId = text(row.heroId);
    const changedFields = Array.isArray(row.changedFields)
        ? row.changedFields.map((f) => text(f)).filter(Boolean)
        : [];
    const claimedHash = text(row.integrityHash);
    if (!claimedHash) {
        violations.push('missing_integrity_hash');
    }

    const expectedHash = computeHeroAuditIntegrityHash({
        eventId,
        heroId,
        action,
        previousStatus,
        newStatus,
        actor,
        actorType,
        sourceType,
        timestamp,
        changedFields
    });
    if (claimedHash && claimedHash !== expectedHash) {
        violations.push('audit_hash_mismatch');
    }

    if (!actor && HERO_EDITORIAL_LIFECYCLE_ACTIONS.includes(action)) {
        violations.push('missing_actor');
    }
    if (isUnauthorizedEditorialSource(sourceType) && HERO_EDITORIAL_LIFECYCLE_ACTIONS.includes(action)) {
        violations.push('unauthorized_editorial_source');
    }
    if (
        (action === HERO_AUDIT_ACTIONS.APPROVED || action === HERO_AUDIT_ACTIONS.PUBLISHED) &&
        (actorType === 'intelligence' ||
            actorType === 'system' ||
            sourceType === 'ai' ||
            sourceType === 'intelligence' ||
            sourceType === 'nlp')
    ) {
        violations.push('fake_approval_actor');
    }

    if (violations.length) {
        return { ok: false, violations: Array.from(new Set(violations)) };
    }

    return {
        ok: true,
        event: {
            eventId,
            heroId,
            action,
            previousStatus,
            newStatus,
            actor,
            actorType,
            sourceType,
            source: sourceType,
            timestamp,
            changedFields,
            integrityHash: claimedHash
        }
    };
}

/**
 * Verify audit chain: hashes, actors, ordering, lifecycle edges.
 * @param {unknown} heroRecord
 * @returns {{ ok: boolean; violations: string[]; events: import('./heroAuditEvents.js').HeroAuditEvent[] }}
 */
export function verifyHeroAuditChain(heroRecord) {
    /** @type {string[]} */
    const violations = [];
    const rawLog = Array.isArray(/** @type {any} */ (heroRecord)?.auditLog)
        ? /** @type {any} */ (heroRecord).auditLog
        : [];
    /** @type {import('./heroAuditEvents.js').HeroAuditEvent[]} */
    const events = [];

    for (const row of rawLog) {
        const parsed = parseAuditEventStrict(row);
        if (!parsed.ok) {
            violations.push(...parsed.violations);
            continue;
        }
        events.push(parsed.event);
    }

    for (let i = 1; i < events.length; i += 1) {
        if (events[i].timestamp < events[i - 1].timestamp) {
            violations.push('audit_order_invalid');
            break;
        }
    }

    let chainStatus = HERO_LIFECYCLE_STATUS.DRAFT;
    let sawFirst = false;
    for (const evt of events) {
        const targetHint = text(evt.newStatus).toLowerCase();
        const prevHint = text(evt.previousStatus).toLowerCase();
        if (
            evt.action === HERO_AUDIT_ACTIONS.APPROVED ||
            evt.action === HERO_AUDIT_ACTIONS.PUBLISHED ||
            evt.action === HERO_AUDIT_ACTIONS.ARCHIVED ||
            evt.action === HERO_AUDIT_ACTIONS.SUBMITTED_FOR_REVIEW ||
            evt.action === HERO_AUDIT_ACTIONS.EDITED ||
            evt.action === HERO_AUDIT_ACTIONS.CREATED
        ) {
            if (!sawFirst) {
                sawFirst = true;
                if (prevHint && HERO_LIFECYCLE_STATUS_VALUES.includes(prevHint)) {
                    chainStatus = prevHint;
                }
            } else if (prevHint && prevHint !== chainStatus) {
                violations.push('unknown_lifecycle_transition');
            }

            const nextStatus =
                targetHint && HERO_LIFECYCLE_STATUS_VALUES.includes(targetHint)
                    ? targetHint
                    : chainStatus;
            const allowed = HERO_LIFECYCLE_TRANSITIONS[chainStatus] || [];
            if (targetHint && !allowed.includes(nextStatus)) {
                violations.push('unknown_lifecycle_transition');
            }
            if (targetHint) chainStatus = nextStatus;
        }
    }

    return {
        ok: violations.length === 0,
        violations: Array.from(new Set(violations)),
        events
    };
}

/**
 * Full record integrity check for public trust.
 *
 * @param {unknown} heroRecord
 * @returns {HeroVerificationResult}
 */
export function verifyHeroRecordIntegrity(heroRecord) {
    /** @type {string[]} */
    const violations = [];

    if (!heroRecord || typeof heroRecord !== 'object') {
        return {
            verified: false,
            reason: 'record_missing',
            violations: ['record_missing'],
            record: null
        };
    }

    const row = /** @type {Record<string, unknown>} */ (heroRecord);
    const creatorTruth = readCreatorTruth(row.creatorTruth);

    if (creatorTruth.present && creatorTruth.rawImmutable === false) {
        violations.push('creator_truth_changed_after_capture');
    }
    if (creatorTruth.immutable !== true) {
        violations.push('creator_truth_not_immutable');
    }

    const presentation = readPresentation(row.heroPresentation);
    if (!HERO_LIFECYCLE_STATUS_VALUES.includes(presentation.status)) {
        violations.push('invalid_lifecycle_status');
    }

    const chain = verifyHeroAuditChain(row);
    violations.push(...chain.violations);

    const events = chain.events;
    const hasApprove = events.some((e) => e.action === HERO_AUDIT_ACTIONS.APPROVED);
    const hasPublish = events.some((e) => e.action === HERO_AUDIT_ACTIONS.PUBLISHED);
    const approveEvt = events.filter((e) => e.action === HERO_AUDIT_ACTIONS.APPROVED);
    const publishEvt = events.filter((e) => e.action === HERO_AUDIT_ACTIONS.PUBLISHED);

    if (presentation.status === HERO_LIFECYCLE_STATUS.PUBLISHED) {
        if (!hasPublish) violations.push('published_without_publish_event');
        if (!hasApprove) violations.push('published_without_approval_event');
        if (!presentation.approvedBy || !presentation.approvedAt) {
            violations.push('missing_approval_metadata');
        }
        for (const e of approveEvt) {
            if (!e.actor) violations.push('missing_approval_actor');
            if (!e.timestamp) violations.push('missing_approval_timestamp');
        }
        for (const e of publishEvt) {
            if (!e.actor) violations.push('missing_publish_actor');
            if (!e.timestamp) violations.push('missing_publish_timestamp');
        }
        if (!Array.isArray(row.auditLog) || row.auditLog.length === 0) {
            violations.push('audit_event_removed');
        }
        // Phase 6/7: published requires client audit cache + server receipt + server state.
        // Local-only published is rejected (server is single source of truth).
        if (!hasValidServerAuthorityReceipt(row)) {
            violations.push('missing_server_authority_receipt');
            violations.push('unsigned_publish');
            violations.push('local_only_published');
        }
        const serverState = normalizeServerAuthorityState(row.serverAuthorityState);
        if (!serverState || serverState.status !== HERO_LIFECYCLE_STATUS.PUBLISHED) {
            violations.push('missing_server_authority_state');
            violations.push('local_only_published');
        }
        if (!isServerGrantedPublished(row)) {
            violations.push('server_not_granted_published');
        }
    }

    if (presentation.status === HERO_LIFECYCLE_STATUS.APPROVED) {
        if (!hasApprove) violations.push('approved_without_approval_event');
        if (!presentation.approvedBy || !presentation.approvedAt) {
            violations.push('missing_approval_metadata');
        }
        for (const e of approveEvt) {
            if (!e.actor) violations.push('missing_approval_actor');
            if (!e.timestamp) violations.push('missing_approval_timestamp');
        }
    }

    if (presentation.status === HERO_LIFECYCLE_STATUS.ARCHIVED) {
        const hasArchive = events.some((e) => e.action === HERO_AUDIT_ACTIONS.ARCHIVED);
        if (!hasArchive) violations.push('archived_without_archive_event');
    }

    const unique = Array.from(new Set(violations));
    if (unique.length) {
        return {
            verified: false,
            reason: unique[0],
            violations: unique,
            record: null
        };
    }

    return {
        verified: true,
        reason: '',
        violations: [],
        record: row
    };
}

/**
 * Resolve a verified hero record for trust-sensitive consumers.
 * Fail closed: does not silently repair.
 *
 * @param {unknown} heroRecord
 * @returns {HeroVerificationResult}
 */
export function resolveVerifiedHeroRecord(heroRecord) {
    const result = verifyHeroRecordIntegrity(heroRecord);
    if (!result.verified) {
        return {
            verified: false,
            reason: result.reason || 'verification_failed',
            violations: result.violations,
            record: null
        };
    }
    return {
        verified: true,
        reason: '',
        violations: [],
        record: result.record
    };
}

/**
 * Build presentation-safe view of an unverified record.
 * Keeps creatorTruth for fallback identity; clears publish lifecycle claims.
 * Does not write repairs to storage.
 *
 * @param {Record<string, unknown> | null | undefined} raw
 * @param {string} reason
 * @param {string[]} [violations]
 */
export function scrubUnverifiedHeroForPublic(raw, reason, violations = []) {
    const creatorTruth = readCreatorTruth(raw?.creatorTruth);
    return {
        ...(raw && typeof raw === 'object' ? raw : {}),
        authorityVerified: false,
        authorityFailureReason: reason || 'verification_failed',
        authorityViolations: violations,
        adminContext: {
            sourceTitle: '',
            sourceDescription: '',
            identityNotes: '',
            editorialNotes: ''
        },
        auditLog: [],
        serverAuthorityReceipt: null,
        serverAuthorityState: null,
        heroPresentation: {
            publicTitle: '',
            publicDescription: '',
            publicTheme: '',
            approvedBy: '',
            approvedAt: null,
            status: 'draft',
            visibility: 'draft',
            showIntelligence: false
        },
        creatorTruth: {
            title: creatorTruth.title,
            description: creatorTruth.description,
            genre: '',
            identityTerms: [],
            sourceAssetTitle: '',
            immutable: true
        }
    };
}

/**
 * Whether public presentation claims may be used.
 * @param {unknown} record
 */
export function canPresentPublicHeroPresentation(record) {
    const result = verifyHeroRecordIntegrity(record);
    if (!result.verified) return false;
    const presentation = readPresentation(
        /** @type {Record<string, unknown>} */ (record)?.heroPresentation
    );
    return presentation.status === HERO_LIFECYCLE_STATUS.PUBLISHED;
}
