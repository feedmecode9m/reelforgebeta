/**
 * Phase 47 — Next episode card navigation diagnostics.
 */

/**
 * @param {'NEXT_EPISODE_CLICK' | 'NEXT_EPISODE_NAVIGATE'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logNextEpisodeDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}
