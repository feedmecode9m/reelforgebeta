/** Canonical admin session token provider (no config imports — safe for Node tests). */

/** Canonical admin session key — single source of truth for token storage. */
export const ADMIN_SESSION_TOKEN_KEY = 'reelforge_admin_session_token';

let adminSessionExpiredHandled = false;

function hasBrowserStorage() {
    return typeof globalThis !== 'undefined' && globalThis.window?.localStorage;
}

/** @returns {string | null} */
export function getAdminToken() {
    if (!hasBrowserStorage()) return null;
    const token = globalThis.window.localStorage.getItem(ADMIN_SESSION_TOKEN_KEY);
    const trimmed = token ? String(token).trim() : '';
    return trimmed || null;
}

/** @param {string} token */
export function setAdminSessionToken(token) {
    if (!hasBrowserStorage() || !token) return;
    adminSessionExpiredHandled = false;
    globalThis.window.localStorage.setItem(ADMIN_SESSION_TOKEN_KEY, String(token));
    globalThis.window.dispatchEvent(
        new CustomEvent('reelforge:admin-session-changed', { detail: { present: true } })
    );
}

/**
 * Clear admin session token and notify listeners.
 * @param {{ emitExpired?: boolean; source?: string }} [options]
 */
export function clearAdminSession(options = {}) {
    if (hasBrowserStorage()) {
        globalThis.window.localStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
        globalThis.window.dispatchEvent(
            new CustomEvent('reelforge:admin-session-changed', { detail: { present: false } })
        );
        if (options.emitExpired) {
            globalThis.window.dispatchEvent(
                new CustomEvent('AUTH_SESSION_EXPIRED', {
                    detail: { source: options.source || 'clearAdminSession' }
                })
            );
        }
    }
}

/**
 * Handle stale/invalid backend session exactly once per expiry event.
 * @param {string} [source]
 */
export function handleAdminSessionExpired(source = 'unknown') {
    if (adminSessionExpiredHandled) return;
    adminSessionExpiredHandled = true;
    clearAdminSession({ emitExpired: true, source });
}

/** Reset expiry guard after a fresh login (called from setAdminSessionToken). */
export function resetAdminSessionExpiredGuard() {
    adminSessionExpiredHandled = false;
}

/**
 * @param {Response} response
 * @param {{ error?: string }} [errBody]
 * @param {string} [source]
 * @returns {boolean} true when invalid_session was handled
 */
export function maybeHandleInvalidAdminSession(response, errBody = {}, source = 'api') {
    if (response?.status === 401 && errBody?.error === 'invalid_session') {
        if (adminSessionExpiredHandled) return false;
        handleAdminSessionExpired(source);
        return true;
    }
    return false;
}

/** @param {unknown} errorOrMessage */
export function isInvalidSessionError(errorOrMessage) {
    const message = String(
        typeof errorOrMessage === 'string'
            ? errorOrMessage
            : errorOrMessage?.message || errorOrMessage?.error || errorOrMessage || ''
    );
    return message === 'invalid_session' || /invalid_session/i.test(message);
}

export function getAdminAuthorizationHeader(token) {
    if (!token) {
        return {};
    }

    return {
        Authorization: `Bearer ${token}`
    };
}

/** Canonical Authorization headers for mutating admin API calls. */
export function getAdminAuthHeaders() {
    return getAdminAuthorizationHeader(getAdminToken());
}
