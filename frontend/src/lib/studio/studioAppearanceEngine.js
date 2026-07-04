/**
 * Phase 35 — Studio Appearance Engine.
 * Themes, density, font scale, and accessibility — scoped to Smart Production Studio only.
 */

export const STUDIO_APPEARANCE_STORAGE_KEY = 'reelforge_studio_appearance';
export const STUDIO_APPEARANCE_VERSION = '5.0.0';

/** @typedef {'creator-dark' | 'creator-light' | 'cinematic' | 'command-center' | 'neon-studio'} AppearanceProfileId */
/** @typedef {'compact' | 'comfortable' | 'spacious'} AppearanceDensity */
/** @typedef {'small' | 'normal' | 'large'} AppearanceFontScale */

/**
 * @typedef {Object} AppearanceProfile
 * @property {AppearanceProfileId} id
 * @property {string} name
 * @property {string} description
 * @property {string} mood
 * @property {string[]} swatches
 * @property {Record<string, string>} tokens
 */

/**
 * @typedef {Object} StudioAppearanceConfig
 * @property {AppearanceProfileId} theme
 * @property {AppearanceFontScale} fontScale
 * @property {AppearanceDensity} density
 * @property {boolean} colorBlindSafe
 * @property {boolean} reducedMotion
 * @property {boolean} focusMode
 * @property {number} [contrastScore]
 */

/** @type {AppearanceProfile[]} */
export const APPEARANCE_PROFILES = [
    {
        id: 'creator-dark',
        name: 'Creator Dark',
        description: 'Neon cyber studio — default Smart Production look with cyan accents.',
        mood: 'Energetic · Night shift',
        swatches: ['#050810', '#00f2ff', '#ff00ff', '#ffd700'],
        tokens: {
            '--studio-bg': 'rgba(8, 12, 20, 0.96)',
            '--studio-bg-elevated': 'rgba(0, 0, 0, 0.55)',
            '--studio-surface': 'rgba(0, 0, 0, 0.28)',
            '--studio-border': 'rgba(255, 255, 255, 0.08)',
            '--studio-border-strong': 'rgba(0, 242, 255, 0.22)',
            '--studio-accent': '#00f2ff',
            '--studio-accent-muted': 'rgba(0, 242, 255, 0.12)',
            '--studio-accent-contrast': '#000000',
            '--studio-secondary': '#ff00ff',
            '--studio-highlight': '#ffd700',
            '--studio-text': 'rgba(255, 255, 255, 0.95)',
            '--studio-text-muted': 'rgba(255, 255, 255, 0.55)',
            '--studio-text-subtle': 'rgba(255, 255, 255, 0.42)',
            '--studio-glow': 'rgba(0, 242, 255, 0.2)',
            '--studio-shadow': '0 18px 48px rgba(0, 0, 0, 0.35)',
            '--studio-gradient': 'linear-gradient(165deg, rgba(8, 12, 20, 0.92) 0%, rgba(0, 0, 0, 0.55) 100%)',
            '--studio-header-gradient': 'linear-gradient(90deg, #00f2ff, #ff00ff)',
            '--studio-radius': '12px'
        }
    },
    {
        id: 'creator-light',
        name: 'Creator Light',
        description: 'Bright editorial workspace with crisp contrast for daytime production.',
        mood: 'Clean · Editorial',
        swatches: ['#f4f6fb', '#2563eb', '#7c3aed', '#0f172a'],
        tokens: {
            '--studio-bg': 'rgba(244, 246, 251, 0.98)',
            '--studio-bg-elevated': 'rgba(255, 255, 255, 0.92)',
            '--studio-surface': 'rgba(255, 255, 255, 0.88)',
            '--studio-border': 'rgba(15, 23, 42, 0.1)',
            '--studio-border-strong': 'rgba(37, 99, 235, 0.35)',
            '--studio-accent': '#2563eb',
            '--studio-accent-muted': 'rgba(37, 99, 235, 0.1)',
            '--studio-accent-contrast': '#ffffff',
            '--studio-secondary': '#7c3aed',
            '--studio-highlight': '#0f172a',
            '--studio-text': '#0f172a',
            '--studio-text-muted': 'rgba(15, 23, 42, 0.62)',
            '--studio-text-subtle': 'rgba(15, 23, 42, 0.45)',
            '--studio-glow': 'rgba(37, 99, 235, 0.15)',
            '--studio-shadow': '0 16px 40px rgba(15, 23, 42, 0.12)',
            '--studio-gradient': 'linear-gradient(165deg, #ffffff 0%, #eef2ff 100%)',
            '--studio-header-gradient': 'linear-gradient(90deg, #2563eb, #7c3aed)',
            '--studio-radius': '12px'
        }
    },
    {
        id: 'cinematic',
        name: 'Cinematic Studio',
        description: 'Warm gold and deep charcoal — film-grade production mood.',
        mood: 'Dramatic · Film grade',
        swatches: ['#0c0a08', '#c9a962', '#8b4513', '#1a1410'],
        tokens: {
            '--studio-bg': 'rgba(12, 10, 8, 0.97)',
            '--studio-bg-elevated': 'rgba(26, 20, 16, 0.85)',
            '--studio-surface': 'rgba(26, 20, 16, 0.55)',
            '--studio-border': 'rgba(201, 169, 98, 0.12)',
            '--studio-border-strong': 'rgba(201, 169, 98, 0.32)',
            '--studio-accent': '#c9a962',
            '--studio-accent-muted': 'rgba(201, 169, 98, 0.12)',
            '--studio-accent-contrast': '#0c0a08',
            '--studio-secondary': '#8b4513',
            '--studio-highlight': '#f5e6c8',
            '--studio-text': 'rgba(245, 230, 200, 0.95)',
            '--studio-text-muted': 'rgba(245, 230, 200, 0.58)',
            '--studio-text-subtle': 'rgba(245, 230, 200, 0.4)',
            '--studio-glow': 'rgba(201, 169, 98, 0.22)',
            '--studio-shadow': '0 20px 52px rgba(0, 0, 0, 0.55)',
            '--studio-gradient': 'linear-gradient(165deg, rgba(26, 20, 16, 0.95) 0%, rgba(12, 10, 8, 0.92) 100%)',
            '--studio-header-gradient': 'linear-gradient(90deg, #c9a962, #8b4513)',
            '--studio-radius': '10px'
        }
    },
    {
        id: 'command-center',
        name: 'Command Center',
        description: 'Boardroom navy with emerald signals — KPI-first executive view.',
        mood: 'Strategic · KPI-first',
        swatches: ['#0a1628', '#10b981', '#1e3a5f', '#d1fae5'],
        tokens: {
            '--studio-bg': 'rgba(10, 22, 40, 0.97)',
            '--studio-bg-elevated': 'rgba(15, 30, 52, 0.9)',
            '--studio-surface': 'rgba(30, 58, 95, 0.35)',
            '--studio-border': 'rgba(16, 185, 129, 0.1)',
            '--studio-border-strong': 'rgba(16, 185, 129, 0.28)',
            '--studio-accent': '#10b981',
            '--studio-accent-muted': 'rgba(16, 185, 129, 0.12)',
            '--studio-accent-contrast': '#042f2e',
            '--studio-secondary': '#1e3a5f',
            '--studio-highlight': '#d1fae5',
            '--studio-text': 'rgba(236, 253, 245, 0.95)',
            '--studio-text-muted': 'rgba(209, 250, 229, 0.62)',
            '--studio-text-subtle': 'rgba(167, 243, 208, 0.45)',
            '--studio-glow': 'rgba(16, 185, 129, 0.2)',
            '--studio-shadow': '0 18px 44px rgba(0, 0, 0, 0.4)',
            '--studio-gradient': 'linear-gradient(165deg, rgba(15, 30, 52, 0.94) 0%, rgba(10, 22, 40, 0.97) 100%)',
            '--studio-header-gradient': 'linear-gradient(90deg, #10b981, #1e3a5f)',
            '--studio-radius': '12px'
        }
    },
    {
        id: 'neon-studio',
        name: 'Neon Studio',
        description: 'High-energy magenta and electric cyan — maximum creator vibe.',
        mood: 'Bold · Neon pulse',
        swatches: ['#120018', '#ff00ff', '#00f2ff', '#ffd700'],
        tokens: {
            '--studio-bg': 'rgba(18, 0, 24, 0.98)',
            '--studio-bg-elevated': 'rgba(36, 0, 48, 0.88)',
            '--studio-surface': 'rgba(255, 0, 255, 0.06)',
            '--studio-border': 'rgba(255, 0, 255, 0.14)',
            '--studio-border-strong': 'rgba(0, 242, 255, 0.32)',
            '--studio-accent': '#ff00ff',
            '--studio-accent-muted': 'rgba(255, 0, 255, 0.12)',
            '--studio-accent-contrast': '#ffffff',
            '--studio-secondary': '#00f2ff',
            '--studio-highlight': '#ffd700',
            '--studio-text': 'rgba(255, 255, 255, 0.96)',
            '--studio-text-muted': 'rgba(255, 255, 255, 0.58)',
            '--studio-text-subtle': 'rgba(255, 255, 255, 0.42)',
            '--studio-glow': 'rgba(255, 0, 255, 0.28)',
            '--studio-shadow': '0 20px 52px rgba(255, 0, 255, 0.12)',
            '--studio-gradient': 'linear-gradient(165deg, rgba(36, 0, 48, 0.94) 0%, rgba(18, 0, 24, 0.98) 100%)',
            '--studio-header-gradient': 'linear-gradient(90deg, #ff00ff, #00f2ff)',
            '--studio-radius': '14px'
        }
    }
];

export const APPEARANCE_PROFILE_IDS = APPEARANCE_PROFILES.map((profile) => profile.id);

/** @type {Record<string, AppearanceProfileId>} */
export const LEGACY_THEME_ALIASES = {
    'executive-dashboard': 'command-center',
    'focus-mode': 'neon-studio'
};

/** @type {Record<AppearanceDensity, Record<string, string>>} */
export const DENSITY_TOKENS = {
    compact: {
        '--studio-space-unit': '0.42rem',
        '--studio-gap': '0.35rem',
        '--studio-panel-padding': '0.65rem',
        '--studio-font-base': '0.58rem'
    },
    comfortable: {
        '--studio-space-unit': '0.55rem',
        '--studio-gap': '0.55rem',
        '--studio-panel-padding': '0.85rem',
        '--studio-font-base': '0.64rem'
    },
    spacious: {
        '--studio-space-unit': '0.72rem',
        '--studio-gap': '0.75rem',
        '--studio-panel-padding': '1.05rem',
        '--studio-font-base': '0.72rem'
    }
};

/** @type {Record<AppearanceFontScale, number>} */
export const FONT_SCALE_MULTIPLIERS = {
    small: 0.92,
    normal: 1,
    large: 1.1
};

/** @type {StudioAppearanceConfig} */
let activeConfig = getDefaultAppearanceConfig();

/**
 * @param {'APPEARANCE_THEME' | 'APPEARANCE_DENSITY' | 'APPEARANCE_ACCESSIBILITY'} tag
 * @param {Record<string, unknown>} [detail]
 */
export function logAppearanceDiag(tag, detail = {}) {
    console.log(`[${tag}] ${JSON.stringify({ ...detail, timestamp: Date.now() })}`);
}

/** @returns {StudioAppearanceConfig} */
export function getDefaultAppearanceConfig() {
    return {
        theme: 'creator-dark',
        fontScale: 'normal',
        density: 'comfortable',
        colorBlindSafe: false,
        reducedMotion: false,
        focusMode: false,
        contrastScore: 85
    };
}

/** @param {string | null | undefined} themeId */
export function normalizeAppearanceTheme(themeId) {
    const id = String(themeId || 'creator-dark');
    if (APPEARANCE_PROFILE_IDS.includes(/** @type {AppearanceProfileId} */ (id))) {
        return /** @type {AppearanceProfileId} */ (id);
    }
    if (LEGACY_THEME_ALIASES[id]) return LEGACY_THEME_ALIASES[id];
    return 'creator-dark';
}

/** @returns {StudioAppearanceConfig} */
export function loadStudioAppearanceConfig() {
    if (typeof window === 'undefined') return getDefaultAppearanceConfig();
    try {
        const raw = localStorage.getItem(STUDIO_APPEARANCE_STORAGE_KEY);
        if (!raw) {
            const legacyTheme = localStorage.getItem('reelforge_studio_theme');
            if (legacyTheme) {
                try {
                    const parsedLegacy = JSON.parse(legacyTheme);
                    return {
                        ...getDefaultAppearanceConfig(),
                        theme: normalizeAppearanceTheme(parsedLegacy?.id || parsedLegacy)
                    };
                } catch {
                    return {
                        ...getDefaultAppearanceConfig(),
                        theme: normalizeAppearanceTheme(legacyTheme)
                    };
                }
            }
            return getDefaultAppearanceConfig();
        }
        const parsed = JSON.parse(raw);
        return {
            ...getDefaultAppearanceConfig(),
            ...parsed,
            theme: normalizeAppearanceTheme(parsed.theme || parsed.themeId),
            fontScale: FONT_SCALE_MULTIPLIERS[parsed.fontScale] ? parsed.fontScale : 'normal',
            density: DENSITY_TOKENS[parsed.density] ? parsed.density : 'comfortable'
        };
    } catch {
        return getDefaultAppearanceConfig();
    }
}

/** @param {Partial<StudioAppearanceConfig>} patch */
export function saveStudioAppearanceConfig(patch = {}) {
    activeConfig = {
        ...activeConfig,
        ...patch,
        theme: normalizeAppearanceTheme(patch.theme || activeConfig.theme),
        updatedAt: Date.now()
    };
    if (typeof window !== 'undefined') {
        localStorage.setItem(STUDIO_APPEARANCE_STORAGE_KEY, JSON.stringify(activeConfig));
        localStorage.setItem(
            'reelforge_studio_theme',
            JSON.stringify({ id: activeConfig.theme, updatedAt: Date.now() })
        );
    }
    return activeConfig;
}

/** @param {AppearanceProfileId} themeId */
export function getAppearanceProfile(themeId = activeConfig.theme) {
    const normalized = normalizeAppearanceTheme(themeId);
    return APPEARANCE_PROFILES.find((profile) => profile.id === normalized) || APPEARANCE_PROFILES[0];
}

/** @param {Record<string, string>} tokens */
function estimateContrastScore(tokens) {
    const text = tokens['--studio-text'] || '#ffffff';
    const bg = tokens['--studio-bg'] || '#000000';
    const luminance = (color) => {
        const hex = color.includes('#') ? color.slice(1, 7) : 'ffffff';
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const textL = text.startsWith('rgba') ? 0.9 : luminance(text);
    const bgL = bg.startsWith('rgba') ? 0.08 : luminance(bg);
    const ratio = (Math.max(textL, bgL) + 0.05) / (Math.min(textL, bgL) + 0.05);
    return Math.max(0, Math.min(100, Math.round(ratio * 18)));
}

/**
 * @param {HTMLElement | null | undefined} root
 * @param {StudioAppearanceConfig} config
 */
function applyAppearanceToRoot(root, config) {
    if (!root) return;

    const profile = getAppearanceProfile(config.theme);
    let tokens = { ...profile.tokens, ...DENSITY_TOKENS[config.density] };

    if (config.colorBlindSafe) {
        tokens = {
            ...tokens,
            '--studio-accent': '#0072b2',
            '--studio-secondary': '#e69f00',
            '--studio-highlight': '#009e73'
        };
    }

    if (config.focusMode) {
        tokens = {
            ...tokens,
            '--studio-glow': 'rgba(255, 255, 255, 0.04)',
            '--studio-border-strong': 'rgba(255, 255, 255, 0.12)',
            '--studio-gradient': tokens['--studio-bg']
        };
    }

    Object.entries(tokens).forEach(([key, value]) => {
        root.style.setProperty(key, value);
    });

    const fontMultiplier = FONT_SCALE_MULTIPLIERS[config.fontScale] || 1;
    root.style.setProperty('--studio-font-scale', String(fontMultiplier));
    root.style.fontSize = `${Math.round(14 * fontMultiplier)}px`;

    const contrastScore = estimateContrastScore(tokens);
    config.contrastScore = contrastScore;

    root.setAttribute('data-studio-theme', profile.id);
    root.setAttribute('data-studio-density', config.density);
    root.setAttribute('data-studio-font-scale', config.fontScale);
    root.setAttribute('data-studio-contrast-score', String(contrastScore));
    root.toggleAttribute('data-studio-color-blind-safe', config.colorBlindSafe);
    root.toggleAttribute('data-studio-reduced-motion', config.reducedMotion);
    root.toggleAttribute('data-studio-focus-mode', config.focusMode);
}

/**
 * @param {Partial<StudioAppearanceConfig>} patch
 * @param {{ root?: HTMLElement | null; source?: string; silent?: boolean }} [options]
 */
export function applyStudioAppearance(patch = {}, options = {}) {
    const previous = { ...activeConfig };
    activeConfig = saveStudioAppearanceConfig({ ...activeConfig, ...patch });

    const root =
        options.root ||
        (typeof document !== 'undefined' ? document.querySelector('.control-center-container') : null);

    applyAppearanceToRoot(/** @type {HTMLElement} */ (root), activeConfig);

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('reelforge:studio-appearance-changed', {
                detail: { config: activeConfig, previous, source: options.source || 'apply' }
            })
        );
        window.dispatchEvent(
            new CustomEvent('reelforge:studio-theme-changed', {
                detail: {
                    themeId: activeConfig.theme,
                    previousThemeId: previous.theme,
                    source: options.source || 'apply'
                }
            })
        );
    }

    if (!options.silent) {
        if (patch.theme || options.source === 'init') {
            logAppearanceDiag('APPEARANCE_THEME', {
                themeId: activeConfig.theme,
                themeName: getAppearanceProfile(activeConfig.theme).name,
                previousThemeId: previous.theme,
                source: options.source || 'apply',
                theaterSafe: true,
                scoped: true
            });
        }
        if (patch.density) {
            logAppearanceDiag('APPEARANCE_DENSITY', {
                density: activeConfig.density,
                previousDensity: previous.density,
                source: options.source || 'apply'
            });
        }
        if (
            patch.colorBlindSafe !== undefined ||
            patch.reducedMotion !== undefined ||
            patch.focusMode !== undefined ||
            patch.fontScale
        ) {
            logAppearanceDiag('APPEARANCE_ACCESSIBILITY', {
                fontScale: activeConfig.fontScale,
                colorBlindSafe: activeConfig.colorBlindSafe,
                reducedMotion: activeConfig.reducedMotion,
                focusMode: activeConfig.focusMode,
                contrastScore: activeConfig.contrastScore
            });
        }
    }

    return { ok: true, config: activeConfig, previous };
}

/** @param {{ root?: HTMLElement | null }} [options] */
export function initStudioAppearanceState(options = {}) {
    activeConfig = loadStudioAppearanceConfig();
    return applyStudioAppearance(activeConfig, { source: 'init', root: options.root || null, silent: true });
}

export function getStudioAppearanceStatus() {
    const profile = getAppearanceProfile(activeConfig.theme);
    return {
        ...activeConfig,
        themeName: profile.name,
        profileCount: APPEARANCE_PROFILES.length,
        storageKey: STUDIO_APPEARANCE_STORAGE_KEY,
        theaterSafe: true,
        mediaExempt: true
    };
}

/** Backward-compatible catalog export */
export const STUDIO_THEME_CATALOG = APPEARANCE_PROFILES;
export const STUDIO_THEME_IDS = APPEARANCE_PROFILE_IDS;
export const STUDIO_THEME_PREF_KEY = 'reelforge_studio_theme';

export function loadStudioThemePreference() {
    return loadStudioAppearanceConfig().theme;
}

/** @param {AppearanceProfileId} themeId */
export function saveStudioThemePreference(themeId) {
    applyStudioAppearance({ theme: themeId }, { source: 'legacy-theme-pref' });
}

export function getStudioThemeDefinition(themeId) {
    return getAppearanceProfile(themeId);
}

export function applyStudioTheme(themeId, options = {}) {
    return applyStudioAppearance({ theme: normalizeAppearanceTheme(themeId) }, options);
}

export function initStudioAppearance(options = {}) {
    const result = initStudioAppearanceState(options);
    logAppearanceDiag('APPEARANCE_THEME', {
        themeId: activeConfig.theme,
        themeName: getAppearanceProfile(activeConfig.theme).name,
        source: 'init',
        catalogCount: APPEARANCE_PROFILES.length,
        persisted: true,
        theaterSafe: true
    });
    return result;
}

export function getStudioThemeStatus() {
    return getStudioAppearanceStatus();
}

/** @param {'STUDIO_THEME' | 'STUDIO_THEME_CHANGE'} tag @param {Record<string, unknown>} detail */
export function logStudioThemeDiag(tag, detail = {}) {
    if (tag === 'STUDIO_THEME' || (tag === 'STUDIO_THEME_CHANGE' && detail.themeId)) {
        logAppearanceDiag('APPEARANCE_THEME', detail);
        return;
    }
    logAppearanceDiag('APPEARANCE_THEME', detail);
}

/** @param {{ bindStudioRoot?: (handler: (root: HTMLElement | null) => void) => void }} [hooks] */
export function initStudioAppearanceEngine(hooks = {}) {
    if (typeof window === 'undefined') return;

    const applyToRoot = (root) => {
        if (!root) return;
        initStudioAppearanceState({ root });
        logAppearanceDiag('APPEARANCE_THEME', {
            phase: 'engine_initialized',
            version: STUDIO_APPEARANCE_VERSION,
            themeId: activeConfig.theme,
            density: activeConfig.density,
            theaterSafe: true
        });
    };

    hooks.bindStudioRoot?.(applyToRoot);

    window.__reelforgeStudioAppearanceEngine = {
        STUDIO_APPEARANCE_VERSION,
        APPEARANCE_PROFILES,
        APPEARANCE_PROFILE_IDS,
        STUDIO_APPEARANCE_STORAGE_KEY,
        loadStudioAppearanceConfig,
        saveStudioAppearanceConfig,
        applyStudioAppearance,
        getStudioAppearanceStatus,
        logAppearanceDiag
    };

    window.__reelforgeStudioAppearance = {
        STUDIO_THEME_CATALOG,
        STUDIO_THEME_IDS,
        STUDIO_THEME_PREF_KEY,
        loadStudioThemePreference,
        saveStudioThemePreference,
        getStudioThemeDefinition,
        applyStudioTheme,
        initStudioAppearance,
        getStudioThemeStatus,
        logStudioThemeDiag,
        ...window.__reelforgeStudioAppearanceEngine
    };
}
