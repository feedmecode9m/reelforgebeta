/**
 * NETLIFY-UPLOAD-DIAGNOSTICS-01 — signed-upload stage logging (behavior-neutral).
 * Records evidence only; does not alter upload transport or retry behavior.
 */

/** @typedef {'UPLOAD_SIGN_START'|'UPLOAD_SIGN_SUCCESS'|'UPLOAD_PUT_BEGIN'|'UPLOAD_PUT_PROGRESS'|'UPLOAD_PUT_COMPLETE'|'UPLOAD_FINALIZE_BEGIN'|'UPLOAD_FINALIZE_SUCCESS'|'UPLOAD_ABORT'|'UPLOAD_TIMEOUT'|'UPLOAD_ERROR'} UploadDiagMarker */

/**
 * @returns {Record<string, unknown>}
 */
function navigatorConnectionInfo() {
    if (typeof navigator === 'undefined') return { available: false };
    const conn =
        navigator.connection ||
        navigator.mozConnection ||
        navigator.webkitConnection ||
        null;
    if (!conn) return { available: false };
    return {
        available: true,
        effectiveType: conn.effectiveType ?? null,
        downlink: conn.downlink ?? null,
        rtt: conn.rtt ?? null,
        saveData: conn.saveData ?? null,
        type: conn.type ?? null
    };
}

/**
 * @returns {Record<string, unknown>}
 */
function browserEnvironmentInfo() {
    if (typeof navigator === 'undefined') {
        return { runtime: 'non-browser' };
    }
    return {
        runtime: 'browser',
        userAgent: navigator.userAgent || null,
        onLine: navigator.onLine,
        connection: navigatorConnectionInfo()
    };
}

/**
 * @param {Headers} headers
 * @returns {Record<string, string>}
 */
export function captureResponseHeaders(headers) {
    /** @type {Record<string, string>} */
    const out = {};
    if (!headers || typeof headers.forEach !== 'function') return out;
    headers.forEach((value, key) => {
        out[key.toLowerCase()] = value;
    });
    return out;
}

/**
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
export function classifyFetchError(error) {
    const err = /** @type {Record<string, unknown>} */ (
        error && typeof error === 'object' ? error : { value: error }
    );
    const name = String(err.name || 'UnknownError');
    const message = String(err.message || err.value || error || '');
    const constructorName = err.constructor?.name || typeof error;
    const stack = typeof err.stack === 'string' ? err.stack : null;

    /** @type {Record<string, boolean>} */
    const classification = {
        isAbortError: name === 'AbortError',
        isNetworkError: name === 'NetworkError' || /network|fetch failed|failed to fetch/i.test(message),
        isTypeError: name === 'TypeError',
        isDomException: constructorName === 'DOMException' || error instanceof DOMException,
        isTimeout:
            name === 'TimeoutError' ||
            /timeout|timed out|AbortSignal\.timeout/i.test(message) ||
            name === 'AbortError'
    };

    let inferredCause = 'unknown';
    if (classification.isAbortError) inferredCause = 'abort';
    else if (classification.isTimeout) inferredCause = 'timeout';
    else if (/reset|econnreset|connection reset/i.test(message)) inferredCause = 'connection_reset';
    else if (classification.isNetworkError) inferredCause = 'network_failure';
    else if (classification.isTypeError) inferredCause = 'type_error';

    return {
        exceptionConstructor: constructorName,
        exceptionName: name,
        exceptionMessage: message,
        stackTrace: stack,
        classification,
        inferredCause
    };
}

/**
 * @param {AbortController | null | undefined} controller
 * @returns {Record<string, unknown>}
 */
export function captureAbortControllerState(controller) {
    if (!controller) {
        return {
            abortControllerPresent: false,
            signalAborted: false,
            signalReason: null
        };
    }
    return {
        abortControllerPresent: true,
        signalAborted: Boolean(controller.signal?.aborted),
        signalReason: controller.signal?.reason ?? null
    };
}

/**
 * @param {UploadDiagMarker} marker
 * @param {Record<string, unknown>} payload
 */
export function signedUploadDiag(marker, payload = {}) {
    const entry = {
        marker,
        timestamp: new Date().toISOString(),
        elapsedMs: typeof payload.elapsedMs === 'number' ? payload.elapsedMs : null,
        ...browserEnvironmentInfo(),
        ...payload
    };
    console.info(`[${marker}]`, entry);
    if (typeof window !== 'undefined') {
        window.__SIGNED_UPLOAD_DIAG__ = window.__SIGNED_UPLOAD_DIAG__ || [];
        window.__SIGNED_UPLOAD_DIAG__.push(entry);
    }
    return entry;
}

/**
 * @param {File} file
 * @param {{ retryNumber?: number; uploadId?: string | null; reelId?: string | null }} [seed]
 */
export function createSignedUploadDiagContext(file, seed = {}) {
    return {
        startedAt: Date.now(),
        fileName: file?.name || null,
        fileSize: Number(file?.size || 0),
        contentLength: Number(file?.size || 0),
        retryNumber: seed.retryNumber ?? 0,
        uploadId: seed.uploadId ?? null,
        reelId: seed.reelId ?? null,
        finalizeAttempted: false,
        finalizeBlockedReason: null
    };
}

/**
 * @param {typeof createSignedUploadDiagContext extends (...args: any[]) => infer R ? R : never} ctx
 */
export function elapsedMs(ctx) {
    return Date.now() - ctx.startedAt;
}

/**
 * @param {Response} response
 */
export function pickCloudHeaders(response) {
    const headers = captureResponseHeaders(response.headers);
    return {
        httpStatus: response.status,
        responseHeaders: headers,
        cfRay: headers['cf-ray'] || null,
        xAmzRequestId: headers['x-amz-request-id'] || headers['x-amz-id-2'] || null
    };
}
