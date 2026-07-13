import { toRelativeMediaPath } from '../config.js';
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
    const mediaUrl = mediaCandidate ? toRelativeMediaPath(mediaCandidate) || mediaCandidate : '';
    if (!mediaUrl) return null;

    const thumbnailUrl =
        resolveUserPosterUrl(item?.thumbnailUrl || item?.thumbnail_url || item?.thumbnail) ||
        resolveUserPosterUrl(item?.posterUrl || item?.poster_url) ||
        (isVideoHeroAssetType(inferAssetType(mediaUrl, String(item?.type || '')))
            ? ''
            : resolveUserPosterUrl(item?.url));

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

