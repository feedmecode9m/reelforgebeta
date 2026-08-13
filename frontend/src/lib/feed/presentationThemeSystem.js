/**
 * Presentation theme system — visual treatment only.
 *
 * Themes / families influence card aesthetics (depth, accent, badges, motion).
 * They are NEVER shelves and NEVER mutate category.
 */

/**
 * @typedef {'production' | 'drama' | 'action' | 'technology' | 'neutral'} PresentationFamily
 * @typedef {{
 *   family: PresentationFamily;
 *   accent: string;
 *   glow: string;
 *   depth: string;
 *   badgeLabel: string;
 *   emphasis: 'artwork' | 'editorial' | 'identity';
 *   animation: 'lift' | 'pulse' | 'parallax';
 *   cssClass: string;
 * }} PresentationTheme
 */

/** @type {Readonly<Record<PresentationFamily, PresentationTheme>>} */
export const PRESENTATION_THEMES = Object.freeze({
    production: Object.freeze({
        family: 'production',
        accent: '#c4a574',
        glow: 'rgba(196, 165, 116, 0.22)',
        depth: 'rgba(28, 36, 52, 0.94)',
        badgeLabel: 'Production',
        emphasis: 'artwork',
        animation: 'parallax',
        cssClass: 'sem-card--theme-production'
    }),
    drama: Object.freeze({
        family: 'drama',
        accent: '#d4a0a8',
        glow: 'rgba(212, 160, 168, 0.2)',
        depth: 'rgba(32, 22, 28, 0.95)',
        badgeLabel: 'Drama',
        emphasis: 'editorial',
        animation: 'lift',
        cssClass: 'sem-card--theme-drama'
    }),
    action: Object.freeze({
        family: 'action',
        accent: '#e0a06a',
        glow: 'rgba(224, 160, 106, 0.24)',
        depth: 'rgba(28, 24, 18, 0.96)',
        badgeLabel: 'Intensity',
        emphasis: 'artwork',
        animation: 'pulse',
        cssClass: 'sem-card--theme-action'
    }),
    technology: Object.freeze({
        family: 'technology',
        accent: '#7eb8c9',
        glow: 'rgba(126, 184, 201, 0.22)',
        depth: 'rgba(14, 24, 32, 0.96)',
        badgeLabel: 'Digital',
        emphasis: 'identity',
        animation: 'parallax',
        cssClass: 'sem-card--theme-technology'
    }),
    neutral: Object.freeze({
        family: 'neutral',
        accent: '#c4a574',
        glow: 'rgba(196, 165, 116, 0.14)',
        depth: 'rgba(12, 16, 24, 0.96)',
        badgeLabel: '',
        emphasis: 'artwork',
        animation: 'lift',
        cssClass: 'sem-card--theme-neutral'
    })
});

/** Theme token → presentation family (presentation only). */
const THEME_TO_FAMILY = Object.freeze({
    production: 'production',
    'behind-the-scenes': 'production',
    documentary: 'production',
    camera: 'production',
    studio: 'production',
    music: 'production',
    club: 'production',
    residential: 'neutral',
    episode: 'neutral',
    'los-angeles': 'production',
    drama: 'drama',
    emotional: 'drama',
    intimate: 'drama',
    character: 'drama',
    romance: 'drama',
    action: 'action',
    intensity: 'action',
    conflict: 'action',
    movement: 'action',
    technology: 'technology',
    futuristic: 'technology',
    digital: 'technology',
    cyber: 'technology'
});

/**
 * @param {string[]} themes
 * @param {string} [contentType]
 * @param {string} [suggestedShelf]
 * @returns {PresentationFamily}
 */
export function resolvePresentationFamily(themes = [], contentType = '', suggestedShelf = '') {
    const tokens = [...themes.map(String), String(contentType || '')]
        .map((t) => t.toLowerCase().trim())
        .filter(Boolean);

    for (const token of tokens) {
        const family = THEME_TO_FAMILY[token];
        if (family) return /** @type {PresentationFamily} */ (family);
    }

    const shelf = String(suggestedShelf || '').trim();
    if (shelf === 'Romance') return 'drama';
    if (shelf === 'Cyber-Action' || shelf === 'Action') return 'action';
    if (shelf === 'Suspense') return 'drama';

    return 'neutral';
}

/**
 * Derive presentation theme from semantic themes — never invents editorial text.
 *
 * @param {{
 *   themes?: string[];
 *   contentType?: string;
 *   suggestedCategory?: string;
 *   aspectRatio?: string;
 *   hasDescription?: boolean;
 *   identityConfidence?: string;
 * }} input
 * @returns {PresentationTheme & {
 *   cardVariant: 'cinematic' | 'editorial' | 'compact';
 *   visualEmphasis: string;
 *   badges: string[];
 * }}
 */
export function derivePresentationTheme(input = {}) {
    const family = resolvePresentationFamily(
        Array.isArray(input.themes) ? input.themes : [],
        input.contentType || '',
        input.suggestedCategory || ''
    );
    const base = PRESENTATION_THEMES[family] || PRESENTATION_THEMES.neutral;

    /** @type {string[]} */
    const badges = [];
    if (base.badgeLabel) badges.push(base.badgeLabel);
    if (input.identityConfidence === 'EXACT') badges.push('Exact match');
    if (input.aspectRatio === '9:16') badges.push('Vertical');
    if (input.aspectRatio === '16:9') badges.push('Widescreen');

    let cardVariant = /** @type {'cinematic' | 'editorial' | 'compact'} */ ('cinematic');
    if (input.hasDescription && family === 'drama') cardVariant = 'editorial';
    if (input.aspectRatio === '9:16') cardVariant = 'compact';

    return {
        ...base,
        cardVariant,
        visualEmphasis: base.emphasis,
        badges
    };
}
