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
    putHeroPresentation,
    resolveHeroPresentationRequestUrl
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
 * True when the host is a public deploy where dev_local_session is rejected.
 * @returns {boolean}
 */
function isProductionAdminHost() {
    if (typeof window === 'undefined') return true;
    const host = String(window.location.hostname || '').toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
        return false;
    }
    return true;
}

/**
 * Studio must use a real token from POST /admin/auth — not the offline dev stub.
 * @param {string | null} token
 * @returns {{ ok: boolean; reason?: string }}
 */
export function validateAdminTokenForHeroPublish(token) {
    const t = String(token || '').trim();
    if (!t) {
        return { ok: false, reason: 'missing_token' };
    }
    if (t === 'dev_local_session' && isProductionAdminHost()) {
        return {
            ok: false,
            reason: 'dev_local_session_not_valid_on_production'
        };
    }
    if (t === 'backend_token') {
        return { ok: false, reason: 'placeholder_backend_token' };
    }
    return { ok: true };
}

/**
 * Attach media/poster URLs from HeroRecord + vault before building the PUT body.
 * Manager config historically only stored heroAssetId / backgroundSource.
 * @param {Record<string, unknown>} config
 * @returns {Record<string, unknown>}
 */
export function enrichPresentationConfigFromLocalIdentity(config) {
    const next = config && typeof config === 'object' ? { ...config } : {};
    const record = typeof window !== 'undefined' ? loadHeroRecord() : null;
    let heroAssetId = String(next.heroAssetId || record?.assetId || '').trim();

    let mediaUrl = String(
        next.mediaUrl ||
            next.backgroundMediaUrl ||
            next.backgroundVideo ||
            next.backgroundImage ||
            next.videoUrl ||
            ''
    ).trim();
    let posterUrl = String(
        next.posterUrl || next.backgroundPoster || next.thumbnailUrl || next.thumbnail || ''
    ).trim();

    if (record) {
        const recordId = String(record.assetId || '').trim();
        const idsMatch = !heroAssetId || !recordId || recordId === heroAssetId;
        if (idsMatch || record.mode === 'asset') {
            if (!heroAssetId && record.mode === 'asset' && recordId) {
                heroAssetId = recordId;
            }
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
                // leave label alone
            }
        }
    }

    if ((!mediaUrl || !posterUrl || !heroAssetId) && typeof window !== 'undefined') {
        try {
            const raw =
                JSON.parse(localStorage.getItem('personal_video_vault') || '[]') || [];
            const thumbs =
                JSON.parse(localStorage.getItem('personal_thumbnails') || '[]') || [];
            const items = Array.isArray(raw)
                ? [...raw, ...(Array.isArray(thumbs) ? thumbs : [])]
                : [];
            const registry = buildHeroAssetRegistry(items);
            const id = heroAssetId || String(next.heroAssetId || '').trim();
            const asset =
                (id && resolveHeroAssetById(id, items)) ||
                (id && registry.find((a) => String(a.assetId) === id)) ||
                null;
            if (asset) {
                if (!heroAssetId) heroAssetId = String(asset.assetId || '').trim();
                if (!mediaUrl) mediaUrl = String(asset.mediaUrl || '').trim();
                if (!posterUrl) posterUrl = String(asset.thumbnailUrl || '').trim();
                if (!String(next.heroTitle || '').trim() && asset.title) {
                    next.heroTitle = String(asset.title);
                }
            }
        } catch {
            /* ignore */
        }
    }

    // Prefer durable http(s) / site-relative paths; drop ephemeral blob: for server.
    if (mediaUrl.startsWith('blob:')) {
        console.warn('[HERO_PRESENTATION] discarding blob: mediaUrl — not durable for cross-device');
        mediaUrl = '';
    }
    if (posterUrl.startsWith('blob:')) {
        posterUrl = '';
    }

    if (mediaUrl) {
        next.mediaUrl = mediaUrl;
        next.backgroundMediaUrl = mediaUrl;
    }
    if (posterUrl) next.posterUrl = posterUrl;
    if (heroAssetId) next.heroAssetId = heroAssetId;

    // Infer custom sources from resolved media when still selection + has asset.
    if (
        String(next.backgroundSource || '') === 'selection' &&
        (heroAssetId || mediaUrl)
    ) {
        const styleHint = String(next.backgroundStyle || '').toLowerCase();
        const isImage =
            styleHint === 'image' ||
            /\.(jpe?g|png|gif|webp)(\?|$)/i.test(mediaUrl);
        next.backgroundSource = isImage ? 'custom_image' : 'custom_video';
        next.backgroundStyle = isImage ? 'image' : 'video';
    }

    return next;
}

/**
 * Materialize server presentation into HeroRecord so the landscape can render
 * without waiting for vault catalog match.
 * Server mediaUrl is authoritative — never requires a local vault row.
 * @param {Record<string, unknown>} remote
 * @returns {import('./heroRecord.js').HeroRecord | null}
 */
export function applyServerPresentationToHeroRecord(remote) {
    if (!remote || typeof remote !== 'object' || typeof window === 'undefined') return null;

    const id = String(remote.heroAssetId || '').trim();
    const mediaUrl = String(remote.mediaUrl || '').trim();
    const posterUrl = String(remote.posterUrl || '').trim();
    const bg = String(remote.backgroundSource || '').trim();
    const title = String(remote.heroTitle || '').trim();
    const subtitle = String(remote.heroSubtitle || '').trim();
    const description = String(remote.heroDescription || '').trim();
    const label = String(remote.heroLabel || '').trim();

    if (bg === 'none' || (!id && !mediaUrl && bg !== 'selection' && bg !== 'custom_video' && bg !== 'custom_image')) {
        if (bg === 'none') {
            setHeroMode('none', { source: 'server_presentation' });
        }
        return null;
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
        return null;
    }

    // Allow mediaUrl-only (rare) — synthesizes a stable id from the URL path for record validity.
    const assetId =
        id ||
        (() => {
            try {
                const path = new URL(mediaUrl).pathname;
                const base = path.split('/').filter(Boolean).pop() || '';
                return base.replace(/\.[a-z0-9]+$/i, '') || 'server-hero';
            } catch {
                return mediaUrl ? 'server-hero' : '';
            }
        })();

    if (!mediaUrl) {
        console.warn('[HERO_PRESENTATION] applyServerPresentation skipped — no mediaUrl', {
            heroAssetId: id,
            backgroundSource: bg
        });
        return null;
    }

    const isImage =
        bg === 'custom_image' ||
        /\.(jpe?g|png|gif|webp)(\?|$)/i.test(mediaUrl) ||
        String(remote.backgroundStyle || '').toLowerCase() === 'image';

    const record = selectHeroAsset({
        assetId,
        mediaUrl,
        mediaKind: isImage ? 'image' : 'video',
        videoUrl: isImage ? '' : mediaUrl,
        posterUrl: posterUrl || (isImage ? mediaUrl : ''),
        fileName: title || label || assetId,
        title: title || label || assetId,
        heroTitle: title,
        heroSubtitle: subtitle,
        heroDescription: description,
        source: 'server_presentation'
    });

    console.info('[HERO_BACKGROUND_RESOLVE]', {
        stage: 'applyServerPresentationToHeroRecord',
        heroAssetId: assetId,
        backgroundSource: bg || (isImage ? 'custom_image' : 'custom_video'),
        mediaUrl,
        resolvedUrl: record?.mediaUrl || mediaUrl,
        source: 'server_presentation',
        recordMode: record?.mode || null,
        ok: Boolean(record)
    });

    return record;
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
        if (pushed?.ok && pushed.data) {
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
 * @typedef {{
 *   ok: boolean;
 *   data: Record<string, unknown> | null;
 *   error?: string;
 *   status?: number;
 *   payload?: Record<string, unknown> | null;
 * }} PushHeroPresentationResult
 */

/**
 * Push current config to server (admin). Prefer awaiting from Hero Manager actions.
 * @param {Record<string, unknown>} config
 * @returns {Promise<PushHeroPresentationResult>}
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

    console.info('[HERO_MANAGER] apply payload', {
        stage: 'pushHeroPresentationToServer',
        heroAssetId: payload.heroAssetId || null,
        backgroundSource: payload.backgroundSource,
        backgroundStyle: payload.backgroundStyle,
        mediaUrl: payload.mediaUrl || null,
        posterUrl: payload.posterUrl || null,
        heroLabel: payload.heroLabel || null,
        heroTitle: payload.heroTitle || null,
        heroSubtitle: payload.heroSubtitle || null,
        heroDescription: payload.heroDescription || null,
        url: resolveHeroPresentationRequestUrl(),
        ts: new Date().toISOString()
    });

    console.info('[HERO_PRESENTATION] payload', {
        heroAssetId: payload.heroAssetId || null,
        backgroundSource: payload.backgroundSource,
        backgroundStyle: payload.backgroundStyle,
        mediaUrl: payload.mediaUrl ? String(payload.mediaUrl).slice(0, 120) : null,
        posterUrl: payload.posterUrl ? String(payload.posterUrl).slice(0, 120) : null,
        heroTitle: payload.heroTitle || null,
        heroDescription: payload.heroDescription
            ? String(payload.heroDescription).slice(0, 80)
            : null,
        hasAsset,
        hasMedia,
        hasTitle,
        isCustom,
        isExplicitBlank
    });

    // Always push custom heroes, asset/media, clear, or titled presentation.
    // Only skip empty discovery defaults (selection + no asset/media/title).
    if (!hasAsset && !hasMedia && !hasTitle && !isExplicitBlank && !isCustom) {
        console.info('[HERO_PRESENTATION] PUT skipped — nothing to publish', {
            backgroundSource: bg
        });
        return {
            ok: false,
            data: null,
            error: 'empty_payload',
            status: 0,
            payload
        };
    }

    // Soft block: custom heroes without mediaUrl never help other devices.
    if (isCustom && hasAsset && !hasMedia) {
        console.warn(
            '[HERO_PRESENTATION] PUT proceeding without mediaUrl — vault resolution missed the file'
        );
    }

    const token = getAdminToken();
    const authCheck = validateAdminTokenForHeroPublish(token);
    console.info('[HERO_PRESENTATION] auth', {
        hasToken: Boolean(token),
        tokenPrefix: token ? String(token).slice(0, 8) : null,
        authOk: authCheck.ok,
        authReason: authCheck.reason || null
    });
    if (!authCheck.ok) {
        const error =
            authCheck.reason === 'dev_local_session_not_valid_on_production'
                ? 'Studio is using offline dev session. Log out and log in again with your Studio password (needs a real backend token).'
                : authCheck.reason === 'placeholder_backend_token'
                  ? 'Invalid admin session placeholder. Log in to Studio again.'
                  : 'No admin session. Open Studio, log in, then re-apply the hero background.';
        console.warn('[HERO_PRESENTATION] PUT skipped — auth', authCheck.reason);
        return {
            ok: false,
            data: null,
            error,
            status: 401,
            payload
        };
    }

    console.info('[HERO_PRESENTATION] PUT start', {
        url: resolveHeroPresentationRequestUrl(),
        heroAssetId: payload.heroAssetId || null,
        backgroundSource: payload.backgroundSource,
        mediaUrl: payload.mediaUrl ? String(payload.mediaUrl).slice(0, 96) : null,
        posterUrl: payload.posterUrl ? String(payload.posterUrl).slice(0, 96) : null,
        heroTitle: payload.heroTitle || null,
        heroDescription: payload.heroDescription
            ? String(payload.heroDescription).slice(0, 80)
            : null
    });

    const result = await putHeroPresentation(payload);
    console.info('[HERO_PRESENTATION] PUT response', {
        ok: result.ok,
        status: result.status,
        url: result.url,
        hasAuthorization: result.hasAuthorization,
        error: result.error,
        heroAssetId: result.data?.heroAssetId ?? null,
        mediaUrl: result.data?.mediaUrl ? String(result.data.mediaUrl).slice(0, 96) : null,
        heroTitle: result.data?.heroTitle ?? null,
        backgroundSource: result.data?.backgroundSource ?? null,
        updatedAt: result.data?.updatedAt ?? null
    });

    if (result.ok && result.data) {
        console.info('[HERO_PRESENTATION] PUT ok', {
            heroAssetId: result.data.heroAssetId || payload.heroAssetId,
            mediaUrl: result.data.mediaUrl || payload.mediaUrl || null,
            heroTitle: result.data.heroTitle || payload.heroTitle || null,
            updatedAt: result.data.updatedAt || null
        });
        setLastHeroConfigSource('backend');
        // Verify round-trip GET quickly (diagnose silent write failures).
        try {
            const verified = await fetchHeroPresentation();
            console.info('[HERO_PRESENTATION] GET after PUT', {
                heroAssetId: verified?.heroAssetId ?? null,
                mediaUrl: verified?.mediaUrl
                    ? String(verified.mediaUrl).slice(0, 96)
                    : null,
                heroTitle: verified?.heroTitle ?? null
            });
            if (
                String(payload.heroAssetId || '').trim() &&
                !String(verified?.heroAssetId || '').trim()
            ) {
                console.warn(
                    '[HERO_PRESENTATION] GET still empty after successful PUT — backend/cache mismatch'
                );
            }
        } catch {
            /* ignore */
        }
        return {
            ok: true,
            data: result.data,
            status: result.status,
            payload
        };
    }

    console.warn('[HERO_PRESENTATION] PUT failed — server did not accept presentation', {
        status: result.status,
        error: result.error,
        heroAssetId: payload.heroAssetId,
        backgroundSource: payload.backgroundSource
    });
    return {
        ok: false,
        data: null,
        error: result.error || `HTTP ${result.status}` || 'put_failed',
        status: result.status,
        payload
    };
}
