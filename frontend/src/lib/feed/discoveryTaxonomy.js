import { writable, get as storeGet } from 'svelte/store';

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

/** localStorage key for Studio LIVE CONTENT display aliases (canonical id → label). */
export const CATEGORY_NAMES_STORAGE_KEY = 'reelforge_category_names';

/**
 * @returns {Record<string, string>}
 */
export function readCategoryNameMap() {
    if (typeof localStorage === 'undefined') return {};
    try {
        const raw = JSON.parse(localStorage.getItem(CATEGORY_NAMES_STORAGE_KEY) || '{}');
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
        return {};
    }
}

/** Reactive canonical id → display alias (synced from Studio LIVE CONTENT). */
export const categoryAliasStore = writable({});

/**
 * @param {Record<string, string> | null | undefined} map
 */
export function syncCategoryAliasStore(map) {
    categoryAliasStore.set(map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {});
}

syncCategoryAliasStore(readCategoryNameMap());

/**
 * Audience / Studio label for a canonical shelf id.
 * @param {unknown} shelfId
 * @param {Record<string, string> | null | undefined} [nameMap]
 */
export function displayDiscoveryShelf(shelfId, nameMap = null) {
    const id = String(shelfId || '').trim();
    if (!id) return '';
    const map =
        nameMap && typeof nameMap === 'object'
            ? nameMap
            : { ...readCategoryNameMap(), ...(storeGet(categoryAliasStore) || {}) };
    const custom = String(map[id] || '').trim();
    if (custom) return custom;
    const tax = DISCOVERY_TAXONOMY.find((s) => s.id === id);
    return tax?.label || id;
}

/**
 * Display label using the live alias store (Studio rename).
 * @param {unknown} shelfId
 */
export function labelDiscoveryShelf(shelfId) {
    return displayDiscoveryShelf(shelfId, storeGet(categoryAliasStore));
}

/**
 * Map a UI label (canonical or renamed) back to an active shelf id.
 * @param {unknown} value
 * @param {Record<string, string> | null | undefined} [nameMap]
 * @returns {string}
 */
export function resolveCanonicalDiscoveryShelf(value, nameMap = null) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const active = getActiveDiscoveryShelves();
    if (active.includes(raw)) return raw;
    const map =
        nameMap && typeof nameMap === 'object'
            ? nameMap
            : { ...readCategoryNameMap(), ...(storeGet(categoryAliasStore) || {}) };
    for (const id of active) {
        if (String(map[id] || '').trim() === raw) return id;
    }
    return normalizeActiveShelf(raw);
}

/**
 * Keep feed object keys on canonical shelves. Display aliases never become feed keys.
 * @param {Record<string, unknown> | null | undefined} feedMap
 * @param {Record<string, string> | null | undefined} [nameMap]
 * @returns {Record<string, unknown[]>}
 */
export function reconcileFeedToCanonicalShelves(feedMap, nameMap = null) {
    /** @type {Record<string, unknown[]>} */
    const out = {};
    for (const id of getActiveDiscoveryShelves()) out[id] = [];
    if (feedMap && typeof feedMap === 'object') {
        for (const [key, rows] of Object.entries(feedMap)) {
            if (key === 'Auto-Detect' || key === 'HERO') {
                out[key] = Array.isArray(rows) ? rows : [];
                continue;
            }
            const canonical = resolveCanonicalDiscoveryShelf(key, nameMap) || 'Trending';
            if (!out[canonical]) out[canonical] = [];
            for (const row of Array.isArray(rows) ? rows : []) {
                if (!row || typeof row !== 'object') continue;
                out[canonical].push({
                    .../** @type {Record<string, unknown>} */ (row),
                    category: canonical
                });
            }
        }
    }
    return out;
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
