/**
 * AUTH-1 centralized auth store / service.
 * Session token persisted for restore on refresh.
 */

import { derived, get, writable } from 'svelte/store';
import { apiLogin, apiLogout, apiMe, apiRegister } from './authApi.js';
import {
    hasRole as hasRoleHelper,
    isAdminRole,
    normalizeRole
} from './roles.js';
import {
    clearAdminSession,
    getAdminToken,
    hasStudioAdminSessionToken,
    setAdminSessionToken
} from '../adminSession.js';

export const AUTH_TOKEN_KEY = 'reelforge_auth_token';

/** @typedef {{ id: string | null; email: string | null; role: string | null }} AuthUser */

function hasBrowserStorage() {
    return typeof globalThis !== 'undefined' && globalThis.window?.localStorage;
}

function readPersistedToken() {
    if (!hasBrowserStorage()) return null;
    const raw = globalThis.window.localStorage.getItem(AUTH_TOKEN_KEY);
    const trimmed = raw ? String(raw).trim() : '';
    return trimmed || null;
}

function writePersistedToken(token) {
    if (!hasBrowserStorage()) return;
    if (token) {
        globalThis.window.localStorage.setItem(AUTH_TOKEN_KEY, String(token));
    } else {
        globalThis.window.localStorage.removeItem(AUTH_TOKEN_KEY);
    }
}

/** @type {import('svelte/store').Writable<AuthUser | null>} */
export const currentUser = writable(null);

/** @type {import('svelte/store').Writable<string | null>} */
export const authToken = writable(readPersistedToken());

/** @type {import('svelte/store').Writable<'idle' | 'loading' | 'ready' | 'error'>} */
export const authStatus = writable('idle');

/** @type {import('svelte/store').Writable<string | null>} */
export const authError = writable(null);

export const isAuthenticated = derived(
    currentUser,
    ($user) => Boolean($user && ($user.id || $user.role === 'admin'))
);

export const userRole = derived(currentUser, ($user) => normalizeRole($user?.role) || null);

/**
 * Reactive studio gate — subscribe via `$studioAccessAllowed` in components.
 * Imperative `canAccessStudio()` remains for non-Svelte callers.
 * Password-only studio session is storage-backed (see hasStudioAdminSessionToken).
 */
export const studioAccessAllowed = derived(currentUser, ($user) =>
    isAdminRole($user?.role) || hasStudioAdminSessionToken()
);

/**
 * AuthRole typedef placement fix for auth store exports.
 * @param {import('./roles.js').AuthRole} role
 */
export function hasRole(role) {
    const user = get(currentUser);
    return hasRoleHelper(user?.role, role);
}

/**
 * Studio open / control center: admin RBAC role OR verified password session (POST /admin/auth).
 * Not sticky admin_mode authority.
 */
export function canAccessStudio() {
    return isAdminRole(get(currentUser)?.role) || hasStudioAdminSessionToken();
}

/** @deprecated AUTH-1.1: no public creator content workflows. */
export function canAccessCreatorTools() {
    return false;
}

/**
 * Sync production tool admin token when role is admin
 * so existing getAdminAuthHeaders keep working.
 * Non-admin consumer login clears the studio password bridge.
 * Guest (no consumer token) preserves standalone POST /admin/auth session.
 * @param {string | null} token
 * @param {string | null | undefined} role
 */
function mirrorAdminBridge(token, role) {
    if (token && isAdminRole(role)) {
        setAdminSessionToken(token);
        return;
    }
    if (token && !isAdminRole(role)) {
        clearAdminSession({ source: 'auth_role_sync' });
        return;
    }
    // No consumer session: leave password-only studio token intact.
}

/**
 * @param {{ token?: string | null; user?: AuthUser | null }} session
 */
function applySession(session) {
    const token = session.token ? String(session.token).trim() : null;
    const user = session.user || null;
    // Truthful identity: never persist a token without a verified user.
    const nextToken = user && token ? token : null;
    const nextUser = nextToken ? user : null;
    authToken.set(nextToken);
    writePersistedToken(nextToken);
    currentUser.set(nextUser);
    authError.set(null);
    mirrorAdminBridge(nextToken, nextUser?.role);
    authStatus.set(nextUser ? 'ready' : 'idle');

    // Hero authority runtime bridge (Phase 8)
    try {
        import('./authorityIdentity.js').then((mod) => {
            if (nextUser && nextToken) {
                mod.publishAuthorityIdentityBridge(nextUser, nextToken);
            } else {
                mod.publishAuthorityIdentityBridge(null);
            }
        });
    } catch {
        /* ignore */
    }
}

export function getAuthToken() {
    return get(authToken) || readPersistedToken();
}

/** Authorization headers for any authenticated request. */
export function getAuthHeaders() {
    const token = getAuthToken() || getAdminToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}

/**
 * @param {{ email: string; password: string }} payload
 */
export async function register(payload) {
    authStatus.set('loading');
    authError.set(null);
    try {
        const { response, data } = await apiRegister(payload);
        if (!response.ok || !data?.token) {
            const code = data?.error != null ? String(data.error) : '';
            const message = data?.message || data?.error || `Register failed (${response.status})`;
            authError.set(message);
            authStatus.set('error');
            return { ok: false, error: message, status: response.status, code };
        }
        applySession({
            token: data.token,
            user: {
                id: data.user?.id != null ? String(data.user.id) : null,
                email: data.user?.email != null ? String(data.user.email) : null,
                role: normalizeRole(data.user?.role) || 'viewer'
            }
        });
        return { ok: true, user: get(currentUser) };
    } catch (err) {
        const message = err?.message || 'Register failed';
        authError.set(message);
        authStatus.set('error');
        return { ok: false, error: message, code: 'network' };
    }
}

/**
 * @param {{ email: string; password: string }} payload
 */
export async function login(payload) {
    authStatus.set('loading');
    authError.set(null);
    try {
        const { response, data } = await apiLogin(payload);
        if (!response.ok || !data?.token) {
            const code = data?.error != null ? String(data.error) : '';
            const message = data?.message || data?.error || `Login failed (${response.status})`;
            authError.set(message);
            authStatus.set('error');
            return { ok: false, error: message, status: response.status, code };
        }
        applySession({
            token: data.token,
            user: {
                id: data.user?.id != null ? String(data.user.id) : null,
                email: data.user?.email != null ? String(data.user.email) : null,
                role: normalizeRole(data.user?.role) || 'viewer'
            }
        });
        return { ok: true, user: get(currentUser) };
    } catch (err) {
        const message = err?.message || 'Login failed';
        authError.set(message);
        authStatus.set('error');
        return { ok: false, error: message, code: 'network' };
    }
}

export async function logout() {
    const token = getAuthToken();
    try {
        await apiLogout(token);
    } catch {
        /* ignore network errors on logout */
    }
    applySession({ token: null, user: null });
    clearAdminSession({ source: 'auth_logout' });
    authStatus.set('idle');
}

/** Restore session from persisted token (browser refresh). */
export async function refreshSession() {
    const token = getAuthToken();
    if (!token) {
        applySession({ token: null, user: null });
        authStatus.set('ready');
        return { ok: false, reason: 'no_token' };
    }
    authStatus.set('loading');
    try {
        const { response, data } = await apiMe(token);
        if (!response.ok || !data?.user) {
            // Unauthorized or otherwise unusable session — clear token + admin bridge.
            applySession({ token: null, user: null });
            clearAdminSession({
                emitExpired: response.status === 401 || response.status === 403,
                source: 'auth_me'
            });
            authStatus.set('ready');
            return { ok: false, reason: 'invalid_session' };
        }
        applySession({
            token,
            user: {
                id: data.user.id != null ? String(data.user.id) : null,
                email: data.user.email != null ? String(data.user.email) : null,
                role: normalizeRole(data.user.role) || 'viewer'
            }
        });
        return { ok: true, user: get(currentUser) };
    } catch (err) {
        // Phase 0: never keep a token while UI is guest — clear so identity is truthful.
        applySession({ token: null, user: null });
        clearAdminSession({ source: 'auth_me_network' });
        authStatus.set('ready');
        authError.set(err?.message || 'Session restore failed');
        return { ok: false, reason: 'network' };
    }
}

export function isAuthenticatedSync() {
    const user = get(currentUser);
    return Boolean(user && (user.id || user.role === 'admin'));
}

export { isAdminRole, hasRoleHelper as roleIncludes };
