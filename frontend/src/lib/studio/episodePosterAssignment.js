/**
 * Thumbnail Vault → canonical episode poster assignment helpers.
 *
 * Poster authority: Episode.thumbnailUrl / episodes.thumbnail_url (URL-only V1).
 * Does not mutate reelId, mediaAssetId, or episodeId.
 */

import { toRelativeMediaPath } from '../config.js';
import { lookupPersistentTitleEntry } from '../content/persistentTitleMap.js';
import {
    assignEpisodePoster,
    getEpisodeByMediaIdentity,
    getEpisodeById,
    persistEpisodeRowToApi,
    persistCreatorAuthoredCatalogProduction
} from '../series/seriesStore.js';
import { resolveCreatorConfirmedVaultIdentity } from '../series/authoredCatalogMaterialization.js';
import { getEpisodeCatalogEdit } from '../series/seriesCatalogEdits.js';
import { pickDurableVaultStillUrl } from '../vault/vaultCreatorAuthority.js';
import { isVaultVideoMediaUrl } from '../vault/normalizeVaultAsset.js';
import { durableImageVaultUrl } from '../viewer/vaultUtils.js';
import {
    isAuthoritativeCatalogBinding,
    resolveCanonicalCatalogOwner
} from '../series/canonicalCatalogOwnership.js';

const REEL_TITLES_PERSISTENT_KEY = 'reel_titles_persistent';

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTitle(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * @param {unknown} row
 * @returns {string}
 */
function mediaRowTitle(row) {
    if (!row || typeof row !== 'object') return '';
    const entry = /** @type {Record<string, unknown>} */ (row);
    return String(entry.name || entry.title || entry.fileName || '').trim();
}

/**
 * @param {unknown} asset
 * @returns {string}
 */
function videoAssetReelId(asset) {
    if (!asset || typeof asset !== 'object') return '';
    const row = /** @type {Record<string, unknown>} */ (asset);
    return String(row.id || row.mediaAssetId || row.reelId || row.personal_video_id || '').trim();
}

/**
 * @param {unknown} entry
 * @returns {string[]}
 */
function linkedMediaIdsFromThumbnail(entry) {
    if (!entry || typeof entry !== 'object') return [];
    const row = /** @type {Record<string, unknown>} */ (entry);
    /** @type {string[]} */
    const ordered = [
        row.personal_video_id,
        row.personalVideoId,
        row.linkedVideoId,
        row.sourceReelId,
        row.videoId,
        row.video_id,
        row.reelId,
        row.mediaAssetId
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    const seen = new Set();
    return ordered.filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

/**
 * @param {string} mediaId
 * @returns {{
 *   series: import('../series/seriesTypes.js').Series;
 *   season: import('../series/seriesTypes.js').Season;
 *   episode: import('../series/seriesTypes.js').Episode;
 * } | null}
 */
function resolveAuthoritativeOwnerForMediaId(mediaId) {
    const id = String(mediaId || '').trim();
    if (!id) return null;
    const canonical = resolveCanonicalCatalogOwner(id);
    if (canonical) return canonical;
    const ctx = getEpisodeByMediaIdentity(id);
    if (ctx && isAuthoritativeCatalogBinding(ctx)) return ctx;
    return null;
}

/**
 * @param {{ persistentTitleMap?: Record<string, unknown> }} [options]
 * @returns {Record<string, unknown>}
 */
function loadPersistentTitleMap(options = {}) {
    if (options.persistentTitleMap && typeof options.persistentTitleMap === 'object') {
        return /** @type {Record<string, unknown>} */ (options.persistentTitleMap);
    }
    if (typeof window !== 'undefined') {
        try {
            return JSON.parse(localStorage.getItem(REEL_TITLES_PERSISTENT_KEY) || '{}');
        } catch {
            return {};
        }
    }
    return {};
}

/**
 * @param {unknown} thumbnailEntry
 * @param {Record<string, unknown>} map
 * @returns {string}
 */
function resolveTitleFromPersistentMap(thumbnailEntry, map) {
    const rec = lookupPersistentTitleEntry(map, thumbnailEntry);
    if (!rec) return '';
    return String(rec.title || rec.title_original || '').trim();
}

/**
 * @param {string} episodeId
 * @param {import('../series/seriesTypes.js').Series[]} catalog
 * @returns {{
 *   seriesId: string;
 *   seasonNumber: number;
 *   episodeId: string;
 * } | null}
 */
export function resolveEpisodeCatalogSelection(episodeId, catalog) {
    const eid = String(episodeId || '').trim();
    if (!eid) return null;
    for (const series of catalog || []) {
        for (const season of series?.seasons || []) {
            for (const episode of season?.episodes || []) {
                if (String(episode?.episodeId || '').trim() !== eid) continue;
                const seriesId = String(series?.id || '').trim();
                if (!seriesId) return null;
                return {
                    seriesId,
                    seasonNumber: Number(season?.seasonNumber) || 1,
                    episodeId: eid
                };
            }
        }
    }
    return null;
}

function findMatchingVideoAssets(thumbnailEntry, videoAssets) {
    const thumbTitle = normalizeTitle(mediaRowTitle(thumbnailEntry));
    if (!thumbTitle) return [];
    /** @type {unknown[]} */
    const exact = [];
    /** @type {unknown[]} */
    const partial = [];
    for (const asset of videoAssets || []) {
        const videoTitle = normalizeTitle(mediaRowTitle(asset));
        if (!videoTitle) continue;
        if (videoTitle === thumbTitle) exact.push(asset);
        else if (videoTitle.includes(thumbTitle) || thumbTitle.includes(videoTitle)) {
            partial.push(asset);
        }
    }
    if (exact.length === 1) return exact;
    if (exact.length > 1) return [];
    if (partial.length === 1) return partial;
    return [];
}

/**
 * Resolve the canonical episode target for a Thumbnail Vault poster assignment.
 *
 * Priority:
 *   1) Linked playable media ids on the thumbnail entry (personal_video_id, etc.)
 *   2) Unique Video Vault title match → authoritative reel owner
 *
 * The thumbnail image UUID alone is never assumed to be the playable reel id.
 *
 * @param {unknown} thumbnailEntry
 * @param {{ videoAssets?: unknown[] }} [options]
 * @returns {{
 *   seriesId: string;
 *   seasonNumber: number;
 *   episodeId: string;
 *   reelId: string | null;
 *   reason: string;
 * } | null}
 */
export function resolvePosterAssignmentTarget(thumbnailEntry, options = {}) {
    if (!thumbnailEntry || typeof thumbnailEntry !== 'object') return null;

    for (const mediaId of linkedMediaIdsFromThumbnail(thumbnailEntry)) {
        const owner = resolveAuthoritativeOwnerForMediaId(mediaId);
        if (owner?.series?.id && owner?.episode?.episodeId) {
            return {
                seriesId: String(owner.series.id),
                seasonNumber: Number(owner.season?.seasonNumber) || 1,
                episodeId: String(owner.episode.episodeId),
                reelId: owner.episode.reelId ? String(owner.episode.reelId) : null,
                reason: 'linked-media-id'
            };
        }
    }

    const videoAssets = Array.isArray(options.videoAssets) ? options.videoAssets : [];
    const titleMatchSources = [thumbnailEntry];
    const persistentTitle = resolveTitleFromPersistentMap(
        thumbnailEntry,
        loadPersistentTitleMap(options)
    );
    if (persistentTitle) {
        titleMatchSources.push({
            ...(typeof thumbnailEntry === 'object' ? thumbnailEntry : {}),
            name: persistentTitle,
            title: persistentTitle
        });
    }

    for (const source of titleMatchSources) {
        const matches = findMatchingVideoAssets(source, videoAssets);
        if (matches.length !== 1) continue;
        const reelId = videoAssetReelId(matches[0]);
        const owner = resolveAuthoritativeOwnerForMediaId(reelId);
        if (owner?.series?.id && owner?.episode?.episodeId) {
            return {
                seriesId: String(owner.series.id),
                seasonNumber: Number(owner.season?.seasonNumber) || 1,
                episodeId: String(owner.episode.episodeId),
                reelId: owner.episode.reelId ? String(owner.episode.reelId) : null,
                reason: source === thumbnailEntry ? 'video-title-match' : 'persistent-title-match'
            };
        }
    }

    return null;
}

/**
 * Canonical browser/API poster URL from a Thumbnail Vault entry.
 * @param {unknown} entry
 * @returns {string}
 */
export function resolveThumbnailVaultPosterUrl(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const row = /** @type {Record<string, unknown>} */ (entry);
    const raw = String(row.url || row.thumbnailUrl || '').trim();
    if (!raw) return '';
    const relative = toRelativeMediaPath(raw);
    return String(relative || raw).trim();
}

/**
 * Normalize poster URLs for equality checks (ingest still vs Thumbnail Vault vs catalog).
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePosterCompareUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const relative = toRelativeMediaPath(raw) || raw;
    try {
        if (/^https?:\/\//i.test(relative)) {
            const parsed = new URL(relative);
            return `${parsed.pathname}${parsed.search}`.toLowerCase();
        }
    } catch {
        /* keep relative */
    }
    return String(relative).toLowerCase();
}

/**
 * Distinguish creator-confirmed posters from ingest stills mirrored on catalog episodes.
 *
 * @param {import('../series/seriesTypes.js').Episode | null | undefined} episode
 * @param {unknown} vaultAsset
 * @param {{
 *   seriesId?: string;
 *   readyReels?: unknown[];
 *   thumbnailVaultEntries?: unknown[];
 * }} [options]
 * @returns {{
 *   state: 'unassigned' | 'thumbnail-vault' | 'mp4-still' | 'catalog';
 *   assigned: boolean;
 *   displayUrl: string;
 *   stillPreviewUrl: string;
 *   canUseMp4AsPoster: boolean;
 *   canFeatureOnHome: boolean;
 *   statusLabel: string;
 *   assignSource: 'thumbnail-vault' | 'mp4-still' | null;
 * }}
 */
export function resolveVaultEditorialPosterState(episode, vaultAsset, options = {}) {
    const seriesId = String(options.seriesId || '').trim();
    const episodeId = String(episode?.episodeId || '').trim();
    const catalogUrl = String(episode?.thumbnailUrl || '').trim();
    const still = resolveMp4PosterStillUrl(vaultAsset, options);
    const stillUrl = still.ok ? still.stillUrl : '';
    const edit = seriesId && episodeId ? getEpisodeCatalogEdit(seriesId, episodeId) : null;
    const assignSource =
        edit?.posterAssignSource === 'thumbnail-vault' || edit?.posterAssignSource === 'mp4-still'
            ? edit.posterAssignSource
            : null;

    const thumbnailVaultUrls = (Array.isArray(options.thumbnailVaultEntries)
        ? options.thumbnailVaultEntries
        : []
    )
        .map((entry) => resolveThumbnailVaultPosterUrl(entry))
        .filter(Boolean);

    const catalogNorm = normalizePosterCompareUrl(catalogUrl);
    const stillNorm = normalizePosterCompareUrl(stillUrl);
    const matchesIngestStill = Boolean(catalogNorm && stillNorm && catalogNorm === stillNorm);
    const matchesThumbnailVault =
        Boolean(catalogNorm) &&
        thumbnailVaultUrls.some((url) => normalizePosterCompareUrl(url) === catalogNorm);

    const bound = Boolean(episodeId);

    if (!catalogUrl) {
        return {
            state: 'unassigned',
            assigned: false,
            displayUrl: '',
            stillPreviewUrl: stillUrl,
            canUseMp4AsPoster: bound && still.ok && Boolean(stillUrl),
            canFeatureOnHome: bound && still.ok && Boolean(stillUrl),
            statusLabel: 'No editorial poster assigned',
            assignSource: null
        };
    }

    if (assignSource === 'thumbnail-vault' || matchesThumbnailVault) {
        return {
            state: 'thumbnail-vault',
            assigned: true,
            displayUrl: catalogUrl,
            stillPreviewUrl: '',
            canUseMp4AsPoster: false,
            canFeatureOnHome: bound && episode?.status !== 'published',
            statusLabel: 'Thumbnail Vault poster assigned',
            assignSource: 'thumbnail-vault'
        };
    }

    if (assignSource === 'mp4-still') {
        return {
            state: 'mp4-still',
            assigned: true,
            displayUrl: catalogUrl,
            stillPreviewUrl: '',
            canUseMp4AsPoster: false,
            canFeatureOnHome: bound && episode?.status !== 'published',
            statusLabel: 'MP4 still assigned as poster',
            assignSource: 'mp4-still'
        };
    }

    if (matchesIngestStill) {
        return {
            state: 'unassigned',
            assigned: false,
            displayUrl: '',
            stillPreviewUrl: stillUrl,
            canUseMp4AsPoster: bound && still.ok && Boolean(stillUrl),
            canFeatureOnHome: bound && still.ok && Boolean(stillUrl),
            statusLabel: 'No editorial poster assigned',
            assignSource: null
        };
    }

    return {
        state: 'catalog',
        assigned: true,
        displayUrl: catalogUrl,
        stillPreviewUrl: '',
        canUseMp4AsPoster: false,
        canFeatureOnHome: bound && episode?.status !== 'published',
        statusLabel: 'Poster on file (catalog)',
        assignSource: null
    };
}

/**
 * @param {import('../series/seriesTypes.js').Series[]} catalog
 */
export function listCatalogSeriesOptions(catalog) {
    /** @type {Array<{ id: string; title: string }>} */
    const items = [];
    for (const series of catalog || []) {
        const id = String(series?.id || '').trim();
        if (!id) continue;
        items.push({
            id,
            title: String(series?.title || id).trim() || id
        });
    }
    return items.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * @param {import('../series/seriesTypes.js').Series[]} catalog
 * @param {string} seriesId
 */
export function listSeasonOptionsForSeries(catalog, seriesId) {
    const sid = String(seriesId || '').trim();
    if (!sid) return [];
    const series = (catalog || []).find((row) => String(row?.id || '') === sid);
    /** @type {Array<{ seasonNumber: number; title: string; label: string }>} */
    const items = [];
    for (const season of series?.seasons || []) {
        const seasonNumber = Number(season?.seasonNumber);
        if (!Number.isFinite(seasonNumber) || seasonNumber < 1) continue;
        const title = String(season?.title || '').trim() || `Season ${seasonNumber}`;
        items.push({ seasonNumber, title, label: title });
    }
    return items.sort((a, b) => a.seasonNumber - b.seasonNumber);
}

/**
 * @param {import('../series/seriesTypes.js').Series[]} catalog
 * @param {string} seriesId
 * @param {number} seasonNumber
 */
export function listEpisodeOptionsForSeason(catalog, seriesId, seasonNumber) {
    const sid = String(seriesId || '').trim();
    const sn = Number(seasonNumber);
    if (!sid || !Number.isFinite(sn)) return [];
    const series = (catalog || []).find((row) => String(row?.id || '') === sid);
    const season = (series?.seasons || []).find((row) => Number(row?.seasonNumber) === sn);
    /** @type {Array<{
     *   episodeId: string;
     *   episodeNumber: number;
     *   title: string;
     *   reelId: string | null;
     *   thumbnailUrl: string;
     *   label: string;
     * }>} */
    const items = [];
    for (const episode of season?.episodes || []) {
        const episodeId = String(episode?.episodeId || '').trim();
        if (!episodeId) continue;
        const episodeNumber = Number(episode?.episodeNumber) || 0;
        const title = String(episode?.title || '').trim() || `Episode ${episodeNumber || '?'}`;
        items.push({
            episodeId,
            episodeNumber,
            title,
            reelId: episode?.reelId ? String(episode.reelId) : null,
            thumbnailUrl: String(episode?.thumbnailUrl || '').trim(),
            label: `E${String(episodeNumber).padStart(2, '0')} — ${title}`
        });
    }
    return items.sort((a, b) => a.episodeNumber - b.episodeNumber);
}

/**
 * Resolve the durable ingest still for a Video Vault MP4 (no Thumbnail Vault write).
 *
 * Priority:
 *   1) Explicit still fields on the vault asset or matching ready reel row
 *   2) Convention `/thumbs/{reelId}.jpg` from ingest ffmpeg pipeline
 *
 * @param {unknown} vaultAsset
 * @param {{ readyReels?: unknown[] }} [options]
 * @returns {{ ok: boolean; stillUrl: string; reelId: string; reason?: string }}
 */
export function resolveMp4PosterStillUrl(vaultAsset, options = {}) {
    const reelId = videoAssetReelId(vaultAsset);
    if (!reelId) {
        return { ok: false, stillUrl: '', reelId: '', reason: 'missing-reel-id' };
    }

    const readyReels = Array.isArray(options.readyReels) ? options.readyReels : [];
    const readyRow =
        readyReels.find((row) => videoAssetReelId(row) === reelId) || null;

    const candidates = [
        pickDurableVaultStillUrl(vaultAsset),
        pickDurableVaultStillUrl(readyRow),
        durableImageVaultUrl(
            vaultAsset && typeof vaultAsset === 'object'
                ? { id: reelId, .../** @type {Record<string, unknown>} */ (vaultAsset) }
                : { id: reelId },
            vaultAsset
        )
    ];

    for (const candidate of candidates) {
        const stillUrl = String(candidate || '').trim();
        if (!stillUrl || isVaultVideoMediaUrl(stillUrl)) continue;
        return { ok: true, stillUrl, reelId };
    }

    return { ok: false, stillUrl: '', reelId, reason: 'no-valid-still' };
}

/**
 * Hero/Video Vault **Make poster** — bind ingest MP4 still to canonical episode.thumbnailUrl.
 * Does not mutate reelId, seriesId, or publish. Skips when editorial poster already set.
 *
 * @param {string} mediaAssetId
 * @param {unknown} vaultAsset
 * @param {{ readyReels?: unknown[]; thumbnailVaultEntries?: unknown[] }} [options]
 */
export async function useMp4AsEpisodePoster(mediaAssetId, vaultAsset, options = {}) {
    const id = String(mediaAssetId || videoAssetReelId(vaultAsset) || '').trim();
    if (!id) {
        return { ok: false, reason: 'missing-media-id' };
    }

    const ctx = getEpisodeByMediaIdentity(id);
    if (!ctx?.episode?.episodeId) {
        return { ok: false, reason: 'episode-not-bound' };
    }

    const posterState = resolveVaultEditorialPosterState(ctx.episode, vaultAsset, {
        seriesId: ctx.series?.id,
        ...options
    });
    if (posterState.assigned) {
        return {
            ok: false,
            reason: 'poster-already-set',
            thumbnailUrl: String(ctx.episode.thumbnailUrl || '').trim()
        };
    }

    const still = resolveMp4PosterStillUrl(vaultAsset, options);
    if (!still.ok || !still.stillUrl) {
        return { ok: false, reason: still.reason || 'no-valid-still' };
    }

    const assigned = await assignEpisodePoster(ctx.episode.episodeId, still.stillUrl, {
        source: 'mp4-still'
    });
    if (!assigned.ok) {
        return assigned;
    }

    return {
        ...assigned,
        stillUrl: still.stillUrl,
        reelId: ctx.episode.reelId || still.reelId || null
    };
}

/**
 * Assign poster (MP4 still when needed) and publish episode for Original Productions browse.
 * Works from Hero Vault and Video Vault when the MP4 is bound to a catalog episode.
 *
 * @param {string} mediaAssetId
 * @param {unknown} vaultAsset
 * @param {{
 *   readyReels?: unknown[];
 *   thumbnailVaultEntries?: unknown[];
 *   posterUrl?: string;
 * }} [options]
 */
export async function featureEpisodeOnOriginalProductions(mediaAssetId, vaultAsset, options = {}) {
    const id = String(mediaAssetId || videoAssetReelId(vaultAsset) || '').trim();
    if (!id) {
        return { ok: false, reason: 'missing-media-id' };
    }

    const authoredIdentity = resolveCreatorConfirmedVaultIdentity(vaultAsset);
    let ctx = getEpisodeByMediaIdentity(id);

    if (authoredIdentity.ok) {
        const reconciled = await persistCreatorAuthoredCatalogProduction(
            vaultAsset && typeof vaultAsset === 'object'
                ? { ...vaultAsset, id: String(vaultAsset.id || id).trim() || id }
                : { id }
        );
        if (!reconciled.ok) {
            return reconciled;
        }
        ctx = reconciled.ctx || getEpisodeByMediaIdentity(id);
    }

    if (!ctx?.episode?.episodeId) {
        return {
            ok: false,
            reason: authoredIdentity.ok ? 'episode-reconcile-failed' : 'episode-not-bound'
        };
    }

    const posterState = resolveVaultEditorialPosterState(ctx.episode, vaultAsset, {
        seriesId: ctx.series?.id,
        ...options
    });

    let thumbnailUrl = String(options.posterUrl || '').trim();
    if (!posterState.assigned) {
        if (!thumbnailUrl) {
            const still = resolveMp4PosterStillUrl(vaultAsset, options);
            if (!still.ok || !still.stillUrl) {
                return { ok: false, reason: still.reason || 'no-valid-still' };
            }
            thumbnailUrl = still.stillUrl;
        }
        const assigned = await assignEpisodePoster(ctx.episode.episodeId, thumbnailUrl, {
            source: 'mp4-still'
        });
        if (!assigned.ok) {
            return assigned;
        }
    } else {
        thumbnailUrl = String(ctx.episode.thumbnailUrl || posterState.displayUrl || '').trim();
    }

    let published = ctx.episode.status === 'published';
    if (!published) {
        const persist = await persistEpisodeRowToApi(ctx.episode.episodeId, {
            applyCatalogStatus: 'published'
        });
        if (!persist.ok) {
            return { ok: false, reason: persist.reason || 'publish-api-failed' };
        }
        published = true;
    }

    const after = getEpisodeById(ctx.episode.episodeId);
    return {
        ok: true,
        episodeId: ctx.episode.episodeId,
        seriesId: ctx.series?.id || after?.series?.id || '',
        seriesTitle: String(ctx.series?.title || after?.series?.title || '').trim(),
        thumbnailUrl: String(after?.episode?.thumbnailUrl || thumbnailUrl).trim(),
        published,
        featured: true
    };
}
