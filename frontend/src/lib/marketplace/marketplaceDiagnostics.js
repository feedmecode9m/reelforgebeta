/**
 * Phase 40 — Creator marketplace diagnostics.
 */

/** @typedef {'MARKETPLACE_LISTING' | 'MARKETPLACE_MATCH' | 'MARKETPLACE_REVIEW' | 'MARKETPLACE_CREATE' | 'MARKETPLACE_UPDATE' | 'MARKETPLACE_EDIT' | 'MARKETPLACE_DELETE' | 'MARKETPLACE_APPLY' | 'MARKETPLACE_SEARCH'} MarketplaceDiagTag */

/**
 * @param {MarketplaceDiagTag} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logMarketplaceDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}
