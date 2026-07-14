/**
 * Temporary upload-pipeline instrumentation (Mission: diagnostic logging).
 * Does not alter control flow — logging only.
 *
 * @typedef {'DND'|'UPLOAD'|'API'|'FETCH'|'CORS'|'RESPONSE'|'BOOTSTRAP'|'VIEWER'} FrontendPipelineTag
 */

/**
 * @param {FrontendPipelineTag | string} tag
 * @param {string} functionName
 * @param {string} sourceFile
 * @param {{ assetId?: string | null; asset_id?: string | null; fileName?: string | null; filename?: string | null; result?: string; detail?: unknown; stage?: string }} [meta]
 */
export function pipelineDiag(tag, functionName, sourceFile, meta = {}) {
    const record = {
        timestamp: new Date().toISOString(),
        function: functionName,
        sourceFile,
        assetId: meta.assetId ?? meta.asset_id ?? null,
        fileName: meta.fileName ?? meta.filename ?? null,
        result: meta.result ?? meta.stage ?? 'ok'
    };
    if (meta.detail !== undefined) {
        record.detail = meta.detail;
    }
    console.info(`[${tag}]`, record);
}

/**
 * @param {string} functionName
 * @param {string} sourceFile
 * @param {Error | unknown} error
 * @param {{ assetId?: string | null; fileName?: string | null; url?: string }} [meta]
 */
export function pipelineDiagCors(functionName, sourceFile, error, meta = {}) {
    const message = String(error?.message || error || '');
    const corsLike = /failed to fetch|networkerror|load failed|cors|origin is not allowed/i.test(message);
    pipelineDiag(corsLike ? 'CORS' : 'FETCH', functionName, sourceFile, {
        ...meta,
        result: corsLike ? 'cors_or_network_blocked' : 'fetch_error',
        detail: message
    });
}

/**
 * Mission BG-5A canonical checkpoint — logging only, no control-flow changes.
 * @param {string} checkpoint e.g. DROP_RECEIVED, POST_API_REELS
 * @param {Record<string, unknown>} [meta]
 */
export function pipelineCheckpoint(checkpoint, meta = {}) {
    console.info(`[PIPELINE] ${checkpoint}`, {
        timestamp: new Date().toISOString(),
        ...meta
    });
}
