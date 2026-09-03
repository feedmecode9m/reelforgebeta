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
 * @property {number} episodeNumber - 1-based creator label within the season (not display sort key)
 * @property {number} [displayOrder] - Creator-controlled shelf order (0-based). Sort key for viewer/creator lists.
 * @property {string} title
 * @property {string} [description]
 * @property {number} [runtime] - Duration in seconds
 * @property {EpisodeStatus} status
 * @property {string | null} [reelId] - Optional link to an existing feed/vault reel
 * @property {string} [thumbnailUrl] - Canonical episode poster URL (API episodes.thumbnail_url)
 * @property {string | null} [thumbnailAssetId] - Hero Vault ready image/poster asset id
 * @property {string | null} [mediaAssetId] - Hero Vault ready playable media asset id
 * @property {string[]} [aliases] - Alternate titles for Hero Vault matching
 * @property {string | null} [heroVaultAssetId] - Optional manual Hero Vault ready asset override
 * @property {'manual' | 'auto' | null} [heroVaultBindingMode] - How media is selected for this episode
 * @property {string} [genre]
 * @property {string[]} [tags]
 * @property {string} [publishedAt] - ISO timestamp when status became published
 */

/**
 * @typedef {Object} Season
 * @property {string} [seasonId] - Optional stable season identifier
 * @property {number} seasonNumber - 1-based season index
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [poster] - Season artwork URL/path
 * @property {Episode[]} episodes
 */

/**
 * @typedef {Object} Series
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} [poster] - Series poster/thumbnail path or URL
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
 * Hero Vault media bind present (Ready state authority).
 * @param {Episode | null | undefined} episode
 * @returns {boolean}
 */
export function episodeHasMediaAsset(episode) {
    return typeof episode?.mediaAssetId === 'string' && episode.mediaAssetId.trim().length > 0;
}

/**
 * @param {Episode | null | undefined} episode
 * @returns {boolean}
 */
export function episodeHasThumbnailAsset(episode) {
    return (
        typeof episode?.thumbnailAssetId === 'string' && episode.thumbnailAssetId.trim().length > 0
    );
}

/**
 * Episode is Ready only when a Hero Vault mediaAssetId is bound.
 * @param {Episode | null | undefined} episode
 * @returns {boolean}
 */
export function episodeIsReadyBound(episode) {
    return episodeHasMediaAsset(episode);
}

/**
 * @param {Episode} episode
 * @returns {boolean}
 */
export function episodeIsPlayable(episode) {
    if (!episode) return false;
    // Prefer Hero Vault media bind — Ready episodes open Theater from vault asset.
    if (episodeHasMediaAsset(episode)) {
        return episode.status !== 'draft' && episode.status !== 'archived';
    }
    return episodeIsPublished(episode) && episodeHasReel(episode);
}

/**
 * True when episode may appear in viewer discovery / series page lists.
 * (Ready is creator preview only — not publicly discoverable.)
 * @param {Episode} episode
 * @returns {boolean}
 */
export function episodeIsPublished(episode) {
    return episode?.status === 'published';
}

/**
 * @param {Episode} episode
 * @returns {boolean}
 */
export function episodeIsPubliclyPlayable(episode) {
    return episodeIsPublished(episode) && (episodeHasMediaAsset(episode) || episodeHasReel(episode));
}
