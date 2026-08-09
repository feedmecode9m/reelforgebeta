/**
 * Resolve thumbnail vault media URL from upload/normalized response fields.
 *
 * Accepts relative paths and absolute media URLs.
 * Rejects empty values and blob: placeholders.
 *
 * Candidate order:
 *   normalized.thumbnailUrl → normalized.url →
 *   response.thumbnailUrl → response.thumbnail_url → response.url →
 *   response.thumbnailPath → response.thumbnail_path
 *
 * @param {{
 *   normalized?: Record<string, unknown> | null;
 *   response?: Record<string, unknown> | null;
 * }} [sources]
 * @returns {string}
 */
export function resolveThumbnailUploadMediaUrl(sources = {}) {
    const normalized =
        sources.normalized && typeof sources.normalized === 'object' ? sources.normalized : {};
    const response =
        sources.response && typeof sources.response === 'object' ? sources.response : {};

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
        if (/^blob:/i.test(raw) || /^data:/i.test(raw)) continue;

        // Absolute CDN / Netlify / Railway URLs — keep origin intact.
        if (/^https?:\/\//i.test(raw)) {
            return raw;
        }

        // Relative media paths (/thumbs/…, /videos/…)
        if (raw.startsWith('/')) {
            return raw;
        }

        // Bare path fragments like thumbs/file.png
        return `/${raw.replace(/^\/+/, '')}`;
    }

    return '';
}

/**
 * True when a ready image upload payload has an accept-able media URL
 * (relative /thumbs/* OR absolute https://…/thumbs/*).
 *
 * @param {unknown} response
 * @param {Record<string, unknown> | null} [normalized]
 */
export function isAcceptableThumbnailUploadMedia(response, normalized = null) {
    const media = resolveThumbnailUploadMediaUrl({
        normalized: normalized && typeof normalized === 'object' ? normalized : null,
        response:
            response && typeof response === 'object'
                ? /** @type {Record<string, unknown>} */ (response)
                : null
    });
    if (!media) return false;
    if (/^blob:/i.test(media) || /^data:/i.test(media)) return false;
    return true;
}
