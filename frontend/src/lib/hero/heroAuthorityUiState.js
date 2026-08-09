/**
 * Hero Authority production UI / runtime states (Phase 8).
 *
 * Published UI requires:
 *   serverAuthorityReceipt + verified signature + server lifecycle published
 */

import { isServerGrantedPublished } from './heroServerAuthorityEngine.js';
import { normalizeHeroLifecycleStatus } from './heroAuthorityBoundary.js';
import { identityCanRequestServerGrant, resolveAuthorityIdentity } from '../auth/authorityIdentity.js';

/**
 * @typedef {'draft_editing'
 *   | 'pending_approval'
 *   | 'rejected_by_authority'
 *   | 'waiting_for_authentication'
 *   | 'server_unavailable'
 *   | 'published_and_verified'
 * } HeroAuthorityUiStateId
 */

export const HERO_AUTHORITY_UI_STATE = Object.freeze({
    DRAFT_EDITING: 'draft_editing',
    PENDING_APPROVAL: 'pending_approval',
    REJECTED: 'rejected_by_authority',
    WAITING_AUTH: 'waiting_for_authentication',
    SERVER_UNAVAILABLE: 'server_unavailable',
    PUBLISHED_VERIFIED: 'published_and_verified'
});

/** Human-readable labels (never claim "Published" without verification). */
export const HERO_AUTHORITY_UI_LABELS = Object.freeze({
    [HERO_AUTHORITY_UI_STATE.DRAFT_EDITING]: 'Draft editing',
    [HERO_AUTHORITY_UI_STATE.PENDING_APPROVAL]: 'Pending approval',
    [HERO_AUTHORITY_UI_STATE.REJECTED]: 'Rejected by authority',
    [HERO_AUTHORITY_UI_STATE.WAITING_AUTH]: 'Waiting for authentication',
    [HERO_AUTHORITY_UI_STATE.SERVER_UNAVAILABLE]: 'Server unavailable',
    [HERO_AUTHORITY_UI_STATE.PUBLISHED_VERIFIED]: 'Published and verified'
});

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Resolve UI authority state for Manager / diagnostics surfaces.
 *
 * @param {Record<string, unknown> | null | undefined} record
 * @param {{
 *   identity?: import('../auth/authorityIdentity.js').AuthorityIdentity;
 *   lastError?: string;
 *   pending?: boolean;
 *   serverReachable?: boolean | null;
 * }} [options]
 */
export function resolveHeroAuthorityUiState(record, options = {}) {
    const identity = options.identity || resolveAuthorityIdentity();
    const lastError = text(options.lastError).toLowerCase();
    const pending = options.pending === true;
    const serverReachable = options.serverReachable;

    if (!identity.authenticated || !identityCanRequestServerGrant(identity)) {
        if (isServerGrantedPublished(record)) {
            // Public can still see verified published content without being the grantor.
            return {
                id: HERO_AUTHORITY_UI_STATE.PUBLISHED_VERIFIED,
                label: HERO_AUTHORITY_UI_LABELS[HERO_AUTHORITY_UI_STATE.PUBLISHED_VERIFIED],
                canShowPublished: true
            };
        }
        return {
            id: HERO_AUTHORITY_UI_STATE.WAITING_AUTH,
            label: HERO_AUTHORITY_UI_LABELS[HERO_AUTHORITY_UI_STATE.WAITING_AUTH],
            canShowPublished: false
        };
    }

    if (
        lastError.includes('network') ||
        lastError.includes('unavailable') ||
        lastError.includes('fetch_unavailable') ||
        serverReachable === false
    ) {
        return {
            id: HERO_AUTHORITY_UI_STATE.SERVER_UNAVAILABLE,
            label: HERO_AUTHORITY_UI_LABELS[HERO_AUTHORITY_UI_STATE.SERVER_UNAVAILABLE],
            canShowPublished: isServerGrantedPublished(record)
        };
    }

    if (pending) {
        return {
            id: HERO_AUTHORITY_UI_STATE.PENDING_APPROVAL,
            label: HERO_AUTHORITY_UI_LABELS[HERO_AUTHORITY_UI_STATE.PENDING_APPROVAL],
            canShowPublished: false
        };
    }

    if (
        lastError &&
        (lastError.includes('reject') ||
            lastError.includes('denied') ||
            lastError.includes('invalid') ||
            lastError.includes('unauthenticated') ||
            lastError.includes('elevated') ||
            lastError.includes('permission'))
    ) {
        return {
            id: HERO_AUTHORITY_UI_STATE.REJECTED,
            label: HERO_AUTHORITY_UI_LABELS[HERO_AUTHORITY_UI_STATE.REJECTED],
            canShowPublished: false
        };
    }

    if (isServerGrantedPublished(record)) {
        return {
            id: HERO_AUTHORITY_UI_STATE.PUBLISHED_VERIFIED,
            label: HERO_AUTHORITY_UI_LABELS[HERO_AUTHORITY_UI_STATE.PUBLISHED_VERIFIED],
            canShowPublished: true
        };
    }

    // Local claims published without server grant → not "Published"
    const localStatus = normalizeHeroLifecycleStatus(
        /** @type {any} */ (record)?.heroPresentation?.status
    );
    if (localStatus === 'published') {
        return {
            id: HERO_AUTHORITY_UI_STATE.DRAFT_EDITING,
            label: 'Local draft (awaiting server grant)',
            canShowPublished: false
        };
    }

    return {
        id: HERO_AUTHORITY_UI_STATE.DRAFT_EDITING,
        label: HERO_AUTHORITY_UI_LABELS[HERO_AUTHORITY_UI_STATE.DRAFT_EDITING],
        canShowPublished: false
    };
}

/**
 * True when UI may display the word "Published" for this record.
 * @param {unknown} record
 */
export function canDisplayPublishedLabel(record) {
    return isServerGrantedPublished(record) === true;
}
