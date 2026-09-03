/**
 * Canonical catalog ownership — inference must not override established bindings.
 *
 * Precedence: existing authoritative catalog episode owns reel > Vault/NLP inference.
 * Based on the live catalog binding graph, not API hydration timing or persistence mode.
 */

import { getEpisodeByReelId } from './seriesStore.js';
import { VIC_G_SERIES_ID } from './vicGSeriesPackage.js';

/** Semantic Vic G episode ids (ep-vic-g-s01e04, …) — canonical catalog identity. */
const VIC_G_SEMANTIC_EPISODE_ID = /^ep-vic-g-s\d{2}e\d{2}/;

/**
 * Supplementary creator/binding authority signals (not the primary Vic G gate).
 *
 * @param {{
 *   series?: import('./seriesTypes.js').Series | null;
 *   episode?: import('./seriesTypes.js').Episode | null;
 * } | null | undefined} ctx
 */
function isCreatorConfirmedBinding(ctx) {
    const ep = ctx?.episode;
    const series = ctx?.series;
    if (!ep || !series) return false;
    const epRow = /** @type {Record<string, unknown>} */ (ep);
    if (
        epRow.confirmedByCreator === true ||
        epRow.identitySource === 'creator' ||
        epRow.bindingAuthority === 'creator' ||
        epRow.heroVaultBindingMode === 'manual'
    ) {
        return true;
    }
    const epTags = Array.isArray(ep.tags) ? ep.tags.map(String) : [];
    if (epTags.includes('creator-package') || epTags.includes('creator-confirmed')) return true;
    const seriesRow = /** @type {Record<string, unknown>} */ (series);
    if (seriesRow.confirmedByCreator === true) return true;
    const seriesTags = Array.isArray(series.tags) ? series.tags.map(String) : [];
    return seriesTags.includes('creator-confirmed');
}

/**
 * @param {{
 *   series?: import('./seriesTypes.js').Series | null;
 *   season?: import('./seriesTypes.js').Season | null;
 *   episode?: import('./seriesTypes.js').Episode | null;
 * } | null | undefined} ctx
 * @returns {boolean}
 */
export function isAuthoritativeCatalogBinding(ctx) {
    if (!ctx?.series?.id || !ctx?.episode) return false;

    const reelId = String(ctx.episode.reelId || ctx.episode.mediaAssetId || '').trim();
    if (!reelId) return false;

    if (isCreatorConfirmedBinding(ctx)) return true;
    if (/** @type {Record<string, unknown>} */ (ctx.episode).bindingAuthority === 'creator') {
        return true;
    }

    if (ctx.series.id === VIC_G_SERIES_ID) {
        const episodeId = String(ctx.episode.episodeId || '').trim();
        if (VIC_G_SEMANTIC_EPISODE_ID.test(episodeId)) return true;
    }

    return false;
}

/**
 * @param {string} reelId
 * @returns {{
 *   series: import('./seriesTypes.js').Series;
 *   season: import('./seriesTypes.js').Season;
 *   episode: import('./seriesTypes.js').Episode;
 * } | null}
 */
export function resolveCanonicalCatalogOwner(reelId) {
    const id = String(reelId || '').trim();
    if (!id) return null;
    const ctx = getEpisodeByReelId(id);
    if (!ctx || !isAuthoritativeCatalogBinding(ctx)) return null;
    return ctx;
}
