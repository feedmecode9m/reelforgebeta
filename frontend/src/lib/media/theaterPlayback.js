import { toRelativeMediaPath } from '../config.js';
import { isVideoReel, isImageReel } from '../api/reelContract.js';

/** Raw path for MediaRenderer — no pre-resolution. */
function rawMediaPath(url) {
    if (!url) return '';
    const t = String(url).trim();
    if (!t) return '';
    if (t.startsWith('blob:') || t.startsWith('data:')) return t;
    return toRelativeMediaPath(t) || t;
}

/**
 * Resolve theater playback — must match shelf card video detection.
 * Returns raw media paths; MediaRenderer resolves at render.
 *
 * @param {Record<string, unknown> | null | undefined} reel
 * @param {Record<string, unknown>[]} [vaultVideos]
 */
export function resolveTheaterPlayback(reel, vaultVideos = []) {
    if (!reel) return { mode: 'none' };

    const primaryUrl = String(reel.url || reel.video_url || '').trim();

    if (primaryUrl && isVideoReel({ ...reel, url: primaryUrl })) {
        const url = rawMediaPath(primaryUrl);
        if (url) {
            return {
                mode: 'video',
                url,
                poster: reel.thumbnailUrl ? rawMediaPath(String(reel.thumbnailUrl)) : null,
                source: 'reel'
            };
        }
    }

    const thumbStemSources = [
        reel.personal_thumbnail,
        reel.thumbnailUrl,
        reel.thumbnail_url,
        reel.url,
        reel.fileName,
        reel.name,
        reel.title
    ].filter(Boolean);

    const thumbStem = thumbStemSources
        .map((value) => String(value).split('/').pop()?.replace(/\.[^.]+$/, '').toLowerCase() || '')
        .find((stem) => stem && !stem.startsWith('personal content'));

    if (thumbStem) {
        const linked = vaultVideos.find((v) => {
            const vStem = String(v.fileName || v.name || v.title || v.url || '')
                .split('/')
                .pop()
                ?.replace(/\.[^.]+$/, '')
                .toLowerCase();
            return vStem && (vStem === thumbStem || vStem.includes(thumbStem) || thumbStem.includes(vStem));
        });

        const linkedUrl = linked?.url || linked?.video_url || linked?.src;
        if (linkedUrl && isVideoReel({ ...linked, url: String(linkedUrl) })) {
            return {
                mode: 'video',
                url: rawMediaPath(String(linkedUrl)),
                poster: resolvePlaceholderThumbUrl(reel) || null,
                source: 'vault-link',
                linkedName: linked.name
            };
        }
    }

    const imageUrl = resolvePlaceholderThumbUrl(reel);
    if (imageUrl && (reel.type === 'image' || reel.isPlaceholder || isImageReel(reel))) {
        return { mode: 'image', url: imageUrl };
    }

    return { mode: 'placeholder' };
}

/** @deprecated Use isVideoReel from reelContract.js */
export function reelHasPlayableVideo(reel, urlOverride) {
    const url = String(urlOverride ?? reel?.url ?? reel?.video_url ?? '').trim();
    return isVideoReel({ ...reel, url });
}

/** Raw thumbnail path for theater — MediaRenderer resolves at render. */
export function resolvePlaceholderThumbUrl(reel) {
    if (!reel) return '';
    if (reel.url && String(reel.url).trim()) return rawMediaPath(String(reel.url));
    if (reel.thumbnailUrl && String(reel.thumbnailUrl).trim()) {
        return rawMediaPath(String(reel.thumbnailUrl));
    }
    const thumbName = reel.personal_thumbnail || reel.thumbnail_url || reel.thumbnailUrl;
    if (thumbName && String(thumbName).trim()) {
        const name = String(thumbName).includes('/') ? String(thumbName).split('/').pop() : thumbName;
        return `/thumbs/${name}`;
    }
    return '';
}

/**
 * Dev instrumentation for theater handshake failures.
 * @param {Record<string, unknown>} reel
 * @param {ReturnType<typeof resolveTheaterPlayback>} playback
 * @param {{ videoInDom?: boolean }} [dom]
 */
export function logTheaterHandshake(reel, playback, dom = {}) {
    if (!import.meta.env.DEV && typeof window !== 'undefined') {
        const debug = new URLSearchParams(window.location.search).get('debug') === 'theater';
        if (!debug) return;
    }

    const primaryUrl = reel?.url || reel?.video_url || '';
    console.group('[theater-handshake]');
    console.log('reelId:', reel?.id);
    console.log('reelType:', reel?.type, '| isPlaceholder:', reel?.isPlaceholder);
    console.log('primaryUrl:', primaryUrl);
    console.log('playable (url-first):', isVideoReel({ ...reel, url: String(primaryUrl) }));
    console.log('playback:', playback);
    console.log('videoInDom:', dom.videoInDom ?? 'not checked');
    console.groupEnd();
}
