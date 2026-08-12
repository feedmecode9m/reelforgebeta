/**
 * Phase 22 — merge-on-write for reel_titles_persistent title-only mutations.
 *
 * reel_titles_persistent[id] is one durable metadata record.
 * Title-only saves must preserve description/tags/category/creatorCategory
 * and any other existing keys (including authored-empty clear sentinels).
 *
 * Node-safe pure helper — no Vite/config imports.
 */

/**
 * @param {Record<string, unknown> | null | undefined} prior
 * @param {{ title?: string; title_original?: string; savedAt?: string | number }} titlePatch
 * @returns {Record<string, unknown>}
 */
export function mergePersistentTitleEntry(prior, titlePatch = {}) {
    const base = prior && typeof prior === 'object' && !Array.isArray(prior) ? { ...prior } : {};
    const title = titlePatch.title != null ? String(titlePatch.title) : String(base.title || '');
    const titleOriginal =
        titlePatch.title_original != null
            ? String(titlePatch.title_original)
            : title || String(base.title_original || base.title || '');
    const savedAt =
        titlePatch.savedAt != null ? titlePatch.savedAt : new Date().toISOString();
    return {
        ...base,
        title,
        title_original: titleOriginal,
        savedAt
    };
}

/**
 * Apply a title-only patch onto a full titles map (immutable).
 *
 * @param {Record<string, Record<string, unknown>> | null | undefined} map
 * @param {string} reelId
 * @param {{ title?: string; title_original?: string; savedAt?: string | number }} titlePatch
 * @returns {Record<string, Record<string, unknown>>}
 */
export function mergeTitleIntoPersistentMap(map, reelId, titlePatch = {}) {
    const id = String(reelId || '').trim();
    const next = map && typeof map === 'object' && !Array.isArray(map) ? { ...map } : {};
    if (!id || !String(titlePatch?.title || '').trim()) return next;
    const prior = next[id] && typeof next[id] === 'object' ? next[id] : {};
    next[id] = mergePersistentTitleEntry(prior, titlePatch);
    return next;
}
