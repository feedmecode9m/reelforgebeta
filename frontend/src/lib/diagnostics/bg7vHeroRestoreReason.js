/** BG-7V — Hero restore branch reason codes (instrumentation only, no behavior changes). */

/** @typedef {'NO_HERO_ID' | 'NO_CATALOG_MATCH' | 'INVALID_REEL' | 'INVALID_URL' | 'SAVE_REJECTED' | 'SAVE_EXCEPTION' | 'CONFIG_MISMATCH' | 'RESTORE_SUCCESS' | 'ALREADY_PRESENT'} HeroRestoreReason */

/**
 * @param {{
 *   heroAssetId?: string;
 *   matchedReelId?: string | null;
 *   restoreAttempted?: boolean;
 *   restored?: boolean;
 *   reason: HeroRestoreReason;
 *   detail?: unknown;
 * }} payload
 */
export function logBg7vHeroRestoreReason(payload) {
    console.info('[BG7V_HERO_RESTORE_REASON]', {
        heroAssetId: payload.heroAssetId || '',
        matchedReelId: payload.matchedReelId ?? null,
        restoreAttempted: payload.restoreAttempted === true,
        restored: payload.restored === true,
        reason: payload.reason,
        detail: payload.detail ?? null,
        timestamp: new Date().toISOString()
    });
}
