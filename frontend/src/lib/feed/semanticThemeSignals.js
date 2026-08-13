/**
 * Semantic theme / content-type extraction — separate from shelf category.
 * Suggestion-only; never invents titles/descriptions or PATCHes shelves.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function hay(value) {
    return text(value).toLowerCase();
}

/** @type {ReadonlyArray<{ theme: string; contentType?: string; patterns: RegExp[] }>} */
const THEME_RULES = Object.freeze([
    {
        theme: 'behind-the-scenes',
        contentType: 'behind-the-scenes',
        patterns: [/behind[\s_-]*the[\s_-]*scenes?/i, /\bbts\b/i, /soundstage/i, /set[\s_-]*shoot/i]
    },
    {
        theme: 'production',
        contentType: 'production',
        patterns: [/production/i, /\bmicros\b/i, /open[\s_-]*v\d/i, /arrival[\s_-]*open/i, /amp[\s_-]*jam/i]
    },
    {
        theme: 'music',
        contentType: 'music',
        patterns: [/\bmusic\b/i, /\bjam\b/i, /\bclub\b/i, /poom[\s_-]*poom/i, /\bamp\b/i]
    },
    {
        theme: 'documentary',
        contentType: 'documentary',
        patterns: [/documentary/i, /docu[\s_-]?style/i, /non[\s_-]?fiction/i]
    },
    {
        theme: 'episode',
        contentType: 'episode',
        patterns: [/\bepisode\b/i, /\bs\d+e\d+\b/i, /ep[\s._-]?\d+/i]
    },
    {
        theme: 'los-angeles',
        patterns: [/\blos[\s_-]*angeles\b/i, /\bla\b(?!\w)/i, /\bhollywood\b/i]
    },
    {
        theme: 'club',
        patterns: [/\bclub\b/i, /poom/i]
    },
    {
        theme: 'residential',
        patterns: [/\bcondo\b/i, /high[\s_-]*rise/i, /apartment/i]
    }
]);

/**
 * Derive non-shelf semantic themes from available ecosystem text fields.
 * Missing fields → empty themes (no invention).
 *
 * @param {{
 *   title?: string;
 *   description?: string;
 *   tags?: unknown;
 *   seriesTitle?: string;
 *   episodeTitle?: string;
 *   fileName?: string;
 *   fileNameStem?: string;
 *   mediaKind?: string;
 * }} meta
 * @param {Record<string, unknown>} [content]
 * @returns {{
 *   themes: string[];
 *   contentType: string;
 *   locationHints: string[];
 *   editorialSignals: string[];
 * }}
 */
export function extractSemanticThemes(meta = {}, content = {}) {
    const blob = [
        meta.title,
        meta.description,
        Array.isArray(meta.tags) ? meta.tags.join(' ') : meta.tags,
        meta.seriesTitle,
        meta.episodeTitle,
        meta.fileNameStem,
        content.seriesName,
        content.location,
        content.city
    ]
        .map(hay)
        .filter(Boolean)
        .join(' \n ');

    /** @type {string[]} */
    const themes = [];
    /** @type {string[]} */
    const editorialSignals = [];
    /** @type {string[]} */
    const locationHints = [];
    /** @type {string} */
    let contentType = '';

    if (!blob) {
        const mediaKind = hay(meta.mediaKind || content.type || content.mediaKind);
        if (mediaKind === 'video' || mediaKind === 'image') {
            contentType = mediaKind;
            editorialSignals.push(`mediaKind:${mediaKind}`);
        }
        return { themes, contentType: contentType || 'unknown', locationHints, editorialSignals };
    }

    for (const rule of THEME_RULES) {
        if (!rule.patterns.some((re) => re.test(blob))) continue;
        if (!themes.includes(rule.theme)) themes.push(rule.theme);
        editorialSignals.push(`theme:${rule.theme}`);
        if (rule.contentType && !contentType) contentType = rule.contentType;
        if (rule.theme === 'los-angeles' && !locationHints.includes('Los Angeles')) {
            locationHints.push('Los Angeles');
        }
    }

    if (text(meta.episodeTitle) || text(content.episodeTitle)) {
        if (!themes.includes('episode')) themes.push('episode');
        if (!contentType) contentType = 'episode';
        editorialSignals.push('context:episodeTitle');
    }
    if (text(meta.seriesTitle) || text(content.seriesName) || text(content.seriesTitle)) {
        editorialSignals.push('context:seriesTitle');
        if (!contentType) contentType = 'episode';
    }

    const mediaKind = hay(meta.mediaKind || content.type || content.mediaKind);
    if (!contentType && (mediaKind === 'video' || mediaKind === 'image')) {
        contentType = mediaKind;
    }

    return {
        themes,
        contentType: contentType || 'unknown',
        locationHints,
        editorialSignals: [...new Set(editorialSignals)]
    };
}
