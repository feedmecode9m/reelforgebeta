/**
 * Master Hero Admin / Public Presentation Boundary.
 *
 * Layer separation (never collapse identity into intelligence):
 *
 * creatorTruth:
 *   real uploaded/edited creator identity (immutable once captured)
 *
 * heroPresentation:
 *   approved public editorial layer + lifecycle (draft→review→approved→published→archived)
 *
 * intelligenceContext:
 *   NLP explanation only — never official title/genre/identity
 *
 * discoveryContext:
 *   ranking/search only — never identity
 *
 * auditLog:
 *   governance history only (append-only)
 *
 * Cross-cutting concerns:
 * - Authority:     "Who is allowed to publish?"
 * - Verification:  "Can this state be trusted?"  → heroAuthorityVerification
 * - Presentation:  "What does the public see?"
 * - Intelligence:  "What does NLP suggest?"
 * - Discovery:     "How is content categorized?"
 *
 * Lifecycle mutations:
 *   validateHeroTransition() → createHeroAuditEvent() → saveHeroRecord()
 * No direct status mutation outside this authority path.
 *
 * @see ./heroAuthorityBoundary.js
 * @see ./heroAuthorityVerification.js
 * @see ./heroAuditEvents.js
 * @see ./heroAuthoritySync.js
 * @see ./heroRecord.js
 * @see ../viewer/viewerIntelligencePresentation.js
 */

import {
    extractProtectedIdentityTerms,
    wouldMutateIdentityTerms
} from '../viewer/viewerIntelligencePresentation.js';
import { resolvePublicIntelligenceExplanation } from './heroIntelligenceExplanation.js';
import { resolvePublicCreatorIntent } from './creatorIntentContext.js';
import { resolvePublicDiscoveryConnections } from '../discovery/discoveryGraph.js';
import { resolveViewerTrustSignals } from '../viewer/viewerTrustPresentation.js';
import {
    PROVENANCE_SOURCE_TYPES
} from '../architecture/intelligenceProvenance.js';
import {
    appendHeroAuditEvents,
    buildLifecycleAuditEvent,
    computePresentationChangedFields,
    HERO_AUDIT_ACTIONS,
    normalizeHeroAuditLog
} from './heroAuditEvents.js';
import {
    HERO_ACTOR_TYPES,
    normalizeHeroActorType,
    normalizeHeroAuthoritySourceType,
    resolveEditorialActor,
    validateHeroTransition,
    validateHeroTransitionAuditTrail
} from './heroAuthorityBoundary.js';
import { createPendingAuthoritySync } from './heroAuthoritySync.js';
import { verifyHeroRecordIntegrity } from './heroAuthorityVerification.js';
import { isServerGrantedPublished } from './heroServerAuthorityEngine.js';

/** Visibility policy for layered fields (policy strings, not publish flags). */
export const HERO_VISIBILITY_POLICY = Object.freeze({
    creatorTruth: 'admin_only',
    intelligenceExplanation: 'optional',
    heroPresentation: 'public'
});

/**
 * Explicit Hero presentation lifecycle.
 * Only `published` resolves to public Hero Vault.
 * `approved` is an editorial gate that may transition to `published`.
 */
export const HERO_PRESENTATION_STATUS = Object.freeze({
    DRAFT: 'draft',
    REVIEW: 'review',
    APPROVED: 'approved',
    PUBLISHED: 'published',
    ARCHIVED: 'archived'
});

/** @type {ReadonlyArray<string>} */
export const HERO_PRESENTATION_STATUS_VALUES = Object.freeze([
    HERO_PRESENTATION_STATUS.DRAFT,
    HERO_PRESENTATION_STATUS.REVIEW,
    HERO_PRESENTATION_STATUS.APPROVED,
    HERO_PRESENTATION_STATUS.PUBLISHED,
    HERO_PRESENTATION_STATUS.ARCHIVED
]);

/** Legacy visibility values mapped into lifecycle status */
export const HERO_PRESENTATION_VISIBILITY = Object.freeze({
    DRAFT: 'draft',
    PUBLIC: 'public',
    HIDDEN: 'hidden'
});

/**
 * @typedef {'draft' | 'review' | 'approved' | 'published' | 'archived'} HeroPresentationStatus
 */

/**
 * @typedef {Object} HeroPresentationBlock
 * @property {string} publicTitle
 * @property {string} publicDescription
 * @property {string} publicTheme
 * @property {string} approvedBy
 * @property {number | null} approvedAt
 * @property {HeroPresentationStatus} status
 * @property {'draft' | 'public' | 'hidden'} visibility legacy mirror of status
 * @property {boolean} showIntelligence
 */

/**
 * Map legacy visibility → lifecycle status.
 * @param {string} visibility
 * @param {string} [statusHint]
 * @returns {HeroPresentationStatus}
 */
export function resolvePresentationStatus(visibility, statusHint) {
    const status = String(statusHint || '')
        .trim()
        .toLowerCase();
    if (HERO_PRESENTATION_STATUS_VALUES.includes(status)) {
        return /** @type {HeroPresentationStatus} */ (status);
    }
    const vis = String(visibility || '')
        .trim()
        .toLowerCase();
    if (vis === HERO_PRESENTATION_VISIBILITY.PUBLIC || vis === 'published') {
        return HERO_PRESENTATION_STATUS.PUBLISHED;
    }
    if (vis === HERO_PRESENTATION_VISIBILITY.HIDDEN || vis === 'archived') {
        return HERO_PRESENTATION_STATUS.ARCHIVED;
    }
    if (vis === 'review') return HERO_PRESENTATION_STATUS.REVIEW;
    if (vis === 'approved') return HERO_PRESENTATION_STATUS.APPROVED;
    return HERO_PRESENTATION_STATUS.DRAFT;
}

/**
 * Legacy visibility mirror for older callers / storage.
 * @param {HeroPresentationStatus} status
 */
export function statusToLegacyVisibility(status) {
    if (status === HERO_PRESENTATION_STATUS.PUBLISHED) return HERO_PRESENTATION_VISIBILITY.PUBLIC;
    if (status === HERO_PRESENTATION_STATUS.ARCHIVED) return HERO_PRESENTATION_VISIBILITY.HIDDEN;
    return HERO_PRESENTATION_VISIBILITY.DRAFT;
}

/**
 * Only published (+ approval metadata) is live on public Hero Vault.
 * @param {unknown} presentation
 */
export function isPublicHeroPresentation(presentation) {
    const p = normalizeHeroPresentation(presentation);
    if (p.status !== HERO_PRESENTATION_STATUS.PUBLISHED) return false;
    if (!p.approvedBy || !p.approvedAt) return false;
    return Boolean(p.publicTitle || p.publicDescription || p.publicTheme);
}

/** @deprecated use isPublicHeroPresentation */
export function isApprovedPublicHeroPresentation(presentation) {
    return isPublicHeroPresentation(presentation);
}

/**
 * Admin-only lifecycle states (never public).
 * @param {unknown} status
 */
export function isAdminOnlyPresentationStatus(status) {
    const s = String(status || '')
        .trim()
        .toLowerCase();
    return (
        s === HERO_PRESENTATION_STATUS.DRAFT ||
        s === HERO_PRESENTATION_STATUS.REVIEW ||
        s === HERO_PRESENTATION_STATUS.ARCHIVED
    );
}

/**
 * @typedef {Object} HeroAdminContextBlock
 * @property {string} sourceTitle
 * @property {string} sourceDescription
 * @property {string} identityNotes
 * @property {string} editorialNotes
 */

/**
 * @typedef {Object} HeroCreatorTruthBlock
 * @property {string} title
 * @property {string} description
 * @property {string} genre
 * @property {string[]} identityTerms
 * @property {string} sourceAssetTitle
 * @property {boolean} immutable
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @returns {HeroPresentationBlock}
 */
export function createEmptyHeroPresentation() {
    return {
        publicTitle: '',
        publicDescription: '',
        publicTheme: '',
        approvedBy: '',
        approvedAt: null,
        status: HERO_PRESENTATION_STATUS.DRAFT,
        visibility: HERO_PRESENTATION_VISIBILITY.DRAFT,
        showIntelligence: true
    };
}

/**
 * @returns {HeroAdminContextBlock}
 */
export function createEmptyAdminContext() {
    return {
        sourceTitle: '',
        sourceDescription: '',
        identityNotes: '',
        editorialNotes: ''
    };
}

/**
 * @returns {HeroCreatorTruthBlock}
 */
export function createEmptyCreatorTruth() {
    return {
        title: '',
        description: '',
        genre: '',
        identityTerms: [],
        sourceAssetTitle: '',
        immutable: true
    };
}

/**
 * @param {unknown} raw
 * @returns {HeroPresentationBlock}
 */
export function normalizeHeroPresentation(raw) {
    const base = createEmptyHeroPresentation();
    if (!raw || typeof raw !== 'object') return base;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const status = resolvePresentationStatus(
        String(row.visibility || ''),
        String(row.status || '')
    );
    return {
        publicTitle: text(row.publicTitle),
        publicDescription: text(row.publicDescription),
        publicTheme: text(row.publicTheme),
        approvedBy: text(row.approvedBy),
        approvedAt:
            row.approvedAt == null || row.approvedAt === ''
                ? null
                : Number(row.approvedAt) || null,
        status,
        visibility: statusToLegacyVisibility(status),
        showIntelligence: row.showIntelligence !== false
    };
}

/**
 * @param {unknown} raw
 * @returns {HeroAdminContextBlock}
 */
export function normalizeAdminContext(raw) {
    const base = createEmptyAdminContext();
    if (!raw || typeof raw !== 'object') return base;
    const row = /** @type {Record<string, unknown>} */ (raw);
    return {
        sourceTitle: text(row.sourceTitle),
        sourceDescription: text(row.sourceDescription),
        identityNotes: text(row.identityNotes),
        editorialNotes: text(row.editorialNotes)
    };
}

/**
 * @param {unknown} raw
 * @returns {HeroCreatorTruthBlock}
 */
export function normalizeCreatorTruth(raw) {
    const base = createEmptyCreatorTruth();
    if (!raw || typeof raw !== 'object') return base;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const identityTerms = Array.isArray(row.identityTerms)
        ? row.identityTerms.map((t) => text(t)).filter(Boolean)
        : [];
    const title = text(row.title);
    const description = text(row.description);
    return {
        title,
        description,
        genre: text(row.genre),
        identityTerms: Array.from(
            new Set([
                ...identityTerms,
                ...extractProtectedIdentityTerms(title),
                ...extractProtectedIdentityTerms(description)
            ])
        ),
        sourceAssetTitle: text(row.sourceAssetTitle),
        immutable: row.immutable !== false
    };
}

/**
 * Snapshot creator truth once from vault / creator inputs. Never overwrites locked truth.
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {{
 *   title?: string;
 *   description?: string;
 *   genre?: string;
 *   sourceAssetTitle?: string;
 *   force?: boolean;
 * }} [source]
 * @returns {HeroCreatorTruthBlock}
 */
export function captureCreatorTruth(record, source = {}) {
    const existing = normalizeCreatorTruth(record?.creatorTruth);
    const hasTruth = Boolean(existing.title || existing.description || existing.sourceAssetTitle);

    // Immutable: if already captured and not forced, return as-is.
    if (hasTruth && existing.immutable && !source.force) {
        return existing;
    }

    const title =
        text(source.title) ||
        text(record?.title) ||
        text(record?.heroTitle) ||
        existing.title;
    const description =
        text(source.description) ||
        text(record?.heroDescription) ||
        text(record?.description) ||
        existing.description;
    const genre =
        text(source.genre) || text(record?.genre) || existing.genre;
    const sourceAssetTitle =
        text(source.sourceAssetTitle) || text(record?.title) || existing.sourceAssetTitle || title;

    return normalizeCreatorTruth({
        title,
        description,
        genre,
        sourceAssetTitle,
        identityTerms: [
            ...extractProtectedIdentityTerms(title),
            ...extractProtectedIdentityTerms(description)
        ],
        immutable: true
    });
}

/**
 * Prevent NLP / discovery from mutating creatorTruth on a record.
 *
 * @param {HeroCreatorTruthBlock} current
 * @param {Record<string, unknown>} proposed
 * @returns {{ next: HeroCreatorTruthBlock; blocked: string[] }}
 */
export function protectCreatorTruthFromNlp(current, proposed = {}) {
    const base = normalizeCreatorTruth(current);
    /** @type {string[]} */
    const blocked = [];
    const attempt = proposed && typeof proposed === 'object' ? proposed : {};

    for (const field of ['title', 'description', 'genre', 'sourceAssetTitle']) {
        if (attempt[field] === undefined) continue;
        const nextVal = text(attempt[field]);
        const curVal = text(base[field]);
        if (nextVal && nextVal !== curVal) {
            blocked.push(field);
        }
    }
    if (Array.isArray(attempt.identityTerms)) {
        const nextTerms = attempt.identityTerms.map((t) => text(t)).filter(Boolean);
        const lost = base.identityTerms.some(
            (term) => !nextTerms.some((t) => t.toLowerCase() === term.toLowerCase())
        );
        if (lost || wouldMutateIdentityTerms(base.title, nextTerms.join(' '))) {
            blocked.push('identityTerms');
        }
    }

    return { next: base, blocked };
}

/**
 * Approved presentation may transition to published.
 * @param {unknown} presentation
 */
export function canPublishHeroPresentation(presentation) {
    const p = normalizeHeroPresentation(presentation);
    if (p.status !== HERO_PRESENTATION_STATUS.APPROVED) return false;
    if (!p.approvedBy || !p.approvedAt) return false;
    return Boolean(p.publicTitle || p.publicDescription || p.publicTheme);
}

/**
 * Reject approval/publish from intelligence / discovery / untrusted sources.
 * Prefer validateHeroTransition() for full lifecycle gates.
 * @param {string} sourceType
 */
function rejectNonAuthoritySource(sourceType) {
    const source = normalizeHeroAuthoritySourceType(sourceType);
    if (
        source === PROVENANCE_SOURCE_TYPES.AI ||
        source === PROVENANCE_SOURCE_TYPES.DISCOVERY ||
        source === PROVENANCE_SOURCE_TYPES.DEMO ||
        source === PROVENANCE_SOURCE_TYPES.SYSTEM ||
        source === 'nlp' ||
        source === 'intelligence'
    ) {
        return 'approval_requires_admin_or_creator_source';
    }
    return '';
}

/**
 * Shared gate helper — fail closed before mutating presentation status.
 *
 * @param {Parameters<typeof validateHeroTransition>[0]} input
 */
function gateHeroTransition(input) {
    return validateHeroTransition(input);
}

/**
 * Admin approval — sets status to `approved` with authority metadata.
 * Does not alone publish; call publishHeroPresentation for public vault.
 * Pass `publish: true` to approve + publish in one step (Manager default).
 *
 * Flow: validateHeroTransition → createHeroAuditEvent → recordPatch (saveHeroRecord by caller).
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {{
 *   publicTitle?: string;
 *   publicDescription?: string;
 *   publicTheme?: string;
 *   showIntelligence?: boolean;
 *   approvedBy?: string;
 *   sourceType?: string;
 *   actor?: string;
 *   actorType?: string;
 *   publish?: boolean;
 * }} draft
 * @returns {{
 *   ok: boolean;
 *   recordPatch: Record<string, unknown> | null;
 *   errors: string[];
 *   pendingSync?: ReturnType<typeof createPendingAuthoritySync>;
 * }}
 */
export function approveHeroPresentation(record, draft = {}) {
    /** @type {string[]} */
    const errors = [];
    // Fail-closed: omit sourceType → system, not creator.
    const sourceType = normalizeHeroAuthoritySourceType(draft.sourceType);
    const identityActor = resolveEditorialActor({
        actor: draft.actor,
        approvedBy: draft.approvedBy,
        actorType: draft.actorType
    });
    const approvedBy =
        text(draft.approvedBy) || text(draft.actor) || identityActor.actor || '';
    const actor = approvedBy;
    const actorType = normalizeHeroActorType(
        draft.actorType || identityActor.actorType || HERO_ACTOR_TYPES.ADMIN,
        actor
    );

    const previousPresentation = normalizeHeroPresentation(record?.heroPresentation);
    const previousStatus = previousPresentation.status;
    const previousLog = normalizeHeroAuditLog(record?.auditLog);

    const publicTitle = text(draft.publicTitle);
    const publicDescription = text(draft.publicDescription);
    const publicTheme = text(draft.publicTheme);
    const approvedAt = Date.now();

    if (!publicTitle && !publicDescription && !publicTheme) {
        errors.push('presentation_fields_empty');
    }
    if (errors.length) {
        return { ok: false, recordPatch: null, errors };
    }

    // Immutable creatorTruth: capture once; never rewrite during approval/publish.
    const existingTruth = normalizeCreatorTruth(record?.creatorTruth);
    const creatorTruth = captureCreatorTruth(record, {
        title: existingTruth.title || text(record?.title) || text(record?.heroTitle),
        description: existingTruth.description || text(record?.heroDescription),
        sourceAssetTitle: existingTruth.sourceAssetTitle || text(record?.title)
    });
    // Block mutation if caller tried to flip creatorTruth in same transaction.
    const proposedTruth =
        draft && /** @type {any} */ (draft).creatorTruth
            ? /** @type {any} */ (draft).creatorTruth
            : creatorTruth;
    const truthMutate = gateHeroTransition({
        previousStatus,
        nextStatus: HERO_PRESENTATION_STATUS.APPROVED,
        action: HERO_AUDIT_ACTIONS.APPROVED,
        sourceType,
        actor,
        actorType,
        approvedBy: actor,
        approvedAt,
        publicTitle,
        publicDescription,
        publicTheme,
        creatorTruthBefore: existingTruth,
        creatorTruthAfter: normalizeCreatorTruth(proposedTruth),
        auditLog: previousLog
    });
    if (!truthMutate.ok) {
        return { ok: false, recordPatch: null, errors: truthMutate.errors };
    }

    const gate = gateHeroTransition({
        previousStatus,
        nextStatus: HERO_PRESENTATION_STATUS.APPROVED,
        action: HERO_AUDIT_ACTIONS.APPROVED,
        sourceType,
        actor,
        actorType,
        approvedBy: actor,
        approvedAt,
        publicTitle,
        publicDescription,
        publicTheme,
        creatorTruthBefore: existingTruth,
        creatorTruthAfter: creatorTruth,
        auditLog: previousLog
    });
    if (!gate.ok) {
        return { ok: false, recordPatch: null, errors: gate.errors };
    }

    const shouldPublish = draft.publish !== false;
    const approveStatus = HERO_PRESENTATION_STATUS.APPROVED;
    const finalStatus = shouldPublish
        ? HERO_PRESENTATION_STATUS.PUBLISHED
        : HERO_PRESENTATION_STATUS.APPROVED;

    if (shouldPublish) {
        const pubGate = gateHeroTransition({
            previousStatus: approveStatus,
            nextStatus: HERO_PRESENTATION_STATUS.PUBLISHED,
            action: HERO_AUDIT_ACTIONS.PUBLISHED,
            sourceType,
            actor,
            actorType,
            approvedBy: actor,
            approvedAt,
            publicTitle,
            publicDescription,
            publicTheme,
            creatorTruthBefore: existingTruth,
            creatorTruthAfter: creatorTruth,
            auditLog: previousLog
        });
        if (!pubGate.ok) {
            return { ok: false, recordPatch: null, errors: pubGate.errors };
        }
    }

    const adminContext = normalizeAdminContext({
        ...(record?.adminContext && typeof record.adminContext === 'object'
            ? record.adminContext
            : {}),
        sourceTitle: creatorTruth.title || text(record?.title),
        sourceDescription: creatorTruth.description || text(record?.heroDescription)
    });

    /** @type {HeroPresentationBlock} */
    const heroPresentation = {
        publicTitle,
        publicDescription,
        publicTheme,
        approvedBy: actor,
        approvedAt,
        status: finalStatus,
        visibility: statusToLegacyVisibility(finalStatus),
        showIntelligence: draft.showIntelligence !== false
    };

    const changedFields = computePresentationChangedFields(previousPresentation, heroPresentation);
    /** @type {import('./heroAuditEvents.js').HeroAuditEvent[]} */
    const newEvents = [];

    const approveEvt = buildLifecycleAuditEvent({
        record: /** @type {Record<string, unknown>} */ (record || {}),
        action: HERO_AUDIT_ACTIONS.APPROVED,
        previousStatus,
        newStatus: approveStatus,
        actor,
        actorType,
        sourceType,
        changedFields,
        timestamp: approvedAt
    });
    if (!approveEvt.ok || !approveEvt.event) {
        return {
            ok: false,
            recordPatch: null,
            errors: approveEvt.errors.length ? approveEvt.errors : ['audit_event_failed']
        };
    }
    newEvents.push(approveEvt.event);

    if (shouldPublish) {
        const publishEvt = buildLifecycleAuditEvent({
            record: /** @type {Record<string, unknown>} */ (record || {}),
            action: HERO_AUDIT_ACTIONS.PUBLISHED,
            previousStatus: approveStatus,
            newStatus: HERO_PRESENTATION_STATUS.PUBLISHED,
            actor,
            actorType,
            sourceType,
            changedFields: ['status'],
            timestamp: approvedAt + 1
        });
        if (!publishEvt.ok || !publishEvt.event) {
            return {
                ok: false,
                recordPatch: null,
                errors: publishEvt.errors.length ? publishEvt.errors : ['audit_event_failed']
            };
        }
        newEvents.push(publishEvt.event);
    }

    const trail = validateHeroTransitionAuditTrail({
        nextStatus: finalStatus,
        auditLog: previousLog,
        newEvents
    });
    if (!trail.ok) {
        return { ok: false, recordPatch: null, errors: trail.errors };
    }

    const auditLog = appendHeroAuditEvents(previousLog, newEvents);
    const recordPatch = {
        creatorTruth,
        adminContext,
        heroPresentation,
        visibility: { ...HERO_VISIBILITY_POLICY },
        auditLog
    };

    return {
        ok: true,
        recordPatch,
        errors: [],
        pendingSync: createPendingAuthoritySync({
            record: /** @type {Record<string, unknown>} */ (record || {}),
            events: newEvents,
            heroPresentation,
            creatorTruth,
            lifecycleStatus: finalStatus
        })
    };
}

/**
 * Publish an already-approved presentation to public Hero Vault.
 * Cannot publish from draft/review/archived or without approval metadata.
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {{
 *   sourceType?: string;
 *   approvedBy?: string;
 *   actor?: string;
 *   actorType?: string;
 * }} [options]
 */
export function publishHeroPresentation(record, options = {}) {
    const sourceType = normalizeHeroAuthoritySourceType(options.sourceType);
    const prev = normalizeHeroPresentation(record?.heroPresentation);
    const previousLog = normalizeHeroAuditLog(record?.auditLog);
    const identityActor = resolveEditorialActor({
        actor: options.actor,
        approvedBy: options.approvedBy || prev.approvedBy,
        actorType: options.actorType
    });
    const actor =
        text(options.actor) ||
        text(options.approvedBy) ||
        prev.approvedBy ||
        identityActor.actor ||
        '';
    const actorType = normalizeHeroActorType(
        options.actorType || identityActor.actorType || HERO_ACTOR_TYPES.ADMIN,
        actor
    );
    const timestamp = Date.now();
    const existingTruth = normalizeCreatorTruth(record?.creatorTruth);
    const creatorTruth = captureCreatorTruth(record);

    const gate = gateHeroTransition({
        previousStatus: prev.status,
        nextStatus: HERO_PRESENTATION_STATUS.PUBLISHED,
        action: HERO_AUDIT_ACTIONS.PUBLISHED,
        sourceType,
        actor,
        actorType,
        approvedBy: prev.approvedBy || actor,
        approvedAt: prev.approvedAt || timestamp,
        publicTitle: prev.publicTitle,
        publicDescription: prev.publicDescription,
        publicTheme: prev.publicTheme,
        creatorTruthBefore: existingTruth,
        creatorTruthAfter: creatorTruth,
        auditLog: previousLog
    });
    if (!gate.ok) {
        return { ok: false, recordPatch: null, errors: gate.errors };
    }

    if (!prev.publicTitle && !prev.publicDescription && !prev.publicTheme) {
        return { ok: false, recordPatch: null, errors: ['presentation_fields_empty'] };
    }

    const adminContext = normalizeAdminContext(record?.adminContext);
    const heroPresentation = normalizeHeroPresentation({
        ...prev,
        status: HERO_PRESENTATION_STATUS.PUBLISHED,
        approvedBy: prev.approvedBy || actor,
        approvedAt: prev.approvedAt || timestamp
    });

    const publishEvt = buildLifecycleAuditEvent({
        record: /** @type {Record<string, unknown>} */ (record || {}),
        action: HERO_AUDIT_ACTIONS.PUBLISHED,
        previousStatus: prev.status,
        newStatus: HERO_PRESENTATION_STATUS.PUBLISHED,
        actor,
        actorType,
        sourceType,
        changedFields: computePresentationChangedFields(prev, heroPresentation),
        timestamp
    });
    if (!publishEvt.ok || !publishEvt.event) {
        return {
            ok: false,
            recordPatch: null,
            errors: publishEvt.errors.length ? publishEvt.errors : ['audit_event_failed']
        };
    }

    const trail = validateHeroTransitionAuditTrail({
        nextStatus: HERO_PRESENTATION_STATUS.PUBLISHED,
        auditLog: previousLog,
        newEvents: [publishEvt.event]
    });
    if (!trail.ok) {
        return { ok: false, recordPatch: null, errors: trail.errors };
    }

    const auditLog = appendHeroAuditEvents(previousLog, [publishEvt.event]);
    return {
        ok: true,
        recordPatch: {
            creatorTruth,
            adminContext,
            heroPresentation,
            visibility: { ...HERO_VISIBILITY_POLICY },
            auditLog
        },
        errors: [],
        pendingSync: createPendingAuthoritySync({
            record: /** @type {Record<string, unknown>} */ (record || {}),
            events: [publishEvt.event],
            heroPresentation,
            creatorTruth,
            lifecycleStatus: HERO_PRESENTATION_STATUS.PUBLISHED
        })
    };
}

/**
 * Move presentation into review (admin-only).
 * @param {Record<string, unknown> | null | undefined} record
 * @param {Partial<HeroPresentationBlock> & {
 *   sourceType?: string;
 *   actor?: string;
 *   actorType?: string;
 * }} [draft]
 */
export function submitHeroPresentationForReview(record, draft = {}) {
    const sourceType = normalizeHeroAuthoritySourceType(draft.sourceType);
    const prev = normalizeHeroPresentation(record?.heroPresentation);
    const previousLog = normalizeHeroAuditLog(record?.auditLog);
    const identityActor = resolveEditorialActor({
        actor: draft.actor,
        actorType: draft.actorType
    });
    const actor = text(draft.actor) || identityActor.actor || '';
    const actorType = normalizeHeroActorType(
        draft.actorType || identityActor.actorType || HERO_ACTOR_TYPES.ADMIN,
        actor
    );
    const existingTruth = normalizeCreatorTruth(record?.creatorTruth);
    const creatorTruth = captureCreatorTruth(record);

    const gate = gateHeroTransition({
        previousStatus: prev.status,
        nextStatus: HERO_PRESENTATION_STATUS.REVIEW,
        action: HERO_AUDIT_ACTIONS.SUBMITTED_FOR_REVIEW,
        sourceType,
        actor,
        actorType,
        creatorTruthBefore: existingTruth,
        creatorTruthAfter: creatorTruth,
        auditLog: previousLog
    });
    if (!gate.ok) {
        return {
            ok: false,
            recordPatch: null,
            errors: gate.errors,
            creatorTruth,
            adminContext: normalizeAdminContext(record?.adminContext),
            heroPresentation: prev,
            visibility: { ...HERO_VISIBILITY_POLICY },
            auditLog: previousLog
        };
    }

    const heroPresentation = normalizeHeroPresentation({
        ...prev,
        ...draft,
        status: HERO_PRESENTATION_STATUS.REVIEW,
        approvedBy: '',
        approvedAt: null
    });

    const evt = buildLifecycleAuditEvent({
        record: /** @type {Record<string, unknown>} */ (record || {}),
        action: HERO_AUDIT_ACTIONS.SUBMITTED_FOR_REVIEW,
        previousStatus: prev.status,
        newStatus: HERO_PRESENTATION_STATUS.REVIEW,
        actor,
        actorType,
        sourceType,
        changedFields: computePresentationChangedFields(prev, heroPresentation)
    });
    if (!evt.ok || !evt.event) {
        return {
            ok: false,
            recordPatch: null,
            errors: evt.errors,
            creatorTruth,
            adminContext: normalizeAdminContext(record?.adminContext),
            heroPresentation: prev,
            visibility: { ...HERO_VISIBILITY_POLICY },
            auditLog: previousLog
        };
    }

    const auditLog = appendHeroAuditEvents(previousLog, [evt.event]);
    return {
        ok: true,
        errors: [],
        recordPatch: {
            creatorTruth,
            adminContext: normalizeAdminContext(record?.adminContext),
            heroPresentation,
            visibility: { ...HERO_VISIBILITY_POLICY },
            auditLog
        },
        creatorTruth,
        adminContext: normalizeAdminContext(record?.adminContext),
        heroPresentation,
        visibility: { ...HERO_VISIBILITY_POLICY },
        auditLog
    };
}

/**
 * Archive — never public.
 * @param {Record<string, unknown> | null | undefined} record
 * @param {{ sourceType?: string; actor?: string; actorType?: string }} [options]
 */
export function archiveHeroPresentation(record, options = {}) {
    const sourceType = normalizeHeroAuthoritySourceType(options.sourceType);
    const prev = normalizeHeroPresentation(record?.heroPresentation);
    const previousLog = normalizeHeroAuditLog(record?.auditLog);
    const identityActor = resolveEditorialActor({
        actor: options.actor,
        actorType: options.actorType
    });
    const actor = text(options.actor) || identityActor.actor || '';
    const actorType = normalizeHeroActorType(
        options.actorType || identityActor.actorType || HERO_ACTOR_TYPES.ADMIN,
        actor
    );
    const timestamp = Date.now();
    const existingTruth = normalizeCreatorTruth(record?.creatorTruth);
    const creatorTruth = captureCreatorTruth(record);

    const gate = gateHeroTransition({
        previousStatus: prev.status,
        nextStatus: HERO_PRESENTATION_STATUS.ARCHIVED,
        action: HERO_AUDIT_ACTIONS.ARCHIVED,
        sourceType,
        actor,
        actorType,
        creatorTruthBefore: existingTruth,
        creatorTruthAfter: creatorTruth,
        auditLog: previousLog
    });
    if (!gate.ok) {
        return { ok: false, recordPatch: null, errors: gate.errors };
    }

    const heroPresentation = normalizeHeroPresentation({
        ...prev,
        status: HERO_PRESENTATION_STATUS.ARCHIVED
    });

    const evt = buildLifecycleAuditEvent({
        record: /** @type {Record<string, unknown>} */ (record || {}),
        action: HERO_AUDIT_ACTIONS.ARCHIVED,
        previousStatus: prev.status,
        newStatus: HERO_PRESENTATION_STATUS.ARCHIVED,
        actor,
        actorType,
        sourceType,
        changedFields: ['status'],
        timestamp
    });
    if (!evt.ok || !evt.event) {
        return {
            ok: false,
            recordPatch: null,
            errors: evt.errors.length ? evt.errors : ['audit_event_failed']
        };
    }

    const auditLog = appendHeroAuditEvents(previousLog, [evt.event]);
    return {
        ok: true,
        errors: [],
        recordPatch: {
            creatorTruth,
            adminContext: normalizeAdminContext(record?.adminContext),
            heroPresentation,
            visibility: { ...HERO_VISIBILITY_POLICY },
            auditLog
        },
        creatorTruth,
        adminContext: normalizeAdminContext(record?.adminContext),
        heroPresentation,
        visibility: { ...HERO_VISIBILITY_POLICY },
        auditLog
    };
}

/**
 * Save admin draft without publishing (not public).
 * Flow: validateHeroTransition → createHeroAuditEvent → caller saveHeroRecord.
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {Partial<HeroPresentationBlock> & Partial<HeroAdminContextBlock> & {
 *   showIntelligence?: boolean;
 *   sourceType?: string;
 *   actor?: string;
 *   actorType?: string;
 * }} draft
 */
export function draftHeroPresentation(record, draft = {}) {
    const prev = normalizeHeroPresentation(record?.heroPresentation);
    const prevAdmin = normalizeAdminContext(record?.adminContext);
    const existingTruth = normalizeCreatorTruth(record?.creatorTruth);
    const creatorTruth = captureCreatorTruth(record);
    const previousLog = normalizeHeroAuditLog(record?.auditLog);
    const sourceType = normalizeHeroAuthoritySourceType(draft.sourceType);
    const identityActor = resolveEditorialActor({
        actor: draft.actor,
        actorType: draft.actorType
    });
    const actor = text(draft.actor) || identityActor.actor || '';
    const actorType = normalizeHeroActorType(
        draft.actorType || identityActor.actorType || HERO_ACTOR_TYPES.ADMIN,
        actor
    );

    // Force admin-only statuses when drafting; never leave published without re-approval.
    const nextStatus =
        prev.status === HERO_PRESENTATION_STATUS.PUBLISHED ||
        prev.status === HERO_PRESENTATION_STATUS.APPROVED
            ? HERO_PRESENTATION_STATUS.DRAFT
            : prev.status === HERO_PRESENTATION_STATUS.REVIEW
              ? HERO_PRESENTATION_STATUS.REVIEW
              : HERO_PRESENTATION_STATUS.DRAFT;

    const gate = gateHeroTransition({
        previousStatus: prev.status,
        nextStatus,
        action: HERO_AUDIT_ACTIONS.EDITED,
        sourceType,
        actor: actor || identityActor.actor,
        actorType: actor ? actorType : identityActor.actorType || HERO_ACTOR_TYPES.ADMIN,
        creatorTruthBefore: existingTruth,
        creatorTruthAfter: creatorTruth,
        auditLog: previousLog
    });

    // Fail closed: unauthorized cannot edit presentation into recordPatch with events.
    // Still return a non-mutating draft view when blocked.
    if (!gate.ok) {
        return {
            ok: false,
            errors: gate.errors,
            creatorTruth: existingTruth.title ? existingTruth : creatorTruth,
            adminContext: prevAdmin,
            heroPresentation: prev,
            visibility: { ...HERO_VISIBILITY_POLICY },
            auditLog: previousLog
        };
    }

    const heroPresentation = normalizeHeroPresentation({
        ...prev,
        publicTitle: draft.publicTitle !== undefined ? draft.publicTitle : prev.publicTitle,
        publicDescription:
            draft.publicDescription !== undefined
                ? draft.publicDescription
                : prev.publicDescription,
        publicTheme: draft.publicTheme !== undefined ? draft.publicTheme : prev.publicTheme,
        showIntelligence:
            draft.showIntelligence !== undefined ? draft.showIntelligence : prev.showIntelligence,
        status: nextStatus,
        approvedBy: '',
        approvedAt: null
    });

    const adminContext = normalizeAdminContext({
        ...prevAdmin,
        sourceTitle:
            draft.sourceTitle !== undefined ? draft.sourceTitle : prevAdmin.sourceTitle || creatorTruth.title,
        sourceDescription:
            draft.sourceDescription !== undefined
                ? draft.sourceDescription
                : prevAdmin.sourceDescription || creatorTruth.description,
        identityNotes:
            draft.identityNotes !== undefined ? draft.identityNotes : prevAdmin.identityNotes,
        editorialNotes:
            draft.editorialNotes !== undefined ? draft.editorialNotes : prevAdmin.editorialNotes
    });

    const resolvedActor = actor || identityActor.actor;
    const resolvedActorType = actor ? actorType : identityActor.actorType || HERO_ACTOR_TYPES.ADMIN;
    const changedFields = computePresentationChangedFields(prev, heroPresentation);
    /** @type {import('./heroAuditEvents.js').HeroAuditEvent[]} */
    const newEvents = [];

    if (!rejectNonAuthoritySource(sourceType) && changedFields.length > 0) {
        const hadPresentation =
            Boolean(prev.publicTitle || prev.publicDescription || prev.publicTheme) ||
            previousLog.length > 0;
        const hasPresentation = Boolean(
            heroPresentation.publicTitle ||
                heroPresentation.publicDescription ||
                heroPresentation.publicTheme
        );

        const action =
            !hadPresentation && hasPresentation
                ? HERO_AUDIT_ACTIONS.CREATED
                : HERO_AUDIT_ACTIONS.EDITED;
        const evt = buildLifecycleAuditEvent({
            record: /** @type {Record<string, unknown>} */ (record || {}),
            action,
            previousStatus: prev.status,
            newStatus: nextStatus,
            actor: resolvedActor,
            actorType: resolvedActorType,
            sourceType,
            changedFields
        });
        if (evt.ok && evt.event) newEvents.push(evt.event);
    }

    return {
        ok: true,
        errors: [],
        creatorTruth,
        adminContext,
        heroPresentation,
        visibility: { ...HERO_VISIBILITY_POLICY },
        auditLog: appendHeroAuditEvents(previousLog, newEvents)
    };
}

/**
 * Public-safe subset of approved presentation fields only.
 * Never exposes admin notes, discovery-only, or intelligence-only identity.
 * @param {HeroPresentationBlock} presentation
 */
export function publicHeroPresentationFields(presentation) {
    const p = normalizeHeroPresentation(presentation);
    return {
        publicTitle: p.publicTitle,
        publicDescription: p.publicDescription,
        publicTheme: p.publicTheme,
        status: p.status,
        showIntelligence: p.showIntelligence
    };
}

/**
 * Viewer resolution — never AI suggestion → public identity.
 *
 * Resolve order (public presentation):
 *   1. server verified heroPresentation
 *   2. creatorTruth
 *   3. approved creatorIntentContext
 *   4. approved intelligenceExplanation
 *   5. approved discovery connections
 *   6. viewer trust signals (Creator Collection / Featured Collection / Explore Themes)
 *
 * Never returns as identity:
 * - intelligence-only content
 * - discovery-only content
 * - admin notes
 * - failed audit data
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {{
 *   intelligenceThemes?: string[];
 *   intelligenceMood?: string;
 *   forceShowIntelligence?: boolean;
 *   skipVerification?: boolean;
 * }} [options]
 */
export function resolvePublicHeroViewerCopy(record, options = {}) {
    const verification =
        options.skipVerification === true
            ? { verified: true, reason: '', violations: [] }
            : verifyHeroRecordIntegrity(record);

    const creatorTruth = normalizeCreatorTruth(record?.creatorTruth);
    const presentation = normalizeHeroPresentation(record?.heroPresentation);

    // Phase 7: only server-granted published + verified integrity may show presentation.
    const published =
        verification.verified === true &&
        isPublicHeroPresentation(presentation) &&
        isServerGrantedPublished(record);

    const legacyTitle = text(record?.heroTitle);
    const legacyDescription = text(record?.heroDescription);
    const truthTitle = creatorTruth.title || legacyTitle || text(record?.title);
    const truthDescription = creatorTruth.description || legacyDescription;

    let title = '';
    let description = '';
    let theme = '';
    /** @type {'heroPresentation' | 'creatorTruth' | 'none'} */
    let titleSource = 'none';

    if (published) {
        title = presentation.publicTitle || truthTitle;
        description = presentation.publicDescription || truthDescription;
        theme = presentation.publicTheme;
        titleSource = 'heroPresentation';
    } else if (truthTitle || truthDescription) {
        // Safe creatorTruth fallback — no lifecycle claims when unverified/unpublished
        title = truthTitle;
        description = truthDescription;
        theme = '';
        titleSource = truthTitle ? 'creatorTruth' : 'none';
    } else {
        title = '';
        description = '';
        theme = '';
        titleSource = 'none';
    }

    // Intelligence is never identity: approved explanation statements only.
    const showToggle =
        options.forceShowIntelligence === true ||
        (presentation.showIntelligence !== false &&
            HERO_VISIBILITY_POLICY.intelligenceExplanation === 'optional');

    const publicIntel = resolvePublicIntelligenceExplanation(record, {
        showIntelligence: showToggle,
        forceShow: options.forceShowIntelligence === true
    });

    return {
        title,
        description,
        theme,
        titleSource,
        verified: verification.verified === true,
        verificationReason: verification.verified ? '' : verification.reason || 'verification_failed',
        creatorTruth: {
            title: creatorTruth.title,
            description: creatorTruth.description,
            genre: creatorTruth.genre,
            identityTerms: creatorTruth.identityTerms,
            sourceAssetTitle: creatorTruth.sourceAssetTitle,
            immutable: creatorTruth.immutable,
            adminOnly: true
        },
        creatorIntent: (() => {
            const intent = resolvePublicCreatorIntent(record);
            return {
                text: intent.text,
                visible: intent.visible,
                authoritative: false,
                reason: intent.reason
            };
        })(),
        // Never expose adminContext body on public resolution surface
        adminContext: null,
        // Never expose raw audit failures publicly
        auditLog: null,
        heroPresentation: published
            ? publicHeroPresentationFields(presentation)
            : {
                  publicTitle: '',
                  publicDescription: '',
                  publicTheme: '',
                  status: verification.verified ? presentation.status : 'draft',
                  showIntelligence: false
              },
        visibility: { ...HERO_VISIBILITY_POLICY },
        intelligenceExplanation: {
            // Public surface: explanation lines only (no sourceType / actors)
            lines: publicIntel.lines,
            statements: publicIntel.statements,
            approved: publicIntel.approved,
            authoritative: false,
            visible: publicIntel.visible,
            reason: publicIntel.reason
        },
        discoveryConnections: (() => {
            const pub = resolvePublicDiscoveryConnections(record);
            return {
                connections: pub.connections,
                visible: pub.visible,
                authoritative: false,
                reason: pub.reason
            };
        })(),
        trustSignals: resolveViewerTrustSignals(record, {
            featuredCollection: /** @type {any} */ (options).featuredCollection,
            featuredSeries: /** @type {any} */ (options).featuredSeries,
            creatorCollection: /** @type {any} */ (options).creatorCollection,
            exploreThemes: /** @type {any} */ (options).exploreThemes,
            skipVerification: options.skipVerification === true
        }),
        isPublicApproved: published,
        isPublished: published,
        presentationStatus: published
            ? presentation.status
            : verification.verified
              ? presentation.status
              : 'draft'
    };
}

/**
 * Hard gate: NLP/discovery cannot write directly into public Hero fields.
 * Always blocks; used by validators + optional runtime call sites.
 *
 * @param {Record<string, unknown>} publicFields
 * @param {unknown} sourceType
 */
export function applyNlpToHeroPublicFields(publicFields, sourceType) {
    const source = String(sourceType || 'ai')
        .trim()
        .toLowerCase();
    /** @type {string[]} */
    const blocked = [];
    const fields = publicFields && typeof publicFields === 'object' ? publicFields : {};

    for (const key of Object.keys(fields)) {
        if (
            [
                'publicTitle',
                'publicDescription',
                'publicTheme',
                'heroTitle',
                'heroDescription',
                'genre',
                'title',
                'status'
            ].includes(key)
        ) {
            blocked.push(key);
        }
    }

    if (fields.genre || fields.discoveryCategory || fields.category) {
        for (const k of ['genre', 'discoveryCategory', 'category']) {
            if (fields[k] !== undefined && !blocked.includes(k)) blocked.push(k);
        }
    }

    // Intelligence cannot set published state
    if (fields.status === HERO_PRESENTATION_STATUS.PUBLISHED || fields.status === 'published') {
        if (!blocked.includes('status')) blocked.push('status');
    }

    return {
        ok: false,
        blocked,
        written: [],
        reason:
            source === 'discovery'
                ? 'discovery-cannot-become-hero-identity'
                : 'nlp-cannot-write-hero-public-fields'
    };
}

/**
 * Promote discovery category → genre/title must fail.
 * @param {string} category
 * @param {'genre' | 'title' | 'publicTitle'} target
 */
export function promoteDiscoveryToHeroIdentity(category, target) {
    return {
        ok: false,
        target,
        category: text(category),
        reason: 'discovery-cannot-become-hero-identity'
    };
}

/**
 * Attempt to set published via intelligenceExplanation metadata — always fails.
 * @param {unknown} record
 * @param {unknown} explanationPayload
 */
export function publishViaIntelligenceExplanation(record, explanationPayload) {
    void record;
    void explanationPayload;
    return {
        ok: false,
        errors: ['intelligence_explanation_cannot_set_published'],
        recordPatch: null
    };
}

/**
 * @param {unknown} record
 * @returns {{ ok: boolean; errors: string[] }}
 */
export function auditHeroPresentationProvenance(record) {
    /** @type {string[]} */
    const errors = [];
    if (!record || typeof record !== 'object') {
        return { ok: false, errors: ['record_missing'] };
    }
    const row = /** @type {Record<string, unknown>} */ (record);
    const presentation = normalizeHeroPresentation(row.heroPresentation);

    if (
        presentation.status === HERO_PRESENTATION_STATUS.APPROVED ||
        presentation.status === HERO_PRESENTATION_STATUS.PUBLISHED
    ) {
        if (!presentation.approvedBy) errors.push('missing_approval_approvedBy');
        if (!presentation.approvedAt) errors.push('missing_approval_approvedAt');
    }

    if (presentation.status === HERO_PRESENTATION_STATUS.PUBLISHED) {
        if (!presentation.approvedBy || !presentation.approvedAt) {
            errors.push('missing_approval_metadata_publishes_publicly');
        }
        if (!presentation.publicTitle && !presentation.publicDescription) {
            errors.push('public_presentation_empty');
        }
    }

    // creatorTruth immutable flag
    const creatorTruth = normalizeCreatorTruth(row.creatorTruth);
    if (creatorTruth.title && creatorTruth.immutable === false) {
        errors.push('creator_truth_must_be_immutable');
    }

    return { ok: errors.length === 0, errors };
}

/**
 * Build authority layers for a HeroRecord-shaped object (pure).
 * @param {Record<string, unknown> | null | undefined} record
 */
export function buildHeroAuthorityLayers(record) {
    return {
        creatorTruth: captureCreatorTruth(record),
        adminContext: normalizeAdminContext(record?.adminContext),
        heroPresentation: normalizeHeroPresentation(record?.heroPresentation),
        visibility: { ...HERO_VISIBILITY_POLICY },
        viewer: resolvePublicHeroViewerCopy(record)
    };
}
