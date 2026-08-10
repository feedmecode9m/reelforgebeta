/**
 * Creator Series Assembly — workspace over vault packages + catalog structure.
 *
 * Does not replace:
 *   - Hero Vault seriesIdentity authority
 *   - episode enrichment storage schema
 *   - catalog displayOrder / publish ownership
 *   - viewer discovery contracts
 *   - playback resolver
 *
 * Assembly only: completeness assessment, Ready gate, creator preview model.
 */

import { getReadyHeroVaultAssets, getReadyHeroVaultAssetById } from './heroVaultAssetSource.js';
import { readVaultEpisodeEnrichment } from './vaultEpisodeEnrichment.js';
import { sortEpisodesForDisplay } from './seriesCatalogEdits.js';
import {
    episodeIsViewerDiscoverable,
    filterSeriesSeasonsForAudience
} from './publishingLifecycle.js';
import { getSeriesById, setEpisodeStatus, seriesCatalog } from './seriesStore.js';
import { get } from 'svelte/store';
import { assetIdOf } from './episodeVaultResolver.js';

/**
 * @typedef {'confirmed' | 'missing'} AssemblyIdentityState
 * @typedef {'complete' | 'incomplete'} AssemblyPresentationState
 * @typedef {'available' | 'missing'} AssemblyMediaState
 * @typedef {'draft' | 'ready' | 'published' | 'archived'} AssemblyPublishState
 */

/**
 * @param {unknown} value
 */
function cleanText(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @param {unknown} value
 */
function cleanUrl(value) {
    return String(value || '').trim();
}

/**
 * Resolve playable media URL from a vault / reel shape.
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function resolveAssemblyMediaUrl(asset) {
    if (!asset || typeof asset !== 'object') return '';
    return cleanUrl(
        asset.url ||
            asset.video_url ||
            asset.videoUrl ||
            asset.playbackUrl ||
            asset.playback_url ||
            asset.mediaUrl ||
            ''
    );
}

/**
 * True when a vault identity triple is complete (Hero Vault authority only).
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function vaultIdentityIsConfirmed(asset) {
    if (!asset || typeof asset !== 'object') return false;
    const nested =
        asset.seriesIdentity && typeof asset.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.seriesIdentity)
            : null;
    const seriesLabel = cleanText(
        nested?.seriesLabel || nested?.series_label || asset.seriesLabel || asset.series_label || ''
    );
    const seasonNumber = Number(nested?.seasonNumber ?? nested?.season_number ?? asset.seasonNumber);
    const episodeNumber = Number(
        nested?.episodeNumber ?? nested?.episode_number ?? asset.episodeNumber
    );
    return Boolean(
        seriesLabel &&
            Number.isFinite(seasonNumber) &&
            seasonNumber >= 1 &&
            Number.isFinite(episodeNumber) &&
            episodeNumber >= 1
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function readVaultIdentityLabels(asset) {
    if (!asset || typeof asset !== 'object') {
        return { seriesLabel: '', seasonNumber: null, episodeNumber: null };
    }
    const nested =
        asset.seriesIdentity && typeof asset.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.seriesIdentity)
            : null;
    const seriesLabel = cleanText(
        nested?.seriesLabel || nested?.series_label || asset.seriesLabel || ''
    );
    const seasonNumber = Number(nested?.seasonNumber ?? nested?.season_number ?? asset.seasonNumber);
    const episodeNumber = Number(
        nested?.episodeNumber ?? nested?.episode_number ?? asset.episodeNumber
    );
    return {
        seriesLabel,
        seasonNumber:
            Number.isFinite(seasonNumber) && seasonNumber >= 1 ? Math.floor(seasonNumber) : null,
        episodeNumber:
            Number.isFinite(episodeNumber) && episodeNumber >= 1 ? Math.floor(episodeNumber) : null
    };
}

/**
 * Map catalog episode → matching ready vault asset (mediaAssetId / reelId / binding).
 * @param {import('./seriesTypes.js').Episode | null | undefined} episode
 * @param {Record<string, unknown>[]} [vaultAssets]
 */
export function resolveVaultAssetForEpisode(episode, vaultAssets) {
    if (!episode) return null;
    const assets = Array.isArray(vaultAssets) ? vaultAssets : getReadyHeroVaultAssets();
    const candidates = [
        episode.mediaAssetId,
        episode.heroVaultAssetId,
        episode.reelId
    ]
        .map((v) => String(v || '').trim())
        .filter(Boolean);
    for (const id of candidates) {
        const hit = assets.find((a) => assetIdOf(a) === id || String(a?.id || '').trim() === id);
        if (hit) return hit;
        const byLookup = getReadyHeroVaultAssetById(id, { items: assets });
        if (byLookup) return byLookup;
    }
    return null;
}

/**
 * Presentation package fields (vault enrichment preferred, catalog fallback).
 * @param {import('./seriesTypes.js').Episode | null | undefined} episode
 * @param {Record<string, unknown> | null | undefined} vaultAsset
 */
export function resolveEpisodePresentationFields(episode, vaultAsset) {
    const enrich = readVaultEpisodeEnrichment(vaultAsset);
    const title = cleanText(enrich.title || episode?.title || '');
    const description = cleanText(
        enrich.description || episode?.description || ''
    );
    const artworkUrl = cleanUrl(
        enrich.artworkUrl ||
            episode?.thumbnailAssetId ||
            /** @type {{ poster?: string; thumbnailUrl?: string }} */ (episode || {})
                .thumbnailUrl ||
            /** @type {{ poster?: string }} */ (episode || {}).poster ||
            vaultAsset?.thumbnailUrl ||
            vaultAsset?.thumbnail ||
            vaultAsset?.posterUrl ||
            ''
    );
    /** @type {string[]} */
    const missing = [];
    if (!title) missing.push('title');
    if (!description) missing.push('description');
    if (!artworkUrl) missing.push('artwork');
    return {
        title,
        description,
        artworkUrl,
        missing,
        state: /** @type {AssemblyPresentationState} */ (
            missing.length === 0 ? 'complete' : 'incomplete'
        )
    };
}

/**
 * Requirements for transitioning an episode into catalog status `ready`.
 * Does not auto-publish. Does not change lifecycle enum meanings.
 *
 * @param {import('./seriesTypes.js').Episode | null | undefined} episode
 * @param {Record<string, unknown> | null | undefined} vaultAsset
 */
export function evaluateEpisodeReadyRequirements(episode, vaultAsset) {
    /** @type {string[]} */
    const missing = [];
    const identityOk = vaultIdentityIsConfirmed(vaultAsset);
    if (!identityOk) missing.push('confirmed Hero Vault identity');

    const mediaUrl = resolveAssemblyMediaUrl(vaultAsset);
    const mediaId = cleanText(
        vaultAsset
            ? assetIdOf(vaultAsset) || vaultAsset.id
            : episode?.mediaAssetId || episode?.reelId || ''
    );
    const mediaOk = Boolean(mediaUrl && mediaId) || Boolean(mediaUrl && episode?.reelId);
    if (!mediaOk) missing.push('playable media');

    const presentation = resolveEpisodePresentationFields(episode, vaultAsset);
    if (!presentation.title) missing.push('title');
    if (!presentation.description) missing.push('description');
    if (!presentation.artworkUrl) missing.push('artwork');

    return {
        ok: missing.length === 0,
        missing,
        identityOk,
        mediaOk,
        presentation
    };
}

/**
 * @param {import('./seriesTypes.js').Episode} episode
 * @param {Record<string, unknown> | null | undefined} vaultAsset
 * @param {{ seasonNumber?: number }} [context]
 */
export function assessEpisodeAssembly(episode, vaultAsset, context = {}) {
    const identityLabels = readVaultIdentityLabels(vaultAsset);
    const identityState = /** @type {AssemblyIdentityState} */ (
        vaultIdentityIsConfirmed(vaultAsset) ? 'confirmed' : 'missing'
    );
    const presentation = resolveEpisodePresentationFields(episode, vaultAsset);
    const mediaUrl = resolveAssemblyMediaUrl(vaultAsset);
    const mediaState = /** @type {AssemblyMediaState} */ (
        mediaUrl ? 'available' : 'missing'
    );
    const publishStatus = /** @type {AssemblyPublishState} */ (
        episode?.status === 'draft' ||
        episode?.status === 'ready' ||
        episode?.status === 'published' ||
        episode?.status === 'archived'
            ? episode.status
            : 'draft'
    );
    const ready = evaluateEpisodeReadyRequirements(episode, vaultAsset);
    const seasonNumber =
        Number(context.seasonNumber) >= 1
            ? Number(context.seasonNumber)
            : identityLabels.seasonNumber || 1;
    const episodeNumber =
        Number(episode?.episodeNumber) >= 1
            ? Number(episode.episodeNumber)
            : identityLabels.episodeNumber || 1;

    return {
        episodeId: String(episode?.episodeId || ''),
        seasonNumber,
        episodeNumber,
        displayOrder: Number.isFinite(Number(episode?.displayOrder))
            ? Number(episode.displayOrder)
            : undefined,
        seriesLabel: identityLabels.seriesLabel || '',
        identity: {
            state: identityState,
            seriesLabel: identityLabels.seriesLabel || '',
            seasonNumber: identityLabels.seasonNumber,
            episodeNumber: identityLabels.episodeNumber
        },
        presentation: {
            state: presentation.state,
            title: presentation.title,
            description: presentation.description,
            artworkUrl: presentation.artworkUrl,
            missing: presentation.missing
        },
        media: {
            state: mediaState,
            mediaAssetId: cleanText(
                episode?.mediaAssetId ||
                    episode?.heroVaultAssetId ||
                    episode?.reelId ||
                    (vaultAsset && (assetIdOf(vaultAsset) || vaultAsset.id)) ||
                    ''
            ),
            url: mediaUrl
        },
        publishing: {
            status: publishStatus,
            viewerDiscoverable: episodeIsViewerDiscoverable(episode)
        },
        readyRequirements: ready,
        canMarkReady: ready.ok
    };
}

/**
 * Full series assembly overview: seasons → episodes by displayOrder.
 *
 * @param {import('./seriesTypes.js').Series | string | null | undefined} seriesOrId
 * @param {Record<string, unknown>[]} [vaultAssets]
 */
export function buildSeriesAssemblyOverview(seriesOrId, vaultAssets) {
    const series =
        typeof seriesOrId === 'string'
            ? getSeriesById(seriesOrId)
            : seriesOrId && typeof seriesOrId === 'object'
              ? seriesOrId
              : null;
    if (!series) {
        return {
            seriesId: '',
            title: '',
            description: '',
            poster: '',
            seasons: [],
            episodeCount: 0,
            readyCount: 0,
            publishedCount: 0
        };
    }
    const assets = Array.isArray(vaultAssets) ? vaultAssets : getReadyHeroVaultAssets();
    /** @type {Array<{ seasonNumber: number; title: string; description: string; poster: string; episodes: ReturnType<typeof assessEpisodeAssembly>[] }>} */
    const seasons = [];
    let readyCount = 0;
    let publishedCount = 0;
    let episodeCount = 0;

    for (const season of [...(series.seasons || [])].sort(
        (a, b) => Number(a.seasonNumber) - Number(b.seasonNumber)
    )) {
        const sorted = sortEpisodesForDisplay(season.episodes || []);
        const episodes = sorted.map((ep) => {
            const asset = resolveVaultAssetForEpisode(ep, assets);
            const assessed = assessEpisodeAssembly(ep, asset, {
                seasonNumber: season.seasonNumber
            });
            episodeCount += 1;
            if (assessed.canMarkReady || assessed.publishing.status === 'ready') readyCount += 1;
            if (assessed.publishing.status === 'published') publishedCount += 1;
            return assessed;
        });
        seasons.push({
            seasonNumber: Number(season.seasonNumber) || 1,
            title: cleanText(season.title) || `Season ${season.seasonNumber}`,
            description: cleanText(season.description),
            poster: cleanUrl(/** @type {{ poster?: string }} */ (season).poster || ''),
            episodes
        });
    }

    return {
        seriesId: String(series.id || ''),
        title: cleanText(series.title),
        description: cleanText(series.description),
        poster: cleanUrl(series.poster || ''),
        seasons,
        episodeCount,
        readyCount,
        publishedCount
    };
}

/**
 * Creator-only series preview model (includes draft/ready — not public discoverability).
 * @param {import('./seriesTypes.js').Series | null | undefined} series
 * @param {Record<string, unknown>[]} [vaultAssets]
 */
export function buildCreatorSeriesPreview(series, vaultAssets) {
    if (!series) return null;
    const audience = filterSeriesSeasonsForAudience(series, { viewerMode: false });
    const assets = Array.isArray(vaultAssets) ? vaultAssets : getReadyHeroVaultAssets();
    const overview = buildSeriesAssemblyOverview(audience || series, assets);

    return {
        mode: /** @type {'creator-preview'} */ ('creator-preview'),
        publicDiscoverable: false,
        seriesId: overview.seriesId,
        title: overview.title,
        description: overview.description,
        poster: overview.poster,
        seasons: overview.seasons.map((s) => ({
            seasonNumber: s.seasonNumber,
            title: s.title,
            description: s.description,
            poster: s.poster,
            episodes: s.episodes.map((e) => ({
                episodeId: e.episodeId,
                displayOrder: e.displayOrder,
                episodeNumber: e.episodeNumber,
                seriesLabel: e.seriesLabel || e.identity.seriesLabel,
                title: e.presentation.title,
                description: e.presentation.description,
                artworkUrl: e.presentation.artworkUrl,
                status: e.publishing.status,
                identityLine:
                    e.identity.state === 'confirmed' && e.identity.seriesLabel
                        ? `${e.identity.seriesLabel} • S${e.identity.seasonNumber} • E${e.identity.episodeNumber}`
                        : `S${e.seasonNumber} • E${e.episodeNumber}`,
                mediaAvailable: e.media.state === 'available'
            }))
        }))
    };
}

/**
 * Attempt to mark an episode Ready — blocked when package incomplete.
 * Does not publish. Does not change lifecycle rules for other statuses.
 *
 * @param {string} episodeId
 * @param {{ vaultAssets?: Record<string, unknown>[] }} [options]
 * @returns {{ ok: boolean; episode?: import('./seriesTypes.js').Episode; missing: string[]; message: string }}
 */
export function attemptMarkEpisodeReady(episodeId, options = {}) {
    const id = String(episodeId || '').trim();
    if (!id) {
        return { ok: false, missing: ['episode'], message: 'Episode required' };
    }
    const catalog = get(seriesCatalog) || [];
    /** @type {import('./seriesTypes.js').Episode | null} */
    let episode = null;
    for (const series of catalog) {
        for (const season of series.seasons || []) {
            const hit = (season.episodes || []).find((e) => e.episodeId === id);
            if (hit) {
                episode = hit;
                break;
            }
        }
        if (episode) break;
    }
    if (!episode) {
        return { ok: false, missing: ['episode'], message: 'Episode not found' };
    }

    const assets = Array.isArray(options.vaultAssets)
        ? options.vaultAssets
        : getReadyHeroVaultAssets();
    const vaultAsset = resolveVaultAssetForEpisode(episode, assets);
    const req = evaluateEpisodeReadyRequirements(episode, vaultAsset);
    if (!req.ok) {
        return {
            ok: false,
            missing: req.missing,
            message: `Cannot mark Ready — missing: ${req.missing.join(', ')}`
        };
    }

    const updated = setEpisodeStatus(id, 'ready');
    if (!updated?.episode) {
        return { ok: false, missing: [], message: 'Status update failed' };
    }
    return {
        ok: true,
        episode: updated.episode,
        missing: [],
        message: 'Episode marked Ready (not published)'
    };
}

/**
 * True when list only contains viewer-discoverable (published) episodes.
 * Guards that assembly does not widen public discovery.
 * @param {import('./seriesTypes.js').Episode[]} episodes
 */
export function publishedFilterUnchanged(episodes) {
    const list = Array.isArray(episodes) ? episodes : [];
    const discoverable = list.filter((e) => episodeIsViewerDiscoverable(e));
    return discoverable.every((e) => e.status === 'published');
}
