/**
 * Canonical ready Hero Vault asset source for Series surfaces.
 * Same pipeline for Creator Catalog picker, SeasonAccordion, and SeriesPublicPage.
 *
 * Does not alter upload, Hero Vault storage format, or keyword matching.
 */

import { loadHeroVaultItems } from '../hero/heroIntelligence.js';
import { filterReadyVaultAssets, isReadyVaultAsset, assetIdOf } from './episodeVaultResolver.js';
import { withVaultSeriesIdentity } from './vaultSeriesInference.js';

/**
 * Collect ready Hero Vault assets only (shared source).
 *
 * - pulls personal video vault, thumbnail vault, feed, optional live extras
 * - filters pending / failed / blob / placeholder
 * - exposes Hero Vault seriesIdentity when labels can be derived (non-destructive)
 *
 * @param {{
 *   extraItems?: Record<string, unknown>[] | null;
 *   items?: Record<string, unknown>[] | null;
 * }} [options]
 * - extraItems: live store rows merged into the vault load (e.g. feedReels / personalVideos)
 * - items: if provided, skip load and only filter this list
 * @returns {Record<string, unknown>[]}
 */
export function getReadyHeroVaultAssets(options = {}) {
    const direct = Array.isArray(options.items) ? options.items : null;
    /** @type {Record<string, unknown>[]} */
    let raw;
    if (direct) {
        raw = direct;
    } else {
        const extras = Array.isArray(options.extraItems) ? options.extraItems : null;
        try {
            raw = loadHeroVaultItems(extras);
        } catch {
            raw = Array.isArray(extras) ? extras : [];
        }
    }

    const ready = filterReadyVaultAssets(raw).filter((item) => isReadyVaultAsset(item));

    // Deduplicate by asset id (filter already ready-gated).
    /** @type {Map<string, Record<string, unknown>>} */
    const byId = new Map();
    for (const item of ready) {
        const id = assetIdOf(item);
        if (!id || byId.has(id)) continue;
        // Hero Vault identity first: attach seriesIdentity without mutating storage
        const withIdentity = withVaultSeriesIdentity(item) || item;
        byId.set(id, withIdentity);
    }
    return [...byId.values()];
}

/**
 * Lookup a single ready asset by id from the canonical source.
 * @param {string} assetId
 * @param {{ extraItems?: Record<string, unknown>[] | null; items?: Record<string, unknown>[] | null }} [options]
 */
export function getReadyHeroVaultAssetById(assetId, options = {}) {
    const id = String(assetId || '').trim();
    if (!id) return null;
    return getReadyHeroVaultAssets(options).find((item) => assetIdOf(item) === id) || null;
}
