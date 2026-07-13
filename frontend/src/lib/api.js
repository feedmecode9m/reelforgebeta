import { API_BASE_URL, BACKEND_URL, toBackendMediaUrl, toRelativeMediaPath, logResolvedMediaUrl } from './config.js';
import { writable } from 'svelte/store';
import { pipelineDiag, pipelineDiagCors } from './diagnostics/pipelineDiag.js';

export { API_BASE_URL, BACKEND_URL, toBackendMediaUrl, toRelativeMediaPath, logResolvedMediaUrl };

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 400;
const API_CACHE_PREFIX = 'reelforge_api_cache_v1:';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const API_DEBUG = import.meta.env.VITE_DEBUG_API === 'true';

/**
 * @typedef {'online' | 'degraded' | 'offline'} BackendConnectionState
 */

export const backendConnectionStatus = writable({
    state: /** @type {BackendConnectionState} */ ('degraded'),
    lastOkAt: 0,
    lastAttemptAt: 0,
    lastError: ''
});

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function setBackendConnectionStatus(
    state,
    detail = {}
) {
    backendConnectionStatus.update((current) => {
        const next = {
            ...current,
            state,
            lastAttemptAt: Date.now(),
            ...detail
        };
        if (typeof window !== 'undefined') {
            window.dispatchEvent(
                new CustomEvent('reelforge:backend-connection', {
                    detail: next
                })
            );
        }
        return next;
    });
}

function logApiDebug(...args) {
    if (!API_DEBUG) return;
    console.info('[API_DEBUG]', ...args);
}

function cacheKey(url) {
    return `${API_CACHE_PREFIX}${url}`;
}

function readApiCache(url, ttlMs = DEFAULT_CACHE_TTL_MS) {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(cacheKey(url));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.savedAt || !parsed?.body) return null;
        if (Date.now() - Number(parsed.savedAt) > ttlMs) return null;
        return parsed.body;
    } catch {
        return null;
    }
}

function writeApiCache(url, body) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(
            cacheKey(url),
            JSON.stringify({
                savedAt: Date.now(),
                body
            })
        );
    } catch {
        // ignore quota/cache failures
    }
}

export function notifyBackendReconnecting(message = 'Backend reconnecting...') {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('reelforge:backend-reconnecting', { detail: { message } })
        );
    }
}

export async function checkBackendHealth() {
    const paths = ['/api/health', '/health', '/'];
    const bases = [];

    if (import.meta.env.DEV) {
        bases.push('');
    }
    if (API_BASE_URL && !bases.includes(API_BASE_URL)) {
        bases.push(API_BASE_URL);
    }
    if (BACKEND_URL && !bases.includes(BACKEND_URL)) {
        bases.push(BACKEND_URL);
    }
    if (bases.length === 0) {
        bases.push('');
    }

    for (const base of bases) {
        for (const path of paths) {
            try {
                logApiDebug('healthcheck:request', `${base}${path}`);
                const response = await fetch(`${base}${path}`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(5000)
                });

                if (response.ok) {
                    setBackendConnectionStatus('online', {
                        lastOkAt: Date.now(),
                        lastError: ''
                    });
                    pipelineDiag('API', 'checkBackendHealth', 'api.js', {
                        result: 'healthy',
                        detail: `${base}${path}`
                    });
                    logApiDebug('healthcheck:ok', `${base}${path}`, response.status);
                    return true;
                }
            } catch (error) {
                pipelineDiagCors('checkBackendHealth', 'api.js', error, { url: `${base}${path}` });
                setBackendConnectionStatus('degraded', {
                    lastError: error?.message || 'healthcheck failed'
                });
                console.warn(`Backend health check failed for ${base}${path}:`, error);
            }
        }
    }

    pipelineDiag('API', 'checkBackendHealth', 'api.js', { result: 'unhealthy' });
    return false;
}

export async function fetchWithRetry(
    url,
    options = {},
    {
        retries = DEFAULT_RETRY_ATTEMPTS,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
        retryOn = null
    } = {}
) {
    let lastError;
    let lastResponse = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            logApiDebug('request', { url, attempt, options });
            pipelineDiag('FETCH', 'fetchWithRetry', 'api.js', {
                result: `attempt_${attempt}`,
                detail: { url, method: options?.method || 'GET' }
            });
            const response = await fetch(url, options);
            lastResponse = response;
            logApiDebug('response', { url, status: response.status, ok: response.ok, attempt });
            pipelineDiag('RESPONSE', 'fetchWithRetry', 'api.js', {
                result: `http_${response.status}`,
                detail: { url, ok: response.ok, attempt }
            });

            if (response.ok) {
                setBackendConnectionStatus('online', {
                    lastOkAt: Date.now(),
                    lastError: ''
                });
                return response;
            }

            const shouldRetryStatus = retryOn
                ? retryOn(response)
                : response.status >= 500 || response.status === 429;

            if (!shouldRetryStatus || attempt === retries) {
                setBackendConnectionStatus('degraded', {
                    lastError: `HTTP ${response.status}`
                });
                return response;
            }

            lastError = new Error(`Request failed with status ${response.status}`);
        } catch (error) {
            lastError = error;
            pipelineDiagCors('fetchWithRetry', 'api.js', error, { url });
            notifyBackendReconnecting();
            setBackendConnectionStatus('offline', {
                lastError: error?.message || 'network failure'
            });
            logApiDebug('error', { url, attempt, message: error?.message || String(error) });

            if (attempt === retries) {
                throw error;
            }
        }

        const backoffMs = Math.min(retryDelayMs * 2 ** attempt, 8000);
        await delay(backoffMs);
    }

    if (lastResponse) return lastResponse;
    throw lastError || new Error('Request failed after retries');
}

export async function authenticateAdmin(password) {
    try {
        const response = await fetch(`${API_BASE_URL}/admin/auth`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });

        if (!response.ok) {
            throw new Error(`Authentication failed: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('authenticateAdmin error:', error);
        throw error;
    }
}

export function getAdminAuthorizationHeader(token) {
    if (!token) {
        return {};
    }

    return {
        Authorization: `Bearer ${token}`
    };
}

export async function apiRequest(
    endpoint,
    options = {}
) {
    const method = String(options.method || 'GET').toUpperCase();
    const url = `${API_BASE_URL}${endpoint}`;
    const cacheTtlMs = Number(options.cacheTtlMs) > 0 ? Number(options.cacheTtlMs) : DEFAULT_CACHE_TTL_MS;
    const { cacheTtlMs: _cacheTtlMs, ...fetchOptions } = options;
    const requestOptions = {
        headers: {
            'Content-Type': 'application/json',
            ...(fetchOptions.headers || {})
        },
        ...fetchOptions
    };

    let response;
    try {
        response = await fetchWithRetry(url, requestOptions, { retries: 2, retryDelayMs: 300 });
    } catch (error) {
        if (method === 'GET') {
            const cached = readApiCache(url, cacheTtlMs);
            if (cached != null) {
                logApiDebug('cache:fallback', { url });
                return cached;
            }
        }
        throw error;
    }

    if (!response.ok) {
        if (method === 'GET') {
            const cached = readApiCache(url, cacheTtlMs);
            if (cached != null) {
                logApiDebug('cache:fallback:status', { url, status: response.status });
                return cached;
            }
        }
        throw new Error(
            `API request failed: ${response.status}`
        );
    }

    const contentType =
        response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        const body = await response.json();
        if (method === 'GET') {
            writeApiCache(url, body);
        }
        return body;
    }

    const body = await response.text();
    if (method === 'GET') {
        writeApiCache(url, body);
    }
    return body;
}
