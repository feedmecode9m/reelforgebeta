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
    seriesCatalog,
    reapplyCreatorCatalogAuthorityToStore
} from './seriesStore.js';
import { get } from 'svelte/store';
import { getReadyHeroVaultAssets } from './heroVaultAssetSource.js';
import {
    inferAndBindVaultSeries,
    applyCanonicalEpisodeMetadataFromVault,
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
 * Authority:
 *   - Catalog API / seriesCatalog already holds publish status, episodeId, displayOrder, package titles.
 *   - Vault supplies mediaAssetId / seriesIdentity / enrichment for bound reels.
 *   - Vault inference may bind media for unbound reels, but must not invent publication state
 *     or renumber/replace catalog identity.
 *   - Non-creator package membership that conflicts with high-confidence NLP is re-homed
 *     (or detached for medium/weak) via reconcileCatalogMembershipFromVault before bind-only attach.
 *
 * Flow:
 *   ready vault assets → membership reconcile → bind-only inference → restore episode vault bindings → creator catalog authority
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

    // Snapshot catalog publish identity before vault bind so we can reassert after.
    const preCatalog = get(seriesCatalog);
    const preStatuses = snapshotCatalogEpisodeAuthority(preCatalog);

    // Inference treats ready assets as vault reels (id + url + title) — no media copy.
    // Must not overwrite status / S/E labels / package titles on existing catalog rows.
    const inference = inferAndBindVaultSeries(readyAssets, {
        source: options.source || 'public-series-vault-hydration'
    });

    rehydrateEpisodeVaultBindings();

    // Ensure catalog episodes still wear any leftover map if rehydrate raced with inference.
    const map = loadEpisodeVaultBindingMap();
    if (Object.keys(map).length) {
        seriesCatalog.update((items) => applyStoredBindingsToCatalog(items, map));
    }

    // Creator order + publishing must win over vault defaults after public hydrate
    try {
        reapplyCreatorCatalogAuthorityToStore();
    } catch {
        /* store may still be cold */
    }

    // Restore publish status + episode numbers + catalog package titles if vault bind clobbered them.
    if (preStatuses.size) {
        seriesCatalog.update((items) => reassertCatalogEpisodeAuthority(items, preStatuses));
        try {
            reapplyCreatorCatalogAuthorityToStore();
        } catch {
            /* non-fatal */
        }
    }

    // Phase 2: after reassert, re-apply high-confidence NLP over non-creator synthetic package en/titles.
    // Creator displayOrder / confirmed package identity remain locked; status was reasserted above.
    try {
        applyCanonicalEpisodeMetadataFromVault(readyAssets, {
            source: `${options.source || 'public-series-vault-hydration'}:metadata-after-reassert`
        });
        reapplyCreatorCatalogAuthorityToStore();
    } catch {
        /* non-fatal */
    }

    console.info('[PUBLIC_SERIES_VAULT_HYDRATION]', {
        readyCount: readyAssets.length,
        bound: inference.bound,
        seriesIds: inference.seriesIds,
        bindingKeys: Object.keys(map).length,
        authoritySnapshots: preStatuses.size,
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
 * @param {import('./seriesTypes.js').Series[] | null | undefined} catalog
 * @returns {Map<string, { status: string; episodeNumber: number; title: string; reelId: string | null }>}
 */
function snapshotCatalogEpisodeAuthority(catalog) {
    /** @type {Map<string, { status: string; episodeNumber: number; title: string; reelId: string | null }>} */
    const map = new Map();
    for (const series of Array.isArray(catalog) ? catalog : []) {
        for (const season of series.seasons || []) {
            for (const ep of season.episodes || []) {
                const id = String(ep?.episodeId || '').trim();
                if (!id) continue;
                map.set(id, {
                    status: String(ep.status || 'draft'),
                    episodeNumber: Number(ep.episodeNumber) || 1,
                    title: String(ep.title || ''),
                    reelId: ep.reelId != null ? String(ep.reelId) : null
                });
            }
        }
    }
    return map;
}

/**
 * Re-apply known catalog identity / publish fields after vault media bind.
 * Restores package status / S/E numbers / titles only.
 * Does NOT re-attach reelId/mediaAssetId from the pre-bind snapshot — membership
 * after NLP reconcile is the live store authority.
 *
 * @param {import('./seriesTypes.js').Series[]} catalog
 * @param {Map<string, { status: string; episodeNumber: number; title: string; reelId: string | null }>} snap
 */
function reassertCatalogEpisodeAuthority(catalog, snap) {
    if (!snap?.size) return catalog;
    return (Array.isArray(catalog) ? catalog : []).map((series) => ({
        ...series,
        seasons: (series.seasons || []).map((season) => ({
            ...season,
            episodes: (season.episodes || []).map((ep) => {
                const prev = snap.get(String(ep.episodeId || ''));
                if (!prev) return ep;
                return {
                    ...ep,
                    status: prev.status || ep.status,
                    episodeNumber:
                        Number.isFinite(prev.episodeNumber) && prev.episodeNumber >= 1
                            ? prev.episodeNumber
                            : ep.episodeNumber,
                    title: prev.title !== '' && prev.title != null ? prev.title : ep.title
                    // membership (reelId / mediaAssetId) stays live — snapshot must not re-bind media
                };
            })
        }))
    }));
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
