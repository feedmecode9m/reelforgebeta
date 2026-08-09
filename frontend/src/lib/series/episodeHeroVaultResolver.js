/**
 * Adapter: episode object ↔ Hero Vault bind fields.
 * Canonical keyword matching lives in episodeVaultResolver.js.
 */

import {
    resolveEpisodeVaultAsset,
    theaterReelFromVaultResolve,
    filterReadyVaultAssets,
    isReadyVaultAsset,
    extractKeywords,
    normalizeTitle,
    scoreEpisodeAgainstAsset,
    logEpisodeVaultResolve
} from './episodeVaultResolver.js';

export {
    filterReadyVaultAssets as collectReadyHeroVaultAssets,
    isReadyVaultAsset as isReadyHeroVaultAsset,
    extractKeywords,
    normalizeTitle as normalizeEpisodeMatchKey,
    resolveEpisodeVaultAsset,
    scoreEpisodeAgainstAsset
};

/**
 * @param {import('./seriesTypes.js').Episode | null | undefined} episode
 * @param {Record<string, unknown>[]} [readyVaultItems]
 */
export function resolveEpisodeHeroVaultBinding(episode, readyVaultItems = []) {
    const title = String(episode?.title || '');
    const aliases = Array.isArray(episode?.aliases) ? episode.aliases.map(String) : [];

    let resolved = resolveEpisodeVaultAsset(title, readyVaultItems);
    let usedLabel = title;
    if (!resolved.matched) {
        for (const alias of aliases) {
            resolved = resolveEpisodeVaultAsset(alias, readyVaultItems);
            if (resolved.matched) {
                usedLabel = alias;
                break;
            }
        }
    }

    if (!resolved.matched) {
        return {
            mediaAssetId: episode?.mediaAssetId ? String(episode.mediaAssetId) : null,
            thumbnailAssetId: episode?.thumbnailAssetId ? String(episode.thumbnailAssetId) : null,
            aliases,
            matchTier: null,
            matchLabel: '',
            mediaUrl: '',
            thumbnailUrl: '',
            ready: false,
            unavailable: true,
            mediaAsset: null,
            thumbnailAsset: null
        };
    }

    return {
        mediaAssetId: resolved.assetId,
        thumbnailAssetId: null,
        aliases,
        matchTier: resolved.matchTier,
        matchLabel: usedLabel,
        mediaUrl: resolved.mediaUrl,
        thumbnailUrl: resolved.thumbnail || '',
        ready: true,
        unavailable: false,
        mediaAsset: { id: resolved.assetId, type: resolved.type },
        thumbnailAsset: resolved.thumbnail
            ? { id: resolved.assetId, url: resolved.thumbnail }
            : null
    };
}

/**
 * @param {import('./seriesTypes.js').Episode} episode
 * @param {ReturnType<typeof resolveEpisodeHeroVaultBinding>} binding
 */
export function applyHeroVaultBindingToEpisode(episode, binding) {
    if (!episode) return episode;
    return {
        ...episode,
        mediaAssetId: binding.mediaAssetId || episode.mediaAssetId || null,
        thumbnailAssetId: binding.thumbnailAssetId || episode.thumbnailAssetId || null,
        aliases: Array.isArray(episode.aliases) ? episode.aliases : binding.aliases || []
    };
}

/**
 * @param {import('./seriesTypes.js').Episode} episode
 * @param {ReturnType<typeof resolveEpisodeHeroVaultBinding>} binding
 * @param {{ seriesId?: string; seasonNumber?: number } | null} [ctx]
 */
export function theaterReelFromHeroVaultBinding(episode, binding, ctx = null) {
    if (!binding?.ready || !binding.mediaAssetId || !binding.mediaUrl) return null;
    return theaterReelFromVaultResolve(
        String(episode?.title || ''),
        {
            matched: true,
            assetId: binding.mediaAssetId,
            thumbnail: binding.thumbnailUrl || '',
            mediaUrl: binding.mediaUrl,
            type: binding.mediaAsset?.type === 'image' ? 'image' : 'video',
            title: String(episode?.title || ''),
            keywords: extractKeywords(episode?.title),
            matchTier: /** @type {'exact' | 'primary' | 'fuzzy' | 'fallback'} */ (
                binding.matchTier || 'primary'
            ),
            score: 0
        },
        {
            episodeId: episode?.episodeId,
            seriesId: ctx?.seriesId,
            seasonNumber: ctx?.seasonNumber,
            episodeNumber: episode?.episodeNumber
        }
    );
}

/**
 * @param {import('./seriesTypes.js').Episode} episode
 * @param {Record<string, unknown>[]} readyVaultItems
 */
export function enrichEpisodeWithHeroVaultBinding(episode, readyVaultItems = []) {
    const binding = resolveEpisodeHeroVaultBinding(episode, readyVaultItems);
    return {
        episode: applyHeroVaultBindingToEpisode(episode, binding),
        binding
    };
}

/** @param {unknown} detail */
export function logEpisodeHeroVaultBind(detail = {}) {
    logEpisodeVaultResolve(detail);
}

/**
 * @param {string} assetTitle
 * @param {string[]} labels
 */
export function scoreAssetAgainstEpisodeLabels(assetTitle, labels) {
    let best = { score: 0, tier: /** @type {null | string} */ (null), matchedLabel: '' };
    const assetStub = { title: assetTitle, name: assetTitle, id: 'asset-title-stub', url: '/videos/x.mp4', status: 'ready' };
    for (const label of labels) {
        const r = scoreEpisodeAgainstAsset(label, assetStub);
        if (r.score > best.score) {
            best = { score: r.score, tier: r.tier, matchedLabel: label };
        }
    }
    return best;
}
