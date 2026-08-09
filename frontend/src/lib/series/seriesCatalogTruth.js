/**
 * Creator-truth helpers for series catalog display and demo boundaries.
 *
 * Authoritative public counts / poster resolution belong to Creator Truth.
 * Demo series IDs are blocked via isDemoSeriesId / stripDemoSeriesFromCatalog.
 *
 * @see ../architecture/creatorTruthLayers.js
 */

/** Hard fixture series ids shipped in mockSeriesData.js */
export const DEMO_SERIES_IDS = Object.freeze([
    'series-neon-vengeance',
    'series-vault-chronicles',
    'series-trending-shorts'
]);

/** Hard fixture episode titles from Neon Vengeance demo — never public truth. */
export const DEMO_EPISODE_TITLES = Object.freeze([
    'Ghost in the Grid',
    'Blood Protocol',
    'Midnight Firewall',
    'Zero Day',
    'After the Breach',
    'Corporate Eclipse'
]);

/**
 * Counts derived strictly from series.seasons[].episodes[].
 * @param {import('./seriesTypes.js').Series | null | undefined} series
 * @param {(episode: import('./seriesTypes.js').Episode) => boolean} [isPlayable]
 */
export function seriesCatalogCounts(series, isPlayable) {
    if (!series || !Array.isArray(series.seasons)) {
        return { seasonCount: 0, episodeCount: 0, playableCount: 0 };
    }
    const seasons = series.seasons.filter(
        (s) => s && Array.isArray(s.episodes) && s.episodes.length > 0
    );
    let episodeCount = 0;
    let playableCount = 0;
    for (const season of series.seasons) {
        const eps = Array.isArray(season?.episodes) ? season.episodes : [];
        episodeCount += eps.length;
        if (typeof isPlayable === 'function') {
            for (const ep of eps) {
                if (isPlayable(ep)) playableCount += 1;
            }
        }
    }
    return {
        seasonCount: seasons.length || (episodeCount > 0 ? series.seasons.length : 0),
        episodeCount,
        playableCount
    };
}

/**
 * Synthetic blurbs written by inference (not creator-authored).
 * @param {unknown} description
 */
export function isSyntheticSeriesDescription(description) {
    const d = String(description || '').trim();
    if (!d) return true;
    if (/^vault-inferred series:/i.test(d)) return true;
    if (/^featured series spotlight$/i.test(d)) return true;
    return false;
}

/**
 * Public-facing description only when creator (or studio) set real copy.
 * @param {unknown} description
 */
export function creatorFacingDescription(description) {
    if (isSyntheticSeriesDescription(description)) return '';
    return String(description || '').trim();
}

/**
 * Genre label only when series/episode actually carries one (no presets).
 * @param {unknown} genre
 */
export function creatorFacingGenre(genre) {
    return String(genre || '').trim();
}

/**
 * Demo catalog ids that must never ship as production/public series truth.
 * @param {string | null | undefined} seriesId
 */
export function isDemoSeriesId(seriesId) {
    const id = String(seriesId || '').trim().toLowerCase();
    return DEMO_SERIES_IDS.includes(id);
}

/**
 * @param {string | null | undefined} title
 */
export function isDemoEpisodeTitle(title) {
    const t = String(title || '').trim().toLowerCase();
    if (!t) return false;
    return DEMO_EPISODE_TITLES.some((d) => d.toLowerCase() === t);
}

/**
 * Remove demo/fixture series from a catalog payload.
 * Production and public lookup always use this; tests that load mock fixtures
 * do so only via seriesStore.resetSeriesCatalogToMock() (opt-in session flag).
 *
 * @param {import('./seriesTypes.js').Series[] | null | undefined} items
 * @returns {import('./seriesTypes.js').Series[]}
 */
export function stripDemoSeriesFromCatalog(items) {
    if (!Array.isArray(items)) return [];
    return items.filter((s) => s && !isDemoSeriesId(s.id));
}

/**
 * Whether a catalog (still) contains known demo episode titles.
 * @param {import('./seriesTypes.js').Series[] | null | undefined} items
 */
export function catalogHasDemoEpisodeTitles(items) {
    if (!Array.isArray(items)) return false;
    for (const series of items) {
        if (isDemoSeriesId(series?.id)) return true;
        for (const season of series?.seasons || []) {
            for (const ep of season?.episodes || []) {
                if (isDemoEpisodeTitle(ep?.title)) return true;
            }
        }
    }
    return false;
}

/**
 * Poster priority for public series surfaces:
 * 1. Creator / series.poster when set
 * 2. First ready vault episode thumbnail
 * 3. Neutral placeholder
 *
 * @param {{
 *   seriesPoster?: string | null;
 *   episodeThumbnails?: Array<string | null | undefined>;
 *   placeholder?: string;
 * }} options
 */
export function resolveSeriesPosterSrc(options = {}) {
    const seriesPoster = String(options.seriesPoster || '').trim();
    if (seriesPoster) return seriesPoster;
    for (const t of options.episodeThumbnails || []) {
        const u = String(t || '').trim();
        if (u) return u;
    }
    return String(options.placeholder || '').trim() || '';
}
