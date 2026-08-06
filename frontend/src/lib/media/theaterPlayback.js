import { toRelativeMediaPath } from '../config.js';
import { isVideoReel, isImageReel } from '../api/reelContract.js';
import { resolveActiveHeroVideoReel, heroReelToVaultItem } from '../hero/heroReelIdentity.js';

/** Raw path for MediaRenderer — no pre-resolution. */
function rawMediaPath(url) {
    if (!url) return '';
    const t = String(url).trim();
    if (!t) return '';
    if (t.startsWith('blob:') || t.startsWith('data:')) return t;
    return toRelativeMediaPath(t) || t;
}

/**
 * @param {Record<string, unknown>[]} vaultVideos
 * @returns {Record<string, unknown>[]}
 */
function mergeVaultVideosWithHero(vaultVideos) {
    const list = [...(vaultVideos || [])].filter(Boolean);
    const hero = resolveActiveHeroVideoReel();
    if (hero && !list.some((v) => String(v?.id || '') === hero.id)) {
        list.unshift(heroReelToVaultItem(hero));
    }
    return list;
}

/**
 * @param {Record<string, unknown>} reel
 * @param {Record<string, unknown> | null | undefined} video
 * @param {string} source
 */
function playbackFromVideoSource(reel, video, source) {
    const state = String(video?.uploadState || '');
    if (
        state === 'failed' ||
        state === 'interrupted' ||
        state === 'pending_accept' ||
        state === 'uploading' ||
        video?.isOptimisticLocal
    ) {
        return null;
    }
    const url = String(video?.url || video?.video_url || video?.src || '').trim();
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) return null;
    if (!url || !isVideoReel({ ...video, url })) return null;
    return {
        mode: 'video',
        url: rawMediaPath(url),
        poster: resolvePlaceholderThumbUrl(reel) || null,
        source,
        linkedName: video.name || video.fileName || video.title
    };
}

/**
 * Link thumbnail / placeholder shelf cards to personal or hero video assets.
 * @param {Record<string, unknown>} reel
 * @param {Record<string, unknown>[]} vaultVideos
 */
function resolvePersonalShelfVideoLink(reel, vaultVideos) {
    const merged = mergeVaultVideosWithHero(vaultVideos);
    const personalVideoId = String(reel?.personal_video_id || '').trim();
    if (personalVideoId) {
        const byId = merged.find((v) => String(v?.id || '') === personalVideoId);
        const byIdPlayback = playbackFromVideoSource(reel, byId, 'personal-video-id');
        if (byIdPlayback) return byIdPlayback;
    }

    if (!reel?.isPersonalThumbnail && !reel?.isPlaceholder) return null;

    const hero = resolveActiveHeroVideoReel();
    if (hero) {
        const heroPlayback = playbackFromVideoSource(reel, hero, 'hero-personal-thumb');
        if (heroPlayback) return heroPlayback;
    }

    const playable = merged.filter((v) =>
        isVideoReel({ ...v, url: String(v?.url || v?.video_url || v?.src || '') })
    );
    if (playable.length === 1) {
        return playbackFromVideoSource(reel, playable[0], 'sole-personal-video');
    }

    return null;
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

    const mergedVaultVideos = mergeVaultVideosWithHero(vaultVideos);

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
        const linked = mergedVaultVideos.find((v) => {
            const vStem = String(v.fileName || v.name || v.title || v.url || '')
                .split('/')
                .pop()
                ?.replace(/\.[^.]+$/, '')
                .toLowerCase();
            return vStem && (vStem === thumbStem || vStem.includes(thumbStem) || thumbStem.includes(vStem));
        });

        const vaultLinkPlayback = playbackFromVideoSource(reel, linked, 'vault-link');
        if (vaultLinkPlayback) return vaultLinkPlayback;

        const heroReel = resolveActiveHeroVideoReel();
        const heroUrl = String(heroReel?.url || '').trim();
        if (heroUrl) {
            const heroStem = String(heroReel.fileName || heroUrl)
                .split('/')
                .pop()
                ?.replace(/\.[^.]+$/, '')
                .toLowerCase();
            if (
                heroStem &&
                (heroStem === thumbStem || heroStem.includes(thumbStem) || thumbStem.includes(heroStem))
            ) {
                const heroPlayback = playbackFromVideoSource(reel, heroReel, 'hero-link');
                if (heroPlayback) return heroPlayback;
            }
        }
    }

    const personalLink = resolvePersonalShelfVideoLink(reel, vaultVideos);
    if (personalLink) return personalLink;

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
