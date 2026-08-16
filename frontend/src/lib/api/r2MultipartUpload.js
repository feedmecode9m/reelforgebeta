/**
 * R2 multipart (parallel chunk) upload scaffold.
 *
 * Backend endpoints are NOT live yet — see artifacts/BG-R2-MULTIPART-UPLOAD.md.
 * When VITE_R2_MULTIPART_UPLOADS=true and create succeeds, parts upload in parallel.
 * Otherwise callers MUST fall back to the existing single signed PUT.
 */

import { API_BASE_URL } from '../api.js';
import { rewriteDevLoopbackAbsoluteToSameOrigin } from '../config.js';

export const MULTIPART_CREATE_URL = '/api/uploads/multipart/create';
export const MULTIPART_SIGN_PART_URL = '/api/uploads/multipart/sign-part';
export const MULTIPART_COMPLETE_URL = '/api/uploads/multipart/complete';

/** Default part size 16 MiB (S3 minimum part size is 5 MiB except last part). */
export const DEFAULT_PART_SIZE_BYTES = 16 * 1024 * 1024;

/** Parallel PUT concurrency — tune after backend ships. */
export const DEFAULT_PART_CONCURRENCY = 4;

/** Minimum file size to attempt multipart (below this, single PUT is fine). */
export const MULTIPART_MIN_FILE_BYTES = 32 * 1024 * 1024;

/**
 * Opt-in until Railway exposes multipart create/sign-part/complete.
 * @returns {boolean}
 */
export function isMultipartUploadEnabled() {
    return import.meta.env.VITE_R2_MULTIPART_UPLOADS === 'true';
}

/**
 * @param {File} file
 * @returns {boolean}
 */
export function shouldAttemptMultipart(file) {
    return (
        isMultipartUploadEnabled() &&
        Boolean(file) &&
        Number(file.size || 0) >= MULTIPART_MIN_FILE_BYTES
    );
}

/**
 * Probe multipart create. Returns null when API missing / disabled / error.
 *
 * @param {File} file
 * @param {Record<string, string>} headers
 * @param {Record<string, unknown>} [meta]
 * @param {AbortSignal} [signal]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function tryCreateMultipartSession(file, headers = {}, meta = {}, signal) {
    if (!shouldAttemptMultipart(file)) {
        console.info('[R2_MULTIPART]', {
            skipped: true,
            reason: isMultipartUploadEnabled() ? 'file_below_min' : 'flag_off',
            fileSize: file?.size ?? null,
            ts: new Date().toISOString()
        });
        return null;
    }

    try {
        const res = await fetch(`${API_BASE_URL}${MULTIPART_CREATE_URL}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            },
            body: JSON.stringify({
                filename: file.name,
                contentType: file.type || 'video/mp4',
                sizeBytes: file.size,
                partSizeBytes: DEFAULT_PART_SIZE_BYTES,
                title: meta.title,
                description: meta.description,
                category: meta.category,
                ...(meta.episodeId ? { episodeId: meta.episodeId } : {})
            }),
            ...(signal ? { signal } : {})
        });

        if (res.status === 404 || res.status === 501) {
            console.info('[R2_MULTIPART]', {
                skipped: true,
                reason: 'api_not_available',
                status: res.status,
                ts: new Date().toISOString()
            });
            return null;
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            console.warn('[R2_MULTIPART]', {
                skipped: true,
                reason: 'create_failed',
                status: res.status,
                detail: text.slice(0, 200),
                ts: new Date().toISOString()
            });
            return null;
        }

        const body = await res.json();
        if (!body?.uploadId || !body?.s3UploadId) {
            console.warn('[R2_MULTIPART]', {
                skipped: true,
                reason: 'invalid_create_payload',
                ts: new Date().toISOString()
            });
            return null;
        }

        console.info('[R2_MULTIPART]', {
            stage: 'create_ok',
            uploadId: body.uploadId,
            partCount: body.partCount,
            partSizeBytes: body.partSizeBytes,
            ts: new Date().toISOString()
        });
        return body;
    } catch (err) {
        console.warn('[R2_MULTIPART]', {
            skipped: true,
            reason: 'create_threw',
            message: err?.message || String(err),
            ts: new Date().toISOString()
        });
        return null;
    }
}

/**
 * @param {File} file
 * @param {number} partSize
 * @returns {{ partNumber: number; start: number; end: number }[]}
 */
export function planFileParts(file, partSize = DEFAULT_PART_SIZE_BYTES) {
    const size = Number(file.size || 0);
    const parts = [];
    let start = 0;
    let partNumber = 1;
    while (start < size) {
        const end = Math.min(start + partSize, size);
        parts.push({ partNumber, start, end });
        start = end;
        partNumber += 1;
    }
    return parts;
}

/**
 * Scaffold: parallel part upload. Throws if sign-part/complete missing.
 * Callers should catch and fall back to single PUT until backend ships.
 *
 * @param {Record<string, unknown>} session — create response
 * @param {File} file
 * @param {Record<string, string>} headers
 * @param {{
 *   concurrency?: number;
 *   signal?: AbortSignal;
 *   onProgress?: (detail: { percent: number; loaded: number; total: number; phase: string }) => void;
 * }} [options]
 */
export async function uploadFileMultipartParallel(session, file, headers = {}, options = {}) {
    const concurrency = Math.max(1, Number(options.concurrency || DEFAULT_PART_CONCURRENCY));
    const signal = options.signal;
    const partSize = Number(session.partSizeBytes || DEFAULT_PART_SIZE_BYTES);
    const parts = planFileParts(file, partSize);
    const total = file.size;
    const loadedByPart = new Map();

    const emitProgress = () => {
        let loaded = 0;
        loadedByPart.forEach((v) => {
            loaded += v;
        });
        const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
        options.onProgress?.({
            percent,
            loaded,
            total,
            phase: 'put',
            transport: 'r2-multipart'
        });
    };

    /**
     * @param {{ partNumber: number; start: number; end: number }} part
     */
    async function uploadOnePart(part) {
        if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError');

        const signRes = await fetch(`${API_BASE_URL}${MULTIPART_SIGN_PART_URL}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({
                uploadId: session.uploadId,
                partNumber: part.partNumber
            }),
            ...(signal ? { signal } : {})
        });
        if (!signRes.ok) {
            throw new Error(`multipart sign-part failed (${signRes.status})`);
        }
        const signed = await signRes.json();
        const uploadUrl = rewriteDevLoopbackAbsoluteToSameOrigin(
            String(signed.uploadUrl || signed.upload_url || '')
        );
        if (!uploadUrl) throw new Error('multipart sign-part missing uploadUrl');

        const blob = file.slice(part.start, part.end);
        const putRes = await fetch(uploadUrl, {
            method: 'PUT',
            body: blob,
            ...(signal ? { signal } : {})
        });
        if (!putRes.ok) {
            throw new Error(`multipart part ${part.partNumber} PUT failed (${putRes.status})`);
        }
        const etag = putRes.headers.get('ETag') || putRes.headers.get('etag') || '';
        if (!etag) {
            throw new Error(`multipart part ${part.partNumber} missing ETag`);
        }
        loadedByPart.set(part.partNumber, part.end - part.start);
        emitProgress();
        return { partNumber: part.partNumber, etag };
    }

    const completed = [];
    let cursor = 0;
    async function worker() {
        while (cursor < parts.length) {
            const index = cursor;
            cursor += 1;
            completed.push(await uploadOnePart(parts[index]));
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, parts.length) }, () => worker());
    await Promise.all(workers);

    completed.sort((a, b) => a.partNumber - b.partNumber);

    const completeRes = await fetch(`${API_BASE_URL}${MULTIPART_COMPLETE_URL}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
            uploadId: session.uploadId,
            parts: completed
        }),
        ...(signal ? { signal } : {})
    });
    if (!completeRes.ok) {
        const text = await completeRes.text().catch(() => '');
        throw new Error(text || `multipart complete failed (${completeRes.status})`);
    }

    console.info('[R2_MULTIPART]', {
        stage: 'complete_ok',
        uploadId: session.uploadId,
        partCount: completed.length,
        ts: new Date().toISOString()
    });

    return {
        uploadId: session.uploadId,
        reelId: session.reelId,
        parts: completed
    };
}
