/**
 * Expandable discovery taxonomy — shelves vs presentation themes.
 *
 * ACTIVE shelves power feed/creator UX today.
 * FUTURE shelves are registered for architecture growth only —
 * they are NOT assigned, suggested as live shelves, or invented onto assets.
 *
 * Themes / moods live in presentationThemeSystem — never as shelves here.
 */

/** @typedef {{ id: string; label: string; status: 'active' | 'future'; aliases?: string[] }} TaxonomyShelf */

/** @type {ReadonlyArray<TaxonomyShelf>} */
export const DISCOVERY_TAXONOMY = Object.freeze([
    { id: 'Trending', label: 'Trending', status: 'active', aliases: ['Network'] },
    { id: 'Romance', label: 'Romance', status: 'active' },
    { id: 'Cyber-Action', label: 'Cyber-Action', status: 'active', aliases: ['Action'] },
    { id: 'Suspense', label: 'Suspense', status: 'active' },
    // Future expansion — registered, not active in feed/creator persist options
    { id: 'Documentary', label: 'Documentary', status: 'future' },
    { id: 'Music', label: 'Music', status: 'future' },
    { id: 'Culture', label: 'Culture', status: 'future' },
    { id: 'Comedy', label: 'Comedy', status: 'future' },
    { id: 'Reality', label: 'Reality', status: 'future' },
    { id: 'Sports', label: 'Sports', status: 'future' },
    { id: 'Education', label: 'Education', status: 'future' },
    { id: 'Animation', label: 'Animation', status: 'future' },
    { id: 'Experimental', label: 'Experimental', status: 'future' }
]);

/**
 * @returns {readonly string[]}
 */
export function getActiveDiscoveryShelves() {
    return Object.freeze(
        DISCOVERY_TAXONOMY.filter((s) => s.status === 'active').map((s) => s.id)
    );
}

/**
 * @returns {readonly string[]}
 */
export function getFutureDiscoveryShelves() {
    return Object.freeze(
        DISCOVERY_TAXONOMY.filter((s) => s.status === 'future').map((s) => s.id)
    );
}

/**
 * Normalize a category onto an active shelf when possible.
 * Unknown / future labels do not invent placement — returns ''.
 * @param {unknown} category
 * @returns {string}
 */
export function normalizeActiveShelf(category) {
    const raw = String(category || '').trim();
    if (!raw) return '';
    for (const shelf of DISCOVERY_TAXONOMY) {
        if (shelf.status !== 'active') continue;
        if (shelf.id === raw) return shelf.id;
        if ((shelf.aliases || []).includes(raw)) return shelf.id;
    }
    return '';
}

/**
 * Whether a shelf id is registered (active or future).
 * @param {unknown} shelfId
 */
export function isRegisteredShelf(shelfId) {
    const id = String(shelfId || '').trim();
    return DISCOVERY_TAXONOMY.some((s) => s.id === id);
}

/**
 * Whether a shelf may be used for creator persist / feed distribution today.
 * @param {unknown} shelfId
 */
export function isActiveShelf(shelfId) {
    return Boolean(normalizeActiveShelf(shelfId));
}

/**
 * Taxonomy snapshot for architecture / Studio diagnostics (read-only).
 */
export function describeDiscoveryTaxonomy() {
    return {
        version: 1,
        active: getActiveDiscoveryShelves(),
        future: getFutureDiscoveryShelves(),
        note: 'Future shelves are architectural placeholders only — never auto-assigned.'
    };
}
