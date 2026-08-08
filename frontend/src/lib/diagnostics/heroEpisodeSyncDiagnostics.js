/**
 * Diagnostics for Hero Manager → series episode metadata synchronization.
 */

/**
 * @param {Record<string, unknown>} detail
 */
export function logHeroEpisodeSync(detail = {}) {
    console.info(
        '[HERO_EPISODE_SYNC]',
        JSON.stringify({
            reelId: detail.reelId || null,
            oldTitle: detail.oldTitle || '',
            newTitle: detail.newTitle || '',
            source: detail.source || 'creator',
            episodeId: detail.episodeId || null,
            seriesId: detail.seriesId || null,
            updated: detail.updated === true,
            timestamp: Date.now()
        })
    );
}
