/**
 * Episode asset management diagnostics (Phase 7A).
 */

/**
 * @param {'EPISODE_ASSET_AUDIT' | 'EPISODE_ATTACH' | 'EPISODE_DETACH'} tag
 * @param {Record<string, unknown>} payload
 */
export function logEpisodeAssetDiag(tag, payload) {
    console.log(`[${tag}] ${JSON.stringify({ ...payload, timestamp: Date.now() })}`);
}
