/** AUTH-1 auth API client. */

import { API_BASE_URL } from '../config.js';

/**
 * @param {string} path
 * @param {{ method?: string; body?: unknown; token?: string | null }} [options]
 */
async function authFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
    }
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body != null ? JSON.stringify(options.body) : undefined,
        credentials: 'include'
    });
    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }
    return { response, data };
}

/**
 * @param {{ email: string; password: string }} payload
 */
export async function apiRegister(payload) {
    return authFetch('/api/auth/register', {
        method: 'POST',
        body: {
            email: String(payload.email || '').trim(),
            password: String(payload.password || '')
        }
    });
}

/**
 * @param {{ email: string; password: string }} payload
 */
export async function apiLogin(payload) {
    return authFetch('/api/auth/login', {
        method: 'POST',
        body: {
            email: String(payload.email || '').trim(),
            password: String(payload.password || '')
        }
    });
}

/** @param {string | null | undefined} token */
export async function apiLogout(token) {
    return authFetch('/api/auth/logout', {
        method: 'POST',
        token: token || null
    });
}

/** @param {string | null | undefined} token */
export async function apiMe(token) {
    return authFetch('/api/auth/me', {
        method: 'GET',
        token: token || null
    });
}
