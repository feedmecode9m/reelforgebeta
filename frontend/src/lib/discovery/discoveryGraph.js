/**
 * Explainable Discovery Graph (Phase 10)
 *
 * Discovery may create meaningful exploration connections.
 * Discovery does not become creator truth.
 *
 * Allowed relationships:
 *   - theme connections
 *   - historical context links
 *   - creator connections (exploration only — never attribution)
 *   - viewer exploration paths
 *
 * Forbidden:
 *   - identity / cultural ownership / official genre
 *   - creator attribution / series metadata
 *
 * Public requires Master Hero Admin approval.
 * Stored separately from creatorTruth, heroPresentation, intelligenceExplanation.
 *
 * @see ../hero/heroRecord.js
 * @see ../hero/heroPresentationAuthority.js
 * @see ../architecture/creatorTruthLayers.js
 */

/** Allowed relationship kinds (discovery-only graph edges). */
export const DISCOVERY_RELATIONSHIP_TYPES = Object.freeze({
    THEME: 'theme_connection',
    HISTORICAL_CONTEXT: 'historical_context',
    CREATOR_CONNECTION: 'creator_connection',
    EXPLORATION_PATH: 'exploration_path'
});

/** @type {ReadonlyArray<string>} */
export const DISCOVERY_RELATIONSHIP_TYPE_VALUES = Object.freeze(
    Object.values(DISCOVERY_RELATIONSHIP_TYPES)
);

/** Viewer-safe labels (no internal architecture). */
export const DISCOVERY_PUBLIC_LABELS = Object.freeze({
    [DISCOVERY_RELATIONSHIP_TYPES.THEME]: 'Explore Theme',
    [DISCOVERY_RELATIONSHIP_TYPES.HISTORICAL_CONTEXT]: 'Historical Context',
    [DISCOVERY_RELATIONSHIP_TYPES.CREATOR_CONNECTION]: 'Related Creators',
    [DISCOVERY_RELATIONSHIP_TYPES.EXPLORATION_PATH]: 'Explore Further'
});

/**
 * Fields discovery must never write (creator truth / identity / ownership).
 * @type {ReadonlyArray<string>}
 */
export const DISCOVERY_FORBIDDEN_TRUTH_FIELDS = Object.freeze([
    'title',
    'description',
    'genre',
    'officialGenre',
    'identity',
    'identityTerms',
    'culturalOwnership',
    'culturalRegion',
    'communityRepresented',
    'creatorTruth',
    'creatorAttribution',
    'creatorName',
    'heroIdentity',
    'seriesMetadata',
    'seriesTitle',
    'seriesId',
    'episodeTitle',
    'episodeId',
    'publicTitle',
    'publicDescription',
    'heroTitle',
    'heroDescription'
]);

/**
 * Keys that must never appear on public discovery connections.
 * @type {ReadonlyArray<string>}
 */
export const FORBIDDEN_PUBLIC_DISCOVERY_KEYS = Object.freeze([
    'sourceType',
    'source',
    'actor',
    'actorId',
    'approvedBy',
    'approvedAt',
    'rejectedBy',
    'rejectedAt',
    'confidence',
    'score',
    'nlpConfidence',
    'internalNotes',
    'adminNotes',
    'editorialNotes',
    'identityNotes',
    'rawPayload',
    'modelId',
    'embedding',
    'discoveryMetadata',
    'auditLog',
    'serverAuthorityReceipt',
    'creatorTruth',
    'heroPresentation',
    'intelligenceExplanation'
]);

/**
 * @typedef {Object} DiscoveryRelationship
 * @property {string} relationshipId
 * @property {string} type
 * @property {string} label  short viewer path label
 * @property {string} [target] optional exploration target name (not identity ownership)
 * @property {string} [context] optional short explorer context
 * @property {boolean} approved
 * @property {string} approvedBy
 * @property {number | null} approvedAt
 * @property {boolean} rejected
 * @property {string} [rejectedBy]
 * @property {number | null} [rejectedAt]
 * @property {boolean} hidden
 * @property {false} authoritative
 * @property {string} [suggestedBy] internal only; never public
 */

/**
 * @typedef {Object} DiscoveryGraphBlock
 * @property {DiscoveryRelationship[]} relationships
 * @property {false} authoritative
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @returns {string}
 */
function mintRelationshipId() {
    return `drel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeDiscoveryRelationshipType(raw) {
    const s = text(raw)
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
    if (
        s === DISCOVERY_RELATIONSHIP_TYPES.THEME ||
        s === 'theme' ||
        s === 'themes' ||
        s === 'theme_links'
    ) {
        return DISCOVERY_RELATIONSHIP_TYPES.THEME;
    }
    if (
        s === DISCOVERY_RELATIONSHIP_TYPES.HISTORICAL_CONTEXT ||
        s === 'historical' ||
        s === 'history' ||
        s === 'context'
    ) {
        return DISCOVERY_RELATIONSHIP_TYPES.HISTORICAL_CONTEXT;
    }
    if (
        s === DISCOVERY_RELATIONSHIP_TYPES.CREATOR_CONNECTION ||
        s === 'creator' ||
        s === 'creators' ||
        s === 'related_creators'
    ) {
        return DISCOVERY_RELATIONSHIP_TYPES.CREATOR_CONNECTION;
    }
    if (
        s === DISCOVERY_RELATIONSHIP_TYPES.EXPLORATION_PATH ||
        s === 'exploration' ||
        s === 'explore' ||
        s === 'path'
    ) {
        return DISCOVERY_RELATIONSHIP_TYPES.EXPLORATION_PATH;
    }
    return '';
}

/**
 * Detect forbidden truth-mutation keys on a candidate payload.
 * @param {unknown} payload
 * @returns {string[]}
 */
export function listForbiddenDiscoveryTruthKeys(payload) {
    if (!payload || typeof payload !== 'object') return [];
    const row = /** @type {Record<string, unknown>} */ (payload);
    /** @type {string[]} */
    const found = [];
    for (const key of DISCOVERY_FORBIDDEN_TRUTH_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null && row[key] !== '') {
            found.push(key);
        }
    }
    return found;
}

/**
 * @returns {DiscoveryGraphBlock}
 */
export function createEmptyDiscoveryGraph() {
    return {
        relationships: [],
        authoritative: false
    };
}

/**
 * Normalize one relationship without granting public approval.
 * @param {unknown} raw
 * @returns {DiscoveryRelationship | null}
 */
export function normalizeDiscoveryRelationship(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const type = normalizeDiscoveryRelationshipType(row.type || row.kind || row.relationshipType);
    if (!type) return null;

    const label = text(row.label || row.name || row.pathLabel);
    if (!label) return null;

    const approvedBy = text(row.approvedBy);
    const approvedAtRaw = Number(row.approvedAt);
    const approved =
        row.approved === true &&
        Boolean(approvedBy) &&
        Number.isFinite(approvedAtRaw) &&
        approvedAtRaw > 0;

    const rejected = row.rejected === true;
    const rejectedBy = text(row.rejectedBy);
    const rejectedAtRaw = Number(row.rejectedAt);

    return {
        relationshipId: text(row.relationshipId) || mintRelationshipId(),
        type,
        label,
        target: text(row.target || row.to || row.related),
        context: text(row.context || row.description),
        approved,
        approvedBy: approved ? approvedBy : '',
        approvedAt: approved ? approvedAtRaw : null,
        rejected,
        rejectedBy: rejected ? rejectedBy : '',
        rejectedAt:
            rejected && Number.isFinite(rejectedAtRaw) && rejectedAtRaw > 0 ? rejectedAtRaw : null,
        hidden: row.hidden === true,
        authoritative: false,
        // kept for admin review only — stripped from public resolve
        suggestedBy: text(row.suggestedBy || row.source || 'discovery')
    };
}

/**
 * @param {unknown} raw
 * @returns {DiscoveryGraphBlock}
 */
export function normalizeDiscoveryGraph(raw) {
    if (!raw || typeof raw !== 'object') {
        return createEmptyDiscoveryGraph();
    }
    const row = /** @type {Record<string, unknown>} */ (raw);
    const list = Array.isArray(row.relationships)
        ? row.relationships
        : Array.isArray(row)
          ? row
          : Array.isArray(row.edges)
            ? row.edges
            : [];

    /** @type {DiscoveryRelationship[]} */
    const relationships = [];
    for (const item of list) {
        const rel = normalizeDiscoveryRelationship(item);
        if (rel) relationships.push(rel);
    }

    return {
        relationships,
        authoritative: false
    };
}

/**
 * Create a discovery relationship (draft by default — never auto-approved).
 *
 * @param {{
 *   type?: string;
 *   label?: string;
 *   target?: string;
 *   context?: string;
 *   relationshipId?: string;
 *   suggestedBy?: string;
 *   // Forbidden if present:
 *   genre?: unknown;
 *   identity?: unknown;
 *   creatorTruth?: unknown;
 *   seriesMetadata?: unknown;
 *   culturalOwnership?: unknown;
 * }} [input]
 * @returns {{ ok: boolean; relationship: DiscoveryRelationship | null; errors: string[] }}
 */
export function createDiscoveryRelationship(input = {}) {
    const forbidden = listForbiddenDiscoveryTruthKeys(input);
    if (forbidden.length) {
        return {
            ok: false,
            relationship: null,
            errors: [
                'discovery_cannot_write_truth',
                ...forbidden.map((k) => `forbidden_field:${k}`)
            ]
        };
    }

    const type = normalizeDiscoveryRelationshipType(input.type);
    if (!type) {
        return {
            ok: false,
            relationship: null,
            errors: ['invalid_relationship_type']
        };
    }

    const label = text(input.label);
    if (!label) {
        return {
            ok: false,
            relationship: null,
            errors: ['label_required']
        };
    }

    // Creation never auto-approves.
    const relationship = normalizeDiscoveryRelationship({
        relationshipId: input.relationshipId || mintRelationshipId(),
        type,
        label,
        target: input.target,
        context: input.context,
        approved: false,
        approvedBy: '',
        approvedAt: null,
        rejected: false,
        hidden: false,
        authoritative: false,
        suggestedBy: input.suggestedBy || 'discovery'
    });

    const validation = validateDiscoveryRelationship(relationship);
    if (!validation.ok || !relationship) {
        return {
            ok: false,
            relationship: null,
            errors: validation.errors.length ? validation.errors : ['invalid_relationship']
        };
    }

    return { ok: true, relationship, errors: [] };
}

/**
 * Validate structure + approval invariants.
 * @param {unknown} raw
 * @returns {{ ok: boolean; errors: string[]; relationship: DiscoveryRelationship | null }}
 */
export function validateDiscoveryRelationship(raw) {
    /** @type {string[]} */
    const errors = [];
    if (raw && typeof raw === 'object') {
        const forbidden = listForbiddenDiscoveryTruthKeys(raw);
        if (forbidden.length) {
            errors.push('discovery_cannot_write_truth');
            for (const k of forbidden) errors.push(`forbidden_field:${k}`);
        }
    }

    const relationship = normalizeDiscoveryRelationship(raw);
    if (!relationship) {
        errors.push('invalid_relationship');
        return { ok: false, errors, relationship: null };
    }

    if (!DISCOVERY_RELATIONSHIP_TYPE_VALUES.includes(relationship.type)) {
        errors.push('invalid_relationship_type');
    }
    if (!relationship.label) errors.push('label_required');

    if (relationship.approved) {
        if (!relationship.approvedBy) errors.push('approved_requires_approvedBy');
        if (!relationship.approvedAt) errors.push('approved_requires_approvedAt');
    }

    if (/** @type {any} */ (raw)?.authoritative === true) {
        errors.push('discovery_cannot_be_authoritative');
    }

    // Rejected + approved is inconsistent
    if (relationship.approved && relationship.rejected) {
        errors.push('cannot_be_approved_and_rejected');
    }

    return {
        ok: errors.length === 0,
        errors,
        relationship
    };
}

/**
 * Master Hero Admin: approve a relationship for public display.
 * @param {unknown} raw
 * @param {{ approvedBy?: string; actorId?: string }} [options]
 */
export function approveDiscoveryRelationship(raw, options = {}) {
    const base = normalizeDiscoveryRelationship(raw);
    if (!base) {
        return { ok: false, relationship: null, errors: ['invalid_relationship'] };
    }
    const approvedBy = text(options.approvedBy || options.actorId);
    if (!approvedBy) {
        return { ok: false, relationship: base, errors: ['approvedBy_required'] };
    }

    const relationship = {
        ...base,
        approved: true,
        approvedBy,
        approvedAt: Date.now(),
        rejected: false,
        rejectedBy: '',
        rejectedAt: null,
        hidden: false,
        authoritative: false
    };
    const validation = validateDiscoveryRelationship(relationship);
    return {
        ok: validation.ok,
        relationship: validation.ok ? relationship : base,
        errors: validation.errors
    };
}

/**
 * Master Hero Admin: reject a suggested connection.
 * @param {unknown} raw
 * @param {{ rejectedBy?: string; actorId?: string }} [options]
 */
export function rejectDiscoveryRelationship(raw, options = {}) {
    const base = normalizeDiscoveryRelationship(raw);
    if (!base) {
        return { ok: false, relationship: null, errors: ['invalid_relationship'] };
    }
    const rejectedBy = text(options.rejectedBy || options.actorId) || 'admin';
    const relationship = {
        ...base,
        approved: false,
        approvedBy: '',
        approvedAt: null,
        rejected: true,
        rejectedBy,
        rejectedAt: Date.now(),
        authoritative: false
    };
    return { ok: true, relationship, errors: [] };
}

/**
 * Master Hero Admin: hide (suppress public) without deleting.
 * @param {unknown} raw
 */
export function hideDiscoveryRelationship(raw) {
    const base = normalizeDiscoveryRelationship(raw);
    if (!base) {
        return { ok: false, relationship: null, errors: ['invalid_relationship'] };
    }
    return {
        ok: true,
        relationship: {
            ...base,
            hidden: true,
            authoritative: false
        },
        errors: []
    };
}

/**
 * Upsert relationship into a graph block.
 * @param {unknown} graph
 * @param {DiscoveryRelationship} relationship
 * @returns {DiscoveryGraphBlock}
 */
export function upsertDiscoveryRelationship(graph, relationship) {
    const next = normalizeDiscoveryGraph(graph);
    const id = relationship.relationshipId;
    const idx = next.relationships.findIndex((r) => r.relationshipId === id);
    if (idx >= 0) {
        next.relationships[idx] = relationship;
    } else {
        next.relationships.push(relationship);
    }
    next.authoritative = false;
    return next;
}

/**
 * Public resolver — only approved, non-hidden, non-rejected connections.
 * Strips internal metadata (actors, confidence, notes).
 *
 * @param {unknown} recordOrGraph HeroRecord or discoveryGraph block
 * @returns {{
 *   connections: Array<{
 *     relationshipId: string;
 *     type: string;
 *     label: string;
 *     target: string;
 *     context: string;
 *     publicLabel: string;
 *     authoritative: false;
 *   }>;
 *   visible: boolean;
 *   authoritative: false;
 *   reason: string;
 * }}
 */
export function resolvePublicDiscoveryConnections(recordOrGraph) {
    /** @type {DiscoveryGraphBlock} */
    let graph;
    if (
        recordOrGraph &&
        typeof recordOrGraph === 'object' &&
        'discoveryGraph' in /** @type {object} */ (recordOrGraph)
    ) {
        graph = normalizeDiscoveryGraph(
            /** @type {Record<string, unknown>} */ (recordOrGraph).discoveryGraph
        );
    } else {
        graph = normalizeDiscoveryGraph(recordOrGraph);
    }

    /** @type {Array<{
     *   relationshipId: string;
     *   type: string;
     *   label: string;
     *   target: string;
     *   context: string;
     *   publicLabel: string;
     *   authoritative: false;
     * }>} */
    const connections = [];

    for (const rel of graph.relationships) {
        if (!rel.approved || rel.rejected || rel.hidden) continue;
        if (!rel.approvedBy || !rel.approvedAt) continue;

        connections.push({
            relationshipId: rel.relationshipId,
            type: rel.type,
            label: rel.label,
            target: rel.target || '',
            context: rel.context || '',
            publicLabel: DISCOVERY_PUBLIC_LABELS[rel.type] || 'Explore Further',
            authoritative: false
        });
    }

    return {
        connections,
        visible: connections.length > 0,
        authoritative: false,
        reason: connections.length ? '' : 'no_approved_discovery_connections'
    };
}

/**
 * Hard block: discovery attempt to mutate creatorTruth.
 *
 * @param {Record<string, unknown> | null | undefined} creatorTruthBefore
 * @param {Record<string, unknown> | null | undefined} creatorTruthAfter
 * @param {unknown} discoveryPayload
 */
export function applyDiscoveryToCreatorTruth(creatorTruthBefore, creatorTruthAfter, discoveryPayload) {
    const forbidden = listForbiddenDiscoveryTruthKeys(discoveryPayload);
    /** @type {string[]} */
    const errors = ['discovery_cannot_write_truth'];
    if (forbidden.length) {
        for (const k of forbidden) errors.push(`forbidden_field:${k}`);
    }

    if (creatorTruthBefore && creatorTruthAfter) {
        const keys = new Set([
            ...Object.keys(creatorTruthBefore),
            ...Object.keys(creatorTruthAfter)
        ]);
        for (const key of keys) {
            const a = JSON.stringify(creatorTruthBefore[key] ?? null);
            const b = JSON.stringify(creatorTruthAfter[key] ?? null);
            if (a !== b) errors.push(`creatorTruth_mutated:${key}`);
        }
    }

    return {
        ok: false,
        errors,
        creatorTruth: creatorTruthBefore
            ? { ...creatorTruthBefore }
            : creatorTruthAfter
              ? { ...creatorTruthAfter }
              : null
    };
}

/**
 * Discovery promotion → identity / genre / cultural ownership — always fails.
 * @param {string} category
 * @param {'identity' | 'genre' | 'cultural_ownership' | 'creator_attribution' | 'series_metadata'} target
 */
export function promoteDiscoveryToCreatorTruth(category, target) {
    return {
        ok: false,
        category: text(category),
        target: text(target),
        reason: 'discovery_cannot_become_creator_truth'
    };
}

/**
 * AI auto-approve of discovery — always blocked.
 * @param {unknown} _rel
 */
export function autoApproveDiscoveryRelationship(_rel) {
    void _rel;
    return {
        ok: false,
        errors: ['discovery_cannot_auto_approve'],
        relationship: null
    };
}

/**
 * Deep-scan public discovery payload for forbidden leakage.
 * @param {unknown} value
 * @param {string[]} [path]
 * @returns {string[]}
 */
export function findForbiddenDiscoveryPublicLeaks(value, path = []) {
    /** @type {string[]} */
    const leaks = [];
    if (value == null) return leaks;
    if (Array.isArray(value)) {
        value.forEach((item, i) => {
            leaks.push(...findForbiddenDiscoveryPublicLeaks(item, [...path, String(i)]));
        });
        return leaks;
    }
    if (typeof value !== 'object') return leaks;
    for (const [key, child] of Object.entries(value)) {
        const nextPath = [...path, key];
        if (FORBIDDEN_PUBLIC_DISCOVERY_KEYS.includes(key)) {
            leaks.push(nextPath.join('.'));
            continue;
        }
        leaks.push(...findForbiddenDiscoveryPublicLeaks(child, nextPath));
    }
    return leaks;
}
