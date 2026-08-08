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
import {
    getAdminAuthHeaders,
    maybeHandleInvalidAdminSession
} from '../adminSession.js';

/** Canonical path under API_BASE_URL (may be '' for same-origin / Netlify proxy). */
export const HERO_PRESENTATION_PATH = '/api/hero/presentation';

/**
 * Absolute URL used for network diagnostics (same-origin → current origin + path).
 * @returns {string}
 */
export function resolveHeroPresentationRequestUrl() {
    const path = HERO_PRESENTATION_PATH;
    if (API_BASE_URL) return `${API_BASE_URL}${path}`;
    if (typeof window !== 'undefined' && window.location?.origin) {
        return `${window.location.origin}${path}`;
    }
    return path;
}

/**
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function fetchHeroPresentation() {
    try {
        const url = `${API_BASE_URL}${HERO_PRESENTATION_PATH}?t=${Date.now()}`;
        const res = await fetchWithRetry(
            url,
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
 * @typedef {{
 *   ok: boolean;
 *   status: number;
 *   data: Record<string, unknown> | null;
 *   error: string | null;
 *   url: string;
 *   hasAuthorization: boolean;
 * }} PutHeroPresentationResult
 */

/**
 * Persist admin hero presentation to Postgres.
 * Always returns a structured result (never throws on HTTP errors).
 * @param {Record<string, unknown>} body
 * @returns {Promise<PutHeroPresentationResult>}
 */
export async function putHeroPresentation(body) {
    const url = resolveHeroPresentationRequestUrl();
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...getAdminAuthHeaders()
    };
    const hasAuthorization = Boolean(headers.Authorization);

    try {
        const res = await fetchWithRetry(
            `${API_BASE_URL}${HERO_PRESENTATION_PATH}`,
            {
                method: 'PUT',
                headers,
                body: JSON.stringify(body)
            },
            { retries: 1, notifyReconnectOnFailure: false }
        );

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const error = String(errBody?.error || errBody?.message || res.statusText || 'put_failed');
            maybeHandleInvalidAdminSession(res, errBody, 'putHeroPresentation');
            console.warn('[HERO_PRESENTATION] PUT failed', {
                status: res.status,
                error,
                url,
                hasAuthorization,
                heroAssetId: body?.heroAssetId || null,
                backgroundSource: body?.backgroundSource || null,
                mediaUrl: body?.mediaUrl ? String(body.mediaUrl).slice(0, 96) : null,
                heroTitle: body?.heroTitle || null
            });
            return {
                ok: false,
                status: res.status,
                data: null,
                error,
                url,
                hasAuthorization
            };
        }

        const json = /** @type {Record<string, unknown>} */ (await res.json());
        console.info('[HERO_PRESENTATION] PUT response', {
            status: res.status,
            url,
            heroAssetId: json.heroAssetId || null,
            mediaUrl: json.mediaUrl ? String(json.mediaUrl).slice(0, 96) : null,
            heroTitle: json.heroTitle || null,
            heroDescription: json.heroDescription
                ? String(json.heroDescription).slice(0, 80)
                : null,
            updatedAt: json.updatedAt || null
        });
        return {
            ok: true,
            status: res.status,
            data: json,
            error: null,
            url,
            hasAuthorization
        };
    } catch (err) {
        const error = String(err?.message || err || 'network_error');
        console.warn('[HERO_PRESENTATION] PUT error', { error, url, hasAuthorization });
        return {
            ok: false,
            status: 0,
            data: null,
            error,
            url,
            hasAuthorization
        };
    }
}
