/** AUTH-1.1 role helpers (pure — safe for Node validation).
 *
 * Business model: only administrators control platform content.
 * `creator` may exist in the API for legacy records but has viewer-level access.
 */

/** @typedef {'viewer' | 'creator' | 'admin'} AuthRole */

/** @type {readonly AuthRole[]} */
export const AUTH_ROLES = Object.freeze(['viewer', 'creator', 'admin']);

/**
 * Content rank. AUTH-1.1: only admin has mutation / studio powers.
 * @type {Record<AuthRole, number>}
 */
const ROLE_RANK = Object.freeze({
    viewer: 0,
    creator: 0,
    admin: 2
});

/**
 * @param {unknown} value
 * @returns {AuthRole | null}
 */
export function normalizeRole(value) {
    const raw = String(value || '')
        .trim()
        .toLowerCase();
    if (raw === 'viewer' || raw === 'creator' || raw === 'admin') return raw;
    return null;
}

/**
 * @param {unknown} role
 * @param {AuthRole} required
 */
export function roleMeets(role, required) {
    const r = normalizeRole(role);
    const need = normalizeRole(required);
    if (!r || !need) return false;
    return ROLE_RANK[r] >= ROLE_RANK[need];
}

/**
 * @param {unknown} role
 * @param {AuthRole | AuthRole[]} roles
 */
export function hasRole(role, roles) {
    const list = Array.isArray(roles) ? roles : [roles];
    return list.some((required) => roleMeets(role, required));
}

export function isAdminRole(role) {
    return roleMeets(role, 'admin');
}

/** @deprecated Legacy — creator has no content powers (AUTH-1.1). */
export function isCreatorRole(_role) {
    return false;
}

/**
 * Route access policy (AUTH-1.1 / AUTH-UI-2).
 * @param {string} pathname
 * @returns {{ access: 'public' | 'auth' | 'admin' | 'blocked'; redirectTo: string }}
 */
export function classifyPath(pathname) {
    const path = String(pathname || '/').split('?')[0] || '/';
    if (path === '/' || path === '') {
        return { access: 'public', redirectTo: '/' };
    }
    if (/^\/(watch|explore)(\/|$)/i.test(path)) {
        return { access: 'public', redirectTo: path };
    }
    if (/^\/series(\/|$)/i.test(path)) {
        return { access: 'public', redirectTo: path };
    }
    if (/^\/(login|register|auth)(\/|$)/i.test(path)) {
        return { access: 'public', redirectTo: path };
    }
    // Reserved / production paths — never a public product surface.
    if (/^\/(creator|upload|content-management)(\/|$)/i.test(path)) {
        return { access: 'blocked', redirectTo: '/' };
    }
    if (/^\/(account|settings)(\/|$)/i.test(path)) {
        return { access: 'auth', redirectTo: '/login' };
    }
    if (/^\/(admin|studio)(\/|$)/i.test(path)) {
        return { access: 'admin', redirectTo: '/' };
    }
    return { access: 'public', redirectTo: '/' };
}

/**
 * @param {{
 *   pathname: string;
 *   isAuthenticated: boolean;
 *   role?: string | null;
 * }} input
 * @returns {{
 *   allowed: boolean;
 *   reason: string;
 *   redirectTo: string | null;
 *   unavailable?: boolean;
 * }}
 */
export function evaluateRouteAccess(input) {
    const path = String(input.pathname || '/').split('?')[0] || '/';
    // Consumer-safe: never advertise reserved production URLs.
    if (/^\/(creator|upload|content-management)(\/|$)/i.test(path)) {
        return {
            allowed: false,
            reason: 'area_unavailable',
            redirectTo: null,
            unavailable: true
        };
    }

    const { access, redirectTo } = classifyPath(input.pathname);
    if (access === 'public') {
        return { allowed: true, reason: 'public', redirectTo: null };
    }
    if (access === 'blocked') {
        return {
            allowed: false,
            reason: 'area_unavailable',
            redirectTo: null,
            unavailable: true
        };
    }
    if (!input.isAuthenticated) {
        // Studio/admin paths: quietly home (no login funnel advertising Studio).
        if (access === 'admin') {
            return {
                allowed: false,
                reason: 'area_unavailable',
                redirectTo: null,
                unavailable: true
            };
        }
        return { allowed: false, reason: 'unauthenticated', redirectTo };
    }
    if (access === 'auth') {
        return { allowed: true, reason: 'authenticated', redirectTo: null };
    }
    if (access === 'admin') {
        if (isAdminRole(input.role)) {
            return { allowed: true, reason: 'studio_ok', redirectTo: null };
        }
        return {
            allowed: false,
            reason: 'area_unavailable',
            redirectTo: null,
            unavailable: true
        };
    }
    return { allowed: true, reason: 'default', redirectTo: null };
}
