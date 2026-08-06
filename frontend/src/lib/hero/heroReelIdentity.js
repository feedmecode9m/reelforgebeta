/**
 * MISSION 5.6 / Commit 3 — HeroReel compatibility adapter over HeroRecord.
 *
 * Public API (load/save/clear/resolve/migrate) is preserved for existing callers.
 * HeroRecord is the single persistence owner; this module projects the HeroReel shape.
 *
 * Legacy localStorage keys (reelforge_hero_reel, reelforge_hero_video/image) may still
 * be mirrored for transition, but they are not authoritative after migrate.
 */
import { toRelativeMediaPath } from '../config.js';
import { normalizeReel, isVideoReel } from '../api/reelContract.js';
import { reelResEntry, reelResExit, reelResReelSnapshot } from '../diagnostics/reelResolutionTrace.js';
import {
    LEGACY_HERO_IMAGE_KEY,
    LEGACY_HERO_MANAGER_KEY,
    LEGACY_HERO_REEL_KEY,
    LEGACY_HERO_VIDEO_KEY,
    loadHeroRecord,
    saveHeroRecord,
    migrateLegacyHeroRecordIfNeeded,
    projectHeroRecordToReel,
    buildHeroRecordPatchFromReel
} from './heroRecord.js';

/** @deprecated Prefer HeroRecord — kept for compatibility readers. */
export const HERO_REEL_STORAGE_KEY = LEGACY_HERO_REEL_KEY;
const HERO_VIDEO_STORAGE_KEY = LEGACY_HERO_VIDEO_KEY;
const HERO_IMAGE_STORAGE_KEY = LEGACY_HERO_IMAGE_KEY;
const HERO_MANAGER_STORAGE_KEY = LEGACY_HERO_MANAGER_KEY;

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
        backgroundSource: /** @type {'custom_image' | 'custom_video'} */ (
            mediaKind === 'video' ? 'custom_video' : 'custom_image'
        )
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
 * Mirror projected reel to legacy storage for transitional readers only.
 * @param {HeroReel | null} reel
 */
function mirrorLegacyHeroReelKey(reel) {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
        if (!reel?.id || !reel?.url) {
            localStorage.removeItem(HERO_REEL_STORAGE_KEY);
            return;
        }
        localStorage.setItem(
            HERO_REEL_STORAGE_KEY,
            JSON.stringify({
                id: reel.id,
                fileName: reel.fileName,
                name: reel.name,
                url: reel.url,
                thumbnail: reel.thumbnail,
                type: reel.type,
                backgroundSource: reel.backgroundSource
            })
        );
    } catch {
        /* ignore mirror failures */
    }
}

function clearLegacyMediaKeys() {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    try {
        localStorage.removeItem(HERO_IMAGE_STORAGE_KEY);
        localStorage.removeItem(HERO_VIDEO_STORAGE_KEY);
        localStorage.removeItem(HERO_REEL_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * Active custom-video hero reel — derived from HeroRecord asset mode.
 * Manager `none` still suppresses for dual-write compatibility.
 * @returns {HeroReel | null}
 */
export function resolveActiveHeroVideoReel() {
    const manager = readHeroManagerPointer();
    if (manager.backgroundSource === 'none') return null;

    const record = loadHeroRecord();
    if (record.mode === 'none' || record.mode === 'selection') return null;

    const reel = projectHeroRecordToReel(record);
    if (!reel?.id || !reel?.url) return null;

    const reelIsVideo =
        reel.backgroundSource === 'custom_video' || isVideoReel({ ...reel, url: reel.url });
    if (!reelIsVideo) return null;
    if (!isVideoReel({ ...reel, url: reel.url })) return null;

    return reel.backgroundSource === 'custom_video'
        ? reel
        : { ...reel, backgroundSource: 'custom_video' };
}

/**
 * Derive HeroReel from HeroRecord (no independent persistence read).
 * selection / none → null (never invents a fake asset reel).
 * @returns {HeroReel | null}
 */
export function loadHeroReel() {
    if (typeof window === 'undefined') return null;
    try {
        migrateLegacyHeroStorageIfNeeded();
        const record = loadHeroRecord();
        return projectHeroRecordToReel(record);
    } catch {
        return null;
    }
}

/**
 * Write-through to HeroRecord. Returns the public HeroReel projection.
 * @param {HeroReel | null | undefined} reel
 * @returns {HeroReel | null}
 */
export function saveHeroReel(reel) {
    if (typeof window === 'undefined' || !reel?.id || !reel?.url) return null;

    const url = toRelativeMediaPath(reel.url) || String(reel.url || '').trim();
    const thumbnail = reel.thumbnail
        ? toRelativeMediaPath(reel.thumbnail) || String(reel.thumbnail).trim()
        : undefined;

    const normalizedReel = {
        id: String(reel.id).trim(),
        fileName: String(reel.fileName || '').trim(),
        name: String(reel.name || 'Hero').trim(),
        url,
        thumbnail,
        type: String(
            reel.type ||
                (reel.backgroundSource === 'custom_video' ? 'video/mp4' : 'image/jpeg')
        ),
        backgroundSource:
            reel.backgroundSource === 'custom_video' || reel.backgroundSource === 'custom_image'
                ? reel.backgroundSource
                : isVideoReel({ ...reel, url })
                  ? /** @type {const} */ ('custom_video')
                  : /** @type {const} */ ('custom_image')
    };

    const patch = buildHeroRecordPatchFromReel(normalizedReel);
    if (!patch) {
        console.warn('[HERO_REEL_SAVE_REJECTED]', {
            id: normalizedReel.id,
            reason: 'invalid_identity_or_media',
            ts: new Date().toISOString()
        });
        return null;
    }

    const saved = saveHeroRecord(patch);
    if (!saved) return null;

    const projected = projectHeroRecordToReel(saved);
    if (!projected) return null;

    mirrorLegacyHeroReelKey(projected);
    try {
        localStorage.removeItem(HERO_IMAGE_STORAGE_KEY);
        localStorage.removeItem(HERO_VIDEO_STORAGE_KEY);
    } catch {
        /* ignore */
    }

    console.info('[HERO_REEL_SAVE]', {
        id: projected.id,
        fileName: projected.fileName,
        url: projected.url,
        backgroundSource: projected.backgroundSource,
        via: 'hero_record',
        ts: new Date().toISOString()
    });
    return projected;
}

/**
 * Clears derived reel asset via HeroRecord.
 * none stays none; otherwise drops to selection (no fake asset).
 */
export function clearHeroReel() {
    if (typeof window === 'undefined') return;
    try {
        const current = loadHeroRecord();
        if (current.mode === 'none') {
            clearLegacyMediaKeys();
            return;
        }
        saveHeroRecord({
            mode: 'selection',
            status: 'ready',
            source: 'clear_hero_reel'
        });
        clearLegacyMediaKeys();
    } catch {
        try {
            clearLegacyMediaKeys();
        } catch {
            /* ignore */
        }
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

/**
 * Compatibility entry: one-way seed into HeroRecord (legacy multi-key importer).
 * Afterward HeroRecord is authoritative; mirror is refreshed for transitional readers.
 */
export function migrateLegacyHeroStorageIfNeeded() {
    if (typeof window === 'undefined') return;
    migrateLegacyHeroRecordIfNeeded();
    refreshHeroReelLegacyMirror();
}

/**
 * Refresh transitional reelforge_hero_reel mirror from the current HeroRecord.
 * Does not write HeroRecord.
 */
export function refreshHeroReelLegacyMirror() {
    if (typeof window === 'undefined') return;
    try {
        const projected = projectHeroRecordToReel(loadHeroRecord());
        mirrorLegacyHeroReelKey(projected);
        if (projected) {
            try {
                localStorage.removeItem(HERO_IMAGE_STORAGE_KEY);
                localStorage.removeItem(HERO_VIDEO_STORAGE_KEY);
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }
}
