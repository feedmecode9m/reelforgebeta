/**
 * Client-side path navigation for the SPA (AUTH-UI-2).
 * Uses history so App.svelte popstate/gate logic can recompute without a full reload.
 * Paths may include query strings (e.g. /login?next=/account).
 */

/**
 * @param {string} path
 */
export function clientNavigate(path) {
    if (typeof window === 'undefined') return;
    const next = path.startsWith('/') ? path : `/${path}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current !== next) {
        window.history.pushState({}, '', next);
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Ask Viewer to open Smart Production Studio (admin session only). */
export function requestOpenStudio(source = 'account_menu') {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
        new CustomEvent('reelforge:open-studio', {
            detail: { source }
        })
    );
}
