/**
 * Homepage hero Watch Now / Learn More — play the featured MP4 or open its story.
 * Campaign CTA targets in Hero Manager still override when set.
 */

import { heroReelToVaultItem, resolveActiveHeroVideoReel } from './heroReelIdentity.js';
import { presentLaProductionEpisode } from '../series/laProductionEpisodeGuide.js';
import { resolveRelatedEpisodes } from '../series/resolveRelatedEpisodes.js';

export { resolveHeroCtaIntent, sanitizeHeroCtaTarget } from './heroCtaIntent.js';

/**
 * @param {unknown} row
 * @param {string} id
 */
function rowMatchesId(row, id) {
    if (!row || typeof row !== 'object' || !id) return false;
    return String(/** @type {Record<string, unknown>} */ (row).id || '').trim() === id;
}

/**
 * Featured hero background MP4 as a theater-ready reel, or null.
 *
 * @param {{ feedReels?: unknown[]; personalVideos?: unknown[] }} [options]
 */
export function resolveHeroFeaturedWatchReel(options = {}) {
    const hero = resolveActiveHeroVideoReel();
    if (!hero?.id || !hero?.url) return null;
    const id = String(hero.id).trim();
    const pools = [
        ...(Array.isArray(options.feedReels) ? options.feedReels : []),
        ...(Array.isArray(options.personalVideos) ? options.personalVideos : [])
    ];
    const match = pools.find((row) => rowMatchesId(row, id));
    if (match && typeof match === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (match);
        return {
            ...rec,
            ...heroReelToVaultItem(hero),
            url: hero.url || rec.url || rec.playbackUrl || rec.mediaUrl,
            playbackUrl: rec.playbackUrl || rec.url || hero.url,
            mediaUrl: rec.mediaUrl || rec.url || hero.url,
            title: rec.title || rec.name || hero.name,
            name: rec.name || hero.name,
            type: rec.type || hero.type || 'video/mp4'
        };
    }
    return {
        ...heroReelToVaultItem(hero),
        title: hero.name,
        playbackUrl: hero.url,
        mediaUrl: hero.url
    };
}

/**
 * @param {unknown} reel
 * @param {unknown[]} [readyAssets]
 */
export function countHeroRelatedMembers(reel, readyAssets) {
    if (!reel) return 0;
    const related = resolveRelatedEpisodes(reel, {
        readyAssets: Array.isArray(readyAssets) ? readyAssets : []
    });
    return Array.isArray(related?.members) ? related.members.length : 0;
}

/**
 * @param {unknown} reel
 */
export function heroFeaturedGuideActive(reel) {
    if (!reel) return false;
    const rec = /** @type {Record<string, unknown>} */ (reel);
    const presented = presentLaProductionEpisode({
        episode: reel,
        title: rec.title || rec.name,
        fileName: rec.fileName || rec.file_name || rec.url || rec.mediaUrl,
        currentTitle: rec.title || rec.name
    });
    return Boolean(presented.active && (presented.title || presented.description));
}

/**
 * @param {unknown} reel
 */
export function heroFeaturedGuideCopy(reel) {
    if (!reel) return '';
    const rec = /** @type {Record<string, unknown>} */ (reel);
    const presented = presentLaProductionEpisode({
        episode: reel,
        title: rec.title || rec.name,
        fileName: rec.fileName || rec.file_name || rec.url || rec.mediaUrl,
        currentTitle: rec.title || rec.name
    });
    return String(presented.description || '').trim();
}
