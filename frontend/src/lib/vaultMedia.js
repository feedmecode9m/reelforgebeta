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
    const relative = toRelativeMediaPath(thumb);
    if (!/\.(jpe?g|png|gif|webp)$/i.test(relative) && !relative.includes('/thumbs/')) {
        return null;
    }
    return relative.startsWith('/') ? relative : `/thumbs/${relative.replace(/^\/+/, '')}`;
}
