/**
 * Publishing lifecycle — viewer discoverability rules.
 *
 * draft     → creator only, hidden from viewers
 * ready     → creator preview, not publicly discoverable
 * published → viewer visible + playable + recommended
 * archived  → removed from discovery (deep progress may remain)
 *
 * Does not change playback ownership or derivative selection.
 */

/**
 * Viewer-facing discovery / series page / recommendations.
 * @param {import('./seriesTypes.js').Episode | null | undefined} episode
 */
export function episodeIsViewerDiscoverable(episode) {
    return episode?.status === 'published';
}

/**
 * Creator preview / bound theater play (ready + published with media).
 * @param {import('./seriesTypes.js').Episode | null | undefined} episode
 */
export function episodeIsCreatorPreviewable(episode) {
    if (!episode) return false;
    if (episode.status === 'draft' || episode.status === 'archived') return false;
    return episode.status === 'ready' || episode.status === 'published';
}

/**
 * @param {import('./seriesTypes.js').Episode[]} episodes
 * @param {{ viewerMode?: boolean }} [options]
 */
export function filterEpisodesForAudience(episodes, options = {}) {
    const list = Array.isArray(episodes) ? episodes : [];
    if (options.viewerMode === false) return list;
    return list.filter((ep) => episodeIsViewerDiscoverable(ep));
}

/**
 * @param {import('./seriesTypes.js').Series | null | undefined} series
 * @param {{ viewerMode?: boolean }} [options]
 */
export function filterSeriesSeasonsForAudience(series, options = {}) {
    if (!series) return series;
    const seasons = (series.seasons || []).map((season) => ({
        ...season,
        episodes: filterEpisodesForAudience(season.episodes || [], options)
    })).filter((s) => (s.episodes || []).length > 0 || options.viewerMode === false);
    return { ...series, seasons };
}
