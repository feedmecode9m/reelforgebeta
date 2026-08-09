/**
 * Public Series hydration from Hero Vault ready assets.
 *
 * Keeps Hero Vault as the single media source of truth.
 * Rebuilds vault-inferred series/episodes into seriesCatalog so cold
 * navigations to /series/:slug resolve the same records Studio already sees.
 *
 * Does not upload, duplicate media, alter vault storage, Theater architecture,
 * or episodeVaultResolver keyword matching.
 */

import {
    initSeriesMetadata,
    rehydrateEpisodeVaultBindings,
    getSeriesById,
    seriesCatalog
} from './seriesStore.js';
import { get } from 'svelte/store';
import { getReadyHeroVaultAssets } from './heroVaultAssetSource.js';
import {
    inferAndBindVaultSeries,
    slugifySeriesKey
} from './vaultSeriesInference.js';
import {
    loadEpisodeVaultBindingMap,
    applyStoredBindingsToCatalog
} from './episodeVaultBindingStorage.js';
import { isDemoSeriesId } from './seriesCatalogTruth.js';

/**
 * Display title for Hero Vault pickable rows (canonical vault intelligence).
 * @see ../vault/resolveVaultAssetTitle.js
 */
export { resolveVaultAssetTitle as resolveVaultAssetDisplayTitle } from '../vault/resolveVaultAssetTitle.js';

/**
 * Resolve a public series slug against the live catalog.
 * Accepts "stirred", "series-stirred", or title-like keys.
 *
 * @param {string} rawSlug
 * @param {import('./seriesTypes.js').Series[] | null} [catalog]
 * @returns {import('./seriesTypes.js').Series | null}
 */
export function resolvePublicSeriesBySlug(rawSlug, catalog = null) {
    const key = String(rawSlug || '')
        .trim()
        .replace(/^series-/, '');
    if (!key) return null;

    // Slug is an identifier only — never invent series content from the path.
    const list = (Array.isArray(catalog) ? catalog : get(seriesCatalog)).filter(
        (s) => s && !isDemoSeriesId(s.id)
    );
    const byId = getSeriesById(`series-${key}`) || list.find((s) => s.id === `series-${key}`);
    if (byId) {
        return isDemoSeriesId(byId.id) ? null : byId;
    }

    const needle = slugifySeriesKey(key);
    const hit =
        list.find((s) => slugifySeriesKey(s.id?.replace(/^series-/, '') || '') === needle) ||
        list.find((s) => slugifySeriesKey(s.title) === needle) ||
        null;
    if (hit && isDemoSeriesId(hit.id)) return null;
    return hit;
}

/**
 * Stable public pathname for a series (always `/series/{slug}`).
 * @param {import('./seriesTypes.js').Series | null | undefined} series
 */
export function publicSeriesPath(series) {
    if (!series) return null;
    const slug = slugifySeriesKey(String(series.id || '').replace(/^series-/, '') || series.title);
    return slug ? `/series/${slug}` : null;
}

/**
 * Hydrate seriesCatalog from Hero Vault ready assets for public (and studio-parity) views.
 *
 * Flow:
 *   ready vault assets → title inference → seriesCatalog → restore episode vault bindings
 *
 * @param {{
 *   extraItems?: Record<string, unknown>[] | null;
 *   items?: Record<string, unknown>[] | null;
 *   initMetadata?: boolean;
 *   source?: string;
 * }} [options]
 * @returns {{
 *   readyAssets: Record<string, unknown>[];
 *   bound: number;
 *   seriesIds: string[];
 *   bindingCount: number;
 * }}
 */
export function hydratePublicSeriesFromVault(options = {}) {
    if (options.initMetadata !== false) {
        try {
            initSeriesMetadata();
        } catch {
            /* store may already be initialized */
        }
    }

    const readyAssets = getReadyHeroVaultAssets({
        extraItems: options.extraItems,
        items: options.items
    });

    // Inference treats ready assets as vault reels (id + url + title) — no media copy.
    const inference = inferAndBindVaultSeries(readyAssets, {
        source: options.source || 'public-series-vault-hydration'
    });

    rehydrateEpisodeVaultBindings();

    // Ensure catalog episodes still wear any leftover map if rehydrate raced with inference.
    const map = loadEpisodeVaultBindingMap();
    if (Object.keys(map).length) {
        seriesCatalog.update((items) => applyStoredBindingsToCatalog(items, map));
    }

    console.info('[PUBLIC_SERIES_VAULT_HYDRATION]', {
        readyCount: readyAssets.length,
        bound: inference.bound,
        seriesIds: inference.seriesIds,
        bindingKeys: Object.keys(map).length,
        ts: new Date().toISOString()
    });

    return {
        readyAssets,
        bound: inference.bound,
        seriesIds: inference.seriesIds || [],
        bindingCount: Object.keys(map).length
    };
}

/**
 * Combined public bootstrap: hydrate catalog + return ready assets for chips/Theater.
 *
 * @param {{
 *   extraItems?: Record<string, unknown>[] | null;
 *   slug?: string;
 * }} [options]
 */
export function bootstrapPublicSeriesPage(options = {}) {
    const hydrated = hydratePublicSeriesFromVault({
        extraItems: options.extraItems,
        source: 'public-series-page'
    });
    const series = options.slug
        ? resolvePublicSeriesBySlug(options.slug, get(seriesCatalog))
        : null;
    return {
        ...hydrated,
        series,
        path: publicSeriesPath(series)
    };
}
