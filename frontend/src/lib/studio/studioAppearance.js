/**
 * Backward-compatible re-exports — prefer `./studioAppearanceEngine.js`.
 */
export {
    STUDIO_THEME_PREF_KEY,
    STUDIO_THEME_CATALOG,
    STUDIO_THEME_IDS,
    APPEARANCE_PROFILES,
    APPEARANCE_PROFILE_IDS,
    STUDIO_APPEARANCE_STORAGE_KEY,
    loadStudioThemePreference,
    saveStudioThemePreference,
    getStudioThemeDefinition,
    applyStudioTheme,
    initStudioAppearance,
    getStudioThemeStatus,
    logStudioThemeDiag,
    initStudioAppearanceEngine,
    loadStudioAppearanceConfig,
    saveStudioAppearanceConfig,
    applyStudioAppearance,
    getStudioAppearanceStatus,
    logAppearanceDiag,
    getDefaultAppearanceConfig,
    getAppearanceProfile
} from './studioAppearanceEngine.js';
