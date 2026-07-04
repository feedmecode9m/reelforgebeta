import { API_BASE_URL } from '../config.js';
import { normalizeReel } from './reelContract.js';

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
    const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        const path = `/api/reels/${encodeURIComponent(reelId)}`;
        const res = await fetch(`${API_BASE_URL}${path}`);
        if (!res.ok) {
            throw new Error(`Poll failed (${res.status})`);
        }
        const body = await res.json();
        const status = String(body.status || '').toLowerCase();
        opts.onProgress?.(status);

        if (status === 'ready') {
            const normalized = normalizeReel(
                {
                    id: body.id,
                    name: body.name,
                    type: body.type,
                    url: body.url,
                    thumbnailUrl: body.thumbnailUrl ?? body.thumbnail_url,
                    thumbnail_url: body.thumbnailUrl ?? body.thumbnail_url,
                    createdAt: body.createdAt ?? body.created_at,
                    category: body.category,
                    status: 'ready'
                },
                'ingest-poll'
            );
            if (!normalized) throw new Error('Invalid reel payload after ingestion');
            return normalized;
        }

        if (status === 'failed') {
            throw new Error(body.errorMessage || body.error_message || 'Ingestion failed');
        }

        await new Promise((r) => setTimeout(r, pollMs));
    }

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
