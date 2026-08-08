/**
 * AUTH-UI Phase 1: safe post-login return destinations.
 * Pure helpers — safe for Node validation scripts.
 */

export const AUTH_RETURN_PATH_KEY = 'reelforge_auth_return';

/** Paths that must never be return targets (loops or non-consumer surfaces). */
const BLOCKED_RETURN_PREFIXES = [
    '/login',
    '/register',
    '/auth',
    '/admin',
    '/studio',
    '/creator',
    '/upload',
    '/content-management'
];

/**
 * Normalize and whitelist a return path for post-auth navigation.
 * @param {unknown} raw
 * @returns {string | null} absolute path (+ optional query/hash) or null if invalid
 */
export function sanitizeReturnPath(raw) {
    if (raw == null) return null;
    let value = String(raw).trim();
    if (!value) return null;

    // Reject absolute URLs and protocol-relative URLs (open redirects).
    if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(value) || value.startsWith('//')) {
        return null;
    }

    if (!value.startsWith('/')) {
        value = `/${value}`;
    }

    // Strip pure fragment-only weirdness; keep pathname + search + hash from relative input.
    let pathPart = value;
    let search = '';
    let hash = '';
    const hashIdx = pathPart.indexOf('#');
    if (hashIdx >= 0) {
        hash = pathPart.slice(hashIdx);
        pathPart = pathPart.slice(0, hashIdx);
    }
    const qIdx = pathPart.indexOf('?');
    if (qIdx >= 0) {
        search = pathPart.slice(qIdx);
        pathPart = pathPart.slice(0, qIdx);
    }

    // Collapse accidental doubles but keep a leading slash.
    pathPart = pathPart.replace(/\/{2,}/g, '/') || '/';
    const lower = pathPart.toLowerCase();

    if (BLOCKED_RETURN_PREFIXES.some((p) => lower === p || lower.startsWith(`${p}/`))) {
        return null;
    }

    // Default home is valid but callers treat as "no special next".
    return `${pathPart}${search}${hash}`;
}

/**
 * @param {string} [search] location.search including leading ?
 * @returns {string | null}
 */
export function readNextFromSearch(search = '') {
    const raw = String(search || '');
    const qs = raw.startsWith('?') ? raw.slice(1) : raw;
    try {
        const params = new URLSearchParams(qs);
        return sanitizeReturnPath(params.get('next'));
    } catch {
        return null;
    }
}

/**
 * @param {string} basePath e.g. /login or /register
 * @param {unknown} returnPath
 * @returns {string}
 */
export function buildAuthPath(basePath, returnPath) {
    const base = String(basePath || '/login').split('?')[0] || '/login';
    const safe = sanitizeReturnPath(returnPath);
    if (!safe || safe === '/') return base;
    return `${base}?next=${encodeURIComponent(safe)}`;
}

/**
 * @param {unknown} returnPath current browse location (pathname + search)
 * @returns {string}
 */
export function buildLoginPath(returnPath) {
    return buildAuthPath('/login', returnPath);
}

/**
 * Persist intended destination across optional hard navigations.
 * @param {unknown} path
 */
export function setStoredReturnPath(path) {
    if (typeof globalThis === 'undefined' || !globalThis.window?.sessionStorage) return;
    const safe = sanitizeReturnPath(path);
    if (!safe || safe === '/') {
        try {
            globalThis.window.sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
        } catch {
            /* ignore */
        }
        return;
    }
    try {
        globalThis.window.sessionStorage.setItem(AUTH_RETURN_PATH_KEY, safe);
    } catch {
        /* ignore quota */
    }
}

/** @returns {string | null} */
export function peekStoredReturnPath() {
    if (typeof globalThis === 'undefined' || !globalThis.window?.sessionStorage) return null;
    try {
        return sanitizeReturnPath(globalThis.window.sessionStorage.getItem(AUTH_RETURN_PATH_KEY));
    } catch {
        return null;
    }
}

/** Read and clear stored return path. @returns {string | null} */
export function takeStoredReturnPath() {
    const value = peekStoredReturnPath();
    if (typeof globalThis !== 'undefined' && globalThis.window?.sessionStorage) {
        try {
            globalThis.window.sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
        } catch {
            /* ignore */
        }
    }
    return value;
}

/**
 * Resolve where to go after successful login/register.
 * Prefer ?next=; fall back to sessionStorage; else home.
 * @param {{ search?: string; defaultPath?: string }} [opts]
 * @returns {string}
 */
export function resolvePostAuthDestination(opts = {}) {
    const fromQuery = readNextFromSearch(opts.search || '');
    if (fromQuery && fromQuery !== '/') {
        takeStoredReturnPath(); // clear leftover storage
        return fromQuery;
    }
    const fromStore = takeStoredReturnPath();
    if (fromStore && fromStore !== '/') return fromStore;
    return opts.defaultPath || '/';
}

/**
 * Map API / network auth failures to consumer-safe messages.
 * @param {{ status?: number; code?: string; error?: string; message?: string }} result
 * @param {'login' | 'register'} mode
 * @returns {string}
 */
export function mapAuthErrorMessage(result, mode = 'login') {
    const code = String(result?.code || result?.error || '')
        .trim()
        .toLowerCase();
    const status = Number(result?.status) || 0;
    const raw = String(result?.message || result?.error || '').toLowerCase();

    if (
        code === 'network' ||
        raw.includes('failed to fetch') ||
        raw.includes('networkerror') ||
        raw.includes('load failed')
    ) {
        return 'You appear to be offline. Check your connection and try again.';
    }
    if (code === 'rate_limited' || status === 429) {
        return 'Too many attempts. Please wait a moment and try again.';
    }
    if (code === 'db_unavailable' || status === 503) {
        return 'Sign-in is temporarily unavailable. Please try again shortly.';
    }
    if (code === 'email_in_use' || status === 409) {
        return 'An account with this email already exists. Sign in instead.';
    }
    if (code === 'invalid_password' || code === 'invalid_email') {
        if (mode === 'register') {
            return code === 'invalid_password'
                ? 'Password must be at least 8 characters.'
                : 'Enter a valid email address.';
        }
        return 'Invalid email or password.';
    }
    if (code === 'invalid_credentials' || status === 401 || status === 403) {
        return 'Invalid email or password.';
    }
    if (status >= 500) {
        return 'Something went wrong on our side. Please try again.';
    }

    const fallback = String(result?.message || '').trim();
    if (fallback && !/admin|role|elevated|production|studio|creator/i.test(fallback)) {
        return fallback;
    }
    return mode === 'register' ? 'Could not create your account. Please try again.' : 'Could not sign in. Please try again.';
}
