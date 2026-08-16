/**
 * Shared mobile presentation detection for Viewer, Theater, and feed.
 * Coarse pointer covers phones/tablets; narrow width covers landscape phones.
 */

export const MOBILE_PRESENTATION_MQ =
    '(hover: none) and (pointer: coarse), (max-width: 640px)';

/** @returns {boolean} */
export function detectMobilePresentation() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return (
        window.matchMedia('(hover: none) and (pointer: coarse)').matches ||
        window.matchMedia('(max-width: 640px)').matches
    );
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
