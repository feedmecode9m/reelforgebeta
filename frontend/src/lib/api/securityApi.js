import { API_BASE_URL, fetchWithRetry } from '../api.js';

const SECURITY_THROTTLE_MS = 500;
const SECURITY_MAX_FAILURES = 3;
const SECURITY_CIRCUIT_OPEN_MS = 30_000;
let lastSecurityCallAt = 0;
let securityFailureCount = 0;
let securityCircuitOpenUntil = 0;

function shouldThrottleSecurity() {
    const now = Date.now();
    if (now - lastSecurityCallAt < SECURITY_THROTTLE_MS) return true;
    lastSecurityCallAt = now;
    return false;
}

function isSecurityCircuitOpen() {
    const now = Date.now();
    if (securityCircuitOpenUntil > now) return true;
    if (securityFailureCount >= SECURITY_MAX_FAILURES) {
        securityCircuitOpenUntil = now + SECURITY_CIRCUIT_OPEN_MS;
        console.warn('Security API circuit breaker opened for 30 seconds');
        return true;
    }
    return false;
}

function markSecuritySuccess() {
    securityFailureCount = 0;
}

/**
 * @param {unknown} err
 */
function markSecurityFailure(err) {
    const isAbort =
        (typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError') ||
        String(err?.message || '').toLowerCase().includes('aborted');
    if (isAbort) return;
    securityFailureCount += 1;
    if (securityFailureCount >= SECURITY_MAX_FAILURES && securityCircuitOpenUntil <= Date.now()) {
        securityCircuitOpenUntil = Date.now() + SECURITY_CIRCUIT_OPEN_MS;
        console.warn('Security API circuit breaker opened for 30 seconds');
    }
}

/**
 * @param {'SECURITY_EVENT_INGEST' | 'SECURITY_EVENT_QUERY'} tag
 * @param {Record<string, unknown>} [detail]
 */
function logSecurityEventDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/**
 * @param {string} path
 * @param {RequestInit} [options]
 */
async function securityFetch(path, options = {}) {
    if (isSecurityCircuitOpen() || shouldThrottleSecurity()) {
        return { disabled: true, error: 'Security API request skipped' };
    }
    const method = options.method || 'GET';
    try {
        const res = await fetchWithRetry(`${API_BASE_URL}${path}`, options, {
            retries: 1,
            notifyReconnectOnFailure: false
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 404) {
            markSecuritySuccess();
            return { disabled: true, error: body.error || 'Security events API disabled' };
        }
        if (!res.ok) {
            throw new Error(body.error || `Security events API failed (${res.status})`);
        }
        markSecuritySuccess();
        if (method === 'GET' || method === 'HEAD') {
            logSecurityEventDiag('SECURITY_EVENT_QUERY', { path, method, count: Number(body.count || 0) });
        } else {
            logSecurityEventDiag('SECURITY_EVENT_INGEST', {
                path,
                method,
                source: body?.event?.source || body?.source || null,
                eventType: body?.event?.eventType || body?.event?.event_type || null
            });
        }
        return body;
    } catch (err) {
        markSecurityFailure(err);
        throw err;
    }
}

/**
 * @param {{
 *   id?: string;
 *   source: string;
 *   eventType: string;
 *   category?: string | null;
 *   severity?: string | null;
 *   title?: string | null;
 *   message?: string | null;
 *   seriesId?: string | null;
 *   payload?: Record<string, unknown> | null;
 *   eventTimestamp?: string | null;
 * }} event
 */
export async function postSecurityEvent(event) {
    try {
        return await securityFetch('/api/security/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(event)
        });
    } catch (err) {
        logSecurityEventDiag('SECURITY_EVENT_INGEST', {
            ok: false,
            source: event.source,
            eventType: event.eventType,
            error: err?.message || 'Security events API unavailable'
        });
        return { disabled: true, error: err?.message || 'Security events API unavailable' };
    }
}

/**
 * @param {{ source?: string; limit?: number }} [options]
 */
export async function fetchSecurityEvents(options = {}) {
    const params = new URLSearchParams();
    if (options.source) params.set('source', options.source);
    if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
        params.set('limit', String(Math.max(1, Math.min(500, Math.floor(options.limit)))));
    }
    const path = `/api/security/events${params.toString() ? `?${params.toString()}` : ''}`;
    try {
        return await securityFetch(path);
    } catch (err) {
        logSecurityEventDiag('SECURITY_EVENT_QUERY', {
            ok: false,
            source: options.source || null,
            error: err?.message || 'Security events API unavailable'
        });
        return { disabled: true, error: err?.message || 'Security events API unavailable', events: [], count: 0 };
    }
}
