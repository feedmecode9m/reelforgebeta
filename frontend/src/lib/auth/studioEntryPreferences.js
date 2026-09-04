/**
 * Admin-managed Studio entry preferences (localStorage, per browser).
 */

const AUTO_ENTER_KEY = 'reelforge_studio_auto_enter';
const VIEWER_PREVIEW_KEY = 'reelforge_viewer_preview_mode';

/** @returns {boolean} */
export function readStudioAutoEnterPreference() {
    if (typeof window === 'undefined') return true;
    try {
        const raw = window.localStorage.getItem(AUTO_ENTER_KEY);
        if (raw === 'false') return false;
        if (raw === 'true') return true;
    } catch {
        /* ignore */
    }
    return true;
}

/** @param {boolean} enabled */
export function writeStudioAutoEnterPreference(enabled) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(AUTO_ENTER_KEY, enabled ? 'true' : 'false');
    } catch {
        /* ignore */
    }
}

/** When true, admin/studio sessions behave like a viewer for paywall testing. */
export function readViewerPreviewMode() {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(VIEWER_PREVIEW_KEY) === 'true';
    } catch {
        return false;
    }
}

/** @param {boolean} enabled */
export function writeViewerPreviewMode(enabled) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(VIEWER_PREVIEW_KEY, enabled ? 'true' : 'false');
        window.dispatchEvent(
            new CustomEvent('reelforge:subscription-updated', {
                detail: { source: 'viewer_preview_mode', enabled }
            })
        );
    } catch {
        /* ignore */
    }
}

/** Discreet studio link on consumer /login (off by default in production builds). */
export function showStudioLinkOnViewerLogin() {
    if (import.meta.env.VITE_SHOW_STUDIO_LINK_ON_LOGIN === 'true') return true;
    if (import.meta.env.VITE_SHOW_STUDIO_LINK_ON_LOGIN === 'false') return false;
    return Boolean(import.meta.env.DEV);
}
