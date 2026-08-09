/**
 * Viewer Trust Presentation Layer (Phase 9)
 *
 * Expose provenance *safely* to viewers without leaking internal architecture.
 *
 * Allowed public signals only:
 *   - Creator Collection
 *   - Featured Collection
 *   - Explore Themes
 *
 * Never expose:
 *   - sourceType / actor identity / admin notes
 *   - NLP confidence / discovery metadata
 *   - internal provenance / audit / server authority fields
 *
 * Note: does not import heroPresentationAuthority (avoids circular load with public resolve).
 *
 * @see ../hero/heroPresentationAuthority.js
 * @see ../hero/heroIntelligenceExplanation.js
 * @see ./viewerIntelligencePresentation.js
 */

import { isServerGrantedPublished } from '../hero/heroServerAuthorityEngine.js';

/** Viewer-facing signal labels (stable product copy). */
export const VIEWER_TRUST_LABELS = Object.freeze({
    CREATOR_COLLECTION: 'Creator Collection',
    FEATURED_COLLECTION: 'Featured Collection',
    EXPLORE_THEMES: 'Explore Themes'
});

/**
 * Keys that must never appear on viewer trust surfaces (deep).
 * @type {ReadonlyArray<string>}
 */
export const FORBIDDEN_VIEWER_TRUST_KEYS = Object.freeze([
    'sourceType',
    'source',
    'actor',
    'actorId',
    'actorRole',
    'actorType',
    'approvedBy',
    'approvedAt',
    'adminContext',
    'editorialNotes',
    'identityNotes',
    'confidence',
    'nlpConfidence',
    'score',
    'discoveryContext',
    'discoveryMetadata',
    'discovery',
    'keywords',
    'shelfLabels',
    'connectionTags',
    'searchKeywords',
    'auditLog',
    'serverAuthorityReceipt',
    'serverAuthorityState',
    'integrityHash',
    'clientIntegrityHash',
    'serverSignature',
    'signatureVersion',
    'authorityEventId',
    'permissions',
    'role',
    'email',
    'provenance',
    'creatorTruthMutation',
    'changedFields'
]);

/**
 * @typedef {Object} ViewerTrustSignalItem
 * @property {'Creator Collection' | 'Featured Collection' | 'Explore Themes'} label
 * @property {string} [value]
 * @property {string[]} [values]
 */

/**
 * @typedef {Object} ViewerTrustSignals
 * @property {ViewerTrustSignalItem | null} creatorCollection
 * @property {ViewerTrustSignalItem | null} featuredCollection
 * @property {ViewerTrustSignalItem | null} exploreThemes
 * @property {ViewerTrustSignalItem[]} items
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function list(value) {
    if (Array.isArray(value)) {
        return value.map((v) => text(v)).filter(Boolean);
    }
    const raw = text(value);
    if (!raw) return [];
    return raw
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Lightweight presentation check (mirrors isPublicHeroPresentation without circular import).
 * @param {unknown} presentation
 */
function isViewerPublicPresentation(presentation) {
    if (!presentation || typeof presentation !== 'object') return false;
    const p = /** @type {Record<string, unknown>} */ (presentation);
    const status = text(p.status).toLowerCase();
    if (status !== 'published') return false;
    if (!text(p.approvedBy) || !p.approvedAt) return false;
    return Boolean(text(p.publicTitle) || text(p.publicDescription) || text(p.publicTheme));
}

/**
 * @param {unknown} value
 * @param {string[]} [path]
 * @returns {string[]}
 */
export function findForbiddenViewerTrustLeaks(value, path = []) {
    /** @type {string[]} */
    const leaks = [];
    if (value == null) return leaks;
    if (Array.isArray(value)) {
        value.forEach((item, i) => {
            leaks.push(...findForbiddenViewerTrustLeaks(item, [...path, String(i)]));
        });
        return leaks;
    }
    if (typeof value !== 'object') return leaks;
    for (const [key, child] of Object.entries(value)) {
        const nextPath = [...path, key];
        if (FORBIDDEN_VIEWER_TRUST_KEYS.includes(key)) {
            leaks.push(nextPath.join('.'));
            continue;
        }
        leaks.push(...findForbiddenViewerTrustLeaks(child, nextPath));
    }
    return leaks;
}

/**
 * True when presentation can feed Featured Collection / Explore Themes.
 * @param {unknown} record
 * @param {{ skipVerification?: boolean }} [options]
 */
function hasViewerTrustedPresentation(record, options = {}) {
    const presentation = record && typeof record === 'object' ? record.heroPresentation : null;
    if (options.skipVerification === true) {
        return isViewerPublicPresentation(presentation);
    }
    return isViewerPublicPresentation(presentation) && isServerGrantedPublished(record);
}

/**
 * Resolve viewer-safe trust indicators only.
 *
 * @param {Record<string, unknown> | null | undefined} heroRecord
 * @param {{
 *   featuredCollection?: string;
 *   featuredSeries?: string;
 *   creatorCollection?: string;
 *   exploreThemes?: string[] | string;
 *   skipVerification?: boolean;
 *   discoveryKeywords?: string[];
 * }} [options]
 * @returns {ViewerTrustSignals}
 */
export function resolveViewerTrustSignals(heroRecord, options = {}) {
    const record =
        heroRecord && typeof heroRecord === 'object'
            ? /** @type {Record<string, unknown>} */ (heroRecord)
            : {};

    // Never use discovery as trust / identity signals.
    void options.discoveryKeywords;

    const presentation =
        record.heroPresentation && typeof record.heroPresentation === 'object'
            ? /** @type {Record<string, unknown>} */ (record.heroPresentation)
            : {};
    const trustedPresentation = hasViewerTrustedPresentation(record, options);

    const creatorCollectionValue =
        text(options.creatorCollection) ||
        text(options.featuredSeries) ||
        text(record.creatorCollection) ||
        text(record.featuredSeries) ||
        text(/** @type {any} */ (record.creatorTruth)?.collectionTitle) ||
        '';

    const featuredValue = trustedPresentation
        ? text(options.featuredCollection) || text(record.featuredCollection) || ''
        : '';

    /** @type {string[]} */
    let themeValues = [];
    if (trustedPresentation && text(presentation.publicTheme)) {
        themeValues = list(presentation.publicTheme);
    }
    if (trustedPresentation) {
        for (const t of list(options.exploreThemes)) {
            if (!themeValues.some((x) => x.toLowerCase() === t.toLowerCase())) {
                themeValues.push(t);
            }
        }
    }

    /** @type {ViewerTrustSignalItem | null} */
    const creatorCollection = creatorCollectionValue
        ? {
              label: VIEWER_TRUST_LABELS.CREATOR_COLLECTION,
              value: creatorCollectionValue
          }
        : null;

    /** @type {ViewerTrustSignalItem | null} */
    const featuredCollection = featuredValue
        ? {
              label: VIEWER_TRUST_LABELS.FEATURED_COLLECTION,
              value: featuredValue
          }
        : null;

    /** @type {ViewerTrustSignalItem | null} */
    const exploreThemes = themeValues.length
        ? {
              label: VIEWER_TRUST_LABELS.EXPLORE_THEMES,
              values: themeValues.slice(0, 6)
          }
        : null;

    /** @type {ViewerTrustSignalItem[]} */
    const items = [];
    if (creatorCollection) items.push(creatorCollection);
    if (featuredCollection) items.push(featuredCollection);
    if (exploreThemes) items.push(exploreThemes);

    /** @type {ViewerTrustSignals} */
    const signals = {
        creatorCollection,
        featuredCollection,
        exploreThemes,
        items
    };

    if (findForbiddenViewerTrustLeaks(signals).length) {
        return {
            creatorCollection: null,
            featuredCollection: null,
            exploreThemes: null,
            items: []
        };
    }

    return signals;
}

/**
 * Guard: discovery cannot become trust identity.
 * @param {string} discoveryLabel
 * @param {'creatorCollection' | 'featuredCollection' | 'genre' | 'title'} target
 */
export function promoteDiscoveryToTrustSignal(discoveryLabel, target) {
    return {
        ok: false,
        label: text(discoveryLabel),
        target: text(target),
        reason: 'discovery_cannot_become_trust_identity'
    };
}

/**
 * Public-safe viewer package (no admin / actor / provenance internals).
 *
 * Display order:
 *   1. verified heroPresentation
 *   2. creatorTruth
 *   3. approved creatorIntentContext
 *   4. approved intelligenceExplanation
 *   5. approved discovery connections
 *   6. viewer trust signals
 *
 * @param {Record<string, unknown> | null | undefined} heroRecord
 * @param {{
 *   publicCopy?: {
 *     title?: string;
 *     description?: string;
 *     theme?: string;
 *     titleSource?: string;
 *     isPublished?: boolean;
 *     isPublicApproved?: boolean;
 *     creatorIntent?: { text?: string; visible?: boolean };
 *     intelligenceExplanation?: { lines?: string[]; visible?: boolean };
 *     discoveryConnections?: { connections?: Array<Record<string, unknown>>; visible?: boolean };
 *     creatorTruth?: { title?: string; genre?: string };
 *   };
 *   featuredCollection?: string;
 *   featuredSeries?: string;
 *   creatorCollection?: string;
 *   exploreThemes?: string[] | string;
 * }} [options]
 */
export function buildPublicViewerPresentation(heroRecord, options = {}) {
    const publicCopy = options.publicCopy || {};
    const trust = resolveViewerTrustSignals(heroRecord, {
        featuredCollection: options.featuredCollection,
        featuredSeries: options.featuredSeries,
        creatorCollection: options.creatorCollection,
        exploreThemes: options.exploreThemes
    });

    const creatorTruth =
        publicCopy.creatorTruth && typeof publicCopy.creatorTruth === 'object'
            ? publicCopy.creatorTruth
            : heroRecord && typeof heroRecord === 'object' && heroRecord.creatorTruth
              ? /** @type {Record<string, unknown>} */ (heroRecord.creatorTruth)
              : {};

    const intelVisible = publicCopy.intelligenceExplanation?.visible === true;
    const intelLines = intelVisible ? list(publicCopy.intelligenceExplanation?.lines) : [];

    /** @type {Record<string, unknown>} */
    const packageOut = {
        title: text(publicCopy.title),
        description: text(publicCopy.description),
        theme: text(publicCopy.theme),
        titleSource: text(publicCopy.titleSource) || 'none',
        isPublished: publicCopy.isPublished === true,
        isPublicApproved: publicCopy.isPublicApproved === true,
        creatorAttribution: {
            title: text(creatorTruth.title),
            genre: text(creatorTruth.genre)
        },
        creatorIntent: {
            text:
                publicCopy.creatorIntent?.visible === true
                    ? text(publicCopy.creatorIntent?.text)
                    : '',
            visible: publicCopy.creatorIntent?.visible === true,
            authoritative: false
        },
        intelligenceExplanation: {
            lines: intelLines,
            visible: intelVisible,
            authoritative: false
        },
        discoveryConnections: {
            connections: Array.isArray(publicCopy.discoveryConnections?.connections)
                ? publicCopy.discoveryConnections.connections.map((c) => ({
                      label: text(c?.label),
                      target: text(c?.target),
                      publicLabel: text(c?.publicLabel) || 'Explore Further',
                      authoritative: false
                  }))
                : [],
            visible: publicCopy.discoveryConnections?.visible === true,
            authoritative: false
        },
        trustSignals: trust,
        displayOrder: [
            'heroPresentation',
            'creatorTruth',
            'creatorIntentContext',
            'intelligenceExplanation',
            'discoveryConnections',
            'viewerTrustSignals'
        ]
    };

    if (findForbiddenViewerTrustLeaks(packageOut).length) {
        return {
            title: packageOut.title,
            description: packageOut.description,
            theme: packageOut.theme,
            titleSource: packageOut.titleSource,
            isPublished: false,
            isPublicApproved: false,
            creatorAttribution: {
                title: text(creatorTruth.title),
                genre: text(creatorTruth.genre)
            },
            creatorIntent: { text: '', visible: false, authoritative: false },
            intelligenceExplanation: { lines: [], visible: false, authoritative: false },
            discoveryConnections: { connections: [], visible: false, authoritative: false },
            trustSignals: {
                creatorCollection: null,
                featuredCollection: null,
                exploreThemes: null,
                items: []
            },
            displayOrder: packageOut.displayOrder
        };
    }

    return packageOut;
}
