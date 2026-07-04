/**
 * Production operations diagnostics (Phase 7B).
 */

/**
 * @param {'PRODUCTION_HEALTH' | 'SERIES_READINESS' | 'MISSING_ASSET_QUEUE'} tag
 * @param {Record<string, unknown>} payload
 */
export function logProductionDiag(tag, payload) {
    console.log(`[${tag}] ${JSON.stringify({ ...payload, timestamp: Date.now() })}`);
}
