import { resolveEpisodeAccessPricing } from './episodeAccessPricing.js';
import { lookupVicGEpisodeBinding } from './vicGSeriesPackage.js';

/**
 * @param {number | undefined} episodeNumber
 * @param {{ badgeLabel?: string }} access
 */
export function buildPaywallGateMessage(episodeNumber, access) {
    const episodeLine =
        Number.isFinite(episodeNumber) && Number(episodeNumber) > 0
            ? `Episode ${episodeNumber}`
            : 'This episode';
    if (access?.badgeLabel) {
        return `${episodeLine} is ${access.badgeLabel}. Pay or subscribe to continue.`;
    }
    return `${episodeLine} requires paid access. Pay or subscribe to continue.`;
}

/**
 * Resolve access + lock context for a reel before Theater playback starts.
 *
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {{
 *   hasAccessEntitlement?: boolean;
 *   seriesCtx?: { series?: Record<string, unknown>; season?: Record<string, unknown>; episode?: Record<string, unknown> } | null;
 * }} [options]
 */
export function evaluatePlaybackPaywallGate(reel, options = {}) {
    if (!reel || typeof reel !== 'object') {
        return { blocked: false, access: null, pendingLockedEpisode: null, message: '' };
    }
    if (options.hasAccessEntitlement) {
        return { blocked: false, access: null, pendingLockedEpisode: null, message: '' };
    }

    const reelId = String(reel.id || reel.reelId || reel.mediaAssetId || '').trim();
    const series = options.seriesCtx?.series;
    const episode = options.seriesCtx?.episode;
    const vicBinding = reelId ? lookupVicGEpisodeBinding(reelId) : null;

    const access = resolveEpisodeAccessPricing({
        episode: episode || {
            episodeNumber: reel.episodeNumber ?? reel.episode_number,
            episodeId: reel.episodeId ?? reel.episode_id,
            accessMode: reel.accessMode ?? reel.access_mode,
            price: reel.price
        },
        mediaAssetId: String(reel.mediaAssetId || reelId),
        reelId,
        vaultAsset: reel,
        seriesId: String(series?.id || reel.seriesId || reel.series_id || vicBinding?.seriesId || ''),
        seriesAccessMode: series?.accessMode ?? series?.access_mode,
        freeEpisodeCount: series?.freeEpisodeCount ?? series?.free_episode_count
    });

    if (access.mode === 'free') {
        return { blocked: false, access, pendingLockedEpisode: null, message: '' };
    }

    const episodeNumber = Number(
        episode?.episodeNumber ?? reel.episodeNumber ?? reel.episode_number ?? vicBinding?.episodeNumber
    );
    const episodeId = String(
        episode?.episodeId ??
            reel.episodeId ??
            reel.episode_id ??
            vicBinding?.episodeId ??
            ''
    ).trim();

    return {
        blocked: true,
        access,
        message: buildPaywallGateMessage(
            Number.isFinite(episodeNumber) ? episodeNumber : undefined,
            access
        ),
        pendingLockedEpisode: {
            episodeId,
            reelId,
            episodeNumber: Number.isFinite(episodeNumber) ? episodeNumber : undefined,
            mode: access.mode,
            price: access.price
        }
    };
}
