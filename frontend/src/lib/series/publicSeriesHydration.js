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

/**
 * Display title for Hero Vault pickable rows (does not change picker layout).
 * Priority: title → name → metadata.title → cleaned filename → Untitled Vault Asset
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {string}
 */
export function resolveVaultAssetDisplayTitle(asset) {
    if (!asset || typeof asset !== 'object') return 'Untitled Vault Asset';

    const candidates = [
        asset.title,
        asset.name,
        asset.metadata && typeof asset.metadata === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.metadata).title
            : null,
        asset.fileName,
        asset.file_name,
        asset.originalName,
        asset.original_name
    ];

    for (const c of candidates) {
        const t = String(c || '').trim();
        if (!t) continue;
        // Skip pure UUID looks
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t)) {
            continue;
        }
        return t;
    }

    // Filename-like path fragments
    for (const c of [asset.url, asset.videoUrl, asset.video_url, asset.mediaUrl]) {
        const raw = String(c || '').trim();
        if (!raw || raw.startsWith('blob:')) continue;
        const base = raw.split('?')[0].split('#')[0].split('/').pop() || '';
        const cleaned = base
            .replace(/\.(mp4|mov|webm|m4v|avi|mkv|jpg|jpeg|png|webp)$/i, '')
            .replace(/[_-]+/g, ' ')
            .trim();
        if (
            cleaned &&
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                cleaned
            )
        ) {
            return cleaned;
        }
    }

    return 'Untitled Vault Asset';
}

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

    const list = Array.isArray(catalog) ? catalog : get(seriesCatalog);
    const byId = getSeriesById(`series-${key}`) || list.find((s) => s.id === `series-${key}`);
    if (byId) return byId;

    const needle = slugifySeriesKey(key);
    return (
        list.find((s) => slugifySeriesKey(s.id?.replace(/^series-/, '') || '') === needle) ||
        list.find((s) => slugifySeriesKey(s.title) === needle) ||
        null
    );
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
