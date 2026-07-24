import { API_BASE_URL, fetchWithRetry } from '../api.js';
import {
    DIRECT_UPLOAD_BASE_URL,
    SIGNED_UPLOADS_MIN_BYTES,
    USE_SIGNED_UPLOADS
} from '../config.js';
import { enforceUploadPolicy } from '../security/securityPolicyEngine.js';

/** @typedef {{ valid: boolean; kind: string; filename: string; error?: string; checks: Record<string, boolean> }} MediaValidationResult */
/** @typedef {{ videos: string[]; thumbnails: string[]; invalid_videos: Array<{ name: string; reason: string }> }} MediaStorageInventory */
/** @typedef {{
 *   id: string;
 *   name: string;
 *   type: string;
 *   url: string;
 *   videoPath?: string;
 *   video_path?: string;
 *   thumbnailPath?: string;
 *   thumbnail_path?: string;
 *   thumbnailUrl?: string;
 *   thumbnail_url?: string;
 *   description?: string;
 *   createdAt?: string;
 *   created_at?: string;
 *   category?: string;
 *   size?: number;
 * }} CreatedReelResponse */

export const CREATE_REEL_URL = '/api/reels';
export const UPLOADS_SIGN_URL = '/api/uploads/sign';
export const REELS_FINALIZE_URL = '/api/reels/finalize';

/**
 * @param {File | null | undefined} file
 * @returns {boolean}
 */
function shouldUseSignedVideoUpload(file) {
    return Boolean(
        USE_SIGNED_UPLOADS &&
            file instanceof File &&
            Number(file.size || 0) >= SIGNED_UPLOADS_MIN_BYTES
    );
}

/**
 * Shared post-ingest handling for multipart and signed finalize responses.
 * @param {Record<string, unknown>} body
 * @param {string | null} primaryFileName
 * @param {number} httpStatus
 * @returns {Promise<CreatedReelResponse>}
 */
async function processIngestAcceptedResponse(body, primaryFileName, httpStatus) {
    if (httpStatus === 202 || body.status === 'pending') {
        const reelId = String(body.id || '');
        pipelineCheckpoint('WAITING_FOR_INGEST', { reelId, status: body.status || 'pending' });
        pipelineDiag('INGEST', 'createReel', 'media.js', {
            assetId: reelId,
            fileName: primaryFileName,
            result: 'accepted_pending'
        });
        if (!reelId) throw new Error('Ingestion accepted but no reel id returned');
        const ready = await pollIngestionUntilReady(reelId, {
            onProgress: (status) => {
                if (import.meta.env.DEV) {
                    console.log(`[ingest-poll] ${reelId} → ${status}`);
                }
            }
        });
        console.info('[UPLOAD_SUCCESS]', {
            id: ready?.id || reelId,
            status: 'ready',
            url: ready?.url || '',
            thumbnailUrl: ready?.thumbnailUrl || '',
            ts: new Date().toISOString()
        });
        pipelineDiag('UPLOAD', 'createReel', 'media.js', {
            assetId: ready?.id || reelId,
            fileName: primaryFileName,
            result: 'ready',
            detail: { url: ready?.url || '', thumbnailUrl: ready?.thumbnailUrl || '' }
        });
        console.info('[BG7G_API]', {
            ts: new Date().toISOString(),
            component: 'createReel',
            file: 'media.js',
            fileName: primaryFileName,
            uploadUrl: ready?.url || `${API_BASE_URL}${CREATE_REEL_URL}`,
            state: 'success',
            reelId: ready?.id || reelId,
            ingest: 'pending_ready'
        });
        console.info('[HERO_ROUTE]', {
            stage: 'createReel:pending-ready',
            id: ready?.id || reelId,
            status: 'ready',
            url: ready?.url || '',
            thumbnailUrl: ready?.thumbnailUrl || '',
            ts: new Date().toISOString()
        });
        return ready;
    }

    if (body.status === 'ready' && body.id) {
        const normalized = normalizeReel(body, 'create-reel');
        if (normalized) {
            pipelineDiag('UPLOAD', 'createReel', 'media.js', {
                assetId: normalized.id,
                fileName: primaryFileName,
                result: 'ready_immediate',
                detail: { url: normalized.url || '', thumbnailUrl: normalized.thumbnailUrl || '' }
            });
            console.info('[UPLOAD_SUCCESS]', {
                id: normalized.id,
                status: normalized.status || 'ready',
                url: normalized.url || '',
                thumbnailUrl: normalized.thumbnailUrl || '',
                ts: new Date().toISOString()
            });
            console.info('[HERO_ROUTE]', {
                stage: 'createReel:normalized-ready',
                id: normalized.id,
                type: normalized.type || '',
                url: normalized.url || '',
                thumbnailUrl: normalized.thumbnailUrl || '',
                ts: new Date().toISOString()
            });
            return normalized;
        }
    }

    console.info('[UPLOAD_SUCCESS]', {
        id: body.id || '',
        status: body.status || 'unknown',
        url: body.url || body.videoUrl || body.video_url || '',
        thumbnailUrl:
            body.thumbnailUrl || body.thumbnail_url || body.thumbnailPath || body.thumbnail_path || '',
        ts: new Date().toISOString()
    });
    pipelineDiag('UPLOAD', 'createReel', 'media.js', {
        assetId: body.id || null,
        fileName: primaryFileName,
        result: body.status || 'unknown',
        detail: { url: body.url || body.videoUrl || body.video_url || '' }
    });
    console.info('[HERO_ROUTE]', {
        stage: 'createReel:raw-response',
        id: body.id || '',
        status: body.status || 'unknown',
        url: body.url || body.videoUrl || body.video_url || '',
        thumbnailUrl: body.thumbnailUrl || body.thumbnail_url || '',
        ts: new Date().toISOString()
    });
    return body;
}

/**
 * Signed direct upload: sign → PUT bytes to Railway → JSON finalize via same-origin API.
 * @param {File} file
 * @param {Record<string, string>} headers
 * @param {{ title?: string; description?: string; category?: string }} [meta]
 */
async function uploadVideoSigned(file, headers = {}, meta = {}) {
    const primaryFileName = file?.name || null;
    const uploadPolicy = enforceUploadPolicy({ operation: 'create_reel' });
    if (!uploadPolicy.allowed) {
        throw new Error(uploadPolicy.reason);
    }
    if (uploadPolicy.throttleMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, uploadPolicy.throttleMs));
    }

    pipelineCheckpoint('UPLOAD_STARTED', {
        fileName: primaryFileName,
        endpoint: UPLOADS_SIGN_URL,
        fileInfo: { video: { name: file.name, size: file.size, type: file.type } },
        transport: 'signed-direct'
    });
    console.info('[BG7G_SIGNED_UPLOAD]', {
        stage: 'sign:request',
        fileName: primaryFileName,
        fileSize: file.size,
        minBytes: SIGNED_UPLOADS_MIN_BYTES,
        ts: new Date().toISOString()
    });

    const signResponse = await fetch(`${API_BASE_URL}${UPLOADS_SIGN_URL}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...headers
        },
        body: JSON.stringify({
            filename: file.name,
            contentType: file.type || 'video/mp4',
            sizeBytes: file.size,
            title: meta.title,
            description: meta.description,
            category: meta.category
        })
    });
    if (!signResponse.ok) {
        const err = await signResponse.json().catch(() => ({}));
        throw new Error(err.error || `Signed upload sign failed (${signResponse.status})`);
    }
    const signBody = await signResponse.json();
    const uploadUrl = String(signBody.uploadUrl || `${DIRECT_UPLOAD_BASE_URL}/api/uploads/direct/${signBody.uploadId}`);
    const uploadToken = String(signBody.uploadToken || '');
    const isR2PresignedPut = uploadUrl.includes('r2.cloudflarestorage.com');
    const putHeaders = {
        'Content-Type': file.type || 'video/mp4',
        ...(!isR2PresignedPut && uploadToken ? { 'X-Upload-Token': uploadToken } : {})
    };

    console.info('[BG7G_SIGNED_UPLOAD]', {
        stage: 'direct:put',
        uploadId: signBody.uploadId,
        reelId: signBody.reelId,
        uploadUrl,
        ts: new Date().toISOString()
    });

    const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: putHeaders,
        body: file
    });
    if (!putResponse.ok) {
        const errText = await putResponse.text().catch(() => '');
        let errMsg = errText;
        try {
            errMsg = JSON.parse(errText).error || errText;
        } catch {
            /* keep text */
        }
        throw new Error(errMsg || `Direct storage upload failed (${putResponse.status})`);
    }

    console.info('[BG7G_SIGNED_UPLOAD]', {
        stage: 'finalize:request',
        uploadId: signBody.uploadId,
        endpoint: REELS_FINALIZE_URL,
        ts: new Date().toISOString()
    });

    const finalizeResponse = await fetch(`${API_BASE_URL}${REELS_FINALIZE_URL}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...headers
        },
        body: JSON.stringify({
            uploadId: signBody.uploadId,
            title: meta.title,
            description: meta.description,
            category: meta.category
        })
    });
    if (!finalizeResponse.ok) {
        const err = await finalizeResponse.json().catch(() => ({}));
        throw new Error(err.error || `Finalize reel failed (${finalizeResponse.status})`);
    }

    const body = await finalizeResponse.json();
    pipelineCheckpoint('POST_COMPLETED', {
        status: finalizeResponse.status,
        returnedId: body?.id ?? null,
        transport: 'signed-direct'
    });
    return processIngestAcceptedResponse(body, primaryFileName, finalizeResponse.status);
}

/**
 * Canonical production upload pipeline (Mission 4.5):
 * Drag/Drop or UI → uploadMedia | uploadThumbnail | uploadVideo (wrappers)
 * → createReel() → POST /api/reels → handlers.rs → media_api.rs
 * → ingestion/upload.rs → worker.rs → ffmpeg.rs → Postgres
 * → pollIngestionUntilReady → mediaBootstrap / syncFromVault → Viewer
 *
 * All file uploads MUST delegate to createReel(). Do not add alternate fetch targets.
 */

import { pollIngestionUntilReady } from './ingestPoll.js';
import { normalizeReel, normalizeReels, createLocalReel } from './reelContract.js';
import { getDemoPlaceholders } from '../demoPlaceholders.js';
import { pipelineDiag, pipelineDiagCors, pipelineCheckpoint } from '../diagnostics/pipelineDiag.js';

/**
 * POST /api/reels — unified multipart create (video, thumbnail, title, description).
 * @param {FormData} formData
 * @param {Record<string, string>} [headers]
 * @returns {Promise<CreatedReelResponse>}
 */
export async function createReel(formData, headers = {}) {
    const fileInfo = {};
    let primaryFileName = null;
    if (formData instanceof FormData) {
        for (const [key, value] of formData.entries()) {
            if (value instanceof File) {
                fileInfo[key] = {
                    name: value.name,
                    type: value.type || '',
                    size: value.size || 0
                };
                if (!primaryFileName) primaryFileName = value.name;
            }
        }
    }
    pipelineCheckpoint('UPLOAD_STARTED', {
        fileName: primaryFileName,
        endpoint: CREATE_REEL_URL,
        fileInfo
    });
    console.info('[BG7G_API]', {
        ts: new Date().toISOString(),
        component: 'createReel',
        file: 'media.js',
        fileName: primaryFileName,
        fileSize: fileInfo?.video?.size || fileInfo?.thumbnail?.size || fileInfo?.image?.size || null,
        uploadUrl: `${API_BASE_URL}${CREATE_REEL_URL}`,
        state: 'request_start',
        fileInfo
    });
    pipelineDiag('UPLOAD', 'createReel', 'media.js', {
        fileName: primaryFileName,
        result: 'request_start',
        detail: { endpoint: CREATE_REEL_URL, fileInfo }
    });
    console.info('[HERO_CLASSIFY]', {
        stage: 'createReel:request',
        hasVideo: formData instanceof FormData ? formData.has('video') : false,
        hasImage: formData instanceof FormData ? formData.has('image') : false,
        hasThumbnail: formData instanceof FormData ? formData.has('thumbnail') : false,
        fileInfo,
        ts: new Date().toISOString()
    });
    console.info('[HERO_UPLOAD]', {
        stage: 'createReel:request',
        fileInfo,
        ts: new Date().toISOString()
    });
    console.info('[UPLOAD_STARTED]', {
        endpoint: CREATE_REEL_URL,
        hasVideo: formData instanceof FormData ? formData.has('video') : false,
        hasThumbnail: formData instanceof FormData ? formData.has('thumbnail') : false,
        ts: new Date().toISOString()
    });
    const uploadPolicy = enforceUploadPolicy({ operation: 'create_reel' });
    if (!uploadPolicy.allowed) {
        pipelineDiag('UPLOAD', 'createReel', 'media.js', {
            fileName: primaryFileName,
            result: 'blocked_by_policy',
            detail: uploadPolicy.reason || 'blocked-by-policy'
        });
        console.error('[UPLOAD_FAILED]', {
            reason: uploadPolicy.reason || 'blocked-by-policy',
            ts: new Date().toISOString()
        });
        throw new Error(uploadPolicy.reason);
    }
    if (uploadPolicy.throttleMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, uploadPolicy.throttleMs));
    }

    pipelineDiag('API', 'createReel', 'media.js', {
        fileName: primaryFileName,
        result: 'fetch_post_start',
        detail: { url: `${API_BASE_URL}${CREATE_REEL_URL}` }
    });
    pipelineCheckpoint('POST_API_REELS', {
        requestUrl: `${API_BASE_URL}${CREATE_REEL_URL}`,
        payloadSummary: fileInfo
    });

    const response = await fetch(`${API_BASE_URL}${CREATE_REEL_URL}`, {
        method: 'POST',
        headers,
        body: formData
    }).catch((networkError) => {
        pipelineDiagCors('createReel', 'media.js', networkError, { fileName: primaryFileName });
        const message = String(networkError?.message || networkError || '');
        if (/failed to fetch|networkerror|load failed|cors/i.test(message)) {
            throw new Error(
                'Upload blocked by network/CORS — redeploy with VITE_USE_SAME_ORIGIN_API=true (Netlify _redirects proxy).'
            );
        }
        throw networkError;
    });

    pipelineDiag('RESPONSE', 'createReel', 'media.js', {
        fileName: primaryFileName,
        assetId: null,
        result: `http_${response.status}`,
        detail: { ok: response.ok }
    });
    console.info('[BG7G_API]', {
        ts: new Date().toISOString(),
        component: 'createReel',
        file: 'media.js',
        fileName: primaryFileName,
        fileSize: fileInfo?.video?.size || fileInfo?.thumbnail?.size || fileInfo?.image?.size || null,
        uploadUrl: `${API_BASE_URL}${CREATE_REEL_URL}`,
        state: response.ok ? 'http_success' : 'http_failure',
        status: response.status
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        pipelineCheckpoint('POST_COMPLETED', {
            status: response.status,
            returnedId: err?.id ?? null
        });
        console.error('[UPLOAD_FAILED]', {
            status: response.status,
            error: err.error || 'create-reel-failed',
            ts: new Date().toISOString()
        });
        pipelineDiag('UPLOAD', 'createReel', 'media.js', {
            fileName: primaryFileName,
            result: 'http_error',
            detail: { status: response.status, error: err.error || 'create-reel-failed' }
        });
        throw new Error(err.error || `Create reel failed (${response.status})`);
    }

    const body = await response.json();
    pipelineCheckpoint('POST_COMPLETED', {
        status: response.status,
        returnedId: body?.id ?? null
    });

    return processIngestAcceptedResponse(body, primaryFileName, response.status);
}

/**
 * @param {File} file
 * @param {Record<string, string>} [headers]
 * @param {{ title?: string; description?: string; category?: string }} [meta]
 * @returns {Promise<CreatedReelResponse>}
 * @deprecated Use createReel directly when building FormData; this wrapper delegates only.
 */
export async function uploadThumbnail(file, headers = {}, meta = {}) {
    pipelineDiag('UPLOAD', 'uploadThumbnail', 'media.js', {
        fileName: file?.name || null,
        result: 'start'
    });
    const formData = new FormData();
    formData.append('thumbnail', file);
    if (meta.title) formData.append('title', meta.title);
    if (meta.description) formData.append('description', meta.description);
    if (meta.category) formData.append('category', meta.category);
    return createReel(formData, headers);
}

/**
 * @param {File} file
 * @param {Record<string, string>} [headers]
 * @param {{ title?: string; description?: string; category?: string; thumbnail?: File }} [meta]
 * @returns {Promise<CreatedReelResponse>}
 * @deprecated Use createReel directly when building FormData; this wrapper delegates only.
 */
export async function uploadVideo(file, headers = {}, meta = {}) {
    pipelineDiag('UPLOAD', 'uploadVideo', 'media.js', {
        fileName: file?.name || null,
        result: 'start'
    });
    if (shouldUseSignedVideoUpload(file)) {
        return uploadVideoSigned(file, headers, meta);
    }
    const formData = new FormData();
    formData.append('video', file);
    if (meta.thumbnail) formData.append('thumbnail', meta.thumbnail);
    if (meta.title) formData.append('title', meta.title);
    if (meta.description) formData.append('description', meta.description);
    if (meta.category) formData.append('category', meta.category);
    return createReel(formData, headers);
}

/**
 * Upload via FormData (always POST /api/reels) or infer file kind for single-file upload.
 * @param {File | FormData} fileOrFormData
 * @param {Record<string, string> | string} [headersOrMime]
 * @returns {Promise<CreatedReelResponse>}
 * @deprecated Use createReel directly when building FormData; this wrapper delegates only.
 */
export async function uploadMedia(fileOrFormData, headersOrMime = {}) {
    if (fileOrFormData instanceof FormData) {
        const headers =
            headersOrMime && typeof headersOrMime === 'object' ? headersOrMime : {};
        const videoEntry = fileOrFormData.get('video');
        if (videoEntry instanceof File && shouldUseSignedVideoUpload(videoEntry)) {
            return uploadVideoSigned(videoEntry, headers, {
                title: String(fileOrFormData.get('title') || '').trim() || undefined,
                description: String(fileOrFormData.get('description') || '').trim() || undefined,
                category: String(fileOrFormData.get('category') || '').trim() || undefined
            });
        }
        console.info('[BG7G_UPLOAD]', {
            ts: new Date().toISOString(),
            component: 'uploadMedia',
            file: 'media.js',
            fileName: null,
            fileSize: null,
            uploadUrl: `${API_BASE_URL}${CREATE_REEL_URL}`,
            state: 'formData_delegate'
        });
        pipelineDiag('UPLOAD', 'uploadMedia', 'media.js', { result: 'formData_delegate' });
        return createReel(fileOrFormData, headers);
    }

    const file = fileOrFormData;
    pipelineDiag('UPLOAD', 'uploadMedia', 'media.js', {
        fileName: file?.name || null,
        result: 'single_file_start'
    });
    const mimeType =
        typeof headersOrMime === 'string' ? headersOrMime : file.type || 'image/jpeg';
    const headers =
        typeof headersOrMime === 'object' && headersOrMime !== null ? headersOrMime : {};

    if (mimeType.startsWith('video/')) {
        return uploadVideo(file, headers);
    }
    return uploadThumbnail(file, headers);
}

/**
 * POST /api/media/validate — validate file without saving.
 * @param {FormData} formData
 * @returns {Promise<MediaValidationResult>}
 */
export async function validateMedia(formData) {
    const response = await fetch(`${API_BASE_URL}/api/media/validate`, {
        method: 'POST',
        body: formData
    });
    if (!response.ok) {
        throw new Error(`Validation request failed (${response.status})`);
    }
    return response.json();
}

/**
 * GET /api/media/storage — list videos, thumbnails, and invalid files.
 * Falls back to GET /api/videos + GET /api/thumbnails when storage route is unavailable.
 * @returns {Promise<MediaStorageInventory>}
 */
export async function fetchMediaStorage() {
    const storageRes = await fetchWithRetry(
        `${API_BASE_URL}/api/media/storage`,
        {},
        { retries: 1 }
    );
    if (storageRes.ok) {
        return storageRes.json();
    }

    const [videosRes, thumbsRes] = await Promise.all([
        fetchWithRetry(`${API_BASE_URL}/api/videos`, {}, { retries: 2 }),
        fetchWithRetry(`${API_BASE_URL}/api/thumbnails`, {}, { retries: 2 })
    ]);

    if (!videosRes.ok && !thumbsRes.ok) {
        throw new Error(
            `Storage inventory failed (storage=${storageRes.status}, videos=${videosRes.status}, thumbs=${thumbsRes.status})`
        );
    }

    const videos = videosRes.ok ? await videosRes.json() : [];
    const thumbnails = thumbsRes.ok ? await thumbsRes.json() : [];

    return {
        videos: Array.isArray(videos) ? videos : [],
        thumbnails: Array.isArray(thumbnails) ? thumbnails : [],
        invalid_videos: []
    };
}

/**
 * DELETE /api/media/storage/{filename}
 * @param {string} filename
 * @param {RequestInit['headers']} [headers]
 */
export async function deleteMediaFile(filename, headers = {}) {
    const encoded = encodeURIComponent(filename);
    const paths = [
        `/api/storage/file/${encoded}`,
        `/api/media/storage/${encoded}`
    ];

    let lastStatus = 0;
    for (const path of paths) {
        const response = await fetch(`${API_BASE_URL}${path}`, { method: 'DELETE', headers });
        if (response.ok) {
            return response.json();
        }
        lastStatus = response.status;
        if (response.status !== 404) {
            throw new Error(`Delete failed (${response.status})`);
        }
    }

    throw new Error(`Delete failed (${lastStatus || 404})`);
}

/**
 * DELETE /api/reels/{id} — authoritative reel deletion (DB + disk via backend handler).
 * @param {string} reelId
 * @param {RequestInit['headers']} [headers]
 */
export async function deleteReelById(reelId, headers = {}) {
    const id = String(reelId || '').trim();
    if (!id) throw new Error('Missing reel id');
    const url = `${API_BASE_URL}/api/reels/${encodeURIComponent(id)}`;
    console.info('[VAULT-DELETE-TRACE] deleteReelById:request', {
        method: 'DELETE',
        url,
        hasAuth: Boolean(headers?.Authorization),
        ts: new Date().toISOString()
    });
    const response = await fetch(url, {
        method: 'DELETE',
        headers
    });
    const bodyText = await response.text();
    let body = {};
    try { body = bodyText ? JSON.parse(bodyText) : {}; } catch { body = { raw: bodyText }; }
    console.info('[VAULT-DELETE-TRACE] deleteReelById:response', {
        status: response.status,
        ok: response.ok,
        body,
        ts: new Date().toISOString()
    });
    if (!response.ok) {
        throw new Error(body.error || `Delete reel failed (${response.status})`);
    }
    return body.success !== undefined ? body : { success: true, id, ...body };
}

/**
 * GET /api/reels — ready catalog.
 * @param {RequestInit['headers']} [headers]
 */
export async function fetchReadyReels(headers = {}) {
    const response = await fetch(`${API_BASE_URL}/api/reels`, { headers });
    if (!response.ok) {
        throw new Error(`Fetch reels failed (${response.status})`);
    }
    const body = await response.json().catch(() => []);
    const raw = Array.isArray(body) ? body : [];

    // Normalize server payloads
    let normalized = [];
    let readyCount = 0;
    try {
        normalized = normalizeReels(raw, 'GET /api/reels');
        if (Array.isArray(normalized) && normalized.length > 0) {
            // Check if any reels are "ready" (status=ready or readiness>=100)
            readyCount = normalized.filter(r => 
                r.status === 'ready' || r.readiness >= 100
            ).length;
            
            if (readyCount === 0) {
                // No ready reels → inject demo placeholders for demo/sharing
                const demo = getDemoPlaceholders().map((p) =>
                    createLocalReel({
                        id: p.id,
                        name: p.title,
                        title: p.title,
                        url: p.thumbnail,
                        thumbnailUrl: p.thumbnail,
                        category: p.series,
                        status: 'ready',
                        readiness: 100,
                        isPlaceholder: true
                    })
                );
                return demo;
            }
            return normalized;
        }
    } catch (e) {
        // ignore normalization errors and fall through to demo placeholders
    }

    // Fallback: inject 3 demo placeholders when API returns no usable reels
    console.log('[DEMO_FALLBACK_TRIGGERED]', {
        reason: readyCount === 0 ? 'no-ready-reels' : 'empty-or-error',
        rawCount: raw.length,
        normalizedCount: normalized?.length || 0,
        demoCount: 3,
        timestamp: new Date().toISOString()
    });
    const demo = getDemoPlaceholders().map((p) =>
        createLocalReel({
            id: p.id,
            name: p.title,
            title: p.title,
            url: p.thumbnail,
            thumbnailUrl: p.thumbnail,
            category: p.series,
            status: 'ready',
            readiness: 100,
            isPlaceholder: true
        })
    );
    return demo;
}

/**
 * GET /api/media/cleanup/orphans — preview thumb/video files not referenced in reels.
 * @param {RequestInit['headers']} [headers]
 */
export async function previewOrphanMedia(headers = {}) {
    const response = await fetch(`${API_BASE_URL}/api/media/cleanup/orphans`, { headers });
    if (!response.ok) {
        throw new Error(`Orphan preview failed (${response.status})`);
    }
    return response.json();
}

/**
 * POST /api/media/cleanup/orphans?confirm=true — delete unreferenced files (+ fake .mp4.jpg thumbs).
 * @param {RequestInit['headers']} [headers]
 */
export async function cleanupOrphanMedia(headers = {}) {
    const response = await fetch(
        `${API_BASE_URL}/api/media/cleanup/orphans?confirm=true`,
        { method: 'POST', headers }
    );
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Orphan cleanup failed (${response.status})`);
    }
    return response.json();
}

/**
 * PATCH /api/reels/{id}/category — reassign shelf category for an existing reel.
 * @param {string} reelId
 * @param {string} category
 * @param {Record<string, string>} [headers]
 * @returns {Promise<{ id: string; category: string; updated: boolean }>}
 */
export async function patchReelCategory(reelId, category, headers = {}) {
    const response = await fetchWithRetry(`${API_BASE_URL}/api/reels/${reelId}/category`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            ...headers
        },
        body: JSON.stringify({ category })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Category update failed (${response.status})`);
    }
    return response.json();
}

export const MEDIA_API = {
    createReel,
    upload: uploadMedia,
    uploadThumbnail,
    uploadVideo,
    deleteReelById,
    fetchReadyReels,
    patchReelCategory,
    validate: validateMedia,
    storage: fetchMediaStorage,
    deleteFile: deleteMediaFile,
    previewOrphans: previewOrphanMedia,
    cleanupOrphans: cleanupOrphanMedia
};
