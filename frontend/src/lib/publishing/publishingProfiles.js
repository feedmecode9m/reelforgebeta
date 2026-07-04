/**
 * Publishing profile definitions — single source of truth for presentation behavior.
 * All profiles consume the same series metadata from seriesStore.js.
 */

/** @typedef {'netflix' | 'reelshort' | 'dramabox' | 'youtube-series'} PublishingProfileId */

/**
 * @typedef {Object} MetadataDisplayConfig
 * @property {boolean} showReelTitle
 * @property {boolean} showBadge
 * @property {boolean} showEpisodeTitle
 * @property {boolean} showRuntime
 * @property {boolean} showGenre
 * @property {boolean} showTags
 * @property {'compact' | 'standard' | 'rich'} layout
 */

/**
 * @typedef {Object} EpisodeNavigationConfig
 * @property {boolean} showEpisodesButton
 * @property {boolean} swipeUpNext
 * @property {boolean} showCountdown
 * @property {'drawer' | 'swipe' | 'drawer-swipe' | 'playlist'} mode
 * @property {string} episodesButtonLabel
 */

/**
 * @typedef {Object} TheaterChromeConfig
 * @property {boolean} immersive916
 * @property {boolean} ambientBlur
 * @property {boolean} verticalTimeline
 * @property {boolean} progressRing
 * @property {boolean} hideMetaPanel
 * @property {boolean} hideBottomClose
 * @property {'smart' | 'fill' | 'fit'} defaultFraming
 * @property {string} aspectRatio
 * @property {string} primaryColor
 */

/**
 * @typedef {Object} PublishingProfile
 * @property {PublishingProfileId} id
 * @property {string} label
 * @property {string} icon
 * @property {string} description
 * @property {MetadataDisplayConfig} metadataDisplay
 * @property {EpisodeNavigationConfig} episodeNavigation
 * @property {TheaterChromeConfig} theaterChrome
 */

/** @type {Record<PublishingProfileId, PublishingProfile>} */
export const PUBLISHING_PROFILES = {
    netflix: {
        id: 'netflix',
        label: 'Netflix Style',
        icon: '🎬',
        description: 'Widescreen binge layout with full metadata and episode drawer.',
        metadataDisplay: {
            showReelTitle: true,
            showBadge: true,
            showEpisodeTitle: true,
            showRuntime: true,
            showGenre: true,
            showTags: true,
            layout: 'standard'
        },
        episodeNavigation: {
            showEpisodesButton: true,
            swipeUpNext: false,
            showCountdown: false,
            mode: 'drawer',
            episodesButtonLabel: 'Episodes'
        },
        theaterChrome: {
            immersive916: false,
            ambientBlur: false,
            verticalTimeline: false,
            progressRing: false,
            hideMetaPanel: false,
            hideBottomClose: false,
            defaultFraming: 'smart',
            aspectRatio: '16 / 9',
            primaryColor: '#e50914'
        }
    },
    reelshort: {
        id: 'reelshort',
        label: 'ReelShort Style',
        icon: '📱',
        description: 'Vertical micro-drama with swipe-up episodes and immersive chrome.',
        metadataDisplay: {
            showReelTitle: false,
            showBadge: true,
            showEpisodeTitle: true,
            showRuntime: false,
            showGenre: false,
            showTags: false,
            layout: 'compact'
        },
        episodeNavigation: {
            showEpisodesButton: true,
            swipeUpNext: true,
            showCountdown: true,
            mode: 'drawer-swipe',
            episodesButtonLabel: 'Episodes'
        },
        theaterChrome: {
            immersive916: true,
            ambientBlur: true,
            verticalTimeline: true,
            progressRing: true,
            hideMetaPanel: true,
            hideBottomClose: true,
            defaultFraming: 'smart',
            aspectRatio: '9 / 16',
            primaryColor: '#00f2ff'
        }
    },
    dramabox: {
        id: 'dramabox',
        label: 'DramaBox Style',
        icon: '🎭',
        description: 'Vertical drama with drawer plus swipe and countdown autoplay.',
        metadataDisplay: {
            showReelTitle: false,
            showBadge: true,
            showEpisodeTitle: true,
            showRuntime: true,
            showGenre: true,
            showTags: false,
            layout: 'compact'
        },
        episodeNavigation: {
            showEpisodesButton: true,
            swipeUpNext: true,
            showCountdown: true,
            mode: 'drawer-swipe',
            episodesButtonLabel: 'All Episodes'
        },
        theaterChrome: {
            immersive916: true,
            ambientBlur: true,
            verticalTimeline: true,
            progressRing: true,
            hideMetaPanel: true,
            hideBottomClose: true,
            defaultFraming: 'smart',
            aspectRatio: '9 / 16',
            primaryColor: '#ff6b35'
        }
    },
    'youtube-series': {
        id: 'youtube-series',
        label: 'YouTube Series Style',
        icon: '▶️',
        description: 'Playlist-style series with rich metadata and episode browser.',
        metadataDisplay: {
            showReelTitle: true,
            showBadge: true,
            showEpisodeTitle: true,
            showRuntime: true,
            showGenre: true,
            showTags: true,
            layout: 'rich'
        },
        episodeNavigation: {
            showEpisodesButton: true,
            swipeUpNext: false,
            showCountdown: false,
            mode: 'playlist',
            episodesButtonLabel: 'All Episodes'
        },
        theaterChrome: {
            immersive916: false,
            ambientBlur: false,
            verticalTimeline: false,
            progressRing: false,
            hideMetaPanel: false,
            hideBottomClose: false,
            defaultFraming: 'fit',
            aspectRatio: '16 / 9',
            primaryColor: '#ff0000'
        }
    }
};

export const PUBLISHING_PROFILE_ORDER = /** @type {PublishingProfileId[]} */ ([
    'netflix',
    'reelshort',
    'dramabox',
    'youtube-series'
]);

export const DEFAULT_PUBLISHING_PROFILE = /** @type {PublishingProfileId} */ ('netflix');

/** @param {string | null | undefined} id */
export function normalizePublishingProfileId(id) {
    return id && PUBLISHING_PROFILES[/** @type {PublishingProfileId} */ (id)]
        ? /** @type {PublishingProfileId} */ (id)
        : DEFAULT_PUBLISHING_PROFILE;
}

/** @param {PublishingProfileId | string} id */
export function getPublishingProfile(id) {
    return PUBLISHING_PROFILES[normalizePublishingProfileId(id)];
}
