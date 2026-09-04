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
    isDurableHeroMediaUrl,
    loadHeroRecord,
    loadHeroRecordUnverified,
    selectHeroAsset,
    setHeroMode,
    updateHeroPresentation as updateHeroRecordPresentation
} from './heroRecord.js';
import {
    buildHeroAssetRegistry,
    resolveHeroAssetById
} from './heroAssetBridge.js';
import {
    reconcileActivePresentationHeroTitle,
    isUnsafeHeroFilenameTitle
} from './heroTitleIntelligence.js';
import { diagnoseInvalidHeroPresentation } from './legacyHeroPresentationRestore.js';
import { rewriteMediaToSameOrigin } from '../config.js';

export {
    getLastHeroConfigSource,
    setLastHeroConfigSource,
    logHeroSource,
    sanitizeHeroConfigLocationIntelligence,
    buildServerPresentationPayload,
    mapServerPresentationToManagerPatch
} from './heroPresentationCore.js';

/**
 * Client identity commits that may not yet have landed on the server presentation row.
 * After a successful PUT we rewrite source to server_presentation — thereafter remote wins.
 */
const LOCAL_CLIENT_IDENTITY_SOURCES = new Set([
    'commit_hero_asset_selection',
    'commit_hero_video_identity',
    'select_hero_asset',
    'commit_hero_asset_clear'
]);

/**
 * @param {unknown} source
 * @returns {boolean}
 */
export function isUnconfirmedLocalHeroCommitSource(source) {
    const s = String(source || '').trim();
    if (!s) return false;
    if (LOCAL_CLIENT_IDENTITY_SOURCES.has(s)) return true;
    return s.includes('commit_hero') || s.includes('select_hero');
}

/**
 * After a successful PUT /api/hero/presentation, stamp server_presentation only
 * when the live HeroRecord is still the identity that was just persisted.
 * A newer unconfirmed local commit (select B while A's PUT is in flight) must
 * not be overwritten by the stale confirm.
 *
 * @param {import('./heroRecord.js').HeroRecord | Record<string, unknown> | null | undefined} liveRecord
 * @param {Record<string, unknown> | null | undefined} confirmedRemote
 * @returns {boolean}
 */
export function shouldApplySuccessfulPresentationConfirm(liveRecord, confirmedRemote) {
    if (!liveRecord || typeof liveRecord !== 'object') return true;
    if (!isUnconfirmedLocalHeroCommitSource(liveRecord.source)) return true;

    const liveMode = String(liveRecord.mode || '').trim();
    const liveId = String(liveRecord.assetId || '').trim();
    const confirmedId = String(
        confirmedRemote?.heroAssetId || confirmedRemote?.assetId || ''
    ).trim();
    const confirmedBg = String(confirmedRemote?.backgroundSource || '').trim();
    const confirmedMedia = String(confirmedRemote?.mediaUrl || '').trim();
    const confirmedIsNone =
        confirmedBg === 'none' || (!confirmedId && !confirmedMedia && confirmedBg !== 'selection');

    if (liveMode === 'none') {
        return confirmedIsNone;
    }
    if (liveMode === 'asset' && liveId) {
        if (confirmedIsNone) return false;
        if (confirmedId && confirmedId !== liveId) return false;
    }
    return true;
}

/**
 * Prior server / migrate caches — never treated as "newer than" a live published remote row.
 * Failed rehydrate is diagnostic only, not a confirmed server presentation.
 * @param {unknown} source
 * @returns {boolean}
 */
export function isServerOriginHeroSource(source) {
    const s = String(source || '').trim();
    if (!s) return false;
    if (s === 'hero_authority_rehydrate_fail_closed' || s.endsWith('_fail_closed')) {
        return false;
    }
    // Lifecycle rehydrate is not a confirmed GET/PUT /api/hero/presentation.
    if (s === 'hero_authority_rehydrate' || s.startsWith('hero_authority_')) {
        return false;
    }
    if (s === 'server_presentation') {
        return true;
    }
    if (s.startsWith('server_') || s.startsWith('migrate_')) {
        return true;
    }
    return false;
}

/**
 * True when local HeroRecord is a durable asset identity ready to defend during hydrate.
 * @param {import('./heroRecord.js').HeroRecord | Record<string, unknown> | null | undefined} record
 */
export function hasDurableLocalHeroAsset(record) {
    if (!record || typeof record !== 'object') return false;
    if (String(record.mode || '').trim() !== 'asset') return false;
    const assetId = String(record.assetId || '').trim();
    if (!assetId) return false;
    const mediaUrl = String(record.mediaUrl || record.videoUrl || '').trim();
    return Boolean(mediaUrl && isDurableHeroMediaUrl(mediaUrl));
}

/**
 * Gate for hydrateHeroPresentationFromServer: keep a durable local client selection
 * when remote is a different (stale) presentation row.
 *
 * Cross-device published state still wins when local source is server-origin or the ids match
 * (heal media from server). Client commits that never confirmed on the wire keep local until
 * a successful PUT rewrites source to server_presentation.
 *
 * @param {import('./heroRecord.js').HeroRecord | Record<string, unknown> | null | undefined} localRecord
 * @param {Record<string, unknown> | null | undefined} remote
 * @returns {{ preserve: boolean; reason: string }}
 */
export function shouldPreserveLocalHeroPresentationOverRemote(localRecord, remote) {
    if (!hasDurableLocalHeroAsset(localRecord)) {
        return { preserve: false, reason: 'local_not_durable_asset' };
    }

    const localId = String(localRecord.assetId || '').trim();
    const remoteId = String(remote?.heroAssetId || '').trim();
    const remoteMedia = String(remote?.mediaUrl || '').trim();
    const presentation =
        remote?.presentation && typeof remote.presentation === 'object'
            ? /** @type {Record<string, unknown>} */ (remote.presentation)
            : {};
    const remotePresentationId = String(presentation.heroAssetId || '').trim();
    const effectiveRemoteId = remoteId || remotePresentationId;
    const effectiveRemoteMedia =
        remoteMedia || String(presentation.mediaUrl || presentation.backgroundMediaUrl || '').trim();

    const source = String(localRecord.source || '').trim();
    const remoteBg = String(
        remote?.backgroundSource || presentation.backgroundSource || ''
    ).trim();
    const isUnconfirmedClient =
        source === 'hero_authority_rehydrate_fail_closed' ||
        LOCAL_CLIENT_IDENTITY_SOURCES.has(source) ||
        source.includes('commit_hero') ||
        source.includes('select_hero');

    if (remoteBg === 'none') {
        if (source === 'commit_hero_asset_clear') {
            return { preserve: false, reason: 'local_clear_matches_remote_none' };
        }
        if (isUnconfirmedClient) {
            return { preserve: true, reason: 'local_unconfirmed_over_remote_none' };
        }
        return { preserve: false, reason: 'remote_confirmed_none' };
    }

    if (!effectiveRemoteId && !effectiveRemoteMedia) {
        if (source === 'hero_authority_rehydrate_fail_closed') {
            return { preserve: true, reason: 'local_unconfirmed_fail_closed' };
        }
        if (isUnconfirmedClient) {
            return { preserve: true, reason: 'remote_empty' };
        }
        return { preserve: false, reason: 'remote_empty_no_unconfirmed_local' };
    }

    if (effectiveRemoteId && effectiveRemoteId === localId) {
        // Same identity — allow server heal of media/poster/copy.
        return { preserve: false, reason: 'same_asset_id_heal' };
    }

    // Fail-closed rehydrate is not server confirmation. Durable local A must survive stale remote B/C.
    if (source === 'hero_authority_rehydrate_fail_closed') {
        return { preserve: true, reason: 'local_unconfirmed_fail_closed' };
    }
    if (isServerOriginHeroSource(source) || source === 'default') {
        return { preserve: false, reason: 'local_server_origin_source' };
    }

    const localTs = Number(localRecord.updatedAt) || 0;
    const remoteTs =
        Number(remote?.updatedAt) ||
        Number(presentation.updatedAt) ||
        Number(remote?.serverTimestamp) ||
        0;
    if (remoteTs > 0 && localTs > 0 && remoteTs > localTs) {
        return { preserve: false, reason: 'remote_timestamp_newer' };
    }

    if (
        LOCAL_CLIENT_IDENTITY_SOURCES.has(source) ||
        source.includes('commit_hero') ||
        source.includes('select_hero')
    ) {
        return { preserve: true, reason: 'local_client_identity_commit' };
    }

    // Unknown source + different remote identity: prefer published remote (cross-device safe).
    return { preserve: false, reason: 'unknown_source_prefer_remote' };
}

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
    const managerId = String(next.heroAssetId || '').trim();
    const recordId = record ? String(record.assetId || '').trim() : '';
    const managerEmpty = !managerId;
    const idsMatch = Boolean(managerId && recordId && managerId === recordId);
    // Copy HeroRecord identity/media ONLY when manager id is empty or exactly matches.
    // Never use record.mode === 'asset' to bridge A(manager) + B(record).
    const mayProjectRecord = Boolean(record) && (managerEmpty || idsMatch);
    let heroAssetId = managerId || (mayProjectRecord ? recordId : '');

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

    if (mayProjectRecord && record) {
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
    const rawMedia = String(remote.mediaUrl || '').trim();
    const rawPoster = String(remote.posterUrl || '').trim();
    const mediaUrl =
        /\.r2\.dev\//i.test(rawMedia) || /r2\.cloudflarestorage\.com/i.test(rawMedia)
            ? rawMedia
            : rewriteMediaToSameOrigin(rawMedia);
    const posterUrl =
        /\.r2\.dev\//i.test(rawPoster) || /r2\.cloudflarestorage\.com/i.test(rawPoster)
            ? rawPoster
            : rewriteMediaToSameOrigin(rawPoster);
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
 * Does not blindly overwrite a durable local client identity commit with a different remote row.
 *
 * @param {(patch: Record<string, unknown>, options?: { skipServer?: boolean; source?: string }) => Record<string, unknown>} saveFn
 * @param {() => Record<string, unknown>} loadFn
 * @returns {Promise<{ hydrated: boolean; config: Record<string, unknown> | null; source: string; preservedLocal?: boolean; preserveReason?: string }>}
 */
export async function hydrateHeroPresentationFromServer(saveFn, loadFn) {
    const remote = await fetchHeroPresentation();
    const local = loadFn();
    const localId = String(local?.heroAssetId || '').trim();
    let patch = mapServerPresentationToManagerPatch(remote);
    if (patch) {
        diagnoseInvalidHeroPresentation(remote, patch, isUnsafeHeroFilenameTitle);
    }
    const remoteId = String(patch?.heroAssetId || remote?.heroAssetId || '').trim();
    const remoteMedia = String(remote?.mediaUrl || patch?.mediaUrl || '').trim();

    // Prefer unverified storage so public-scrub load does not drop durable mediaUrl.
    const localRecord =
        typeof window !== 'undefined' ? loadHeroRecordUnverified() || loadHeroRecord() : null;
    const preserveDecision = shouldPreserveLocalHeroPresentationOverRemote(localRecord, remote);

    if (patch && (remoteId || String(patch.heroTitle || '').trim() || remoteMedia)) {
        if (preserveDecision.preserve) {
            console.info('[HERO_PRESENTATION] preserve local durable asset over remote hydrate', {
                localAssetId: String(localRecord?.assetId || localId || ''),
                remoteAssetId: remoteId || null,
                reason: preserveDecision.reason,
                localSource: String(localRecord?.source || ''),
                localUpdatedAt: Number(localRecord?.updatedAt) || 0,
                ts: new Date().toISOString()
            });
            // Still reconcile title to vault-canonical (persistent) without inventing media identity.
            const reconciledLocal =
                /** @type {Record<string, unknown>} */ (
                    reconcileActivePresentationHeroTitle(local || {}) || local
                ) || local;
            const titleNow = String(reconciledLocal?.heroTitle || '').trim();
            const localTitle = String(local?.heroTitle || '').trim();
            let configOut = reconciledLocal;
            if (titleNow && titleNow !== localTitle) {
                configOut = saveFn(
                    {
                        heroTitle: titleNow,
                        heroAssetTitle: titleNow
                    },
                    { skipServer: true, source: 'localStorage' }
                );
            }
            logHeroSource({
                source: 'localStorage',
                heroAssetId: String(localRecord?.assetId || localId || ''),
                title: String(configOut?.heroTitle || localRecord?.heroTitle || ''),
                backgroundUrl: String(
                    localRecord?.mediaUrl || local?.mediaUrl || local?.backgroundMediaUrl || ''
                )
            });
            setLastHeroConfigSource('localStorage');
            return {
                hydrated: false,
                config: configOut,
                source: 'localStorage',
                preservedLocal: true,
                preserveReason: preserveDecision.reason
            };
        }

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
        return {
            hydrated: true,
            config: next,
            source: 'backend',
            preservedLocal: false,
            preserveReason: preserveDecision.reason
        };
    }

    // One-time migrate: admin browser has local SoT that never hit server.
    if (localId && !remoteId) {
        console.info('[HERO_PRESENTATION] local has asset, server empty — migrating if admin', {
            heroAssetId: localId
        });
        const pushed = await pushHeroPresentationToServer(local);
        if (pushed?.ok && pushed.data) {
            applyServerPresentationToHeroRecord(pushed.data);
            logHeroSource({
                source: 'backend',
                heroAssetId: localId,
                title: String(local.heroTitle || ''),
                backgroundUrl: String(local.backgroundMediaUrl || local.mediaUrl || '')
            });
            return { hydrated: true, config: local, source: 'backend' };
        }
    }

    const source = localId || hasDurableLocalHeroAsset(localRecord) ? 'localStorage' : 'default';
    logHeroSource({
        source,
        heroAssetId: localId || String(localRecord?.assetId || ''),
        title: String(local?.heroTitle || ''),
        backgroundUrl: String(local?.backgroundMediaUrl || local?.mediaUrl || localRecord?.mediaUrl || '')
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
