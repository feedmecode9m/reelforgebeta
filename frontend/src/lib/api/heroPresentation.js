/**
 * Site-wide hero presentation API (server source of truth).
 * GET is public; PUT requires admin session.
 */
import { API_BASE_URL, fetchWithRetry } from '../api.js';
import { getAdminAuthHeaders } from '../adminSession.js';

/**
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function fetchHeroPresentation() {
    try {
        const res = await fetchWithRetry(
            `${API_BASE_URL}/api/hero/presentation?t=${Date.now()}`,
            { method: 'GET', headers: { Accept: 'application/json' } },
            { retries: 1, notifyReconnectOnFailure: false }
        );
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.warn('[HERO_PRESENTATION] GET failed', res.status, body?.error || '');
            return null;
        }
        return /** @type {Record<string, unknown>} */ (await res.json());
    } catch (err) {
        console.warn('[HERO_PRESENTATION] GET error', err?.message || err);
        return null;
    }
}

/**
 * Persist admin hero presentation to Postgres.
 * @param {Record<string, unknown>} body
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function putHeroPresentation(body) {
    try {
        const res = await fetchWithRetry(
            `${API_BASE_URL}/api/hero/presentation`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    ...getAdminAuthHeaders()
                },
                body: JSON.stringify(body)
            },
            { retries: 1, notifyReconnectOnFailure: false }
        );
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            console.warn(
                '[HERO_PRESENTATION] PUT failed',
                res.status,
                errBody?.error || errBody?.message || ''
            );
            return null;
        }
        return /** @type {Record<string, unknown>} */ (await res.json());
    } catch (err) {
        console.warn('[HERO_PRESENTATION] PUT error', err?.message || err);
        return null;
    }
}
