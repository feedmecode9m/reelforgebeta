/**
 * Episode navigation bridge diagnostics.
 */

/**
 * @param {'EPISODE_BRIDGE' | 'EPISODE_NAV' | 'NEXT_EPISODE' | 'DRAWER_SELECT' | 'SWIPE_NAV'} tag
 * @param {Record<string, unknown>} payload
 */
export function logEpisodeBridgeDiag(tag, payload) {
    console.log(`[${tag}] ${JSON.stringify({ ...payload, timestamp: Date.now() })}`);
}
