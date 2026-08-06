/**
 * MISSION 5.6 — Canonical hero reel identity (id, fileName, url).
 * Single storage key; manager config heroAssetId is a pointer to reel.id only.
 */
import { toRelativeMediaPath } from '../config.js';
import { normalizeReel, isVideoReel } from '../api/reelContract.js';
import { reelResEntry, reelResExit, reelResReelSnapshot } from '../diagnostics/reelResolutionTrace.js';

export const HERO_REEL_STORAGE_KEY = 'reelforge_hero_reel';
const HERO_VIDEO_STORAGE_KEY = 'reelforge_hero_video';
const HERO_IMAGE_STORAGE_KEY = 'reelforge_hero_image';
const HERO_MANAGER_STORAGE_KEY = 'reelforge_hero_manager_config';

/**
 * @typedef {Object} HeroReel
 * @property {string} id
 * @property {string} fileName
 * @property {string} name
 * @property {string} url
 * @property {string} [thumbnail]
 * @property {string} type
 * @property {'custom_image' | 'custom_video'} backgroundSource
 */

/**
 * @param {Record<string, unknown>} raw
 * @param {'image' | 'video'} mediaKind
 * @returns {HeroReel | null}
 */
export function heroReelFromUploadResponse(raw, mediaKind = 'image') {
    const t0 = performance.now();
    reelResEntry('heroReelFromUploadResponse', { mediaKind });
    const normalized = normalizeReel(raw, 'hero-upload');
    if (!normalized?.id) {
        reelResExit('heroReelFromUploadResponse', t0, { result: null, reason: 'missing_id' });
        return null;
    }

    const url = toRelativeMediaPath(String(normalized.url || ''));
    if (!url) {
        reelResExit('heroReelFromUploadResponse', t0, {
            result: null,
            reason: 'empty_url_after_toRelativeMediaPath',
            normalizedUrl: normalized.url
        });
        return null;
    }

    const fileName =
        String(normalized.fileName || normalized.file_name || '').trim() ||
        url.split('/').pop()?.split('?')[0] ||
        '';

    const thumbnailRaw = String(
        normalized.thumbnailUrl || normalized.thumbnail_url || normalized.thumbnailPath || ''
    ).trim();
    const thumbnail =
        mediaKind === 'video' && thumbnailRaw ? toRelativeMediaPath(thumbnailRaw) : '';

    const result = {
        id: String(normalized.id),
        fileName,
        name: String(normalized.name || normalized.title || 'Hero'),
        url,
        thumbnail: thumbnail || undefined,
        type: String(normalized.type || (mediaKind === 'video' ? 'video/mp4' : 'image/jpeg')),
        backgroundSource: mediaKind === 'video' ? 'custom_video' : 'custom_image'
    };
    reelResReelSnapshot('heroReelFromUploadResponse:result', result, { mediaKind });
    reelResExit('heroReelFromUploadResponse', t0, {
        id: result.id,
        url: result.url,
        backgroundSource: result.backgroundSource
    });
    return result;
}

/** @returns {{ heroAssetId: string; backgroundSource: string }} */
function readHeroManagerPointer() {
    if (typeof window === 'undefined') {
        return { heroAssetId: '', backgroundSource: 'selection' };
    }
    try {
        const parsed = JSON.parse(localStorage.getItem(HERO_MANAGER_STORAGE_KEY) || '{}');
        const backgroundSource = String(parsed?.backgroundSource || 'selection').trim();
        return {
            heroAssetId: backgroundSource === 'none' ? '' : String(parsed?.heroAssetId || '').trim(),
            backgroundSource: backgroundSource || 'selection'
        };
    } catch {
        return { heroAssetId: '', backgroundSource: 'selection' };
    }
}

/**
 * Resolve backgroundSource on stored reel using manager pointer + mime hints.
 * @param {Record<string, unknown>} parsed
 */
function resolveStoredHeroBackgroundSource(parsed) {
    if (parsed?.backgroundSource === 'custom_video') return 'custom_video';
    if (parsed?.backgroundSource === 'custom_image') return 'custom_image';
    const manager = readHeroManagerPointer();
    const reelId = String(parsed?.id || '').trim();
    if (
        manager.backgroundSource === 'custom_video' &&
        manager.heroAssetId &&
        reelId &&
        manager.heroAssetId === reelId
    ) {
        return 'custom_video';
    }
    if (String(parsed?.type || '').startsWith('video/')) return 'custom_video';
    return 'custom_image';
}

/**
 * Active custom-video hero reel — manager pointer + playable url required.
 * @returns {HeroReel | null}
 */
export function resolveActiveHeroVideoReel() {
    const manager = readHeroManagerPointer();
    if (manager.backgroundSource === 'none') return null;
    const reel = loadHeroReel();
    if (!reel?.id || !reel?.url) return null;
    const managerMatch =
        manager.backgroundSource === 'custom_video' && manager.heroAssetId === reel.id;
    const reelIsVideo =
        reel.backgroundSource === 'custom_video' || isVideoReel({ ...reel, url: reel.url });
    if (!managerMatch && !reelIsVideo) return null;
    if (!isVideoReel({ ...reel, url: reel.url })) return null;
    return reel.backgroundSource === 'custom_video'
        ? reel
        : { ...reel, backgroundSource: 'custom_video' };
}

/** @returns {HeroReel | null} */
export function loadHeroReel() {
    if (typeof window === 'undefined') return null;
    try {
        migrateLegacyHeroStorageIfNeeded();
        const raw = localStorage.getItem(HERO_REEL_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.id || !parsed?.url) return null;
        const backgroundSource = resolveStoredHeroBackgroundSource(parsed);
        return {
            id: String(parsed.id),
            fileName: String(parsed.fileName || '').trim() || String(parsed.url).split('/').pop()?.split('?')[0] || '',
            name: String(parsed.name || 'Hero'),
            url: toRelativeMediaPath(String(parsed.url)),
            thumbnail: parsed.thumbnail ? toRelativeMediaPath(String(parsed.thumbnail)) : undefined,
            type: String(parsed.type || (backgroundSource === 'custom_video' ? 'video/mp4' : 'image/jpeg')),
            backgroundSource
        };
    } catch {
        return null;
    }
}

/** @param {HeroReel | null | undefined} reel */
export function saveHeroReel(reel) {
    if (typeof window === 'undefined' || !reel?.id || !reel?.url) return null;
    const next = {
        id: reel.id,
        fileName: reel.fileName,
        name: reel.name,
        url: toRelativeMediaPath(reel.url),
        thumbnail: reel.thumbnail ? toRelativeMediaPath(reel.thumbnail) : undefined,
        type: reel.type,
        backgroundSource: reel.backgroundSource
    };
    localStorage.setItem(HERO_REEL_STORAGE_KEY, JSON.stringify(next));
    try {
        localStorage.removeItem(HERO_IMAGE_STORAGE_KEY);
        localStorage.removeItem(HERO_VIDEO_STORAGE_KEY);
    } catch {
        /* ignore */
    }
    console.info('[HERO_REEL_SAVE]', {
        id: next.id,
        fileName: next.fileName,
        url: next.url,
        backgroundSource: next.backgroundSource,
        ts: new Date().toISOString()
    });
    return next;
}

export function clearHeroReel() {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(HERO_REEL_STORAGE_KEY);
        localStorage.removeItem(HERO_IMAGE_STORAGE_KEY);
        localStorage.removeItem(HERO_VIDEO_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

/** @param {HeroReel} reel */
export function heroReelToVaultItem(reel) {
    return {
        id: reel.id,
        fileName: reel.fileName,
        name: reel.name,
        title: reel.name,
        url: reel.url,
        thumbnail: reel.thumbnail || '',
        type: reel.type || 'video/mp4',
        isHeroBackground: true
    };
}

/** @param {HeroReel} reel */
export function applyHeroReelToStores(reel, stores = {}) {
    if (!reel?.url) return;
    if (reel.backgroundSource === 'custom_video') {
        stores.setVideo?.(reel.url);
        if (reel.thumbnail) stores.setPoster?.(reel.thumbnail);
        stores.setFailed?.(false);
    } else {
        stores.setPoster?.(reel.url);
        stores.setVideo?.('');
        stores.setFailed?.(false);
    }
}

let legacyMigrated = false;

export function migrateLegacyHeroStorageIfNeeded() {
    if (typeof window === 'undefined' || legacyMigrated) return;
    legacyMigrated = true;
    if (localStorage.getItem(HERO_REEL_STORAGE_KEY)) return;

    const managerRaw = localStorage.getItem(HERO_MANAGER_STORAGE_KEY);
    const manager = managerRaw ? JSON.parse(managerRaw) : {};
    const heroAssetId = String(manager?.heroAssetId || manager?.backgroundAsset || '').trim();
    const backgroundSource = String(manager?.backgroundSource || '');
    const heroImage = String(localStorage.getItem(HERO_IMAGE_STORAGE_KEY) || '').trim();
    const heroVideo = String(localStorage.getItem(HERO_VIDEO_STORAGE_KEY) || '').trim();

    if (backgroundSource === 'custom_video' && heroVideo && !heroVideo.startsWith('data:') && !heroVideo.startsWith('blob:')) {
        const url = toRelativeMediaPath(heroVideo);
        saveHeroReel({
            id: heroAssetId || url,
            fileName: url.split('/').pop()?.split('?')[0] || '',
            name: 'Hero Video',
            url,
            thumbnail: heroImage && !heroImage.startsWith('data:') ? toRelativeMediaPath(heroImage) : undefined,
            type: 'video/mp4',
            backgroundSource: 'custom_video'
        });
        return;
    }

    if (backgroundSource === 'custom_image' && heroImage && !heroImage.startsWith('data:') && !heroImage.startsWith('blob:')) {
        const url = toRelativeMediaPath(heroImage);
        saveHeroReel({
            id: heroAssetId || url,
            fileName: url.split('/').pop()?.split('?')[0] || '',
            name: 'Hero Image',
            url,
            type: 'image/jpeg',
            backgroundSource: 'custom_image'
        });
    }
}
