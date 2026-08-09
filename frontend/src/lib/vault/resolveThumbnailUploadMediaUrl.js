/**
 * Resolve thumbnail vault media URL from upload/normalized response fields.
 *
 * Accepts relative paths and absolute media URLs.
 * Rejects empty values and blob: placeholders.
 *
 * Does not alter upload routes or the vault asset normalizer.
 *
 * @param {{
 *   normalized?: Record<string, unknown> | null;
 *   response?: Record<string, unknown> | null;
 * }} [sources]
 * @returns {string}
 */
export function resolveThumbnailUploadMediaUrl(sources = {}) {
    const normalized = sources.normalized && typeof sources.normalized === 'object' ? sources.normalized : {};
    const response = sources.response && typeof sources.response === 'object' ? sources.response : {};

    const candidates = [
        normalized.thumbnailUrl,
        normalized.url,
        response.thumbnailUrl,
        response.thumbnail_url,
        response.url,
        response.thumbnailPath,
        response.thumbnail_path
    ];

    for (const candidate of candidates) {
        const raw = String(candidate ?? '').trim();
        if (!raw) continue;
        if (raw.startsWith('blob:')) continue;

        // Absolute URLs (Netlify/CDN/Railway) — keep as-is.
        if (/^https?:\/\//i.test(raw)) {
            return raw;
        }

        // Relative paths — ensure leading slash for /thumbs/* style keys.
        if (raw.startsWith('/')) {
            return raw;
        }

        // Bare path fragments like thumbs/file.png
        return `/${raw.replace(/^\/+/, '')}`;
    }

    return '';
}
