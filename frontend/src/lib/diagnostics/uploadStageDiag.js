/**
 * BG7X-UPLOAD-HANG-01 — structured upload lifecycle stage diagnostics.
 * Observability only; no upload behavior changes.
 */

import { touchUploadLockProgress } from './uploadLockDiag.js';

/** @typedef {{
 *   uploadAttemptId: string;
 *   uploadKey: string;
 *   fileName: string;
 *   fileSize: number;
 *   t0: number;
 *   reelId: string;
 *   uploadId: string;
 *   abortSignal?: AbortSignal;
 * }} UploadDiagContext */

let attemptSeq = 0;

/**
 * @param {{ uploadKey?: string; fileName?: string; fileSize?: number }} [meta]
 * @returns {UploadDiagContext}
 */
export function createUploadAttemptContext(meta = {}) {
    attemptSeq += 1;
    return {
        uploadAttemptId: `ua-${Date.now().toString(36)}-${attemptSeq}`,
        uploadKey: String(meta.uploadKey || ''),
        fileName: String(meta.fileName || ''),
        fileSize: Number(meta.fileSize || 0),
        t0: performance.now(),
        reelId: '',
        uploadId: ''
    };
}

/**
 * @param {UploadDiagContext | null | undefined} ctx
 * @param {{ reelId?: string; uploadId?: string }} patch
 * @returns {UploadDiagContext | null | undefined}
 */
export function patchUploadDiagContext(ctx, patch = {}) {
    if (!ctx) return ctx;
    if (patch.reelId != null) ctx.reelId = String(patch.reelId);
    if (patch.uploadId != null) ctx.uploadId = String(patch.uploadId);
    return ctx;
}

/**
 * @param {UploadDiagContext | null | undefined} ctx
 * @param {string} stage
 * @param {Record<string, unknown>} [extra]
 */
export function logUploadStage(ctx, stage, extra = {}) {
    const elapsedMs = ctx ? Math.round(performance.now() - ctx.t0) : 0;
    const reelId = String(extra.reelId ?? ctx?.reelId ?? '');
    const uploadId = String(extra.uploadId ?? ctx?.uploadId ?? '');
    const payload = {
        uploadAttemptId: ctx?.uploadAttemptId || '',
        uploadKey: ctx?.uploadKey || '',
        stage,
        elapsedMs,
        fileName: ctx?.fileName || '',
        fileSize: ctx?.fileSize ?? 0,
        reelId,
        uploadId,
        ...extra
    };
    delete payload.reelId;
    delete payload.uploadId;
    payload.reelId = reelId;
    payload.uploadId = uploadId;
    console.info('[UPLOAD_STAGE]', payload);
    if (ctx?.uploadKey) touchUploadLockProgress(ctx.uploadKey);
}

/**
 * @param {UploadDiagContext | null | undefined} ctx
 * @param {unknown} error
 * @param {string} [stage]
 */
export function logUploadError(ctx, error, stage = 'ERROR') {
    const err = error instanceof Error ? error : new Error(String(error));
    logUploadStage(ctx, stage, {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack || ''
    });
}

/**
 * @param {UploadDiagContext | null | undefined} ctx
 * @returns {AbortSignal | undefined}
 */
export function resolveUploadAbortSignal(ctx) {
    const signal = ctx?.abortSignal;
    return signal instanceof AbortSignal ? signal : undefined;
}

/**
 * @param {UploadDiagContext | null | undefined} ctx
 * @param {'begin' | 'complete' | 'error'} phase
 * @param {Record<string, unknown>} [extra]
 */
export function logBg7xR2Put(ctx, phase, extra = {}) {
    const payload = {
        uploadAttemptId: ctx?.uploadAttemptId || '',
        filename: ctx?.fileName || String(extra.filename || ''),
        sizeBytes: ctx?.fileSize ?? Number(extra.sizeBytes || 0),
        uploadStart: extra.uploadStart || null,
        uploadEnd: extra.uploadEnd || null,
        durationMs: extra.durationMs ?? null,
        responseStatus: extra.responseStatus ?? null,
        abortState: extra.abortState ?? null,
        errorName: extra.errorName || null,
        errorMessage: extra.errorMessage || null,
        ...extra
    };
    console.warn('[BG7X_R2_PUT]', payload);
}
