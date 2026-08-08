/**
 * Site-wide hero presentation API (server source of truth).
 *
 * Canonical endpoint (backend: web::scope("/api") + resource "/hero/presentation"):
 *   GET  /api/hero/presentation   — public
 *   PUT  /api/hero/presentation   — admin session required
 *
 * Not the same as /api/platform/hero (feature-flagged platform mode/rotation only).
 */
import { API_BASE_URL, fetchWithRetry } from '../api.js';
import { getAdminAuthHeaders } from '../adminSession.js';

/** Canonical path under API_BASE_URL (may be '' for same-origin / Netlify proxy). */
export const HERO_PRESENTATION_PATH = '/api/hero/presentation';

/**
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function fetchHeroPresentation() {
    try {
        const res = await fetchWithRetry(
            `${API_BASE_URL}${HERO_PRESENTATION_PATH}?t=${Date.now()}`,
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
            `${API_BASE_URL}${HERO_PRESENTATION_PATH}`,
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
