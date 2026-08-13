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

/** @type {ReadonlyArray<{ theme: string; contentType?: string; mood?: string; audience?: string; patterns: RegExp[] }>} */
const THEME_RULES = Object.freeze([
    {
        theme: 'behind-the-scenes',
        contentType: 'behind-the-scenes',
        mood: 'documentary',
        patterns: [/behind[\s_-]*the[\s_-]*scenes?/i, /\bbts\b/i, /soundstage/i, /set[\s_-]*shoot/i]
    },
    {
        theme: 'production',
        contentType: 'production',
        mood: 'studio',
        patterns: [/production/i, /\bmicros\b/i, /open[\s_-]*v\d/i, /arrival[\s_-]*open/i, /amp[\s_-]*jam/i, /\bstudio\b/i, /\bcamera\b/i]
    },
    {
        theme: 'music',
        contentType: 'music',
        mood: 'rhythmic',
        audience: 'general',
        patterns: [/\bmusic\b/i, /\bjam\b/i, /\bclub\b/i, /poom[\s_-]*poom/i, /\bamp\b/i]
    },
    {
        theme: 'documentary',
        contentType: 'documentary',
        mood: 'observational',
        audience: 'general',
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
    },
    {
        theme: 'drama',
        mood: 'emotional',
        audience: 'mature',
        patterns: [/\bdrama\b/i, /\bemotional\b/i, /\bintimate\b/i, /\bcharacter\b/i]
    },
    {
        theme: 'emotional',
        mood: 'emotional',
        patterns: [/\bemotional\b/i, /\bheartfelt\b/i, /\btender\b/i]
    },
    {
        theme: 'intimate',
        mood: 'intimate',
        patterns: [/\bintimate\b/i, /\bquiet\b/i, /\bpersonal\b/i]
    },
    {
        theme: 'action',
        mood: 'intense',
        audience: 'general',
        patterns: [/\baction\b/i, /\bintensity\b/i, /\bconflict\b/i, /\bchase\b/i]
    },
    {
        theme: 'intensity',
        mood: 'intense',
        patterns: [/\bintensity\b/i, /\bhigh[\s_-]*stakes\b/i]
    },
    {
        theme: 'technology',
        mood: 'futuristic',
        audience: 'general',
        patterns: [/\btech(nology)?\b/i, /\bfuturistic\b/i, /\bdigital\b/i, /\bcyber\b/i, /\bneon\b/i]
    },
    {
        theme: 'cyber',
        mood: 'futuristic',
        patterns: [/\bcyber\b/i, /\bneon\b/i, /\bai\b/i]
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
 *   mood: string;
 *   audience: string;
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
        content.city,
        content.mood,
        content.audience
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
    /** @type {string} */
    let mood = text(content.mood || meta.mood);
    /** @type {string} */
    let audience = text(content.audience || meta.audience);

    if (!blob) {
        const mediaKind = hay(meta.mediaKind || content.type || content.mediaKind);
        if (mediaKind === 'video' || mediaKind === 'image') {
            contentType = mediaKind;
            editorialSignals.push(`mediaKind:${mediaKind}`);
        }
        return {
            themes,
            contentType: contentType || 'unknown',
            mood,
            audience,
            locationHints,
            editorialSignals
        };
    }

    for (const rule of THEME_RULES) {
        if (!rule.patterns.some((re) => re.test(blob))) continue;
        if (!themes.includes(rule.theme)) themes.push(rule.theme);
        editorialSignals.push(`theme:${rule.theme}`);
        if (rule.contentType && !contentType) contentType = rule.contentType;
        if (rule.mood && !mood) mood = rule.mood;
        if (rule.audience && !audience) audience = rule.audience;
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
        mood,
        audience,
        locationHints,
        editorialSignals: [...new Set(editorialSignals)]
    };
}
