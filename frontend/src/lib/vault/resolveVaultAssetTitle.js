/**
 * Hero Vault display-title + keyword helpers (picker / intelligence only).
 * Does not change episodeVaultResolver matching behavior.
 */

const MEDIA_EXT =
    /\.(mp4|mov|webm|m4v|avi|mkv|jpe?g|png|webp|gif|bmp|svg|heic|heif)$/i;

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UUID32_RE = /^[0-9a-f]{32}$/i;

/**
 * @param {string} value
 */
export function isUuidLikeToken(value) {
    const t = String(value || '').trim();
    if (!t) return false;
    const bare = t.replace(MEDIA_EXT, '').trim();
    return UUID_RE.test(t) || UUID_RE.test(bare) || UUID32_RE.test(bare);
}

/**
 * Strip extension, UUID noise, underscore/hyphen noise.
 * @param {unknown} raw
 * @returns {string}
 */
export function cleanVaultFilename(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    // Path → basename
    s = s.split('?')[0].split('#')[0].split('/').pop() || s;
    s = s.replace(MEDIA_EXT, '').trim();
    if (isUuidLikeToken(s)) return '';
    s = s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s || isUuidLikeToken(s)) return '';
    return s;
}

/**
 * Infer media kind for fallback untitled labels.
 * @param {Record<string, unknown> | null | undefined} asset
 * @param {string} [hint]
 * @returns {'video' | 'image' | 'unknown'}
 */
export function inferVaultMediaKind(asset, hint = '') {
    const mime = String(asset?.type || asset?.media_type || asset?.mimeType || '').toLowerCase();
    if (mime.startsWith('video/') || mime === 'video') return 'video';
    if (mime.startsWith('image/') || mime === 'image') return 'image';
    if (String(hint).toLowerCase() === 'video') return 'video';
    if (String(hint).toLowerCase() === 'image') return 'image';

    const urls = [
        asset?.url,
        asset?.videoUrl,
        asset?.video_url,
        asset?.mediaUrl,
        asset?.thumbnailUrl,
        asset?.thumbnail_url,
        asset?.fileName,
        asset?.file_name,
        asset?.originalName,
        asset?.original_name,
        asset?.name,
        asset?.title
    ]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');

    if (/\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(urls) || urls.includes('/videos/')) {
        return 'video';
    }
    if (/\.(jpe?g|png|webp|gif|bmp|svg|heic)(\?|$)/i.test(urls) || urls.includes('/thumbs/')) {
        return 'image';
    }
    return 'unknown';
}

/**
 * Untitled fallback by media kind.
 * @param {'video' | 'image' | 'unknown'} [kind]
 */
export function untitledVaultLabel(kind = 'unknown') {
    if (kind === 'video') return 'Untitled Video';
    if (kind === 'image') return 'Untitled Image';
    return 'Untitled Vault Asset';
}

/**
 * Resolve human display title for a Hero Vault asset.
 *
 * Priority:
 *   title → name → displayName → original filename → fileName → cleaned filename from URL
 *
 * UUID-only / UUID.PNG filenames collapse to Untitled Image (or Video).
 *
 * @param {Record<string, unknown> | null | undefined} asset
 * @returns {string}
 *
 * @example
 * // 94E28916-619A-4356-88E7-90D1C71CAC2D.PNG → Untitled Image
 * // STIRRED_FINAL_CUT.mp4 → STIRRED FINAL CUT
 */
export function resolveVaultAssetTitle(asset) {
    if (!asset || typeof asset !== 'object') return untitledVaultLabel('unknown');

    const kind = inferVaultMediaKind(asset);
    const untitled = untitledVaultLabel(kind === 'unknown' ? 'image' : kind);

    const meta =
        asset.metadata && typeof asset.metadata === 'object'
            ? /** @type {Record<string, unknown>} */ (asset.metadata)
            : null;

    /** @type {unknown[]} */
    const candidates = [
        asset.title,
        asset.name,
        asset.displayName,
        asset.display_name,
        meta?.title,
        meta?.name,
        asset.originalName,
        asset.original_name,
        asset.originalFilename,
        asset.original_filename,
        asset.fileName,
        asset.file_name,
        asset.filename
    ];

    for (const c of candidates) {
        const raw = String(c || '').trim();
        if (!raw) continue;
        if (isUuidLikeToken(raw)) continue;
        // Filename-like (has extension or underscores) → clean
        if (MEDIA_EXT.test(raw) || /[_-]/.test(raw)) {
            const cleaned = cleanVaultFilename(raw);
            if (cleaned) return cleaned;
            continue;
        }
        // Bare human title — keep as-is (may still strip extension if present)
        const cleaned = cleanVaultFilename(raw) || raw;
        if (cleaned && !isUuidLikeToken(cleaned)) return cleaned;
    }

    // URL / path basenames
    for (const c of [
        asset.url,
        asset.videoUrl,
        asset.video_url,
        asset.mediaUrl,
        asset.thumbnailUrl,
        asset.thumbnail_url,
        asset.thumbnailPath,
        asset.thumbnail_path
    ]) {
        const cleaned = cleanVaultFilename(c);
        if (cleaned) return cleaned;
    }

    return untitled;
}

/**
 * Keywords for picker metadata from an asset's display title.
 * Example: STIRRED FINAL CUT → ["stirred", "final", "cut"]
 *
 * @param {Record<string, unknown> | string | null | undefined} assetOrTitle
 * @returns {string[]}
 */
export function resolveVaultKeywords(assetOrTitle) {
    const title =
        typeof assetOrTitle === 'string'
            ? assetOrTitle
            : resolveVaultAssetTitle(assetOrTitle || null);

    return String(title || '')
        .toLowerCase()
        .replace(MEDIA_EXT, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter((t) => t.length >= 2)
        .filter((t) => !/^\d+$/.test(t));
}
