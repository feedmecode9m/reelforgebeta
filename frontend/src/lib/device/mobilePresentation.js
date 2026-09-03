/**
 * Shared mobile presentation detection for Viewer, Theater, and feed.
 * Coarse pointer covers phones/tablets; narrow width covers landscape phones.
 */

export const MOBILE_PRESENTATION_MQ =
    '(hover: none) and (pointer: coarse), (max-width: 640px)';

export const MOBILE_LANDSCAPE_MQ =
    '(max-width: 640px) and (orientation: landscape), (hover: none) and (pointer: coarse) and (orientation: landscape)';

/** @returns {boolean} */
export function detectMobilePresentation() {
    if (typeof window === 'undefined') {
        return false;
    }
    const hasMatchMedia = typeof window.matchMedia === 'function';
    const touchPoints =
        typeof navigator !== 'undefined' && Number.isFinite(navigator.maxTouchPoints)
            ? Number(navigator.maxTouchPoints)
            : 0;
    const touchCapable = touchPoints > 0;
    const viewport = Math.min(window.innerWidth || 0, window.innerHeight || 0);
    const touchViewportMobile = touchCapable && viewport > 0 && viewport <= 1024;
    if (!hasMatchMedia) {
        return touchViewportMobile;
    }
    return (
        window.matchMedia('(hover: none) and (pointer: coarse)').matches ||
        window.matchMedia('(max-width: 640px)').matches ||
        touchViewportMobile
    );
}

/** Mobile Theater landscape: coarse/narrow device held horizontally. */
export function detectMobileLandscapePresentation() {
    if (typeof window === 'undefined') {
        return false;
    }
    if (!detectMobilePresentation()) {
        return false;
    }
    if (typeof window.matchMedia !== 'function') {
        const w = window.innerWidth || 0;
        const h = window.innerHeight || 0;
        return w > h;
    }
    return window.matchMedia('(orientation: landscape)').matches;
}

/**
 * @param {(matches: boolean) => void} onChange
 * @returns {() => void}
 */
export function subscribeMobilePresentation(onChange) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {};
    }
    const mql = window.matchMedia(MOBILE_PRESENTATION_MQ);
    const handler = () => onChange(detectMobilePresentation());
    if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handler);
    } else if (typeof mql.addListener === 'function') {
        mql.addListener(handler);
    }
    return () => {
        if (typeof mql.removeEventListener === 'function') {
            mql.removeEventListener('change', handler);
        } else if (typeof mql.removeListener === 'function') {
            mql.removeListener(handler);
        }
    };
}
