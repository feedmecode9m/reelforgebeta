/**
 * Hero Vault creator-authority overlay for production hydrate/merge.
 *
 * Catalog/backend remains source of truth for mediaAssetId + playback URL.
 * Local vault retains creator-confirmed seriesIdentity and episodeEnrichment
 * across API projection so parser/API name inference cannot replace them.
 *
 * Does not own catalog displayOrder or publish status.
 */

import {
    hasVaultEpisodeEnrichment,
    normalizeVaultEpisodeEnrichment,
    readVaultEpisodeEnrichment
} from '../series/vaultEpisodeEnrichment.js';

/**
 * Fields written through persistPersonalVault → safeLocalStorageSet.
 * Keep in lockstep with viewerContext.persistPersonalVault.
 */
export const PERSONAL_VIDEO_VAULT_MINIMAL_FIELDS = [
    'id',
    'name',
    'title',
    'fileName',
    'type',
    'size',
    'addedAt',
    'thumbnail',
    'assetId',
    'url',
    'mediaUrl',
    'videoUrl',
    'thumbnailUrl',
    'posterUrl',
    'previewUrl',
    'localPreviewUrl',
    'status',
    'uploadState',
    'isOptimisticLocal',
    'uploadError',
    // Durable Hero Vault series identity (viewer-facing, no parser confidence)
    'seriesIdentity',
    'seriesLabel',
    'seasonNumber',
    'episodeNumber',
    // Durable creator presentation package
    'episodeEnrichment'
];

const VIDEO_STILL_SKIP = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i;

/**
 * Durable still URL from a vault/API row. Never blob/data and never a video file.
 * @param {Record<string, unknown> | null | undefined} row
 */
export function pickDurableVaultStillUrl(row) {
    if (!row || typeof row !== 'object') return '';
    const candidates = [
        row.thumbnailUrl,
        row.thumbnail_url,
        row.posterUrl,
        row.poster_url,
        row.poster,
        row.thumbnail,
        row.thumbnailPath,
        row.thumbnail_path,
        row.previewUrl
    ];
    for (const candidate of candidates) {
        const s = String(candidate ?? '').trim();
        if (!s) continue;
        if (s.startsWith('blob:') || s.startsWith('data:')) continue;
        if (VIDEO_STILL_SKIP.test(s)) continue;
        if (/\/videos\//i.test(s) && !/\/thumbs\//i.test(s)) continue;
        return s;
    }
    return '';
}

/**
 * Stamp camelCase still fields used by Vault card render + persist.
 * @param {Record<string, unknown>} entry
 * @param {string} [stillUrl]
 */
export function stampVaultStillFields(entry, stillUrl = '') {
    const still = String(stillUrl || pickDurableVaultStillUrl(entry) || '').trim();
    if (!still) return entry;
    return {
        ...entry,
        thumbnail: still,
        thumbnailUrl: still,
        posterUrl: still
    };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanSeriesBase(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.(mp4|mov|webm|m4v|avi|mkv)$/i, '');
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function positiveInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.floor(n);
}

/**
 * True when a seriesIdentity (or flat fields) carries creator confirmation.
 * @param {Record<string, unknown> | null | undefined} asset
 */
export function vaultIdentityIsCreatorConfirmed(asset) {
    if (!asset || typeof asset !== 'object') return false;
    const nested =
        asset.seriesIdentity && typeof asset.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.seriesIdentity)
            : null;
    return (
        nested?.confirmedByCreator === true ||
        nested?.identitySource === 'creator' ||
        asset.confirmedByCreator === true ||
        asset.identitySource === 'creator'
    );
}

/**
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {{ seriesLabel: string; seasonNumber: number; episodeNumber: number } | null}
 */
function readConfirmedIdentityTriple(asset) {
    if (!vaultIdentityIsCreatorConfirmed(asset)) return null;
    const nested =
        asset?.seriesIdentity && typeof asset.seriesIdentity === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.seriesIdentity)
            : null;
    const seriesLabel = cleanSeriesBase(
        nested?.seriesLabel || nested?.series_label || asset?.seriesLabel || asset?.series_label || ''
    );
    const seasonNumber = positiveInt(nested?.seasonNumber ?? nested?.season_number ?? asset?.seasonNumber);
    const episodeNumber = positiveInt(
        nested?.episodeNumber ?? nested?.episode_number ?? asset?.episodeNumber
    );
    if (!seriesLabel || seasonNumber == null || episodeNumber == null) return null;
    return { seriesLabel, seasonNumber, episodeNumber };
}

/**
 * Overlay local creator vault authority onto a catalog/API-derived vault row.
 * mediaAssetId and playback URL stay on the catalog row.
 *
 * @param {Record<string, unknown> | null | undefined} catalogEntry
 * @param {Record<string, unknown> | null | undefined} localEntry
 * @returns {Record<string, unknown> | null | undefined}
 */
export function overlayLocalCreatorVaultAuthority(catalogEntry, localEntry) {
    if (!catalogEntry || typeof catalogEntry !== 'object') return catalogEntry;
    if (!localEntry || typeof localEntry !== 'object') return catalogEntry;

    /** @type {Record<string, unknown>} */
    let next = { ...catalogEntry };

    const confirmed = readConfirmedIdentityTriple(localEntry);
    if (confirmed) {
        next = {
            ...next,
            seriesLabel: confirmed.seriesLabel,
            seasonNumber: confirmed.seasonNumber,
            episodeNumber: confirmed.episodeNumber,
            seriesIdentity: {
                seriesLabel: confirmed.seriesLabel,
                seasonNumber: confirmed.seasonNumber,
                episodeNumber: confirmed.episodeNumber,
                confirmedByCreator: true
            }
        };
    }

    const enrichment = normalizeVaultEpisodeEnrichment(readVaultEpisodeEnrichment(localEntry));
    if (enrichment && hasVaultEpisodeEnrichment(enrichment)) {
        next = {
            ...next,
            episodeEnrichment: enrichment
        };
    }

    const stillFields = ['thumbnailUrl', 'posterUrl', 'previewUrl', 'localPreviewUrl', 'thumbnail'];
    for (const field of stillFields) {
        const catalogVal = String(next[field] ?? '').trim();
        const localVal = String(localEntry[field] ?? '').trim();
        if (catalogVal || !localVal) continue;
        if (localVal.startsWith('blob:') || localVal.startsWith('data:')) continue;
        if (VIDEO_STILL_SKIP.test(localVal)) continue;
        if (/\/videos\//i.test(localVal) && !/\/thumbs\//i.test(localVal)) continue;
        next[field] = localVal;
    }

    const catalogStill = pickDurableVaultStillUrl(next);
    const localStill = pickDurableVaultStillUrl(localEntry);
    return stampVaultStillFields(next, catalogStill || localStill);
}

/**
 * Index local vault rows by mediaAssetId for hydrate/merge overlay.
 * @param {unknown} list
 * @returns {Map<string, Record<string, unknown>>}
 */
export function indexVaultAssetsByMediaId(list) {
    /** @type {Map<string, Record<string, unknown>>} */
    const map = new Map();
    for (const row of Array.isArray(list) ? list : []) {
        if (!row || typeof row !== 'object') continue;
        const id = String(
            /** @type {Record<string, unknown>} */ (row).id ||
                /** @type {Record<string, unknown>} */ (row).mediaAssetId ||
                /** @type {Record<string, unknown>} */ (row).assetId ||
                ''
        ).trim();
        if (!id || map.has(id)) continue;
        map.set(id, /** @type {Record<string, unknown>} */ (row));
    }
    return map;
}

/**
 * Apply local creator authority onto a list of catalog-derived vault entries.
 * @param {unknown} catalogEntries
 * @param {unknown} localEntries
 * @returns {Record<string, unknown>[]}
 */
export function overlayCreatorAuthorityOntoVaultList(catalogEntries, localEntries) {
    const localById = indexVaultAssetsByMediaId(localEntries);
    return (Array.isArray(catalogEntries) ? catalogEntries : [])
        .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const id = String(
                /** @type {Record<string, unknown>} */ (entry).id ||
                    /** @type {Record<string, unknown>} */ (entry).mediaAssetId ||
                    ''
            ).trim();
            const local = id ? localById.get(id) : null;
            return /** @type {Record<string, unknown>} */ (
                overlayLocalCreatorVaultAuthority(
                    /** @type {Record<string, unknown>} */ (entry),
                    local
                ) || entry
            );
        })
        .filter(Boolean);
}
