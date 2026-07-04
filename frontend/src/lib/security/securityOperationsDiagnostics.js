/**
 * Phase 43 — Security Operations Center diagnostics.
 */

/** @typedef {'SECURITY_INCIDENT' | 'SOC_ALERT' | 'SOC_SCORE' | 'SOC_TIMELINE'} SocDiagTag */

/**
 * @param {SocDiagTag} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logSocDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}
