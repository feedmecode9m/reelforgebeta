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
    return { url, thumbnailUrl };
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

    const status = normalizeStatus(row.status ?? row.uploadStatus ?? row.vaultState);
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

    // Video requires a media url (thumb alone is not enough for video type).
    if (kind === 'video' && !url) {
        // May still be an image mis-tagged — promote image if only thumbnail present
        if (thumbnailUrl) {
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

    return {
        id,
        assetId: id,
        title,
        displayTitle,
        type: kind,
        url: url || thumbnailUrl,
        thumbnailUrl: thumbnailUrl || url,
        status: status === 'complete' || status === 'completed' ? 'ready' : status || 'ready',
        createdAt: createdAt || null,
        category,
        keywords
    };
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
