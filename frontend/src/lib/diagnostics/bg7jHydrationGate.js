/** BG-7J — temporary hero hydration gate verification (remove after validation). */

/**
 * @param {boolean} ready
 * @param {number} personalVideosCount
 */
export function logBg7jHydrationReady(ready, personalVideosCount) {
    console.info('[BG7J_HYDRATION_READY]', {
        ready,
        personalVideosCount,
        timestamp: new Date().toISOString()
    });
}

/**
 * @param {boolean} hydrationReady
 * @param {'waiting' | 'resolved'} action
 */
export function logBg7jHeroGate(hydrationReady, action) {
    console.info('[BG7J_HERO_GATE]', {
        hydrationReady,
        action,
        timestamp: new Date().toISOString()
    });
}

/**
 * @param {string} heroAssetId
 * @param {boolean} restored
 * @param {string | null} matchedReelId
 */
export function logBg7jHeroRestore(heroAssetId, restored, matchedReelId) {
    console.info('[BG7J_HERO_RESTORE]', {
        heroAssetId: heroAssetId || '',
        restored,
        matchedReelId: matchedReelId || null,
        timestamp: new Date().toISOString()
    });
}
