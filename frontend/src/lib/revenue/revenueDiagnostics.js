/**
 * Phase 39 — Revenue diagnostics for Creator OS financial foundation.
 */

/** @typedef {'REVENUE_PROFILE' | 'REVENUE_ESTIMATE' | 'REVENUE_FORECAST' | 'REVENUE_DASHBOARD' | 'REVENUE_KPI' | 'REVENUE_CORE' | 'REVENUE_SYNC' | 'REVENUE_API'} RevenueDiagTag */

/**
 * @param {RevenueDiagTag} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logRevenueDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}
