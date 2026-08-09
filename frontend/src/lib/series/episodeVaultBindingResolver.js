/**
 * Episode media resolution with optional manual Hero Vault override.
 *
 * Priority:
 *   1. Manual episode.heroVaultAssetId (when still ready in vault)
 *   2. Automatic resolveEpisodeVaultAsset (keyword family)
 *   3. Unmatched / unavailable
 *
 * When manual id is missing from ready vault: ignore stale mediaAssetId
 * and fall back to auto (presentation must not keep orphan id).
 *
 * Does not modify matching algorithm inside episodeVaultResolver.js.
 */

import {
    resolveEpisodeVaultAsset,
    filterReadyVaultAssets,
    isReadyVaultAsset,
    assetIdOf,
    isVideoAsset,
    isImageAsset,
    extractKeywords
} from './episodeVaultResolver.js';

/**
 * @typedef {'manual' | 'auto' | null} EpisodeVaultBindingMode
 */

/**
 * @typedef {{
 *   matched: true;
 *   assetId: string;
 *   thumbnail: string;
 *   mediaUrl: string;
 *   type: 'video' | 'image';
 *   title: string;
 *   keywords: string[];
 *   matchTier: string;
 *   score: number;
 *   bindingMode: 'manual' | 'auto';
 *   bindingLabel: 'Manual Vault Asset' | 'Auto matched';
 *   staleManualCleared?: boolean;
 * } | {
 *   matched: false;
 *   bindingMode: null;
 *   bindingLabel: 'Asset unavailable';
 *   assetId: null;
 *   mediaAssetId: null;
 *   staleManualCleared?: boolean;
 * }} EpisodeMediaResolveResult
 */

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function mediaUrlOf(item) {
    return String(
        item?.url ||
            item?.videoUrl ||
            item?.video_url ||
            item?.mediaUrl ||
            item?.src ||
            ''
    ).trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function thumbOf(item) {
    return String(
        item?.thumbnailUrl ||
            item?.thumbnail_url ||
            item?.thumbnail ||
            item?.posterUrl ||
            item?.poster_url ||
            ''
    ).trim();
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
function titleOf(item) {
    return String(
        item?.title || item?.name || item?.fileName || item?.file_name || item?.id || ''
    ).trim();
}

/**
 * Build a matched result from a ready vault record (manual pick).
 * @param {Record<string, unknown>} asset
 * @returns {Extract<EpisodeMediaResolveResult, { matched: true }>}
 */
export function resolveResultFromReadyAsset(asset) {
    const mediaUrl = mediaUrlOf(asset);
    const mime = String(asset?.type || '');
    const type = isVideoAsset(mediaUrl, mime)
        ? /** @type {'video'} */ ('video')
        : isImageAsset(mediaUrl, mime)
          ? /** @type {'image'} */ ('image')
          : /** @type {'video'} */ ('video');
    let thumbnail = thumbOf(asset);
    if (!thumbnail && type === 'image') thumbnail = mediaUrl;

    return {
        matched: true,
        assetId: assetIdOf(asset),
        thumbnail: thumbnail || '',
        mediaUrl,
        type,
        title: titleOf(asset),
        keywords: extractKeywords(titleOf(asset)),
        matchTier: 'manual',
        score: Number.MAX_SAFE_INTEGER,
        bindingMode: 'manual',
        bindingLabel: 'Manual Vault Asset'
    };
}

/**
 * @param {import('./seriesTypes.js').Episode | null | undefined} episode
 * @param {Record<string, unknown>[]} ready
 * @returns {Extract<EpisodeMediaResolveResult, { matched: true }> | null}
 */
function resolveAuto(episode, ready) {
    const title = String(episode?.title || '').trim();
    const auto = title ? resolveEpisodeVaultAsset(title, ready) : { matched: false };

    if (auto && auto.matched) {
        return {
            ...auto,
            bindingMode: 'auto',
            bindingLabel: 'Auto matched'
        };
    }

    const aliases = Array.isArray(episode?.aliases) ? episode.aliases : [];
    for (const alias of aliases) {
        const hit = resolveEpisodeVaultAsset(String(alias || ''), ready);
        if (hit?.matched) {
            return {
                ...hit,
                bindingMode: 'auto',
                bindingLabel: 'Auto matched'
            };
        }
    }
    return null;
}

/**
 * Resolve episode media: manual override → auto keyword resolver → unavailable.
 *
 * @param {{
 *   episode: import('./seriesTypes.js').Episode | null | undefined;
 *   readyVaultAssets?: Record<string, unknown>[];
 * }} input
 * @returns {EpisodeMediaResolveResult}
 */
export function resolveEpisodeMedia(input = {}) {
    const episode = input.episode;
    const readyVaultAssets = Array.isArray(input.readyVaultAssets) ? input.readyVaultAssets : [];
    const ready = filterReadyVaultAssets(readyVaultAssets);

    const manualId = String(episode?.heroVaultAssetId || '').trim();
    let staleManualCleared = false;

    if (manualId) {
        const manualAsset = ready.find((item) => assetIdOf(item) === manualId) || null;
        if (manualAsset && isReadyVaultAsset(manualAsset)) {
            return resolveResultFromReadyAsset(manualAsset);
        }
        // Manual id stale / not ready → ignore stale mediaAssetId; auto-only path.
        staleManualCleared = true;
    }

    // Never present unmatched with orphan episode.mediaAssetId — resolution result only.
    const autoHit = resolveAuto(episode, ready);
    if (autoHit) {
        return staleManualCleared ? { ...autoHit, staleManualCleared: true } : autoHit;
    }

    return {
        matched: false,
        bindingMode: null,
        bindingLabel: 'Asset unavailable',
        assetId: null,
        mediaAssetId: null,
        staleManualCleared
    };
}

/**
 * Presentation fields for chips: never expose stale mediaAssetId when unmatched.
 * @param {import('./seriesTypes.js').Episode | null | undefined} episode
 * @param {EpisodeMediaResolveResult} result
 */
export function episodeChipPresentation(episode, result) {
    if (result?.matched) {
        return {
            mediaAssetId: result.assetId,
            thumbnailUrl: result.thumbnail || '',
            matchTier: result.matchTier,
            bindingLabel: result.bindingLabel,
            playable: true,
            bindingMode: result.bindingMode
        };
    }
    return {
        mediaAssetId: null,
        thumbnailUrl: '',
        matchTier: null,
        bindingLabel: 'Asset unavailable',
        playable: false,
        bindingMode: null
    };
}

/**
 * Display label for chip UI.
 * @param {EpisodeMediaResolveResult} result
 */
export function episodeMediaBindingLabel(result) {
    if (!result?.matched) return 'Asset unavailable';
    if (result.bindingMode === 'manual') return 'Manual Vault Asset';
    return 'Auto matched';
}
