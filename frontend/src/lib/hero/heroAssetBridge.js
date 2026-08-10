import { toRelativeMediaPath, toBackendMediaUrl } from '../config.js';
import { resolveUserPosterUrl } from '../vaultMedia.js';

const VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;

/**
 * @param {string} value
 */
function normalizeAssetId(value) {
    return String(value || '').trim();
}

/**
 * @param {Record<string, unknown>} item
 */
function getMediaCandidate(item) {
    return String(
        item?.url ||
            item?.videoUrl ||
            item?.video_url ||
            item?.src ||
            item?.mediaUrl ||
            ''
    ).trim();
}

/**
 * Browser-playable media URL for hero vault grid + select.
 * Absolute / blob / data pass through; relative /videos|/thumbs join backend origin.
 * @param {string} mediaCandidate
 */
function resolvePlayableMediaUrl(mediaCandidate) {
    const raw = String(mediaCandidate || '').trim();
    if (!raw) return '';
    if (raw.startsWith('blob:') || raw.startsWith('data:')) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    const relative = toRelativeMediaPath(raw) || raw;
    return toBackendMediaUrl(relative) || relative;
}

/**
 * @param {string} mediaUrl
 * @param {string} mimeHint
 */
function inferAssetType(mediaUrl, mimeHint = '') {
    const lowerUrl = String(mediaUrl || '').toLowerCase();
    const lowerMime = String(mimeHint || '').toLowerCase();
    if (lowerMime.startsWith('video/') || VIDEO_EXT.test(lowerUrl) || lowerUrl.includes('/videos/')) {
        if (lowerUrl.endsWith('.mov')) return 'mov';
        if (lowerUrl.endsWith('.webm')) return 'webm';
        if (lowerUrl.endsWith('.mp4')) return 'mp4';
        return 'video';
    }
    if (lowerMime.startsWith('image/') || IMAGE_EXT.test(lowerUrl) || lowerUrl.includes('/thumbs/')) {
        if (lowerUrl.endsWith('.png')) return 'png';
        if (lowerUrl.endsWith('.webp')) return 'webp';
        if (lowerUrl.endsWith('.gif')) return 'gif';
        if (lowerUrl.endsWith('.jpeg')) return 'jpeg';
        return 'jpg';
    }
    return 'unknown';
}

/**
 * @param {string} assetType
 */
export function isVideoHeroAssetType(assetType) {
    const normalized = String(assetType || '').toLowerCase();
    return normalized === 'video' || normalized === 'mp4' || normalized === 'mov' || normalized === 'webm';
}

/**
 * @param {Record<string, unknown>} item
 * @param {{ storageSource?: string }} [options]
 */
export function normalizeHeroAssetRecord(item, options = {}) {
    if (!item || typeof item !== 'object') return null;
    const mediaCandidate = getMediaCandidate(item);
    const mediaUrl = resolvePlayableMediaUrl(mediaCandidate);
    if (!mediaUrl) return null;

    const thumbnailRaw = String(
        item?.thumbnailUrl || item?.thumbnail_url || item?.thumbnail || item?.posterUrl || item?.poster_url || ''
    ).trim();
    const thumbnailUrl =
        resolvePlayableMediaUrl(
            resolveUserPosterUrl(thumbnailRaw) || thumbnailRaw
        ) ||
        (isVideoHeroAssetType(inferAssetType(mediaUrl, String(item?.type || '')))
            ? ''
            : resolvePlayableMediaUrl(mediaUrl));

    const assetId =
        normalizeAssetId(String(item?.id || '')) ||
        normalizeAssetId(String(item?.fileName || item?.file_name || '')) ||
        normalizeAssetId(String(mediaUrl));

    if (!assetId) return null;
    const assetType = inferAssetType(mediaUrl, String(item?.type || ''));
    console.info('[HERO_CLASSIFY]', {
        stage: 'heroAssetBridge.normalizeHeroAssetRecord',
        assetId,
        assetType,
        mime: String(item?.type || ''),
        mediaUrl,
        storageSource: options.storageSource || 'vault_registry',
        ts: new Date().toISOString()
    });

    return {
        assetId,
        assetType,
        mediaUrl,
        thumbnailUrl: thumbnailUrl || '',
        storageSource: options.storageSource || 'vault_registry',
        mimeType: String(item?.type || ''),
        title: String(item?.title || item?.name || item?.fileName || assetId)
    };
}

/**
 * @param {Record<string, unknown>[]} vaultItems
 * @param {{ storageSource?: string }} [options]
 */
export function buildHeroAssetRegistry(vaultItems = [], options = {}) {
    if (!Array.isArray(vaultItems)) return [];
    const dedupe = new Set();
    const normalized = [];
    for (const item of vaultItems) {
        const entry = normalizeHeroAssetRecord(item, options);
        if (!entry) continue;
        if (dedupe.has(entry.assetId)) continue;
        dedupe.add(entry.assetId);
        normalized.push(entry);
    }
    const img0113 = normalized.find(
        (item) =>
            String(item?.mediaUrl || '').includes('IMG_0113.JPEG') ||
            String(item?.assetId || '').includes('IMG_0113.JPEG')
    );
    console.info('[HERO_REGISTRY_TRACE]', {
        stage: 'heroAssetBridge:buildHeroAssetRegistry',
        vaultItemsCount: vaultItems.length,
        registryCount: normalized.length,
        firstFive: normalized.slice(0, 5),
        img0113Present: Boolean(img0113),
        img0113AssetId: img0113?.assetId || '',
        img0113HasAssetId: Boolean(String(img0113?.assetId || '').trim()),
        ts: new Date().toISOString()
    });
    return normalized;
}

/**
 * @param {string} heroAssetId
 * @param {Record<string, unknown>[]} vaultItems
 */
export function resolveHeroAssetById(heroAssetId, vaultItems = []) {
    const target = normalizeAssetId(heroAssetId);
    if (!target) return null;
    const registry = buildHeroAssetRegistry(vaultItems);
    return (
        registry.find((asset) => asset.assetId === target) ||
        registry.find((asset) => asset.mediaUrl === target || asset.mediaUrl.endsWith(`/${target}`)) ||
        null
    );
}

