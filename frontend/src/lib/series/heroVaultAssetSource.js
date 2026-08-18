/**
 * Canonical ready Hero Vault asset source for Series surfaces.
 * Same pipeline for Creator Catalog picker, SeasonAccordion, and SeriesPublicPage.
 *
 * Does not alter upload, Hero Vault storage format, or keyword matching.
 */

import { loadHeroVaultItems } from '../hero/heroIntelligence.js';
import { mediaPathAssetId } from '../content/persistentTitleMap.js';
import {
    filterReadyVaultAssets,
    isReadyVaultAsset,
    assetIdOf,
    isVideoAsset,
    isImageAsset
} from './episodeVaultResolver.js';
import { withVaultSeriesIdentity } from './vaultSeriesInference.js';

/**
 * Same-id JPEG/PNG rows must donate a still to the MP4 row (All Episodes posters).
 * @param {Record<string, unknown>} existing
 * @param {Record<string, unknown>} incoming
 */
function mergeSameIdVaultPoster(existing, incoming) {
    const existingUrl = String(existing?.url || existing?.mediaUrl || existing?.src || '').trim();
    const incomingUrl = String(incoming?.url || incoming?.mediaUrl || incoming?.src || '').trim();
    const existingVideo = isVideoAsset(existingUrl, String(existing?.type || ''));
    const incomingVideo = isVideoAsset(incomingUrl, String(incoming?.type || ''));
    const video = existingVideo ? existing : incomingVideo ? incoming : existing;
    const other = video === existing ? incoming : existing;
    const videoThumb = String(
        video?.thumbnailUrl || video?.thumbnail_url || video?.thumbnail || video?.posterUrl || ''
    ).trim();
    if (videoThumb && !isVideoAsset(videoThumb, '')) return video;

    const otherUrl = String(other?.url || other?.mediaUrl || other?.src || '').trim();
    const otherIsImage =
        isImageAsset(otherUrl, String(other?.type || '')) ||
        isImageAsset(String(other?.thumbnailUrl || ''), '');
    const still = String(
        other?.thumbnailUrl ||
            other?.thumbnail_url ||
            other?.thumbnail ||
            other?.posterUrl ||
            (otherIsImage ? otherUrl : '') ||
            ''
    ).trim();
    if (!still || isVideoAsset(still, '')) return video;
    return { ...video, thumbnailUrl: still, thumbnail: still };
}

/**
 * @param {Record<string, unknown>} item
 */
function playbackKeyOf(item) {
    const url = String(item?.url || item?.mediaUrl || item?.src || '').trim();
    return mediaPathAssetId({ ...item, url, mediaUrl: url }) || '';
}

/**
 * Catalog feed row and vault personal-id row for the same R2 MP4 must share one still.
 * Keeps both ids (picker / binding) but stamps a usable thumb onto every twin that lacks one.
 * @param {Record<string, unknown>[]} items
 * @returns {Record<string, unknown>[]}
 */
function mergePlaybackAliasPosters(items) {
    /** @type {Map<string, Record<string, unknown>[]>} */
    const groups = new Map();
    for (const item of items) {
        const key = playbackKeyOf(item).toLowerCase();
        if (!key) continue;
        const list = groups.get(key) || [];
        list.push(item);
        groups.set(key, list);
    }
    if (!groups.size) return items;

    /** @type {WeakMap<Record<string, unknown>, string>} */
    const donated = new WeakMap();
    for (const list of groups.values()) {
        if (list.length < 2) continue;
        let still = '';
        for (const item of list) {
            const thumb = String(
                item?.thumbnailUrl || item?.thumbnail_url || item?.thumbnail || item?.posterUrl || ''
            ).trim();
            if (thumb && !isVideoAsset(thumb, '')) {
                still = thumb;
                break;
            }
            const url = String(item?.url || item?.mediaUrl || item?.src || '').trim();
            if (isImageAsset(url, String(item?.type || ''))) {
                still = url;
                break;
            }
        }
        if (!still) continue;
        for (const item of list) {
            const thumb = String(
                item?.thumbnailUrl || item?.thumbnail_url || item?.thumbnail || item?.posterUrl || ''
            ).trim();
            if (thumb && !isVideoAsset(thumb, '')) continue;
            donated.set(item, still);
        }
    }
    if (!donated.size) return items;
    return items.map((item) => {
        const still = donated.get(item);
        if (!still) return item;
        return { ...item, thumbnailUrl: still, thumbnail: still };
    });
}

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
        if (!id) continue;
        const withIdentity = withVaultSeriesIdentity(item) || item;
        const prev = byId.get(id);
        if (!prev) {
            byId.set(id, withIdentity);
            continue;
        }
        byId.set(id, mergeSameIdVaultPoster(prev, withIdentity));
    }
    return mergePlaybackAliasPosters([...byId.values()]);
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
