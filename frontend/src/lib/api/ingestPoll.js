import { API_BASE_URL } from '../config.js';
import { normalizeReel } from './reelContract.js';
import { pipelineDiag, pipelineCheckpoint } from '../diagnostics/pipelineDiag.js';
import {
    reelResEntry,
    reelResExit,
    reelResThrow,
    reelResReelSnapshot
} from '../diagnostics/reelResolutionTrace.js';
import { logUploadStage, logUploadError, resolveUploadAbortSignal } from '../diagnostics/uploadStageDiag.js';

const DEFAULT_POLL_MS = 800;
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * @typedef {Object} IngestAcceptedResponse
 * @property {string} id
 * @property {string} status
 * @property {string} videoUrl
 * @property {string | null} thumbnailUrl
 * @property {string} pollUrl
 */

/**
 * Poll GET /api/reels/{id} until status is ready or failed.
 * @param {string} reelId
 * @param {{ pollMs?: number; timeoutMs?: number; onProgress?: (status: string) => void }} [opts]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function pollIngestionUntilReady(reelId, opts = {}) {
    const diagContext = opts.diagContext || null;
    const t0 = performance.now();
    logUploadStage(diagContext, 'POLL_ENTER', { reelId });
    let attempt = 0;
    try {
    reelResEntry('pollIngestionUntilReady', {
        reelId,
        pollEndpoint: `/api/reels/${reelId}`,
        pollMs: opts.pollMs ?? DEFAULT_POLL_MS,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });
    const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const started = Date.now();

    pipelineDiag('INGEST', 'pollIngestionUntilReady', 'ingestPoll.js', {
        assetId: reelId,
        result: 'poll_start'
    });
    pipelineCheckpoint('WAITING_FOR_INGEST', { reelId, phase: 'poll_start' });

    while (Date.now() - started < timeoutMs) {
        attempt += 1;
        const path = `/api/reels/${encodeURIComponent(reelId)}`;
        pipelineDiag('FETCH', 'pollIngestionUntilReady', 'ingestPoll.js', {
            assetId: reelId,
            result: 'poll_fetch',
            detail: path
        });
        const pollSignal = resolveUploadAbortSignal(diagContext);
        const res = await fetch(`${API_BASE_URL}${path}`, {
            ...(pollSignal ? { signal: pollSignal } : {})
        });
        pipelineDiag('RESPONSE', 'pollIngestionUntilReady', 'ingestPoll.js', {
            assetId: reelId,
            result: `http_${res.status}`,
            detail: { ok: res.ok }
        });
        if (!res.ok) {
            pipelineDiag('INGEST', 'pollIngestionUntilReady', 'ingestPoll.js', {
                assetId: reelId,
                result: 'poll_http_error',
                detail: res.status
            });
            const httpError = new Error(`Poll failed (${res.status})`);
            throw httpError;
        }
        const body = await res.json();
        const status = String(body.status || '').toLowerCase();
        logUploadStage(diagContext, 'POLL_ITERATION', {
            attempt,
            pollElapsedMs: Math.round(Date.now() - started),
            status,
            reelId
        });
        reelResReelSnapshot('pollIngestionUntilReady:pollBody', body, {
            pollIteration: Math.floor((Date.now() - started) / pollMs),
            httpStatus: res.status,
            parsedStatus: status,
            nestedReelStatus: body?.reel?.status ?? null,
            bodyKeys: body && typeof body === 'object' ? Object.keys(body) : []
        });
        opts.onProgress?.(status);
        pipelineDiag('INGEST', 'pollIngestionUntilReady', 'ingestPoll.js', {
            assetId: reelId,
            result: status || 'unknown'
        });

        if (status === 'ready') {
            const pollPayload = {
                id: body.id,
                name: body.name,
                type: body.type,
                url: body.url,
                thumbnailUrl: body.thumbnailUrl ?? body.thumbnail_url,
                thumbnail_url: body.thumbnailUrl ?? body.thumbnail_url,
                createdAt: body.createdAt ?? body.created_at,
                category: body.category,
                status: 'ready'
            };
            reelResReelSnapshot('pollIngestionUntilReady:preNormalize', pollPayload, { reelId });
            const normalized = normalizeReel(pollPayload, 'ingest-poll');
            if (!normalized) {
                const invalidError = new Error('Invalid reel payload after ingestion');
                reelResThrow('pollIngestionUntilReady', t0, invalidError, {
                    reelId,
                    pollPayload
                });
                throw invalidError;
            }
            reelResReelSnapshot('pollIngestionUntilReady:postNormalize', normalized, { reelId, ready: true });
            pipelineDiag('INGEST', 'pollIngestionUntilReady', 'ingestPoll.js', {
                assetId: reelId,
                fileName: normalized.fileName || normalized.name || null,
                result: 'ready'
            });
            pipelineCheckpoint('WAITING_FOR_INGEST', { reelId, phase: 'ready', url: normalized.url || '' });
            reelResExit('pollIngestionUntilReady', t0, {
                reelId,
                result: 'ready',
                id: normalized.id,
                url: normalized.url,
                thumbnailUrl: normalized.thumbnailUrl,
                status: normalized.status,
                category: normalized.category
            });
            logUploadStage(diagContext, 'POLL_READY', { attempt, reelId });
            return normalized;
        }

        if (status === 'failed') {
            const failedError = new Error(body.errorMessage || body.error_message || 'Ingestion failed');
            reelResThrow('pollIngestionUntilReady', t0, failedError, {
                reelId,
                status
            });
            pipelineDiag('INGEST', 'pollIngestionUntilReady', 'ingestPoll.js', {
                assetId: reelId,
                result: 'failed',
                detail: body.errorMessage || body.error_message || 'Ingestion failed'
            });
            throw failedError;
        }

        await new Promise((r) => setTimeout(r, pollMs));
    }

    pipelineDiag('INGEST', 'pollIngestionUntilReady', 'ingestPoll.js', {
        assetId: reelId,
        result: 'timeout'
    });
    const timeoutError = new Error('Ingestion timed out waiting for ready status');
    logUploadStage(diagContext, 'POLL_TIMEOUT', {
        attempt,
        pollElapsedMs: Math.round(Date.now() - started),
        reelId
    });
    reelResThrow('pollIngestionUntilReady', t0, timeoutError, {
        reelId,
        timeoutMs
    });
    throw timeoutError;
    } catch (error) {
        logUploadError(diagContext, error, 'POLL_THROW');
        throw error;
    }
}

/**
 * @param {Record<string, unknown>} reel
 */
export function isReadyReel(reel) {
    if (!reel) return false;
    const status = String(reel.status || 'ready').toLowerCase();
    if (status !== 'ready') return false;
    return Boolean(reel.url && reel.thumbnailUrl);
}
