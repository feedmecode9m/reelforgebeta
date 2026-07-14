import { API_BASE_URL } from '../config.js';
import { normalizeReel } from './reelContract.js';
import { pipelineDiag, pipelineCheckpoint } from '../diagnostics/pipelineDiag.js';
import {
    reelResEntry,
    reelResExit,
    reelResThrow,
    reelResReelSnapshot
} from '../diagnostics/reelResolutionTrace.js';

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
    const t0 = performance.now();
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
        const path = `/api/reels/${encodeURIComponent(reelId)}`;
        pipelineDiag('FETCH', 'pollIngestionUntilReady', 'ingestPoll.js', {
            assetId: reelId,
            result: 'poll_fetch',
            detail: path
        });
        const res = await fetch(`${API_BASE_URL}${path}`);
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
            throw new Error(`Poll failed (${res.status})`);
        }
        const body = await res.json();
        const status = String(body.status || '').toLowerCase();
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
                reelResThrow('pollIngestionUntilReady', t0, new Error('Invalid reel payload after ingestion'), {
                    reelId,
                    pollPayload
                });
                throw new Error('Invalid reel payload after ingestion');
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
            return normalized;
        }

        if (status === 'failed') {
            reelResThrow('pollIngestionUntilReady', t0, new Error(body.errorMessage || body.error_message || 'Ingestion failed'), {
                reelId,
                status
            });
            pipelineDiag('INGEST', 'pollIngestionUntilReady', 'ingestPoll.js', {
                assetId: reelId,
                result: 'failed',
                detail: body.errorMessage || body.error_message || 'Ingestion failed'
            });
            throw new Error(body.errorMessage || body.error_message || 'Ingestion failed');
        }

        await new Promise((r) => setTimeout(r, pollMs));
    }

    pipelineDiag('INGEST', 'pollIngestionUntilReady', 'ingestPoll.js', {
        assetId: reelId,
        result: 'timeout'
    });
    reelResThrow('pollIngestionUntilReady', t0, new Error('Ingestion timed out waiting for ready status'), {
        reelId,
        timeoutMs
    });
    throw new Error('Ingestion timed out waiting for ready status');
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
