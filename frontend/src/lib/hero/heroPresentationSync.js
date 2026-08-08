/**
 * Hero presentation sync: backend is source of truth; localStorage is cache only.
 */
import {
    buildServerPresentationPayload,
    logHeroSource,
    mapServerPresentationToManagerPatch,
    setLastHeroConfigSource
} from './heroPresentationCore.js';
import {
    fetchHeroPresentation,
    putHeroPresentation
} from '../api/heroPresentation.js';
import { getAdminToken } from '../adminSession.js';
import {
    loadHeroRecord,
    selectHeroAsset,
    setHeroMode,
    updateHeroPresentation as updateHeroRecordPresentation
} from './heroRecord.js';
import {
    buildHeroAssetRegistry,
    resolveHeroAssetById
} from './heroAssetBridge.js';

export {
    getLastHeroConfigSource,
    setLastHeroConfigSource,
    logHeroSource,
    sanitizeHeroConfigLocationIntelligence,
    buildServerPresentationPayload,
    mapServerPresentationToManagerPatch
} from './heroPresentationCore.js';

/**
 * Attach media/poster URLs from HeroRecord + vault before building the PUT body.
 * Manager config historically only stored heroAssetId / backgroundSource.
 * @param {Record<string, unknown>} config
 * @returns {Record<string, unknown>}
 */
export function enrichPresentationConfigFromLocalIdentity(config) {
    const next = config && typeof config === 'object' ? { ...config } : {};
    const record = typeof window !== 'undefined' ? loadHeroRecord() : null;
    const heroAssetId = String(next.heroAssetId || record?.assetId || '').trim();

    let mediaUrl = String(
        next.mediaUrl || next.backgroundMediaUrl || next.backgroundVideo || next.backgroundImage || ''
    ).trim();
    let posterUrl = String(next.posterUrl || next.backgroundPoster || '').trim();

    if (record && (!mediaUrl || String(record.assetId || '') === heroAssetId)) {
        if (!mediaUrl) {
            mediaUrl = String(record.mediaUrl || record.videoUrl || '').trim();
        }
        if (!posterUrl) {
            posterUrl = String(record.posterUrl || '').trim();
        }
        if (!next.backgroundSource || next.backgroundSource === 'selection') {
            if (record.mode === 'asset') {
                next.backgroundSource =
                    record.mediaKind === 'image' ? 'custom_image' : 'custom_video';
                next.backgroundStyle = record.mediaKind === 'image' ? 'image' : 'video';
            } else if (record.mode === 'none') {
                next.backgroundSource = 'none';
            }
        }
        if (!heroAssetId && record.mode === 'asset') {
            next.heroAssetId = String(record.assetId || '').trim();
        }
        if (!String(next.heroTitle || '').trim() && record.heroTitle) {
            next.heroTitle = String(record.heroTitle);
        }
        if (!String(next.heroSubtitle || '').trim() && record.heroSubtitle) {
            next.heroSubtitle = String(record.heroSubtitle);
        }
        if (!String(next.heroDescription || '').trim() && record.heroDescription) {
            next.heroDescription = String(record.heroDescription);
        }
        if (!String(next.heroLabel || '').trim() && record.title) {
            // leave label alone unless empty elsewhere
        }
    }

    if ((!mediaUrl || !posterUrl) && heroAssetId && typeof window !== 'undefined') {
        try {
            // Dynamic vault read — avoid importing heroIntelligence (circular).
            const raw =
                JSON.parse(localStorage.getItem('personal_video_vault') || '[]') || [];
            const thumbs =
                JSON.parse(localStorage.getItem('personal_thumbnails') || '[]') || [];
            const items = Array.isArray(raw) ? [...raw, ...(Array.isArray(thumbs) ? thumbs : [])] : [];
            const registry = buildHeroAssetRegistry(items);
            const asset =
                resolveHeroAssetById(heroAssetId, items) ||
                registry.find((a) => String(a.assetId) === heroAssetId);
            if (asset) {
                if (!mediaUrl) mediaUrl = String(asset.mediaUrl || '').trim();
                if (!posterUrl) posterUrl = String(asset.thumbnailUrl || '').trim();
            }
        } catch {
            /* ignore */
        }
    }

    if (mediaUrl) next.mediaUrl = mediaUrl;
    if (posterUrl) next.posterUrl = posterUrl;
    if (heroAssetId) next.heroAssetId = heroAssetId;
    return next;
}

/**
 * Materialize server presentation into HeroRecord so the landscape can render
 * without waiting for vault catalog match.
 * @param {Record<string, unknown>} remote
 */
export function applyServerPresentationToHeroRecord(remote) {
    if (!remote || typeof remote !== 'object' || typeof window === 'undefined') return;

    const id = String(remote.heroAssetId || '').trim();
    const mediaUrl = String(remote.mediaUrl || '').trim();
    const posterUrl = String(remote.posterUrl || '').trim();
    const bg = String(remote.backgroundSource || '').trim();
    const title = String(remote.heroTitle || '').trim();
    const subtitle = String(remote.heroSubtitle || '').trim();
    const description = String(remote.heroDescription || '').trim();

    if (bg === 'none' || (!id && !mediaUrl && bg !== 'selection')) {
        if (bg === 'none') {
            setHeroMode('none', { source: 'server_presentation' });
        }
        return;
    }
    if ((bg === 'selection' || !bg) && !id && !mediaUrl) {
        setHeroMode('selection', { source: 'server_presentation' });
        if (title || subtitle || description) {
            updateHeroRecordPresentation({
                heroTitle: title,
                heroSubtitle: subtitle,
                heroDescription: description,
                source: 'server_presentation'
            });
        }
        return;
    }
    if (!id || !mediaUrl) return;

    const isImage =
        bg === 'custom_image' ||
        /\.(jpe?g|png|gif|webp)(\?|$)/i.test(mediaUrl) ||
        String(remote.backgroundStyle || '').toLowerCase() === 'image';

    selectHeroAsset({
        assetId: id,
        mediaUrl,
        mediaKind: isImage ? 'image' : 'video',
        videoUrl: isImage ? '' : mediaUrl,
        posterUrl: posterUrl || (isImage ? mediaUrl : ''),
        fileName: title || id,
        title: title || id,
        heroTitle: title,
        heroSubtitle: subtitle,
        heroDescription: description,
        source: 'server_presentation'
    });
}

/**
 * Server → localStorage cache. Does not re-POST.
 * @param {(patch: Record<string, unknown>, options?: { skipServer?: boolean; source?: string }) => Record<string, unknown>} saveFn
 * @param {() => Record<string, unknown>} loadFn
 * @returns {Promise<{ hydrated: boolean; config: Record<string, unknown> | null; source: string }>}
 */
export async function hydrateHeroPresentationFromServer(saveFn, loadFn) {
    const remote = await fetchHeroPresentation();
    const local = loadFn();
    const localId = String(local?.heroAssetId || '').trim();
    const patch = mapServerPresentationToManagerPatch(remote);
    const remoteId = String(patch?.heroAssetId || remote?.heroAssetId || '').trim();
    const remoteMedia = String(remote?.mediaUrl || patch?.mediaUrl || '').trim();

    if (patch && (remoteId || String(patch.heroTitle || '').trim() || remoteMedia)) {
        const next = saveFn(patch, { skipServer: true, source: 'backend' });
        applyServerPresentationToHeroRecord(remote || patch);
        const title = String(next?.heroTitle || patch.heroTitle || '').trim();
        const bg = remoteMedia || String(patch.backgroundMediaUrl || next?.mediaUrl || '').trim();
        logHeroSource({
            source: 'backend',
            heroAssetId: String(next?.heroAssetId || remoteId),
            title,
            backgroundUrl: bg
        });
        return { hydrated: true, config: next, source: 'backend' };
    }

    // One-time migrate: admin browser has local SoT that never hit server.
    if (localId && !remoteId) {
        console.info('[HERO_PRESENTATION] local has asset, server empty — migrating if admin', {
            heroAssetId: localId
        });
        const pushed = await pushHeroPresentationToServer(local);
        if (pushed) {
            logHeroSource({
                source: 'backend',
                heroAssetId: localId,
                title: String(local.heroTitle || ''),
                backgroundUrl: String(local.backgroundMediaUrl || local.mediaUrl || '')
            });
            return { hydrated: true, config: local, source: 'backend' };
        }
    }

    const source = localId ? 'localStorage' : 'default';
    logHeroSource({
        source,
        heroAssetId: localId,
        title: String(local?.heroTitle || ''),
        backgroundUrl: String(local?.backgroundMediaUrl || local?.mediaUrl || '')
    });
    setLastHeroConfigSource(source);
    return { hydrated: false, config: local, source };
}

/**
 * Push current config to server (admin). Prefer awaiting from Hero Manager actions.
 * @param {Record<string, unknown>} config
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function pushHeroPresentationToServer(config) {
    const enriched = enrichPresentationConfigFromLocalIdentity(config || {});
    const payload = buildServerPresentationPayload(enriched);
    const bg = String(payload.backgroundSource || '').trim();
    const hasAsset = Boolean(String(payload.heroAssetId || '').trim());
    const hasMedia = Boolean(String(payload.mediaUrl || '').trim());
    const hasTitle = Boolean(String(payload.heroTitle || '').trim());
    const isExplicitBlank = bg === 'none';
    const isCustom = bg === 'custom_video' || bg === 'custom_image';

    // Always push custom heroes and explicit clears. Skip no-op discovery defaults with no content.
    if (!hasAsset && !hasMedia && !hasTitle && !isExplicitBlank && !isCustom) {
        console.info('[HERO_PRESENTATION] PUT skipped — nothing to publish', { backgroundSource: bg });
        return null;
    }

    if (!getAdminToken()) {
        console.warn(
            '[HERO_PRESENTATION] PUT skipped — no admin session. Open Studio, log in, then re-apply the hero background.'
        );
        return null;
    }

    console.info('[HERO_PRESENTATION] PUT start', {
        heroAssetId: payload.heroAssetId || null,
        backgroundSource: payload.backgroundSource,
        mediaUrl: payload.mediaUrl ? String(payload.mediaUrl).slice(0, 96) : null,
        posterUrl: payload.posterUrl ? String(payload.posterUrl).slice(0, 96) : null,
        heroTitle: payload.heroTitle || null
    });

    const saved = await putHeroPresentation(payload);
    if (saved) {
        console.info('[HERO_PRESENTATION] PUT ok', {
            heroAssetId: saved.heroAssetId || payload.heroAssetId,
            mediaUrl: saved.mediaUrl || payload.mediaUrl || null,
            updatedAt: saved.updatedAt || null
        });
        setLastHeroConfigSource('backend');
    } else {
        console.warn('[HERO_PRESENTATION] PUT failed — server did not accept presentation', {
            heroAssetId: payload.heroAssetId,
            backgroundSource: payload.backgroundSource
        });
    }
    return saved;
}
