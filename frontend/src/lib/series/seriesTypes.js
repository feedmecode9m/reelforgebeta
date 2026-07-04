/**
 * Series metadata layer — types and lightweight validators (mock phase).
 * Does not modify reel payloads; episodes link to existing reels via `reelId`.
 */

/** @typedef {'draft' | 'ready' | 'published' | 'archived'} EpisodeStatus */

/** @type {readonly EpisodeStatus[]} */
export const EPISODE_STATUSES = /** @type {const} */ (['draft', 'ready', 'published', 'archived']);

/**
 * @typedef {Object} Episode
 * @property {string} episodeId - Stable episode identifier (series metadata)
 * @property {number} episodeNumber - 1-based position within the season
 * @property {string} title
 * @property {string} [description]
 * @property {number} [runtime] - Duration in seconds
 * @property {EpisodeStatus} status
 * @property {string | null} [reelId] - Optional link to an existing feed/vault reel
 * @property {string} [genre]
 * @property {string[]} [tags]
 */

/**
 * @typedef {Object} Season
 * @property {string} [seasonId] - Optional stable season identifier
 * @property {number} seasonNumber - 1-based season index
 * @property {string} [title]
 * @property {string} [description]
 * @property {Episode[]} episodes
 */

/**
 * @typedef {Object} Series
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} [poster] - Poster/thumbnail path or URL (resolved at UI layer)
 * @property {string} [genre]
 * @property {number} [releaseYear]
 * @property {string[]} [tags]
 * @property {Season[]} seasons
 */

/** @param {unknown} value */
export function isEpisodeStatus(value) {
    return typeof value === 'string' && EPISODE_STATUSES.includes(/** @type {EpisodeStatus} */ (value));
}

/** @param {unknown} episode */
export function isEpisode(episode) {
    if (!episode || typeof episode !== 'object') return false;
    const e = /** @type {Episode} */ (episode);
    return (
        typeof e.episodeId === 'string' &&
        Number.isFinite(e.episodeNumber) &&
        e.episodeNumber >= 1 &&
        typeof e.title === 'string' &&
        isEpisodeStatus(e.status)
    );
}

/** @param {unknown} season */
export function isSeason(season) {
    if (!season || typeof season !== 'object') return false;
    const s = /** @type {Season} */ (season);
    return Number.isFinite(s.seasonNumber) && s.seasonNumber >= 1 && Array.isArray(s.episodes) && s.episodes.every(isEpisode);
}

/** @param {unknown} series */
export function isSeries(series) {
    if (!series || typeof series !== 'object') return false;
    const s = /** @type {Series} */ (series);
    return typeof s.id === 'string' && typeof s.title === 'string' && Array.isArray(s.seasons) && s.seasons.every(isSeason);
}

/**
 * @param {Episode} episode
 * @returns {boolean}
 */
export function episodeHasReel(episode) {
    return typeof episode?.reelId === 'string' && episode.reelId.length > 0;
}

/**
 * @param {Episode} episode
 * @returns {boolean}
 */
export function episodeIsPlayable(episode) {
    return episodeIsPublished(episode) && episodeHasReel(episode);
}

/**
 * @param {Episode} episode
 * @returns {boolean}
 */
export function episodeIsPublished(episode) {
    return episode?.status === 'published' || episode?.status === 'ready';
}
