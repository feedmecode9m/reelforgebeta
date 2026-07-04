/** @typedef {Object} PlatformProfileConfig
 * @property {string} name
 * @property {string} icon
 * @property {string} aspect
 * @property {string} primaryColor
 * @property {string} requirementBadge
 * @property {string} previewVariant
 * @property {string[]} queuePlaceholders
 */

/** @type {Record<string, PlatformProfileConfig>} */
export const PLATFORM_PROFILES = {
    youtube: {
        name: 'YouTube',
        icon: '▶️',
        aspect: '16:9',
        primaryColor: '#FF0000',
        requirementBadge: '16:9 landscape required',
        previewVariant: 'youtube',
        queuePlaceholders: ['Episode 01 — awaiting upload', 'Trailer cut — draft']
    },
    tiktok: {
        name: 'TikTok',
        icon: '🎵',
        aspect: '9:16',
        primaryColor: '#000000',
        requirementBadge: '9:16 vertical required',
        previewVariant: 'tiktok',
        queuePlaceholders: ['Hook clip — 15s', 'Full episode — part 1']
    },
    instagram: {
        name: 'Instagram',
        icon: '📸',
        aspect: '1:1|4:5|16:9',
        primaryColor: '#E4405F',
        requirementBadge: '1:1, 4:5, or 16:9',
        previewVariant: 'instagram',
        queuePlaceholders: ['Reel — vertical', 'Feed post — square']
    },
    facebook: {
        name: 'Facebook',
        icon: '📘',
        aspect: '16:9',
        primaryColor: '#1877F2',
        requirementBadge: '16:9 recommended',
        previewVariant: 'facebook',
        queuePlaceholders: ['Watch episode — scheduled', 'Page preview — draft']
    },
    linkedin: {
        name: 'LinkedIn',
        icon: '🔗',
        aspect: '16:9',
        primaryColor: '#0A66C2',
        requirementBadge: '16:9 professional video',
        previewVariant: 'linkedin',
        queuePlaceholders: ['Company update — video', 'Documentary clip — review']
    },
    x: {
        name: 'X',
        icon: '🐦',
        aspect: '16:9',
        primaryColor: '#000000',
        requirementBadge: '16:9 or 1:1 clip',
        previewVariant: 'x',
        queuePlaceholders: ['Post with video — queued', 'Thread teaser — draft']
    }
};

export const PLATFORM_PROFILE_ORDER = ['youtube', 'tiktok', 'instagram', 'facebook', 'linkedin', 'x'];

/** @param {string} aspectSpec e.g. "9:16" or "1:1|4:5" */
export function primaryAspectRatio(aspectSpec) {
    const first = String(aspectSpec || '16:9').split('|')[0].trim();
    const [w, h] = first.split(':').map(Number);
    if (!w || !h) return '16 / 9';
    return `${w} / ${h}`;
}

/** @param {string} platformId */
export function getPlatformProfile(platformId) {
    return PLATFORM_PROFILES[platformId] || null;
}
