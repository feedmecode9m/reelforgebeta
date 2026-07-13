/** True when `?debug=demo` is present — forces demo cards visible for sharing/debug. */
export function isDemoDebugMode() {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('debug') === 'demo';
}
