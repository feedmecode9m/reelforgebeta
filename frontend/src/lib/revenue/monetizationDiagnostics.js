/**
 * Phase 42 — Monetization intelligence diagnostics.
 */

/** @typedef {'MONETIZATION_ANALYSIS' | 'MONETIZATION_RECOMMENDATION' | 'MONETIZATION_OPPORTUNITY' | 'MONETIZATION_FORECAST'} MonetizationDiagTag */

/**
 * @param {MonetizationDiagTag} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logMonetizationDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}
