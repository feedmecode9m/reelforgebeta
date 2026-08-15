/**
 * Canonical Hero Vault asset normalizer.
 *
 * Accepts heterogeneous upload / store rows and emits a stable shape for
 * picker metadata and thumbnail intake validation.
 *
 * Does not change upload routes, R2, Theater, or episode matching.
 */

import {
    inferVaultMediaKind,
    resolveVaultAssetTitle,
    resolveVaultKeywords,
    isUuidLikeToken
} from './resolveVaultAssetTitle.js';
import { buildVaultSeriesIdentity } from '../series/vaultSeriesInference.js';

/**
 * @typedef {{
 *   seriesLabel: string;
 *   seasonNumber: number;
 *   episodeNumber: number;
 *   confidence?: 'high' | 'medium' | 'low';
 * }} VaultSeriesIdentityFields
 */

/**
 * @typedef {{
 *   id: string;
 *   assetId: string;
 *   title: string;
 *   displayTitle: string;
 *   type: 'video' | 'image';
 *   url: string;
 *   thumbnailUrl: string;
 *   status: string;
 *   createdAt: string | null;
 *   category: string | null;
 *   keywords: string[];
 *   seriesIdentity?: VaultSeriesIdentityFields | null;
 *   seriesLabel?: string;
 *   seasonNumber?: number;
 *   episodeNumber?: number;
 * }} NormalizedVaultAsset
 */

/**
 * @param {unknown} status
 * @returns {string}
 */
function normalizeStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw) return 'ready';
    if (raw === 'complete' || raw === 'completed' || raw === 'canonical') return 'ready';
    return raw;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function firstString(...values) {
    for (const v of values) {
        const s = String(v ?? '').trim();
        if (s) return s;
    }
    return '';
}

/**
 * @param {Record<string, unknown> | null | undefined} raw
 * @returns {string}
 */
function pickId(raw) {
    return firstString(raw?.id, raw?.assetId, raw?.asset_id, raw?.personal_video_id, raw?.reelId);
}

/**
 * Media URL preference (playable surface).
 * Images may only have thumbnailUrl — that counts.
 * @param {Record<string, unknown>} raw
 * @param {'video' | 'image'} kind
 */
const VIDEO_MEDIA_EXT = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i;
const IMAGE_MEDIA_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;

/**
 * True when a URL is a video file / playback path (never valid as an <img> src).
 * blob:/data: are classified by mime at the card face, not here.
 * @param {unknown} url
 */
export function isVaultVideoMediaUrl(url) {
    const s = String(url || '').trim();
    if (!s) return false;
    if (s.startsWith('blob:') || s.startsWith('data:')) return false;
    if (VIDEO_MEDIA_EXT.test(s)) return true;
    if (/\/videos\//i.test(s) && !/\/thumbs\//i.test(s) && !IMAGE_MEDIA_EXT.test(s)) return true;
    return false;
}

/**
 * @param {unknown} url
 */
export function isVaultLocalPreviewUrl(url) {
    const s = String(url || '').trim();
    return s.startsWith('blob:') || s.startsWith('data:');
}

/**
 * Vault card artwork source. Never uses a video playback URL as an image.
 *
 * Durable stills win over leftover blob/data localPreviewUrl so ready video
 * cards can render <img>. Blobs are used only when no durable still exists.
 *
 * Priority: thumbnailUrl → thumbnail → posterUrl → previewUrl (non-blob)
 *           → localPreviewUrl / blob preview
 *
 * @param {Record<string, unknown> | null | undefined} entry
 * @returns {{ src: string; render: 'image' | 'local-preview' | 'empty' }}
 */
export function resolveVaultCardFace(entry) {
    if (!entry || typeof entry !== 'object') {
        return { src: '', render: 'empty' };
    }
    const type = String(entry.type || entry.assetType || entry.mimeType || '').toLowerCase();
    const candidates = [
        entry.thumbnailUrl,
        entry.thumbnail_url,
        entry.posterUrl,
        entry.poster_url,
        entry.poster,
        entry.thumbnail,
        entry.thumbnailPath,
        entry.thumbnail_path,
        entry.previewUrl,
        entry.localPreviewUrl
    ];
    for (const candidate of candidates) {
        const src = String(candidate ?? '').trim();
        if (!src) continue;
        if (src.startsWith('blob:') || src.startsWith('data:')) continue;
        if (isVaultVideoMediaUrl(src)) continue;
        return { src, render: 'image' };
    }
    for (const candidate of candidates) {
        const src = String(candidate ?? '').trim();
        if (!src) continue;
        if (src.startsWith('data:image')) return { src, render: 'image' };
        if (src.startsWith('data:video')) return { src, render: 'local-preview' };
        if (src.startsWith('blob:')) {
            if (type.startsWith('image/')) return { src, render: 'image' };
            return { src, render: 'local-preview' };
        }
    }
    return { src: '', render: 'empty' };
}

/**
 * Image-or-preview URL for vault cards (empty when no still exists).
 * @param {Record<string, unknown> | null | undefined} entry
 */
export function resolveVaultCardThumbnailUrl(entry) {
    return resolveVaultCardFace(entry).src;
}

function pickUrls(raw, kind) {
    const url = firstString(
        raw.url,
        raw.videoUrl,
        raw.video_url,
        raw.mediaUrl,
        raw.src,
        raw.thumbnailPath,
        raw.thumbnail_path
    );
    const thumbnailUrl = firstString(
        raw.localPreviewUrl,
        raw.previewUrl,
        raw.thumbnailUrl,
        raw.thumbnail_url,
        raw.thumbnail,
        raw.posterUrl,
        raw.poster_url,
        raw.thumbnailPath,
        raw.thumbnail_path
    );

    if (kind === 'image') {
        // Image assets are valid with thumbnailUrl only (no separate playable url).
        const media = url || thumbnailUrl;
        return { url: media, thumbnailUrl: thumbnailUrl || media };
    }
    const stillOrPreview = isVaultVideoMediaUrl(thumbnailUrl) ? '' : thumbnailUrl;
    return { url, thumbnailUrl: stillOrPreview };
}

/**
 * Raw human title before display cleanup (prefer stored title/name).
 * @param {Record<string, unknown>} raw
 * @param {string} displayTitle
 */
function pickTitle(raw, displayTitle) {
    const meta =
        raw.metadata && typeof raw.metadata === 'object'
            ? /** @type {Record<string, unknown>} */ (raw.metadata)
            : null;
    const preferred = firstString(
        raw.title,
        raw.name,
        raw.displayName,
        raw.display_name,
        meta?.title,
        meta?.name
    );
    if (preferred && !isUuidLikeToken(preferred)) return preferred;
    return displayTitle;
}

/**
 * True when status means not ready for picker / ready vault.
 * @param {string} status
 */
export function isPendingOrFailedVaultStatus(status) {
    const s = normalizeStatus(status);
    if (s === 'ready') return false;
    return /pending|upload|processing|process|fail|error|interrupt|ingesting/.test(s);
}

/**
 * Normalize a raw Hero Vault / upload response row.
 *
 * Accepts valid image responses containing:
 *   - id
 *   - url OR thumbnailUrl
 *   - status ready/complete/completed OR default ready
 *
 * Does not reject image assets that only have thumbnailUrl.
 *
 * @param {unknown} raw
 * @param {{ fallbackName?: string; requireReady?: boolean }} [options]
 * @returns {NormalizedVaultAsset | null}
 */
export function normalizeVaultAsset(raw, options = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const row = /** @type {Record<string, unknown>} */ (raw);

    const id = pickId(row);
    if (!id) return null;

    const status = normalizeStatus(
        row.status ?? row.uploadStatus ?? row.vaultState ?? row.uploadState
    );
    if (options.requireReady !== false && isPendingOrFailedVaultStatus(status)) {
        return null;
    }
    // Explicit reject of pending even when requireReady is false for validation helpers
    if (status === 'pending' || status === 'upload_pending') {
        if (options.requireReady !== false) return null;
    }

    const kindHint = inferVaultMediaKind(row);
    let kind = kindHint === 'video' ? /** @type {'video'} */ ('video') : /** @type {'image'} */ ('image');
    // Prefer video only when we actually have media cues
    if (kindHint === 'unknown') {
        const mime = String(row.type || row.media_type || '').toLowerCase();
        if (mime.startsWith('video/')) kind = 'video';
        else kind = 'image';
    }

    const { url, thumbnailUrl } = pickUrls(row, kind);
    const previewUrl = firstString(row.previewUrl, row.localPreviewUrl);
    const localPreviewUrl = firstString(row.localPreviewUrl, row.previewUrl);

    // Video requires a media url (thumb alone is not enough for video type),
    // except in-flight local File/blob previews (requireReady: false).
    if (kind === 'video' && !url) {
        const localPreview =
            isVaultLocalPreviewUrl(previewUrl) || isVaultLocalPreviewUrl(thumbnailUrl);
        if (localPreview && options.requireReady === false) {
            // keep video + blob thumbnail
        } else if (thumbnailUrl && !isVaultVideoMediaUrl(thumbnailUrl) && !isVaultLocalPreviewUrl(thumbnailUrl)) {
            kind = 'image';
        } else {
            return null;
        }
    }

    // Image: url OR thumbnailUrl required
    if (kind === 'image' && !url && !thumbnailUrl) {
        return null;
    }

    // Blob placeholders are never accept-ready
    if (url.startsWith('blob:') || thumbnailUrl.startsWith('blob:')) {
        if (options.requireReady !== false) return null;
    }

    const displayTitle = resolveVaultAssetTitle({
        ...row,
        title: row.title || options.fallbackName || row.name,
        name: row.name || options.fallbackName || row.title,
        type: kind === 'video' ? 'video/mp4' : 'image/png'
    });
    const title = pickTitle(row, displayTitle);
    const keywords = resolveVaultKeywords({ ...row, title: displayTitle });

    const createdAt = firstString(
        row.createdAt,
        row.created_at,
        row.addedAt,
        row.added_at,
        row.uploadedAt,
        row.timestamp
    );

    const category = firstString(row.category, row.genre) || null;

    // Optional series identity from Hero Vault labels / title parse.
    // Missing identity is valid — never fail normalize for unlabeled assets.
    const titleForIdentity = title || displayTitle;
    const identitySource = {
        ...row,
        title: titleForIdentity,
        name: firstString(row.name, titleForIdentity)
    };
    const seriesIdentity = buildVaultSeriesIdentity(identitySource);

    /** @type {NormalizedVaultAsset} */
    const normalized = {
        id,
        assetId: id,
        title,
        displayTitle,
        type: kind,
        url: kind === 'video' ? url : url || thumbnailUrl,
        mediaUrl: firstString(row.mediaUrl, kind === 'video' ? url : url || thumbnailUrl),
        videoUrl: kind === 'video' ? firstString(row.videoUrl, row.video_url, url) : '',
        thumbnailUrl: kind === 'video' ? thumbnailUrl : thumbnailUrl || url,
        posterUrl: firstString(
            row.posterUrl,
            row.poster_url,
            kind === 'video' && !isVaultVideoMediaUrl(thumbnailUrl) && !isVaultLocalPreviewUrl(thumbnailUrl)
                ? thumbnailUrl
                : kind === 'image'
                  ? thumbnailUrl || url
                  : ''
        ),
        previewUrl,
        localPreviewUrl,
        status: status === 'complete' || status === 'completed' ? 'ready' : status || 'ready',
        createdAt: createdAt || null,
        category,
        keywords
    };

    if (seriesIdentity) {
        const priorNested =
            row.seriesIdentity && typeof row.seriesIdentity === 'object'
                ? /** @type {Record<string, unknown>} */ (row.seriesIdentity)
                : null;
        const confirmedByCreator =
            priorNested?.confirmedByCreator === true ||
            priorNested?.identitySource === 'creator' ||
            row.confirmedByCreator === true;
        // Creator-confirmed S/E from prior nested identity wins over title re-parse.
        const label =
            confirmedByCreator && firstString(priorNested?.seriesLabel, priorNested?.series_label)
                ? firstString(priorNested?.seriesLabel, priorNested?.series_label)
                : seriesIdentity.seriesLabel;
        const season =
            confirmedByCreator && Number(priorNested?.seasonNumber ?? priorNested?.season_number) >= 1
                ? Number(priorNested?.seasonNumber ?? priorNested?.season_number)
                : seriesIdentity.seasonNumber;
        const episode =
            confirmedByCreator && Number(priorNested?.episodeNumber ?? priorNested?.episode_number) >= 1
                ? Number(priorNested?.episodeNumber ?? priorNested?.episode_number)
                : seriesIdentity.episodeNumber;
        normalized.seriesIdentity = {
            seriesLabel: label,
            seasonNumber: season,
            episodeNumber: episode,
            ...(confirmedByCreator ? { confirmedByCreator: true } : {})
        };
        // Flat mirrors for consumers that read top-level fields (legacy-safe)
        normalized.seriesLabel =
            (confirmedByCreator
                ? firstString(priorNested?.seriesLabel, row.seriesLabel, row.series_label, label)
                : firstString(row.seriesLabel, row.series_label, seriesIdentity.seriesLabel)) ||
            label;
        normalized.seasonNumber =
            confirmedByCreator && Number(priorNested?.seasonNumber) >= 1
                ? Number(priorNested.seasonNumber)
                : Number(row.seasonNumber ?? row.season_number) >= 1
                  ? Number(row.seasonNumber ?? row.season_number)
                  : season;
        normalized.episodeNumber =
            confirmedByCreator && Number(priorNested?.episodeNumber) >= 1
                ? Number(priorNested.episodeNumber)
                : Number(row.episodeNumber ?? row.episode_number) >= 1
                  ? Number(row.episodeNumber ?? row.episode_number)
                  : episode;
    } else {
        // Preserve pre-existing identity fields when present even if parse failed
        const priorNested =
            row.seriesIdentity && typeof row.seriesIdentity === 'object'
                ? /** @type {Record<string, unknown>} */ (row.seriesIdentity)
                : null;
        const confirmedByCreator =
            priorNested?.confirmedByCreator === true ||
            priorNested?.identitySource === 'creator' ||
            row.confirmedByCreator === true;
        const preserved = buildVaultSeriesIdentity({
            seriesIdentity: row.seriesIdentity,
            seriesLabel: row.seriesLabel,
            series_label: row.series_label,
            seasonNumber: row.seasonNumber,
            episodeNumber: row.episodeNumber
        });
        if (preserved) {
            normalized.seriesIdentity = {
                seriesLabel: preserved.seriesLabel,
                seasonNumber: preserved.seasonNumber,
                episodeNumber: preserved.episodeNumber,
                ...(confirmedByCreator ? { confirmedByCreator: true } : {})
            };
            normalized.seriesLabel = preserved.seriesLabel;
            normalized.seasonNumber = preserved.seasonNumber;
            normalized.episodeNumber = preserved.episodeNumber;
        }
    }

    // Durable creator presentation package (title / description / artwork)
    const priorEnrich =
        row.episodeEnrichment && typeof row.episodeEnrichment === 'object'
            ? /** @type {Record<string, unknown>} */ (row.episodeEnrichment)
            : null;
    if (priorEnrich) {
        const title = firstString(priorEnrich.title);
        const description = firstString(priorEnrich.description);
        const artworkUrl = firstString(
            priorEnrich.artworkUrl,
            priorEnrich.artwork,
            priorEnrich.posterUrl
        );
        if (title || description || artworkUrl) {
            normalized.episodeEnrichment = {
                ...(title ? { title } : {}),
                ...(description ? { description } : {}),
                ...(artworkUrl ? { artworkUrl } : {})
            };
        }
    }

    return normalized;
}

/**
 * Soft-accept upload/API image responses for thumbnail vault intake.
 * Returns a relative-friendly entry or null when invalid.
 *
 * @param {unknown} response
 * @param {{ fallbackName?: string }} [options]
 * @returns {NormalizedVaultAsset | null}
 */
export function acceptVaultImageUploadResponse(response, options = {}) {
    const normalized = normalizeVaultAsset(response, {
        fallbackName: options.fallbackName,
        requireReady: true
    });
    if (!normalized) return null;
    // Image path may use thumbnailUrl only — still valid.
    if (!normalized.id || (!normalized.url && !normalized.thumbnailUrl)) return null;
    if (normalized.status !== 'ready') return null;
    return normalized;
}
