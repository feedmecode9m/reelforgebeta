import { toRelativeMediaPath } from './config.js';
import { isVideoReel, isImageReel } from './api/reelContract.js';

/** Reject legacy fake thumbs (e.g. video.mp4.jpg). */
export function isFakeThumbUrl(url) {
    if (!url || typeof url !== 'string') return true;
    return /\.(mp4|mov|webm|m4v|avi|mkv)\.jpe?g$/i.test(url);
}

export function isImage(reel) {
    return isImageReel(reel);
}

export function isVideo(reel) {
    return isVideoReel(reel);
}

/** Canonical on-disk filename from vault entry, reel URL, or bare name. */
export function filenameFromMediaRef(ref) {
    if (!ref) return '';
    if (typeof ref === 'object') {
        const fromField = String(ref.fileName || ref.file_name || '').trim();
        if (fromField) return fromField;
        const url = ref.url || ref.video_url || ref.src || '';
        const fromUrl = filenameFromMediaRef(url);
        if (fromUrl) return fromUrl;
        return String(ref.name || '').trim();
    }
    const trimmed = String(ref).trim();
    if (!trimmed) return '';
    return trimmed.split('/').pop()?.split('?')[0] || trimmed;
}

/** User-provided poster only — must be an image under /thumbs/, not a video file. */
export function resolveUserPosterUrl(thumb) {
    if (!thumb || isFakeThumbUrl(thumb)) return null;
    if (/\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i.test(thumb)) return null;
    let trimmed = String(thumb).trim();
    if (!trimmed) return null;

    // Peel accidental `/thumbs/https://host/...` corruption before any join.
    const nakedAbs = trimmed.match(/^\/(?:thumbs|videos)\/(https?:\/\/.+)$/i);
    if (nakedAbs) {
        return resolveUserPosterUrl(nakedAbs[1]);
    }
    const embedded = trimmed.match(/^\/(thumbs|videos)\/https?:\/\/[^/]+\/(thumbs|videos)\/(.+)$/i);
    if (embedded) {
        return resolveUserPosterUrl(`/${embedded[2]}/${embedded[3]}`);
    }

    // Absolute production thumbs must stay absolute — never prepend `/thumbs/`.
    // toRelativeMediaPath may also return absolute media hosts; treat the same.
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const u = new URL(trimmed);
            const path = u.pathname || '';
            if (
                !/\.(jpe?g|png|gif|webp)(\?|$)/i.test(path) &&
                !path.includes('/thumbs/')
            ) {
                return null;
            }
        } catch {
            return null;
        }
        return trimmed;
    }

    const relative = toRelativeMediaPath(trimmed);
    if (/^https?:\/\//i.test(relative)) {
        return resolveUserPosterUrl(relative);
    }
    if (!/\.(jpe?g|png|gif|webp)$/i.test(relative) && !relative.includes('/thumbs/')) {
        return null;
    }
    return relative.startsWith('/') ? relative : `/thumbs/${relative.replace(/^\/+/, '')}`;
}
