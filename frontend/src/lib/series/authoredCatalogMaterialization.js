/**
 * Vault → Catalog materialization — creator-confirmed identity only.
 *
 * Uses resolveCreatorConfirmedVaultIdentity + vault episodeEnrichment for titles.
 * Does not infer creative identity from filenames, reel_titles_persistent, or NLP.
 */

import { get } from 'svelte/store';
import {
    attachEpisodeReel,
    detachEpisodeReel,
    getEpisodeById,
    getSeriesById,
    seriesCatalog,
    updateCatalogEpisode
} from './seriesStore.js';
import { slugifySeriesKey } from './vaultSeriesInference.js';
import { readVaultEpisodeEnrichment } from './vaultEpisodeEnrichment.js';

/**
 * @typedef {Object} CreatorConfirmedSeriesIdentity
 * @property {string} seriesLabel
 * @property {number} seasonNumber
 * @property {number} episodeNumber
 * @property {true} confirmedByCreator
 */

/**
 * @typedef {Object} CreatorConfirmedVaultCatalogMetadata
 * @property {string} title Vault episodeEnrichment.title only
 * @property {string} description Vault episodeEnrichment.description only
 * @property {null} tags Unavailable at vault identity boundary
 */

/**
 * @typedef {Object} CreatorConfirmedVaultIdentitySuccess
 * @property {true} ok
 * @property {string} mediaAssetId Vault upload UUID (asset.id)
 * @property {string | null} reelId Only when explicitly present on vault row
 * @property {null} seriesId Not vault-owned — catalog materialization boundary
 * @property {null} episodeId Not vault-owned — catalog materialization boundary
 * @property {CreatorConfirmedSeriesIdentity} seriesIdentity
 * @property {CreatorConfirmedVaultCatalogMetadata} creatorCatalogMetadata
 */

/**
 * @typedef {Object} CreatorConfirmedVaultIdentityFailure
 * @property {false} ok
 * @property {'missing-vault-asset' | 'incomplete-vault-identity' | 'missing-media-id' | 'creator-confirmation-required'} reason
 */

/** @typedef {CreatorConfirmedVaultIdentitySuccess | CreatorConfirmedVaultIdentityFailure} CreatorConfirmedVaultIdentityResult */

/**
 * @param {unknown} value
 */
function cleanSeriesBase(value) {
    return String(value || '')
        .replace(/[\s\-_.]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @param {unknown} value
 */
function positiveInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.max(1, Math.floor(n));
}

/**
 * @param {string} value
 */
function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve creator-confirmed vault identity from persisted vault authority only.
 *
 * Does not infer from filenames, read reel_titles_persistent, or fabricate catalog ids.
 * Candidate/inferred identity (confirmedByCreator !== true) fails with creator-confirmation-required.
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {CreatorConfirmedVaultIdentityResult}
 */
export function resolveCreatorConfirmedVaultIdentity(asset) {
    if (!asset || typeof asset !== 'object') {
        return { ok: false, reason: 'missing-vault-asset' };
    }

    const nested =
        asset.seriesIdentity && typeof asset.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.seriesIdentity)
            : null;
    const seriesLabel = cleanSeriesBase(
        nested?.seriesLabel || nested?.series_label || asset.seriesLabel || asset.series_label || ''
    );
    const seasonNumber = positiveInt(nested?.seasonNumber ?? nested?.season_number ?? asset.seasonNumber);
    const episodeNumber = positiveInt(
        nested?.episodeNumber ?? nested?.episode_number ?? asset.episodeNumber
    );
    const mediaAssetId = String(asset.id || asset.mediaAssetId || asset.assetId || '').trim();

    if (!seriesLabel || seasonNumber == null || episodeNumber == null) {
        return { ok: false, reason: 'incomplete-vault-identity' };
    }
    if (!mediaAssetId) {
        return { ok: false, reason: 'missing-media-id' };
    }

    const confirmedByCreator =
        nested?.confirmedByCreator === true ||
        nested?.identitySource === 'creator' ||
        asset.confirmedByCreator === true;

    if (!confirmedByCreator) {
        return { ok: false, reason: 'creator-confirmation-required' };
    }

    const explicitReelId = String(asset.reelId || '').trim();
    const enrichment = readVaultEpisodeEnrichment(asset);

    return {
        ok: true,
        mediaAssetId,
        reelId: explicitReelId || null,
        seriesId: null,
        episodeId: null,
        seriesIdentity: {
            seriesLabel,
            seasonNumber,
            episodeNumber,
            confirmedByCreator: true
        },
        creatorCatalogMetadata: {
            title: String(enrichment.title || '').trim(),
            description: String(enrichment.description || '').trim(),
            tags: null
        }
    };
}

/**
 * Episode title for catalog materialization — vault enrichment only.
 * No filename, reel_titles_persistent, or resolveAuthoritativeEpisodeTitle fallback.
 *
 * @param {CreatorConfirmedVaultIdentitySuccess} identity
 */
function resolveCreatorAuthoredEpisodeTitle(identity) {
    const title = String(identity.creatorCatalogMetadata?.title || '').trim();
    if (title) return title;
    return `Episode ${identity.seriesIdentity.episodeNumber}`;
}

/**
 * Materialize or locate series shell from creator-confirmed seriesLabel only.
 * No title-based catalog merge — deterministic slug id from confirmed label.
 *
 * @param {string} seriesLabel
 */
function materializeCreatorAuthoredSeriesShell(seriesLabel) {
    const title = cleanSeriesBase(seriesLabel);
    if (!title) return null;

    const slug = slugifySeriesKey(title);
    const seriesId = `series-${slug}`;

    const existing = getSeriesById(seriesId);
    if (existing) return existing;

    /** @type {import('./seriesTypes.js').Series} */
    const created = {
        id: seriesId,
        title,
        description: '',
        tags: ['vault-authored'],
        seasons: [
            {
                seasonId: `season-${slug}-1`,
                seasonNumber: 1,
                title: 'Season 1',
                episodes: []
            }
        ]
    };

    seriesCatalog.update((items) => {
        if (items.some((s) => s.id === seriesId)) return items;
        return [...items, created];
    });

    return getSeriesById(seriesId) || created;
}

/**
 * Deterministic episode id from authored fields (matches vault bind conventions).
 *
 * @param {import('./seriesTypes.js').Series} series
 * @param {number} seasonNumber
 * @param {number} episodeNumber
 * @param {string} episodeTitle
 */
export function buildAuthoredEpisodeId(series, seasonNumber, episodeNumber, episodeTitle) {
    const slug = slugifySeriesKey(series.id.replace(/^series-/, '') || series.title);
    const humanTitle = cleanSeriesBase(episodeTitle) || `Episode ${episodeNumber}`;
    const titleSlug = slugifySeriesKey(humanTitle);
    const padS = String(seasonNumber).padStart(2, '0');
    const padE = String(episodeNumber).padStart(2, '0');
    const baseId = `ep-${slug}-s${padS}e${padE}`;

    const simpleNumber = new RegExp(
        `^${escapeRegExp(series.title || slug)}[\\s\\-_.]+${episodeNumber}$`,
        'i'
    );
    const simpleVersion = new RegExp(
        `^${escapeRegExp(series.title || slug)}[\\s\\-_.]+[Vv]${episodeNumber}$`,
        'i'
    );
    if (simpleVersion.test(humanTitle)) {
        return `${baseId}-v${episodeNumber}`;
    }
    if (!simpleNumber.test(humanTitle) && titleSlug && titleSlug !== slug) {
        return `${baseId}-${titleSlug}`.slice(0, 96);
    }
    return baseId;
}

/**
 * Materialize or locate episode shell from creator-confirmed S/E + vault title.
 *
 * @param {string} seriesId
 * @param {number} seasonNumber
 * @param {number} episodeNumber
 * @param {string} episodeTitle
 */
function materializeCreatorAuthoredEpisodeShell(
    seriesId,
    seasonNumber,
    episodeNumber,
    episodeTitle
) {
    const series = getSeriesById(seriesId);
    if (!series) return null;

    const humanTitle = cleanSeriesBase(episodeTitle) || `Episode ${episodeNumber}`;
    const episodeId = buildAuthoredEpisodeId(series, seasonNumber, episodeNumber, humanTitle);
    const existingCtx = getEpisodeById(episodeId);
    if (existingCtx?.episode) {
        if (humanTitle && existingCtx.episode.title !== humanTitle) {
            updateCatalogEpisode(episodeId, { title: humanTitle });
            return getEpisodeById(episodeId) || existingCtx;
        }
        return existingCtx;
    }

    const slug = slugifySeriesKey(seriesId.replace(/^series-/, '') || series.title);
    /** @type {import('./seriesTypes.js').Episode} */
    const episode = {
        episodeId,
        episodeNumber,
        title: humanTitle,
        status: 'ready',
        reelId: null,
        tags: ['vault-authored']
    };

    seriesCatalog.update((items) =>
        items.map((s) => {
            if (s.id !== seriesId) return s;
            const seasons = Array.isArray(s.seasons) ? [...s.seasons] : [];
            let seasonIdx = seasons.findIndex((se) => se.seasonNumber === seasonNumber);
            if (seasonIdx < 0) {
                seasons.push({
                    seasonId: `season-${slug}-${seasonNumber}`,
                    seasonNumber,
                    title: `Season ${seasonNumber}`,
                    episodes: [episode]
                });
            } else {
                const season = { ...seasons[seasonIdx] };
                const episodes = Array.isArray(season.episodes) ? [...season.episodes] : [];
                if (!episodes.some((e) => e.episodeId === episodeId)) {
                    episodes.push(episode);
                    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
                }
                season.episodes = episodes;
                seasons[seasonIdx] = season;
            }
            return { ...s, seasons };
        })
    );

    return getEpisodeById(episodeId) || { series, season: { seasonNumber }, episode };
}

/**
 * Detach media from catalog rows that conflict with the authored target.
 *
 * @param {string} mediaAssetId
 * @param {string} targetSeriesId
 * @param {string} targetEpisodeId
 */
function clearConflictingMediaBindings(mediaAssetId, targetSeriesId, targetEpisodeId) {
    const want = String(mediaAssetId || '').trim();
    if (!want) return;

    for (const series of get(seriesCatalog)) {
        for (const season of series.seasons || []) {
            for (const episode of season.episodes || []) {
                const reel = String(episode.reelId || '').trim();
                const media = String(episode.mediaAssetId || '').trim();
                const matches = reel === want || media === want;
                if (!matches) continue;
                if (series.id === targetSeriesId && episode.episodeId === targetEpisodeId) {
                    continue;
                }
                detachEpisodeReel(episode.episodeId, {
                    demotePublished: false,
                    clearMatchingMediaAsset: true
                });
            }
        }
    }
}

/**
 * Materialize catalog series/episode from creator-confirmed vault identity and bind media.
 *
 * Vault → Catalog boundary only. Requires resolveCreatorConfirmedVaultIdentity success.
 *
 * @param {Record<string, unknown> | null | undefined} vaultAsset
 */
export function materializeCreatorAuthoredCatalogProduction(vaultAsset) {
    const identity = resolveCreatorConfirmedVaultIdentity(vaultAsset);
    if (!identity.ok) {
        return identity;
    }

    const { mediaAssetId, seriesIdentity } = identity;
    const { seriesLabel, seasonNumber, episodeNumber } = seriesIdentity;
    const episodeTitle = resolveCreatorAuthoredEpisodeTitle(identity);

    const series = materializeCreatorAuthoredSeriesShell(seriesLabel);
    if (!series?.id) {
        return { ok: false, reason: 'series-materialization-failed' };
    }

    const ctx = materializeCreatorAuthoredEpisodeShell(
        series.id,
        seasonNumber,
        episodeNumber,
        episodeTitle
    );
    if (!ctx?.episode?.episodeId) {
        return { ok: false, reason: 'episode-materialization-failed' };
    }

    clearConflictingMediaBindings(mediaAssetId, series.id, ctx.episode.episodeId);

    if (String(ctx.episode.reelId || '').trim() !== mediaAssetId) {
        attachEpisodeReel(ctx.episode.episodeId, mediaAssetId);
    }

    const bound = getEpisodeById(ctx.episode.episodeId);
    if (!bound?.episode?.episodeId) {
        return { ok: false, reason: 'episode-bind-failed' };
    }

    return {
        ok: true,
        ctx: bound,
        mediaAssetId,
        authored: identity
    };
}
