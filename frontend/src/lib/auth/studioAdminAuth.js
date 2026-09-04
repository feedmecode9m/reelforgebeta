/**
 * Studio password unlock — shared by /studio and in-app control center gate.
 * Never embed password hints in UI; local dev allowlist comes from env only.
 */
import { authenticateAdmin } from '../api.js';
import { setAdminSessionToken } from '../adminSession.js';

/** @returns {boolean} */
function isLocalDevHost() {
    if (typeof window === 'undefined') return false;
    const host = String(window.location.hostname || '').trim().toLowerCase();
    return !host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
}

/** @returns {string[]} */
export function readLocalDevAdminPasswordAllowlist() {
    /** @type {string[]} */
    const list = [];
    const primary = String(import.meta.env.VITE_ADMIN_PASSWORD || '').trim();
    if (primary) list.push(primary);
    const extras = String(import.meta.env.VITE_LOCAL_ADMIN_PASSWORDS || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    for (const part of extras) {
        if (!list.includes(part)) list.push(part);
    }
    return list;
}

/**
 * @param {string} password
 * @returns {Promise<{ ok: boolean; token?: string; mode?: 'remote' | 'local_dev'; error?: string }>}
 */
export async function unlockStudioWithPassword(password) {
    const pass = String(password || '').trim();
    if (!pass) {
        return { ok: false, error: 'Password is required.' };
    }

    try {
        const result = await authenticateAdmin(pass);
        if (result?.success) {
            const token = String(result.token || '').trim();
            if (!token || token === 'backend_token') {
                return {
                    ok: false,
                    error: 'Login succeeded but no session token was returned.'
                };
            }
            setAdminSessionToken(token);
            return { ok: true, token, mode: 'remote' };
        }
        return { ok: false, error: 'Authentication failed. Check the password and try again.' };
    } catch (err) {
        if (!isLocalDevHost()) {
            return {
                ok: false,
                error: 'Cannot reach studio authentication. Check connectivity and try again.'
            };
        }
        const allowlist = readLocalDevAdminPasswordAllowlist();
        if (allowlist.includes(pass)) {
            setAdminSessionToken('dev_local_session');
            return { ok: true, token: 'dev_local_session', mode: 'local_dev' };
        }
        return {
            ok: false,
            error: err?.message || 'Authentication failed.'
        };
    }
}
