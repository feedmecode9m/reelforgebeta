/**
 * Authority identity (Phase 8 — production runtime).
 *
 * Publication identity is bound to authenticated session context.
 * Callers must not elevate actor via display strings (master_hero_admin, approvedBy, etc.).
 *
 * Schema:
 * {
 *   actorId,
 *   role,
 *   permissions,
 *   authenticated,
 *   source
 * }
 *
 * @see ../hero/heroAuthorityBoundary.js
 * @see ../adminSession.js
 * @see ./authStore.js
 */

import { getAdminToken, getStudioAdminSessionToken, hasStudioAdminSessionToken } from '../adminSession.js';
import { isAdminRole, normalizeRole } from './roles.js';

/**
 * @typedef {Object} AuthorityIdentity
 * @property {string} actorId
 * @property {string} role
 * @property {string[]} permissions
 * @property {boolean} authenticated
 * @property {string} [source]  session | admin_session | local_development | none
 * @property {string} [email]
 */

/** Permissions for Hero editorial authority (server will re-check). */
export const HERO_AUTHORITY_PERMISSIONS = Object.freeze([
    'hero:draft',
    'hero:review',
    'hero:approve',
    'hero:publish',
    'hero:archive',
    'hero:diagnostics'
]);

/** Permission required for server-grant lifecycle actions. */
export const HERO_SERVER_GRANT_PERMISSIONS = Object.freeze([
    'hero:approve',
    'hero:publish',
    'hero:archive'
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * Detect development runtime (Vite DEV or non-production MODE).
 */
export function isAuthorityDevelopmentMode() {
    try {
        // eslint-disable-next-line no-undef
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            if (import.meta.env.DEV === true) return true;
            if (import.meta.env.PROD === true) return false;
            if (import.meta.env.MODE && import.meta.env.MODE !== 'production') return true;
        }
    } catch {
        /* ignore */
    }
    if (typeof process !== 'undefined' && process.env) {
        const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
        if (nodeEnv === 'production') return false;
        return true;
    }
    return false;
}

/**
 * Read auth session identity from runtime (browser stores / auth module).
 * Avoids hardcoding display strings.
 *
 * @returns {{
 *   actorId: string;
 *   role: string;
 *   email: string;
 *   token: string;
 *   source: string;
 * } | null}
 */
export function readRuntimeAuthSession() {
    if (typeof globalThis === 'undefined' || !globalThis.window) {
        return null;
    }

    // Lazy import pattern — pull current user when authStore is available.
    try {
        // Dynamic require via global event payload if set by App
        const bridge = /** @type {any} */ (globalThis).__REELFORGE_AUTH_IDENTITY__;
        if (bridge && typeof bridge === 'object' && text(bridge.actorId || bridge.id)) {
            const role = normalizeRole(bridge.role) || 'viewer';
            if (!isAdminRole(role) && !hasStudioAdminSessionToken()) {
                return null;
            }
            return {
                actorId: text(bridge.actorId || bridge.id),
                role: isAdminRole(role) ? 'admin' : role,
                email: text(bridge.email),
                token: text(bridge.token) || getAdminToken() || '',
                source: 'session'
            };
        }
    } catch {
        /* ignore */
    }

    // Studio password gateway (POST /admin/auth) — authentic session, no user uuid.
    if (hasStudioAdminSessionToken()) {
        const token = getStudioAdminSessionToken() || '';
        return {
            actorId: 'studio_admin_session',
            role: 'admin',
            email: '',
            token,
            source: 'admin_session'
        };
    }

    // AUTH-1 token present without hydrated user store → authenticated pending principal.
    const token = getAdminToken();
    if (token) {
        // Without known role, cannot assert admin authority — fail closed for grants.
        return null;
    }

    return null;
}

/**
 * Publish a runtime identity snapshot that resolveAuthorityIdentity can read.
 * Call from App after auth restore / login.
 *
 * @param {{
 *   id?: string | null;
 *   email?: string | null;
 *   role?: string | null;
 *   token?: string | null;
 * } | null} user
 */
export function publishAuthorityIdentityBridge(user, token = null) {
    if (typeof globalThis === 'undefined') return;
    if (!user || !text(user.id || user.email)) {
        try {
            delete /** @type {any} */ (globalThis).__REELFORGE_AUTH_IDENTITY__;
        } catch {
            /* ignore */
        }
        return;
    }
    /** @type {any} */ (globalThis).__REELFORGE_AUTH_IDENTITY__ = {
        actorId: text(user.id),
        email: text(user.email),
        role: text(user.role) || 'viewer',
        token: text(token)
    };
}

/**
 * Resolve the current authority actor.
 *
 * Priority:
 * 1. Explicit session option (tests / injected)
 * 2. Runtime auth / studio session
 * 3. Dev identity only when allowed and no token present
 * 4. Unauthenticated fail-closed
 *
 * @param {{
 *   session?: { actorId?: string; role?: string; permissions?: string[]; token?: string; email?: string };
 *   allowDevIdentity?: boolean;
 *   devActorId?: string;
 *   requireToken?: boolean;
 * }} [options]
 * @returns {AuthorityIdentity}
 */
export function resolveAuthorityIdentity(options = {}) {
    // 1) Explicit injected session (validators; never elevates above provided role)
    const session = options.session && typeof options.session === 'object' ? options.session : null;
    if (session && text(session.actorId)) {
        const role = text(session.role) || 'admin';
        const permissions = Array.isArray(session.permissions)
            ? session.permissions.map((p) => text(p)).filter(Boolean)
            : isAdminRole(role)
              ? [...HERO_AUTHORITY_PERMISSIONS]
              : [];
        return {
            actorId: text(session.actorId),
            role: normalizeRole(role) || role,
            permissions,
            authenticated: true,
            source: 'session',
            email: text(session.email)
        };
    }

    // 2) Runtime authenticated context
    const runtime = readRuntimeAuthSession();
    if (runtime && text(runtime.actorId) && isAdminRole(runtime.role)) {
        return {
            actorId: runtime.actorId,
            role: 'admin',
            permissions: [...HERO_AUTHORITY_PERMISSIONS],
            authenticated: true,
            source: runtime.source || 'session',
            email: runtime.email
        };
    }

    // Token without admin principal → waiting authentication
    if (getAdminToken() && !runtime) {
        return {
            actorId: '',
            role: 'unknown',
            permissions: [],
            authenticated: false,
            source: 'none'
        };
    }

    // 3) Local development only when no production session context
    const allowDev =
        options.allowDevIdentity === true ||
        (options.allowDevIdentity !== false && isAuthorityDevelopmentMode() && !getAdminToken());

    if (allowDev) {
        return {
            actorId: text(options.devActorId) || 'dev_master_hero_admin',
            role: 'admin',
            permissions: [...HERO_AUTHORITY_PERMISSIONS],
            authenticated: true,
            source: 'local_development'
        };
    }

    return {
        actorId: '',
        role: 'unknown',
        permissions: [],
        authenticated: false,
        source: 'none'
    };
}

/**
 * Whether identity may perform a permission.
 * @param {AuthorityIdentity | null | undefined} identity
 * @param {string} permission
 */
export function identityHasPermission(identity, permission) {
    if (!identity || identity.authenticated !== true) return false;
    const perm = text(permission);
    if (!perm) return false;
    return Array.isArray(identity.permissions) && identity.permissions.includes(perm);
}

/**
 * True when identity may request server grant (approve/publish/archive).
 * @param {AuthorityIdentity | null | undefined} identity
 */
export function identityCanRequestServerGrant(identity) {
    if (!identity || !identity.authenticated) return false;
    return HERO_SERVER_GRANT_PERMISSIONS.some((p) => identityHasPermission(identity, p));
}

/**
 * Reject client-supplied elevated actors (self-escalation).
 * @param {AuthorityIdentity} identity
 * @param {{ actor?: string; approvedBy?: string; actorId?: string; actorRole?: string }} [claimed]
 * @returns {{ ok: boolean; errors: string[] }}
 */
export function assertNoClientActorEscalation(identity, claimed = {}) {
    /** @type {string[]} */
    const errors = [];
    if (!identity?.authenticated || !text(identity.actorId)) {
        errors.push('missing_identity');
        return { ok: false, errors };
    }

    const claimedActors = [claimed.actor, claimed.approvedBy, claimed.actorId]
        .map((v) => text(v))
        .filter(Boolean);

    for (const c of claimedActors) {
        if (c !== identity.actorId) {
            // Reject display-string / alternate elevation attempts
            errors.push('client_supplied_elevated_actor');
        }
    }

    const claimedRole = text(claimed.actorRole).toLowerCase();
    if (claimedRole && claimedRole !== 'admin' && claimedRole !== text(identity.role).toLowerCase()) {
        // Client trying to set a stronger role than session
        if (claimedRole === 'admin' && !isAdminRole(identity.role)) {
            errors.push('invalid_role');
            errors.push('client_supplied_elevated_actor');
        }
    }

    if (!isAdminRole(identity.role) && !identityHasPermission(identity, 'hero:publish')) {
        errors.push('invalid_role');
    }

    return { ok: errors.length === 0, errors: Array.from(new Set(errors)) };
}

/**
 * Map identity role → audit actorType.
 * @param {AuthorityIdentity | null | undefined} identity
 * @returns {'admin' | 'creator' | 'system' | 'intelligence' | 'unknown'}
 */
export function identityToActorType(identity) {
    const role = text(identity?.role).toLowerCase();
    if (role === 'admin' || role === 'master_hero_admin') return 'admin';
    if (role === 'creator' || role === 'studio') return 'creator';
    if (role === 'intelligence') return 'intelligence';
    if (role === 'system') return 'system';
    return 'unknown';
}
