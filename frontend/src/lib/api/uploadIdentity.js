/**
 * Upload episode identity — optional catalog binding for create/finalize payloads.
 * Diagnostics only; no title/filename guessing.
 */

/**
 * @typedef {Object} UploadIdentity
 * @property {string} [episodeId]
 * @property {string} [seriesId]
 * @property {string} [seasonId]
 * @property {string} [source]
 */

/**
 * @param {UploadIdentity | Record<string, unknown> | null | undefined} fields
 * @returns {{ episodeId?: string; seriesId?: string; seasonId?: string; source: string }}
 */
export function resolveUploadIdentity(fields = {}) {
    const episodeId = String(fields.episodeId || fields.episode_id || '').trim();
    const seriesId = String(fields.seriesId || fields.series_id || '').trim();
    const seasonId = String(fields.seasonId || fields.season_id || '').trim();
    const source = String(fields.source || 'upload').trim() || 'upload';
    return {
        ...(episodeId ? { episodeId } : {}),
        ...(seriesId ? { seriesId } : {}),
        ...(seasonId ? { seasonId } : {}),
        source
    };
}

/**
 * @param {FormData} formData
 * @param {UploadIdentity | Record<string, unknown>} identity
 */
export function appendUploadIdentityToFormData(formData, identity = {}) {
    const resolved = resolveUploadIdentity(identity);
    if (resolved.episodeId) formData.append('episodeId', resolved.episodeId);
    if (resolved.seriesId) formData.append('seriesId', resolved.seriesId);
    if (resolved.seasonId) formData.append('seasonId', resolved.seasonId);
    return resolved;
}

/**
 * @param {{
 *   uploadId?: string | null;
 *   reelId?: string | null;
 *   episodeId?: string | null;
 *   seriesId?: string | null;
 *   source?: string;
 *   stage?: string;
 * }} payload
 */
export function logAssetIdentityBind(payload) {
    console.info('[ASSET_IDENTITY_BIND]', {
        uploadId: payload.uploadId || '',
        reelId: payload.reelId || '',
        episodeId: payload.episodeId || '',
        seriesId: payload.seriesId || '',
        source: payload.source || 'upload',
        stage: payload.stage || 'bind',
        ts: new Date().toISOString()
    });
}

/**
 * @param {Record<string, unknown>} meta
 * @returns {ReturnType<typeof resolveUploadIdentity>}
 */
export function uploadIdentityFromMeta(meta = {}) {
    return resolveUploadIdentity({
        episodeId: meta.episodeId,
        seriesId: meta.seriesId,
        seasonId: meta.seasonId,
        source: meta.identitySource || meta.source || 'upload_meta'
    });
}
